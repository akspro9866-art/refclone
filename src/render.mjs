import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, fileRecord, hashFile, hashObject, readJson, runProcess,
  validateArtifact, withJobLock, writeJsonState
} from './core.mjs';
import { deriveJobDirectory } from './assets.mjs';
import { CavalryAdapter } from './cavalry.mjs';

export const RENDER_VERSION = '1.1.0';

const DEFAULT_RENDER_TIMEOUT_MS = 60_000;

/** A selection this large is a typo or a hostile input, not a render request. */
const MAX_FRAME_SELECTION = 100_000;

function paddedWidth(totalFrames) {
  return Math.max(3, String(totalFrames - 1).length);
}

/** Every frame the plan covers, in timeline order, optionally narrowed to one shot. */
export function plannedFrames(plan, shotId) {
  const shots = shotId ? plan.shots.filter(shot => shot.id === shotId) : plan.shots;
  return shots.flatMap(shot =>
    Array.from({ length: shot.endFrameExclusive - shot.startFrame }, (_, index) => shot.startFrame + index));
}

/**
 * The frame list a render request actually means: the selection parsed from
 * `--frames`, or every frame of the shot(s) being rendered — checked against the
 * plan so no frame is discovered unmapped halfway through an expensive sequence.
 */
export function resolveFrames(plan, options = {}) {
  const shots = options.shot ? plan.shots.filter(shot => shot.id === options.shot) : plan.shots;
  if (shots.length === 0) {
    throw new WorkflowError('RENDER_SHOT_NOT_FOUND', `No planned shot with id ${options.shot}.`, { shot: options.shot });
  }
  const frames = options.frames === undefined || options.frames === null || options.frames === ''
    ? plannedFrames(plan, options.shot)
    : parseFrameSpec(options.frames);
  if (frames.length === 0) {
    throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', `Frame selection "${options.frames}" selects nothing.`, { spec: String(options.frames) });
  }
  if (frames.length > MAX_FRAME_SELECTION) {
    throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', `Frame selection expands to ${frames.length} frames, over the ${MAX_FRAME_SELECTION}-frame limit.`, {
      spec: String(options.frames), count: frames.length, limit: MAX_FRAME_SELECTION
    });
  }
  const unmapped = frames.filter(frame =>
    !shots.some(shot => frame >= shot.startFrame && frame < shot.endFrameExclusive));
  if (unmapped.length > 0) {
    throw new WorkflowError('RENDER_FRAME_UNMAPPED', `${unmapped.length} requested frame(s) belong to no rendered shot.`, {
      frames: unmapped.slice(0, 20),
      shots: shots.map(shot => ({ id: shot.id, startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive }))
    });
  }
  return { shots, frames };
}

/**
 * Parse a frame selection: "28:60" or "28-60" (both inclusive), an optional stride
 * ("0:215:12"), and a comma-separated mix of single frames and ranges
 * ("0,28-60:4,215"). Returns sorted, de-duplicated integers.
 */
export function parseFrameSpec(spec) {
  const text = typeof spec === 'string' ? spec.trim() : String(spec ?? '').trim();
  if (!text) throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', 'A frame selection cannot be empty.');
  const integer = value => (/^\d+$/.test(value) ? Number(value) : Number.NaN);
  const selected = new Set();
  for (const part of text.split(',')) {
    const piece = part.replace(/\s+/g, '');
    if (!piece) throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', `Empty term in frame selection "${text}".`, { spec: text });
    const range = piece.match(/^(\d+)(?:[:\-])(\d+)(?:[:\-](\d+))?$/);
    if (range) {
      const [, rawFirst, rawLast, rawStride] = range;
      const first = integer(rawFirst);
      const last = integer(rawLast);
      const stride = rawStride === undefined ? 1 : integer(rawStride);
      if (!(last >= first)) {
        throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', `Frame range "${piece}" runs backwards; use "first:last".`, { spec: text, first, last });
      }
      if (!(stride >= 1)) throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', `Frame stride in "${piece}" must be a positive integer.`, { spec: text });
      if (last - first + 1 > MAX_FRAME_SELECTION) {
        throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', `Frame range "${piece}" is wider than the ${MAX_FRAME_SELECTION}-frame limit.`, {
          spec: text, limit: MAX_FRAME_SELECTION
        });
      }
      for (let frame = first; frame <= last; frame += stride) selected.add(frame);
      continue;
    }
    const single = integer(piece);
    if (!Number.isInteger(single)) throw new WorkflowError('RENDER_FRAME_SPEC_INVALID', `"${piece}" is not a frame or an inclusive "first:last" range.`, { spec: text });
    selected.add(single);
  }
  return [...selected].sort((a, b) => a - b);
}

/**
 * Cache-key identity of a frame list: how many frames and which contiguous runs.
 * A range must never share a render directory with the full sequence, because the
 * manifest written there describes one specific frame set.
 */
