/**
 * Procedural Promotion Solver — Stage 3 of the 5-Stage Closed-Loop Pipeline
 *
 * Analyzes normalized trajectories and promotes them to procedural Cavalry behaviors
 * instead of raw per-frame keyframes:
 * - Cubic-Bezier fitting for smooth monotonic transitions (RMSE <= 0.015)
 * - Damped Spring detection for oscillating trajectories (R^2 >= 0.92)
 * - Weighted 4-parameter cubic-Bezier fitting for pixel-accurate easing fallback
 * - Duplicator & Stagger detection for N>=2 correlated elements
 *
 * All promotions are evidence-based: a trajectory that doesn't meet the threshold
 * stays as measured keyframes rather than being forced into a procedural form.
 *
 * When callers supply `pixelScale` (source pixels per normalized unit, derived from
 * the frame dimensions), every preset promotion is additionally gated per frame in
 * pixel units: if any frame misses `bezierRmseMaxPx`, the preset is bypassed in
 * favor of a weighted cubic-Bezier fit and, failing that, measured keyframes.
 */

import { WorkflowError, hashObject } from '../core.mjs';

export const PROMOTION_VERSION = '1.0.0';

// Promotion thresholds — conservative to avoid false positives
const BEZIER_RMSE_THRESHOLD = 0.015;
const SPRING_R2_THRESHOLD = 0.92;
const DUPLICATOR_MIN_ELEMENTS = 2;
const DUPLICATOR_TRAJECTORY_CORRELATION = 0.85;
const DUPLICATOR_TIMING_TOLERANCE_FRAMES = 2;

// Pixel-unit residual gate default (config: proceduralPromotion.bezierRmseMaxPx).
// Applies per frame when a pixelScale is provided to analyzeTrajectory.
export const BEZIER_RMSE_MAX_PX = 1.5;

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

/**
 * Normalize a trajectory to [0,1] range for fitting.
 * @param {Array<{frame: number, value: number}>} points
 * @returns {{normalized: Array<{t: number, v: number}>, minFrame: number, maxFrame: number, minValue: number, maxValue: number}}
 */
export function normalizeTrajectory(points) {
  if (!Array.isArray(points) || points.length < 2) {
    fail('TRAJECTORY_INVALID', 'Trajectory must have at least 2 points.', { points });
  }

  const sorted = [...points].sort((a, b) => a.frame - b.frame);
  const minFrame = sorted[0].frame;
  const maxFrame = sorted[sorted.length - 1].frame;
  const values = sorted.map(p => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue;

  const frameRange = maxFrame - minFrame;
  if (frameRange <= 0) {
    fail('TRAJECTORY_INVALID', 'Trajectory frames must span a positive range.', { minFrame, maxFrame });
  }

  const normalized = sorted.map(p => ({
    t: (p.frame - minFrame) / frameRange,
    v: valueRange > 0 ? (p.value - minValue) / valueRange : 0.5
  }));

  return { normalized, minFrame, maxFrame, minValue, maxValue, frameRange, valueRange };
}

/**
 * Compute RMSE between predicted and actual values.
 */
function computeRMSE(predicted, actual) {
  if (predicted.length !== actual.length) {
    fail('RMSE_LENGTH_MISMATCH', 'Predicted and actual arrays must have the same length.');
  }
  const squaredErrors = predicted.map((p, i) => (p - actual[i]) ** 2);
  const meanSquaredError = squaredErrors.reduce((sum, e) => sum + e, 0) / squaredErrors.length;
  return Math.sqrt(meanSquaredError);
}

/**
 * Compute R^2 (coefficient of determination).
 */
function computeR2(predicted, actual) {
  const mean = actual.reduce((sum, v) => sum + v, 0) / actual.length;
  const ssTot = actual.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  const ssRes = actual.reduce((sum, v, i) => sum + (v - predicted[i]) ** 2, 0);
  if (ssTot === 0) return 1; // Perfect fit for constant values
  return 1 - ssRes / ssTot;
}

/**
 * Evaluate a cubic bezier at parameter t.
 * B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
 * For easing curves: P0=(0,0), P3=(1,1), so we solve for y given x=t
 */
function cubicBezierY(t, y1, y2) {
  // Standard CSS cubic-bezier: P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1)
  // For easing, we parameterize by t and get y directly
  const mt = 1 - t;
  return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
}

/**
 * Fit a cubic bezier easing curve to a normalized trajectory.
 * Uses gradient descent to find optimal (y1, y2) control points.
 *
 * @param {Array<{t: number, v: number}>} normalized - Normalized trajectory points
 * @returns {{success: boolean, y1: number, y2: number, rmse: number, predicted: number[]}}
 */
export function fitCubicBezier(normalized) {
  if (!Array.isArray(normalized) || normalized.length < 2) {
    return { success: false, y1: 0, y2: 1, rmse: Infinity, predicted: [] };
  }

  const actual = normalized.map(p => p.v);
  const times = normalized.map(p => p.t);

  // Initial guess: linear interpolation
  let bestY1 = 0.25;
  let bestY2 = 0.75;
  let bestRMSE = Infinity;
  let bestPredicted = [];

  // Coarse grid search
  const gridSteps = 20;
  for (let i = 0; i <= gridSteps; i++) {
    for (let j = 0; j <= gridSteps; j++) {
      const y1 = i / gridSteps;
      const y2 = j / gridSteps;
      const predicted = times.map(t => cubicBezierY(t, y1, y2));
      const rmse = computeRMSE(predicted, actual);
      if (rmse < bestRMSE) {
        bestRMSE = rmse;
        bestY1 = y1;
        bestY2 = y2;
        bestPredicted = predicted;
      }
    }
  }

  // Fine refinement with smaller steps around the best
  const refineSteps = 40;
  const refineRange = 1 / gridSteps;
  for (let i = 0; i <= refineSteps; i++) {
    for (let j = 0; j <= refineSteps; j++) {
      const y1 = Math.max(0, Math.min(1, bestY1 - refineRange / 2 + (i / refineSteps) * refineRange));
      const y2 = Math.max(0, Math.min(1, bestY2 - refineRange / 2 + (j / refineSteps) * refineRange));
      const predicted = times.map(t => cubicBezierY(t, y1, y2));
      const rmse = computeRMSE(predicted, actual);
      if (rmse < bestRMSE) {
        bestRMSE = rmse;
        bestY1 = y1;
        bestY2 = y2;
        bestPredicted = predicted;
      }
    }
  }

  return {
    success: bestRMSE <= BEZIER_RMSE_THRESHOLD,
    y1: Math.round(bestY1 * 1000) / 1000,
    y2: Math.round(bestY2 * 1000) / 1000,
    rmse: bestRMSE,
    predicted: bestPredicted
  };
}

/**
 * Weighted cubic-bezier easing (4 handle parameters, normalized [0,1] units).
 *
 * Control points, with both angles measured in degrees as travel-direction
 * tangents and weights as handle lengths:
 * - P0 = (0, 0), P3 = (1, 1)
 * - P1 (outgoing handle) = outWeight * (cos(outAngle), sin(outAngle))
 * - P2 (incoming handle) = (1, 1) - inWeight * (cos(inAngle), sin(inAngle))
 *
 * The CSS cubic-bezier (y1, y2) family is the sub-family with
 * outWeight*cos(outAngle) = 1/3 and inWeight*cos(inAngle) = 2/3, so this
 * parameterization strictly generalizes the 2-parameter fit.
 */
const DEG2RAD = Math.PI / 180;

function weightedBezierControlPoints({ inWeight, inAngle, outWeight, outAngle }) {
  const outRad = outAngle * DEG2RAD;
  const inRad = inAngle * DEG2RAD;
  return {
    x1: outWeight * Math.cos(outRad),
    y1: outWeight * Math.sin(outRad),
    x2: 1 - inWeight * Math.cos(inRad),
    y2: 1 - inWeight * Math.sin(inRad)
  };
}

const WEIGHTED_LUT_SIZE = 256;

/**
 * Dense lookup table of the curve's (x, y) samples. Returns null when the
 * handle geometry is not a valid easing curve (tangent handles cross in time:
 * x1 > x2 means the curve travels backwards along the time axis).
 */
function weightedBezierLUT(parameters) {
  const { x1, y1, x2, y2 } = weightedBezierControlPoints(parameters);
  if (x1 > x2 + 1e-9) return null;
  const xs = new Float64Array(WEIGHTED_LUT_SIZE + 1);
  const ys = new Float64Array(WEIGHTED_LUT_SIZE + 1);
  for (let j = 0; j <= WEIGHTED_LUT_SIZE; j++) {
    const u = j / WEIGHTED_LUT_SIZE;
    const mt = 1 - u;
    xs[j] = 3 * mt * mt * u * x1 + 3 * mt * u * u * x2 + u * u * u;
    ys[j] = 3 * mt * mt * u * y1 + 3 * mt * u * u * y2 + u * u * u;
  }
  return { xs, ys };
}

function sampleWeightedBezier(lut, x) {
  const { xs, ys } = lut;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[WEIGHTED_LUT_SIZE]) return ys[WEIGHTED_LUT_SIZE];
  let lo = 0;
  let hi = WEIGHTED_LUT_SIZE;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  const fraction = span > 1e-12 ? (x - xs[lo]) / span : 0;
  return ys[lo] + fraction * (ys[hi] - ys[lo]);
}

