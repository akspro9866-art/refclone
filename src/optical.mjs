/**
 * Optical Flow and Geometry Primitives — Stage 1/2 measurement support
 *
 * Lightweight, dependency-free, deterministic pixel math over decoded RGBA
 * frames (pngjs PNG objects or plain {data, width, height} RGBA buffers).
 * Every function here is a measurement primitive: it proposes evidence, it
 * never decides what a motion "means". Callers review and decide.
 *
 * All routines operate on grayscaled pixels (Rec. 601 luma) and use only
 * typed arrays and closed-form linear algebra, so results are reproducible
 * bit-for-bit on the same inputs.
 */

import { WorkflowError } from './core.mjs';

export const OPTICAL_VERSION = '1.0.0';

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Normalize a frame argument into a plain RGBA descriptor.
 * Accepts a pngjs PNG or any {data, width, height} RGBA buffer.
 *
 * @param {Object} frame - Decoded RGBA frame.
 * @param {string} label - Argument label used in error messages.
 * @returns {{data: Uint8Array, width: number, height: number}}
 */
function rgbaOf(frame, label) {
  const data = frame?.data ?? null;
  const width = frame?.width ?? 0;
  const height = frame?.height ?? 0;
  if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    fail('OPTICAL_INVALID', `${label} must be a decoded RGBA frame ({data, width, height}).`);
  }
  if (data.length < width * height * 4) {
    fail('OPTICAL_INVALID', `${label} data is shorter than width*height*4 bytes.`);
  }
  return { data, width, height };
}

/**
 * Convert a decoded RGBA frame to a Rec. 601 grayscale plane.
 * Alpha is ignored (a decoded video frame carries no usable per-pixel alpha).
 *
 * @param {Object} frame - pngjs PNG or {data, width, height} RGBA buffer.
 * @returns {{gray: Float32Array, width: number, height: number}} Grayscale plane.
 */
export function toGrayScale(frame) {
  const { data, width, height } = rgbaOf(frame, 'frame');
  const gray = new Float32Array(width * height);
  for (let p = 0, at = 0; p < gray.length; p += 1, at += 4) {
    gray[p] = 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2];
  }
  return { gray, width, height };
}

/**
 * Clamp a box to frame bounds and return integer pixel extents.
 * @returns {{x0: number, y0: number, x1: number, y1: number}} Half-open extents.
 */
function clampBox(box, width, height, label) {
  const bx = Number(box?.x);
  const by = Number(box?.y);
  const bw = Number(box?.width);
  const bh = Number(box?.height);
  if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bw) || !Number.isFinite(bh)) {
    fail('OPTICAL_INVALID', `${label} box must have finite x, y, width, height.`);
  }
  const x0 = Math.max(0, Math.floor(bx));
  const y0 = Math.max(0, Math.floor(by));
  const x1 = Math.min(width, Math.ceil(bx + bw));
  const y1 = Math.min(height, Math.ceil(by + bh));
  return { x0, y0, x1, y1 };
}

/**
 * Median of a numeric array (average of the two middle values for even counts).
 * Deterministic; returns 0 for an empty array.
 */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Per-tracklet velocity of a bbox region between two decoded frames via
 * coarse-to-fine block matching.
 *
 * The block at the region center (or a small deterministic grid of blocks for
 * larger regions, aggregated by median) is matched between frameA and frameB
 * by minimizing the sum of absolute differences (SAD) on grayscale pixels
 * inside the search radius. A parabolic fit over the SAD neighbourhood gives
 * sub-pixel displacement. Confidence combines match quality and the
 * distinctness of the minimum: a textureless region reports confidence 0
 * rather than inventing a direction.
 *
 * @param {Object} frameA - Decoded RGBA frame at time t.
 * @param {Object} frameB - Decoded RGBA frame at time t+1.
 * @param {{x: number, y: number, width: number, height: number}} box - Region in pixels.
 * @param {Object} [options]
 * @param {number} [options.searchRadius=8] - Maximum integer displacement searched (px).
 * @param {number} [options.blockSize=8] - Square block side (px, even number recommended).
 * @param {number} [options.stride=2] - Coarse pass step (px); refined down to 1.
 * @returns {{vx: number, vy: number, magnitude: number, confidence: number}}
 *   Displacement of the region content from frameA to frameB, in pixels.
 */
