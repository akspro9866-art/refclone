// Stage 2B: normalize dense point tracks and remove sub-pixel tracking jitter.
//
// The adapter accepts the two shapes trackers actually emit in this workflow:
//   CoTracker3 JSON: { tracks: [{ id, points: [[frame, x, y], ...] }] }
//   element arrays:  [{ id, frames: [[frame, x, y, scale, rotation, opacity], ...] }]
// The output is always one six-column row per frame, which is the contract Stage 3
// promotes. Smoothing is a pure-JavaScript Savitzky-Golay filter: no scipy, no
// native module, identical output on Windows and Ubuntu.
import { WorkflowError } from '../core.mjs';

export const TRACKING_VERSION = '1.0.0';
export const TRACK_FIELDS = Object.freeze(['frame', 'x', 'y', 'scale', 'rotation', 'opacity']);
const DEFAULTS = Object.freeze({ scale: 1, rotation: 0, opacity: 100 });

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function invert(matrix) {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, ...Array.from({ length: size }, (_, column) => (column === index ? 1 : 0))]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let cell = 0; cell < size * 2; cell += 1) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let cell = 0; cell < size * 2; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
    }
  }
  return augmented.map(row => row.slice(size));
}

/**
 * Savitzky-Golay convolution weights for the centre sample of a symmetric window.
 * Derived from the normal equations, so odd windows and polynomial orders do not
 * need a hand-maintained coefficient table.
 */
export function savitzkyGolayWeights(window = 7, order = 3) {
  const size = Math.max(3, Math.round(window) % 2 === 0 ? Math.round(window) + 1 : Math.round(window));
  const degree = Math.max(1, Math.min(Math.round(order), size - 1));
  const half = (size - 1) / 2;
  const normal = Array.from({ length: degree + 1 }, (_, row) =>
    Array.from({ length: degree + 1 }, (_, column) => {
      let sum = 0;
      for (let offset = -half; offset <= half; offset += 1) sum += offset ** (row + column);
      return sum;
    }));
  const inverse = invert(normal);
  if (!inverse) return new Array(size).fill(1 / size);
  // The fitted value at offset 0 is e0^T (A^T A)^-1 A^T y, so each weight is
  // the first row of the inverse multiplied by the matching power of the offset.
  return Array.from({ length: size }, (_, index) => {
    const offset = index - half;
    let weight = 0;
    for (let power = 0; power <= degree; power += 1) weight += inverse[0][power] * offset ** power;
    return weight;
  });
}

function smoothedChannel(values, weights) {
  const half = (weights.length - 1) / 2;
  return values.map((_, index) => {
    let total = 0;
    let used = 0;
    for (let offset = -half; offset <= half; offset += 1) {
      const at = Math.max(0, Math.min(values.length - 1, index + offset));
      total += values[at] * weights[offset + half];
      used += weights[offset + half];
    }
    return used === 0 ? values[index] : total / used;
  });
}

/** Fill missing frames by linear interpolation before smoothing, preserving frame numbers. */
function densify(rows) {
  if (rows.length === 0) return [];
  const byFrame = new Map();
  for (const row of rows) byFrame.set(Math.round(row[0]), row);
  const sortedFrames = [...byFrame.keys()].sort((a, b) => a - b);
  const start = sortedFrames[0];
  const end = sortedFrames[sortedFrames.length - 1];
  const dense = [];
  for (let frame = start; frame <= end; frame += 1) {
    const exact = byFrame.get(frame);
    if (exact) { dense.push(exact.slice()); continue; }
    let before = null;
    let after = null;
    for (const known of sortedFrames) {
      if (known < frame) before = known;
      if (known > frame) { after = known; break; }
    }
    const left = byFrame.get(before);
    const right = byFrame.get(after);
    if (!left || !right) continue;
    const span = right[0] - left[0] || 1;
    const t = (frame - left[0]) / span;
    dense.push([frame, ...Array.from({ length: 5 }, (_, index) => round(left[index + 1] + (right[index + 1] - left[index + 1]) * t))]);
  }
  return dense;
}

