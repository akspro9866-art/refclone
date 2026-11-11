import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, fileRecord, hashFile, hashObject, readJson, runProcess,
  validateArtifact, withJobLock, writeJsonNew, writeJsonState
} from '../core.mjs';
import { deriveJobDirectory } from '../design/assets.mjs';
import { buildPatchPlan, editListKey, resolveEditListFile } from '../design/edit-list.mjs';
import { CavalryAdapter } from '../cavalry/cavalry.mjs';

export const RENDER_VERSION = '1.0.0';

const DEFAULT_RENDER_TIMEOUT_MS = 60_000;

function paddedWidth(totalFrames) {
  return Math.max(3, String(totalFrames - 1).length);
}

function shotForFrame(plan, frame) {
  const shot = plan.shots.find(candidate => frame >= candidate.startFrame && frame < candidate.endFrameExclusive);
  if (!shot) throw new WorkflowError('RENDER_FRAME_UNMAPPED', `Frame ${frame} belongs to no planned shot.`, { frame });
  return shot.id;
}

/**
 * Render one frame to `<framesDir>/frame-<n>.png` through the verified numbered
 * PNG route. An existing non-empty PNG with the expected dimensions is reused, so
 * an interrupted sequence resumes instead of re-rendering everything.
 */
async function renderOneFrame(adapter, { frame, framesDirectory, padding, width, height, scalePercent, timeoutMs }) {
  const base = path.join(framesDirectory, `frame-${String(frame).padStart(padding, '0')}`);
  const target = `${base}.png`;
  try {
    const stat = await fs.stat(target);
    if (stat.size > 0) {
      const record = await fileRecord(target);
      return { frame, path: record.path, sha256: record.sha256, bytes: stat.size, reused: true };
    }
    await fs.unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new WorkflowError('RENDER_FRAME_STAT_FAILED', 'Cannot inspect the render target.', { target, reason: error.code });
  }
  const result = await adapter.renderFrame({ frame, basePath: base, scalePercent, timeoutMs });
  if (result.ok !== true) {
    throw new WorkflowError('RENDER_FRAME_FAILED', `Frame ${frame} did not report a written file.`, { frame, result: result.value });
  }
  const record = await fileRecord(target);
  const bytes = await fs.readFile(target);
  if (bytes.length === 0) throw new WorkflowError('RENDER_FRAME_EMPTY', `Frame ${frame} rendered an empty file.`, { target });
  const png = PNG.sync.read(bytes);
  if (png.width !== width || png.height !== height) {
    throw new WorkflowError('RENDER_FRAME_DIMENSION_MISMATCH', `Frame ${frame} is ${png.width}x${png.height}, expected ${width}x${height}.`, {
      target, actual: { width: png.width, height: png.height }
    });
  }
  return { frame, path: record.path, sha256: record.sha256, bytes: bytes.length, reused: false };
}

async function probeVideo(ffprobe, videoPath, { timeoutMs }) {
  const common = ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,codec_type,width,height,nb_frames,avg_frame_rate,r_frame_rate,pix_fmt,duration:format=duration,nb_streams',
    '-of', 'json'];
  const info = await runProcess(ffprobe, [...common, videoPath], { timeoutMs });
  const counted = await runProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'json', videoPath], { timeoutMs });
  const parsed = value => {
    try {
      return JSON.parse(value);
    } catch {
      throw new WorkflowError('PROBE_OUTPUT_INVALID', 'FFprobe did not return JSON.', { output: String(value).slice(0, 400) });
    }
  };
  return { metadata: parsed(info.stdout), decoded: parsed(counted.stdout) };
}