const WEIGHTED_WEIGHT_GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const WEIGHTED_ANGLE_GRID = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];

/**
 * Fit a weighted cubic-bezier easing curve to a normalized trajectory.
 * 4-parameter least-squares fit of {inWeight, inAngle, outWeight, outAngle}:
 * a coarse grid over all four handle parameters followed by coordinate-descent
 * refinement with shrinking steps.
 *
 * @param {Array<{t: number, v: number}>} normalized - Normalized trajectory points
 * @param {{rmseMax?: number}} [options] - Success gate in normalized units (default 0.015)
 * @returns {{success: boolean, inWeight: number, inAngle: number, outWeight: number, outAngle: number, rmse: number, predicted: number[]}}
 */
export function fitWeightedCubicBezier(normalized, options = {}) {
  const rmseMax = options.rmseMax ?? BEZIER_RMSE_THRESHOLD;
  if (!Array.isArray(normalized) || normalized.length < 2) {
    return {
      success: false, inWeight: 0.3, inAngle: 0, outWeight: 0.3, outAngle: 0,
      rmse: Infinity, predicted: []
    };
  }

  const actual = normalized.map(p => p.v);
  const times = normalized.map(p => p.t);

  const predict = params => {
    const lut = weightedBezierLUT(params);
    return lut ? times.map(t => sampleWeightedBezier(lut, t)) : null;
  };
  const rmseOf = params => {
    const predicted = predict(params);
    return predicted ? computeRMSE(predicted, actual) : Infinity;
  };

  const clampWeight = w => Math.max(0, Math.min(1, w));
  const clampAngle = a => Math.max(-90, Math.min(90, a));
  const roundWeight = w => Math.round(w * 10000) / 10000;
  const roundAngle = a => Math.round(a * 100) / 100;

  // Coarse grid search over all four handle parameters.
  let best = { inWeight: 0.3, inAngle: 0, outWeight: 0.3, outAngle: 0, rmse: Infinity };
  for (const outWeight of WEIGHTED_WEIGHT_GRID) {
    for (const outAngle of WEIGHTED_ANGLE_GRID) {
      for (const inWeight of WEIGHTED_WEIGHT_GRID) {
        for (const inAngle of WEIGHTED_ANGLE_GRID) {
          const rmse = rmseOf({ inWeight, inAngle, outWeight, outAngle });
          if (rmse < best.rmse) {
            best = { inWeight, inAngle, outWeight, outAngle, rmse };
          }
        }
      }
    }
  }

  // Coordinate-descent refinement with shrinking steps.
  let weightStep = 0.08;
  let angleStep = 6;
  while (weightStep >= 1e-4 || angleStep >= 0.05) {
    for (const key of ['outWeight', 'outAngle', 'inWeight', 'inAngle']) {
      const isAngle = key.endsWith('Angle');
      const step = isAngle ? angleStep : weightStep;
      const clamp = isAngle ? clampAngle : clampWeight;
      const current = best[key];
      for (const direction of [-1, 1]) {
        const candidate = {
          ...best,
          [key]: clamp(current + direction * step)
        };
        const rmse = rmseOf(candidate);
        if (rmse < best.rmse) {
          best = { ...candidate, rmse };
        }
      }
    }
    weightStep /= 2;
    angleStep /= 2;
  }

  // Report rounded handles with predictions recomputed at the rounded values,
  // falling back to the unrounded optimum if rounding breaks the geometry.
  const rounded = {
    inWeight: roundWeight(best.inWeight),
    inAngle: roundAngle(best.inAngle),
    outWeight: roundWeight(best.outWeight),
    outAngle: roundAngle(best.outAngle)
  };
  let predicted = predict(rounded);
  let finalParams = rounded;
  if (!predicted) {
    finalParams = { inWeight: best.inWeight, inAngle: best.inAngle, outWeight: best.outWeight, outAngle: best.outAngle };
    predicted = predict(finalParams) ?? [];
  }
  const rmse = predicted.length > 0 ? computeRMSE(predicted, actual) : Infinity;

  return {
    success: rmse <= rmseMax,
    inWeight: finalParams.inWeight,
    inAngle: finalParams.inAngle,
    outWeight: finalParams.outWeight,
    outAngle: finalParams.outAngle,
    rmse,
    predicted
  };
}

