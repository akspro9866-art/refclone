/**
 * Procedural Promotion Solver — Stage 3 of the 5-Stage Closed-Loop Pipeline
 *
 * Analyzes normalized trajectories and promotes them to procedural Cavalry behaviors
 * instead of raw per-frame keyframes:
 * - Cubic-Bezier fitting for smooth monotonic transitions (RMSE <= 0.015)
 * - Damped Spring detection for oscillating trajectories (R^2 >= 0.92)
 * - Duplicator & Stagger detection for N>=2 correlated elements
 *
 * All promotions are evidence-based: a trajectory that doesn't meet the threshold
 * stays as measured keyframes rather than being forced into a procedural form.
 */

import { WorkflowError, hashObject } from './core.mjs';

export const PROMOTION_VERSION = '1.0.0';

// Promotion thresholds — conservative to avoid false positives
const BEZIER_RMSE_THRESHOLD = 0.015;
const SPRING_R2_THRESHOLD = 0.92;
const DUPLICATOR_MIN_ELEMENTS = 2;
const DUPLICATOR_TRAJECTORY_CORRELATION = 0.85;
const DUPLICATOR_TIMING_TOLERANCE_FRAMES = 2;

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
 * Returns the correlation coefficient at the best lag.
 */
function crossCorrelate(traj1, traj2, maxLag) {
  if (traj1.length !== traj2.length) {
    return { correlation: 0, lag: 0 };
  }

  const mean1 = traj1.reduce((s, v) => s + v, 0) / traj1.length;
  const mean2 = traj2.reduce((s, v) => s + v, 0) / traj2.length;

  let bestCorrelation = -Infinity;
  let bestLag = 0;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < traj1.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < traj2.length) {
        sum += (traj1[i] - mean1) * (traj2[j] - mean2);
        count++;
      }
    }
    if (count === 0) continue;

    const std1 = Math.sqrt(traj1.reduce((s, v) => s + (v - mean1) ** 2, 0) / traj1.length);
    const std2 = Math.sqrt(traj2.reduce((s, v) => s + (v - mean2) ** 2, 0) / traj2.length);

    if (std1 === 0 || std2 === 0) continue;

    const correlation = sum / (count * std1 * std2);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  return { correlation: bestCorrelation, lag: bestLag };
}

/**
 * Detect duplicator/stagger patterns among multiple element trajectories.
 *
 * @param {Array<{id: string, trajectory: Array<{frame: number, x: number, y: number, scale?: number, rotation?: number}>}>} elements
 * @returns {{detected: boolean, groups: Array<{elementIds: string[], lagFrames: number, spatialOffset: {x: number, y: number}, correlation: number}>}}
 */
