/**
 * Procedural Pipeline Orchestrator — Wires the 5-Stage Closed-Loop Pipeline
 *
 * This module connects:
 * - Stage 1 (media/autoanalyze) -> Stage 2 (tracking)
 * - Stage 2 (tracking) -> Stage 3 (promotion)
 * - Stage 3 (promotion) -> Stage 4 (mg-compiler)
 * - Stage 5 (perceptual) -> refinement loop
 *
 * All thresholds and presets are read from config.json, not hardcoded.
 */

import fs from 'node:fs';
import { WorkflowError, hashObject, validateArtifact } from '../core.mjs';
import { trackElement, trackShot, toPromotionInput, TRACKING_VERSION } from '../vision/tracking.mjs';
import { PNG } from 'pngjs';
import { analyzeScenePromotion, compilePromotionToScript, PROMOTION_VERSION } from '../cavalry/promotion.mjs';
import { compileShotScript, MG_COMPILER_VERSION, VERIFIED_PRESETS } from '../cavalry/mg-compiler.mjs';
import { assertMgContract, validateMgContract, MG_CONTRACT_VERSION } from '../cavalry/mg-contract.mjs';
import {
  CONVERGENCE_VERSION, createConvergenceTracker, dampCorrectionDeltas, loadConvergenceConfig, perceptualScore
} from '../vision/convergence.mjs';
import { analyzeElementPerceptual, analyzeShotPerceptual, generateRefinementReport, PERCEPTUAL_VERSION } from '../vision/perceptual.mjs';
import { matchPromotionPresetsIfAvailable } from '../cavalry/preset-index.mjs';
import { loadAtomicConvergenceConfig } from '../vision/atomic-convergence.mjs';

export const PROCEDURAL_PIPELINE_VERSION = '1.0.0';

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

/**
 * Load procedural promotion and perceptual thresholds from config.
 * Falls back to documented defaults if config sections are missing.
 */
export function loadProceduralConfig(config) {
  const promotion = config?.proceduralPromotion ?? {};
  const perceptual = config?.perceptualDiff ?? {};

  return {
    promotion: {
      bezierRmseMax: promotion.bezierRmseMax ?? 0.015,
      springRSquaredMin: promotion.springRSquaredMin ?? 0.92,
      duplicatorMinElements: promotion.duplicatorMinElements ?? 2,
      duplicatorCorrelationMin: promotion.duplicatorCorrelationMin ?? 0.85,
      duplicatorTimingToleranceFrames: promotion.duplicatorTimingToleranceFrames ?? 2,
      presets: promotion.presets ?? {
        spring: ['spring-oscillator', 'spring-bounce', 'spring-snappy'],
        bezier: ['bezier-smooth', 'bezier-snap', 'bezier-glide'],
        duplicator: ['duplicator-stagger', 'duplicator-cascade', 'duplicator-wave']
      },
      // The gate is on by default; `mgContractValidation: false` skips the dry
      // run only, and is meant for reproducing an old artifact, not for shipping.
      mgContractValidation: promotion.mgContractValidation !== false
    },
    perceptual: {
      iouMin: perceptual.iouMin ?? 0.90,
      centroidOffsetMax: perceptual.centroidOffsetMax ?? 0.02,
      timingDeltaMaxFrames: perceptual.timingDeltaMaxFrames ?? 1,
      ssimMin: perceptual.ssimMin ?? 0.88,
      maxRefinementIterations: perceptual.maxRefinementIterations ?? 5
    },
    convergence: loadConvergenceConfig(perceptual.convergence ?? {}),
    // Stage 5's deterministic gate: 0.985 global SSIM, 1 px per-layer bbox
    // drift, at most three _mg.patch correction rounds.
    atomicConvergence: loadAtomicConvergenceConfig(config ?? {})
  };
}

/**
 * Stage 2: Extract kinematic tracking from autoanalyze observations.
 *
 * When decoded frame pixels are available — via the `frames` argument, pixels
 * attached to an observation (`png`, or `data` + `width` + `height`), or
 * `decodeFrames: true` with readable observation `path` PNGs — the tracking
 * pass uses optical flow, per-element decoupled beat grids, motion
 * classification and stationary-edge mask hints. Without pixels everything
 * still works through the bbox-diff fallback.
 *
 * @param {Object} params
 * @param {string} params.shotId
 * @param {Array} params.observations - Frame observations from autoanalyze
 * @param {Object} params.metadata - Media metadata (width, height, fps)
 * @param {Object} params.config - Procedural config from loadProceduralConfig
 * @param {Array<Object>} [params.frames] - Pre-decoded RGBA frames
 *   ({frame, data, width, height} or {frame, png}); overrides observation paths.
 * @param {boolean} [params.decodeFrames=false] - Decode observation `path`
 *   PNGs synchronously (capped by config.proceduralPromotion.maxOpticalFrames).
 * @param {Object} [params.layout] - Optional static-layout descriptor applied to
 *   the tracked foreground element (metadata.layout is the fallback).
 * @returns {Object} Tracking analysis conforming to tracking.mjs output
 */
