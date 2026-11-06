/**
 * Critical evaluation frames for a tracked element.
 *
 * The convergence loop must not compare every frame of a shot: a render pass is
 * the expensive operation, and most frames repeat the same evidence. This module
 * reduces each element's trajectories to the four frames that decide whether a
 * clone is faithful:
 *
 *   1. frame_start          — the first frame where the element has visibly moved.
 *   2. frame_max_velocity   — the sample with the largest normalised speed.
 *   3. frame_overshoot_peak — the furthest excursion past the settle value, or
 *                             the max-velocity frame when the motion is monotone.
 *   4. frame_settle         — the first frame after the peak whose speed stays
 *                             below the settle threshold until the end.
 *
 * Every role is derived from measured samples; nothing is guessed from the
 * element type. All series are normalised by their own value range, so an
 * opacity ramp (0..1) and a position travel (hundreds of pixels) contribute to
 * the same "where is the motion" decision without one drowning out the other.
 */

import { WorkflowError } from './core.mjs';

export const CRITICAL_FRAMES_VERSION = '1.0.0';

export const CRITICAL_FRAME_ROLES = Object.freeze([
  'frame_start',
  'frame_max_velocity',
  'frame_overshoot_peak',
  'frame_settle'
]);

export const CRITICAL_FRAMES_DEFAULTS = Object.freeze({
  /** A series with a smaller peak-to-peak range than this is treated as static. */
  valueEpsilon: 1e-4,
  /** Motion start: fraction of the series range that counts as "moved". */
  startFraction: 0.02,
  /** Overshoot: fraction of the series range that counts as a real overshoot. */
  overshootFraction: 0.02,
  /** Normalised speed at or below which a sample is considered settled. */
  settleThreshold: 0.005,
  /** Consecutive settled samples required to accept a settle frame. */
  settleWindow: 2,
  /** Points from the tail averaged to estimate the settle value. */
  settleSamples: 3
});

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const round6 = value => Number(Number(value).toFixed(6));

function sortedPoints(points) {
  if (!Array.isArray(points)) return [];
  const byFrame = new Map();
  for (const point of points) {
    const frame = Math.round(Number(point?.frame));
    const value = Number(point?.value);
    if (!Number.isFinite(frame) || !Number.isFinite(value)) continue;
    byFrame.set(frame, value);
  }
  return [...byFrame.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([frame, value]) => ({ frame, value }));
}

/** Interval speed, attributed to the frame the interval ends on. */
function velocityProfile(points) {
  const out = [];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    const dt = curr.frame - prev.frame;
    if (dt <= 0) continue;
    out.push({
      frame: curr.frame,
      previousFrame: prev.frame,
      value: curr.value,
      velocity: (curr.value - prev.value) / dt
    });
  }
  return out;
}