export function detectDuplicatorPattern(elements) {
  if (!Array.isArray(elements) || elements.length < DUPLICATOR_MIN_ELEMENTS) {
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
      // not necessarily same absolute values (they can be offset)
      const xCorr = computeShapeCorrelation(x1, x2);
      const yCorr = computeShapeCorrelation(y1, y2);

      // Both dimensions must correlate well in shape
      if (xCorr >= DUPLICATOR_TRAJECTORY_CORRELATION &&
          yCorr >= DUPLICATOR_TRAJECTORY_CORRELATION) {

        // Compute average spatial offset
        const offsetX = traj2.slice(0, minLen).reduce((sum, p, idx) => sum + (p.x - traj1[idx].x), 0) / minLen;
        const offsetY = traj2.slice(0, minLen).reduce((sum, p, idx) => sum + (p.y - traj1[idx].y), 0) / minLen;

        group.push({
          ...elements[j],
          lagFrames: 0,
          spatialOffset: { x: offsetX, y: offsetY },
          correlation: Math.min(xCorr, yCorr)
        });
        used.add(elements[j].id);
      }
    }

    if (group.length >= DUPLICATOR_MIN_ELEMENTS) {
      groups.push({
        elementIds: group.map(g => g.id),
        lagFrames: group[1]?.lagFrames ?? 0,
        spatialOffset: group[1]?.spatialOffset ?? { x: 0, y: 0 },
        correlation: group[1]?.correlation ?? 0,
        baseElementId: elements[i].id
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
 * Compute shape correlation between two trajectories (normalized, offset-invariant).
 */
function computeShapeCorrelation(traj1, traj2) {
  if (traj1.length !== traj2.length || traj1.length < 2) return 0;

  // Normalize both to zero mean and unit variance
  const mean1 = traj1.reduce((s, v) => s + v, 0) / traj1.length;
  const mean2 = traj2.reduce((s, v) => s + v, 0) / traj2.length;

  const std1 = Math.sqrt(traj1.reduce((s, v) => s + (v - mean1) ** 2, 0) / traj1.length);
  const std2 = Math.sqrt(traj2.reduce((s, v) => s + (v - mean2) ** 2, 0) / traj2.length);

  // If either is constant, check if both are constant
  if (std1 < 1e-9 && std2 < 1e-9) return 1; // Both constant = perfect match
  if (std1 < 1e-9 || std2 < 1e-9) return 0; // One constant, one not = no match

  // Compute Pearson correlation
  let sum = 0;
  for (let i = 0; i < traj1.length; i++) {
    sum += ((traj1[i] - mean1) / std1) * ((traj2[i] - mean2) / std2);
  }

  return sum / traj1.length;
}

/**
 * Analyze a single property trajectory and determine the best promotion.
 *
 * @param {Object} params
 * @param {string} params.elementId - Element identifier
 * @param {string} params.property - Property name (x, y, scale, rotation, opacity)
 * @param {Array<{frame: number, value: number}>} params.points - Trajectory points
 * @param {string} [params.attributePath] - Cavalry attribute path
 * @returns {Object} Promotion result with type and parameters
 */
export function analyzeTrajectory({ elementId, property, points, attributePath }) {
  if (!elementId || !property) {
    fail('PROMOTION_INVALID', 'elementId and property are required.');
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

  if (isMonotonic) {
    const bezierFit = fitCubicBezier(normalized);
    if (bezierFit.success) {
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
        confidence: Math.max(0, 1 - bezierFit.rmse / BEZIER_RMSE_THRESHOLD)
      };
    }
  }

  // Check for oscillating trajectory (spring candidate)
  const springFit = fitDampedSpring(normalized, 1);
  if (springFit.success) {
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
      confidence: Math.min(1, springFit.r2)
    };
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
 * @returns {Object} Element promotion plan
 */
export function analyzeElement({ elementId, trajectories, fps }) {
  if (!elementId) {
    fail('PROMOTION_INVALID', 'elementId is required.');
  }

  const promotions = [];
  const promotionTypes = new Set();

  for (const [property, points] of Object.entries(trajectories)) {
    const result = analyzeTrajectory({ elementId, property, points });
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
 * @param {Object} promotion - Promotion result from analyzeTrajectory
 * @param {Object} options - Additional options
 * @returns {{dsl: string, undoGroup: string, presetBinding: string|null}}
 */
export function compileToMgDSL(promotion, options = {}) {
  const { elementId, property, promotion: type, parameters } = promotion;

  if (type === 'static') {
    return {
      dsl: `// Static value — no animation\n// ${elementId}.${property} = ${promotion.value}`,
      undoGroup: `static-${elementId}-${property}`,
      presetBinding: null
    };
  }

  if (type === 'cubic_bezier') {
    const { y1, y2, startFrame, endFrame, startValue, endValue } = parameters;
    const duration = endFrame - startFrame;

    // Cavalry spring/oscillator DSL
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
    type: "cubic-bezier",
    y1: ${y1},
    y2: ${y2}
  }
});`;

    return {
      dsl,
      undoGroup: `bezier-${elementId}-${property}-${startFrame}-${endFrame}`,
      presetBinding: options.presetId ?? null
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
      presetBinding: options.presetId ?? 'spring-oscillator'
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
      presetBinding: null
    };
  }

  return {
    dsl: `// No promotion: ${elementId}.${property}`,
    undoGroup: `none-${elementId}-${property}`,
    presetBinding: null
  };
}

/**
 * Generate Cavalry Duplicator + Stagger DSL for a detected pattern.
 *
 * @param {Object} group - Duplicator group from detectDuplicatorPattern
 * @param {Object} options - Additional options
 * @returns {{dsl: string, undoGroup: string}}
 */
export function compileDuplicatorToMgDSL(group, options = {}) {
  const { elementIds, lagFrames, spatialOffset, baseElementId } = group;
  const count = elementIds.length;

  const dsl = `// Duplicator + Stagger Promotion
// Base element: ${baseElementId}
// Count: ${count}, Lag: ${lagFrames} frames, Offset: (${spatialOffset.x.toFixed(2)}, ${spatialOffset.y.toFixed(2)})
_mg.duplicator({
  base: "${baseElementId}",
  count: ${count},
  stagger: {
    type: "${lagFrames !== 0 ? 'temporal' : 'spatial'}",
    lagFrames: ${lagFrames},
    offset: { x: ${spatialOffset.x}, y: ${spatialOffset.y} }
  },
  falloff: {
    type: "linear",
    influence: 1.0
  }
});`;

  return {
    dsl,
    undoGroup: `duplicator-${baseElementId}-${count}`,
    presetBinding: options.presetId ?? 'duplicator-stagger'
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
 * @returns {Object} Complete promotion analysis
 */
export function analyzeScenePromotion({ elements, fps, capabilities }) {
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
      fps
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
  const duplicatorResult = detectDuplicatorPattern(allTrajectories);

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
