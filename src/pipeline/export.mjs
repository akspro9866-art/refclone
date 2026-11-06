import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, fileRecord, hashFile, hashObject, readJson, runProcess,
  validateArtifact, verifyFiles, withJobLock, writeJsonNew, writeJsonState
} from '../core.mjs';
import { deriveJobDirectory } from '../design/assets.mjs';
import { CavalryAdapter } from '../cavalry/cavalry.mjs';
import { verifyScene } from './build.mjs';

export const EXPORT_VERSION = '1.0.0';

const DEFAULT_PROCESS_TIMEOUT_MS = 300_000;
// A saved project must reproduce its own frames. Values are intentionally tight
// because both images are the same deterministic PNG route; the tolerance only
// absorbs encoder-level nondeterminism, not scene drift.
const FRAME_REPRODUCTION_TOLERANCE = { mae: 1, maxChannelDelta: 16 };

function comparePngs(leftBytes, rightBytes) {
  const left = PNG.sync.read(leftBytes);
  const right = PNG.sync.read(rightBytes);
  if (left.width !== right.width || left.height !== right.height) {
    return {
      width: left.width, height: left.height,
      other: { width: right.width, height: right.height },
      mae: null, maxChannelDelta: null, changedFraction: null, comparable: false
    };
  }
  let total = 0;
  let maxDelta = 0;
  let changed = 0;
  const channels = right.width * right.height * 3;
  for (let i = 0; i < left.data.length; i += 4) {
    let pixelChanged = false;
    for (let c = 0; c < 3; c += 1) {
      const delta = Math.abs(left.data[i + c] - right.data[i + c]);
      total += delta;
      if (delta > maxDelta) maxDelta = delta;
      if (delta > 24) pixelChanged = true;
    }
    if (pixelChanged) changed += 1;
  }
  return {
    width: left.width, height: left.height,
    mae: Number((total / channels).toFixed(4)),
    maxChannelDelta: maxDelta,
    changedFraction: Number((changed / (right.width * right.height)).toFixed(4)),
    comparable: true
  };
}

async function probeDecodedVideo(ffprobe, videoPath, { timeoutMs }) {
  const probe = await runProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,nb_frames:format=duration', '-of', 'json', videoPath], { timeoutMs });
  const counted = await runProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'json', videoPath], { timeoutMs });
  const parse = (value, label) => {
    try {
      return JSON.parse(value);
    } catch {
      throw new WorkflowError('EXPORT_PROBE_INVALID', `FFprobe ${label} output was not JSON.`, { output: String(value).slice(0, 400) });
    }
  };
  const metadata = parse(probe.stdout, 'metadata');
  const decoded = parse(counted.stdout, 'decode count');
  const stream = metadata?.streams?.[0] ?? {};
  return {
    codec: stream.codec_name ?? null,
    width: Number(stream.width ?? NaN),
    height: Number(stream.height ?? NaN),
    avgFrameRate: stream.avg_frame_rate ?? null,
    containerFrames: Number(stream.nb_frames ?? NaN),
    decodedFrames: Number(decoded?.streams?.[0]?.nb_read_frames ?? NaN),
    durationSeconds: Number(metadata?.format?.duration ?? NaN)
  };
}

