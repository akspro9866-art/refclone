/**
 * refclone public module index.
 *
 * Re-extends the programmatic surface so MCP agents and embedders can import the
 * 5-stage procedural pipeline directly without shelling out to the CLI. The CLI
 * (`src/cli.mjs`, exposed as the `refclone` bin) remains the primary human entry
 * point; this index is the stable programmatic one.
 *
 * Backward compatibility: every export here is additive. No existing module path
 * or function signature is changed by introducing this index.
 */

// Procedural pipeline orchestrator (5-stage closed loop)
export {
  PROCEDURAL_PIPELINE_VERSION,
  loadProceduralConfig,
  extractTrackingFromObservations,
  runProceduralPromotion,
  compileProceduralScript,
  runPerceptualDiffGate,
  runProceduralPipeline,
  runClosedLoopProceduralPipeline,
  applyCorrectionDeltas,
  generateProceduralReport
} from './procedural/procedural-pipeline.mjs';

// Individual stage modules (re-exported for granular use)
export {
  TRACKING_VERSION, trackElement, trackShot, toPromotionInput, normalizeElementLayout
} from './vision/tracking.mjs';
export {
  CRITICAL_FRAMES_VERSION,
  CRITICAL_FRAME_ROLES,
  CRITICAL_FRAMES_DEFAULTS,
  analyzeCriticalTrajectory,
  analyzeElementCriticalFrames,
  detectCriticalFrames
} from './vision/critical-frames.mjs';
export { PROMOTION_VERSION, analyzeScenePromotion, analyzeElement, compilePromotionToScript } from './cavalry/promotion.mjs';
export { MG_COMPILER_VERSION, VERIFIED_PRESETS, compileShotScript, compileLayoutToMgDSL } from './cavalry/mg-compiler.mjs';
export { PERCEPTUAL_VERSION, analyzeElementPerceptual, analyzeShotPerceptual, generateRefinementReport } from './vision/perceptual.mjs';

// Stage 3.5: the _mg contract gate, run between compile and dispatch
export {
  MG_CONTRACT_VERSION,
  MG_PUBLISHED_HELPERS,
  MG_EMITTABLE_MACROS,
  MG_PROPERTY_ALIASES,
  resolveMgProperty,
  resolveMgEasing,
  normalizePresetAllowlist,
  validateMgContract,
  assertMgContract
} from './cavalry/mg-contract.mjs';

// Convergence control for the refinement loop
export {
  CONVERGENCE_VERSION,
  CONVERGENCE_TIERS,
  CONVERGENCE_DEFAULTS,
  loadConvergenceConfig,
  perceptualScore,
  dampCorrectionDeltas,
  createConvergenceTracker
} from './vision/convergence.mjs';

// 120-preset catalog index and deterministic Stage 3 matching report
export {
  PRESET_INDEX_VERSION,
  PRESET_MANIFEST_FORMAT,
  PRESET_MOTION_TOKENS,
  PRESET_EASING_TOKENS,
  PRESET_SCORE_WEIGHTS,
  parsePresetManifest,
  tokenizeSignature,
  normalizePresetRequest,
  scorePresetMatch,
  matchPresets,
  matchPreset,
  presetRequestForPromotion,
  matchPromotionPresets,
  matchPromotionPresetsIfAvailable,
  loadPresetManifest,
  tryLoadPresetManifest,
  clearPresetManifestCache
} from './cavalry/preset-index.mjs';

// Read-only Stallion client for Stage 5 evidence (snapshot-batch + decoding)
export {
  STALLION_BATCH_VERSION,
  DEFAULT_STALLION_URL,
  STALLION_PAYLOAD_KINDS,
  createStallionClient,
  decodeSnapshotFrame,
  decodeSnapshotBatch,
  captureCriticalFrames
} from './cavalry/stallion-batch.mjs';

// Zero-token atomic Stage 5 gate and deterministic _mg.patch correction
export {
  ATOMIC_CONVERGENCE_VERSION,
  ATOMIC_CONVERGENCE_STOP_REASONS,
  ATOMIC_CONVERGENCE_DEFAULTS,
  loadAtomicConvergenceConfig,
  normalizeReferenceFrames,
  normalizeExpectedLayers,
  expectedLayersFromCriticalFrames,
  evaluateAtomicSnapshot,
  buildAtomicCorrections,
  buildAtomicPatchScript,
  runAtomicConvergence,
  createStage5Adapters
} from './vision/atomic-convergence.mjs';

// CLI dispatcher (programmatic invocation)
export { main as cliMain } from './cli.mjs';