/**
 * Model: y(t) = A * (1 - e^(-ζω₀t) * cos(ω_d * t + φ)) + B
 * where ω_d = ω₀ * sqrt(1 - ζ²) for underdamped case (ζ < 1)
 *
 * Fit damped harmonic oscillator parameters to an oscillating trajectory.
 *
 * @param {Array<{t: number, v: number}>} normalized - Normalized trajectory
 * @param {number} targetValue - The value the oscillation settles to (default 1)
 * @returns {{success: boolean, zeta: number, omega0: number, r2: number, predicted: number[]}}
 */
export function fitDampedSpring(normalized, targetValue = 1) {
  if (!Array.isArray(normalized) || normalized.length < 4) {
    return { success: false, zeta: 0.5, omega0: 10, r2: 0, predicted: [] };
  }

  const actual = normalized.map(p => p.v);
  const times = normalized.map(p => p.t);

  // Detect if trajectory oscillates around target
  const deviations = actual.map(v => v - targetValue);
  const signChanges = deviations.slice(1).filter((d, i) => d * deviations[i] < 0).length;

  // Need at least 2 sign changes to consider it oscillating
  if (signChanges < 2) {
    return { success: false, zeta: 0.5, omega0: 10, r2: 0, predicted: [], reason: 'insufficient_oscillation' };
  }

  // Estimate initial amplitude
  const amplitude = Math.abs(actual[0] - targetValue);
  if (amplitude < 1e-6) {
    return { success: false, zeta: 0.5, omega0: 10, r2: 0, predicted: [], reason: 'zero_amplitude' };
  }

  // Grid search for best (zeta, omega0)
  let bestZeta = 0.3;
  let bestOmega0 = 15;
  let bestR2 = -Infinity;
  let bestPredicted = [];

  const zetaSteps = 30;
  const omegaSteps = 40;

  for (let i = 1; i <= zetaSteps; i++) {
    const zeta = i / (zetaSteps + 1) * 0.85; // 0.027 to 0.82 (underdamped)
    for (let j = 1; j <= omegaSteps; j++) {
      const omega0 = j * 1.5; // 1.5 to 60

      const omegaD = omega0 * Math.sqrt(Math.max(0.01, 1 - zeta * zeta));
      const predicted = times.map(t => {
        const decay = Math.exp(-zeta * omega0 * t);
        const oscillation = Math.cos(omegaD * t);
        return targetValue - decay * oscillation * amplitude;
      });

      const r2 = computeR2(predicted, actual);
      if (r2 > bestR2) {
        bestR2 = r2;
        bestZeta = zeta;
        bestOmega0 = omega0;
        bestPredicted = predicted;
      }
    }
  }

  // Refine around best with finer grid
  const refineZeta = 20;
  const refineOmega = 25;
  const zetaRange = 0.85 / zetaSteps;
  const omegaRange = 1.5;

  for (let i = 0; i <= refineZeta; i++) {
    const zeta = Math.max(0.01, Math.min(0.95, bestZeta - zetaRange / 2 + (i / refineZeta) * zetaRange));
    for (let j = 0; j <= refineOmega; j++) {
      const omega0 = Math.max(0.5, bestOmega0 - omegaRange / 2 + (j / refineOmega) * omegaRange);

      const omegaD = omega0 * Math.sqrt(Math.max(0.01, 1 - zeta * zeta));
      const predicted = times.map(t => {
        const decay = Math.exp(-zeta * omega0 * t);
        const oscillation = Math.cos(omegaD * t);
        return targetValue - decay * oscillation * amplitude;
      });

      const r2 = computeR2(predicted, actual);
      if (r2 > bestR2) {
        bestR2 = r2;
        bestZeta = zeta;
        bestOmega0 = omega0;
        bestPredicted = predicted;
      }
    }
  }

  return {
    success: bestR2 >= SPRING_R2_THRESHOLD,
    zeta: Math.round(bestZeta * 1000) / 1000,
    omega0: Math.round(bestOmega0 * 100) / 100,
    r2: bestR2,
    predicted: bestPredicted,
    signChanges
  };
}

/**
 * Compute cross-correlation between two trajectories.
 * Returns the correlation coefficient at the best lag within +/- maxLag.
 *
 * Lag sign convention: a positive lag means traj2 is traj1 delayed, i.e.
 * traj1[i] aligns with traj2[i + lag]. Constant series are handled explicitly
 * (both constant = perfect match at lag 0; one constant = no match) so the
 * lag search stays usable for shape comparison. Lags whose overlap is too
 * small to score honestly (fewer than max(2, half the samples)) are skipped.
 */