export function blockFlow(frameA, frameB, box, options = {}) {
  const a = toGrayScale(frameA);
  const b = toGrayScale(frameB);
  if (a.width !== b.width || a.height !== b.height) {
    fail('OPTICAL_INVALID', 'blockFlow frames must have identical dimensions.');
  }
  const { gray: ga, width, height } = a;
  const gb = b.gray;

  const searchRadius = Math.max(1, Math.floor(options.searchRadius ?? 8));
  const blockSize = Math.max(2, Math.floor(options.blockSize ?? 8));
  const coarseStride = Math.max(1, Math.min(Math.floor(options.stride ?? 2), searchRadius));

  const { x0, y0, x1, y1 } = clampBox(box, width, height, 'blockFlow');
  if (x1 - x0 < 4 || y1 - y0 < 4) {
    fail('OPTICAL_INVALID', 'blockFlow box is too small after clamping to the frame (minimum 4x4 px).');
  }

  const half = Math.floor(blockSize / 2);
  const blockSide = half * 2; // keep the block even so the center is unambiguous

  // Deterministic block-center grid: stride blockSize across the box interior,
  // capped at 5 positions per axis by even resampling.
  const axisPositions = (lo, hi) => {
    const raw = [];
    for (let at = lo; at <= hi; at += blockSize) raw.push(at);
    if (raw.length > 5) {
      const picked = [];
      for (let k = 0; k < 5; k++) picked.push(raw[Math.round((k * (raw.length - 1)) / 4)]);
      return [...new Set(picked)];
    }
    return raw.length ? raw : [Math.floor((lo + hi) / 2)];
  };

  const centersX = axisPositions(x0 + half, x1 - 1 - half);
  const centersY = axisPositions(y0 + half, y1 - 1 - half);

  const flows = [];
  for (const cy of centersY) {
    for (const cx of centersX) {
      const flow = matchBlock(ga, gb, width, height, cx, cy, blockSide, searchRadius, coarseStride);
      if (flow) flows.push(flow);
    }
  }

  if (!flows.length) {
    return { vx: 0, vy: 0, magnitude: 0, confidence: 0 };
  }
  const vx = median(flows.map(f => f.vx));
  const vy = median(flows.map(f => f.vy));
  const confidence = median(flows.map(f => f.confidence));
  return { vx, vy, magnitude: Math.hypot(vx, vy), confidence };
}

/**
 * Match one block: coarse-to-fine SAD search around (cx, cy) from frame A
 * into frame B. Returns null when the block has no texture or no valid
 * candidate displacement exists.
 */