function normalizeRow(row, index) {
  const frame = Math.round(finite(row?.frame ?? row?.[0], index));
  return [
    frame,
    finite(row?.x ?? row?.[1], 0),
    finite(row?.y ?? row?.[2], 0),
    finite(row?.scale ?? row?.[3], DEFAULTS.scale),
    finite(row?.rotation ?? row?.[4], DEFAULTS.rotation),
    finite(row?.opacity ?? row?.[5], DEFAULTS.opacity)
  ];
}

/** Normalize CoTracker3 JSON, element rows, or a bare row array into track records. */
export function normalizeTracks(input) {
  if (!input || typeof input !== 'object') {
    throw new WorkflowError('TRACKS_INVALID', 'Tracks must be an object or array.');
  }
  const elements = Array.isArray(input) ? input : (input.elements ?? input.tracks ?? input);
  if (!Array.isArray(elements)) throw new WorkflowError('TRACKS_INVALID', 'Tracks must contain an array of elements.');
  return elements.map((element, index) => {
    const id = String(element.id ?? element.name ?? `track-${index}`);
    let rows = null;
    if (Array.isArray(element.rows) && Array.isArray(element.rows[0])) rows = element.rows;
    else if (Array.isArray(element.frames) && Array.isArray(element.frames[0])) rows = element.frames;
    else if (Array.isArray(element.samples) && Array.isArray(element.samples[0])) rows = element.samples;
    else if (Array.isArray(element.points)) {
      const visibility = element.visibility ?? element.visibilities ?? null;
      rows = element.points.map((point, pointIndex) => {
        const visible = visibility ? visibility[pointIndex] : true;
        return [point[0], point[1], point[2], element.scale ?? DEFAULTS.scale, element.rotation ?? DEFAULTS.rotation, visible === false ? 0 : (element.opacity ?? DEFAULTS.opacity)];
      });
    } else if (Array.isArray(element.x) && Array.isArray(element.y)) {
      const frames = Array.isArray(element.frame) ? element.frame : element.x.map((_, row) => row);
      rows = element.x.map((value, row) => [frames[row], value, element.y[row], element.scale?.[row] ?? DEFAULTS.scale, element.rotation?.[row] ?? DEFAULTS.rotation, element.opacity?.[row] ?? DEFAULTS.opacity]);
    }
    if (!rows || rows.length === 0) return { id, name: element.name ?? id, rows: [] };
    const normalized = densify(rows.map(normalizeRow));
    return {
      id,
      name: String(element.name ?? id),
      rows: normalized,
      type: element.type ?? null,
      text: element.text ?? null,
      vector: element.vector ?? null,
      attrs: element.attrs ?? null
    };
  });
}

export function smoothRows(rows, options = {}) {
  if (rows.length < 3) return rows.map(row => row.map((value, index) => (index === 0 ? Math.round(value) : round(value))));
  const window = Math.max(3, Math.round(Number(options.window ?? 7)));
  const order = Math.max(1, Math.round(Number(options.order ?? 3)));
  const weights = savitzkyGolayWeights(window, order);
  const half = (weights.length - 1) / 2;
  const frames = rows.map(row => row[0]);
  const channels = Array.from({ length: 5 }, (_, channel) => smoothedChannel(rows.map(row => row[channel + 1]), weights));
  // A polynomial fit at the track boundary leans on repeated padding and invents a
  // start value that never existed. Keep the first/last window untouched so the
  // promoted `from` is the measured pose and the onset timing is not shifted.
  return frames.map((frame, index) => {
    const atEdge = index < half || index >= frames.length - half;
    return [Math.round(frame), ...channels.map((channel, channelIndex) => round(atEdge ? rows[index][channelIndex + 1] : channel[index]))];
  });
}

/** Normalize then smooth every track. */
export function smoothTracks(tracks, options = {}) {
  return normalizeTracks(tracks).map(track => ({
    ...track,
    rows: smoothRows(track.rows, options),
    smoothing: { window: Math.max(3, Math.round(Number(options.window ?? 7))), order: Math.max(1, Math.round(Number(options.order ?? 3))) }
  }));
}

/** Velocity magnitude between adjacent rows, used by Stage 1 and Stage 3. */
export function rowVelocities(rows) {
  return rows.map((row, index) => {
    if (index === 0) return 0;
    const previous = rows[index - 1];
    const dx = row[1] - previous[1];
    const dy = row[2] - previous[2];
    return round(Math.hypot(dx, dy), 5);
  });
}
