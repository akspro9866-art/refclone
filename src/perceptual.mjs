/**
 * Closed-Loop Perceptual Diff Gate — Stage 5 of the 5-Stage Pipeline
 *
 * Compares rendered/synthetic preview frames against reference inflection frames
 * on 4 legacy metrics:
 * - Bounding-Box IoU (target >= 0.90)
 * - Normalized Centroid Offset (target <= 0.02)
 * - Peak Velocity Timing Delta (target <= 1 frame)
 * - Structural Similarity SSIM (target >= 0.88)
 *
 * v2 adds the 3-channel structured diagnostic vector (`computeThreeChannelDiff`),
 * computed over pixel data by the deterministic kernels in `src/pixels.mjs`:
 * - GEOMETRY:   silhouette IoU (mask-based) + edge chamfer distance (bbox IoU kept as `iou`)
 * - TEMPORAL:   optical-flow velocity diff, degrading to the peak-velocity timing delta
 * - APPEARANCE: Lab color histogram distance + global luminance SSIM
 *
 * Each failing channel maps to the parameters it drives in refinement:
 * - geometry   -> position / scale / pivot / strokeWidth / trim bounds
 *                 (position and scale are derivable from measured boxes; pivot,
 *                 strokeWidth and trim bounds need dedicated measurements and
 *                 stay untouched until that evidence exists)
 * - temporal   -> beat frames / stagger offsets / Bézier weights + angles
 * - appearance -> fills / gradients / blend modes / blur + shadow radii
 *
 * Emits structured numeric correction deltas for iterative parameter refinement.
 */

import { PNG } from 'pngjs';
import { WorkflowError, hashObject } from './core.mjs';
import {
  toLab,
  labHistogram,
  histogramDiff,
  silhouetteMask,
  maskIoU,
  maskBounds,
  chamferDistance,
  opticalFlowMagnitude,
  flowFieldDiff
} from './pixels.mjs';

export const PERCEPTUAL_VERSION = '2.0.0';

// Perceptual quality thresholds
const IOU_TARGET = 0.90;
const CENTROID_OFFSET_TARGET = 0.02;
const TIMING_DELTA_TARGET = 1; // frames
const SSIM_TARGET = 0.88;

// Per-channel pass gates for the 3-channel diff vector (all configurable via
// options.thresholds on computeThreeChannelDiff).
export const DEFAULT_CHANNEL_THRESHOLDS = Object.freeze({
  silhouetteIoU: 0.90,       // GEOMETRY: mask IoU >= 0.90
  chamfer: 2.0,              // GEOMETRY: mean edge chamfer <= 2.0 px
  flowDelta: 0.75,           // TEMPORAL: mean |velocity diff| <= 0.75 px/frame
  labHistogramDiff: 0.12,    // APPEARANCE: chi-square Lab histogram distance <= 0.12
  ssim: SSIM_TARGET          // APPEARANCE: SSIM >= 0.88
});

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

function isPixelFrame(frame) {
  return Boolean(frame)
    && Number.isFinite(frame.width) && frame.width > 0
    && Number.isFinite(frame.height) && frame.height > 0
    && frame.data
    && typeof frame.data.length === 'number';
}

function isLabPoint(value) {
  return Array.isArray(value) && value.length >= 3
    && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
}

function labMean(lab) {
  const pixelCount = Math.floor(lab.length / 3);
  if (pixelCount === 0) return null;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  for (let src = 0; src < lab.length; src += 3) {
    sumL += lab[src];
    sumA += lab[src + 1];
    sumB += lab[src + 2];
  }
  return [sumL / pixelCount, sumA / pixelCount, sumB / pixelCount];
}

