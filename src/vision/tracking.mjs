/**
 * Kinematic Tracking Module — Stage 2 of the 5-Stage Closed-Loop Pipeline
 *
 * Extracts normalized continuous trajectories (x, y, scale_x, scale_y, rotation, opacity)
 * across active frames, decoupled from static layout extraction.
 *
 * This module bridges the gap between raw frame measurements and the procedural
 * promotion solver by producing clean, normalized trajectory data.
 *
 * Stage 1/2 upgrades: when decoded frame pixels are supplied, per-element
 * velocity comes from optical block matching (src/vision/optical.mjs), each element
 * gets its own decoupled beat grid (velocity magnitude + acceleration
 * zero-crossings, not one global timeline), and motion is classified into
 * rigid / trim / morph with stationary-edge mask hints for occlusions. Without
 * pixels everything falls back to the original bbox-diff estimates, so every
 * pre-existing caller and output shape keeps working unchanged.
 */

import { WorkflowError, hashObject } from '../core.mjs';
import {
  blockFlow, accelerationZeroCrossings, fitContourBezier, solvePivot, toGrayScale
} from './optical.mjs';
import { analyzeElementCriticalFrames } from './critical-frames.mjs';

export const TRACKING_VERSION = '2.0.0';

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

/**
 * Extract static layout properties at rest frames (velocity ~ 0).
 *
 * @param {Object} params
 * @param {Array<{frame: number, bbox: {x: number, y: number, width: number, height: number}, opacity?: number}>} params.states
 * @param {number} params.velocityThreshold - Maximum velocity to consider "at rest"
 * @returns {Object} Static layout properties
 */
export function extractStaticLayout({ states, velocityThreshold = 0.001 }) {
  if (!Array.isArray(states) || states.length === 0) {
    fail('TRACKING_INVALID', 'States array is required for static layout extraction.');
  }

  // Find rest frames (where velocity is near zero)
  const restFrames = [];
  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1];
    const curr = states[i];

    const dx = Math.abs(curr.bbox.x - prev.bbox.x);
    const dy = Math.abs(curr.bbox.y - prev.bbox.y);
    const dScale = Math.abs(curr.bbox.width - prev.bbox.width) + Math.abs(curr.bbox.height - prev.bbox.height);
    const velocity = Math.max(dx, dy, dScale);

    if (velocity <= velocityThreshold) {
      restFrames.push(curr);
    }
  }

  // Use the first rest frame or the first frame as the static reference
  const staticFrame = restFrames.length > 0 ? restFrames[0] : states[0];

  return {
    bbox: staticFrame.bbox,
    opacity: staticFrame.opacity ?? 1,
    frame: staticFrame.frame,
    isRestFrame: restFrames.length > 0,
    restFrameCount: restFrames.length,
    // Layer hierarchy and anchor points would be extracted here in a full implementation
    layerHierarchy: null,
    anchorPoint: {
      x: staticFrame.bbox.x + staticFrame.bbox.width / 2,
      y: staticFrame.bbox.y + staticFrame.bbox.height / 2
    }
  };
}

/**
 * Extract normalized continuous trajectories across active frames.
 *
 * @param {Object} params
 * @param {Array<{frame: number, bbox: {x: number, y: number, width: number, height: number}, opacity?: number, rotation?: number}>} params.states
 * @param {number} params.frameWidth - Source frame width for normalization
 * @param {number} params.frameHeight - Source frame height for normalization
 * @returns {Object} Normalized trajectories
 */
export function extractTrajectories({ states, frameWidth, frameHeight }) {
  if (!Array.isArray(states) || states.length < 2) {
    return {
      x: [],
      y: [],
      scale_x: [],
      scale_y: [],
      rotation: [],
      opacity: [],
      activeFrames: [],
      hasMotion: false
    };
  }

  const sorted = [...states].sort((a, b) => a.frame - b.frame);

  // Extract raw trajectories
  const x = [];
  const y = [];
  const scale_x = [];
  const scale_y = [];
  const rotation = [];
  const opacity = [];
  const activeFrames = [];

  // Use first frame as reference for scale normalization
  const refWidth = sorted[0].bbox.width;
  const refHeight = sorted[0].bbox.height;

  for (const state of sorted) {
    const { bbox, frame } = state;

    // Normalize position to [0, 1] range relative to frame dimensions
    x.push({ frame, value: bbox.x + bbox.width / 2 }); // Center x
    y.push({ frame, value: bbox.y + bbox.height / 2 }); // Center y

    // Normalize scale relative to reference
    scale_x.push({ frame, value: refWidth > 0 ? bbox.width / refWidth : 1 });
    scale_y.push({ frame, value: refHeight > 0 ? bbox.height / refHeight : 1 });

    // Rotation (if provided)
    rotation.push({ frame, value: state.rotation ?? 0 });

    // Opacity (if provided, default to 1)
    opacity.push({ frame, value: state.opacity ?? 1 });

    activeFrames.push(frame);
  }

  // Detect if there's actual motion
  const hasMotion = detectMotion(x, y, scale_x, scale_y, rotation, opacity);

  return {
    x,
    y,
    scale_x,
    scale_y,
    rotation,
    opacity,
    activeFrames,
    hasMotion,
    frameCount: sorted.length,
    startFrame: sorted[0].frame,
    endFrame: sorted[sorted.length - 1].frame
  };
}

/**
 * Detect if trajectories contain actual motion.
 */
function detectMotion(x, y, scale_x, scale_y, rotation, opacity) {
  const hasVariation = (traj) => {
    if (traj.length < 2) return false;
    const values = traj.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return (max - min) > 0.001; // Small threshold for floating point noise
  };

  return hasVariation(x) || hasVariation(y) || hasVariation(scale_x) ||
         hasVariation(scale_y) || hasVariation(rotation) || hasVariation(opacity);
}

/**
 * Compute velocity profile for a trajectory.
 *
 * @param {Array<{frame: number, value: number}>} trajectory
 * @param {number} fps - Frame rate for time normalization
 * @returns {Array<{frame: number, velocity: number, acceleration: number}>}
 */