function validateVideoAgainstPlan(probe, plan, videoPath, expectedFrames = plan.project.totalFrames) {
  const errors = [];
  const stream = probe.metadata?.streams?.[0] ?? null;
  if (!stream) return [`No video stream decoded from ${videoPath}.`];
  const expectedFps = plan.project.fps;
  if (stream.codec_type !== 'video') errors.push(`Stream codec_type is ${stream.codec_type}.`);
  if (stream.width !== plan.project.width || stream.height !== plan.project.height) {
    errors.push(`Encoded raster is ${stream.width}x${stream.height}, expected ${plan.project.width}x${plan.project.height}.`);
  }
  if (stream.r_frame_rate !== `${expectedFps.num}/${expectedFps.den}`) {
    errors.push(`Stream rate is ${stream.r_frame_rate}, expected ${expectedFps.num}/${expectedFps.den}.`);
  }
  const decoded = Number(probe.decoded?.streams?.[0]?.nb_read_frames ?? NaN);
  if (decoded !== expectedFrames) errors.push(`Decoder produced ${decoded} frames, expected ${expectedFrames}.`);
  const declared = Number(stream.nb_frames ?? NaN);
  if (Number.isFinite(declared) && declared !== expectedFrames) errors.push(`Container declares ${declared} frames, expected ${expectedFrames}.`);
  const duration = Number(stream.duration ?? probe.metadata?.format?.duration ?? NaN);
  const expectedSeconds = expectedFrames * expectedFps.den / expectedFps.num;
  if (Number.isFinite(duration) && Math.abs(duration - expectedSeconds) > 1 / expectedFps.num) {
    errors.push(`Duration ${duration}s differs from ${expectedSeconds}s by more than one frame.`);
  }
  return errors;
}

/**
 * Render the planned frame sequence from a saved scene and encode it.
 *
 * Frames are written as numbered PNGs by Cavalry itself, verified by decode and
 * hash, encoded with FFmpeg and re-validated with FFprobe. A prior partial
 * sequence is resumed, and a finished video is never overwritten: each run writes
 * a new versioned output inside the job.
 */