export function extractTrackingFromObservations({
  shotId, observations, metadata, config, frames, decodeFrames = false, layout = null
}) {
  if (!shotId) fail('PROCEDURAL_INVALID', 'shotId is required.');
  if (!Array.isArray(observations)) fail('PROCEDURAL_INVALID', 'observations array is required.');

  const frameWidth = metadata?.video?.width ?? metadata?.width ?? 1920;
  const frameHeight = metadata?.video?.height ?? metadata?.height ?? 1080;
  const fps = metadata?.video?.fps ?? metadata?.fps ?? { num: 24, den: 1 };

  // Collect decoded pixels keyed by frame number (first source wins):
  // explicit `frames`, then pixels attached to observations, then optional
  // synchronous decoding of observation PNG paths.
  const byFrame = new Map();
  let frameDecodeFailures = 0;
  const attach = (frameNumber, pixels) => {
    if (!Number.isFinite(frameNumber) || !pixels?.data || !pixels?.width || !pixels?.height) return;
    if (!byFrame.has(frameNumber)) byFrame.set(frameNumber, { frame: frameNumber, data: pixels.data, width: pixels.width, height: pixels.height });
  };
  for (const frame of Array.isArray(frames) ? frames : []) {
    const pixels = frame?.png ?? frame;
    attach(frame?.frame, pixels);
  }
  for (const obs of observations) {
    const pixels = obs?.png ?? (obs?.data && obs?.width && obs?.height ? obs : null);
    attach(obs?.frame, pixels);
  }
  if (decodeFrames) {
    const cap = Math.max(0, config?.proceduralPromotion?.maxOpticalFrames ?? 32);
    const pending = observations.filter(obs => Number.isFinite(obs?.frame) && obs?.path && !byFrame.has(obs.frame));
    for (const obs of pending.slice(0, cap)) {
      try {
        attach(obs.frame, PNG.sync.read(fs.readFileSync(obs.path)));
      } catch {
        frameDecodeFailures += 1; // an unreadable frame keeps the bbox fallback
      }
    }
  }
  const decodedFrames = [...byFrame.values()].sort((a, b) => a.frame - b.frame);

  // Convert observations to element states format expected by tracking.mjs
  // Observations from autoanalyze have: { frame, timeSeconds, path, sha256, measurement }
  // We need to extract element states from measurements

  const elements = [];

  // Group observations by element/region if available
  // For now, create a single "foreground" element from the observations
  if (observations.length > 0) {
    const states = observations.map(obs => ({
      frame: obs.frame,
      bbox: obs.measurement?.foreground?.bbox ?? { x: 0, y: 0, width: 1, height: 1 },
      opacity: 1
    }));

    elements.push({
      id: `${shotId}-foreground`,
      states,
      ...(layout ?? metadata?.layout ? { layout: layout ?? metadata.layout } : {})
    });
  }

  const trackingAnalysis = trackShot({
    shotId,
    elements,
    frameWidth,
    frameHeight,
    fps: typeof fps === 'number' ? fps : fps.num / fps.den,
    frames: decodedFrames.length > 0 ? decodedFrames : undefined
  });

  return {
    ...trackingAnalysis,
    version: TRACKING_VERSION,
    sourceObservations: observations.length,
    sourceFrames: decodedFrames.length,
    ...(decodeFrames ? { frameDecodeFailures } : {})
  };
}

/**
 * Stage 3: Run procedural promotion on tracking analysis.
 *
 * @param {Object} params
 * @param {Object} params.trackingAnalysis - Output from extractTrackingFromObservations
 * @param {Object} params.config - Procedural config
 * @returns {Object} Promotion analysis conforming to procedural-promotion.schema.json
 */
export function runProceduralPromotion({ trackingAnalysis, config }) {
  if (!trackingAnalysis) fail('PROCEDURAL_INVALID', 'trackingAnalysis is required.');

  const promotionConfig = config?.promotion ?? {};
  const fps = trackingAnalysis.fps ?? { num: 24, den: 1 };

  // Convert tracking analysis to promotion solver input format
  const promotionInput = toPromotionInput(trackingAnalysis);

  const promotionAnalysis = analyzeScenePromotion({
    elements: promotionInput,
    fps
  });

  // Ensure schema conformance - fps must be {num, den} object
  const normalizedFps = typeof fps === 'number'
    ? { num: Math.round(fps * 1000), den: 1000 }
    : { num: fps.num ?? 24, den: fps.den ?? 1 };

  // Normalize element fps fields
  const normalizedElements = (promotionAnalysis.elements ?? []).map(element => ({
    ...element,
    fps: normalizedFps
  }));

  // Create schema-conformant artifact
  const artifact = {
    schemaVersion: 1,
    version: promotionAnalysis.version ?? PROMOTION_VERSION,
    fps: normalizedFps,
    elements: normalizedElements,
    duplicatorGroups: promotionAnalysis.duplicatorGroups ?? [],
    duplicatorDetection: promotionAnalysis.duplicatorDetection ?? { detected: false, groups: [] },
    summary: promotionAnalysis.summary ?? {
      totalElements: 0,
      springPromotions: 0,
      bezierPromotions: 0,
      keyframeFallbacks: 0,
      duplicatorGroups: 0
    },
    thresholds: promotionAnalysis.thresholds ?? {
      bezierRMSE: promotionConfig.bezierRmseMax ?? 0.015,
      springR2: promotionConfig.springRSquaredMin ?? 0.92,
      duplicatorMinElements: promotionConfig.duplicatorMinElements ?? 2,
      duplicatorCorrelation: promotionConfig.duplicatorCorrelationMin ?? 0.85
    }
  };

  return artifact;
}

/**
 * Stage 4: Compile promotion analysis to _mg DSL script.
 *
 * Stage 3.5 rides the returned value: the compiled script is checked against
 * the verified `_mg` contract before anything may dispatch it, and an error
 * severity violation stops here rather than half-building a scene later.
 *
 * @param {Object} params
 * @param {Object} params.promotionAnalysis - Output from runProceduralPromotion
 * @param {Object} params.trackingAnalysis - Tracking analysis for context
 * @param {string} params.shotId
 * @param {Object} params.capabilities - Adapter capabilities
 * @param {Object} params.config - Procedural config
 * @param {Object|null} [params.presetMatches] - Advisory Stage 3 catalog report;
 *   defaults to `promotionAnalysis.presetMatches` when already attached.
 * @returns {Object} Compiled script with metadata and the `contract` report
 */