function matchBlock(ga, gb, width, height, cx, cy, side, searchRadius, coarseStride) {
  const half = side / 2;
  const x0 = cx - half;
  const y0 = cy - half;
  if (x0 < 0 || y0 < 0 || x0 + side > width || y0 + side > height) return null;

  // Block texture guard: a flat block cannot disambiguate displacement.
  let mean = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) mean += ga[(y0 + y) * width + x0 + x];
  }
  mean /= side * side;
  let variance = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const d = ga[(y0 + y) * width + x0 + x] - mean;
      variance += d * d;
    }
  }
  const std = Math.sqrt(variance / (side * side));
  if (std < 0.5) return null;

  // Candidate displacement range keeps the block fully inside frame B.
  const dxMin = Math.max(-searchRadius, -x0);
  const dxMax = Math.min(searchRadius, width - (x0 + side));
  const dyMin = Math.max(-searchRadius, -y0);
  const dyMax = Math.min(searchRadius, height - (y0 + side));
  if (dxMin > dxMax || dyMin > dyMax) return null;

  const sad = (dx, dy) => {
    let sum = 0;
    for (let y = 0; y < side; y++) {
      const aRow = (y0 + y) * width + x0;
      const bRow = (y0 + y + dy) * width + x0 + dx;
      for (let x = 0; x < side; x++) {
        sum += Math.abs(ga[aRow + x] - gb[bRow + x]);
      }
    }
    return sum;
  };

  // Coarse-to-fine passes: step halves each pass, window shrinks to the
  // previous step around the current best. Deterministic tie-break: prefer
  // the smaller total displacement, then the smaller |dx|, then |dy|.
  const better = (cand, best) => {
    if (!best) return true;
    if (cand.sad !== best.sad) return cand.sad < best.sad;
    const candCost = Math.abs(cand.dx) + Math.abs(cand.dy);
    const bestCost = Math.abs(best.dx) + Math.abs(best.dy);
    if (candCost !== bestCost) return candCost < bestCost;
    if (Math.abs(cand.dx) !== Math.abs(best.dx)) return Math.abs(cand.dx) < Math.abs(best.dx);
    return cand.dy < best.dy;
  };

  let best = null;
  let step = coarseStride;
  let window = searchRadius;
  const evaluated = [];
  while (true) {
    evaluated.length = 0;
    for (let dy = Math.max(dyMin, best ? best.dy - window : dyMin);
         dy <= Math.min(dyMax, best ? best.dy + window : dyMax);
         dy += step) {
      for (let dx = Math.max(dxMin, best ? best.dx - window : dxMin);
           dx <= Math.min(dxMax, best ? best.dx + window : dxMax);
           dx += step) {
        const candidate = { dx, dy, sad: sad(dx, dy) };
        evaluated.push(candidate);
        if (better(candidate, best)) best = candidate;
      }
    }
    if (step === 1) break;
    const nextStep = Math.max(1, Math.floor(step / 2));
    window = step;
    step = nextStep;
  }
  if (!best) return null;

  // Parabolic sub-pixel refinement on the SAD surface around the best integer.
  const refine = (minus, zero, plus) => {
    if (minus === null || plus === null) return 0;
    const denom = minus - 2 * zero + plus;
    if (!(denom > 1e-9)) return 0;
    return Math.max(-0.5, Math.min(0.5, (0.5 * (minus - plus)) / denom));
  };
  const sadXm = inRange(best.dx - 1, best.dy) ? sad(best.dx - 1, best.dy) : null;
  const sadXp = inRange(best.dx + 1, best.dy) ? sad(best.dx + 1, best.dy) : null;
  const sadYm = inRange(best.dx, best.dy - 1) ? sad(best.dx, best.dy - 1) : null;
  const sadYp = inRange(best.dx, best.dy + 1) ? sad(best.dx, best.dy + 1) : null;
  const vx = best.dx + refine(sadXm, best.sad, sadXp);
  const vy = best.dy + refine(sadYm, best.sad, sadYp);

  // Distinctness of the minimum: best SAD vs the best SAD at least 2 px away.
  let second = Infinity;
  for (const candidate of evaluated) {
    if (Math.max(Math.abs(candidate.dx - best.dx), Math.abs(candidate.dy - best.dy)) >= 2) {
      if (candidate.sad < second) second = candidate.sad;
    }
  }
  if (!Number.isFinite(second)) second = best.sad;
  const distinctness = clamp01((second - best.sad) / (second + best.sad + 1e-9) * 2);
  const quality = clamp01(1 - best.sad / (side * side * 255));
  const confidence = std < 0.5 ? 0 : quality * distinctness;

  return { vx, vy, confidence };

  function inRange(dx, dy) {
    return dx >= dxMin && dx <= dxMax && dy >= dyMin && dy <= dyMax;
  }
}

