// Stage 2D: turn a measured motion curve into the fewest keys that still reproduce it.
//
// Stage 2B (bandTracking) measures where every frame of a band actually is, to a
// fraction of a pixel. Stage 3 promotes dense kinematic rows into preset names. What
// neither does is answer the question a builder actually asks: "how many keyframes does
// this move need, and is a curve good enough?" This stage does, and it answers with the
// error it achieved rather than with a curve it hopes fits.
//
// The representation ladder, cheapest first:
//
//   1. static          — the band does not move by more than the measurement quantum.
//   2. linear          — two keys, no easing.
//   3. preset          — two keys plus a named curve already in use by Stage 3.
//   4. custom bezier   — two keys plus four fitted handles, and the expression text for
//                        `magicEasing(..., "Custom", expression)`.
//   5. piecewise       — keys at the breakpoints where one curve provably cannot follow
//                        the measurement, each segment carrying its own curve.
//
// A fit is only offered when the measurement is trustworthy enough to fit: a band whose
// correlation scores or competitor margins say "this alignment is guesswork" is reported
// as unresolved, because fitting noise produces a confident wrong curve — the failure
// mode that makes a clone look almost right and be impossible to debug.
//
// Tolerances are in pixels, not normalised units. A 2 px slide and a 200 px slide with
// the same normalised residual have very different visible errors, and the whole point of
// measuring sub-pixel motion is to keep that distinction.
import BezierEasing from 'bezier-easing';
import { MOTION_PRESETS } from './proceduralPromotion.mjs';

export const MOTION_FITTING_SCHEMA = 'refclone/motion-fit@1';

export const DEFAULT_FIT_OPTIONS = {
  // Largest permitted deviation of the model from the measurement, in pixels. 0.25 px is
  // a quarter of one pixel at the source raster: below the antialiased edge step the
  // measurement itself resolves, so a fit inside it is not distinguishable from the
  // reference by this pipeline.
  tolerancePx: 0.25,
  maxKeys: 9,
  // Measurement trust gates, read from the band's own confidence fields.
  minScore: 0.9,
  minMarginPx: 0.005,
  // A movement smaller than this cannot be a curve worth fitting at all.
  minTravelPx: null,
  // Handles are searched inside these bounds; y is allowed past 0..1 because an
  // anticipation or overshoot is exactly what the reference shows on some bands.
  handleBounds: { x: [0, 1], y: [-0.6, 1.6] },
  presets: true,
  // Seed sweep over the (x1, x2) plane: 6 gives 49 closed-form candidates, which is enough
  // to land in the right basin without turning a 13-band report into seconds of searching.
  seedGrid: 6,
  // Central-difference width for the Jacobian of the reported objective.
  finiteDifferenceStep: 1e-5
};

const round = (value, places = 4) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function clamp(value, [low, high]) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Evaluate a timing curve at normalised times.
 *
 * Returns null instead of throwing when the dependency rejects the handles: a candidate
 * curve that cannot be evaluated is a candidate that failed, not an error to propagate.
 */
export function easeCurve(handles, samples) {
  let easing;
  try {
    easing = BezierEasing(handles[0], handles[1], handles[2], handles[3]);
  } catch {
    return null;
  }
  const out = [];
  for (const t of samples) {
    const value = easing(t);
    if (!Number.isFinite(value)) return null;
    out.push(value);
  }
  return out;
}

/**
 * Deviation of a curve from the measured normalised positions, in normalised units and
 * in pixels. `travel` converts one to the other; without it the pixel number is meaningless.
 *
 * This is the authoritative evaluator: every number a fit reports comes from the same
 * `bezier-easing` call that Stage 3 and the builder use, including the error of handles the
 * search proposed from a cheaper internal model.
 */
export function curveError(handles, times, values, travel) {
  const error = rawCurveError(handles, times, values);
  if (!Number.isFinite(error.max)) return { max: Infinity, rms: Infinity, residuals: null };
  return {
    max: round(error.max, 6),
    maxPx: round(error.max * Math.abs(travel), 4),
    rms: round(error.rms, 6),
    rmsPx: round(error.rms * Math.abs(travel), 4),
    residuals: error.residuals.map(residual => round(residual, 5))
  };
}

/** The same objective without rounding, so a search can see improvements below 1e-6 px. */
function rawCurveError(handles, times, values) {
  const eased = easeCurve(handles, times);
  if (eased === null) return { max: Infinity, rms: Infinity, residuals: null };
  let max = 0;
  let sum = 0;
  const residuals = [];
  for (let index = 0; index < times.length; index += 1) {
    const error = eased[index] - values[index];
    residuals.push(error);
    if (Math.abs(error) > max) max = Math.abs(error);
    sum += error * error;
  }
  return { max, rms: Math.sqrt(sum / Math.max(1, times.length)), residuals };
}