export function computeVelocityProfile(trajectory, fps) {
  if (!Array.isArray(trajectory) || trajectory.length < 2) {
    return [];
  }

  const sorted = [...trajectory].sort((a, b) => a.frame - b.frame);
  const velocities = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dt = (curr.frame - prev.frame) / fps;
    const dv = curr.value - prev.value;
    const velocity = dt > 0 ? dv / dt : 0;

    velocities.push({
      frame: curr.frame,
      velocity,
      position: curr.value
    });
  }

  // Compute acceleration
  for (let i = 1; i < velocities.length; i++) {
    const prev = velocities[i - 1];
    const curr = velocities[i];
    const dt = (curr.frame - prev.frame) / fps;
    const dv = curr.velocity - prev.velocity;
    curr.acceleration = dt > 0 ? dv / dt : 0;
  }

  if (velocities.length > 0) {
    velocities[0].acceleration = velocities[1]?.acceleration ?? 0;
  }

  return velocities;
}

/**
 * Find key inflection frames in a trajectory.
 *
 * @param {Array<{frame: number, value: number}>} trajectory
 * @param {number} fps
 * @returns {Object} Inflection frames: start, peak velocity, overshoot, settle
 */
export function findInflectionFrames(trajectory, fps) {
  if (!Array.isArray(trajectory) || trajectory.length < 2) {
    return {
      start: null,
      peakVelocity: null,
      overshoot: null,
      settle: null
    };
  }

  const sorted = [...trajectory].sort((a, b) => a.frame - b.frame);
  const velocityProfile = computeVelocityProfile(sorted, fps);

  // Start frame
  const start = sorted[0].frame;

  // Peak velocity frame
  let peakVelocity = start;
  let maxVelocity = 0;
  for (const point of velocityProfile) {
    if (Math.abs(point.velocity) > Math.abs(maxVelocity)) {
      maxVelocity = point.velocity;
      peakVelocity = point.frame;
    }
  }

  // Overshoot detection: find where velocity changes sign after peak
  let overshoot = null;
  const peakIndex = velocityProfile.findIndex(p => p.frame === peakVelocity);
  if (peakIndex >= 0) {
    const peakSign = Math.sign(velocityProfile[peakIndex].velocity);
    for (let i = peakIndex + 1; i < velocityProfile.length; i++) {
      if (Math.sign(velocityProfile[i].velocity) !== peakSign && Math.abs(velocityProfile[i].velocity) > 0.001) {
        overshoot = velocityProfile[i].frame;
        break;
      }
    }
  }

  // Settle frame: last frame where velocity is near zero
  let settle = sorted[sorted.length - 1].frame;
  for (let i = velocityProfile.length - 1; i >= 0; i--) {
    if (Math.abs(velocityProfile[i].velocity) > 0.001) {
      settle = velocityProfile[i].frame;
      break;
    }
  }

  return {
    start,
    peakVelocity,
    overshoot,
    settle,
    maxVelocity,
    frameCount: sorted.length
  };
}

/**
 * Segment motion into semantic beats based on velocity changes.
 *
 * Backward-compatible entry point: returns only the per-element beats, exactly
 * as before (bbox-diff velocity, center-x inflections). For the decoupled
 * per-layer beat grid use {@link segmentMotionBeatsPerLayer}.
 *
 * @param {Object} params
 * @param {Array<{frame: number, bbox: Object, opacity?: number}>} params.states
 * @param {number} params.fps
 * @param {number} params.velocityThreshold - Threshold for detecting motion start/stop
 * @returns {Array<{startFrame: number, endFrame: number, inflections: Object}>}
 */
export function segmentMotionBeats({ states, fps, velocityThreshold = 0.01 }) {
  const { motionBeats } = segmentMotionBeatsPerLayer({ states, fps, velocityThreshold });
  return motionBeats;
}

/** Sort a states array by frame (copy; input untouched). */
function sortedStatesOf(states) {
  return [...(states ?? [])].sort((a, b) => a.frame - b.frame);
}

const NORMALIZED_EPSILON = 1.000001;

/**
 * Detect a normalized [0..1] bbox (autoanalyze measurement convention).
 */
function isNormalizedBBox(bbox) {
  return Number.isFinite(bbox?.x) && Number.isFinite(bbox?.y)
    && Number.isFinite(bbox?.width) && Number.isFinite(bbox?.height)
    && bbox.x >= -NORMALIZED_EPSILON && bbox.y >= -NORMALIZED_EPSILON
    && bbox.x + bbox.width <= NORMALIZED_EPSILON && bbox.y + bbox.height <= NORMALIZED_EPSILON;
}

/**
 * Convert a bbox into pixel space. Normalized [0..1] boxes are scaled by the
 * frame dimensions; pixel boxes pass through untouched.
 */