/**
 * Compute the 3-channel structured perceptual diff vector between a reference
 * frame and a rendered frame. Pixel kernels come from `src/pixels.mjs`.
 *
 * Channel 1 GEOMETRY: silhouette IoU (mask-based, via `silhouetteMask` +
 * `maskIoU`) and mean edge chamfer distance (`chamferDistance`). The legacy
 * bounding-box IoU is still reported as `geometry.bboxIoU` (from the supplied
 * boxes when given, else derived from the masks) but does not gate the channel.
 * The channel fails when silhouetteIoU < thresholds.silhouetteIoU or
 * chamfer > thresholds.chamfer. Drives: position / scale / pivot /
 * strokeWidth / trim bounds.
 *
 * Channel 2 TEMPORAL PHASE: mean absolute optical-flow velocity difference
 * between (referenceFrame -> referenceNext) and (renderedFrame -> renderedNext)
 * block-matcher flows. When `referenceTrajectory`/`renderedTrajectory` are
 * supplied, the peak-velocity timing delta (same semantics as
 * `computeTimingDelta`) is reported alongside and also gates the channel.
 * When pixel data or next frames are unavailable the channel degrades to the
 * timing delta alone; when neither is measurable the channel passes vacuously.
 * Drives: beat frames / stagger offsets / Bézier weights + angles.
 *
 * Channel 3 APPEARANCE: chi-square Lab color histogram distance (`toLab` +
 * `labHistogram` + `histogramDiff`, 8x8x8 bins by default) plus the existing
 * global luminance SSIM. Drives: fills / gradients / blend modes / blur +
 * shadow radii.
 *
 * When pixel data is unavailable (frames null or not PNG-like, or dimensions
 * differ), the affected metrics are reported as `null` and do not gate their
 * channel - degradation is graceful, never fabricated.
 *
 * @param {PNG|{data: Uint8Array|Buffer, width: number, height: number}|null} referenceFrame
 * @param {PNG|{data: Uint8Array|Buffer, width: number, height: number}|null} renderedFrame
 * @param {Object} [options]
 * @param {{silhouetteIoU?: number, chamfer?: number, flowDelta?: number, labHistogramDiff?: number, ssim?: number, timingDelta?: number}} [options.thresholds]
 *   Per-channel pass gates; defaults from DEFAULT_CHANNEL_THRESHOLDS
 *   (silhouetteIoU >= 0.9, chamfer <= 2.0px, flowDelta <= 0.75px/frame,
 *   labHistogramDiff <= 0.12, ssim >= 0.88) and TIMING_DELTA_TARGET (1 frame).
 * @param {{x: number, y: number, width: number, height: number}} [options.referenceBox] - Measured reference bbox (preferred over mask-derived bbox).
 * @param {{x: number, y: number, width: number, height: number}} [options.renderedBox] - Measured rendered bbox.
 * @param {PNG|Object|null} [options.referenceNext] - Following reference frame, enables the flow channel.
 * @param {PNG|Object|null} [options.renderedNext] - Following rendered frame, enables the flow channel.
 * @param {{x: number, y: number, width: number, height: number}} [options.flowBox] - Pixel region restriction for flow computation/diff.
 * @param {number} [options.flowBlockSize=8] - Block matcher block size.
 * @param {number} [options.flowSearchRadius=8] - Block matcher search radius.
 * @param {number} [options.labBins=8] - Lab histogram bins per axis.
 * @param {number|Object} [options.backgroundLuma] - Silhouette background luma (or silhouette options object).
 * @param {number} [options.tolerance] - Silhouette background tolerance (default 16).
 * @param {{r: number, g: number, b: number}|number[]} [options.backgroundColor] - Explicit silhouette background color.
 * @param {Array<{frame: number, value: number}>} [options.referenceTrajectory] - Enables the timing delta.
 * @param {Array<{frame: number, value: number}>} [options.renderedTrajectory] - Enables the timing delta.
 * @param {number} [options.fps=24] - FPS for the timing delta.
 * @returns {{geometry: {silhouetteIoU: number|null, chamfer: number|null, bboxIoU: number|null}, temporal: {flowDelta: number|null, timingDelta: number|null}, appearance: {labHistogramDiff: number|null, ssim: number|null}, pass: boolean, failedChannels: Array<'geometry'|'temporal'|'appearance'>, channelsPass: {geometry: boolean, temporal: boolean, appearance: boolean}, labMeans: {reference: number[]|null, rendered: number[]|null}, thresholds: Object}}
 *   `labMeans` are supplementary mean [L,a,b] vectors used to sign appearance
 *   fill corrections; they are not part of the persisted diff vector.
 */