export function compileProceduralScript({
  promotionAnalysis, trackingAnalysis, shotId, capabilities, config, presetMatches = null
}) {
  if (!promotionAnalysis) fail('PROCEDURAL_INVALID', 'promotionAnalysis is required.');
  if (!shotId) fail('PROCEDURAL_INVALID', 'shotId is required.');

  const compilation = compileShotScript({
    trackingAnalysis,
    promotionAnalysis,
    shotId,
    capabilities,
    options: {
      groupName: `procedural-${shotId}`,
      autoBindPresets: true,
      presetMatches: presetMatches ?? promotionAnalysis.presetMatches ?? null
    }
  });

  const contract = validateMgContract({
    script: compilation.compiled?.script ?? '',
    compiled: compilation.compiled,
    promotion: promotionAnalysis,
    presets: config?.promotion?.presets ?? null
  });
  if (config?.promotion?.mgContractValidation !== false) {
    assertMgContract(contract, { shotId, scriptHash: compilation.compiled?.scriptHash ?? null });
  }

  return {
    ...compilation,
    version: MG_COMPILER_VERSION,
    promotionVersion: PROMOTION_VERSION,
    contract
  };
}

/**
 * Stage 5: Run perceptual diff gate on rendered frames.
 *
 * @param {Object} params
 * @param {string} params.shotId
 * @param {Array} params.frameComparisons - Reference vs rendered frame comparisons
 * @param {Array} params.referenceTrajectory
 * @param {Array} params.renderedTrajectory
 * @param {Object} params.metadata - Frame dimensions and fps
 * @param {Object} params.config - Procedural config
 * @returns {Object} Perceptual analysis conforming to perceptual-diff.schema.json
 */
export function runPerceptualDiffGate({ shotId, frameComparisons, referenceTrajectory, renderedTrajectory, metadata, config }) {
  if (!shotId) fail('PROCEDURAL_INVALID', 'shotId is required.');

  const perceptualConfig = config?.perceptual ?? {};
  const frameWidth = metadata?.video?.width ?? metadata?.width ?? 1920;
  const frameHeight = metadata?.video?.height ?? metadata?.height ?? 1080;
  const fps = metadata?.video?.fps ?? metadata?.fps ?? { num: 24, den: 1 };

  // Analyze each element's perceptual quality
  const elementAnalyses = [];

  // For now, analyze the foreground element
  if (frameComparisons && frameComparisons.length > 0) {
    const elementAnalysis = analyzeElementPerceptual({
      elementId: `${shotId}-foreground`,
      frameComparisons,
      referenceTrajectory: referenceTrajectory ?? [],
      renderedTrajectory: renderedTrajectory ?? [],
      frameWidth,
      frameHeight,
      fps: typeof fps === 'number' ? fps : fps.num / fps.den
    });
    elementAnalyses.push(elementAnalysis);
  }

  const shotAnalysis = analyzeShotPerceptual({
    shotId,
    elements: elementAnalyses
  });

  // Generate refinement report
  const refinementReport = generateRefinementReport(shotAnalysis, {
    iteration: 1,
    maxIterations: perceptualConfig.maxRefinementIterations ?? 5
  });

  // Configured thresholds (schema: iou, centroidOffset, ssim, timingDelta)
  const configuredThresholds = {
    iou: perceptualConfig.iouMin ?? 0.90,
    centroidOffset: perceptualConfig.centroidOffsetMax ?? 0.02,
    ssim: perceptualConfig.ssimMin ?? 0.88,
    timingDelta: perceptualConfig.timingDeltaMaxFrames ?? 1
  };

  // Strip schema-violating fields (thresholds, boxes) from frameMetrics entries.
  // Schema: additionalProperties=false, allows only frame/iou/centroidOffset/ssim/iouPass/centroidPass/ssimPass.
  // Guard against non-finite numbers (e.g. Infinity when rendered trajectory is empty).
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const normalizedElements = elementAnalyses.map(element => {
    const cleanFrameMetrics = (element.frameMetrics ?? []).map(frame => ({
      frame: frame.frame,
      iou: finite(frame.iou),
      centroidOffset: finite(frame.centroidOffset),
      ssim: finite(frame.ssim),
      iouPass: frame.iouPass,
      centroidPass: frame.centroidPass,
      ssimPass: frame.ssimPass
    }));
    // Compute a safe timingDelta: Infinity means "no rendered trajectory", record as configured ceiling.
    const rawTiming = element.metrics.timingDelta;
    const safeTiming = Number.isFinite(rawTiming) ? rawTiming : configuredThresholds.timingDelta + 1;
    return {
      elementId: element.elementId,
      version: element.version ?? PERCEPTUAL_VERSION,
      overallPass: element.overallPass,
      metrics: {
        averageIoU: finite(element.metrics.averageIoU),
        averageCentroidOffset: finite(element.metrics.averageCentroidOffset),
        averageSSIM: finite(element.metrics.averageSSIM),
        timingDelta: safeTiming,
        frameCount: element.metrics.frameCount
      },
      thresholds: configuredThresholds,
      frameMetrics: cleanFrameMetrics,
      correctionDeltas: {
        position: { x: finite(element.correctionDeltas.position.x), y: finite(element.correctionDeltas.position.y) },
        scale: { x: finite(element.correctionDeltas.scale.x, 1), y: finite(element.correctionDeltas.scale.y, 1) },
        timing: finite(element.correctionDeltas.timing),
        opacity: finite(element.correctionDeltas.opacity)
      },
      needsRefinement: element.needsRefinement
    };
  });

  // Compute shot-level metrics from element metrics (schema shotMetrics).
  const shotCount = normalizedElements.length;
  const averageIoU = finite(shotCount > 0
    ? normalizedElements.reduce((sum, e) => sum + e.metrics.averageIoU, 0) / shotCount
    : 0);
  const averageCentroidOffset = finite(shotCount > 0
    ? normalizedElements.reduce((sum, e) => sum + e.metrics.averageCentroidOffset, 0) / shotCount
    : 0);
  const averageSSIM = finite(shotCount > 0
    ? normalizedElements.reduce((sum, e) => sum + e.metrics.averageSSIM, 0) / shotCount
    : 0);
  const timingDelta = finite(shotCount > 0
    ? normalizedElements.reduce((sum, e) => sum + e.metrics.timingDelta, 0) / shotCount
    : 0);

  // Recompute overallPass using configured thresholds (not perceptual.mjs constants).
  const overallPass = shotCount > 0 && normalizedElements.every(e =>
    e.metrics.averageIoU >= configuredThresholds.iou &&
    e.metrics.averageCentroidOffset <= configuredThresholds.centroidOffset &&
    e.metrics.averageSSIM >= configuredThresholds.ssim &&
    e.metrics.timingDelta <= configuredThresholds.timingDelta
  );

  // Schema-conformant refinementNeeded entries: include timingDelta when over threshold.
  const refinementNeeded = normalizedElements
    .filter(e => !overallPass || !e.overallPass)
    .map(e => {
      const failedMetrics = [];
      if (e.metrics.averageIoU < configuredThresholds.iou) failedMetrics.push('averageIoU');
      if (e.metrics.averageCentroidOffset > configuredThresholds.centroidOffset) failedMetrics.push('averageCentroidOffset');
      if (e.metrics.averageSSIM < configuredThresholds.ssim) failedMetrics.push('averageSSIM');
      if (e.metrics.timingDelta > configuredThresholds.timingDelta) failedMetrics.push('timingDelta');
      return { elementId: e.elementId, deltas: e.correctionDeltas, failedMetrics };
    });

  // Create schema-conformant artifact
  const artifact = {
    schemaVersion: 1,
    version: PERCEPTUAL_VERSION,
    shotId,
    overallPass,
    elements: normalizedElements,
    metrics: { averageIoU, averageCentroidOffset, averageSSIM, timingDelta },
    thresholds: configuredThresholds,
    summary: {
      totalElements: shotCount,
      passingElements: normalizedElements.filter(e => e.overallPass).length,
      failingElements: normalizedElements.filter(e => !e.overallPass).length,
      averageIoU,
      averageSSIM
    },
    refinementNeeded
  };

  return { artifact, refinementReport, shotAnalysis };
}