function bboxInPixels(bbox, frameWidth, frameHeight) {
  if (!bbox || !Number.isFinite(bbox.x) || !Number.isFinite(bbox.y)
    || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  if (frameWidth > 0 && frameHeight > 0 && isNormalizedBBox(bbox)) {
    return {
      x: bbox.x * frameWidth,
      y: bbox.y * frameHeight,
      width: bbox.width * frameWidth,
      height: bbox.height * frameHeight
    };
  }
  return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
}

const LAYOUT_ELEMENT_TYPES = ['textShape', 'uiCard', 'shape', 'unknown'];
const LAYOUT_TOLERANCE_MAX = 0.5;

/**
 * Normalize the optional static-layout descriptor Stage 3 carries into Stage 4.
 *
 * `coordinateSpace` is the trigger: without it there is no layout contract, so
 * the function returns null and the compiler emits nothing. A missing
 * `targetBounds` is derived from the tracker's measured static bbox — pixels
 * pass through, normalized boxes are scaled by the frame dimensions. Raster
 * bounds stay in top-left y-down video coordinates; Stage 4 converts them with
 * `_mg.fromRaster` before fitting. Tolerance is capped at 0.5 px because Stage 5
 * starts from this layout and a looser fit would show up as gate drift.
 *
 * @param {Object} layout - { alias?, elementType?, coordinateSpace, targetBounds?, compWidth?, compHeight?, sourceFrame?, tolerance? }
 * @param {Object} [context]
 * @param {Object} [context.staticLayout] - trackElement's static layout
 * @param {number} [context.frameWidth]
 * @param {number} [context.frameHeight]
 * @returns {Object|null} Normalized layout, or null when none was requested
 */
export function normalizeElementLayout(layout, { staticLayout, frameWidth, frameHeight } = {}) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return null;
  const coordinateSpace = layout.coordinateSpace === 'raster'
    ? 'raster'
    : layout.coordinateSpace === 'comp' ? 'comp' : null;
  if (!coordinateSpace) return null;

  const finite = value => Number.isFinite(Number(value));
  let raw = layout.targetBounds;
  if (!raw && staticLayout?.bbox) {
    raw = bboxInPixels(staticLayout.bbox, frameWidth, frameHeight);
  }
  if (!raw || typeof raw !== 'object') return null;
  const targetBounds = {
    x: Number(raw.x),
    y: Number(raw.y),
    width: Number(raw.width),
    height: Number(raw.height)
  };
  if (![targetBounds.x, targetBounds.y, targetBounds.width, targetBounds.height].every(Number.isFinite)
    || targetBounds.width <= 0 || targetBounds.height <= 0) {
    return null;
  }

  const positive = (value, fallback) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  };
  const compWidth = positive(layout.compWidth, frameWidth);
  const compHeight = positive(layout.compHeight, frameHeight);
  if (coordinateSpace === 'raster' && (compWidth === null || compHeight === null)) return null;

  const elementType = LAYOUT_ELEMENT_TYPES.includes(layout.elementType) ? layout.elementType : 'unknown';
  const tolerance = Math.min(
    LAYOUT_TOLERANCE_MAX,
    Math.max(0.001, finite(layout.tolerance) ? Number(layout.tolerance) : LAYOUT_TOLERANCE_MAX)
  );
  const normalized = {
    elementType,
    coordinateSpace,
    targetBounds,
    tolerance
  };
  if (typeof layout.alias === 'string' && layout.alias.trim()) normalized.alias = layout.alias.trim();
  if (compWidth !== null) normalized.compWidth = compWidth;
  if (compHeight !== null) normalized.compHeight = compHeight;
  if (finite(layout.sourceFrame)) normalized.sourceFrame = Math.round(Number(layout.sourceFrame));
  return normalized;
}

/**
 * Build a frame-pixel lookup over a decoded-frames array.
 *
 * Two supported shapes: every entry carries a numeric `frame` (lookup by
 * frame number), or no entry does (entries align positionally with the sorted
 * states). Entries may be bare RGBA frames ({data, width, height}, e.g. pngjs
 * PNG objects) or wrap one in `png`.
 *
 * @returns {function(number, number): Object|null} (frameNumber, sortedIndex) -> pixels
 */
function frameLookup(frames, sorted) {
  const pixelOf = entry => {
    const pixels = entry?.png ?? entry;
    if (!pixels?.data || !Number.isFinite(pixels?.width) || !Number.isFinite(pixels?.height)) return null;
    return pixels;
  };
  const entries = (Array.isArray(frames) ? frames : []).map(entry => ({
    frame: Number.isFinite(entry?.frame) ? entry.frame : null,
    pixels: pixelOf(entry)
  })).filter(entry => entry.pixels);

  if (entries.length === 0) return () => null;

  const allNumbered = entries.every(entry => entry.frame !== null);
  if (allNumbered) {
    const byFrame = new Map(entries.map(entry => [entry.frame, entry.pixels]));
    return frameNumber => byFrame.get(frameNumber) ?? null;
  }
  const positional = entries.filter(entry => entry.frame === null).map(entry => entry.pixels);
  return (frameNumber, sortedIndex) => positional[sortedIndex] ?? null;
}

/**
 * Bbox-diff velocity between two states: the exact estimate used by
 * segmentMotionBeats before optical flow existed (legacy units: bbox units
 * per second).
 */
function bboxDiffVelocity(prev, curr, dtSeconds) {
  const dx = curr.bbox.x - prev.bbox.x;
  const dy = curr.bbox.y - prev.bbox.y;
  const dScale = (curr.bbox.width - prev.bbox.width) + (curr.bbox.height - prev.bbox.height);
  return dtSeconds > 0 ? Math.sqrt(dx * dx + dy * dy + dScale * dScale) / dtSeconds : 0;
}

/**
 * Per-element velocity magnitude series, from optical flow when decoded frame
 * pixels are supplied and from the legacy bbox-diff estimate otherwise.
 *
 * Each series sample records its own source, so a run with pixels on only
 * some frames stays honest about what was measured and how.
 *
 * @param {Array<{frame: number, bbox: Object}>} states - Element states.
 * @param {Array<Object>} [frames] - Decoded RGBA frames (see frameLookup for shapes).
 * @param {Object} [options]
 * @param {number} [options.fps] - Frame rate; velocities are per second when
 *   given, per frame step otherwise.
 * @param {number} [options.frameWidth] - Source frame width (scales normalized bboxes).
 * @param {number} [options.frameHeight] - Source frame height.
 * @param {number} [options.searchRadius] - blockFlow search radius (px).
 * @param {number} [options.blockSize] - blockFlow block side (px).
 * @param {number} [options.stride] - blockFlow coarse stride (px).
 * @returns {{source: 'optical'|'bbox'|'mixed', series: Array<{frame: number,
 *   velocity: number, vx: number|null, vy: number|null, confidence: number|null,
 *   source: 'optical'|'bbox'}>}}
 */