function rangeOf(points) {
  if (points.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  return max - min;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Analyse one trajectory into the four critical roles.
 *
 * @param {Object} params
 * @param {string} params.elementId
 * @param {Array<{frame:number,value:number}>} params.points - Measured samples.
 * @param {Object} [params.options]
 * @returns {Object|null} Role analysis, or null when there are fewer than two points.
 */
export function analyzeCriticalTrajectory({ elementId, points, options = {} }) {
  const settings = { ...CRITICAL_FRAMES_DEFAULTS, ...options };
  const sorted = sortedPoints(points);
  if (sorted.length < 2) return null;

  const firstFrame = sorted[0].frame;
  const lastFrame = sorted[sorted.length - 1].frame;
  const range = rangeOf(sorted);
  const velocity = velocityProfile(sorted);
  const epsilon = Math.max(settings.valueEpsilon, range * 1e-9);
  const animated = range > epsilon;

  if (!animated) {
    return {
      elementId,
      animated: false,
      roles: {
        frame_start: firstFrame,
        frame_max_velocity: null,
        frame_overshoot_peak: null,
        frame_settle: lastFrame
      },
      frames: [firstFrame, lastFrame].filter((frame, index, list) => list.indexOf(frame) === index),
      overshootDetected: false,
      settleValue: sorted[sorted.length - 1].value,
      maxVelocity: 0
    };
  }

  // Start: first sample that has moved by startFraction of the full range.
  const startThreshold = Math.max(epsilon, range * settings.startFraction);
  let startFrame = firstFrame;
  const direction = Math.sign(sorted[sorted.length - 1].value - sorted[0].value) || 1;
  for (const point of sorted) {
    if (Math.abs(point.value - sorted[0].value) > startThreshold) {
      startFrame = point.frame;
      break;
    }
  }

  // Peak velocity: largest normalised interval speed across the series.
  let maxVelocityPoint = velocity[0] ?? { frame: firstFrame, velocity: 0 };
  let maxNormalisedSpeed = 0;
  for (const point of velocity) {
    const normalised = Math.abs(point.velocity) / range;
    if (normalised > maxNormalisedSpeed) {
      maxNormalisedSpeed = normalised;
      maxVelocityPoint = point;
    }
  }
  const maxVelocityFrame = maxVelocityPoint.frame;

  // Overshoot: how far past the tail value the series travelled in its own
  // direction. A monotone ramp has zero overshoot, so the role falls back to
  // the peak-velocity frame instead of inventing an excursion.
  const tailCount = Math.min(settings.settleSamples, sorted.length);
  const settleValue = median(sorted.slice(-tailCount).map(point => point.value));
  let extreme = sorted[0];
  let extremeDistance = -Infinity;
  for (const point of sorted) {
    const distance = direction >= 0 ? point.value - settleValue : settleValue - point.value;
    if (distance > extremeDistance) {
      extremeDistance = distance;
      extreme = point;
    }
  }
  const overshootThreshold = Math.max(epsilon, range * settings.overshootFraction);
  const overshootDetected = extremeDistance > overshootThreshold
    && extreme.frame !== firstFrame
    && extreme.frame !== sorted[sorted.length - 1].frame;
  const overshootFrame = overshootDetected ? extreme.frame : null;

  // Settle: with the motion direction known, the first frame after the peak
  // where speed drops below threshold and stays there. Requiring the tail is
  // what distinguishes a real settle from the momentary zero of a spring
  // crossing its target.
  const speedAt = new Map(velocity.map(point => [point.frame, Math.abs(point.velocity) / range]));
  let settleFrame = lastFrame;
  const provisionalPeak = Math.max(maxVelocityFrame, overshootFrame ?? maxVelocityFrame);
  const entries = velocity.filter(point => point.frame > provisionalPeak);
  for (let index = 0; index < entries.length; index += 1) {
    let settled = true;
    for (let window = 0; window < settings.settleWindow; window += 1) {
      const probe = entries[index + window];
      if (!probe) break;
      if ((speedAt.get(probe.frame) ?? 0) > settings.settleThreshold) {
        settled = false;
        break;
      }
    }
    if (settled) {
      settleFrame = entries[index].frame;
      break;
    }
  }

  const roles = {
    frame_start: startFrame,
    frame_max_velocity: maxVelocityFrame,
    frame_overshoot_peak: overshootFrame ?? maxVelocityFrame,
    frame_settle: settleFrame
  };
  const frames = [...new Set(Object.values(roles).filter(frame => Number.isFinite(frame)))].sort((a, b) => a - b);

  return {
    elementId,
    animated: true,
    roles,
    frames,
    overshootDetected,
    overshootFrame,
    settleValue: round6(settleValue),
    maxVelocity: round6(maxVelocityPoint.velocity),
    maxNormalisedSpeed: round6(maxNormalisedSpeed),
    startFraction: settings.startFraction,
    settleThreshold: settings.settleThreshold
  };
}

function interpolateBox(states, frame) {
  if (!Array.isArray(states) || states.length === 0) return null;
  const sorted = states
    .filter(state => state?.bbox && Number.isFinite(Number(state.frame)))
    .sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) return null;
  const read = state => ({
    x: finite(state.bbox.x),
    y: finite(state.bbox.y),
    width: finite(state.bbox.width),
    height: finite(state.bbox.height)
  });
  if (frame <= sorted[0].frame) return read(sorted[0]);
  if (frame >= sorted[sorted.length - 1].frame) return read(sorted[sorted.length - 1]);
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const curr = sorted[index];
    if (frame > curr.frame) continue;
    const span = curr.frame - prev.frame;
    const t = span > 0 ? (frame - prev.frame) / span : 0;
    const a = read(prev);
    const b = read(curr);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      width: a.width + (b.width - a.width) * t,
      height: a.height + (b.height - a.height) * t
    };
  }
  return read(sorted[sorted.length - 1]);
}

/**
 * Analyse every property trajectory of one element and return the union of
 * critical frames plus interpolated normalised boxes at those frames.
 *
 * @param {Object} params
 * @param {string} params.elementId
 * @param {Object} [params.trajectories] - {x,y,scale_x,scale_y,rotation,opacity}
 * @param {Array<{frame:number,bbox:{x,y,width,height}}>} [params.states]
 * @param {number} [params.frameWidth=1920]
 * @param {number} [params.frameHeight=1080]
 * @param {Object} [params.options]
 * @returns {Object} Element critical-frame analysis
 */