/**
 * Full 5-stage procedural pipeline execution.
 *
 * @param {Object} params
 * @param {string} params.shotId
 * @param {Array} params.observations - From autoanalyze
 * @param {Object} params.metadata - Media metadata
 * @param {Object} params.capabilities - Adapter capabilities
 * @param {Object} params.config - Full config object
 * @param {Array} [params.frameComparisons] - For perceptual gate
 * @returns {Object} Complete pipeline result with all stage outputs
 */
export async function runProceduralPipeline({ shotId, observations, metadata, capabilities, config, frameComparisons }) {
  if (!shotId) fail('PROCEDURAL_INVALID', 'shotId is required.');
  if (!observations) fail('PROCEDURAL_INVALID', 'observations are required.');

  const proceduralConfig = loadProceduralConfig(config);

  // Stage 2: Tracking
  const trackingAnalysis = extractTrackingFromObservations({
    shotId,
    observations,
    metadata,
    config: proceduralConfig
  });

  // Stage 3: Promotion
  const promotionAnalysis = runProceduralPromotion({
    trackingAnalysis,
    config: proceduralConfig
  });

  // Advisory 120-preset catalog match. It is an optional schema field so it is
  // first-class in the artifact, and null when no shipped manifest is
  // discoverable; the deterministic promotion data itself is unchanged.
  const presetMatches = matchPromotionPresetsIfAvailable(promotionAnalysis);
  if (presetMatches) promotionAnalysis.presetMatches = JSON.parse(JSON.stringify(presetMatches));

  // Validate promotion artifact
  await validateArtifact('procedural-promotion', promotionAnalysis);

  // Stage 4: Compilation
  const compilation = compileProceduralScript({
    promotionAnalysis,
    trackingAnalysis,
    shotId,
    capabilities,
    config: proceduralConfig,
    presetMatches
  });

  // Stage 5: Perceptual (if frame comparisons provided)
  let perceptualResult = null;
  if (frameComparisons && frameComparisons.length > 0) {
    perceptualResult = runPerceptualDiffGate({
      shotId,
      frameComparisons,
      referenceTrajectory: trackingAnalysis.elements?.[0]?.trajectories?.x ?? [],
      renderedTrajectory: [], // Would come from actual render
      metadata,
      config: proceduralConfig
    });

    // Validate perceptual artifact
    await validateArtifact('perceptual-diff', perceptualResult.artifact);
  }

  return {
    version: PROCEDURAL_PIPELINE_VERSION,
    shotId,
    stages: {
      tracking: {
        version: TRACKING_VERSION,
        analysis: trackingAnalysis,
        elementCount: trackingAnalysis.elements?.length ?? 0,
        motionBeats: trackingAnalysis.summary?.totalBeats ?? 0
      },
      promotion: {
        version: PROMOTION_VERSION,
        analysis: promotionAnalysis,
        summary: promotionAnalysis.summary,
        presetMatches
      },
      compilation: {
        version: MG_COMPILER_VERSION,
        script: compilation.compiled?.script ?? null,
        scriptHash: compilation.compiled?.scriptHash ?? null,
        ready: compilation.ready ?? false,
        presetBindings: compilation.compiled?.presetBindings ?? [],
        contractVersion: compilation.contract?.version ?? MG_CONTRACT_VERSION,
        contractOk: compilation.contract?.ok ?? null,
        contract: compilation.contract ?? null
      },
      perceptual: perceptualResult ? {
        version: PERCEPTUAL_VERSION,
        artifact: perceptualResult.artifact,
        refinementReport: perceptualResult.refinementReport,
        overallPass: perceptualResult.artifact.overallPass
      } : null
    },
    config: proceduralConfig,
    summary: {
      totalElements: trackingAnalysis.elements?.length ?? 0,
      springPromotions: promotionAnalysis.summary?.springPromotions ?? 0,
      bezierPromotions: promotionAnalysis.summary?.bezierPromotions ?? 0,
      duplicatorGroups: promotionAnalysis.summary?.duplicatorGroups ?? 0,
      scriptReady: compilation.ready ?? false,
      contractOk: compilation.contract?.ok ?? null,
      contractErrors: compilation.contract?.counts?.error ?? 0,
      perceptualPass: perceptualResult?.artifact?.overallPass ?? null,
      presetMatched: presetMatches?.summary?.matched ?? null
    }
  };
}