/** One axis of a cubic bezier pinned at 0 and 1. */
function bezierAxis(tau, first, second) {
  const oneMinus = 1 - tau;
  return 3 * oneMinus * oneMinus * tau * first + 3 * oneMinus * tau * tau * second + tau * tau * tau;
}

function bezierAxisDerivative(tau, first, second) {
  const oneMinus = 1 - tau;
  return 3 * oneMinus * oneMinus * first + 6 * oneMinus * tau * (second - first) + 3 * tau * tau * (1 - second);
}

/**
 * The curve parameter whose x equals a normalised time.
 *
 * Newton is the fast path; bisection is the fallback that keeps a non-monotone or
 * near-flat x curve from producing a nonsense seed. Only seeds are built this way — the
 * error of every candidate is still measured by `curveError`.
 */
export function parameterAt(time, x1, x2) {
  if (!(time > 0)) return 0;
  if (time >= 1) return 1;
  let tau = time;
  for (let step = 0; step < 6; step += 1) {
    const delta = bezierAxis(tau, x1, x2) - time;
    if (Math.abs(delta) < 1e-13) return tau;
    const slope = bezierAxisDerivative(tau, x1, x2);
    if (Math.abs(slope) < 1e-9) break;
    tau = Math.min(1, Math.max(0, tau - delta / slope));
  }
  let low = 0;
  let high = 1;
  let mid = time;
  for (let step = 0; step < 48; step += 1) {
    mid = (low + high) / 2;
    if (bezierAxis(mid, x1, x2) < time) low = mid;
    else high = mid;
  }
  return mid;
}

/**
 * The best (y1, y2) with the x handles fixed.
 *
 * Fixing x fixes the parameter of every sample, and y is linear in its own control values,
 * so this is the solution of a 2x2 normal-equation system rather than a search. It is what
 * makes a two-dimensional seed sweep affordable.
 */
export function optimalYHandles(times, values, x1, x2, bounds = DEFAULT_FIT_OPTIONS.handleBounds.y) {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (let index = 0; index < times.length; index += 1) {
    const tau = parameterAt(times[index], x1, x2);
    const oneMinus = 1 - tau;
    const basis1 = 3 * oneMinus * oneMinus * tau;
    const basis2 = 3 * oneMinus * tau * tau;
    const target = values[index] - tau * tau * tau;
    a11 += basis1 * basis1;
    a12 += basis1 * basis2;
    a22 += basis2 * basis2;
    b1 += basis1 * target;
    b2 += basis2 * target;
  }
  const determinant = a11 * a22 - a12 * a12;
  if (Math.abs(determinant) < 1e-14) return [clamp(0, bounds), clamp(1, bounds)];
  return [
    clamp((b1 * a22 - b2 * a12) / determinant, bounds),
    clamp((a11 * b2 - a12 * b1) / determinant, bounds)
  ];
}

/**
 * Least-squares y-handles with the x-handles fixed at the thirds Stage 3 uses.
 *
 * A cheap, shape-agnostic starting point: correct enough to seed the search, and only an
 * approximation of the optimum because the x handles it pins are rarely the true ones.
 */
export function closedFormHandles(times, values, x1 = 1 / 3, x2 = 2 / 3, bounds = DEFAULT_FIT_OPTIONS.handleBounds.y) {
  const [y1, y2] = optimalYHandles(times, values, x1, x2, bounds);
  return [x1, y1, x2, y2];
}

/**
 * Fit all four handles to a normalised curve.
 *
 * A blind pattern search over four numbers was the first attempt here and it is not good
 * enough: on a dense series generated by a known easing it stalled at ~0.7 px of error,
 * because a min-max objective has an equioscillating local minimum where no single handle
 * move helps — exactly the point a coordinate search cannot leave, and exactly the error
 * budget a 0.25 px tolerance has no room for. This does the standard two-stage thing:
 *
 *   1. seed a coarse sweep of the (x1, x2) plane, taking the closed-form optimum of
 *      (y1, y2) at every grid point, which reduces the search to two dimensions and is
 *      cheap because y is linear once x is fixed;
 *   2. refine the best few seeds with damped Gauss-Newton (Levenberg-Marquardt) on all
 *      four handles, whose Jacobian is a finite difference of the same objective that gets
 *      reported.
 *
 * Measured against easing curves sampled at integer frames, this recovers the generating
 * handles to under 1e-6 normalised error; `curveError` — the shared `bezier-easing`
 * evaluation — still decides what gets reported.
 */
