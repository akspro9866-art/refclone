// Stage 3: promote dense tracked rows into procedural motion rules.
//
// A tracked trajectory is partitioned at Stage 1 beats, normalized per beat, and
// compressed with Schneider cubic-bezier fitting. The resulting handles are matched
// against Cavalry's magic-easing presets; a match emits two boundary keyframes and a
// preset name instead of a sampled table. Repeated velocity profiles with a constant
// frame offset collapse into one stagger group.
import fitCurve from 'fit-curve';
import BezierEasing from 'bezier-easing';
import { WorkflowError } from '../core.mjs';
import { normalizeTracks } from './kinematicTracking.mjs';

export const PROMOTION_VERSION = '1.0.0';

export const MOTION_PRESETS = Object.freeze({
  SpringOut: Object.freeze([0.22, 1.4, 0.36, 1]),
  QuarticOut: Object.freeze([0.25, 1, 0.5, 1]),
  CubicInOut: Object.freeze([0.65, 0, 0.35, 1]),
  ExpoOut: Object.freeze([0.16, 1, 0.3, 1]),
  BackOut: Object.freeze([0.34, 1.56, 0.64, 1])
});

const PROPERTIES = Object.freeze([
  { index: 1, attr: 'position.x', places: 1, epsilon: 0.5 },
  { index: 2, attr: 'position.y', places: 1, epsilon: 0.5 },
  { index: 3, attr: 'scale', places: 3, epsilon: 0.002 },
  { index: 4, attr: 'rotation', places: 2, epsilon: 0.05 },
  { index: 5, attr: 'opacity', places: 2, epsilon: 0.1 }
]);

const EPSILON = 1e-6;
const PRESET_TOLERANCE = 0.06;
const SAMPLE_COUNT = 25;

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleAt(points, t) {
  if (points.length === 0) return 0;
  if (t <= points[0][0]) return points[0][1];
  if (t >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    if (t <= x2) {
      const span = x2 - x1;
      return span <= EPSILON ? y2 : lerp(y1, y2, (t - x1) / span);
    }
  }
  return points[points.length - 1][1];
}

function uniformSamples(points, count = SAMPLE_COUNT) {
  return Array.from({ length: count }, (_, index) => sampleAt(points, index / (count - 1)));
}

/** Least-squares y tangents for a cubic with x handles fixed at 1/3 and 2/3. */
export function fitTimingHandles(points) {
  let a11 = 0; let a12 = 0; let a22 = 0; let b1 = 0; let b2 = 0;
  for (const [t, value] of points) {
    const basis1 = 3 * (1 - t) ** 2 * t;
    const basis2 = 3 * (1 - t) * t ** 2;
    const target = value - t ** 3;
    a11 += basis1 * basis1;
    a12 += basis1 * basis2;
    a22 += basis2 * basis2;
    b1 += basis1 * target;
    b2 += basis2 * target;
  }
  const determinant = a11 * a22 - a12 * a12;
  if (Math.abs(determinant) < 1e-12) return [1 / 3, 1, 2 / 3, 1];
  const y1 = (b1 * a22 - b2 * a12) / determinant;
  const y2 = (a11 * b2 - a12 * b1) / determinant;
  return [round(1 / 3, 4), round(y1, 4), round(2 / 3, 4), round(y2, 4)];
}

/** Remaining RMS error of the fitted timing curve against the observed samples. */
export function timingResidual(points, handles) {
  let easing;
  try {
    easing = BezierEasing(handles[0], handles[1], handles[2], handles[3]);
  } catch {
    return 1;
  }
  let sum = 0;
  for (const [t, value] of points) sum += (easing(t) - value) ** 2;
  return Math.sqrt(sum / Math.max(1, points.length));
}

function evaluatePreset(name, handles, points) {
  let easing;
  try {
    easing = BezierEasing(handles[0], handles[1], handles[2], handles[3]);
  } catch {
    return Infinity;
  }
  let sum = 0;
  for (const [t, value] of points) sum += (easing(t) - value) ** 2;
  return Math.sqrt(sum / Math.max(1, points.length));
}

function isDampedSpring(values) {
  if (values.length < 5) return false;
  const maximum = Math.max(...values);
  const minimum = Math.min(...values);
  const overshoot = Math.max(maximum - 1, -minimum);
  if (overshoot < 0.02) return false;
  let direction = 0;
  let turns = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (Math.abs(delta) < 1e-5) continue;
    const next = Math.sign(delta);
    if (direction !== 0 && next !== direction) turns += 1;
    direction = next;
  }
  return overshoot >= 0.02 && turns >= 3;
}