export function computeThreeChannelDiff(referenceFrame, renderedFrame, options = {}) {
  const thresholds = { ...DEFAULT_CHANNEL_THRESHOLDS, ...(options.thresholds ?? {}) };
  const timingTarget = options.thresholds?.timingDelta ?? TIMING_DELTA_TARGET;
  const pixelAvailable = isPixelFrame(referenceFrame) && isPixelFrame(renderedFrame)
    && referenceFrame.width === renderedFrame.width
    && referenceFrame.height === renderedFrame.height;

  // ---- Channel 1: GEOMETRY ----
  let silhouetteIoU = null;
  let chamfer = null;
  let bboxIoU = null;
  if (pixelAvailable) {
    const width = referenceFrame.width;
    const height = referenceFrame.height;
    const maskOptions = {
      backgroundLuma: options.backgroundLuma,
      backgroundColor: options.backgroundColor,
      tolerance: options.tolerance
    };
    const maskReference = silhouetteMask(referenceFrame.data, width, height, maskOptions);
    const maskRendered = silhouetteMask(renderedFrame.data, width, height, maskOptions);
    silhouetteIoU = maskIoU(maskReference, maskRendered);
    chamfer = chamferDistance(maskReference, maskRendered, width, height);
    const refBox = options.referenceBox ?? maskBounds(maskReference, width, height);
    const renBox = options.renderedBox ?? maskBounds(maskRendered, width, height);
    bboxIoU = refBox && renBox
      ? computeIoU(refBox, renBox)
      : (refBox || renBox ? 0 : 1); // both masks empty = identical silhouettes
  } else if (options.referenceBox && options.renderedBox) {
    bboxIoU = computeIoU(options.referenceBox, options.renderedBox);
  }
  const geometryPass = (silhouetteIoU === null || silhouetteIoU >= thresholds.silhouetteIoU)
    && (chamfer === null || chamfer <= thresholds.chamfer);

  // ---- Channel 2: TEMPORAL PHASE ----
  let flowDelta = null;
  if (pixelAvailable && isPixelFrame(options.referenceNext) && isPixelFrame(options.renderedNext)) {
    const flowOptions = {
      blockSize: options.flowBlockSize,
      searchRadius: options.flowSearchRadius,
      box: options.flowBox
    };
    const flowReference = opticalFlowMagnitude(referenceFrame, options.referenceNext, flowOptions);
    const flowRendered = opticalFlowMagnitude(renderedFrame, options.renderedNext, flowOptions);
    flowDelta = flowFieldDiff(flowReference, flowRendered, options.flowDiffBox ?? options.flowBox);
  }
  let timingDelta = null;
  if (options.referenceTrajectory !== undefined || options.renderedTrajectory !== undefined) {
    timingDelta = computeTimingDelta(options.referenceTrajectory ?? [], options.renderedTrajectory ?? [], options.fps ?? 24);
  }
  const temporalPass = (flowDelta === null || flowDelta <= thresholds.flowDelta)
    && (timingDelta === null || timingDelta <= timingTarget);

  // ---- Channel 3: APPEARANCE ----
  let labHistogramDiff = null;
  let ssim = null;
  let referenceLabMean = null;
  let renderedLabMean = null;
  if (pixelAvailable) {
    const labReference = toLab(referenceFrame.data, referenceFrame.width, referenceFrame.height);
    const labRendered = toLab(renderedFrame.data, renderedFrame.width, renderedFrame.height);
    const bins = options.labBins ?? 8;
    labHistogramDiff = histogramDiff(labHistogram(labReference, bins), labHistogram(labRendered, bins));
    ssim = computeSSIM(referenceFrame, renderedFrame);
    referenceLabMean = labMean(labReference);
    renderedLabMean = labMean(labRendered);
  }
  const appearancePass = (labHistogramDiff === null || labHistogramDiff <= thresholds.labHistogramDiff)
    && (ssim === null || ssim >= thresholds.ssim);

  const failedChannels = [];
  if (!geometryPass) failedChannels.push('geometry');
  if (!temporalPass) failedChannels.push('temporal');
  if (!appearancePass) failedChannels.push('appearance');

  return {
    geometry: { silhouetteIoU, chamfer, bboxIoU },
    temporal: { flowDelta, timingDelta },
    appearance: { labHistogramDiff, ssim },
    pass: failedChannels.length === 0,
    failedChannels,
    channelsPass: { geometry: geometryPass, temporal: temporalPass, appearance: appearancePass },
    labMeans: { reference: referenceLabMean, rendered: renderedLabMean },
    thresholds
  };
}