export function fitCurveHandles(times, values, travel, options = {}) {
  const settings = { ...DEFAULT_FIT_OPTIONS, ...options };
  const { y: yBounds } = settings.handleBounds;
  const box = index => (index === 0 || index === 2 ? settings.handleBounds.x : yBounds);
  const seeds = [];
  const grid = Math.max(2, Math.round(settings.seedGrid ?? 6));
  for (let first = 0; first <= grid; first += 1) {
    for (let second = 0; second <= grid; second += 1) {
      const x1 = first / grid;
      const x2 = second / grid;
      const candidate = closedFormHandles(times, values, x1, x2, yBounds);
      const error = rawCurveError(candidate, times, values);
      if (Number.isFinite(error.max)) seeds.push({ handles: candidate, max: error.max });
    }
  }
  if (seeds.length === 0) return null;
  seeds.sort((a, b) => a.max - b.max);
  const starts = [seeds[0].handles, closedFormHandles(times, values, 1 / 3, 2 / 3, yBounds), [0, 0, 1, 1]];
  if (seeds[1]) starts.push(seeds[1].handles);
  if (seeds[2]) starts.push(seeds[2].handles);

  let best = null;
  for (const start of starts) {
    const refined = levenbergMarquardt(times, values, start.map((handle, index) => clamp(handle, box(index))), box, settings);
    if (refined && (best === null || refined.max < best.max)) best = refined;
    if (best && best.max < 1e-10) break;
  }
  if (best === null || !Number.isFinite(best.max)) return null;
  return {
    handles: best.handles.map(handle => round(handle, 4)),
    max: round(best.max, 6),
    rms: round(best.rms, 6),
    ...curveError(best.handles, times, values, travel)
  };
}

/**
 * Damped Gauss-Newton on the four handles, accepting a step only when the reported metric
 * improves.
 *
 * The objective is the maximum residual rather than the sum of squares, so a step that
 * lowers the sum can still be refused; least squares gets close enough that the reported
 * max is within a rounding step of the best a min-max search finds, and refusing the worse
 * step is what keeps that claim honest.
 */
function levenbergMarquardt(times, values, start, box, settings, iterations = 24) {
  const step = settings.finiteDifferenceStep ?? 1e-5;
  let current = [...start];
  let currentError = rawCurveError(current, times, values);
  if (!Number.isFinite(currentError.max)) return null;
  let best = { handles: [...current], max: currentError.max, rms: currentError.rms };
  let lambda = 1e-3;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (best.max < 1e-10) break;
    const jacobian = times.map(() => new Array(4).fill(0));
    for (let axis = 0; axis < 4; axis += 1) {
      const forward = [...current];
      const backward = [...current];
      forward[axis] = clamp(forward[axis] + step, box(axis));
      backward[axis] = clamp(backward[axis] - step, box(axis));
      const forwardError = rawCurveError(forward, times, values);
      const backwardError = rawCurveError(backward, times, values);
      if (forwardError.residuals === null || backwardError.residuals === null) continue;
      for (let index = 0; index < times.length; index += 1) {
        jacobian[index][axis] = (forwardError.residuals[index] - backwardError.residuals[index])
          / (forward[axis] - backward[axis] || 1);
      }
    }
    const normal = Array.from({ length: 4 }, () => new Array(4).fill(0));
    const gradient = new Array(4).fill(0);
    for (let index = 0; index < times.length; index += 1) {
      const residual = currentError.residuals[index];
      for (let row = 0; row < 4; row += 1) {
        gradient[row] += jacobian[index][row] * residual;
        for (let column = 0; column < 4; column += 1) {
          normal[row][column] += jacobian[index][row] * jacobian[index][column];
        }
      }
    }
    let improved = false;
    for (let attempt = 0; attempt < 5 && !improved; attempt += 1) {
      const damped = normal.map((row, index) => row.map((value, column) => (
        index === column ? value * (1 + lambda) + 1e-12 : value
      )));
      const delta = solveLinearSystem(damped, gradient.map(value => -value));
      if (delta === null) break;
      const candidate = current.map((handle, index) => clamp(handle + delta[index], box(index)));
      const error = rawCurveError(candidate, times, values);
      if (error.residuals === null) {
        lambda = Math.min(lambda * 5, 1e8);
        continue;
      }
      if (error.max < best.max - 1e-15) {
        best = { handles: candidate, max: error.max, rms: error.rms };
        current = candidate;
        currentError = error;
        improved = true;
        lambda = Math.max(lambda / 3, 1e-9);
      } else {
        lambda = Math.min(lambda * 5, 1e8);
      }
    }
    if (!improved) break;
  }
  return best;
}

