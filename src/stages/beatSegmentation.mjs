// Stage 1: split a reference into beats at hard cuts and motion-velocity inflections.
//
// PySceneDetect is the preferred detector when it is installed. It is an optional
// Python tool, so the synthetic pipeline never depends on it: the same beat shape is
// produced from per-frame activity signatures (mean absolute frame deltas) in pure
// JavaScript. A missing detector is reported as a limitation, never as an empty scene.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { runProcess, WorkflowError } from '../core.mjs';

export const BEAT_VERSION = '1.0.0';

const DEFAULT_THRESHOLD = 0.12;
const DEFAULT_MIN_BEAT_FRAMES = 3;
const SIGNATURE_GRID = 16;

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

function clampFrame(value, max) {
  return Math.max(0, Math.min(max, Math.round(Number(value))));
}

/** Parse the CSV written by `scenedetect ... list-scenes -f <file>`. */
export function parseSceneListCsv(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];
  const split = line => line.split(',').map(cell => cell.trim());
  const header = split(lines[0]);
  const column = name => header.findIndex(cell => cell.toLowerCase() === name.toLowerCase());
  const startIndex = column('Start Frame');
  const endIndex = column('End Frame');
  if (startIndex < 0) return [];
  const scenes = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const start = Number(cells[startIndex]);
    const end = endIndex >= 0 ? Number(cells[endIndex]) : NaN;
    if (!Number.isInteger(start) || start < 0) continue;
    scenes.push({ startFrame: start, endFrame: Number.isInteger(end) ? end : start + 1 });
  }
  return scenes.sort((a, b) => a.startFrame - b.startFrame);
}

/**
 * Locate and parse PySceneDetect's scene list for a video.
 * Resolves to null when the tool is absent or produced no usable file, so the
 * caller can fall back without treating an optional dependency as a hard error.
 */
export async function detectSceneCuts(videoPath, options = {}) {
  const command = options.command ?? 'scenedetect';
  const timeoutMs = options.timeoutMs ?? 120_000;
  const directory = options.outputDirectory ?? await fs.mkdtemp(path.join(os.tmpdir(), 'refclone-scenes-'));
  const listName = options.listName ?? 'refclone-scenes.csv';
  const listPath = path.join(directory, listName);
  const args = ['-i', videoPath, 'detect-adaptive', 'list-scenes', '-o', directory, '-f', listName];
  try {
    await runProcess(command, args, { timeoutMs, maxOutputBytes: 2_000_000, encoding: 'utf8' });
  } catch (error) {
    return {
      available: false, cuts: [], command: `${command} ${args.join(' ')}`,
      reason: error.code === 'TOOL_MISSING' ? 'PySceneDetect is not on PATH.' : error.message
    };
  }
  let csv;
  try {
    csv = await fs.readFile(listPath, 'utf8');
  } catch {
    return { available: false, cuts: [], command: `${command} ${args.join(' ')}`, reason: 'PySceneDetect wrote no scene list.' };
  }
  return { available: true, cuts: parseSceneListCsv(csv), command: `${command} ${args.join(' ')}`, listPath };
}

