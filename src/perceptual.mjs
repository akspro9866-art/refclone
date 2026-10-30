/**
 * Closed-Loop Perceptual Diff Gate — Stage 5 of the 5-Stage Pipeline
 *
 * Compares rendered/synthetic preview frames against reference inflection frames
 * on 4 metrics:
 * - Bounding-Box IoU (target >= 0.90)
 * - Normalized Centroid Offset (target <= 0.02)
 * - Peak Velocity Timing Delta (target <= 1 frame)
 * - Structural Similarity SSIM (target >= 0.88)
 *
 * Emits structured numeric correction deltas for iterative parameter refinement.
 */

import { PNG } from 'pngjs';
import { WorkflowError, hashObject } from './core.mjs';

export const PERCEPTUAL_VERSION = '1.0.0';

// Perceptual quality thresholds
const IOU_TARGET = 0.90;
const CENTROID_OFFSET_TARGET = 0.02;
const TIMING_DELTA_TARGET = 1; // frames
const SSIM_TARGET = 0.88;

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

/**
 * Compute Intersection over Union (IoU) between two bounding boxes.
 *
 * @param {{x: number, y: number, width: number, height: number}} box1
 * @param {{x: number, y: number, width: number, height: number}} box2
 * @returns {number} IoU value in [0, 1]
 */
export function computeIoU(box1, box2) {
  if (!box1 || !box2) return 0;

  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;

  return union > 0 ? intersection / union : 0;
}

/**
 * Compute normalized centroid offset between two bounding boxes.
 *
 * @param {{x: number, y: number, width: number, height: number}} box1
 * @param {{x: number, y: number, width: number, height: number}} box2
 * @param {number} frameWidth - For normalization
 * @param {number} frameHeight - For normalization
 * @returns {number} Normalized offset distance
 */