/**
 * Nearest already-named curve, measured the only way that matters here: in pixels.
 *
 * The table is Stage 3's, so a preset named here is the same curve Stage 3 would emit,
 * and the name is not invented. `MOTION_PRESETS` holds five shapes; anything that is not
 * one of them within tolerance falls through to the fitted custom curve.
 */
export function matchPreset(times, values, travel, options = {}) {
  const settings = { ...DEFAULT_FIT_OPTIONS, ...options };
  if (!settings.presets) return null;
  let best = null;
  for (const [name, handles] of Object.entries(MOTION_PRESETS)) {
    const error = curveError(handles, times, values, travel);
    if (!Number.isFinite(error.max)) continue;
    if (best === null || error.maxPx < best.maxPx) best = { name, handles: [...handles], ...error };
  }
  if (best === null) return null;
  return best.maxPx <= settings.tolerancePx ? best : null;
}

/**
 * A plain polynomial in t that reproduces the measured curve as closely as the handles do.
 *
 * `magicEasing(..., 'Custom', expression)` takes an expression evaluated against the
 * normalised time of the keyframe interval, which is a function of t — not a pair of
 * bezier handles — so the fitted curve has to be expressed that way to be usable. A
 * degree-5 least-squares polynomial is used rather than the exact bezier inversion
 * because the exact one needs a while loop and a solver inside a one-line expression.
 * The error of this text is reported separately from the error of the handles: they are
 * two different curves, and only the second one is what a builder sees.
 */
export function customExpression(times, values, handles, options = {}) {
  const settings = { ...DEFAULT_FIT_OPTIONS, ...options };
  const eased = easeCurve(handles, times);
  const targets = eased === null ? values : eased;
  const terms = Math.min(4, Math.max(1, times.length - 1));
  // Fit the *departure from linear* rather than the curve itself:
  //
  //   v(t) = t + t(1-t) * (a0 + a1 s + a2 s^2 + a3 s^3),  s = 2t - 1
  //
  // The t(1-t) factor makes v(0) = 0 and v(1) = 1 whatever the coefficients turn out to
  // be, which is what an easing has to be: an unconstrained polynomial fit is free to
  // start at 0.04 and shift the whole animation, and that error is invisible in a residual
  // averaged over the middle of the move. s is centred for conditioning, not for style.
  const size = terms;
  const ata = Array.from({ length: size }, () => new Array(size).fill(0));
  const atb = new Array(size).fill(0);
  const basisFor = t => {
    const s = t * 2 - 1;
    const envelope = t * (1 - t);
    const out = [];
    let power = 1;
    for (let k = 0; k < size; k += 1) {
      out.push(envelope * power);
      power *= s;
    }
    return out;
  };
  for (let index = 0; index < times.length; index += 1) {
    const basis = basisFor(times[index]);
    const departure = targets[index] - times[index];
    for (let r = 0; r < size; r += 1) {
      atb[r] += basis[r] * departure;
      for (let c = 0; c < size; c += 1) ata[r][c] += basis[r] * basis[c];
    }
  }
  const coefficients = solveLinearSystem(ata, atb);
  if (coefficients === null) return null;
  const evaluate = t => {
    const s = t * 2 - 1;
    let inner = null;
    for (let k = size - 1; k >= 0; k -= 1) inner = inner === null ? coefficients[k] : coefficients[k] + s * inner;
    return t + t * (1 - t) * inner;
  };
  let versusMeasurement = 0;
  let versusCurve = 0;
  for (let index = 0; index < times.length; index += 1) {
    const modelled = evaluate(times[index]);
    versusMeasurement = Math.max(versusMeasurement, Math.abs(modelled - values[index]));
    if (targets !== values) versusCurve = Math.max(versusCurve, Math.abs(modelled - targets[index]));
  }
  const travel = Math.abs(settings.travel ?? 1);
  return {
    // Highest power of s actually present, so the degree of the expanded polynomial in t
    // is one more than this: an easing is at least a cubic.
    departureTerms: size,
    variable: 't',
    // Endpoints are exact by construction, and saying so is the point of the basis.
    endpointsExact: [evaluate(0), evaluate(1)].map(value => round(value, 9)),
    coefficients: coefficients.map(coefficient => round(coefficient, 6)),
    expression: buildExpression(coefficients),
    maxVsMeasurement: round(versusMeasurement, 6),
    maxVsMeasurementPx: round(versusMeasurement * travel, 4),
    maxVsFittedCurve: targets === values ? null : round(versusCurve, 6),
    caveat: 'Cavalry reads an expression for Custom easing; the expression form itself has not been runtime-verified in this repository, so this text is a candidate to apply and re-measure, not a verified curve.'
  };
}