/**
 * Compute correction deltas for iterative refinement.
 *
 * The top-level shape is unchanged and backward compatible:
 * `{ position: {x, y}, scale: {x, y}, timing, opacity }` - driven by the legacy
 * geometry gates (centroid offset -> position, bbox IoU -> scale) and the
 * legacy timing gate (timing delta -> timing).
 *
 * v2 adds two additive, channel-routed sub-objects. Each failing channel
 * adjusts ONLY its own sub-object:
 * - `temporalDeltas` {beatFrames, staggerOffset, bezierWeight, bezierAngle}:
 *   written only for TEMPORAL failures (timing gate failed, flow delta over
 *   threshold, or 'temporal' in metrics.failedChannels). beatFrames carries
 *   the same conservative -0.5 factor as the legacy `timing` delta; the lag
 *   estimate is max(|timingDelta|, flowDelta - flowDelta threshold).
 *   bezierWeight/bezierAngle stay 0 until flow *direction* evidence is wired
 *   in - a bare magnitude does not justify rotating an easing curve.
 * - `appearanceDeltas` {fill: {L, a, b}, colorShift, blurRadius, shadowRadius}:
 *   written only for APPEARANCE failures (SSIM gate failed, Lab histogram
 *   distance over threshold, or 'appearance' in metrics.failedChannels).
 *   `fill` is the 0.5-factored Lab mean shift toward the reference (needs
 *   params.referenceLabMean / params.renderedLabMean, e.g. from
 *   computeThreeChannelDiff's labMeans); `colorShift` is a 0.5-factored scalar
 *   shortfall magnitude in [0, 0.5]; blurRadius/shadowRadius stay 0 until
 *   blur-specific evidence exists (a histogram cannot separate blur from fill).
 *
 * GEOMETRY failures keep driving the existing top-level position/scale deltas;
 * pivot/strokeWidth/trim bounds are geometry-driven parameters that no current
 * metric can sign, so they are deliberately left untouched here.
 *
 * @param {Object} metrics - Comparison metrics (legacy gates plus optional
 *   channel metrics: silhouetteIoU, chamfer, flowDelta, labHistogramDiff,
 *   failedChannels)
 * @param {Object} params - Additional parameters (referenceBox, renderedBox,
 *   frameWidth, frameHeight, referenceLabMean, renderedLabMean, thresholds)
 * @returns {Object} Structured correction deltas with additive
 *   temporalDeltas / appearanceDeltas sub-objects
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

  // ---- Channel-routed deltas (v2, additive) ----
  const thresholds = { ...DEFAULT_CHANNEL_THRESHOLDS, ...(params.thresholds ?? {}) };
  const failed = Array.isArray(metrics.failedChannels) ? metrics.failedChannels : [];
  const flowFailed = Number.isFinite(metrics.flowDelta) && metrics.flowDelta > thresholds.flowDelta;
  const labFailed = Number.isFinite(metrics.labHistogramDiff) && metrics.labHistogramDiff > thresholds.labHistogramDiff;
  const ssimFailed = Number.isFinite(metrics.ssim) && metrics.ssim < thresholds.ssim;

  const temporalFailed = failed.includes('temporal') || metrics.timingPass === false || flowFailed;
  const appearanceFailed = failed.includes('appearance') || labFailed || ssimFailed;

  const temporalDeltas = { beatFrames: 0, staggerOffset: 0, bezierWeight: 0, bezierAngle: 0 };
  if (temporalFailed) {
    let lag = 0;
    if (flowFailed) {
      lag = metrics.flowDelta - thresholds.flowDelta;
    }
    if (Number.isFinite(metrics.timingDelta) && Math.abs(metrics.timingDelta) > lag) {
      lag = Math.abs(metrics.timingDelta);
    }
    temporalDeltas.beatFrames = -lag * 0.5;
    temporalDeltas.staggerOffset = -lag * 0.25;
  }

  const appearanceDeltas = { fill: { L: 0, a: 0, b: 0 }, colorShift: 0, blurRadius: 0, shadowRadius: 0 };
  if (appearanceFailed) {
    const { referenceLabMean, renderedLabMean } = params;
    if (isLabPoint(referenceLabMean) && isLabPoint(renderedLabMean)) {
      appearanceDeltas.fill = {
        L: (referenceLabMean[0] - renderedLabMean[0]) * 0.5,
        a: (referenceLabMean[1] - renderedLabMean[1]) * 0.5,
        b: (referenceLabMean[2] - renderedLabMean[2]) * 0.5
      };
    }
    let shortfall = 0;
    if (labFailed) {
      shortfall = Math.max(shortfall, metrics.labHistogramDiff - thresholds.labHistogramDiff);
    }
    if (ssimFailed) {
      shortfall = Math.max(shortfall, thresholds.ssim - metrics.ssim);
    }
    appearanceDeltas.colorShift = 0.5 * Math.min(1, shortfall);
  }

  return { ...deltas, temporalDeltas, appearanceDeltas };
}

/**
 * Full perceptual comparison for an element across frames.
 *
 * v2: in addition to the legacy metrics, every frame pair is run through
 * `computeThreeChannelDiff` and the results are averaged into an element-level
 * `channels` summary ({geometry: {silhouetteIoU, chamfer}, temporal:
 * {flowDelta, timingDelta}, appearance: {labHistogramDiff, ssim},
 * failedChannels}) matching the optional `channels` block of
 * schemas/perceptual-diff.schema.json. Consecutive frame comparisons (ordered
 * by frame index) supply the next-frame pairs for the optical-flow channel.
 * `overallPass` now also requires no failed channel; all legacy metric names
 * and gates are unchanged.
 *
 * @param {Object} params
 * @param {string} params.elementId
 * @param {Array<{frame: number, reference: PNG, rendered: PNG, referenceBox: Object, renderedBox: Object}>} params.frameComparisons
 * @param {Array} params.referenceTrajectory
 * @param {Array} params.renderedTrajectory
 * @param {number} params.frameWidth
 * @param {number} params.frameHeight
 * @param {number} params.fps
 * @param {Object} [params.channelThresholds] - Overrides for DEFAULT_CHANNEL_THRESHOLDS.
 * @param {number|Object} [params.backgroundLuma] - Silhouette background luma (forwarded).
 * @param {number} [params.tolerance] - Silhouette background tolerance (forwarded).
 * @param {{r: number, g: number, b: number}|number[]} [params.backgroundColor] - Silhouette background color (forwarded).
 * @param {number} [params.labBins] - Lab histogram bins per axis (forwarded).
 * @param {number} [params.flowBlockSize] - Block matcher block size (forwarded).
 * @param {number} [params.flowSearchRadius] - Block matcher search radius (forwarded).
 * @param {{x: number, y: number, width: number, height: number}} [params.flowBox] - Pixel region restriction for the flow channel (forwarded).
 * @returns {Object} Complete perceptual analysis
 */