/**
 * Apply Stage 5 correction deltas back onto a Stage 3 promotion artifact.
 *
 * Mapping:
 * - position.x / position.y  -> additive shift on 'x' / 'y' property promotions
 * - scale.x / scale.y        -> multiplicative factor on 'scale_x' / 'scale_y' promotions
 *                               (1.0 means "no change")
 * - timing                   -> integer frame shift on startFrame / endFrame / keyframes
 *                               and on duplicator lagFrames
 * - opacity                  -> additive shift on 'opacity' property promotions
 *
 * The returned artifact is re-validated against procedural-promotion.schema.json.
 * Schema constraints are enforced defensively: frames are clamped to integers >= 0,
 * y1/y2 and zeta are clamped to [0, 1], omega0 stays > 0.
 *
 * @param {Object} promotionArtifact - Validated procedural-promotion artifact
 * @param {Object} correctionDeltas - { position:{x,y}, scale:{x,y}, timing, opacity }
 * @returns {Object} New schema-conformant promotion artifact with deltas applied
 */
export async function applyCorrectionDeltas(promotionArtifact, correctionDeltas) {
  if (!promotionArtifact) fail('PROCEDURAL_INVALID', 'promotionArtifact is required.');
  if (!correctionDeltas) fail('PROCEDURAL_INVALID', 'correctionDeltas is required.');

  const dx = Number(correctionDeltas.position?.x ?? 0);
  const dy = Number(correctionDeltas.position?.y ?? 0);
  const sx = Number(correctionDeltas.scale?.x ?? 1);
  const sy = Number(correctionDeltas.scale?.y ?? 1);
  const dt = Math.round(Number(correctionDeltas.timing ?? 0));
  const dOpacity = Number(correctionDeltas.opacity ?? 0);

  const clamp01 = v => Math.min(1, Math.max(0, v));
  const clampFrame = v => Math.max(0, Math.round(v));
  const safeScale = v => Number.isFinite(v) && v > 0 ? v : 1;

  const shiftParam = (params, additive, multiplicative) => {
    if (!params) return params;
    const next = { ...params };
    if (typeof next.startValue === 'number') next.startValue = next.startValue * multiplicative + additive;
    if (typeof next.endValue === 'number') next.endValue = next.endValue * multiplicative + additive;
    if (typeof next.targetValue === 'number') next.targetValue = next.targetValue * multiplicative + additive;
    if (typeof next.initialValue === 'number') next.initialValue = next.initialValue * multiplicative + additive;
    if (typeof next.startFrame === 'number') next.startFrame = clampFrame(next.startFrame + dt);
    if (typeof next.endFrame === 'number') next.endFrame = clampFrame(next.endFrame + dt);
    if (typeof next.y1 === 'number') next.y1 = clamp01(next.y1);
    if (typeof next.y2 === 'number') next.y2 = clamp01(next.y2);
    if (typeof next.zeta === 'number') next.zeta = clamp01(next.zeta);
    if (typeof next.omega0 === 'number') next.omega0 = Math.max(1e-6, next.omega0);
    return next;
  };

  const applyToPromotion = (promotion) => {
    const property = promotion.property;
    let additive = 0;
    let multiplicative = 1;

    if (property === 'x') additive = dx;
    else if (property === 'y') additive = dy;
    else if (property === 'scale_x') multiplicative = safeScale(sx);
    else if (property === 'scale_y') multiplicative = safeScale(sy);
    else if (property === 'opacity') additive = dOpacity;

    const next = { ...promotion };
    if (typeof next.value === 'number' && (additive !== 0 || multiplicative !== 1)) {
      next.value = next.value * multiplicative + additive;
    }
    if (next.parameters) next.parameters = shiftParam(next.parameters, additive, multiplicative);
    if (Array.isArray(next.keyframes)) {
      next.keyframes = next.keyframes.map(kf => ({
        frame: clampFrame(kf.frame + dt),
        value: kf.value * multiplicative + additive
      }));
    }
    return next;
  };

  const adjustedElements = (promotionArtifact.elements ?? []).map(element => ({
    ...element,
    promotions: (element.promotions ?? []).map(applyToPromotion)
  }));

  const adjustedDuplicatorGroups = (promotionArtifact.duplicatorGroups ?? []).map(group => ({
    ...group,
    lagFrames: group.lagFrames + dt,
    spatialOffset: {
      x: (group.spatialOffset?.x ?? 0) + dx,
      y: (group.spatialOffset?.y ?? 0) + dy
    }
  }));

  const adjustedDetection = promotionArtifact.duplicatorDetection
    ? {
        ...promotionArtifact.duplicatorDetection,
        groups: (promotionArtifact.duplicatorDetection.groups ?? []).map(group => ({
          ...group,
          lagFrames: group.lagFrames + dt,
          spatialOffset: {
            x: (group.spatialOffset?.x ?? 0) + dx,
            y: (group.spatialOffset?.y ?? 0) + dy
          }
        }))
      }
    : undefined;

  const adjusted = {
    ...promotionArtifact,
    elements: adjustedElements,
    duplicatorGroups: adjustedDuplicatorGroups
  };
  if (adjustedDetection) adjusted.duplicatorDetection = adjustedDetection;

  // Re-validate: a refinement that breaks the contract must surface, not silently pass.
  await validateArtifact('procedural-promotion', adjusted);
  return adjusted;
}