function buildExpression(coefficients) {
  // Horner in s = 2t - 1, multiplied back into the t(1-t) envelope, so the text states the
  // endpoints-preserving structure instead of hiding it inside expanded coefficients.
  let inner = null;
  for (let k = coefficients.length - 1; k >= 0; k -= 1) {
    inner = inner === null ? format(coefficients[k]) : `${format(coefficients[k])} + (2 * t - 1) * (${inner})`;
  }
  return `t + t * (1 - t) * (${inner})`;
}

function format(value) {
  return String(round(value, 6) ?? 0);
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    if (pivot !== column) {
      const swap = rows[column];
      rows[column] = rows[pivot];
      rows[pivot] = swap;
    }
    const scale = rows[column][column];
    for (let c = column; c <= n; c += 1) rows[column][c] /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (factor === 0) continue;
      for (let c = column; c <= n; c += 1) rows[row][c] -= factor * rows[column][c];
    }
  }
  return rows.map(row => row[n]);
}

/**
 * Turn a track-bands band (or any {frame, value} pairs) into a fitting series.
 *
 * Frames the measurement refused are dropped rather than interpolated: a hole in the
 * middle of a shot is evidence about the shot, and filling it with a guess would let the
 * fit claim it reproduced a frame nobody measured.
 */
export function fitSeries(input, options = {}) {
  const settings = { ...DEFAULT_FIT_OPTIONS, ...options };
  const source = Array.isArray(input) ? input : input?.series;
  if (!Array.isArray(source) || source.length === 0) {
    return { points: [], dropped: [], reason: 'no-frames' };
  }
  const points = [];
  const dropped = [];
  for (const record of source) {
    // Number(null) is 0 and Number("") is 0, which would silently relabel a record with no
    // frame as frame zero; only an actual integer (or an integer written as a string) names
    // a frame.
    const frame = Number.isInteger(record.frame) ? record.frame : Number(String(record.frame).trim());
    // track-bands calls the measurement `dxPx` and refuses it with `reason`; a generic
    // series calls it `value`. Both are accepted so the stage is usable outside the band
    // route without a translation layer.
    const raw = record.dxPx ?? record.value;
    const value = Number(raw);
    if (!Number.isInteger(frame)) { dropped.push({ frame: record.frame, why: 'frame-not-integer' }); continue; }
    if (!Number.isFinite(value)) { dropped.push({ frame, why: record.reason ?? 'value-not-measured' }); continue; }
    const score = Number(record.score);
    if (Number.isFinite(record.marginPx) && record.marginPx < settings.minMarginPx) {
      dropped.push({ frame, why: `margin ${record.marginPx} px below ${settings.minMarginPx}` });
      continue;
    }
    if (Number.isFinite(score) && score > 0 && score < settings.minScore) {
      dropped.push({ frame, why: `score ${score} below ${settings.minScore}` });
      continue;
    }
    points.push({ frame, value, score: Number.isFinite(score) ? score : null });
  }
  points.sort((a, b) => a.frame - b.frame);
  return { points, dropped, reason: null };
}

/**
 * Describe the shape of a fitted curve in the words an animator uses.
 *
 * The labels come from the curve's own geometry — where it leads, where it lags, whether
 * it passes the endpoint early — not from a lookup of approximate preset names, so a
 * label here is a claim that can be checked against `handles`.
 */
export function classifyCurve(handles, travel, options = {}) {
  const settings = { ...DEFAULT_FIT_OPTIONS, ...options };
  const [x1, y1, x2, y2] = handles;
  const quantum = settings.quantumPx ?? 0.125;
  if (Math.abs(travel) <= quantum) return 'static';
  // Control points sitting on the diagonal make the easing the identity, whichever pair of
  // positions expresses it — including the [0, 0, 1, 1] the linear rung reports.
  const onDiagonal = Math.abs(y1 - x1) < 0.02 && Math.abs(y2 - x2) < 0.02;
  const thirds = Math.abs(y1 - 1 / 3) < 0.06 && Math.abs(y2 - 2 / 3) < 0.06
    && Math.abs(x1 - 1 / 3) < 0.12 && Math.abs(x2 - 2 / 3) < 0.12;
  if (onDiagonal || thirds) return 'linear';
  const beyondEnd = y1 > 1.02 || y2 > 1.02 || y1 < -0.02 || y2 < -0.02;
  if (beyondEnd) return y1 < -0.02 || y2 < -0.02 ? 'anticipate' : 'overshoot';
  const leadsEarly = y1 + y2 > 1.08;
  const lagsEarly = y1 + y2 < 0.92;
  if (leadsEarly && !lagsEarly) return x1 + x2 < 0.9 ? 'ease-out' : 'ease-in-out';
  if (lagsEarly && !leadsEarly) return x1 + x2 > 1.1 ? 'ease-in' : 'ease-in-out';
  return 'asymmetric';
}