/**
 * Frames where the signed acceleration of a velocity-magnitude series crosses
 * zero, excluding flats below epsilon.
 *
 * Acceleration at sample i (i >= 1) is the forward difference
 * (v[i] - v[i-1]) / (frame[i] - frame[i-1]). A crossing is reported at the
 * frame of the first sample whose acceleration sign differs from the previous
 * non-flat acceleration sign; samples with |acceleration| <= epsilon are
 * treated as flats and never start or end a crossing.
 *
 * @param {number[]|Array<{frame: number, velocity: number}>} velocitySeries
 *   Plain magnitudes (frames are array indices) or {frame, velocity} records.
 *   {frame, magnitude} and {frame, value} records are also accepted.
 * @param {Object} [options]
 * @param {number} [options.epsilon=1e-6] - Flat threshold on acceleration.
 * @returns {number[]} Frames where the acceleration changes sign.
 */
export function accelerationZeroCrossings(velocitySeries, options = {}) {
  if (!Array.isArray(velocitySeries) || velocitySeries.length < 3) return [];
  const epsilon = Math.max(0, options.epsilon ?? 1e-6);

  const samples = velocitySeries.map((entry, index) => {
    if (typeof entry === 'number') return { frame: index, velocity: entry };
    const frame = Number.isFinite(entry?.frame) ? entry.frame : index;
    const velocity = entry?.velocity ?? entry?.magnitude ?? entry?.value;
    return { frame, velocity: Number(velocity) };
  });
  for (const sample of samples) {
    if (!Number.isFinite(sample.velocity)) return [];
  }

  const acceleration = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].frame - samples[i - 1].frame;
    acceleration.push({
      frame: samples[i].frame,
      value: dt > 0 ? (samples[i].velocity - samples[i - 1].velocity) / dt : 0
    });
  }

  const crossings = [];
  let lastSign = 0;
  for (const point of acceleration) {
    if (Math.abs(point.value) <= epsilon) continue;
    const sign = point.value > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) crossings.push(point.frame);
    lastSign = sign;
  }
  return crossings;
}

/**
 * Fit 2-4 cubic Bezier segments to the largest contour of a binary mask.
 *
 * The contour is extracted with Moore-neighbor tracing over the largest
 * 8-connected foreground component, resampled by arc length, and each candidate
 * segment count K in [minSegments, maxSegments] is fitted by least squares with
 * chord-length parameterization (split points snap to the strongest local
 * turning angle so rectangles and polygons split at corners). The K with the
 * lowest RMS error wins; ties keep the smaller K.
 *
 * @param {Uint8Array|{data: Uint8Array, width: number, height: number}} mask
 *   Binary mask of 0/255 (any non-zero byte counts as foreground). Pass a bare
 *   Uint8Array together with options.width/options.height.
 * @param {Object} [options]
 * @param {number} [options.width] - Mask width when a bare Uint8Array is given.
 * @param {number} [options.height] - Mask height when a bare Uint8Array is given.
 * @param {number} [options.minSegments=2]
 * @param {number} [options.maxSegments=4]
 * @param {number} [options.sampleCount=96] - Arc-length resample count.
 * @returns {{segments: Array<{p0: Object, p1: Object, p2: Object, p3: Object}>,
 *            controlPoints: Array<{x: number, y: number}>, closed: boolean,
 *            errorRms: number}}
 *   Segments are ordered along the contour; errorRms is in pixels.
 */