/** A deterministic, normalized signature for a decoded PNG frame. */
export function fingerprintPng(buffer) {
  const png = PNG.sync.read(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const signature = new Array(SIGNATURE_GRID * SIGNATURE_GRID).fill(0);
  const counts = new Array(signature.length).fill(0);
  const cellWidth = Math.max(1, png.width / SIGNATURE_GRID);
  const cellHeight = Math.max(1, png.height / SIGNATURE_GRID);
  for (let y = 0; y < png.height; y += 1) {
    const cellY = Math.min(SIGNATURE_GRID - 1, Math.floor(y / cellHeight));
    for (let x = 0; x < png.width; x += 1) {
      const cellX = Math.min(SIGNATURE_GRID - 1, Math.floor(x / cellWidth));
      const at = (y * png.width + x) * 4;
      const luma = (0.2126 * png.data[at] + 0.7152 * png.data[at + 1] + 0.0722 * png.data[at + 2]) / 255;
      const cell = cellY * SIGNATURE_GRID + cellX;
      signature[cell] += luma;
      counts[cell] += 1;
    }
  }
  return signature.map((sum, index) => round(counts[index] ? sum / counts[index] : 0, 5));
}

/** Per-frame activity: the mean absolute difference between consecutive signatures. */
export function activityFromFingerprints(fingerprints) {
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) return [];
  const activity = new Array(fingerprints.length).fill(0);
  for (let index = 1; index < fingerprints.length; index += 1) {
    const previous = fingerprints[index - 1];
    const current = fingerprints[index];
    const length = Math.min(previous.length, current.length);
    let total = 0;
    for (let cell = 0; cell < length; cell += 1) total += Math.abs(current[cell] - previous[cell]);
    activity[index] = length ? total / length : 0;
  }
  return activity;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Deterministic fallback segmentation from per-frame activity.
 * A cut is an activity spike above both an absolute floor and a robust multiple of
 * the median activity; the peak frame is the strongest inflection inside the beat.
 */
export function segmentFromActivity(activity, options = {}) {
  const threshold = Number(options.threshold ?? DEFAULT_THRESHOLD);
  const minBeatFrames = Math.max(2, Math.round(Number(options.minBeatFrames ?? DEFAULT_MIN_BEAT_FRAMES)));
  const frameCount = Number.isInteger(options.frameCount) ? options.frameCount : activity.length;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new WorkflowError('BEAT_OPTIONS_INVALID', 'threshold must be a nonnegative number.', { threshold });
  }
  if (!Array.isArray(activity) || activity.length === 0 || frameCount < 2) {
    return [{
      beatIndex: 0, inFrame: 0, peakFrame: 0, outFrame: Math.max(0, frameCount - 1),
      cutType: 'unsegmented', peakActivity: 0
    }];
  }
  const measured = activity.slice(1, frameCount).filter(value => Number.isFinite(value));
  const baseline = median(measured);
  const deviations = measured.map(value => Math.abs(value - baseline));
  const mad = median(deviations) || 1e-6;
  const spikeFloor = Math.max(threshold, baseline + 6 * mad);
  const cuts = [0];
  for (let frame = minBeatFrames; frame < frameCount - minBeatFrames; frame += 1) {
    const value = Number(activity[frame]) || 0;
    if (value >= spikeFloor && value >= (Number(activity[frame - 1]) || 0) && value >= (Number(activity[frame + 1]) || 0)) {
      if (frame - cuts[cuts.length - 1] >= minBeatFrames) cuts.push(frame);
    }
  }
  const beats = [];
  for (let index = 0; index < cuts.length; index += 1) {
    const inFrame = cuts[index];
    const outFrame = (index + 1 < cuts.length ? cuts[index + 1] : frameCount) - 1;
    let peakFrame = inFrame;
    let peakActivity = 0;
    for (let frame = inFrame; frame <= outFrame; frame += 1) {
      const value = Number(activity[frame]) || 0;
      if (value > peakActivity) { peakActivity = value; peakFrame = frame; }
    }
    const boundary = index > 0 ? Number(activity[inFrame]) || 0 : 0;
    beats.push({
      beatIndex: index, inFrame, peakFrame, outFrame,
      cutType: index > 0 ? 'hard-cut' : 'motion',
      peakActivity: round(peakActivity, 5),
      boundaryActivity: round(boundary, 5)
    });
  }
  return beats;
}

/** Settle frame: after the velocity peak, the first frame whose motion is quiet. */
function settleFrame(activity, peakFrame, outFrame, peakActivity) {
  const quiet = Math.max(0.02, peakActivity * 0.12);
  let quietRun = 0;
  for (let frame = peakFrame + 1; frame <= outFrame; frame += 1) {
    quietRun = (Number(activity[frame]) || 0) <= quiet ? quietRun + 1 : 0;
    if (quietRun >= 2) return frame - 1;
  }
  return outFrame;
}

/**
 * Build Stage 1 beats.
 *
 * input may be a video path or a JSON fixture. Fixtures can carry beats directly,
 * frame fingerprints, or precomputed activity so a test never shells out to Python.
 */