/**
 * Fit one band, choosing the cheapest representation that meets the pixel tolerance.
 *
 * Every return carries the error it achieved and the reason it stopped where it did. A
 * `rejected` status is not a failure of this stage: it is the measurement saying the band
 * cannot be fitted, which is the answer that keeps a wrong curve out of a scene.
 */
export function fitMotion(input, options = {}) {
  const settings = { ...DEFAULT_FIT_OPTIONS, ...options };
  const id = input?.id ?? options.id ?? 'series';
  const { points, dropped, reason } = fitSeries(input, settings);
  const base = {
    id,
    schema: MOTION_FITTING_SCHEMA,
    source: input?.anchorFrame ?? null,
    frames: points.length,
    // How much of that series the measurement actually vouched for. A bare [{frame, value}]
    // input carries no score, so the trust gates have nothing to reject on and the fit is
    // only as good as the numbers it was handed.
    scoredFrames: points.filter(point => Number.isFinite(point.score)).length,
    droppedFrames: dropped,
    quantumPx: input?.quantumPx ?? round(1 / (settings.upsample ?? 8), 6),
    tolerancePx: settings.tolerancePx
  };
  if (reason || points.length < 2) {
    return { ...base, status: 'rejected', class: 'unresolved', reason: reason ?? 'fewer than two measured frames', keys: [], keyCount: 0, curve: null };
  }
  const first = points[0];
  const last = points[points.length - 1];
  const travel = last.value - first.value;
  const span = last.frame - first.frame;
  if (span <= 0) return { ...base, status: 'rejected', class: 'unresolved', reason: 'frames do not advance', keys: [], keyCount: 0 };
  const minTravel = settings.minTravelPx ?? base.quantumPx;
  if (Math.abs(travel) <= minTravel) {
    return {
      ...base,
      status: 'fit',
      class: 'static',
      representation: 'none',
      reason: `total displacement ${round(travel, 4)} px is at or below the ${minTravel} px floor`,
      travelPx: round(travel, 4),
      keyCount: 0,
      keys: [],
      curve: null,
      maxErrorPx: 0
    };
  }
  const times = points.map(point => (point.frame - first.frame) / span);
  const values = points.map(point => (point.value - first.value) / travel);

  const linear = curveError([0, 0, 1, 1], times, values, travel);
  const preset = matchPreset(times, values, travel, settings);
  const fitted = fitCurveHandles(times, values, travel, settings);

  const ladder = [];
  ladder.push({ representation: 'linear', handles: [0, 0, 1, 1], ...linear });
  if (preset) ladder.push({ representation: 'preset', name: preset.name, handles: preset.handles, max: preset.max, maxPx: preset.maxPx, rms: preset.rms, rmsPx: preset.rmsPx, residuals: preset.residuals });
  if (fitted) {
    ladder.push({
      representation: 'custom',
      handles: fitted.handles,
      max: fitted.max,
      maxPx: fitted.maxPx,
      rms: fitted.rms,
      rmsPx: fitted.rmsPx,
      residuals: fitted.residuals
    });
  }
  const acceptable = ladder.filter(candidate => Number.isFinite(candidate.maxPx) && candidate.maxPx <= settings.tolerancePx);
  const cheapest = acceptable.sort((a, b) => {
    const rank = value => (value === 'linear' ? 0 : value === 'preset' ? 1 : 2);
    return rank(a.representation) - rank(b.representation);
  })[0] ?? null;

  const best = cheapest ?? ladder.reduce((a, b) => (a === null || b.maxPx < a.maxPx ? b : a), null);
  const classOf = best ? classifyCurve(best.handles, travel, settings) : 'unresolved';

  if (cheapest) {
    const curve = {
      handles: best.handles,
      representation: best.representation,
      presetName: best.name ?? null,
      maxErrorPx: best.maxPx,
      rmsErrorPx: best.rmsPx,
      residuals: best.residuals,
      keys: [
        { frame: first.frame, value: round(first.value, 4), easing: 'None' },
        { frame: last.frame, value: round(last.value, 4), easing: best.representation === 'linear' ? 'None' : 'Custom' }
      ]
    };
    if (best.representation === 'custom') {
      curve.expression = customExpression(times, values, best.handles, { ...settings, travel });
    }
    return {
      ...base,
      status: 'fit',
      class: classOf,
      representation: best.representation,
      travelPx: round(travel, 4),
      spanFrames: span,
      keyCount: 2,
      maxErrorPx: best.maxPx,
      rmsErrorPx: best.rmsPx,
      curve,
      candidates: ladder.map(candidate => ({
        representation: candidate.representation,
        name: candidate.name ?? null,
        maxPx: Number.isFinite(candidate.maxPx) ? candidate.maxPx : null
      }))
    };
  }

  // One curve provably cannot follow the measurement within tolerance, so the band gets
  // breakpoints instead of a lie. Segments split at the largest residual, recursively,
  // until every segment fits or the key budget runs out.
  const piecewise = segmentFit(points, times, values, travel, settings);
  return {
    ...base,
    status: piecewise.every ? 'fit' : 'approximated',
    class: 'piecewise',
    representation: 'piecewise',
    travelPx: round(travel, 4),
    spanFrames: span,
    keyCount: piecewise.keys.length,
    maxErrorPx: piecewise.maxPx,
    rmsErrorPx: piecewise.rmsPx,
    curve: {
      keys: piecewise.keys,
      segments: piecewise.segments,
      maxErrorPx: piecewise.maxPx,
      rmsErrorPx: piecewise.rmsPx
    },
    reason: piecewise.every
      ? null
      : `no representation inside ${settings.tolerancePx} px with at most ${settings.maxKeys} keys; best achieved ${piecewise.maxPx} px`,
    candidates: ladder.map(candidate => ({
      representation: candidate.representation,
      name: candidate.name ?? null,
      maxPx: Number.isFinite(candidate.maxPx) ? candidate.maxPx : null
    }))
  };
}