export function analyzeElementPerceptual({
  elementId,
  frameComparisons,
  referenceTrajectory,
  renderedTrajectory,
  frameWidth,
  frameHeight,
  fps,
  channelThresholds,
  backgroundLuma,
  tolerance,
  backgroundColor,
  labBins,
  flowBlockSize,
  flowSearchRadius,
  flowBox
}) {
  if (!elementId) {
    fail('PERCEPTUAL_INVALID', 'elementId is required.');
  }

  const thresholds3ch = { ...DEFAULT_CHANNEL_THRESHOLDS, ...(channelThresholds ?? {}) };
  const comparisons = frameComparisons ?? [];

  // Pair each comparison with the next one in frame order so the flow channel
  // sees (reference -> next reference) vs (rendered -> next rendered) motion.
  const order = comparisons.map((_, index) => index)
    .sort((a, b) => (comparisons[a].frame ?? 0) - (comparisons[b].frame ?? 0));
  const nextComparisonOf = new Map();
  for (let position = 0; position + 1 < order.length; position++) {
    nextComparisonOf.set(order[position], comparisons[order[position + 1]]);
  }

  const frameMetrics = [];
  let totalIoU = 0;
  let totalCentroid = 0;
  let totalSSIM = 0;
  // Channel accumulators (only measurable per-frame values contribute).
  let sumSilhouette = 0;
  let countSilhouette = 0;
  let sumChamfer = 0;
  let countChamfer = 0;
  let sumFlow = 0;
  let countFlow = 0;
  let sumLabDiff = 0;
  let countLabDiff = 0;
  let sumChannelSsim = 0;
  let countChannelSsim = 0;
  const sumReferenceLab = [0, 0, 0];
  const sumRenderedLab = [0, 0, 0];
  let countLabMeans = 0;

  for (let index = 0; index < comparisons.length; index++) {
    const comparison = comparisons[index];
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

    const next = nextComparisonOf.get(index);
    const channelDiff = computeThreeChannelDiff(comparison.reference, comparison.rendered, {
      thresholds: thresholds3ch,
      referenceBox: comparison.referenceBox,
      renderedBox: comparison.renderedBox,
      referenceNext: next?.reference,
      renderedNext: next?.rendered,
      backgroundLuma,
      tolerance,
      backgroundColor,
      labBins,
      flowBlockSize,
      flowSearchRadius,
      flowBox
    });

    if (channelDiff.geometry.silhouetteIoU !== null) {
      sumSilhouette += channelDiff.geometry.silhouetteIoU;
      countSilhouette++;
    }
    if (channelDiff.geometry.chamfer !== null) {
      sumChamfer += channelDiff.geometry.chamfer;
      countChamfer++;
    }
    if (channelDiff.temporal.flowDelta !== null) {
      sumFlow += channelDiff.temporal.flowDelta;
      countFlow++;
    }
    if (channelDiff.appearance.labHistogramDiff !== null) {
      sumLabDiff += channelDiff.appearance.labHistogramDiff;
      countLabDiff++;
    }
    if (channelDiff.appearance.ssim !== null) {
      sumChannelSsim += channelDiff.appearance.ssim;
      countChannelSsim++;
    }
    if (channelDiff.labMeans.reference && channelDiff.labMeans.rendered) {
      for (let c = 0; c < 3; c++) {
        sumReferenceLab[c] += channelDiff.labMeans.reference[c];
        sumRenderedLab[c] += channelDiff.labMeans.rendered[c];
      }
      countLabMeans++;
    }
  }

  const frameCount = frameMetrics.length;
  const avgIoU = frameCount > 0 ? totalIoU / frameCount : 0;
  const avgCentroid = frameCount > 0 ? totalCentroid / frameCount : 0;
  const avgSSIM = frameCount > 0 ? totalSSIM / frameCount : 0;

  const avgSilhouetteIoU = countSilhouette > 0 ? sumSilhouette / countSilhouette : null;
  const avgChamfer = countChamfer > 0 ? sumChamfer / countChamfer : null;
  const avgFlowDelta = countFlow > 0 ? sumFlow / countFlow : null;
  const avgLabHistogramDiff = countLabDiff > 0 ? sumLabDiff / countLabDiff : null;
  const avgChannelSsim = countChannelSsim > 0 ? sumChannelSsim / countChannelSsim : null;

  // Timing comparison
  const timingMetrics = compareTrajectories({
    referenceTrajectory,
    renderedTrajectory,
    fps
  });

  // Per-channel pass/fail at element level (matching the schema's channels block).
  const geometryFailed = (avgSilhouetteIoU !== null && avgSilhouetteIoU < thresholds3ch.silhouetteIoU)
    || (avgChamfer !== null && avgChamfer > thresholds3ch.chamfer);
  const temporalFailed = (avgFlowDelta !== null && avgFlowDelta > thresholds3ch.flowDelta)
    || !(Number.isFinite(timingMetrics.timingDelta) && timingMetrics.timingDelta <= TIMING_DELTA_TARGET);
  const appearanceFailed = (avgLabHistogramDiff !== null && avgLabHistogramDiff > thresholds3ch.labHistogramDiff)
    || (avgChannelSsim !== null && avgChannelSsim < thresholds3ch.ssim);

  const failedChannels = [];
  if (geometryFailed) failedChannels.push('geometry');
  if (temporalFailed) failedChannels.push('temporal');
  if (appearanceFailed) failedChannels.push('appearance');

  const channels = {
    geometry: { silhouetteIoU: avgSilhouetteIoU, chamfer: avgChamfer },
    temporal: { flowDelta: avgFlowDelta, timingDelta: timingMetrics.timingDelta },
    appearance: { labHistogramDiff: avgLabHistogramDiff, ssim: avgChannelSsim },
    failedChannels
  };

  // Overall pass/fail: legacy gates AND no failed channel.
  const legacyPass =
    avgIoU >= IOU_TARGET &&
    avgCentroid <= CENTROID_OFFSET_TARGET &&
    avgSSIM >= SSIM_TARGET &&
    timingMetrics.timingPass;
  const overallPass = legacyPass && failedChannels.length === 0;

  // Compute correction deltas (channel metrics route temporal/appearance deltas)
  const correctionDeltas = computeCorrectionDeltas(
    {
      iou: avgIoU,
      centroidOffset: avgCentroid,
      ssim: avgSSIM,
      iouPass: avgIoU >= IOU_TARGET,
      centroidPass: avgCentroid <= CENTROID_OFFSET_TARGET,
      ssimPass: avgSSIM >= SSIM_TARGET,
      timingDelta: timingMetrics.timingDelta,
      timingPass: timingMetrics.timingPass,
      silhouetteIoU: avgSilhouetteIoU,
      chamfer: avgChamfer,
      flowDelta: avgFlowDelta,
      labHistogramDiff: avgLabHistogramDiff,
      failedChannels
    },
    {
      frameWidth,
      frameHeight,
      referenceBox: frameMetrics[0]?.referenceBox,
      renderedBox: frameMetrics[0]?.renderedBox,
      referenceLabMean: countLabMeans > 0 ? [
        sumReferenceLab[0] / countLabMeans,
        sumReferenceLab[1] / countLabMeans,
        sumReferenceLab[2] / countLabMeans
      ] : null,
      renderedLabMean: countLabMeans > 0 ? [
        sumRenderedLab[0] / countLabMeans,
        sumRenderedLab[1] / countLabMeans,
        sumRenderedLab[2] / countLabMeans
      ] : null
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
    channelThresholds: thresholds3ch,
    channels,
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