export async function segmentBeats(input, options = {}) {
  const resolvedInput = path.resolve(input);
  const extension = path.extname(resolvedInput).toLowerCase();
  const limitations = [];
  let fixture = null;
  if (extension === '.json') {
    fixture = JSON.parse(await fs.readFile(resolvedInput, 'utf8'));
  }
  const frameCount = Number(options.frameCount ?? fixture?.frameCount ?? fixture?.tracks?.[0]?.frames?.length ?? 0);
  let beats = null;
  let source = null;
  let detector = null;

  if (options.beats) {
    beats = options.beats;
    source = 'provided';
  } else if (fixture?.beats) {
    beats = fixture.beats;
    source = 'fixture';
  } else if (fixture && Array.isArray(fixture.activity)) {
    beats = segmentFromActivity(fixture.activity, { threshold: options.threshold, minBeatFrames: options.minBeatFrames, frameCount });
    source = 'activity';
  } else if (fixture && Array.isArray(fixture.fingerprints)) {
    const activity = activityFromFingerprints(fixture.fingerprints);
    beats = segmentFromActivity(activity, { threshold: options.threshold, minBeatFrames: options.minBeatFrames, frameCount });
    source = 'fingerprint-fallback';
  } else if (extension !== '.json') {
    detector = await detectSceneCuts(resolvedInput, options.sceneDetector ?? {});
    if (detector.available && detector.cuts.length > 0) {
      beats = detector.cuts.map((scene, index) => ({ inFrame: scene.startFrame, outFrame: Math.max(scene.startFrame + 1, scene.endFrame - 1), cutType: index === 0 ? 'scene' : 'hard-cut' }));
      source = 'pyscenedetect';
    } else {
      limitations.push(detector.reason ?? 'PySceneDetect produced no scene list.');
      source = 'fallback';
    }
  }

  if (!beats) {
    if (Array.isArray(options.fingerprints)) {
      const activity = activityFromFingerprints(options.fingerprints);
      beats = segmentFromActivity(activity, { threshold: options.threshold, minBeatFrames: options.minBeatFrames, frameCount: frameCount || options.fingerprints.length });
      source = 'fingerprint-fallback';
    } else {
      const end = Math.max(1, frameCount);
      beats = [{ inFrame: 0, peakFrame: Math.floor((end - 1) / 3), outFrame: end - 1, cutType: 'unsegmented' }];
      source = source ?? 'unsegmented';
      limitations.push('No scene detector or frame fingerprints were available; one beat spans the whole clip.');
    }
  }

  const normalized = beats.map((beat, index) => {
    const inFrame = clampFrame(beat.inFrame, Math.max(0, frameCount - 1));
    const outFrame = clampFrame(beat.outFrame ?? beat.endFrame, Math.max(inFrame, frameCount - 1));
    const boundedOut = Math.max(inFrame, outFrame);
    const peakRaw = beat.peakFrame ?? beat.peak ?? Math.round((inFrame + boundedOut) / 2);
    const peakFrame = Math.max(inFrame, Math.min(boundedOut, Math.round(Number(peakRaw))));
    return {
      beatIndex: index,
      inFrame,
      peakFrame,
      outFrame: boundedOut,
      cutType: beat.cutType ?? (index === 0 ? 'scene' : 'hard-cut'),
      ...(beat.peakActivity === undefined ? {} : { peakActivity: round(beat.peakActivity, 5) }),
      ...(beat.boundaryActivity === undefined ? {} : { boundaryActivity: round(beat.boundaryActivity, 5) })
    };
  }).sort((a, b) => a.inFrame - b.inFrame).map((beat, index) => ({ ...beat, beatIndex: index }));

  const activity = options.activity ?? (fixture && Array.isArray(fixture.activity) ? fixture.activity : null);
  if (activity && Array.isArray(activity)) {
    for (const beat of normalized) {
      if (beat.peakFrame === Math.round((beat.inFrame + beat.outFrame) / 2)) {
        let best = beat.peakFrame;
        let bestValue = -1;
        for (let frame = beat.inFrame + 1; frame <= beat.outFrame; frame += 1) {
          const value = Number(activity[frame]) || 0;
          if (value > bestValue) { best = frame; bestValue = value; }
        }
        beat.peakFrame = best;
      }
      if (beat.outFrame > beat.inFrame) {
        beat.settleFrame = settleFrame(activity, beat.peakFrame, beat.outFrame, Number(activity[beat.peakFrame]) || 0);
      }
    }
  }

  return {
    version: BEAT_VERSION,
    source,
    input: resolvedInput,
    frameCount: frameCount || (normalized[normalized.length - 1]?.outFrame + 1) || 0,
    detector,
    beats: normalized,
    limitations
  };
}