/**
 * Recursive segment fit: split where a single curve misses most, and refit each half.
 *
 * A breakpoint is placed at the measured frame of the largest residual rather than at the
 * midpoint, because the largest residual is where the model and the reference disagree —
 * pinning the model to the measurement there is what makes the next split useful.
 */
export function segmentFit(points, times, values, travel, settings, depth = 0) {
  const fitted = fitCurveHandles(times, values, travel, settings)
    ?? { handles: [0, 0, 1, 1], ...curveError([0, 0, 1, 1], times, values, travel) };
  const residuals = fitted.residuals ?? [];
  let worstIndex = 0;
  for (let index = 1; index < residuals.length; index += 1) {
    if (Math.abs(residuals[index]) > Math.abs(residuals[worstIndex])) worstIndex = index;
  }
  const interior = worstIndex > 0 && worstIndex < points.length - 1;
  if (Number.isFinite(fitted.maxPx) && fitted.maxPx <= settings.tolerancePx) {
    return {
      every: true,
      maxPx: fitted.maxPx,
      rmsPx: fitted.rmsPx,
      // Both endpoints are measured values, so the model passes through the measurement
      // at every breakpoint it invented and the split can never introduce a discontinuity.
      keys: [
        { frame: points[0].frame, value: round(points[0].value, 4), easing: 'Custom' },
        { frame: points[points.length - 1].frame, value: round(points[points.length - 1].value, 4), easing: 'Custom' }
      ],
      segments: [{
        fromFrame: points[0].frame,
        toFrame: points[points.length - 1].frame,
        handles: fitted.handles,
        maxPx: fitted.maxPx,
        rmsPx: fitted.rmsPx
      }]
    };
  }
  if (!interior || depth >= 6 || points.length < 4 || keysAfterSplit(depth) > settings.maxKeys) {
    return {
      every: false,
      maxPx: Number.isFinite(fitted.maxPx) ? fitted.maxPx : null,
      rmsPx: Number.isFinite(fitted.rmsPx) ? fitted.rmsPx : null,
      keys: [
        { frame: points[0].frame, value: round(points[0].value, 4) },
        { frame: points[points.length - 1].frame, value: round(points[points.length - 1].value, 4) }
      ],
      segments: [{
        fromFrame: points[0].frame,
        toFrame: points[points.length - 1].frame,
        handles: fitted.handles,
        maxPx: Number.isFinite(fitted.maxPx) ? fitted.maxPx : null,
        exceeded: true
      }]
    };
  }
  const left = points.slice(0, worstIndex + 1);
  const right = points.slice(worstIndex);
  const leftTimes = left.map(point => (point.frame - points[0].frame) / (points[worstIndex].frame - points[0].frame || 1));
  const rightTimes = right.map(point => (point.frame - points[worstIndex].frame) / (points[points.length - 1].frame - points[worstIndex].frame || 1));
  const leftTravel = left[left.length - 1].value - left[0].value;
  const rightTravel = right[right.length - 1].value - right[0].value;
  const leftFit = segmentFit(left, leftTimes, left.map(point => (point.value - left[0].value) / (leftTravel || 1)), leftTravel, settings, depth + 1);
  const rightFit = segmentFit(right, rightTimes, right.map(point => (point.value - right[0].value) / (rightTravel || 1)), rightTravel, settings, depth + 1);
  return {
    every: leftFit.every && rightFit.every,
    maxPx: roundToMax([leftFit.maxPx, rightFit.maxPx]),
    rmsPx: round(Math.sqrt(((leftFit.rmsPx ?? 0) ** 2 + (rightFit.rmsPx ?? 0) ** 2) / 2), 4),
    keys: [...leftFit.keys, ...rightFit.keys.slice(1)],
    segments: [...leftFit.segments, ...rightFit.segments]
  };
}