function crossCorrelate(traj1, traj2, maxLag) {
  if (traj1.length !== traj2.length || traj1.length === 0) {
    return { correlation: 0, lag: 0 };
  }

  const n = traj1.length;
  const mean1 = traj1.reduce((s, v) => s + v, 0) / n;
  const mean2 = traj2.reduce((s, v) => s + v, 0) / n;
  const std1 = Math.sqrt(traj1.reduce((s, v) => s + (v - mean1) ** 2, 0) / n);
  const std2 = Math.sqrt(traj2.reduce((s, v) => s + (v - mean2) ** 2, 0) / n);

  if (std1 < 1e-9 && std2 < 1e-9) return { correlation: 1, lag: 0 };
  if (std1 < 1e-9 || std2 < 1e-9) return { correlation: 0, lag: 0 };

  const minOverlap = Math.max(2, Math.ceil(n / 2));
  let bestCorrelation = -Infinity;
  let bestLag = 0;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j >= 0 && j < n) {
        sum += (traj1[i] - mean1) * (traj2[j] - mean2);
        count++;
      }
    }
    if (count < minOverlap) continue;

    const correlation = Math.max(-1, Math.min(1, sum / (count * std1 * std2)));
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestCorrelation === -Infinity) return { correlation: 0, lag: 0 };
  return { correlation: bestCorrelation, lag: bestLag };
}

/**
 * Detect duplicator/stagger patterns among multiple element trajectories.
 *
 * Members of a group share trajectory SHAPE (offset-invariant correlation on
 * both x and y, scored at the best lag within the timing tolerance). A group
 * records the measured phase delay `lagFrames` (frames the member trails the
 * base element), the spatial offset measured at that aligned phase, and the
 * complete rig description: `stagger` ({type, lagFrames, offset}) and
 * `falloff` ({type, influence}) so the emitted _mg.duplicator is executable.
 *
 * @param {Array<{id: string, trajectory: Array<{frame: number, x: number, y: number, scale?: number, rotation?: number}>}>} elements
 * @param {{minElements?: number, correlationMin?: number, maxLag?: number}} [options]
 *     Thresholds; defaults mirror config proceduralPromotion
 *     (duplicatorMinElements, duplicatorCorrelationMin, duplicatorTimingToleranceFrames).
 * @returns {{detected: boolean, groups: Array<{elementIds: string[], lagFrames: number, spatialOffset: {x: number, y: number}, correlation: number, baseElementId: string, stagger: {type: string, lagFrames: number, offset: number}, falloff: {type: string, influence: number}}>}}
 */
export function detectDuplicatorPattern(elements, options = {}) {
  const minElements = options.minElements ?? DUPLICATOR_MIN_ELEMENTS;
  const correlationMin = options.correlationMin ?? DUPLICATOR_TRAJECTORY_CORRELATION;
  const maxLag = options.maxLag ?? DUPLICATOR_TIMING_TOLERANCE_FRAMES;

  if (!Array.isArray(elements) || elements.length < minElements) {
    return { detected: false, groups: [], reason: 'insufficient_elements' };
  }

  const groups = [];
  const used = new Set();

  for (let i = 0; i < elements.length; i++) {
    if (used.has(elements[i].id)) continue;

    const group = [elements[i]];
    used.add(elements[i].id);

    for (let j = i + 1; j < elements.length; j++) {
      if (used.has(elements[j].id)) continue;

      // Compare trajectories
      const traj1 = elements[i].trajectory;
      const traj2 = elements[j].trajectory;

      if (!traj1 || !traj2 || traj1.length === 0 || traj2.length === 0) continue;

      // Extract x and y values for correlation - use minimum length
      const minLen = Math.min(traj1.length, traj2.length);
      const x1 = traj1.slice(0, minLen).map(p => p.x);
      const x2 = traj2.slice(0, minLen).map(p => p.x);
      const y1 = traj1.slice(0, minLen).map(p => p.y);
      const y2 = traj2.slice(0, minLen).map(p => p.y);

      // For duplicator detection, we check if trajectories have similar SHAPE
      // not necessarily same absolute values (they can be offset and phase
      // delayed). The lag search finds the phase delay between the two.
      const xLag = crossCorrelate(x1, x2, maxLag);
      const yLag = crossCorrelate(y1, y2, maxLag);

      // Both dimensions must correlate well in shape
      if (xLag.correlation >= correlationMin &&
          yLag.correlation >= correlationMin) {

        // The stronger dimension decides the lag; ties resolve to x.
        const bestLag = xLag.correlation >= yLag.correlation ? xLag.lag : yLag.lag;

        // Frames per sample step, so an index lag becomes a frame lag.
        const firstFrame = traj1[0].frame;
        const lastFrame = traj1[traj1.length - 1].frame;
        const frameStep = traj1.length > 1 ? (lastFrame - firstFrame) / (traj1.length - 1) : 1;
        const lagFrames = Math.max(0, Math.round(Math.abs(bestLag) * frameStep));

        // Spatial offset measured at the aligned phase:
        // traj2[i + bestLag] ~ traj1[i] + offset.
        let offsetX = 0;
        let offsetY = 0;
        let samples = 0;
        for (let k = 0; k < minLen; k++) {
          const aligned = k + bestLag;
          if (aligned >= 0 && aligned < minLen) {
            offsetX += traj2[aligned].x - traj1[k].x;
            offsetY += traj2[aligned].y - traj1[k].y;
            samples++;
          }
        }
        if (samples > 0) {
          offsetX /= samples;
          offsetY /= samples;
        }

        group.push({
          ...elements[j],
          lagFrames,
          spatialOffset: { x: offsetX, y: offsetY },
          correlation: Math.min(xLag.correlation, yLag.correlation)
        });
        used.add(elements[j].id);
      }
    }

    if (group.length >= minElements) {
      const firstMember = group[1] ?? group[0];
      const lagFrames = firstMember?.lagFrames ?? 0;
      const spatialOffset = firstMember?.spatialOffset ?? { x: 0, y: 0 };
      const staggerOffset = Math.round(Math.hypot(spatialOffset.x, spatialOffset.y) * 100) / 100;
      groups.push({
        elementIds: group.map(g => g.id),
        lagFrames,
        spatialOffset,
        correlation: firstMember?.correlation ?? 0,
        baseElementId: elements[i].id,
        stagger: {
          type: lagFrames > 0 ? 'temporal' : 'spatial',
          lagFrames,
          offset: staggerOffset
        },
        falloff: { type: 'linear', influence: 1 }
      });
    }
  }

  return {
    detected: groups.length > 0,
    groups,
    totalElements: elements.length,
    groupedElements: groups.reduce((sum, g) => sum + g.elementIds.length, 0)
  };
}