/**
 * Closed-loop procedural pipeline: runs the 5-stage flow and, when the perceptual
 * gate fails, applies correction deltas and re-compiles the _mg script for up to
 * `maxIterations` rounds.
 *
 * Each refinement round is damped, watched for a plateau, and snapshotted:
 * - the aggregate correction is scaled per tier (geometry > timing > appearance,
 *   see `src/vision/convergence.mjs`) and the scale is decayed while the score regresses;
 * - a round whose fresh measurement moves the score by less than
 *   `convergence.minImprovementRatio` counts toward a plateau, and `plateauPasses`
 *   of those in a row end the loop early. Rounds that reuse the previous
 *   comparison set are not counted, because an unchanged measurement is not
 *   evidence that the parameters have stopped improving;
 * - the best-scoring round's promotion artifact is kept, and if the final round
 *   scores worse than that snapshot, the returned `stages.promotion` and
 *   `stages.compilation` are the snapshot's (recompiled from its parameters, so
 *   the script and the artifact still describe each other). That is an in-memory
 *   parameter restore: it does not undo anything inside Cavalry, and the adapter
 *   keeps reporting `rollback` as unsupported.
 *
 * Every round also re-passes the Stage 3.5 `_mg` contract gate, so a refinement
 * that would emit an uncompilable or non-conforming script fails here instead of
 * at dispatch.
 *
 * @param {Object} params
 * @param {string} params.shotId
 * @param {Array} params.observations
 * @param {Object} params.metadata
 * @param {Object} params.capabilities
 * @param {Object} params.config
 * @param {Array} params.frameComparisons - Reference vs rendered frame comparisons
 * @param {Function} [params.renderEvaluator] - Optional async (promotionArtifact, iteration) =>
 *        { frameComparisons, renderedTrajectory } used to re-measure after each refinement.
 *        When omitted the loop reuses the initial frameComparisons.
 * @param {number} [params.maxIterations=2] - Maximum refinement rounds after the first pass
 * @returns {Object} Pipeline result with `iterations` history, a `convergence`
 *   report (scores, damping, plateau, best snapshot) and the final `converged` flag
 */