/**
 * Classify one normalized move. Returns either a native magic-easing preset or a
 * compact cubic-bezier timing rule, never a per-frame table.
 */
export function classifyEasing(points, options = {}) {
  const values = points.map(point => point[1]);
  const maximum = Math.max(...values);
  const minimum = Math.min(...values);
  const overshoot = round(Math.max(maximum - 1, -minimum), 4);
  if (options.preferSpring === true || isDampedSpring(values)) {
    return {
      kind: 'preset', name: 'SpringOut', score: 0, overshoot,
      reason: 'velocity shows a damped oscillation about the rest value'
    };
  }
  let best = null;
  for (const [name, handles] of Object.entries(MOTION_PRESETS)) {
    const score = evaluatePreset(name, handles, points);
    if (!best || score < best.score) best = { name, handles: [...handles], score };
  }
  if (best && best.score <= (options.tolerance ?? PRESET_TOLERANCE)) {
    return { kind: 'preset', name: best.name, score: round(best.score, 4), overshoot, handles: best.handles };
  }
  const handles = fitTimingHandles(points);
  return {
    kind: 'bezier', handles, score: round(timingResidual(points, handles), 4), overshoot,
    nearestPreset: best ? { name: best.name, score: round(best.score, 4) } : null
  };
}

export function motionWindow(values, startFrame, minimumQuiet = 0.01) {
  const range = Math.max(...values) - Math.min(...values);
  if (range < EPSILON) return null;
  const quiet = Math.max(minimumQuiet, range * 0.002);
  let firstMotion = -1;
  for (let index = 1; index < values.length; index += 1) {
    if (Math.abs(values[index] - values[index - 1]) > quiet) { firstMotion = index; break; }
  }
  if (firstMotion < 0) return null;
  let lastMotion = firstMotion;
  for (let index = firstMotion + 1; index < values.length; index += 1) {
    if (Math.abs(values[index] - values[index - 1]) > quiet) lastMotion = index;
  }
  // Include the frame that holds the pre-move value and one settle frame, so the
  // normalized curve always starts at 0 and ends at 1.
  const start = Math.max(0, firstMotion - 1);
  const end = Math.min(values.length - 1, lastMotion + 1);
  return end - start >= 1 ? { start: startFrame + start, end: startFrame + end, startIndex: start, endIndex: end } : null;
}

export function promoteMove(rows, startIndex, endIndex, property, options) {
  const from = finite(rows[startIndex][property.index]);
  const to = finite(rows[endIndex][property.index]);
  const frames = endIndex - startIndex;
  if (frames < 1) return null;
  const span = to - from;
  const points = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const t = (rows[index][0] - rows[startIndex][0]) / Math.max(1, rows[endIndex][0] - rows[startIndex][0]);
    points.push([round(t, 6), span === 0 ? 0 : (finite(rows[index][property.index]) - from) / span]);
  }
  let segments = [];
  let fitError = null;
  try {
    segments = fitCurve(points, options.maxError ?? 2);
    if (!Array.isArray(segments)) segments = [];
  } catch {
    segments = [];
  }
  const easing = classifyEasing(points, options);
  const first = points[0];
  const lastPoint = points[points.length - 1];
  if (Math.abs(lastPoint[0] - 1) > 0.25) return null;
  if (Math.abs(lastPoint[1] - 1) > 0.25 && first[1] === 0) {
    // A move that does not end at its normalized value is a pulse, not a settle;
    // keep it custom rather than claiming a preset the samples do not support.
    if (easing.kind === 'preset') easing.kind = 'bezier';
  }
  return {
    attr: property.attr,
    inFrame: rows[startIndex][0],
    outFrame: rows[endIndex][0],
    from: round(from, property.places),
    to: round(to, property.places),
    easing,
    // Kept in the IR (never emitted) so stagger detection compares measured motion,
    // not two classifications that may land on different but equivalent presets.
    profile: uniformSamples(points, 9).map(value => round(value, 4)),
    // `maxError` is the fit-curve tolerance that was requested; `residual` is the
    // actual RMS miss of the emitted easing rule against the measured samples. They
    // are different numbers and neither is allowed to stand in for the other.
    fit: { segments: segments.length, maxError: options.maxError ?? 2, residual: easing.score ?? null }
  };
}