export function opticalVelocity(states, frames, options = {}) {
  const sorted = sortedStatesOf(states);
  if (sorted.length < 2) return { source: 'bbox', series: [] };

  const lookup = frameLookup(frames, sorted);
  const fps = Number.isFinite(options.fps) && options.fps > 0 ? options.fps : null;
  const flowOptions = {};
  if (options.searchRadius !== undefined) flowOptions.searchRadius = options.searchRadius;
  if (options.blockSize !== undefined) flowOptions.blockSize = options.blockSize;
  if (options.stride !== undefined) flowOptions.stride = options.stride;

  const series = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dtSeconds = fps ? (curr.frame - prev.frame) / fps : curr.frame - prev.frame;
    const pixelsA = lookup(prev.frame, i - 1);
    const pixelsB = lookup(curr.frame, i);

    if (pixelsA && pixelsB && dtSeconds > 0) {
      const boxA = bboxInPixels(prev.bbox, options.frameWidth, options.frameHeight);
      const boxB = bboxInPixels(curr.bbox, options.frameWidth, options.frameHeight);
      const x0 = Math.min(boxA.x, boxB.x);
      const y0 = Math.min(boxA.y, boxB.y);
      const box = {
        x: x0,
        y: y0,
        width: Math.max(boxA.x + boxA.width, boxB.x + boxB.width) - x0,
        height: Math.max(boxA.y + boxA.height, boxB.y + boxB.height) - y0
      };
      try {
        const flow = blockFlow(pixelsA, pixelsB, box, flowOptions);
        series.push({
          frame: curr.frame,
          velocity: flow.magnitude / dtSeconds,
          vx: flow.vx,
          vy: flow.vy,
          confidence: flow.confidence,
          source: 'optical'
        });
        continue;
      } catch (error) {
        if (error?.code !== 'OPTICAL_INVALID') throw error;
        // A degenerate box falls through to the bbox estimate below.
      }
    }
    series.push({
      frame: curr.frame,
      velocity: bboxDiffVelocity(prev, curr, dtSeconds),
      vx: null,
      vy: null,
      confidence: null,
      source: 'bbox'
    });
  }

  const usedOptical = series.some(sample => sample.source === 'optical');
  return {
    source: usedOptical ? (series.every(sample => sample.source === 'optical') ? 'optical' : 'mixed') : 'bbox',
    series
  };
}

/** Close one beat with the legacy inflection shape (center-x trajectory). */
function closeBeat(beat, sorted, fps) {
  const beatStates = sorted.filter(s => s.frame >= beat.startFrame && s.frame <= beat.endFrame);
  const trajectory = beatStates.map(s => ({
    frame: s.frame,
    value: s.bbox.x + s.bbox.width / 2 // Use center x as primary trajectory
  }));
  beat.inflections = findInflectionFrames(trajectory, fps);
  beat.stateCount = beatStates.length;
}

/**
 * Segment one element's motion into beats on its OWN decoupled timeline.
 *
 * Velocity magnitude comes from {@link opticalVelocity} (optical flow when
 * frame pixels are supplied, the legacy bbox-diff estimate otherwise), and the
 * element's beat grid additionally records the acceleration zero-crossings of
 * that same series via src/vision/optical.mjs. Nothing here is quantized to a shared
 * global timeline: two elements sampled on the same frames but moving on
 * different schedules get different grids.
 *
 * @param {Object} params
 * @param {Array<{frame: number, bbox: Object}>} params.states
 * @param {Array<Object>} [params.frames] - Decoded RGBA frames (optional).
 * @param {number} params.fps
 * @param {number} [params.velocityThreshold=0.01]
 * @param {number} [params.frameWidth]
 * @param {number} [params.frameHeight]
 * @returns {{motionBeats: Array, beatGrid: {source: 'optical'|'bbox',
 *   frames: number[], accelerationZeroCrossings: number[]}}}
 *   beatGrid.frames is this element's own beat-boundary frames merged with its
 *   acceleration zero-crossings (sorted, unique).
 */
export function segmentMotionBeatsPerLayer({ states, fps, frames, velocityThreshold = 0.01, frameWidth, frameHeight }) {
  const emptyGrid = { source: 'bbox', frames: [], accelerationZeroCrossings: [] };
  if (!Array.isArray(states) || states.length < 2) {
    return { motionBeats: [], beatGrid: emptyGrid };
  }

  const velocity = opticalVelocity(states, frames, { fps, frameWidth, frameHeight });
  const sorted = sortedStatesOf(states);

  const beats = [];
  let currentBeat = null;
  for (const point of velocity.series) {
    if (point.velocity > velocityThreshold) {
      if (!currentBeat) {
        currentBeat = { startFrame: point.frame, endFrame: point.frame };
      } else {
        currentBeat.endFrame = point.frame;
      }
    } else if (currentBeat) {
      closeBeat(currentBeat, sorted, fps);
      beats.push(currentBeat);
      currentBeat = null;
    }
  }
  if (currentBeat) {
    closeBeat(currentBeat, sorted, fps);
    beats.push(currentBeat);
  }

  const zeroCrossings = accelerationZeroCrossings(
    velocity.series.map(sample => ({ frame: sample.frame, velocity: sample.velocity }))
  );
  const beatGrid = {
    source: velocity.series.some(sample => sample.source === 'optical') ? 'optical' : 'bbox',
    frames: [...new Set([
      ...beats.flatMap(beat => [beat.startFrame, beat.endFrame]),
      ...zeroCrossings
    ])].sort((a, b) => a - b),
    accelerationZeroCrossings: zeroCrossings
  };

  return { motionBeats: beats, beatGrid };
}

/** Pearson correlation of two equal-length series; null when degenerate. */
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i] / n;
    meanB += b[i] / n;
  }
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA < 1e-12 || varianceB < 1e-12) return null;
  return covariance / Math.sqrt(varianceA * varianceB);
}

/**
 * Build a binary foreground mask for one element state: pixels inside the
 * bbox whose grayscale differs from the modal gray of a border ring around
 * the bbox (the local background candidate).
 */
function elementMask(frame, boxPx, diffThreshold) {
  const { gray, width, height } = toGrayScale(frame);
  const x0 = Math.max(0, Math.floor(boxPx.x));
  const y0 = Math.max(0, Math.floor(boxPx.y));
  const x1 = Math.min(width, Math.ceil(boxPx.x + boxPx.width));
  const y1 = Math.min(height, Math.ceil(boxPx.y + boxPx.height));
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;

  // Modal (binned) gray of the ring around the bbox: the background candidate.
  const bins = new Int32Array(16);
  const ring = 4;
  const rx0 = Math.max(0, x0 - ring);
  const ry0 = Math.max(0, y0 - ring);
  const rx1 = Math.min(width, x1 + ring);
  const ry1 = Math.min(height, y1 + ring);
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      bins[Math.min(15, Math.max(0, Math.floor(gray[y * width + x] / 16)))] += 1;
    }
  }
  let bestBin = 0;
  for (let b = 1; b < 16; b++) {
    if (bins[b] > bins[bestBin]) bestBin = b;
  }
  const background = bestBin * 16 + 8;

  const mask = new Uint8Array(width * height);
  let foreground = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (Math.abs(gray[y * width + x] - background) >= diffThreshold) {
        mask[y * width + x] = 255;
        foreground += 1;
      }
    }
  }
  return foreground >= 8 ? { data: mask, width, height } : null;
}