export function fitContourBezier(mask, options = {}) {
  const normalized = mask instanceof Uint8Array
    ? { data: mask, width: options.width, height: options.height }
    : { data: mask?.data, width: mask?.width, height: mask?.height };
  const width = Number(normalized.width);
  const height = Number(normalized.height);
  if (!normalized.data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    fail('OPTICAL_INVALID', 'fitContourBezier needs a binary mask with width and height.');
  }

  const component = labelLargestComponent(normalized.data, width, height);
  if (!component) {
    return { segments: [], controlPoints: [], closed: true, errorRms: 0 };
  }
  const boundary = traceBoundary(component, width, height);
  if (boundary.length < 8) {
    return { segments: [], controlPoints: [], closed: true, errorRms: 0 };
  }

  const minSegments = Math.max(1, Math.floor(options.minSegments ?? 2));
  const maxSegments = Math.max(minSegments, Math.floor(options.maxSegments ?? 4));
  const sampleCount = Math.max(3 * minSegments, Math.min(512, Math.floor(options.sampleCount ?? 96)));
  const samples = resampleClosed(boundary, sampleCount);

  let best = null;
  for (let k = minSegments; k <= maxSegments; k++) {
    const fit = fitClosedBezier(samples, k);
    if (!best || fit.errorRms < best.errorRms) best = fit;
  }
  return { segments: best.segments, controlPoints: best.segments.flatMap(s => [s.p0, s.p1, s.p2, s.p3]), closed: true, errorRms: best.errorRms };
}

/**
 * Label the largest 8-connected foreground component (any non-zero byte).
 * @returns {Object|null} {labels: Int32Array, label: number, count: number, start: {x, y}}
 */
function labelLargestComponent(data, width, height) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  let bestLabel = 0;
  let bestCount = 0;
  let bestStart = -1;
  let nextLabel = 0;
  for (let seed = 0; seed < labels.length; seed++) {
    if (data[seed] === 0 || labels[seed] !== 0) continue;
    nextLabel += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    labels[seed] = nextLabel;
    let count = 0;
    let start = -1;
    while (head < tail) {
      const at = queue[head++];
      count += 1;
      if (start < 0) start = at;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nAt = ny * width + nx;
          if (data[nAt] !== 0 && labels[nAt] === 0) {
            labels[nAt] = nextLabel;
            queue[tail++] = nAt;
          }
        }
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestLabel = nextLabel;
      bestStart = start;
    }
  }
  if (!bestLabel) return null;
  const sx = bestStart % width;
  const sy = (bestStart - sx) / width;
  return { labels, label: bestLabel, count: bestCount, start: { x: sx, y: sy } };
}

const MOORE_DIRS = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

/**
 * Moore-neighbor boundary trace of a labeled component, starting at its
 * first row-major pixel (topmost, then leftmost) and walking clockwise.
 * @param {Object} component - {labels, label, count, start} from labelLargestComponent.
 * @returns {Array<{x: number, y: number}>} Ordered contour vertices (closed loop).
 */
function traceBoundary(component, width, height) {
  const { labels, label, start } = component;
  const belongs = (x, y) => x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label;

  const boundary = [start];
  let current = start;
  // The pixel west of the row-major-first pixel is always background.
  let backtrack = 0; // index into MOORE_DIRS: -1,0 = west
  const maxSteps = 8 * labels.length + 8;
  for (let step = 0; step < maxSteps; step++) {
    let found = -1;
    let previous = -1;
    for (let k = 1; k <= 8; k++) {
      const index = (backtrack + k) % 8;
      const nx = current.x + MOORE_DIRS[index][0];
      const ny = current.y + MOORE_DIRS[index][1];
      if (belongs(nx, ny)) {
        found = index;
        previous = (backtrack + k - 1) % 8;
        break;
      }
    }
    if (found < 0) break; // isolated single-pixel component
    const next = { x: current.x + MOORE_DIRS[found][0], y: current.y + MOORE_DIRS[found][1] };
    if (next.x === start.x && next.y === start.y) break; // loop closed
    // Re-express the backtrack pixel (last background visited) relative to next.
    const bx = current.x + MOORE_DIRS[previous][0];
    const by = current.y + MOORE_DIRS[previous][1];
    let newBacktrack = 0;
    for (let d = 0; d < 8; d++) {
      if (MOORE_DIRS[d][0] === bx - next.x && MOORE_DIRS[d][1] === by - next.y) {
        newBacktrack = d;
        break;
      }
    }
    backtrack = newBacktrack;
    boundary.push(next);
    current = next;
  }
  return boundary;
}