async function ffmpegVersion(command, args, timeoutMs) {
  try {
    const result = await runProcess(command, args, { timeoutMs });
    return String(result.stdout || '').split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

function summaryShots(report) {
  return report.shots.map(shot => ({
    shotId: shot.shotId,
    status: shot.status,
    metrics: shot.metrics,
    notes: Array.isArray(shot.notes) ? shot.notes : []
  }));
}

/**
 * Copy the finished deliverables into a new, unique export directory and
 * re-validate them: file hashes, decoded video, a fresh scene reopen with layer
 * readback, and a re-rendered first frame compared with the manifest frame.
 * Nothing is overwritten; every export writes its own versioned directory.
 */
export async function exportFinal(planPath, options = {}) {
  const resolvedPlanPath = absolutePath(planPath);
  if (!options.projectPath) throw new WorkflowError('EXPORT_INPUT_REQUIRED', 'exportFinal requires the saved scene path.');
  if (!options.renderManifestPath) throw new WorkflowError('EXPORT_INPUT_REQUIRED', 'exportFinal requires the verified render manifest.');
  if (!options.qaReportPath) throw new WorkflowError('EXPORT_INPUT_REQUIRED', 'exportFinal requires the QA report.');
  const plan = await readJson(resolvedPlanPath);
  await validateArtifact('scene-plan', plan);
  if (plan.validation?.executable !== true) {
    throw new WorkflowError('EXPORT_PLAN_NOT_EXECUTABLE', 'Export requires an executable, validated scene plan.', { planPath: resolvedPlanPath });
  }
  const projectPath = absolutePath(options.projectPath);
  const renderManifestPath = absolutePath(options.renderManifestPath);
  const qaReportPath = absolutePath(options.qaReportPath);
  const config = options.config ?? await readJson(absolutePath(options.configPath ?? fileURLToPath(new URL('../../config.json', import.meta.url))));
  const ffmpeg = options.ffmpeg ?? config.ffmpeg ?? 'ffmpeg';
  const ffprobe = options.ffprobe ?? config.ffprobe ?? 'ffprobe';
  const processTimeoutMs = config.render?.processTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  const renderTimeoutMs = config.render?.timeoutMs ?? 60_000;
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(resolvedPlanPath);

  const buildReportPath = options.buildReportPath ? absolutePath(options.buildReportPath) : null;
  let buildState = { elements: {} };
  if (buildReportPath) {
    buildState = await readJson(buildReportPath);
    if (!buildState || typeof buildState !== 'object' || typeof buildState.elements !== 'object') {
      throw new WorkflowError('EXPORT_BUILD_REPORT_INVALID', 'The build report does not contain an element-id map.', { path: buildReportPath });
    }
  }

  const projectRecord = await fileRecord(projectPath);
  const renderManifest = await readJson(renderManifestPath);
  await validateArtifact('render-manifest', renderManifest);
  if (renderManifest.status !== 'verified' || renderManifest.video?.validated !== true) {
    throw new WorkflowError('EXPORT_RENDER_NOT_VERIFIED', 'Only a verified render manifest can be exported.', {
      status: renderManifest.status, video: renderManifest.video ? { validated: renderManifest.video.validated } : null
    });
  }
  if (renderManifest.projectSha256 !== projectRecord.sha256) {
    throw new WorkflowError('EXPORT_PROJECT_MISMATCH', 'The render manifest was produced from a different saved scene.', {
      manifestProjectSha256: renderManifest.projectSha256, actualProjectSha256: projectRecord.sha256
    });
  }
  if (typeof renderManifest.sourceHash !== 'string' || renderManifest.sourceHash !== plan.sourceHash) {
    throw new WorkflowError('EXPORT_SOURCE_MISMATCH', 'The render manifest does not belong to this plan source.', {
      manifestSourceHash: renderManifest.sourceHash, planSourceHash: plan.sourceHash
    });
  }
  const expectedFrames = plan.project.totalFrames;
  if (!Array.isArray(renderManifest.frames) || renderManifest.frames.length !== expectedFrames) {
    throw new WorkflowError('EXPORT_FRAMES_INVALID', 'The render manifest does not contain every planned frame.', {
      expectedFrames, actualFrames: Array.isArray(renderManifest.frames) ? renderManifest.frames.length : null
    });
  }
  for (let index = 0; index < renderManifest.frames.length; index += 1) {
    if (renderManifest.frames[index]?.frame !== index) {
      throw new WorkflowError('EXPORT_FRAMES_INVALID', 'Render manifest frames are not contiguous from zero.', { index, frame: renderManifest.frames[index]?.frame ?? null });
    }
  }
  if (!await verifyFiles(renderManifest.frames)) {
    throw new WorkflowError('EXPORT_FRAME_HASH_MISMATCH', 'At least one rendered frame no longer matches the manifest hash.');
  }
  const videoRecord = await fileRecord(renderManifest.video.path);
  if (videoRecord.sha256 !== renderManifest.video.sha256) {
    throw new WorkflowError('EXPORT_VIDEO_HASH_MISMATCH', 'The encoded video no longer matches the render manifest.', {
      manifestSha256: renderManifest.video.sha256, actualSha256: videoRecord.sha256
    });
  }
  const qaReport = await readJson(qaReportPath);
  await validateArtifact('qa-report', qaReport);
  if (qaReport.status === 'fail') {
    throw new WorkflowError('EXPORT_QA_FAILED', 'QA recorded a failing shot; export is refused until it is corrected or reviewed.', {
      reportPath: qaReportPath
    });
  }
  if (qaReport.renderHash !== videoRecord.sha256) {
    throw new WorkflowError('EXPORT_QA_MISMATCH', 'The QA report measures a different video than the render manifest.', {
      qaRenderHash: qaReport.renderHash, videoSha256: videoRecord.sha256
    });
  }
  if (qaReport.sourceHash !== plan.sourceHash || qaReport.referenceHash !== plan.sourceHash) {
    throw new WorkflowError('EXPORT_QA_MISMATCH', 'The QA report belongs to a different reference/source hash.', {
      qaSourceHash: qaReport.sourceHash, qaReferenceHash: qaReport.referenceHash, planSourceHash: plan.sourceHash
    });
  }

  const decoded = await probeDecodedVideo(ffprobe, videoRecord.path, { timeoutMs: processTimeoutMs });
  const decodedOk = decoded.width === plan.project.width && decoded.height === plan.project.height
    && decoded.decodedFrames === expectedFrames;
  if (!decodedOk) {
    throw new WorkflowError('EXPORT_VIDEO_DECODE_INVALID', 'The exported video does not decode to the planned geometry and frame count.', {
      expected: { width: plan.project.width, height: plan.project.height, frames: expectedFrames }, actual: decoded
    });
  }

  const renderManifestRecord = await fileRecord(renderManifestPath);
  const qaReportRecord = await fileRecord(qaReportPath);
  const key = hashObject({
    version: EXPORT_VERSION,
    planSha256: await hashFile(resolvedPlanPath),
    projectSha256: projectRecord.sha256,
    renderManifestSha256: renderManifestRecord.sha256,
    qaReportSha256: qaReportRecord.sha256
  });
  const directory = path.join(jobDirectory, 'export', key);

  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    await fs.mkdir(runDirectory, { recursive: true });
    const limitations = [];

    // Unique final names: the render video is copied, never moved, and an export
    // never replaces an existing final under any path.
    const sourceTag = plan.sourceHash.slice(0, 8);
    const finalName = `final-${sourceTag}-${randomUUID().slice(0, 8)}.mp4`;
    const finalVideoPath = path.join(runDirectory, finalName);
    await fs.copyFile(videoRecord.path, finalVideoPath, fs.constants.COPYFILE_EXCL);
    const finalVideo = await fileRecord(finalVideoPath);
    if (finalVideo.sha256 !== videoRecord.sha256) {
      throw new WorkflowError('EXPORT_COPY_MISMATCH', 'The exported video copy does not match the verified render.', {
        sourceSha256: videoRecord.sha256, copySha256: finalVideo.sha256
      });
    }
    const projectName = path.basename(projectPath);
    const projectCopyPath = path.join(runDirectory, projectName);
    await fs.copyFile(projectPath, projectCopyPath, fs.constants.COPYFILE_EXCL);
    const projectCopy = await fileRecord(projectCopyPath);
    if (projectCopy.sha256 !== projectRecord.sha256) {
      throw new WorkflowError('EXPORT_COPY_MISMATCH', 'The exported scene copy does not match the saved project.', {
        sourceSha256: projectRecord.sha256, copySha256: projectCopy.sha256
      });
    }
    const evidenceDirectory = path.join(runDirectory, 'evidence');
    await fs.mkdir(evidenceDirectory);
    const evidence = {};
    for (const [name, source] of [
      ['scene-plan.json', resolvedPlanPath],
      ['render-manifest.json', renderManifestPath],
      ['qa-report.json', qaReportPath],
      ['qa-report.md', qaReportPath.replace(/\.json$/i, '.md')],
      ...(buildReportPath ? [['build-report.json', buildReportPath]] : [])
    ]) {
      try {
        const target = path.join(evidenceDirectory, name);
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
        evidence[name] = await fileRecord(target);
      } catch (error) {
        if (error.code === 'ENOENT') {
          limitations.push(`Evidence file was not copied because it does not exist: ${source}`);
        } else {
          throw error;
        }
      }
    }

    // Reopen the saved project and read it back: the editor deliverable must still
    // be the verified scene, not just a matching file hash.
    const adapter = new CavalryAdapter(config.mcp);
    let sceneReopen;
    let frameReproduction;
    try {
      const discovery = await adapter.start();
      const reopened = await adapter.openProject(projectPath);
      const verification = await verifyScene(adapter, plan, buildState);
      const composition = verification.composition;
      const compositionOk = composition.width === plan.project.width
        && composition.height === plan.project.height
        && Math.abs((composition.fps ?? 0) - plan.project.fps.num / plan.project.fps.den) < 1e-9
        && composition.inFrame === plan.project.frameRange.startFrame
        && composition.outFrame === plan.project.frameRange.endFrame;
      const scenePathOk = typeof composition.sceneFilePath === 'string'
        && absolutePath(composition.sceneFilePath).toLowerCase() === projectPath.toLowerCase();
      sceneReopen = {
        ok: verification.ok && compositionOk && scenePathOk && composition.unsaved !== true,
        openedAt: reopened.value?.opened === true,
        unsaved: composition.unsaved ?? null,
        sceneFilePath: composition.sceneFilePath ?? null,
        compositionOk,
        scenePathOk,
        verification: {
          ok: verification.ok,
          layerCount: verification.layerCount,
          expectedCount: verification.expectedCount,
          missing: verification.missing,
          duplicated: verification.duplicated,
          timingMismatches: verification.timingMismatches,
          unknownLayers: verification.unknownLayers,
          auxiliaryLayerCount: verification.auxiliaryLayers.length
        },
        mcpServer: { name: discovery.server?.name ?? null, version: discovery.server?.version ?? null }
      };
      if (!sceneReopen.ok) {
        limitations.push('Reopening the saved scene did not fully reproduce the verified scene state; see checks.sceneReopen.');
      }

      // Render one frame again from the reopened project and compare it with the
      // frame the render manifest recorded. A mismatch means the saved project no
      // longer reproduces the exported video, even though the file hashes match.
      const frame = plan.shots[0].startFrame;
      const basePath = path.join(runDirectory, `reopen-frame-${String(frame).padStart(3, '0')}`);
      const rendered = await adapter.renderFrame({ frame, basePath, scalePercent: config.render?.scalePercent ?? 100, timeoutMs: renderTimeoutMs });
      const freshRecord = await fileRecord(`${basePath}.png`);
      const manifestFrame = renderManifest.frames[frame];
      const freshBytes = await fs.readFile(freshRecord.path);
      const manifestBytes = await fs.readFile(manifestFrame.path);
      const comparison = comparePngs(freshBytes, manifestBytes);
      const withinTolerance = comparison.comparable
        && comparison.mae !== null && comparison.mae <= FRAME_REPRODUCTION_TOLERANCE.mae
        && comparison.maxChannelDelta !== null && comparison.maxChannelDelta <= FRAME_REPRODUCTION_TOLERANCE.maxChannelDelta;
      frameReproduction = {
        frame,
        path: freshRecord.path,
        sha256: freshRecord.sha256,
        manifestPath: manifestFrame.path,
        manifestSha256: manifestFrame.sha256,
        identical: freshRecord.sha256 === manifestFrame.sha256,
        comparison,
        tolerance: FRAME_REPRODUCTION_TOLERANCE,
        ok: withinTolerance,
        renderedAtFrame: rendered.value?.frame ?? null
      };
      if (!withinTolerance) {
        limitations.push('The re-rendered first frame differs from the frame recorded in the render manifest beyond the tight tolerance; the saved project may not reproduce the exported video exactly.');
      }
    } finally {
      await adapter.close().catch(() => undefined);
    }

    const versions = {
      export: EXPORT_VERSION,
      planner: plan.planner?.version ?? null,
      adapter: plan.planner?.adapterVersion ?? null,
      build: buildState.buildVersion ?? null,
      node: process.version,
      ffmpeg: await ffmpegVersion(ffmpeg, ['-version'], 20_000),
      ffprobe: await ffmpegVersion(ffprobe, ['-version'], 20_000)
    };

    const checks = {
      filesVerified: true,
      videoDecoded: { ok: decodedOk, ...decoded },
      sceneReopen,
      frameReproduction,
      ok: decodedOk && sceneReopen.ok && frameReproduction.ok
    };
    const status = checks.ok ? (qaReport.status === 'pass' ? 'verified' : 'needs_review') : 'failed';

    limitations.push(
      'Export copies verified artifacts; it does not rerun visual QA. The QA status is carried from the referenced report.',
      'The final video is an H.264 encode of the verified PNG frame sequence; the lossless frames remain in the render directory.',
      'QA thresholds are provisional and uncalibrated; a needs_review status means a human must accept the documented differences.',
      'Approximations and unresolved measurements are carried from the plan and the QA report rather than re-verified here; an approximation is never a measurement.'
    );
    if (qaReport.status !== 'pass') {
      limitations.push(`QA status is ${qaReport.status}; inspect ${qaReportPath} and the comparison images before treating this export as approved.`);
    }

    const manifest = {
      schemaVersion: 1,
      exportVersion: EXPORT_VERSION,
      status,
      createdAt: new Date().toISOString(),
      sourceHash: plan.sourceHash,
      reference: { path: options.referencePath ? absolutePath(options.referencePath) : (config.reference ?? null), sha256: plan.sourceHash },
      plan: { path: resolvedPlanPath, sha256: await hashFile(resolvedPlanPath) },
      project: { path: projectRecord.path, sha256: projectRecord.sha256, copyPath: projectCopy.path, copySha256: projectCopy.sha256 },
      render: { manifestPath: renderManifestRecord.path, manifestSha256: renderManifestRecord.sha256, frameCount: renderManifest.frames.length, verified: renderManifest.status === 'verified' },
      qa: {
        reportPath: qaReportRecord.path,
        reportSha256: qaReportRecord.sha256,
        status: qaReport.status,
        shots: summaryShots(qaReport),
        discrepancyCount: qaReport.discrepancies.length,
        discrepancyIds: qaReport.discrepancies.map(item => item.id)
      },
      video: {
        sourcePath: videoRecord.path,
        sourceSha256: videoRecord.sha256,
        path: finalVideo.path,
        sha256: finalVideo.sha256,
        bytes: finalVideo.bytes ?? (await fs.stat(finalVideo.path)).size
      },
      evidence,
      checks,
      versions,
      limitations
    };
    await validateArtifact('final-export', manifest);
    const manifestPath = path.join(runDirectory, 'final-export.json');
    await writeJsonNew(manifestPath, manifest);
    const markdownPath = path.join(runDirectory, 'final-export.md');
    await fs.writeFile(markdownPath, exportMarkdown(manifest, { plan, qaReport }), { flag: 'wx' });
    const state = {
      key, version: EXPORT_VERSION, status, runDirectory, manifestPath, markdownPath,
      projectPath: projectRecord.path, projectSha256: projectRecord.sha256,
      renderManifestPath: renderManifestRecord.path, renderManifestSha256: renderManifestRecord.sha256,
      qaReportPath: qaReportRecord.path, qaReportSha256: qaReportRecord.sha256,
      videoPath: finalVideo.path, videoSha256: finalVideo.sha256,
      updatedAt: new Date().toISOString()
    };
    await writeJsonState(path.join(directory, 'index.json'), state);
    return { ...state, manifest, qaStatus: qaReport.status, checks };
  });
}