/** Intersection-over-union of two same-sized binary masks (non-zero = foreground). */
function maskIou(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 0;
  let intersection = 0;
  let union = 0;
  for (let p = 0; p < a.data.length; p++) {
    const inA = a.data[p] !== 0;
    const inB = b.data[p] !== 0;
    if (inA || inB) union += 1;
    if (inA && inB) intersection += 1;
  }
  return union > 0 ? intersection / union : 1;
}

/**
 * Classify one element's motion: 'rigid' | 'trim' | 'morph' | 'static'.
 *
 * Disambiguation, in priority order:
 *  - 'static': no measurable center or size change.
 *  - 'rigid': optical flow magnitude tracks bbox-center motion (Pearson
 *    correlation > rigidCorrelationMin). Without pixels, pure translation
 *    (or a uniform scale) with a moving center is proposed as rigid with
 *    bbox-only confidence.
 *  - 'trim': bbox center stays put while the mask/bbox grows or shrinks along
 *    one dominant axis (trim-path progression).
 *  - 'morph': with pixels, the element mask's contour Bezier errorRms across
 *    evaluated states exceeds morphErrorRmsMax while the bbox is stable, and
 *    the mask itself changes between the first and last evaluated state
 *    (IoU < morphIouMax). Without pixels, a static center with comparable
 *    non-uniform size change on both axes is proposed with lower bbox-only
 *    confidence.
 *
 * This is a hypothesis with evidence, not a verdict: callers review it.
 *
 * @param {Object} element - {elementId?, states, frames?, frameWidth?,
 *   frameHeight?, fps?} — frames enable the optical and contour evidence.
 * @param {Object} [options]
 * @param {number} [options.rigidCorrelationMin=0.8]
 * @param {number} [options.centerTolerance=0.004] - "stays put" threshold (normalized units).
 * @param {number} [options.trimAxisRatioMin=2]
 * @param {number} [options.trimGrowthMin=0.002]
 * @param {number} [options.morphErrorRmsMax=2] - px.
 * @param {number} [options.maskDiffThreshold=24] - gray levels for background subtraction.
 * @param {number} [options.maxMorphSamples=16]
 * @returns {{kind: 'rigid'|'trim'|'morph'|'static', confidence: number, evidence: Object}}
 */