export function analyzeElementCriticalFrames({
  elementId,
  trajectories,
  states,
  frameWidth = 1920,
  frameHeight = 1080,
  options = {}
}) {
  if (!elementId) fail('CRITICAL_FRAMES_INVALID', 'elementId is required.');

  const properties = ['x', 'y', 'scale_x', 'scale_y', 'rotation', 'opacity'];
  const analyses = [];
  const frames = new Set();
  let animated = false;
  let overshootDetected = false;

  for (const property of properties) {
    const analysis = analyzeCriticalTrajectory({
      elementId,
      points: trajectories?.[property] ?? [],
      options
    });
    if (!analysis) continue;
    analyses.push({ property, ...analysis });
    for (const frame of analysis.frames) frames.add(frame);
    if (analysis.animated) animated = true;
    if (analysis.overshootDetected) overshootDetected = true;
  }

  // The element-level roles take the earliest start, the frame of largest
  // normalised speed and overshoot, and the latest settle. Ties resolve to the
  // smaller frame so the result is stable across property iteration order.
  const roleFrames = { frame_start: null, frame_max_velocity: null, frame_overshoot_peak: null, frame_settle: null };
  const pick = (current, candidate, mode) => {
    if (!Number.isFinite(candidate)) return current;
    if (current === null) return candidate;
    if (mode === 'min') return Math.min(current, candidate);
    if (mode === 'max') return Math.max(current, candidate);
    return current;
  };
  let strongest = null;
  for (const analysis of analyses) {
    if (!analysis.animated) continue;
    roleFrames.frame_start = pick(roleFrames.frame_start, analysis.roles.frame_start, 'min');
    roleFrames.frame_max_velocity = pick(roleFrames.frame_max_velocity, analysis.roles.frame_max_velocity, 'min');
    roleFrames.frame_overshoot_peak = pick(roleFrames.frame_overshoot_peak, analysis.roles.frame_overshoot_peak, 'min');
    roleFrames.frame_settle = pick(roleFrames.frame_settle, analysis.roles.frame_settle, 'max');
    if (!strongest || analysis.maxNormalisedSpeed > strongest.maxNormalisedSpeed) strongest = analysis;
  }
  if (!animated && analyses.length > 0) {
    roleFrames.frame_start = Math.min(...analyses.map(analysis => analysis.roles.frame_start));
    roleFrames.frame_settle = Math.max(...analyses.map(analysis => analysis.roles.frame_settle));
  }
  // Pick the envelope's peak by speed: the per-property minima above make the
  // role useful as a render frame, while `peakProperty` records the cause.
  if (strongest) roleFrames.frame_max_velocity = strongest.roles.frame_max_velocity;
  if (overshootDetected) {
    const overshooting = analyses.find(analysis => analysis.overshootDetected);
    if (overshooting) roleFrames.frame_overshoot_peak = overshooting.overshootFrame;
  }

  const uniqueFrames = [...frames].sort((a, b) => a - b);
  const boxes = {};
  for (const frame of uniqueFrames) {
    const box = interpolateBox(states, frame);
    if (box) {
      boxes[frame] = {
        x: box.x / frameWidth,
        y: box.y / frameHeight,
        width: box.width / frameWidth,
        height: box.height / frameHeight
      };
    }
  }

  return {
    elementId,
    version: CRITICAL_FRAMES_VERSION,
    animated,
    roles: roleFrames,
    frames: uniqueFrames,
    boxes,
    overshootDetected,
    peakProperty: strongest?.property ?? null,
    properties: analyses.map(analysis => ({
      property: analysis.property,
      animated: analysis.animated,
      roles: analysis.roles,
      overshootDetected: analysis.overshootDetected,
      maxNormalisedSpeed: analysis.maxNormalisedSpeed ?? null
    }))
  };
}

/**
 * Shot-level critical-frame detection. `elements` accepts the tracking output
 * shape (`{elementId, trajectories}` plus optional `states`) so Stage 2 can call
 * this directly, and the raw shape (`{id, trajectories, states}`) for callers
 * that have not tracked the shot yet.
 *
 * @param {Object} params
 * @param {Array<Object>} params.elements
 * @param {number} [params.frameWidth=1920]
 * @param {number} [params.frameHeight=1080]
 * @param {Object} [params.options]
 * @returns {Object} Shot critical-frame report
 */
export function detectCriticalFrames({ elements, frameWidth = 1920, frameHeight = 1080, options = {} }) {
  if (!Array.isArray(elements)) fail('CRITICAL_FRAMES_INVALID', 'elements must be an array.');

  const analysed = [];
  const frames = new Set();
  for (const element of elements) {
    const elementId = element?.elementId ?? element?.id;
    if (!elementId) continue;
    const result = analyzeElementCriticalFrames({
      elementId: String(elementId),
      trajectories: element.trajectories,
      states: element.states,
      frameWidth,
      frameHeight,
      options
    });
    analysed.push(result);
    for (const frame of result.frames) frames.add(frame);
  }

  const allFrames = [...frames].sort((a, b) => a - b);
  return {
    version: CRITICAL_FRAMES_VERSION,
    elements: analysed,
    frames: allFrames,
    summary: {
      elementCount: analysed.length,
      animatingElements: analysed.filter(element => element.animated).length,
      frameCount: allFrames.length,
      overshootCount: analysed.filter(element => element.overshootDetected).length
    }
  };
}
