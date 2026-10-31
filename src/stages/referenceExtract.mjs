// Auto reference extraction for the procedural route.
//
// Stage 5 compares sparse renders against reference frames. When the procedural input
// is a video and no --reference was supplied, this module extracts exactly the Stage 1
// beat inflection frames (inFrame + 1, peakFrame, outFrame - 1) with FFmpeg and returns
// the frame -> path map the perceptual gate consumes. No frame is guessed: the selector
// uses decoded frame ordinals, so the map stays aligned with the beat indices Stage 1
// measured, and a count mismatch is a named error rather than a silently short map.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { runProcess, WorkflowError } from '../core.mjs';
import { sparseBeatFrames } from './perceptualDiff.mjs';

export const REFERENCE_EXTRACT_VERSION = '1.0.0';
export const VIDEO_EXTENSIONS = Object.freeze(['.mp4', '.mov', '.webm', '.mkv']);

export function isVideoInput(filePath) {
  return VIDEO_EXTENSIONS.includes(path.extname(String(filePath ?? '')).toLowerCase());
}

function padFrame(frame) {
  return String(frame).padStart(6, '0');
}

/**
 * Extract the sparse beat frames of `beats` from a video into PNG files.
 *
 * outputDirectory: a directory to create exclusively (parent must exist or be
 *   creatable). Omit it to use a fresh temporary directory; `temporary: true` marks
 *   that the caller should report the frames as transient.
 * Returns { version, source, directory, temporary, frameCount, map, limitations }.
 * `map` is a plain object keyed by frame number (JSON-safe) with absolute paths.
 */
export async function extractReferenceFrames({ video, beats, outputDirectory = null, ffmpeg = 'ffmpeg', timeoutMs = 120000 } = {}) {
  if (typeof video !== 'string' || video === '') {
    throw new WorkflowError('REFERENCE_EXTRACT_INVALID', 'Auto reference extraction needs a video path.', {});
  }
  const source = path.resolve(video);
  const frames = sparseBeatFrames(beats);
  if (frames.length === 0) {
    throw new WorkflowError('REFERENCE_EXTRACT_INVALID',
      'No beat inflection frames to extract; Stage 1 produced no usable beat range.', { beats: Array.isArray(beats) ? beats.length : null });
  }

  let directory;
  let temporary = false;
  if (outputDirectory) {
    directory = path.resolve(outputDirectory);
    try {
      await fs.mkdir(path.dirname(directory), { recursive: true });
      await fs.mkdir(directory, { recursive: false });
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new WorkflowError('OUTPUT_EXISTS', 'Refusing to overwrite extracted reference frames.', { path: directory });
      }
      throw new WorkflowError('OUTPUT_WRITE_FAILED', 'Cannot create the reference frame directory.', { path: directory, reason: error.code });
    }
  } else {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'refclone-reference-'));
    temporary = true;
  }

  const select = `select=${frames.map(frame => `eq(n\\,${frame})`).join('+')}`;
  try {
    await runProcess(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-n',
      '-copyts', '-noautorotate', '-i', source,
      '-map', '0:v:0', '-vf', select, '-fps_mode', 'passthrough',
      '-start_number', '0', path.join(directory, 'beat-%06d.png')
    ], { timeoutMs });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const extracted = (await fs.readdir(directory)).filter(name => /^beat-\d{6}\.png$/.test(name));
  if (extracted.length !== frames.length) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw new WorkflowError('REFERENCE_EXTRACT_COUNT',
      'The video yielded a different number of sparse frames than the beats requested; no partial map is returned.',
      { expected: frames.length, actual: extracted.length, frames, video: source });
  }

  const map = {};
  try {
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const destination = path.join(directory, `frame-${padFrame(frame)}.png`);
      await fs.rename(path.join(directory, `beat-${padFrame(index)}.png`), destination);
      const png = PNG.sync.read(await fs.readFile(destination));
      if (!(png.width > 0) || !(png.height > 0)) {
        throw new WorkflowError('REFERENCE_EXTRACT_INVALID', 'An extracted reference frame is not a readable PNG.', { frame, path: destination });
      }
      map[frame] = destination;
    }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError('REFERENCE_EXTRACT_INVALID', 'An extracted reference frame could not be read back.', { reason: error.message, video: source });
  }

  return {
    version: REFERENCE_EXTRACT_VERSION,
    source,
    directory,
    temporary,
    frameCount: frames.length,
    frames,
    map,
    limitations: [
      'Auto reference frames are selected by decoded frame ordinal, so a variable-frame-rate source is compared by ordinal rather than by wall-clock time.',
      ...(temporary ? ['Auto reference frames were written to a temporary directory; pass --output to keep them beside the run artifacts.'] : [])
    ]
  };
}