export function classifyMotion(element, options = {}) {
  const states = sortedStatesOf(element?.states);
  const rigidCorrelationMin = options.rigidCorrelationMin ?? 0.8;
  const centerTolerance = options.centerTolerance ?? 0.004;
  const trimAxisRatioMin = options.trimAxisRatioMin ?? 2;
  const trimGrowthMin = options.trimGrowthMin ?? 0.002;
  const morphErrorRmsMax = options.morphErrorRmsMax ?? 2;
  const maskDiffThreshold = options.maskDiffThreshold ?? 24;
  const maxMorphSamples = Math.max(1, options.maxMorphSamples ?? 16);

  const evidence = {
    centerDisplacement: 0,
    sizeDelta: { x: 0, y: 0 },
    correlation: null,
    directionAgreement: null,
    bezierErrorRms: null,
    maskIou: null,
    uniformScale: false,
    axis: null,
    source: null,
    notes: []
  };
  if (states.length < 2) {
    return { kind: 'static', confidence: 1, evidence };
  }

  const frameWidth = Number.isFinite(element?.frameWidth) ? element.frameWidth : 0;
  const frameHeight = Number.isFinite(element?.frameHeight) ? element.frameHeight : 0;
  const boxes = states.map(state => bboxInPixels(state.bbox, frameWidth, frameHeight));
  const centers = boxes.map(box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
  // Displacement units: normalized frame units when frame dims are known,
  // otherwise bbox units are already assumed normalized (autoanalyze convention).
  const centerMove = Math.max(...centers.map(center => Math.hypot(
    frameWidth > 0 ? (center.x - centers[0].x) / frameWidth : center.x - centers[0].x,
    frameHeight > 0 ? (center.y - centers[0].y) / frameHeight : center.y - centers[0].y
  )));
  const sizeDelta = {
    x: Math.max(...boxes.map(box => Math.abs(box.width - boxes[0].width))) / (frameWidth > 0 ? frameWidth : 1),
    y: Math.max(...boxes.map(box => Math.abs(box.height - boxes[0].height))) / (frameHeight > 0 ? frameHeight : 1)
  };
  evidence.centerDisplacement = centerMove;
  evidence.sizeDelta = sizeDelta;

  const moving = centerMove > centerTolerance;
  const grewX = sizeDelta.x > trimGrowthMin;
  const grewY = sizeDelta.y > trimGrowthMin;

  // Optical evidence. Rigid: flow magnitude tracks bbox-center motion.
  // Morph: with the center settled, a shape that resists low-order Bezier
  // fits AND visibly changes (mask IoU below morphIouMax) is a morph, even
  // when the bbox itself is stable — checked before the static early-return.
  const frames = element?.frames ?? null;
  if (frames) {
    const velocity = opticalVelocity(states, frames, {
      fps: element?.fps, frameWidth, frameHeight
    });
    evidence.source = velocity.source;
    const optical = velocity.series.filter(sample => sample.source === 'optical');
    if (moving && optical.length >= 3) {
      const fpsValue = Number.isFinite(element?.fps) && element.fps > 0 ? element.fps : null;
      const magnitudes = [];
      const speeds = [];
      const agreements = [];
      for (let i = 1; i < states.length; i++) {
        const sample = velocity.series[i - 1];
        if (sample.source !== 'optical') continue;
        const dtSeconds = fpsValue ? (states[i].frame - states[i - 1].frame) / fpsValue : states[i].frame - states[i - 1].frame;
        if (!(dtSeconds > 0)) continue;
        const dcx = centers[i].x - centers[i - 1].x;
        const dcy = centers[i].y - centers[i - 1].y;
        magnitudes.push(sample.velocity);
        speeds.push(Math.hypot(dcx, dcy) / dtSeconds);
        const flow = Math.hypot(sample.vx, sample.vy);
        const travel = Math.hypot(dcx, dcy);
        if (flow > 0.25 && travel > 0.25) {
          agreements.push((sample.vx * dcx + sample.vy * dcy) / (flow * travel));
        }
      }
      evidence.correlation = pearson(magnitudes, speeds);
      evidence.directionAgreement = agreements.length
        ? agreements.reduce((sum, value) => sum + value, 0) / agreements.length
        : null;
      if (evidence.correlation !== null && evidence.correlation > rigidCorrelationMin) {
        return {
          kind: 'rigid',
          confidence: Math.min(1, evidence.correlation),
          evidence
        };
      }
    }

    if (!moving) {
      const morphIouMax = options.morphIouMax ?? 0.98;
      const lookup = frameLookup(frames, states);
      const errors = [];
      let firstMask = null;
      let lastMask = null;
      for (let i = 0; i < states.length && errors.length < maxMorphSamples; i++) {
        const pixels = lookup(states[i].frame, i);
        if (!pixels) continue;
        const mask = elementMask(pixels, boxes[i], maskDiffThreshold);
        if (!mask) continue;
        if (!firstMask) firstMask = mask;
        lastMask = mask;
        try {
          const fit = fitContourBezier(mask, { width: mask.width, height: mask.height });
          if (fit.segments.length > 0) errors.push(fit.errorRms);
        } catch (error) {
          if (error?.code !== 'OPTICAL_INVALID') throw error;
        }
      }
      if (errors.length) {
        evidence.bezierErrorRms = Math.max(...errors);
        evidence.maskIou = firstMask && lastMask ? maskIou(firstMask, lastMask) : 1;
        if (evidence.bezierErrorRms > morphErrorRmsMax && evidence.maskIou < morphIouMax) {
          return {
            kind: 'morph',
            confidence: Math.min(1, evidence.bezierErrorRms / (2 * morphErrorRmsMax)),
            evidence
          };
        }
      }
    }
  }

  if (!moving && !grewX && !grewY) {
    return { kind: 'static', confidence: 1, evidence };
  }

  // Trim: center stays put while one axis grows or shrinks dominantly.
  if (!moving && (grewX || grewY)) {
    if (grewX !== grewY) {
      evidence.axis = grewX ? 'x' : 'y';
      return { kind: 'trim', confidence: 0.75, evidence };
    }
    const dominant = Math.max(sizeDelta.x, sizeDelta.y);
    const minor = Math.min(sizeDelta.x, sizeDelta.y);
    if (dominant >= trimAxisRatioMin * minor) {
      evidence.axis = sizeDelta.x > sizeDelta.y ? 'x' : 'y';
      return { kind: 'trim', confidence: 0.75, evidence };
    }
  }

  // Bbox-only fallbacks: honest about the weaker evidence.
  if (!moving && grewX && grewY) {
    const growthX = boxes.reduce((max, box) => Math.max(max, Math.abs(box.width - boxes[0].width)), 0) / (boxes[0].width || 1);
    const growthY = boxes.reduce((max, box) => Math.max(max, Math.abs(box.height - boxes[0].height)), 0) / (boxes[0].height || 1);
    const uniform = Math.abs(growthX - growthY) <= 0.25 * Math.max(growthX, growthY, 1e-9);
    if (uniform) {
      evidence.uniformScale = true;
      evidence.notes.push('bbox-only: uniform scale with a static center proposed as rigid');
      return { kind: 'rigid', confidence: 0.5, evidence };
    }
    evidence.notes.push('bbox-only: non-uniform size change with a static center proposed as morph');
    return { kind: 'morph', confidence: 0.4, evidence };
  }
  if (moving) {
    if (!grewX && !grewY) {
      if (frames) evidence.notes.push('optical correlation did not exceed the rigid threshold');
      else evidence.notes.push('bbox-only: pure translation proposed as rigid');
      return { kind: 'rigid', confidence: frames ? 0.5 : 0.6, evidence };
    }
    evidence.notes.push('bbox-only: translation with size change proposed as rigid');
    return { kind: 'rigid', confidence: 0.5, evidence };
  }
  evidence.notes.push('no disambiguation rule matched');
  return { kind: 'static', confidence: 0.5, evidence };
}

/**
 * Infer stationary-edge occlusion hints for one element.
 *
 * A stationary edge is a row/column band of near-zero frame-to-frame change
 * lying just OUTSIDE one side of the element's motion envelope (the union of
 * its bboxes), while the layer's interior measurably changes and the layer's
 * content actually meets that edge. An edge qualifies when its band is
 * stationary on more than stationaryFractionMin of the active frame pairs.
 * Hints are candidates for a clipping mask (so a caller can clip the layer
 * instead of shrinking it), never a decision that an occluder exists.
 *
 * @param {Array<{frame: number, bbox: Object}>} states - Element states.
 * @param {Array<Object>} [frames] - Decoded RGBA frames (required; without
 *   pixels no mask can be inferred and the result is empty).
 * @param {Object} [options]
 * @param {number} [options.frameWidth]
 * @param {number} [options.frameHeight]
 * @param {number} [options.edgeBandPx=2] - Stationary band width (px).
 * @param {number} [options.diffThreshold=2] - Gray levels meaning "no change".
 * @param {number} [options.stationaryFractionMin=0.8]
 * @returns {{maskHints: Array<{frame: number, edge: 'left'|'right'|'top'|'bottom',
 *   axis: 'x'|'y', stationary: boolean, confidence: number}>,
 *   edges: Array<{edge: string, axis: string, stationaryFraction: number, activePairs: number}>,
 *   evaluatedPairs: number}}
 */
export function inferMasks(states, frames, options = {}) {
  const empty = { maskHints: [], edges: [], evaluatedPairs: 0 };
  const sorted = sortedStatesOf(states);
  if (!Array.isArray(frames) || frames.length === 0 || sorted.length < 2) return empty;

  const frameWidth = Number.isFinite(options.frameWidth) ? options.frameWidth : 0;
  const frameHeight = Number.isFinite(options.frameHeight) ? options.frameHeight : 0;
  const lookup = frameLookup(frames, sorted);
  const band = Math.max(1, Math.floor(options.edgeBandPx ?? 2));
  const diffThreshold = options.diffThreshold ?? 2;
  const fractionMin = options.stationaryFractionMin ?? 0.8;

  // Frame dimensions come from the first available pixels entry.
  let pixelsWidth = 0;
  let pixelsHeight = 0;
  for (let i = 0; i < sorted.length && !pixelsWidth; i++) {
    const pixels = lookup(sorted[i].frame, i);
    if (pixels) {
      pixelsWidth = pixels.width;
      pixelsHeight = pixels.height;
    }
  }
  if (!pixelsWidth) return empty;

  const boxes = sorted.map(state => bboxInPixels(state.bbox, frameWidth, frameHeight));
  const env = {
    x0: Math.max(0, Math.min(...boxes.map(box => box.x))),
    y0: Math.max(0, Math.min(...boxes.map(box => box.y))),
    x1: Math.min(pixelsWidth, Math.max(...boxes.map(box => box.x + box.width))),
    y1: Math.min(pixelsHeight, Math.max(...boxes.map(box => box.y + box.height)))
  };
  if (env.x1 - env.x0 < 4 || env.y1 - env.y0 < 4) return empty;

  const EDGES = [
    { edge: 'left', axis: 'x', outside: { x0: env.x0 - band, x1: env.x0, y0: env.y0, y1: env.y1 }, inside: { x0: env.x0, x1: env.x0 + band, y0: env.y0, y1: env.y1 } },
    { edge: 'right', axis: 'x', outside: { x0: env.x1, x1: env.x1 + band, y0: env.y0, y1: env.y1 }, inside: { x0: env.x1 - band, x1: env.x1, y0: env.y0, y1: env.y1 } },
    { edge: 'top', axis: 'y', outside: { x0: env.x0, x1: env.x1, y0: env.y0 - band, y1: env.y0 }, inside: { x0: env.x0, x1: env.x1, y0: env.y0, y1: env.y0 + band } },
    { edge: 'bottom', axis: 'y', outside: { x0: env.x0, x1: env.x1, y0: env.y1, y1: env.y1 + band }, inside: { x0: env.x0, x1: env.x1, y0: env.y1 - band, y1: env.y1 } }
  ];
  const interior = {
    x0: env.x0 + (env.x1 - env.x0) / 4,
    x1: env.x1 - (env.x1 - env.x0) / 4,
    y0: env.y0 + (env.y1 - env.y0) / 4,
    y1: env.y1 - (env.y1 - env.y0) / 4
  };

  /** Mean absolute gray difference between two frames over a clamped strip. */
  const stripDiff = (strip, grayA, grayB) => {
    const x0 = Math.max(0, Math.floor(strip.x0));
    const y0 = Math.max(0, Math.floor(strip.y0));
    const x1 = Math.min(pixelsWidth, Math.ceil(strip.x1));
    const y1 = Math.min(pixelsHeight, Math.ceil(strip.y1));
    const pixels = (x1 - x0) * (y1 - y0);
    if (pixels <= 0) return null;
    let sum = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += Math.abs(grayA[y * pixelsWidth + x] - grayB[y * pixelsWidth + x]);
      }
    }
    return sum / pixels;
  };

  const pairRecords = [];
  for (let i = 1; i < sorted.length; i++) {
    const pixelsA = lookup(sorted[i - 1].frame, i - 1);
    const pixelsB = lookup(sorted[i].frame, i);
    if (!pixelsA || !pixelsB || pixelsA.width !== pixelsWidth || pixelsB.width !== pixelsWidth) continue;
    const grayA = toGrayScale(pixelsA).gray;
    const grayB = toGrayScale(pixelsB).gray;
    const record = { frame: sorted[i].frame, strips: {} };
    record.interior = stripDiff(interior, grayA, grayB);
    for (const descriptor of EDGES) {
      record.strips[descriptor.edge] = {
        outside: stripDiff(descriptor.outside, grayA, grayB),
        inside: stripDiff(descriptor.inside, grayA, grayB)
      };
    }
    pairRecords.push(record);
  }

  const active = pairRecords.filter(record => record.interior !== null && record.interior > diffThreshold);
  if (!active.length) {
    return { maskHints: [], edges: [], evaluatedPairs: pairRecords.length };
  }

  const maskHints = [];
  const edges = [];
  for (const descriptor of EDGES) {
    if (active.some(record => record.strips[descriptor.edge].outside === null)) continue;
    // The layer must actually meet this edge with changing content.
    const insideActive = active.some(record => record.strips[descriptor.edge].inside !== null
      && record.strips[descriptor.edge].inside > diffThreshold);
    if (!insideActive) continue;
    const stationaryCount = active.filter(record => record.strips[descriptor.edge].outside <= diffThreshold).length;
    const fraction = stationaryCount / active.length;
    if (!(fraction > fractionMin)) continue;
    edges.push({
      edge: descriptor.edge,
      axis: descriptor.axis,
      stationaryFraction: fraction,
      activePairs: active.length
    });
    for (const record of active) {
      maskHints.push({
        frame: record.frame,
        edge: descriptor.edge,
        axis: descriptor.axis,
        stationary: record.strips[descriptor.edge].outside <= diffThreshold,
        confidence: Math.round(fraction * 10000) / 10000
      });
    }
  }

  return { maskHints, edges, evaluatedPairs: pairRecords.length };
}