/**
 * Analyze a single property trajectory and determine the best promotion.
 *
 * Decision order without pixelScale (normalized units, unchanged):
 *   static -> cubic_bezier (monotonic, RMSE gate) -> damped_spring (R^2 gate)
 *   -> keyframes fallback.
 *
 * Decision order with pixelScale (source pixels per normalized unit, derived
 * by the caller from the frame dimensions): preset promotions are tried first
 * and must additionally hold `bezierRmseMaxPx` on EVERY frame in pixel units.
 * A preset that misses the pixel gate is bypassed for a 4-parameter weighted
 * cubic-bezier fit ({inWeight, inAngle, outWeight, outAngle}); if that also
 * misses the gate, measured keyframes are kept. The fired gate is recorded as
 * metrics-level `gate` ('preset' | 'pixel_fallback' | 'keyframes') with
 * `pixelRmse` where computable.
 *
 * @param {Object} params
 * @param {string} params.elementId - Element identifier
 * @param {string} params.property - Property name (x, y, scale, rotation, opacity)
 * @param {Array<{frame: number, value: number}>} params.points - Trajectory points
 * @param {string} [params.attributePath] - Cavalry attribute path
 * @param {number} [params.pixelScale] - Source pixels per normalized unit; enables the pixel gate
 * @param {number} [params.bezierRmseMaxPx] - Per-frame pixel gate (default 1.5; config proceduralPromotion.bezierRmseMaxPx)
 * @returns {Object} Promotion result with type and parameters
 */
export function analyzeTrajectory({ elementId, property, points, attributePath, pixelScale, bezierRmseMaxPx }) {
  if (!elementId || !property) {
    fail('PROMOTION_INVALID', 'elementId and property are required.');
  }

  if (pixelScale !== undefined && pixelScale !== null &&
      (typeof pixelScale !== 'number' || !Number.isFinite(pixelScale) || pixelScale <= 0)) {
    fail('PROMOTION_INVALID', 'pixelScale must be a positive finite number.', { pixelScale });
  }
  if (bezierRmseMaxPx !== undefined && bezierRmseMaxPx !== null &&
      (typeof bezierRmseMaxPx !== 'number' || !Number.isFinite(bezierRmseMaxPx) || bezierRmseMaxPx <= 0)) {
    fail('PROMOTION_INVALID', 'bezierRmseMaxPx must be a positive finite number.', { bezierRmseMaxPx });
  }

  if (!Array.isArray(points) || points.length < 2) {
    return {
      elementId,
      property,
      attributePath: attributePath ?? null,
      promotion: 'none',
      reason: 'insufficient_points',
      pointCount: points?.length ?? 0
    };
  }

  // Check for constant value (no animation needed)
  const values = points.map(p => p.value);
  const uniqueValues = new Set(values.map(v => Math.round(v * 1000) / 1000));
  if (uniqueValues.size === 1) {
    return {
      elementId,
      property,
      attributePath: attributePath ?? null,
      promotion: 'static',
      value: values[0],
      reason: 'constant_value'
    };
  }

  // Normalize for fitting
  const { normalized, minFrame, maxFrame, minValue, maxValue, frameRange, valueRange } = normalizeTrajectory(points);

  // Check for monotonic smooth transition (bezier candidate)
  const isMonotonic = checkMonotonic(normalized.map(p => p.v));

  const pixelGateEnabled = pixelScale !== undefined && pixelScale !== null;
  const pixelMaxPx = bezierRmseMaxPx ?? BEZIER_RMSE_MAX_PX;

  /**
   * Per-frame pixel errors of a normalized prediction against the measured
   * trajectory: |predicted - actual| * pixelScale for every sample.
   */
  const pixelErrorsOf = predicted => {
    const perFrame = normalized.map((p, i) => Math.abs(predicted[i] - p.v) * pixelScale);
    return {
      perFrame,
      rmse: Math.sqrt(perFrame.reduce((sum, e) => sum + e * e, 0) / perFrame.length),
      maxError: Math.max(...perFrame)
    };
  };

  // Preset promotions first. In pixel mode each preset must additionally hold
  // bezierRmseMaxPx on every frame, otherwise it is bypassed.
  let bypassedPixelRmse = null;

  if (isMonotonic) {
    const bezierFit = fitCubicBezier(normalized);
    if (bezierFit.success) {
      if (!pixelGateEnabled) {
        return {
          elementId,
          property,
          attributePath: attributePath ?? null,
          promotion: 'cubic_bezier',
          parameters: {
            y1: bezierFit.y1,
            y2: bezierFit.y2,
            startFrame: minFrame,
            endFrame: maxFrame,
            startValue: minValue,
            endValue: maxValue
          },
          metrics: {
            rmse: bezierFit.rmse,
            threshold: BEZIER_RMSE_THRESHOLD,
            pointCount: points.length,
            frameRange
          },
          gate: 'preset',
          confidence: Math.max(0, 1 - bezierFit.rmse / BEZIER_RMSE_THRESHOLD)
        };
      }

      const pixels = pixelErrorsOf(bezierFit.predicted);
      if (pixels.maxError <= pixelMaxPx) {
        return {
          elementId,
          property,
          attributePath: attributePath ?? null,
          promotion: 'cubic_bezier',
          parameters: {
            y1: bezierFit.y1,
            y2: bezierFit.y2,
            startFrame: minFrame,
            endFrame: maxFrame,
            startValue: minValue,
            endValue: maxValue
          },
          metrics: {
            rmse: bezierFit.rmse,
            threshold: BEZIER_RMSE_THRESHOLD,
            pixelRmse: pixels.rmse,
            pixelMaxError: pixels.maxError,
            pixelThreshold: pixelMaxPx,
            pointCount: points.length,
            frameRange
          },
          gate: 'preset',
          pixelRmse: pixels.rmse,
          confidence: Math.max(0, 1 - bezierFit.rmse / BEZIER_RMSE_THRESHOLD)
        };
      }
      bypassedPixelRmse = pixels.rmse;
    }
  }

  // Check for oscillating trajectory (spring candidate). The target is the
  // trajectory's settle value (its normalized final sample), NOT 1.0: the
  // min-max normalization maps the data maximum to 1.0, so a target of 1.0
  // admits no overshoot at all and the spring path could never fire.
  const springFit = fitDampedSpring(normalized, normalized[normalized.length - 1].v);
  if (springFit.success) {
    if (!pixelGateEnabled) {
      return {
        elementId,
        property,
        attributePath: attributePath ?? null,
        promotion: 'damped_spring',
        parameters: {
          zeta: springFit.zeta,
          omega0: springFit.omega0,
          startFrame: minFrame,
          endFrame: maxFrame,
          startValue: minValue,
          targetValue: maxValue,
          initialValue: points[0].value
        },
        metrics: {
          r2: springFit.r2,
          threshold: SPRING_R2_THRESHOLD,
          signChanges: springFit.signChanges,
          pointCount: points.length,
          frameRange
        },
        gate: 'preset',
        confidence: Math.min(1, springFit.r2)
      };
    }

    const pixels = pixelErrorsOf(springFit.predicted);
    if (pixels.maxError <= pixelMaxPx) {
      return {
        elementId,
        property,
        attributePath: attributePath ?? null,
        promotion: 'damped_spring',
        parameters: {
          zeta: springFit.zeta,
          omega0: springFit.omega0,
          startFrame: minFrame,
          endFrame: maxFrame,
          startValue: minValue,
          targetValue: maxValue,
          initialValue: points[0].value
        },
        metrics: {
          r2: springFit.r2,
          threshold: SPRING_R2_THRESHOLD,
          signChanges: springFit.signChanges,
          pixelRmse: pixels.rmse,
          pixelMaxError: pixels.maxError,
          pixelThreshold: pixelMaxPx,
          pointCount: points.length,
          frameRange
        },
        gate: 'preset',
        pixelRmse: pixels.rmse,
        confidence: Math.min(1, springFit.r2)
      };
    }
    bypassedPixelRmse = bypassedPixelRmse ?? pixels.rmse;
  }

  // Pixel fallback: 4-parameter weighted cubic-bezier fit (explicit tangents).
  if (pixelGateEnabled) {
    const weightedFit = fitWeightedCubicBezier(normalized);
    if (weightedFit.predicted.length === normalized.length) {
      const pixels = pixelErrorsOf(weightedFit.predicted);
      if (pixels.maxError <= pixelMaxPx) {
        return {
          elementId,
          property,
          attributePath: attributePath ?? null,
          promotion: 'cubic_bezier',
          parameters: {
            inWeight: weightedFit.inWeight,
            inAngle: weightedFit.inAngle,
            outWeight: weightedFit.outWeight,
            outAngle: weightedFit.outAngle,
            startFrame: minFrame,
            endFrame: maxFrame,
            startValue: minValue,
            endValue: maxValue
          },
          metrics: {
            rmse: weightedFit.rmse,
            threshold: BEZIER_RMSE_THRESHOLD,
            pixelRmse: pixels.rmse,
            pixelMaxError: pixels.maxError,
            pixelThreshold: pixelMaxPx,
            pointCount: points.length,
            frameRange
          },
          gate: 'pixel_fallback',
          pixelRmse: pixels.rmse,
          confidence: Math.max(0, Math.min(1, 1 - pixels.maxError / pixelMaxPx))
        };
      }

      // Hopeless for every procedural form: keep measured keyframes.
      return {
        elementId,
        property,
        attributePath: attributePath ?? null,
        promotion: 'keyframes',
        reason: 'pixel_gate_failed',
        metrics: {
          pointCount: points.length,
          frameRange,
          valueRange,
          isMonotonic,
          pixelRmse: pixels.rmse,
          pixelMaxError: pixels.maxError,
          pixelThreshold: pixelMaxPx,
          ...(bypassedPixelRmse !== null ? { bypassedPresetPixelRmse: bypassedPixelRmse } : {})
        },
        gate: 'keyframes',
        pixelRmse: pixels.rmse,
        keyframes: points.map(p => ({ frame: p.frame, value: p.value }))
      };
    }
  }

  // No promotion — keep as measured keyframes
  return {
    elementId,
    property,
    attributePath: attributePath ?? null,
    promotion: 'keyframes',
    reason: 'no_procedural_fit',
    metrics: {
      pointCount: points.length,
      frameRange,
      valueRange,
      isMonotonic
    },
    gate: 'keyframes',
    keyframes: points.map(p => ({ frame: p.frame, value: p.value }))
  };
}