export function computeCentroidOffset(box1, box2, frameWidth, frameHeight) {
  if (!box1 || !box2) return Infinity;

  const cx1 = box1.x + box1.width / 2;
  const cy1 = box1.y + box1.height / 2;
  const cx2 = box2.x + box2.width / 2;
  const cy2 = box2.y + box2.height / 2;

  const dx = (cx1 - cx2) / frameWidth;
  const dy = (cy1 - cy2) / frameHeight;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute Structural Similarity Index (SSIM) between two images.
 * Simplified implementation for grayscale comparison.
 *
 * @param {PNG} img1
 * @param {PNG} img2
 * @returns {number} SSIM value in [0, 1]
 */
export function computeSSIM(img1, img2) {
  if (!img1 || !img2) return 0;
  if (img1.width !== img2.width || img1.height !== img2.height) {
    fail('SSIM_DIMENSION_MISMATCH', 'Images must have the same dimensions for SSIM.', {
      img1: { width: img1.width, height: img1.height },
      img2: { width: img2.width, height: img2.height }
    });
  }

  // Constants for SSIM
  const L = 255; // Dynamic range
  const k1 = 0.01;
  const k2 = 0.03;
  const c1 = (k1 * L) ** 2;
  const c2 = (k2 * L) ** 2;

  // Convert to grayscale arrays
  const gray1 = toGrayscale(img1);
  const gray2 = toGrayscale(img2);

  // Compute means
  const mu1 = mean(gray1);
  const mu2 = mean(gray2);

  // Compute variances and covariance
  const sigma1Sq = variance(gray1, mu1);
  const sigma2Sq = variance(gray2, mu2);
  const sigma12 = covariance(gray1, gray2, mu1, mu2);

  // SSIM formula
  const numerator = (2 * mu1 * mu2 + c1) * (2 * sigma12 + c2);
  const denominator = (mu1 * mu1 + mu2 * mu2 + c1) * (sigma1Sq + sigma2Sq + c2);

  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Convert PNG to grayscale array.
 */
function toGrayscale(png) {
  const gray = new Float64Array(png.width * png.height);
  for (let i = 0; i < png.data.length; i += 4) {
    const idx = i / 4;
    // Standard luminance formula
    gray[idx] = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
  }
  return gray;
}

function mean(arr) {
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function variance(arr, mu) {
  return arr.reduce((sum, v) => sum + (v - mu) ** 2, 0) / arr.length;
}

function covariance(arr1, arr2, mu1, mu2) {
  let sum = 0;
  for (let i = 0; i < arr1.length; i++) {
    sum += (arr1[i] - mu1) * (arr2[i] - mu2);
  }
  return sum / arr1.length;
}

/**
 * Compute peak velocity timing delta between two trajectories.
 *
 * @param {Array<{frame: number, value: number}>} traj1 - Reference trajectory
 * @param {Array<{frame: number, value: number}>} traj2 - Rendered trajectory
 * @param {number} fps
 * @returns {number} Timing delta in frames
 */
export function computeTimingDelta(traj1, traj2, fps) {
  if (!traj1?.length || !traj2?.length) return Infinity;

  // Find peak velocity frame for each trajectory
  const peakFrame1 = findPeakVelocityFrame(traj1, fps);
  const peakFrame2 = findPeakVelocityFrame(traj2, fps);

  return Math.abs(peakFrame1 - peakFrame2);
}

/**
 * Find the frame with peak velocity in a trajectory.
 */
function findPeakVelocityFrame(trajectory, fps) {
  if (trajectory.length < 2) return trajectory[0]?.frame ?? 0;

  const sorted = [...trajectory].sort((a, b) => a.frame - b.frame);
  let maxVelocity = 0;
  let peakFrame = sorted[0].frame;

  for (let i = 1; i < sorted.length; i++) {
    const dt = (sorted[i].frame - sorted[i - 1].frame) / fps;
    const dv = Math.abs(sorted[i].value - sorted[i - 1].value);
    const velocity = dt > 0 ? dv / dt : 0;

    if (velocity > maxVelocity) {
      maxVelocity = velocity;
      peakFrame = sorted[i].frame;
    }
  }

  return peakFrame;
}

/**
 * Compare a rendered frame against a reference frame.
 *
 * @param {Object} params
 * @param {PNG} params.reference - Reference frame
 * @param {PNG} params.rendered - Rendered frame
 * @param {{x: number, y: number, width: number, height: number}} params.referenceBox
 * @param {{x: number, y: number, width: number, height: number}} params.renderedBox
 * @param {number} params.frameWidth
 * @param {number} params.frameHeight
 * @returns {Object} Comparison metrics
 */
export function compareFrames({ reference, rendered, referenceBox, renderedBox, frameWidth, frameHeight }) {
  const iou = computeIoU(referenceBox, renderedBox);
  const centroidOffset = computeCentroidOffset(referenceBox, renderedBox, frameWidth, frameHeight);
  const ssim = computeSSIM(reference, rendered);

  return {
    iou,
    centroidOffset,
    ssim,
    iouPass: iou >= IOU_TARGET,
    centroidPass: centroidOffset <= CENTROID_OFFSET_TARGET,
    ssimPass: ssim >= SSIM_TARGET,
    thresholds: {
      iou: IOU_TARGET,
      centroidOffset: CENTROID_OFFSET_TARGET,
      ssim: SSIM_TARGET
    }
  };
}

/**
 * Compare trajectories for timing alignment.
 *
 * @param {Object} params
 * @param {Array} params.referenceTrajectory
 * @param {Array} params.renderedTrajectory
 * @param {number} params.fps
 * @returns {Object} Timing comparison
 */
export function compareTrajectories({ referenceTrajectory, renderedTrajectory, fps }) {
  const timingDelta = computeTimingDelta(referenceTrajectory, renderedTrajectory, fps);

  return {
    timingDelta,
    timingPass: timingDelta <= TIMING_DELTA_TARGET,
    threshold: TIMING_DELTA_TARGET
  };
}

/**
 * Compute correction deltas for iterative refinement.
 *
 * @param {Object} metrics - Comparison metrics
 * @param {Object} params - Additional parameters
 * @returns {Object} Structured correction deltas
 */
export function computeCorrectionDeltas(metrics, params = {}) {
  const deltas = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    timing: 0,
    opacity: 0
  };

  // Position correction based on centroid offset
  if (!metrics.centroidPass && metrics.centroidOffset > 0) {
    const { referenceBox, renderedBox, frameWidth, frameHeight } = params;
    if (referenceBox && renderedBox) {
      const cx1 = referenceBox.x + referenceBox.width / 2;
      const cy1 = referenceBox.y + referenceBox.height / 2;
      const cx2 = renderedBox.x + renderedBox.width / 2;
      const cy2 = renderedBox.y + renderedBox.height / 2;

      // Apply proportional correction
      const correctionFactor = 0.5; // Conservative correction
      deltas.position.x = (cx1 - cx2) * correctionFactor;
      deltas.position.y = (cy1 - cy2) * correctionFactor;
    }
  }

  // Scale correction based on IoU
  if (!metrics.iouPass && params.referenceBox && params.renderedBox) {
    const refArea = params.referenceBox.width * params.referenceBox.height;
    const renArea = params.renderedBox.width * params.renderedBox.height;

    if (renArea > 0) {
      const scaleRatio = Math.sqrt(refArea / renArea);
      const correctionFactor = 0.5;
      deltas.scale.x = 1 + (scaleRatio - 1) * correctionFactor;
      deltas.scale.y = 1 + (scaleRatio - 1) * correctionFactor;
    }
  }

  // Timing correction
  if (metrics.timingDelta !== undefined && !metrics.timingPass) {
    deltas.timing = -metrics.timingDelta * 0.5; // Conservative timing adjustment
  }

  return deltas;
}

/**
 * Full perceptual comparison for an element across frames.
 *
 * @param {Object} params
 * @param {string} params.elementId
 * @param {Array<{frame: number, reference: PNG, rendered: PNG, referenceBox: Object, renderedBox: Object}>} params.frameComparisons
 * @param {Array} params.referenceTrajectory
 * @param {Array} params.renderedTrajectory
 * @param {number} params.frameWidth
 * @param {number} params.frameHeight
 * @param {number} params.fps
 * @returns {Object} Complete perceptual analysis
 */
export function analyzeElementPerceptual({
  elementId,
  frameComparisons,
  referenceTrajectory,
  renderedTrajectory,
  frameWidth,
  frameHeight,
  fps
}) {
  if (!elementId) {
    fail('PERCEPTUAL_INVALID', 'elementId is required.');
  }

  const frameMetrics = [];
  let totalIoU = 0;
  let totalCentroid = 0;
  let totalSSIM = 0;

  for (const comparison of frameComparisons ?? []) {
    const metrics = compareFrames({
      reference: comparison.reference,
      rendered: comparison.rendered,
      referenceBox: comparison.referenceBox,
      renderedBox: comparison.renderedBox,
      frameWidth,
      frameHeight
    });

    frameMetrics.push({
      frame: comparison.frame,
      ...metrics
    });

    totalIoU += metrics.iou;
    totalCentroid += metrics.centroidOffset;
    totalSSIM += metrics.ssim;
  }

  const frameCount = frameMetrics.length;
  const avgIoU = frameCount > 0 ? totalIoU / frameCount : 0;
  const avgCentroid = frameCount > 0 ? totalCentroid / frameCount : 0;
  const avgSSIM = frameCount > 0 ? totalSSIM / frameCount : 0;

  // Timing comparison
  const timingMetrics = compareTrajectories({
    referenceTrajectory,
    renderedTrajectory,
    fps
  });

  // Overall pass/fail
  const overallPass =
    avgIoU >= IOU_TARGET &&
    avgCentroid <= CENTROID_OFFSET_TARGET &&
    avgSSIM >= SSIM_TARGET &&
    timingMetrics.timingPass;

  // Compute correction deltas
  const correctionDeltas = computeCorrectionDeltas(
    {
      iou: avgIoU,
      centroidOffset: avgCentroid,
      ssim: avgSSIM,
      iouPass: avgIoU >= IOU_TARGET,
      centroidPass: avgCentroid <= CENTROID_OFFSET_TARGET,
      ssimPass: avgSSIM >= SSIM_TARGET,
      timingDelta: timingMetrics.timingDelta,
      timingPass: timingMetrics.timingPass
    },
    {
      frameWidth,
      frameHeight,
      referenceBox: frameMetrics[0]?.referenceBox,
      renderedBox: frameMetrics[0]?.renderedBox
    }
  );

  return {
    elementId,
    version: PERCEPTUAL_VERSION,
    overallPass,
    metrics: {
      averageIoU: avgIoU,
      averageCentroidOffset: avgCentroid,
      averageSSIM: avgSSIM,
      timingDelta: timingMetrics.timingDelta,
      frameCount
    },
    thresholds: {
      iou: IOU_TARGET,
      centroidOffset: CENTROID_OFFSET_TARGET,
      ssim: SSIM_TARGET,
      timingDelta: TIMING_DELTA_TARGET
    },
    frameMetrics,
    correctionDeltas,
    needsRefinement: !overallPass
  };
}

/**
 * Analyze perceptual quality for a complete shot.
 *
 * @param {Object} params
 * @param {string} params.shotId
 * @param {Array} params.elements - Element perceptual analyses
 * @returns {Object} Shot perceptual summary
 */
export function analyzeShotPerceptual({ shotId, elements }) {
  if (!shotId) {
    fail('PERCEPTUAL_INVALID', 'shotId is required.');
  }

  const elementAnalyses = elements ?? [];
  const passingElements = elementAnalyses.filter(e => e.overallPass);
  const failingElements = elementAnalyses.filter(e => !e.overallPass);

  return {
    shotId,
    version: PERCEPTUAL_VERSION,
    overallPass: failingElements.length === 0 && elementAnalyses.length > 0,
    elements: elementAnalyses,
    summary: {
      totalElements: elementAnalyses.length,
      passingElements: passingElements.length,
      failingElements: failingElements.length,
      averageIoU: elementAnalyses.length > 0
        ? elementAnalyses.reduce((sum, e) => sum + e.metrics.averageIoU, 0) / elementAnalyses.length
        : 0,
      averageSSIM: elementAnalyses.length > 0
        ? elementAnalyses.reduce((sum, e) => sum + e.metrics.averageSSIM, 0) / elementAnalyses.length
        : 0
    },
    refinementNeeded: failingElements.map(e => ({
      elementId: e.elementId,
      deltas: e.correctionDeltas,
      failedMetrics: Object.entries(e.metrics)
        .filter(([key, value]) => {
          if (key === 'averageIoU') return value < IOU_TARGET;
          if (key === 'averageCentroidOffset') return value > CENTROID_OFFSET_TARGET;
          if (key === 'averageSSIM') return value < SSIM_TARGET;
          return false;
        })
        .map(([key]) => key)
    }))
  };
}

/**
 * Generate a structured refinement report for the closed-loop gate.
 *
 * @param {Object} shotAnalysis - Result from analyzeShotPerceptual
 * @param {Object} options - Report options
 * @returns {Object} Refinement report
 */
export function generateRefinementReport(shotAnalysis, options = {}) {
  const { shotId, overallPass, summary, refinementNeeded } = shotAnalysis;

  return {
    shotId,
    version: PERCEPTUAL_VERSION,
    timestamp: new Date().toISOString(),
    status: overallPass ? 'pass' : 'needs_refinement',
    summary,
    iterations: options.iteration ?? 1,
    maxIterations: options.maxIterations ?? 5,
    refinements: refinementNeeded,
    recommendations: refinementNeeded.map(r => ({
      elementId: r.elementId,
      actions: r.failedMetrics.map(metric => {
        if (metric === 'averageIoU') return 'Adjust scale to improve bounding box overlap';
        if (metric === 'averageCentroidOffset') return 'Shift position to reduce centroid offset';
        if (metric === 'averageSSIM') return 'Review texture/color fidelity';
        return 'Unknown metric';
      }),
      deltas: r.deltas
    })),
    canIterate: !overallPass && (options.iteration ?? 1) < (options.maxIterations ?? 5)
  };
}