export async function renderVideo(planPath, options = {}) {
  const resolvedPlanPath = absolutePath(planPath);
  const plan = await readJson(resolvedPlanPath);
  await validateArtifact('scene-plan', plan);
  if (options.expectExecutable === true && plan.validation.executable !== true) {
    throw new WorkflowError('PLAN_NOT_EXECUTABLE', 'Rendering requires an executable scene plan.', { planPath: resolvedPlanPath });
  }
  if (!options.projectPath) throw new WorkflowError('RENDER_PROJECT_REQUIRED', 'renderVideo requires the saved scene path.');
  const projectPath = absolutePath(options.projectPath);
  const project = await fileRecord(projectPath);
  const config = options.config ?? await readJson(absolutePath(options.configPath ?? fileURLToPath(new URL('../../config.json', import.meta.url))));
  const renderConfig = config.render ?? {};
  const ffmpeg = options.ffmpeg ?? config.ffmpeg ?? 'ffmpeg';
  const ffprobe = options.ffprobe ?? config.ffprobe ?? 'ffprobe';
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(resolvedPlanPath);
  const renderedShots = options.shot ? plan.shots.filter(shot => shot.id === options.shot) : plan.shots;
  if (renderedShots.length === 0) {
    throw new WorkflowError('RENDER_SHOT_NOT_FOUND', `No planned shot with id ${options.shot}.`, { shot: options.shot });
  }
  // Optional edit-list layer: resolving it binds the render to the film's entries. A
  // changed-entry list yields the keyframe window a single-shot patch has to redraw;
  // a multi-window patch needs segment splicing and is refused here rather than
  // silently re-encoded as one contiguous clip.
  const resolvedEdit = options.editListPath
    ? await resolveEditListFile(options.editListPath, { sourceDurations: options.editSourceDurations })
    : null;
  const patchPlan = resolvedEdit && options.changedEntryIds?.length
    ? await buildPatchPlan(resolvedEdit, options.changedEntryIds, { keyframes: options.keyframes })
    : null;
  if (patchPlan?.refused) {
    throw new WorkflowError('RENDER_PATCH_REFUSED', `The single-shot patch was refused: ${patchPlan.refused.reason}.`, {
      entryIds: options.changedEntryIds
    });
  }
  if (patchPlan && patchPlan.windows.length > 1) {
    throw new WorkflowError('RENDER_PATCH_MULTI_WINDOW',
      'A single-shot patch must fall inside one keyframe window; patch one changed entry at a time.', {
      windows: patchPlan.windows
    });
  }
  let frames;
  if (options.frames) frames = options.frames;
  else if (patchPlan) frames = Array.from({ length: patchPlan.windows[0].B - patchPlan.windows[0].A }, (_, index) => patchPlan.windows[0].A + index);
  else frames = renderedShots.flatMap(shot =>
    Array.from({ length: shot.endFrameExclusive - shot.startFrame }, (_, index) => shot.startFrame + index));
  const scalePercent = options.scalePercent ?? renderConfig.scalePercent ?? 100;
  const key = hashObject({
    version: RENDER_VERSION, planSha256: await hashFile(resolvedPlanPath), projectSha256: project.sha256,
    frames: frames.length, scalePercent, encoder: { ffmpeg, crf: renderConfig.crf ?? 18, preset: renderConfig.preset ?? 'medium' },
    fps: plan.project.fps, resolution: { width: plan.project.width, height: plan.project.height },
    edit: resolvedEdit ? editListKey(resolvedEdit) : null,
    patch: patchPlan ? hashObject(patchPlan) : null
  });
  const directory = path.join(jobDirectory, 'render', key);
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    let prior = null;
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && cached.projectSha256 === project.sha256) prior = cached;
    } catch { /* No prior sequence: this run renders from frame zero. */ }
    const outputDirectory = prior?.runDirectory ? absolutePath(prior.runDirectory) : runDirectory;
    const framesDirectory = path.join(outputDirectory, 'frames');
    await fs.mkdir(framesDirectory, { recursive: true });
    // The resolved edit list and the patch window are evidence for this run: written
    // once per run directory, never replacing an existing record.
    let editResolvedPath = null;
    let patchPlanPath = null;
    if (resolvedEdit) {
      editResolvedPath = absolutePath(path.join(outputDirectory, 'edit.resolved.json'));
      await writeJsonNew(editResolvedPath, resolvedEdit).catch(error => { if (error.code !== 'FILE_EXISTS') throw error; });
    }
    if (patchPlan) {
      patchPlanPath = absolutePath(path.join(outputDirectory, 'patch-plan.json'));
      await writeJsonNew(patchPlanPath, patchPlan).catch(error => { if (error.code !== 'FILE_EXISTS') throw error; });
    }
    if (!prior) {
      // Reserve this directory in the cache before the first frame is written, so
      // a crash mid-sequence resumes here instead of leaving orphaned frames.
      await writeJsonState(cachePath, {
        key, version: RENDER_VERSION, runDirectory: outputDirectory, projectPath, projectSha256: project.sha256,
        status: 'partial', frames: [], updatedAt: new Date().toISOString()
      });
    }
    const padding = paddedWidth(Math.max(...frames) + 1);
    const adapter = new CavalryAdapter(config.mcp);
    const rendered = [];
    const errors = [];
    let sequenceResumedFrom = prior?.frames?.length ?? 0;
    try {
      await adapter.start();
      const live = await adapter.readScene();
      if (String(live.value?.sceneFilePath ?? '').toLowerCase() !== projectPath.toLowerCase()) {
        await adapter.openProject(projectPath);
      } else if (live.value?.unsaved === true) {
        throw new WorkflowError('RENDER_SCENE_DIRTY',
          'The live scene has unsaved changes and is the render target; save or reopen the intended scene first.', { projectPath });
      }
      const composition = await adapter.getComposition();
      const actual = composition.value;
      if (actual?.resolution?.x !== plan.project.width || actual?.resolution?.y !== plan.project.height || actual?.fps !== plan.project.fps.num / plan.project.fps.den) {
        throw new WorkflowError('RENDER_COMPOSITION_MISMATCH', 'The live composition differs from the plan.', {
          expected: plan.project, actual: { width: actual?.resolution?.x, height: actual?.resolution?.y, fps: actual?.fps }
        });
      }
      for (const frame of frames) {
        const record = await renderOneFrame(adapter, {
          frame, framesDirectory, padding, width: plan.project.width, height: plan.project.height,
          scalePercent, timeoutMs: renderConfig.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS
        });
        rendered.push({ ...record, timeSeconds: frame * plan.project.fps.den / plan.project.fps.num, shotId: shotForFrame(plan, frame) });
        if (rendered.length % 24 === 0) {
          await writeJsonState(cachePath, {
            key, version: RENDER_VERSION, runDirectory: outputDirectory, projectPath, projectSha256: project.sha256,
            status: 'partial', frames: rendered, updatedAt: new Date().toISOString()
          });
        }
      }
      const restore = await adapter.setFrame(plan.shots[0].startFrame);
      const encoded = await encodeSequence({
        ffmpeg, framesDirectory, padding, frames, plan, renderConfig, outputDirectory
      });
      let probe = null;
      if (encoded) {
        probe = await probeVideo(ffprobe, encoded.path, { timeoutMs: renderConfig.processTimeoutMs ?? 300_000 });
        const videoErrors = validateVideoAgainstPlan(probe, plan, encoded.path, frames.length);
        for (const message of videoErrors) errors.push({ code: 'VIDEO_VALIDATION_FAILED', message });
      }
      // A patch window is verified evidence for those frames only: the manifest is
      // marked partial so QA never mistakes it for a full, spliced final.
      const manifestStatus = errors.length ? 'failed' : patchPlan ? 'partial' : 'verified';
      const manifest = {
        schemaVersion: 1, sourceHash: plan.sourceHash, projectPath, projectSha256: project.sha256,
        fps: { num: plan.project.fps.num, den: plan.project.fps.den },
        width: plan.project.width, height: plan.project.height,
        frames: rendered.map(frame => ({ frame: frame.frame, timeSeconds: frame.timeSeconds, path: frame.path, sha256: frame.sha256, shotId: frame.shotId })),
        video: encoded ? { path: encoded.path, sha256: encoded.sha256, validated: errors.length === 0 } : null,
        status: manifestStatus,
        errors
      };
      await validateArtifact('render-manifest', manifest);
      const manifestPath = path.join(outputDirectory, 'render-manifest.json');
      await writeJsonState(manifestPath, manifest);
      const markdownPath = path.join(outputDirectory, 'render-report.md');
      await fs.writeFile(markdownPath, renderMarkdown(manifest, { plan, probe, encoded, sequenceResumedFrom, restoreFrame: restore.value?.frame ?? null }));
      const state = {
        key, version: RENDER_VERSION, runDirectory: outputDirectory, projectPath, projectSha256: project.sha256,
        status: manifestStatus, frames: rendered, video: encoded, manifestPath, markdownPath,
        ...(resolvedEdit ? { edit: { editListPath: absolutePath(options.editListPath), resolvedPath: editResolvedPath, frames: resolvedEdit.frames, slates: resolvedEdit.slates } } : {}),
        ...(patchPlan ? { patch: { planPath: patchPlanPath, changedEntryIds: patchPlan.changedEntryIds, windows: patchPlan.windows } } : {}),
        errors, updatedAt: new Date().toISOString()
      };
      await writeJsonState(cachePath, state);
      return { ...state, reused: Boolean(prior), encodedFrames: rendered.filter(frame => !frame.reused).length };
    } catch (error) {
      const partial = {
        key, version: RENDER_VERSION, runDirectory: outputDirectory, projectPath, projectSha256: project.sha256,
        status: 'partial', frames: rendered, video: null, error: error.toJSON ? error.toJSON() : { code: 'UNEXPECTED', message: error.message },
        updatedAt: new Date().toISOString()
      };
      await writeJsonState(cachePath, partial).catch(() => undefined);
      throw error;
    } finally {
      await adapter.close();
    }
  });
}