/**
 * Build complete tracking analysis for an element.
 *
 * Additive Stage 2 fields beyond the legacy output: `beatGrid` (this element's
 * own decoupled beat grid), `motionClass` (rigid/trim/morph/static with
 * evidence), `maskHints` + `maskEdges` (stationary-edge occlusion candidates),
 * and `pivot` (invariant center-of-rotation estimate from the bbox-center
 * trajectory). When decoded frame pixels are supplied via `frames`, velocity,
 * classification and mask hints use optical measurements; without them
 * everything falls back to bbox-only estimates and all legacy fields keep
 * their previous values.
 *
 * @param {Object} params
 * @param {string} params.elementId
 * @param {Array} params.states - Element states across frames
 * @param {number} params.frameWidth
 * @param {number} params.frameHeight
 * @param {number} params.fps
 * @param {Array<Object>} [params.frames] - Decoded RGBA frames (optional)
 * @param {Object} [params.layout] - Optional static-layout descriptor; see
 *   normalizeElementLayout. Only present in the output when it normalizes.
 * @param {Object} [params.options] - {classify, masks} overrides for the new analyses
 * @returns {Object} Complete tracking analysis
 */
export function trackElement({ elementId, states, frameWidth, frameHeight, fps, frames, layout, options }) {
  if (!elementId) {
    fail('TRACKING_INVALID', 'elementId is required.');
  }

  const staticLayout = extractStaticLayout({ states });
  const trajectories = extractTrajectories({ states, frameWidth, frameHeight });
  const { motionBeats: beats, beatGrid } = segmentMotionBeatsPerLayer({ states, frames, fps, frameWidth, frameHeight });
  const motionClass = classifyMotion(
    { elementId, states, frames, frameWidth, frameHeight, fps },
    options?.classify ?? {}
  );
  const masks = inferMasks(states, frames, { frameWidth, frameHeight, ...(options?.masks ?? {}) });
  // Critical frames carry normalized boxes, so a normalized [0..1] input
  // (autoanalyze convention) is converted to pixels first — otherwise the
  // normalisation in critical-frames.mjs would divide it a second time.
  const safeWidth = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 1920;
  const safeHeight = Number.isFinite(frameHeight) && frameHeight > 0 ? frameHeight : 1080;
  const pixelStates = sortedStatesOf(states).map(state => ({
    frame: state.frame,
    bbox: bboxInPixels(state.bbox, frameWidth, frameHeight)
  }));
  const criticalFrames = analyzeElementCriticalFrames({
    elementId,
    trajectories,
    states: pixelStates,
    frameWidth: safeWidth,
    frameHeight: safeHeight,
    options: options?.criticalFrames ?? {}
  });
  const centerSamples = sortedStatesOf(states).map(state => ({
    x: state.bbox.x + state.bbox.width / 2,
    y: state.bbox.y + state.bbox.height / 2,
    ...(Number.isFinite(state.rotation) ? { angle: state.rotation } : {})
  }));
  const pivot = centerSamples.length >= 1 ? solvePivot(centerSamples) : null;
  const normalizedLayout = normalizeElementLayout(layout, {
    staticLayout,
    frameWidth: safeWidth,
    frameHeight: safeHeight
  });

  return {
    elementId,
    version: TRACKING_VERSION,
    staticLayout,
    ...(normalizedLayout ? { layout: normalizedLayout } : {}),
    trajectories,
    criticalFrames,
    motionBeats: beats,
    beatGrid,
    motionClass,
    maskHints: masks.maskHints,
    maskEdges: masks.edges,
    pivot,
    hasMotion: trajectories.hasMotion,
    metrics: {
      stateCount: states?.length ?? 0,
      frameRange: trajectories.frameCount > 0
        ? { start: trajectories.startFrame, end: trajectories.endFrame }
        : null,
      beatCount: beats.length,
      beatGridSource: beatGrid.source,
      motionKind: motionClass.kind,
      maskHintCount: masks.maskHints.length,
      criticalFrameCount: criticalFrames.frames.length
    }
  };
}