/**
 * Check if a sequence is monotonically increasing or decreasing.
 */
function checkMonotonic(values) {
  if (values.length < 2) return true;

  let increasing = true;
  let decreasing = true;

  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) increasing = false;
    if (values[i] > values[i - 1]) decreasing = false;
    if (!increasing && !decreasing) return false;
  }

  return true;
}

/**
 * Analyze all trajectories for an element and produce a promotion plan.
 *
 * @param {Object} params
 * @param {string} params.elementId
 * @param {Object} params.trajectories - Map of property name to trajectory points
 * @param {number} params.fps - Frame rate for timing calculations
 * @param {number} [params.pixelScale] - Source pixels per normalized unit (enables the pixel gate)
 * @param {number} [params.bezierRmseMaxPx] - Per-frame pixel gate (default 1.5)
 * @param {Object} [params.layout] - Normalized layout descriptor from Stage 2
 * @returns {Object} Element promotion plan
 */
export function analyzeElement({ elementId, trajectories, fps, pixelScale, bezierRmseMaxPx, layout }) {
  if (!elementId) {
    fail('PROMOTION_INVALID', 'elementId is required.');
  }

  const promotions = [];
  const promotionTypes = new Set();

  for (const [property, points] of Object.entries(trajectories)) {
    const result = analyzeTrajectory({ elementId, property, points, pixelScale, bezierRmseMaxPx });
    promotions.push(result);
    promotionTypes.add(result.promotion);
  }

  // Determine overall element promotion status
  const hasSpring = promotionTypes.has('damped_spring');
  const hasBezier = promotionTypes.has('cubic_bezier');
  const hasKeyframes = promotionTypes.has('keyframes');
  const allStatic = [...promotionTypes].every(t => t === 'static' || t === 'none');

  let overallPromotion = 'keyframes';
  if (allStatic) overallPromotion = 'static';
  else if (hasSpring) overallPromotion = 'damped_spring';
  else if (hasBezier && !hasKeyframes) overallPromotion = 'cubic_bezier';
  else if (hasBezier) overallPromotion = 'mixed';

  return {
    elementId,
    fps,
    overallPromotion,
    promotions,
    promotionTypes: [...promotionTypes],
    ...(layout ? { layout: { ...layout } } : {}),
    metrics: {
      propertyCount: promotions.length,
      springCount: promotions.filter(p => p.promotion === 'damped_spring').length,
      bezierCount: promotions.filter(p => p.promotion === 'cubic_bezier').length,
      keyframeCount: promotions.filter(p => p.promotion === 'keyframes').length
    }
  };
}