/** Boundary keys a tree with one more level of splits would need. */
function keysAfterSplit(depth) {
  return 2 ** (depth + 1) + 1;
}

function roundToMax(values) {
  const finite = values.filter(value => Number.isFinite(value));
  return finite.length ? round(Math.max(...finite), 4) : null;
}

/**
 * Fit every band of a track-bands report.
 *
 * The report's own trust fields are carried into each fit rather than re-derived, so the
 * artifact says both what the curve is and how much the measurement deserved the question.
 */
export function fitBands(report, options = {}) {
  const settings = { ...DEFAULT_FIT_OPTIONS, ...options };
  const bands = Array.isArray(report?.bands) ? report.bands : [report];
  const fits = bands.map(band => fitMotion(band, {
    ...settings,
    upsample: 1 / (band.quantumPx ?? 0.125),
    quantumPx: band.quantumPx ?? settings.quantumPx
  }));
  const fitted = fits.filter(fit => fit.status === 'fit');
  return {
    schema: MOTION_FITTING_SCHEMA,
    sourceSchema: report?.schema ?? null,
    anchorFrame: report?.anchorFrame ?? null,
    parameters: {
      tolerancePx: settings.tolerancePx,
      maxKeys: settings.maxKeys,
      minScore: settings.minScore,
      minMarginPx: settings.minMarginPx,
      presets: settings.presets
    },
    summary: {
      bands: fits.length,
      fitted: fitted.length,
      approximated: fits.filter(fit => fit.status === 'approximated').length,
      rejected: fits.filter(fit => fit.status === 'rejected').length,
      twoKeyFits: fits.filter(fit => fit.keyCount === 2).length,
      staticBands: fits.filter(fit => fit.class === 'static').length,
      maxErrorPx: fitted.length ? roundToMax(fitted.map(fit => fit.maxErrorPx)) : null,
      byClass: fits.reduce((total, fit) => {
        total[fit.class] = (total[fit.class] ?? 0) + 1;
        return total;
      }, {}),
      // A band whose two word-gap edges disagree by more than the quantum is not one
      // layer moving, and no set of position keys on one layer reproduces it.
      unbuildableBands: bands
        .filter(band => Number.isFinite(band?.maxAnchorSpreadPx)
          && band.maxAnchorSpreadPx > (band.quantumPx ?? 0.125))
        .map(band => band.id)
    },
    limitations: [
      'Keys and curves are fitted to measured band displacement, which is relative to the band anchor frame; an absolute scene position still has to come from the plan.',
      'The Custom easing expression text has not been runtime-verified against Cavalry in this repository; apply it to one layer and re-measure before adopting it across a shot.',
      'A fit here is evidence about motion, not a claim that a render matches; that comparison belongs to the QA stage at aligned timestamps.'
    ],
    fits,
    // Not a limitation of the fit itself but of the measurement it was handed: a band whose
    // frames carry no score was fitted on trust, so the caller has to know that happened.
    unscoredBands: fits
      .filter(fit => fit.frames > 0 && fit.scoredFrames < fit.frames)
      .map(fit => ({ id: fit.id, frames: fit.frames, scoredFrames: fit.scoredFrames }))
  };
}