function exportMarkdown(manifest, { plan, qaReport }) {
  const lines = [];
  lines.push(`# Final export — ${manifest.status}`, '');
  lines.push(`- Created: ${manifest.createdAt}`);
  lines.push(`- Source hash: \`${manifest.sourceHash}\``);
  lines.push(`- Final video: \`${manifest.video.path}\` (sha256 \`${manifest.video.sha256}\`, ${manifest.video.bytes} bytes)`);
  lines.push(`- Saved scene copy: \`${manifest.project.copyPath}\` (sha256 \`${manifest.project.copySha256}\`)`);
  lines.push(`- QA status: **${manifest.qa.status}** (${manifest.qa.discrepancyCount} discrepancy record(s))`);
  lines.push('');
  lines.push('## Checks', '');
  lines.push(`- Frame hashes verified: ${manifest.checks.filesVerified ? 'yes' : 'no'}`);
  lines.push(`- Decoded video: ${manifest.checks.videoDecoded.codec} ${manifest.checks.videoDecoded.width}x${manifest.checks.videoDecoded.height}, ${manifest.checks.videoDecoded.decodedFrames} decoded frames at ${manifest.checks.videoDecoded.avgFrameRate} fps`);
  lines.push(`- Scene reopen: ${manifest.checks.sceneReopen.ok ? 'verified' : 'MISMATCH'} (layers ${manifest.checks.sceneReopen.verification.layerCount}/${manifest.checks.sceneReopen.verification.expectedCount}, missing ${manifest.checks.sceneReopen.verification.missing.length}, duplicated ${manifest.checks.sceneReopen.verification.duplicated.length}, timing mismatches ${manifest.checks.sceneReopen.verification.timingMismatches.length})`);
  lines.push(`- Re-rendered frame ${manifest.checks.frameReproduction.frame}: ${manifest.checks.frameReproduction.ok ? 'reproduced' : 'DIFFERS'} (identical sha: ${manifest.checks.frameReproduction.identical}, MAE ${manifest.checks.frameReproduction.comparison.mae}, max delta ${manifest.checks.frameReproduction.comparison.maxChannelDelta})`);
  lines.push('');
  lines.push('## Visual QA carried forward', '');
  lines.push('| Shot | Status | MAE mean | SSIM mean | Ink IoU mean |');
  lines.push('|---|---|---|---|---|');
  for (const shot of manifest.qa.shots) {
    const metric = name => shot.metrics?.[name] === null || shot.metrics?.[name] === undefined ? '—' : shot.metrics[name];
    lines.push(`| ${shot.shotId} | ${shot.status} | ${metric('maeMean')} | ${metric('ssimMean')} | ${metric('inkIouMean')} |`);
  }
  lines.push('');
  lines.push('## Versions', '');
  for (const [name, value] of Object.entries(manifest.versions)) lines.push(`- ${name}: ${value ?? 'not reported'}`);
  lines.push('');
  lines.push('## Limitations', '');
  for (const limitation of manifest.limitations) lines.push(`- ${limitation}`);
  lines.push('');
  lines.push('The QA report and comparison images are the fidelity evidence; this manifest records provenance, not a visual match.');
  return lines.join('\n');
}