/**
 * Generate Cavalry _mg DSL expression for a promoted behavior.
 *
 * Every expression carries an `op` descriptor used by the Stage 4 compiler to
 * order operations into dependency tiers:
 * - cubic_bezier with CSS easing (y1, y2)  -> { kind: 'keyframe' }   (tier 4)
 * - cubic_bezier with weighted handles     -> { kind: 'tangent' }    (tier 5)
 * - damped_spring behavior                 -> { kind: 'connection' } (tier 3)
 * - keyframes fallback                     -> { kind: 'keyframe' }   (tier 4)
 * - static / none                          -> { kind: null } (not compiled)
 *
 * @param {Object} promotion - Promotion result from analyzeTrajectory
 * @param {Object} options - Additional options
 * @returns {{dsl: string, undoGroup: string, presetBinding: string|null, op: {kind: string, element: string, property: string}|null}}
 */
export function compileToMgDSL(promotion, options = {}) {
  const { elementId, property, promotion: type, parameters } = promotion;

  if (type === 'static') {
    return {
      dsl: `// Static value — no animation\n// ${elementId}.${property} = ${promotion.value}`,
      undoGroup: `static-${elementId}-${property}`,
      presetBinding: null,
      op: null
    };
  }

  if (type === 'cubic_bezier') {
    const {
      y1, y2, inWeight, inAngle, outWeight, outAngle,
      startFrame, endFrame, startValue, endValue
    } = parameters;
    const weighted = [inWeight, inAngle, outWeight, outAngle]
      .some(v => v !== undefined && v !== null);

    const easingBlock = weighted
      ? `    type: "cubic-bezier",
    inWeight: ${inWeight},
    inAngle: ${inAngle},
    outWeight: ${outWeight},
    outAngle: ${outAngle}`
      : `    type: "cubic-bezier",
    y1: ${y1},
    y2: ${y2}`;

    // Cavalry keyframe DSL; weighted handles are explicit Bézier tangents.
    const dsl = `// Cubic Bezier Promotion: ${elementId}.${property}
// RMSE: ${promotion.metrics.rmse.toFixed(4)} <= ${promotion.metrics.threshold}
_mg.keyframe({
  element: "${elementId}",
  property: "${property}",
  startFrame: ${startFrame},
  endFrame: ${endFrame},
  startValue: ${startValue},
  endValue: ${endValue},
  easing: {
${easingBlock}
  }
});`;

    return {
      dsl,
      undoGroup: `bezier-${elementId}-${property}-${startFrame}-${endFrame}`,
      presetBinding: options.presetId ?? null,
      op: {
        kind: weighted ? 'tangent' : 'keyframe',
        element: elementId,
        property
      }
    };
  }

  if (type === 'damped_spring') {
    const { zeta, omega0, startFrame, endFrame, startValue, targetValue } = parameters;

    // Cavalry spring/oscillator DSL
    const dsl = `// Damped Spring Promotion: ${elementId}.${property}
// R²: ${promotion.metrics.r2.toFixed(4)} >= ${promotion.metrics.threshold}
// ζ (damping ratio): ${zeta}, ω₀ (natural frequency): ${omega0}
_mg.behavior({
  element: "${elementId}",
  type: "spring",
  property: "${property}",
  startFrame: ${startFrame},
  parameters: {
    dampingRatio: ${zeta},
    naturalFrequency: ${omega0},
    initialValue: ${startValue},
    targetValue: ${targetValue}
  },
  duration: ${endFrame - startFrame}
});`;

    return {
      dsl,
      undoGroup: `spring-${elementId}-${property}-${startFrame}`,
      presetBinding: options.presetId ?? 'spring-oscillator',
      op: {
        kind: 'connection',
        element: elementId,
        property
      }
    };
  }

  // Fallback: keyframes
  if (type === 'keyframes' && promotion.keyframes) {
    const keyframeLines = promotion.keyframes
      .map(kf => `  { frame: ${kf.frame}, value: ${kf.value} }`)
      .join(',\n');

    const dsl = `// Keyframe fallback: ${elementId}.${property}
// No procedural fit met threshold
_mg.keyframes({
  element: "${elementId}",
  property: "${property}",
  points: [
${keyframeLines}
  ]
});`;

    return {
      dsl,
      undoGroup: `keyframes-${elementId}-${property}`,
      presetBinding: null,
      op: {
        kind: 'keyframe',
        element: elementId,
        property
      }
    };
  }

  return {
    dsl: `// No promotion: ${elementId}.${property}`,
    undoGroup: `none-${elementId}-${property}`,
    presetBinding: null,
    op: null
  };
}

/**
 * Generate Cavalry Duplicator + Stagger DSL for a detected pattern.
 *
 * Emits a complete duplicator rig: `stagger` ({type, lagFrames, offset}) and
 * `falloff` ({type, influence}). When the group carries no measured
 * stagger/falloff (older artifacts), they are derived from lagFrames and the
 * spatial offset magnitude.
 *
 * @param {Object} group - Duplicator group from detectDuplicatorPattern
 * @param {Object} options - Additional options
 * @returns {{dsl: string, undoGroup: string, presetBinding: string|null, op: {kind: string, element: string, property: null}}}
 */
export function compileDuplicatorToMgDSL(group, options = {}) {
  const { elementIds, lagFrames, spatialOffset, baseElementId } = group;
  const count = elementIds.length;

  const fallbackOffset = Math.round(
    Math.hypot(spatialOffset?.x ?? 0, spatialOffset?.y ?? 0) * 100
  ) / 100;
  const stagger = group.stagger ?? {
    type: lagFrames ? 'temporal' : 'spatial',
    lagFrames: lagFrames ?? 0,
    offset: fallbackOffset
  };
  const falloff = group.falloff ?? { type: 'linear', influence: 1 };

  const dsl = `// Duplicator + Stagger Promotion
// Base element: ${baseElementId}
// Count: ${count}, Lag: ${lagFrames} frames, Offset: (${spatialOffset.x.toFixed(2)}, ${spatialOffset.y.toFixed(2)})
_mg.duplicator({
  base: "${baseElementId}",
  count: ${count},
  stagger: {
    type: "${stagger.type}",
    lagFrames: ${stagger.lagFrames},
    offset: ${stagger.offset}
  },
  falloff: {
    type: "${falloff.type}",
    influence: ${falloff.influence}
  }
});`;

  return {
    dsl,
    undoGroup: `duplicator-${baseElementId}-${count}`,
    presetBinding: options.presetId ?? 'duplicator-stagger',
    op: {
      kind: 'deformer',
      element: baseElementId,
      property: null
    }
  };
}

