/**
 * _mg DSL Compiler — Stage 4 of the 5-Stage Closed-Loop Pipeline (`src/compiler/mg-compiler.mjs`).
 * Consumes the canonical contract from cavalry-mcp/lib.
 * Emits _mg.patch calls matching cavalry-mcp v3.4.0.
 */
import {
  MG_COMPILER_VERSION,
  MG_OPERATION_TIERS,
  tierOf,
  sortOperationsByTier,
  VERIFIED_PRESETS,
  findMatchingPreset,
  compilePromotionScript,
  compileShotScript,
  compileMotionTransferScene,
  compileMgScene,
  enforceStage3PurityGate,
  validateMgPurity,
  selfCorrectMgPurity,
} from '../cavalry/mg-compiler.mjs';

export {
  MG_COMPILER_VERSION,
  MG_OPERATION_TIERS,
  tierOf,
  sortOperationsByTier,
  VERIFIED_PRESETS,
  findMatchingPreset,
  compilePromotionScript,
  compileShotScript,
  compileMotionTransferScene,
  compileMgScene,
  enforceStage3PurityGate,
  validateMgPurity,
  selfCorrectMgPurity,
};

/**
 * Emits an idempotent _mg.patch call matching cavalry-mcp v3.4.0.
 */
export function emitMgPatch(target, patchSpec) {
  return `_mg.patch(${JSON.stringify(target)}, ${JSON.stringify(patchSpec)});`;
}