/**
 * Build tracking analysis for all elements in a shot.
 *
 * @param {Object} params
 * @param {string} params.shotId
 * @param {Array<{id: string, states: Array, frames?: Array}>} params.elements
 * @param {number} params.frameWidth
 * @param {number} params.frameHeight
 * @param {number} params.fps
 * @param {Array<Object>} [params.frames] - Shot-wide decoded RGBA frames;
 *   an element-level `frames` array takes precedence for that element.
 * @returns {Object} Shot tracking analysis
 */
export function trackShot({ shotId, elements, frameWidth, frameHeight, fps, frames }) {
  if (!shotId) {
    fail('TRACKING_INVALID', 'shotId is required.');
  }

  const elementTracks = [];

  for (const element of elements ?? []) {
    const track = trackElement({
      elementId: element.id,
      states: element.states ?? [],
      frameWidth,
      frameHeight,
      fps,
      frames: element.frames ?? frames,
      layout: element.layout,
      options: element.options
    });
    elementTracks.push(track);
  }

  return {
    shotId,
    version: TRACKING_VERSION,
    fps,
    frameDimensions: { width: frameWidth, height: frameHeight },
    elements: elementTracks,
    // Additive shot-level evidence: every element's critical frames unioned.
    // The `summary` object stays byte-compatible with pre-critical-frame
    // callers, which assert its exact shape.
    criticalFrames: [...new Set(elementTracks.flatMap(e => e.criticalFrames?.frames ?? []))].sort((a, b) => a - b),
    summary: {
      elementCount: elementTracks.length,
      motionElementCount: elementTracks.filter(e => e.hasMotion).length,
      totalBeats: elementTracks.reduce((sum, e) => sum + e.motionBeats.length, 0)
    }
  };
}

/**
 * Convert tracking analysis to promotion solver input format.
 *
 * @param {Object} trackingAnalysis - Result from trackElement or trackShot
 * @returns {Array} Elements formatted for analyzeScenePromotion
 */
export function toPromotionInput(trackingAnalysis) {
  const elements = trackingAnalysis.elements ?? [trackingAnalysis];

  return elements.map(element => ({
    id: element.elementId,
    trajectories: {
      x: element.trajectories?.x ?? [],
      y: element.trajectories?.y ?? [],
      scale_x: element.trajectories?.scale_x ?? [],
      scale_y: element.trajectories?.scale_y ?? [],
      rotation: element.trajectories?.rotation ?? [],
      opacity: element.trajectories?.opacity ?? []
    },
    staticLayout: element.staticLayout,
    motionBeats: element.motionBeats,
    criticalFrames: element.criticalFrames ?? null,
    ...(element.layout ? { layout: element.layout } : {})
  }));
}