async function encodeSequence({ ffmpeg, framesDirectory, padding, frames, plan, renderConfig, outputDirectory }) {
  const first = Math.min(...frames);
  const last = Math.max(...frames);
  const contiguous = last - first + 1 === frames.length;
  if (!contiguous) {
    throw new WorkflowError('RENDER_SEQUENCE_NONCONTIGUOUS', 'Encoding needs a contiguous frame range; render the full sequence first.', {
      first, last, count: frames.length
    });
  }
  // Every encode writes a new file: a finished video is never replaced in place.
  const target = path.join(outputDirectory,
    `recreation-${String(plan.inputHashes?.plan ?? plan.sourceHash).slice(0, 8)}-${randomUUID().slice(0, 8)}.mp4`);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin',
    '-framerate', `${plan.project.fps.num}/${plan.project.fps.den}`,
    '-start_number', String(first),
    '-i', path.join(framesDirectory, `frame-%0${padding}d.png`),
    '-frames:v', String(frames.length),
    '-c:v', renderConfig.codec ?? 'libx264',
    '-preset', renderConfig.preset ?? 'medium',
    '-crf', String(renderConfig.crf ?? 18),
    '-pix_fmt', renderConfig.pixelFormat ?? 'yuv420p',
    '-movflags', '+faststart',
    '-y', target
  ];
  const result = await runProcess(ffmpeg, args, { timeoutMs: renderConfig.processTimeoutMs ?? 300_000 });
  if (result.exitCode !== 0) {
    throw new WorkflowError('ENCODE_FAILED', 'FFmpeg failed to encode the rendered sequence.', {
      exitCode: result.exitCode, stderr: String(result.stderr ?? '').slice(-1_200), target
    });
  }
  const record = await fileRecord(target);
  const stat = await fs.stat(target);
  return { path: record.path, sha256: record.sha256, bytes: stat.size, tool: ffmpeg };
}