function pulseMoves(rows, property, options) {
  const values = rows.map(row => finite(row[property.index]));
  const range = Math.max(...values) - Math.min(...values);
  if (range < property.epsilon) return [];
  const startValue = values[0];
  const endValue = values[values.length - 1];
  if (Math.abs(endValue - startValue) >= Math.max(property.epsilon, range * 0.01)) return null;
  let extremeIndex = 0;
  let extreme = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    if (Math.abs(values[index] - startValue) > extreme) { extreme = Math.abs(values[index] - startValue); extremeIndex = index; }
  }
  if (extreme < EPSILON || extremeIndex === 0 || extremeIndex === values.length - 1) return [];
  const out = promoteMove(rows, 0, extremeIndex, property, options);
  const back = promoteMove(rows, extremeIndex, values.length - 1, property, options);
  return [out, back].filter(Boolean);
}

/**
 * Promote tracks into layers with two-keyframe moves and stagger groups.
 *
 * options: { maxError = 2.0, beats, tolerance = 0.06, stagger: true }
 */
export function promoteTracks(input, options = {}) {
  const tracks = normalizeTracks(input);
  const beats = Array.isArray(options.beats) ? options.beats : [];
  if (beats.length === 0) {
    const lastFrame = Math.max(0, ...tracks.flatMap(track => track.rows.map(row => row[0])));
    beats.push({ beatIndex: 0, inFrame: 0, peakFrame: Math.round(lastFrame / 2), outFrame: lastFrame });
  }
  const layers = [];
  let inputSamples = 0;
  let frameBakedKeyframes = 0;
  let fitSegments = 0;
  for (const track of tracks) {
    if (track.rows.length === 0) continue;
    inputSamples += track.rows.length;
    const moves = [];
    for (const beat of beats) {
      const rows = track.rows.filter(row => row[0] >= beat.inFrame && row[0] <= beat.outFrame);
      if (rows.length < 2) continue;
      for (const property of PROPERTIES) {
        const values = rows.map(row => finite(row[property.index]));
        if (Math.max(...values) - Math.min(...values) < property.epsilon) continue;
        const direct = pulseMoves(rows, property, options);
        const promoted = direct ?? (() => {
          const window = motionWindow(values, rows[0][0], property.epsilon);
          if (!window) return [];
          const move = promoteMove(rows, window.startIndex, window.endIndex, property, options);
          return move ? [move] : [];
        })();
        for (const move of promoted) {
          moves.push({ ...move, beatIndex: beat.beatIndex });
          fitSegments += move.fit.segments;
        }
        frameBakedKeyframes += rows.length;
      }
    }
    const firstRow = track.rows[0];
    if (moves.length === 0) continue;
    layers.push({
      id: track.id,
      name: track.name,
      type: track.type ?? 'shape',
      text: track.text ?? null,
      vector: track.vector ?? null,
      base: {
        position: { x: round(firstRow[1], 2), y: round(firstRow[2], 2) },
        scale: round(firstRow[3], 4),
        rotation: round(firstRow[4], 3),
        opacity: round(firstRow[5], 2)
      },
      attrs: track.attrs ?? {},
      moves
    });
  }
  const groups = options.stagger === false ? [] : detectStaggerGroups(layers, options);
  // The leader keeps its move; the followers collapse into the group rule.
  for (const group of groups) {
    const followers = new Set(group.memberIds.slice(1));
    for (const layer of layers) {
      if (!followers.has(layer.id)) continue;
      layer.moves = layer.moves.filter(move => move.attr !== group.attr);
      layer.group = group.id;
    }
  }
  const promotedKeyframes = layers.reduce((total, layer) => total + layer.moves.length * 2, 0) + groups.length * 2;
  return {
    version: PROMOTION_VERSION,
    beats,
    layers,
    groups,
    stats: {
      tracks: layers.length,
      inputSamples,
      frameBakedKeyframes,
      promotedKeyframes,
      fitSegments,
      reductionPct: frameBakedKeyframes === 0 ? 0 : round(100 * (1 - promotedKeyframes / frameBakedKeyframes), 2)
    }
  };
}

function easingFunction(easing) {
  try {
    if (easing?.kind === 'preset' && MOTION_PRESETS[easing.name]) {
      const [x1, y1, x2, y2] = MOTION_PRESETS[easing.name];
      return BezierEasing(x1, y1, x2, y2);
    }
    if (easing?.kind === 'bezier' && Array.isArray(easing.handles)) {
      return BezierEasing(easing.handles[0], easing.handles[1], easing.handles[2], easing.handles[3]);
    }
  } catch {
    // Fall through to a linear evaluation; a malformed handle must not break the gate.
  }
  return t => t;
}