/**
 * Resample a closed polyline to evenly spaced points by arc length
 * (linear interpolation along each edge).
 */
function resampleClosed(points, count) {
  const n = points.length;
  const lengths = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    lengths[i + 1] = lengths[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = lengths[n];
  if (!(total > 0)) return points.slice(0, Math.max(3, Math.min(n, count)));
  const samples = [];
  let edge = 0;
  for (let k = 0; k < count; k++) {
    const target = (k * total) / count;
    while (edge < n - 1 && lengths[edge + 1] < target) edge += 1;
    const a = points[edge];
    const b = points[(edge + 1) % n];
    const span = lengths[edge + 1] - lengths[edge];
    const t = span > 0 ? (target - lengths[edge]) / span : 0;
    samples.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  return samples;
}

/**
 * Strongest local turning angle at sample i of a closed polyline.
 */
function turningAngle(samples, i, n) {
  const a = samples[(i - 1 + n) % n];
  const b = samples[i];
  const c = samples[(i + 1) % n];
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const bx = c.x - b.x;
  const by = c.y - b.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (!(la > 0) || !(lb > 0)) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return Math.acos(cos);
}

/**
 * Least-squares fit of a closed cubic Bezier chain with K spans over the
 * sampled contour. Split points divide samples evenly, then snap to the
 * strongest local turn within a bounded window (corners of polygons).
 */
function fitClosedBezier(samples, k) {
  const n = samples.length;
  const base = Math.floor(n / k);
  const splits = [0];
  const snapWindow = Math.max(2, Math.min(base - 1, Math.floor(n / (4 * k))));
  for (let j = 1; j < k; j++) {
    const nominal = j * base;
    let bestIndex = nominal;
    let bestTurn = -1;
    for (let c = Math.max(1, nominal - snapWindow); c <= Math.min(n - 1, nominal + snapWindow); c++) {
      const turn = turningAngle(samples, c, n);
      if (turn > bestTurn + 1e-12) {
        bestTurn = turn;
        bestIndex = c;
      }
    }
    splits.push(Math.max(splits[j - 1] + 1, Math.min(n - 1, bestIndex)));
  }

  const segments = [];
  let squaredError = 0;
  let counted = 0;
  for (let j = 0; j < k; j++) {
    const from = splits[j];
    const to = j + 1 < k ? splits[j + 1] : n; // last span wraps to sample 0
    const p0 = samples[from % n];
    const p3 = samples[to % n];
    const span = to - from;
    if (span < 1) {
      segments.push({ p0, p1: { ...p0 }, p2: { ...p3 }, p3 });
      continue;
    }
    // Chord-length parameterization within the span.
    const ts = new Float64Array(span + 1);
    let chord = 0;
    for (let s = 0; s < span; s++) {
      const a = samples[(from + s) % n];
      const b = samples[(from + s + 1) % n];
      chord += Math.hypot(b.x - a.x, b.y - a.y);
      ts[s + 1] = chord;
    }
    for (let s = 0; s <= span; s++) ts[s] = chord > 0 ? ts[s] / chord : s / span;

    // Least squares for the interior handles with fixed endpoints.
    let b11 = 0; let b12 = 0; let b22 = 0;
    let rx1 = 0; let rx2 = 0; let ry1 = 0; let ry2 = 0;
    for (let s = 0; s <= span; s++) {
      const t = ts[s];
      const p = samples[(from + s) % n];
      const w0 = (1 - t) ** 3;
      const w3 = t ** 3;
      const w1 = 3 * (1 - t) ** 2 * t;
      const w2 = 3 * (1 - t) * t ** 2;
      const dx = p.x - (w0 * p0.x + w3 * p3.x);
      const dy = p.y - (w0 * p0.y + w3 * p3.y);
      b11 += w1 * w1; b12 += w1 * w2; b22 += w2 * w2;
      rx1 += w1 * dx; rx2 += w2 * dx;
      ry1 += w1 * dy; ry2 += w2 * dy;
    }
    const det = b11 * b22 - b12 * b12;
    let p1;
    let p2;
    if (Math.abs(det) < 1e-12) {
      p1 = { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 };
      p2 = { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 };
    } else {
      p1 = { x: (b22 * rx1 - b12 * rx2) / det, y: (b22 * ry1 - b12 * ry2) / det };
      p2 = { x: (b11 * rx2 - b12 * rx1) / det, y: (b11 * ry2 - b12 * ry1) / det };
    }
    segments.push({ p0, p1, p2, p3 });

    // Residuals: interior samples of the span (endpoints lie on the curve).
    for (let s = 1; s < span; s++) {
      const t = ts[s];
      const p = samples[(from + s) % n];
      const w0 = (1 - t) ** 3;
      const w1 = 3 * (1 - t) ** 2 * t;
      const w2 = 3 * (1 - t) * t ** 2;
      const w3 = t ** 3;
      const cx = w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x;
      const cy = w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y;
      squaredError += (p.x - cx) ** 2 + (p.y - cy) ** 2;
      counted += 1;
    }
  }
  const errorRms = counted > 0 ? Math.sqrt(squaredError / counted) : 0;
  return { segments, errorRms };
}

/**
 * Solve the fixed pivot (invariant center of rotation) of a rigid body from
 * samples of one tracked point across frames.
 *
 * A Kasa circle fit (linear least squares on x^2 + y^2 = A*x + B*y + C) gives
 * the initial center, which is then refined by gradient descent on the
 * variance of the radii |p - pivot|. The point is reported as a rotation only
 * when the fitted radius stays proportional to the sample spread and the
 * residual is small: collinear (linear motion) or scattered samples fall back
 * to the centroid with isRotation false.
 *
 * @param {Array<{x: number, y: number, angle?: number}>} samples
 *   Tracked-point positions per frame; angle is accepted for forward
 *   compatibility and is not required by the solver.
 * @param {Object} [options]
 * @param {number} [options.maxRadiusSpread=50] - Reject radii beyond this multiple of the spread.
 * @param {number} [options.residualRatioMax=0.1] - Max residualRms as a fraction of the radius.
 * @returns {{pivotX: number, pivotY: number, residualRms: number, isRotation: boolean}}
 */
export function solvePivot(samples, options = {}) {
  const points = (Array.isArray(samples) ? samples : [])
    .map(s => ({ x: Number(s?.x), y: Number(s?.y) }))
    .filter(s => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (!points.length) {
    fail('OPTICAL_INVALID', 'solvePivot needs at least one finite {x, y} sample.');
  }

  const centroid = points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }), { x: 0, y: 0 });
  const radiusStats = (px, py) => {
    const radii = points.map(p => Math.hypot(p.x - px, p.y - py));
    const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    const variance = radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length;
    return { radii, mean, rms: Math.sqrt(variance) };
  };
  const spread = Math.sqrt(points.reduce((sum, p) => sum + (p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2, 0) / points.length);

  const maxRadiusSpread = Math.max(1, options.maxRadiusSpread ?? 50);
  const residualRatioMax = Math.max(0, options.residualRatioMax ?? 0.1);

  // Fewer than three samples cannot define a circle.
  if (points.length < 3 || spread < 1e-12) {
    const stats = radiusStats(centroid.x, centroid.y);
    return { pivotX: centroid.x, pivotY: centroid.y, residualRms: stats.rms, isRotation: false };
  }

  // Kasa fit: normal equations for x^2 + y^2 = A*x + B*y + C.
  let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0;
  let sxz = 0; let syz = 0; let sz = 0;
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y;
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  const scale = Math.max(1, Math.abs(sxx), Math.abs(syy), Math.abs(sz));
  const solution = solve3x3(
    [sxx, sxy, sx, sxy, syy, sy, sx, sy, points.length],
    [sxz, syz, sz],
    1e-12 * scale * scale
  );

  let pivot = { x: centroid.x, y: centroid.y };
  let degenerate = !solution;
  if (!degenerate) {
    pivot = { x: solution[0] / 2, y: solution[1] / 2 };
    const radius = radiusStats(pivot.x, pivot.y).mean;
    if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y) || !(radius > 1e-9) || radius > maxRadiusSpread * spread) {
      degenerate = true;
    }
  }

  if (!degenerate) {
    // Gradient descent on the variance of radii, with deterministic backtracking.
    pivot = refinePivot(points, pivot);
  } else {
    pivot = { x: centroid.x, y: centroid.y };
  }

  const stats = radiusStats(pivot.x, pivot.y);
  const residualRms = stats.rms;
  const isRotation = !degenerate
    && stats.mean > 1e-9
    && stats.mean <= maxRadiusSpread * spread
    && residualRms <= Math.max(residualRatioMax * stats.mean, 1e-9);
  return { pivotX: pivot.x, pivotY: pivot.y, residualRms, isRotation };
}

