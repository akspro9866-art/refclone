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
} from './procedural-pipeline.mjs';

// Individual stage modules (re-exported for granular use)
export { TRACKING_VERSION, trackElement, trackShot, toPromotionInput } from './tracking.mjs';
export { PROMOTION_VERSION, analyzeScenePromotion, analyzeElement, compilePromotionToScript } from './promotion.mjs';
export { MG_COMPILER_VERSION, VERIFIED_PRESETS, compileShotScript } from './mg-compiler.mjs';
export { PERCEPTUAL_VERSION, analyzeElementPerceptual, analyzeShotPerceptual, generateRefinementReport } from './perceptual.mjs';

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
} from './mg-contract.mjs';

// Convergence control for the refinement loop
export {
  CONVERGENCE_VERSION,
  CONVERGENCE_TIERS,
  CONVERGENCE_DEFAULTS,
  loadConvergenceConfig,
  perceptualScore,
  dampCorrectionDeltas,
  createConvergenceTracker
} from './convergence.mjs';

// CLI dispatcher (programmatic invocation)
export { main as cliMain } from './cli.mjs';