export function frameListSignature(frames) {
  if (frames.length === 0) return { count: 0, runs: '' };
  const runs = [];
  let start = frames[0];
  let previous = frames[0];
  const flush = () => runs.push(start === previous ? `${start}` : `${start}-${previous}`);
  for (const frame of frames.slice(1)) {
    if (frame === previous + 1) { previous = frame; continue; }
    flush();
    start = previous = frame;
  }
  flush();
  return { count: frames.length, runs: runs.join(',') };
}

/**
 * The single authoritative render cache key. run.mjs imports this instead of
 * keeping a second copy of the formula, so the runner and the stage cannot drift
 * and point at different directories for the same work.
 */
export function renderCacheKey(plan, planSha256, projectSha256, config, frames = plannedFrames(plan)) {
  const renderConfig = config.render ?? {};
  const ffmpeg = config.ffmpeg ?? 'ffmpeg';
  return hashObject({
    version: RENDER_VERSION, planSha256, projectSha256, frames: frameListSignature(frames),
    scalePercent: renderConfig.scalePercent ?? 100,
    encoder: { ffmpeg, crf: renderConfig.crf ?? 18, preset: renderConfig.preset ?? 'medium' },
    fps: plan.project.fps, resolution: { width: plan.project.width, height: plan.project.height }
  });
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
  // Resolve and validate the frame selection first: a bad selection is a request
  // error, and it should be reported before the scene file or the bridge is touched.
  const { frames } = resolveFrames(plan, options);
  if (!options.projectPath) throw new WorkflowError('RENDER_PROJECT_REQUIRED', 'renderVideo requires the saved scene path.');
  const projectPath = absolutePath(options.projectPath);
  const project = await fileRecord(projectPath);
  const config = options.config ?? await readJson(absolutePath(options.configPath ?? fileURLToPath(new URL('../config.json', import.meta.url))));
  const renderConfig = config.render ?? {};
  const ffmpeg = options.ffmpeg ?? config.ffmpeg ?? 'ffmpeg';
  const ffprobe = options.ffprobe ?? config.ffprobe ?? 'ffprobe';
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(resolvedPlanPath);
  const scalePercent = options.scalePercent ?? renderConfig.scalePercent ?? 100;
  const key = renderCacheKey(plan, await hashFile(resolvedPlanPath), project.sha256, config, frames);
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
    if (!prior) {
      // Reserve this directory in the cache before the first frame is written, so
      // a crash mid-sequence resumes here instead of leaving orphaned frames.
      await writeJsonState(cachePath, {
        key, version: RENDER_VERSION, runDirectory: outputDirectory, projectPath, projectSha256: project.sha256,
        status: 'partial', frames: [], updatedAt: new Date().toISOString()
      });
    }
    // Width comes from the plan, not the selection, so a partial range and the
    // full sequence name the same frame identically (frame-028.png, not frame-28).
    const padding = paddedWidth(plan.project.totalFrames);
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
      // Frames are ascending, so the ends of the list are its bounds.
      const low = frames[0];
      const high = frames[frames.length - 1];
      let encoded = null;
      if (high - low + 1 === frames.length) {
        encoded = await encodeSequence({ ffmpeg, framesDirectory, padding, frames, plan, renderConfig, outputDirectory });
      } else {
        // A sparse selection is still a verified set of frames; refuse to encode
        // rather than silently encoding the whole gap between the first and last.
        errors.push({
          code: 'RENDER_SEQUENCE_NONCONTIGUOUS',
          message: `Frame selection covers ${frameListSignature(frames).runs}; encoding needs one contiguous run. Verified frames are kept, no video was encoded.`
        });
      }
      let probe = null;
      if (encoded) {
        probe = await probeVideo(ffprobe, encoded.path, { timeoutMs: renderConfig.processTimeoutMs ?? 300_000 });
        const videoErrors = validateVideoAgainstPlan(probe, plan, encoded.path, frames.length);
        for (const message of videoErrors) errors.push({ code: 'VIDEO_VALIDATION_FAILED', message });
      }
      const onlySparse = errors.length > 0 && errors.every(error => error.code === 'RENDER_SEQUENCE_NONCONTIGUOUS');
      const manifestStatus = errors.length === 0 ? 'verified' : (onlySparse ? 'partial' : 'failed');
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
      await fs.writeFile(markdownPath, renderMarkdown(manifest, {
        plan, probe, encoded, sequenceResumedFrom, restoreFrame: restore.value?.frame ?? null,
        frameSelection: frameListSignature(frames)
      }));
      const state = {
        key, version: RENDER_VERSION, runDirectory: outputDirectory, projectPath, projectSha256: project.sha256,
        status: manifestStatus, frames: rendered, video: encoded, manifestPath, markdownPath,
        errors, updatedAt: new Date().toISOString()
      };
      await writeJsonState(cachePath, state);
      return {
        ...state, reused: Boolean(prior), encodedFrames: rendered.filter(frame => !frame.reused).length,
        frameSelection: frameListSignature(frames)
      };
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
  const first = frames[0];
  const last = frames[frames.length - 1];
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
  lines.push(`- Frame selection: ${context.frameSelection.count} frame(s), runs \`${context.frameSelection.runs}\`.`);
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