function renderMarkdown(manifest, context) {
  const lines = [];
  lines.push('# Render report', '');
  lines.push(`- Status: **${manifest.status}**`);
  lines.push(`- Scene: \`${manifest.projectPath}\` (sha256 \`${manifest.projectSha256}\`)`);
  lines.push(`- Frames rendered: ${manifest.frames.length} at ${manifest.fps.num}/${manifest.fps.den} fps, ${manifest.width}x${manifest.height}`);
  lines.push(`- Sequence resumed after ${context.sequenceResumedFrom} already-recorded frame(s).`);
  lines.push(`- Playhead restored to frame ${context.restoreFrame ?? '—'}.`);
  if (manifest.video) lines.push(`- Video: \`${manifest.video.path}\` (sha256 \`${manifest.video.sha256}\`, validated: ${manifest.video.validated})`);
  if (context.probe) {
    const stream = context.probe.metadata?.streams?.[0] ?? {};
    lines.push('', '## Decoded validation', '');
    lines.push(`- Codec ${stream.codec_name}, pixel format ${stream.pix_fmt}, rate ${stream.r_frame_rate}.`);
    lines.push(`- Decoder frame count: ${context.probe.decoded?.streams?.[0]?.nb_read_frames ?? 'not reported'}.`);
  }
  if (manifest.errors.length) {
    lines.push('', '## Errors', '');
    for (const error of manifest.errors) lines.push(`- ${error.code}: ${error.message}`);
  }
  lines.push('', '## Notes', '');
  lines.push('- Frames come from Cavalry itself through the numbered PNG route; no offline re-simulation is involved.');
  lines.push('- A rerun into the same render key reuses verified PNG files instead of re-rendering them.');
  return lines.join('\n');
}