export async function runClosedLoopProceduralPipeline({
  shotId, observations, metadata, capabilities, config,
  frameComparisons, renderEvaluator, maxIterations = 2
}) {
  if (!shotId) fail('PROCEDURAL_INVALID', 'shotId is required.');
  if (!observations) fail('PROCEDURAL_INVALID', 'observations are required.');

  const proceduralConfig = loadProceduralConfig(config);
  const configuredMax = Number(proceduralConfig.perceptual?.maxRefinementIterations ?? 5);
  const effectiveMax = Math.max(0, Math.min(Number(maxIterations ?? 0), configuredMax));
  const convergenceConfig = proceduralConfig.convergence ?? loadConvergenceConfig({});
  const tracker = createConvergenceTracker(convergenceConfig);

  // Iteration 0: baseline pass
  let currentPromotion = null;
  let currentTracking = null;
  let currentPerceptual = null;
  let currentComparisons = frameComparisons ?? [];
  let currentRenderedTrajectory = [];
  const iterations = [];
  let stopReason = null;

  /** Keep the diagnosable part of a contract report; the dry-run detail is noise per round. */
  const contractDigest = report => (report ? {
    version: report.version,
    ok: report.ok,
    evaluated: report.evaluated,
    scriptHash: report.scriptHash,
    counts: report.counts,
    violations: report.violations
  } : null);

  // Stage 2: Tracking (once)
  currentTracking = extractTrackingFromObservations({ shotId, observations, metadata, config: proceduralConfig });
  const referenceTrajectory = currentTracking.elements?.[0]?.trajectories?.x ?? [];

  // Stage 3: Promotion (baseline)
  currentPromotion = runProceduralPromotion({ trackingAnalysis: currentTracking, config: proceduralConfig });
  const presetMatches = matchPromotionPresetsIfAvailable(currentPromotion);
  if (presetMatches) currentPromotion.presetMatches = JSON.parse(JSON.stringify(presetMatches));
  await validateArtifact('procedural-promotion', currentPromotion);

  // Stage 4: Compilation (baseline)
  let currentCompilation = compileProceduralScript({
    promotionAnalysis: currentPromotion,
    trackingAnalysis: currentTracking,
    shotId, capabilities, config: proceduralConfig,
    presetMatches
  });

  // Stage 5: Perceptual gate (baseline)
  if (currentComparisons.length > 0) {
    currentPerceptual = runPerceptualDiffGate({
      shotId,
      frameComparisons: currentComparisons,
      referenceTrajectory,
      renderedTrajectory: currentRenderedTrajectory,
      metadata,
      config: proceduralConfig
    });
    await validateArtifact('perceptual-diff', currentPerceptual.artifact);
  }

  const baselineScore = perceptualScore(currentPerceptual?.artifact ?? null, convergenceConfig);
  tracker.observe({
    iteration: 0,
    score: baselineScore,
    measured: baselineScore.measured,
    promotion: currentPromotion,
    compilation: currentCompilation,
    deltas: null,
    tiers: null
  });

  iterations.push({
    iteration: 0,
    promotion: currentPromotion,
    compilation: {
      script: currentCompilation.compiled?.script ?? null,
      scriptHash: currentCompilation.compiled?.scriptHash ?? null,
      ready: currentCompilation.ready ?? false,
      presetBindings: currentCompilation.compiled?.presetBindings ?? [],
      contract: contractDigest(currentCompilation.contract)
    },
    perceptual: currentPerceptual ? {
      overallPass: currentPerceptual.artifact.overallPass,
      metrics: currentPerceptual.artifact.metrics,
      refinementNeeded: currentPerceptual.artifact.refinementNeeded ?? []
    } : null,
    score: baselineScore.measured ? baselineScore.score : null,
    improvementRatio: null,
    appliedDeltas: null
  });

  // Refinement loop
  let iteration = 0;
  while (
    iteration < effectiveMax &&
    currentPerceptual &&
    currentPerceptual.artifact.overallPass === false &&
    !tracker.plateau.detected
  ) {
    iteration += 1;

    // Aggregate correction deltas across failing elements
    const failing = (currentPerceptual.artifact.refinementNeeded ?? []);
    if (failing.length === 0) {
      stopReason = 'no_refinement_items';
      break;
    }

    const rawAggregate = failing.reduce((acc, item) => ({
      position: { x: acc.position.x + (item.deltas?.position?.x ?? 0), y: acc.position.y + (item.deltas?.position?.y ?? 0) },
      scale: { x: acc.scale.x * (item.deltas?.scale?.x ?? 1), y: acc.scale.y * (item.deltas?.scale?.y ?? 1) },
      timing: acc.timing + (item.deltas?.timing ?? 0),
      opacity: acc.opacity + (item.deltas?.opacity ?? 0)
    }), { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, timing: 0, opacity: 0 });

    // Tier damping before anything is applied: the correction a metric implies
    // is a linear-response guess, so each tier keeps a fraction of it and the
    // fraction shrinks while the score has been going backwards.
    const damping = dampCorrectionDeltas(rawAggregate, convergenceConfig, {
      consecutiveRegressions: tracker.consecutiveRegressions
    });
    const aggregate = damping.damped;

    // Apply deltas to promotion artifact (re-validates)
    currentPromotion = await applyCorrectionDeltas(currentPromotion, aggregate);

    // Optional re-render hook: lets callers supply fresh frame comparisons after a real render
    let measuredFresh = false;
    if (typeof renderEvaluator === 'function') {
      const evaluation = await renderEvaluator(currentPromotion, iteration);
      if (evaluation?.frameComparisons) {
        currentComparisons = evaluation.frameComparisons;
        measuredFresh = true;
      }
      if (evaluation?.renderedTrajectory) currentRenderedTrajectory = evaluation.renderedTrajectory;
    }

    // Stage 4: re-compile with refined promotion (and re-pass the contract gate)
    currentCompilation = compileProceduralScript({
      promotionAnalysis: currentPromotion,
      trackingAnalysis: currentTracking,
      shotId, capabilities, config: proceduralConfig
    });

    // Stage 5: re-run perceptual gate
    if (currentComparisons.length > 0) {
      currentPerceptual = runPerceptualDiffGate({
        shotId,
        frameComparisons: currentComparisons,
        referenceTrajectory,
        renderedTrajectory: currentRenderedTrajectory,
        metadata,
        config: proceduralConfig
      });
      await validateArtifact('perceptual-diff', currentPerceptual.artifact);
    }

    const score = perceptualScore(currentPerceptual?.artifact ?? null, convergenceConfig);
    const observed = tracker.observe({
      iteration,
      score,
      // A reused comparison set measures nothing new, so it cannot show a stall.
      measured: score.measured && measuredFresh,
      promotion: currentPromotion,
      compilation: currentCompilation,
      deltas: { raw: rawAggregate, damped: aggregate },
      tiers: damping.tiers
    });

    iterations.push({
      iteration,
      promotion: currentPromotion,
      compilation: {
        script: currentCompilation.compiled?.script ?? null,
        scriptHash: currentCompilation.compiled?.scriptHash ?? null,
        ready: currentCompilation.ready ?? false,
        presetBindings: currentCompilation.compiled?.presetBindings ?? [],
        contract: contractDigest(currentCompilation.contract)
      },
      perceptual: currentPerceptual ? {
        overallPass: currentPerceptual.artifact.overallPass,
        metrics: currentPerceptual.artifact.metrics,
        refinementNeeded: currentPerceptual.artifact.refinementNeeded ?? []
      } : null,
      score: score.measured ? score.score : null,
      improvementRatio: observed.improvementRatio,
      regression: observed.regression,
      measured: score.measured && measuredFresh,
      damping: { factor: damping.factor, tiers: damping.tiers },
      appliedDeltas: aggregate,
      rawDeltas: rawAggregate
    });
  }

  const gatePassed = currentPerceptual?.artifact?.overallPass === true;
  if (gatePassed) {
    stopReason = 'converged';
  } else if (!stopReason) {
    if (tracker.plateau.detected) stopReason = 'plateau';
    else if (!currentPerceptual) stopReason = 'not_measured';
    else if (iteration >= effectiveMax) stopReason = 'max_iterations';
    else stopReason = 'not_measured';
  }

  const converged = currentPerceptual ? currentPerceptual.artifact.overallPass === true : true;

  // Deliver the closest parameters the loop saw, not simply the last ones.
  const finalScore = tracker.history.length > 0 ? tracker.history[tracker.history.length - 1].score : null;
  const rollback = tracker.rollback(finalScore);
  let delivered = {
    promotion: currentPromotion,
    compilation: currentCompilation,
    score: finalScore,
    iteration
  };
  if (rollback.rolledBackTo !== null && rollback.snapshot?.promotion) {
    delivered = {
      promotion: rollback.snapshot.promotion,
      compilation: compileProceduralScript({
        promotionAnalysis: rollback.snapshot.promotion,
        trackingAnalysis: currentTracking,
        shotId,
        capabilities,
        config: proceduralConfig
      }),
      score: rollback.snapshot.score,
      iteration: rollback.snapshot.iteration
    };
  }

  return {
    version: PROCEDURAL_PIPELINE_VERSION,
    shotId,
    converged,
    iterationsRun: iteration,
    maxIterations: effectiveMax,
    iterations,
    convergence: {
      ...tracker.summary(),
      stopReason,
      score: finalScore,
      baselineScore: tracker.history[0]?.score ?? null,
      deliveredScore: delivered.score,
      deliveredIteration: delivered.iteration,
      rolledBackTo: rollback.rolledBackTo,
      rollbackReason: rollback.reason
    },
    stages: {
      tracking: {
        version: TRACKING_VERSION,
        analysis: currentTracking,
        elementCount: currentTracking.elements?.length ?? 0,
        motionBeats: currentTracking.summary?.totalBeats ?? 0
      },
      promotion: {
        version: PROMOTION_VERSION,
        analysis: delivered.promotion,
        summary: delivered.promotion.summary,
        deliveredIteration: delivered.iteration,
        presetMatches
      },
      compilation: {
        version: MG_COMPILER_VERSION,
        script: delivered.compilation.compiled?.script ?? null,
        scriptHash: delivered.compilation.compiled?.scriptHash ?? null,
        ready: delivered.compilation.ready ?? false,
        presetBindings: delivered.compilation.compiled?.presetBindings ?? [],
        contractVersion: delivered.compilation.contract?.version ?? MG_CONTRACT_VERSION,
        contractOk: delivered.compilation.contract?.ok ?? null,
        contract: delivered.compilation.contract ?? null
      },
      perceptual: currentPerceptual ? {
        version: PERCEPTUAL_VERSION,
        artifact: currentPerceptual.artifact,
        refinementReport: currentPerceptual.refinementReport,
        overallPass: currentPerceptual.artifact.overallPass
      } : null
    },
    config: proceduralConfig,
    summary: {
      totalElements: currentTracking.elements?.length ?? 0,
      springPromotions: delivered.promotion.summary?.springPromotions ?? 0,
      bezierPromotions: delivered.promotion.summary?.bezierPromotions ?? 0,
      duplicatorGroups: delivered.promotion.summary?.duplicatorGroups ?? 0,
      scriptReady: delivered.compilation.ready ?? false,
      contractOk: delivered.compilation.contract?.ok ?? null,
      contractErrors: delivered.compilation.contract?.counts?.error ?? 0,
      perceptualPass: currentPerceptual?.artifact?.overallPass ?? null,
      convergenceScore: delivered.score ?? null,
      plateauDetected: tracker.plateau.detected,
      rolledBackTo: rollback.rolledBackTo,
      converged,
      iterationsRun: iteration,
      presetMatched: presetMatches?.summary?.matched ?? null
    }
  };
}