/**
 * Refine the pivot by minimizing var(|p - pivot|) via gradient descent with
 * backtracking line search. Deterministic: fixed iteration caps, no randomness.
 */
function refinePivot(points, start) {
  const variance = (px, py) => {
    const radii = points.map(p => Math.hypot(p.x - px, p.y - py));
    const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    return radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length;
  };

  let pivot = { ...start };
  let current = variance(pivot.x, pivot.y);
  let step = Math.sqrt(current) / 4 || 1;
  for (let iter = 0; iter < 64 && step > 1e-12; iter++) {
    const radii = points.map(p => Math.hypot(p.x - pivot.x, p.y - pivot.y));
    const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < points.length; i++) {
      const r = radii[i];
      if (!(r > 1e-12)) continue;
      const weight = (r - mean) / (r * points.length) * 2;
      gx += weight * (pivot.x - points[i].x);
      gy += weight * (pivot.y - points[i].y);
    }
    let accepted = false;
    for (let trial = 0; trial < 20; trial++) {
      const candidate = { x: pivot.x - step * gx, y: pivot.y - step * gy };
      const candidateValue = variance(candidate.x, candidate.y);
      if (candidateValue < current) {
        const improvement = current - candidateValue;
        pivot = candidate;
        current = candidateValue;
        step = Math.min(step * 1.5, 1e9);
        accepted = improvement > current * 1e-12;
        break;
      }
      step /= 2;
    }
    if (!accepted) break;
  }
  return pivot;
}