function valueAt(layer, attr, frame) {
  const base = attr === 'position.x' ? layer.base?.position?.x
    : attr === 'position.y' ? layer.base?.position?.y
    : attr === 'scale' ? layer.base?.scale
    : attr === 'rotation' ? layer.base?.rotation
    : attr === 'opacity' ? layer.base?.opacity : 0;
  let value = finite(base, attr === 'scale' ? 1 : attr === 'opacity' ? 100 : 0);
  const moves = (layer.moves ?? []).filter(move => move.attr === attr).sort((a, b) => a.inFrame - b.inFrame);
  for (const move of moves) {
    if (frame < move.inFrame) continue;
    if (frame >= move.outFrame) { value = move.to; continue; }
    const t = (frame - move.inFrame) / Math.max(1, move.outFrame - move.inFrame);
    value = move.from + (move.to - move.from) * easingFunction(move.easing)(t);
  }
  return value;
}

/** Evaluate a promoted layer at a frame, for delta patches and diagnostics. */
export function evaluateLayerAt(layer, frame) {
  return {
    position: { x: round(valueAt(layer, 'position.x', frame), 2), y: round(valueAt(layer, 'position.y', frame), 2) },
    scale: round(valueAt(layer, 'scale', frame), 4),
    rotation: round(valueAt(layer, 'rotation', frame), 3),
    opacity: round(valueAt(layer, 'opacity', frame), 2)
  };
}

function sameEasing(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'preset') return a.name === b.name;
  return a.handles.every((value, index) => Math.abs(value - b.handles[index]) <= 0.01);
}

function sameProfile(a, b, tolerance = 0.04) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += (a[index] - b[index]) ** 2;
  return Math.sqrt(sum / a.length) <= tolerance;
}

/**
 * Find layer sets sharing one easing, one duration and a constant start offset.
 * The first member keeps its move as the leader; the rest collapse into one rule.
 */
export function detectStaggerGroups(layers, options = {}) {
  const tolerance = options.staggerTolerance ?? 0.25;
  const candidates = [];
  for (const layer of layers) {
    for (const move of layer.moves) {
      candidates.push({ layerId: layer.id, move, duration: move.outFrame - move.inFrame, delta: move.to - move.from });
    }
  }
  const groups = [];
  const claimed = new Set();
  candidates.sort((a, b) => a.move.inFrame - b.move.inFrame);
  for (let index = 0; index < candidates.length; index += 1) {
    const seed = candidates[index];
    if (claimed.has(`${seed.layerId}\u0000${seed.move.attr}`)) continue;
    const members = [seed];
    for (let other = index + 1; other < candidates.length; other += 1) {
      const candidate = candidates[other];
      if (claimed.has(`${candidate.layerId}\u0000${candidate.move.attr}`)) continue;
      if (candidate.move.attr !== seed.move.attr) continue;
      if (!sameProfile(candidate.move.profile, seed.move.profile) && !sameEasing(candidate.move.easing, seed.move.easing)) continue;
      if (Math.abs(candidate.duration - seed.duration) > 1) continue;
      const scale = Math.max(1, Math.abs(seed.delta));
      if (Math.abs(candidate.delta - seed.delta) / scale > 0.05) continue;
      if (candidate.move.inFrame <= members[members.length - 1].move.inFrame) continue;
      members.push(candidate);
    }
    if (members.length < 3) continue;
    const offsets = [];
    for (let member = 1; member < members.length; member += 1) offsets.push(members[member].move.inFrame - members[member - 1].move.inFrame);
    const delayFrames = Math.round(offsets.reduce((sum, value) => sum + value, 0) / offsets.length);
    if (offsets.some(offset => Math.abs(offset - delayFrames) > 1)) continue;
    const leader = members[0];
    for (const member of members) claimed.add(`${member.layerId}\u0000${member.move.attr}`);
    groups.push({
      id: `stagger-${groups.length + 1}`,
      leaderId: leader.layerId,
      memberIds: members.map(member => member.layerId),
      attr: leader.move.attr,
      inFrame: leader.move.inFrame,
      outFrame: leader.move.outFrame,
      from: leader.move.from,
      to: leader.move.to,
      delayFrames,
      easing: leader.move.easing,
      members: members.length
    });
  }
  return groups;
}