/**
 * Generate a procedural pipeline report for human review.
 *
 * @param {Object} pipelineResult - Output from runProceduralPipeline
 * @returns {string} Markdown report
 */
export function generateProceduralReport(pipelineResult) {
  const { shotId, stages, summary } = pipelineResult;

  let report = `# Procedural Pipeline Report: ${shotId}\n\n`;

  report += `## Summary\n\n`;
  report += `- **Total elements tracked:** ${summary.totalElements}\n`;
  report += `- **Spring promotions:** ${summary.springPromotions}\n`;
  report += `- **Bezier promotions:** ${summary.bezierPromotions}\n`;
  report += `- **Duplicator groups:** ${summary.duplicatorGroups}\n`;
  report += `- **Script ready:** ${summary.scriptReady ? '✅ Yes' : '❌ No'}\n`;
  if (summary.perceptualPass !== null) {
    report += `- **Perceptual gate:** ${summary.perceptualPass ? '✅ Pass' : '⚠️ Needs refinement'}\n`;
  }
  report += '\n';

  report += `## Stage 2: Kinematic Tracking\n\n`;
  report += `- **Version:** ${stages.tracking.version}\n`;
  report += `- **Elements:** ${stages.tracking.elementCount}\n`;
  report += `- **Motion beats:** ${stages.tracking.motionBeats}\n\n`;

  report += `## Stage 3: Procedural Promotion\n\n`;
  report += `- **Version:** ${stages.promotion.version}\n`;
  const promoSummary = stages.promotion.summary;
  report += `- **Spring promotions:** ${promoSummary.springPromotions}\n`;
  report += `- **Bezier promotions:** ${promoSummary.bezierPromotions}\n`;
  report += `- **Keyframe fallbacks:** ${promoSummary.keyframeFallbacks}\n`;
  report += `- **Duplicator groups:** ${promoSummary.duplicatorGroups}\n\n`;

  report += `## Stage 4: _mg DSL Compilation\n\n`;
  report += `- **Version:** ${stages.compilation.version}\n`;
  report += `- **Script ready:** ${stages.compilation.ready ? '✅ Yes' : '❌ No'}\n`;
  report += `- **Script hash:** \`${stages.compilation.scriptHash?.slice(0, 16) ?? 'N/A'}...\`\n`;
  report += `- **Preset bindings:** ${stages.compilation.presetBindings.length}\n\n`;

  if (stages.perceptual) {
    report += `## Stage 5: Perceptual Diff Gate\n\n`;
    report += `- **Version:** ${stages.perceptual.version}\n`;
    report += `- **Overall pass:** ${stages.perceptual.overallPass ? '✅ Yes' : '⚠️ No'}\n`;
    const metrics = stages.perceptual.artifact.metrics;
    report += `- **Average IoU:** ${metrics.averageIoU?.toFixed(3) ?? 'N/A'}\n`;
    report += `- **Average SSIM:** ${metrics.averageSSIM?.toFixed(3) ?? 'N/A'}\n`;
    report += `- **Refinements needed:** ${stages.perceptual.artifact.refinementNeeded?.length ?? 0}\n\n`;
  }

  return report;
}