/**
 * Solve a 3x3 linear system by Gaussian elimination with partial pivoting.
 * Returns null when the matrix is singular at the given tolerance.
 */
function solve3x3(matrix, rhs, tolerance) {
  const a = [...matrix];
  const b = [...rhs];
  const index = [0, 1, 2];
  for (let col = 0; col < 3; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[index[row] * 3 + col]) > Math.abs(a[index[pivotRow] * 3 + col])) pivotRow = row;
    }
    if (Math.abs(a[index[pivotRow] * 3 + col]) <= tolerance) return null;
    if (pivotRow !== col) {
      const tmp = index[col];
      index[col] = index[pivotRow];
      index[pivotRow] = tmp;
    }
    const pivotValue = a[index[col] * 3 + col];
    for (let row = col + 1; row < 3; row++) {
      const factor = a[index[row] * 3 + col] / pivotValue;
      for (let k = col; k < 3; k++) a[index[row] * 3 + k] -= factor * a[index[col] * 3 + k];
      b[index[row]] -= factor * b[index[col]];
    }
  }
  const x = [0, 0, 0];
  for (let row = 2; row >= 0; row--) {
    let sum = b[index[row]];
    for (let col = row + 1; col < 3; col++) sum -= a[index[row] * 3 + col] * x[col];
    x[row] = sum / a[index[row] * 3 + row];
  }
  return x;
}