/**
 * Wrap multiple DSL expressions in an atomic Undo group.
 *
 * @param {Array<{dsl: string, undoGroup: string}>} expressions
 * @param {string} groupName - Name for the atomic undo group
 * @returns {string} Complete DSL script with atomic undo wrapping
 */
export function wrapAtomicUndo(expressions, groupName) {
  const undoId = `undo-${hashObject({ groupName, count: expressions.length }).slice(0, 8)}`;

  const body = expressions.map(e => e.dsl).join('\n\n');

  return `// Atomic Undo Group: ${groupName}
// All operations in this group can be reverted with a single undo
_mg.undoGroup({
  id: "${undoId}",
  name: "${groupName}",
  operations: () => {
${body.split('\n').map(line => `    ${line}`).join('\n')}
  }
});`;
}

/**
 * Full promotion analysis for a scene plan.
 *
 * @param {Object} params
 * @param {Array} params.elements - Elements with trajectories
 * @param {number} params.fps - Frame rate
 * @param {Object} [params.capabilities] - Adapter capabilities
 * @param {number} [params.pixelScale] - Source pixels per normalized unit (enables the pixel gate)
 * @param {number} [params.bezierRmseMaxPx] - Per-frame pixel gate (default 1.5)
 * @param {Object} [params.duplicatorOptions] - detectDuplicatorPattern thresholds
 * @returns {Object} Complete promotion analysis
 */
export function analyzeScenePromotion({ elements, fps, capabilities, pixelScale, bezierRmseMaxPx, duplicatorOptions }) {
  if (!Array.isArray(elements) || elements.length === 0) {
    return {
      version: PROMOTION_VERSION,
      fps,
      elements: [],
      duplicatorGroups: [],
      summary: {
        totalElements: 0,
        springPromotions: 0,
        bezierPromotions: 0,
        keyframeFallbacks: 0,
        duplicatorGroups: 0
      }
    };
  }

  const elementAnalyses = [];
  const allTrajectories = [];

  for (const element of elements) {
    const analysis = analyzeElement({
      elementId: element.id,
      trajectories: element.trajectories ?? {},
      fps,
      pixelScale,
      bezierRmseMaxPx,
      layout: element.layout
    });
    elementAnalyses.push(analysis);

    // Collect trajectories for duplicator detection
    if (element.trajectories?.x && element.trajectories?.y) {
      const frames = element.trajectories.x.map(p => p.frame);
      allTrajectories.push({
        id: element.id,
        trajectory: frames.map(frame => {
          const xPoint = element.trajectories.x.find(p => p.frame === frame);
          const yPoint = element.trajectories.y.find(p => p.frame === frame);
          return {
            frame,
            x: xPoint?.value ?? 0,
            y: yPoint?.value ?? 0
          };
        })
      });
    }
  }

  // Detect duplicator patterns
  const duplicatorResult = detectDuplicatorPattern(allTrajectories, duplicatorOptions);

  // Compute summary
  const summary = {
    totalElements: elements.length,
    springPromotions: elementAnalyses.reduce((sum, e) =>
      sum + e.promotions.filter(p => p.promotion === 'damped_spring').length, 0),
    bezierPromotions: elementAnalyses.reduce((sum, e) =>
      sum + e.promotions.filter(p => p.promotion === 'cubic_bezier').length, 0),
    keyframeFallbacks: elementAnalyses.reduce((sum, e) =>
      sum + e.promotions.filter(p => p.promotion === 'keyframes').length, 0),
    duplicatorGroups: duplicatorResult.groups.length,
    duplicatorElements: duplicatorResult.groupedElements ?? 0
  };

  return {
    version: PROMOTION_VERSION,
    fps,
    elements: elementAnalyses,
    duplicatorGroups: duplicatorResult.groups,
    duplicatorDetection: duplicatorResult,
    summary,
    thresholds: {
      bezierRMSE: BEZIER_RMSE_THRESHOLD,
      springR2: SPRING_R2_THRESHOLD,
      duplicatorMinElements: DUPLICATOR_MIN_ELEMENTS,
      duplicatorCorrelation: DUPLICATOR_TRAJECTORY_CORRELATION
    }
  };
}

/**
 * Compile a full promotion analysis to _mg DSL with atomic undo.
 *
 * @param {Object} analysis - Result from analyzeScenePromotion
 * @param {Object} options - Compilation options
 * @returns {{script: string, undoGroups: Array<string>, presetBindings: Array<string>}}
 */
export function compilePromotionToScript(analysis, options = {}) {
  const expressions = [];
  const presetBindings = [];

  // Compile element promotions
  for (const element of analysis.elements) {
    for (const promotion of element.promotions) {
      if (promotion.promotion === 'none' || promotion.promotion === 'static') continue;

      const compiled = compileToMgDSL(promotion, options);
      expressions.push(compiled);
      if (compiled.presetBinding) {
        presetBindings.push(compiled.presetBinding);
      }
    }
  }

  // Compile duplicator groups
  for (const group of analysis.duplicatorGroups) {
    const compiled = compileDuplicatorToMgDSL(group, options);
    expressions.push(compiled);
    if (compiled.presetBinding) {
      presetBindings.push(compiled.presetBinding);
    }
  }

  // Wrap in atomic undo
  const groupName = options.groupName ?? 'procedural-promotion';
  const script = expressions.length > 0
    ? wrapAtomicUndo(expressions, groupName)
    : '// No procedural promotions detected';

  return {
    script,
    undoGroups: expressions.map(e => e.undoGroup),
    presetBindings: [...new Set(presetBindings)],
    expressionCount: expressions.length
  };
}
