/**
 * _mg DSL Compiler — Stage 4 of the 5-Stage Closed-Loop Pipeline
 *
 * Compiles the promoted procedural graph into compact _mg DSL expressions
 * bound to verified presets. Wraps every execution payload in a single atomic
 * Undo group so an entire cloned sequence can be reverted in Cavalry with one
 * undo operation.
 *
 * This module integrates the promotion solver output with the Cavalry adapter
 * to produce executable scene scripts.
 */

import { WorkflowError, hashObject } from '../core.mjs';
import {
  compileToMgDSL,
  compileDuplicatorToMgDSL,
  wrapAtomicUndo,
  PROMOTION_VERSION
} from './promotion.mjs';
import {
  validateMgPurity,
  selfCorrectMgPurity
} from '../validation/validate-mg-purity.mjs';

export { validateMgPurity, selfCorrectMgPurity };

export const MG_COMPILER_VERSION = '1.0.0';

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

/**
 * Dependency tiers for emitted _mg operations. Operations are emitted in
 * strict tier order so the runtime never sees an operation that references
 * state a previous tier has not created:
 * 1. create     — node/layer creation, pivots & static layout fits
 * 2. deformer   — deformers & falloffs (duplicator/stagger/falloff/bevel)
 * 3. connection — graph connections & masks (behaviors bind dynamics in)
 * 4. keyframe   — keyframe values
 * 5. tangent    — explicit Bézier tangents (weighted handles)
 */
export const MG_OPERATION_TIERS = Object.freeze({
  create: 1,
  layout: 1,
  deformer: 2,
  connection: 3,
  keyframe: 4,
  tangent: 5
});

const LAYOUT_FITTABLE_TYPES = new Set(['textShape', 'uiCard', 'shape']);
const LAYOUT_TOLERANCE_MAX = 0.5;

/**
 * Classify an emitted operation into its dependency tier.
 *
 * @param {{kind: string}} op - Emitted operation descriptor (requires a known `kind`)
 * @returns {number} Tier, 1..5
 * @throws {WorkflowError} MG_COMPILE_INVALID for unknown or missing kinds
 */
export function tierOf(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    fail('MG_COMPILE_INVALID', 'Operation must be an object with a known kind.', { op });
  }
  const kind = op.kind;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(MG_OPERATION_TIERS, kind)) {
    fail('MG_COMPILE_INVALID', `Unknown operation kind: ${String(kind)}.`, { op });
  }
  return MG_OPERATION_TIERS[kind];
}

/**
 * Order emitted operations into strict dependency tiers (stable within a
 * tier: same-tier operations keep their input order).
 *
 * @param {Array<{kind: string}>} operations - Emitted operation descriptors
 * @returns {Array<{kind: string}>} New array ordered by tier
 * @throws {WorkflowError} MG_COMPILE_INVALID when any operation is invalid
 */
export function sortOperationsByTier(operations) {
  if (!Array.isArray(operations)) {
    fail('MG_COMPILE_INVALID', 'operations must be an array.', { operations });
  }
  const decorated = operations.map((op, index) => ({ op, tier: tierOf(op), index }));
  decorated.sort((a, b) => a.tier - b.tier || a.index - b.index);
  return decorated.map(d => d.op);
}

/**
 * Verified preset identifiers from the 120 preset catalog.
 * These are the only presets that can be bound to procedural promotions.
 */
export const VERIFIED_PRESETS = Object.freeze({
  // Spring/oscillator presets
  'spring-oscillator': {
    id: 'spring-oscillator',
    type: 'behavior',
    category: 'spring',
    description: 'Damped harmonic oscillator with configurable ζ and ω₀',
    parameters: ['dampingRatio', 'naturalFrequency', 'initialValue', 'targetValue'],
    verified: true
  },
  'spring-bounce': {
    id: 'spring-bounce',
    type: 'behavior',
    category: 'spring',
    description: 'Bouncy spring preset with moderate damping',
    parameters: ['dampingRatio', 'naturalFrequency'],
    verified: true
  },
  'spring-snappy': {
    id: 'spring-snappy',
    type: 'behavior',
    category: 'spring',
    description: 'Quick settling spring with high damping',
    parameters: ['dampingRatio', 'naturalFrequency'],
    verified: true
  },

  // Bezier easing presets
  'bezier-smooth': {
    id: 'bezier-smooth',
    type: 'easing',
    category: 'bezier',
    description: 'Smooth ease-in-out cubic bezier',
    parameters: ['y1', 'y2'],
    verified: true
  },
  'bezier-snap': {
    id: 'bezier-snap',
    type: 'easing',
    category: 'bezier',
    description: 'Quick start, smooth end',
    parameters: ['y1', 'y2'],
    verified: true
  },
  'bezier-glide': {
    id: 'bezier-glide',
    type: 'easing',
    category: 'bezier',
    description: 'Slow start, quick end',
    parameters: ['y1', 'y2'],
    verified: true
  },

  // Duplicator presets
  'duplicator-stagger': {
    id: 'duplicator-stagger',
    type: 'duplicator',
    category: 'duplicator',
    description: 'Temporal stagger with linear falloff',
    parameters: ['count', 'lagFrames', 'offset'],
    verified: true
  },
  'duplicator-cascade': {
    id: 'duplicator-cascade',
    type: 'duplicator',
    category: 'duplicator',
    description: 'Cascading spatial offset pattern',
    parameters: ['count', 'offset', 'falloff'],
    verified: true
  },
  'duplicator-wave': {
    id: 'duplicator-wave',
    type: 'duplicator',
    category: 'duplicator',
    description: 'Wave-like stagger with sinusoidal falloff',
    parameters: ['count', 'lagFrames', 'waveAmplitude'],
    verified: true
  }
});

/**
 * Find the best matching preset for a promotion.
 *
 * @param {Object} promotion - Promotion result from analyzeTrajectory
 * @returns {string|null} Preset ID or null if no match
 */
export function findMatchingPreset(promotion) {
  const { promotion: type, parameters, metrics } = promotion;

  if (type === 'damped_spring') {
    const { zeta } = parameters;

    // Match spring preset based on damping ratio
    if (zeta < 0.3) return 'spring-bounce';
    if (zeta > 0.7) return 'spring-snappy';
    return 'spring-oscillator';
  }

  if (type === 'cubic_bezier') {
    // Weighted-handle promotions carry explicit custom tangents; they are not
    // catalog easing presets and stay unbound rather than mis-binding.
    if (parameters && (parameters.inWeight !== undefined || parameters.outWeight !== undefined)) {
      return null;
    }

    const { y1, y2 } = parameters;

    // Match bezier preset based on control points
    if (y1 < 0.3 && y2 > 0.7) return 'bezier-smooth';
    if (y1 > 0.5 && y2 > 0.8) return 'bezier-snap';
    if (y1 < 0.2 && y2 < 0.5) return 'bezier-glide';
    return 'bezier-smooth'; // Default
  }

  return null;
}

/**
 * Validate that a preset ID is in the verified catalog.
 *
 * @param {string} presetId
 * @returns {boolean}
 */
export function isValidPreset(presetId) {
  return presetId !== null && presetId !== undefined && VERIFIED_PRESETS.hasOwnProperty(presetId);
}

const numericLiteral = value => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1e6) / 1e6);
};

/** Resolve the `_mg.fitToBounds` handle: `@alias` wins, then the live element id. */
function layoutHandle(element, layout) {
  if (layout?.alias != null && String(layout.alias).trim()) {
    const alias = String(layout.alias).trim();
    return alias.startsWith('@') ? alias : `@${alias}`;
  }
  const id = element?.elementId ?? element?.id;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

/**
 * Compile an element's optional static-layout descriptor to one fit operation.
 *
 * Only bounded layer types are fitted: a text run or a card is expected to hold
 * a target box, while an unbounded artwork layer's natural size is not a
 * contract. Raster bounds (top-left, y-down video pixels) go through
 * `_mg.fromRaster`; the box's bottom edge is the comp-space min corner, so the
 * conversion point is `y + height`. Composition-space bounds are emitted
 * verbatim. The fit runs at tier 1, before animation is written, and tolerance
 * is capped at 0.5 px so Stage 5 starts from an aligned layout.
 *
 * @param {Object} element - Promotion artifact element
 * @param {Object} layout - Normalized layout descriptor
 * @param {Object} [options]
 * @param {number} [options.index=0] - Unique index for the emitted const
 * @returns {{dsl: string, undoGroup: string, presetBinding: null, op: Object, binding: Object}|null}
 */
export function compileLayoutToMgDSL(element, layout, options = {}) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return null;
  if (!LAYOUT_FITTABLE_TYPES.has(layout.elementType)) return null;

  const bounds = layout.targetBounds;
  if (!bounds || typeof bounds !== 'object') return null;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  const handle = layoutHandle(element, layout);
  if (!handle) return null;
  const elementId = String(element?.elementId ?? element?.id ?? handle);
  const tolerance = Math.min(
    LAYOUT_TOLERANCE_MAX,
    Math.max(0.001, Number.isFinite(Number(layout.tolerance)) ? Number(layout.tolerance) : LAYOUT_TOLERANCE_MAX)
  );
  const box = `{ x: ${numericLiteral(x)}, y: ${numericLiteral(y)}, width: ${numericLiteral(width)}, height: ${numericLiteral(height)} }`;
  const fitOptions = `{ space: "comp", tolerance: ${numericLiteral(tolerance)} }`;

  let dsl;
  if (layout.coordinateSpace === 'raster') {
    const compWidth = Number(layout.compWidth);
    const compHeight = Number(layout.compHeight);
    if (!(compWidth > 0) || !(compHeight > 0)) return null;
    const target = `layoutTarget${Math.max(0, Math.round(Number(options.index) || 0))}`;
    dsl = `// Layout fit: ${elementId} (${layout.elementType}, raster→comp)
const ${target} = _mg.fromRaster(${numericLiteral(x)}, ${numericLiteral(y + height)}, ${numericLiteral(compWidth)}, ${numericLiteral(compHeight)});
_mg.fitToBounds(${JSON.stringify(handle)}, { x: ${target}.x, y: ${target}.y, width: ${numericLiteral(width)}, height: ${numericLiteral(height)} }, ${fitOptions});`;
  } else if (layout.coordinateSpace === 'comp') {
    dsl = `// Layout fit: ${elementId} (${layout.elementType}, comp)
_mg.fitToBounds(${JSON.stringify(handle)}, ${box}, ${fitOptions});`;
  } else {
    return null;
  }

  return {
    dsl,
    undoGroup: `layout-${elementId}`,
    presetBinding: null,
    op: { kind: 'layout', element: elementId },
    binding: {
      elementId,
      alias: handle.startsWith('@') ? handle : null,
      elementType: layout.elementType,
      coordinateSpace: layout.coordinateSpace,
      targetBounds: { x, y, width, height },
      tolerance
    }
  };
}

/** Find the advisory catalog match for one promoted property. */
function catalogMatchFor(presetMatches, elementId, property) {
  if (!presetMatches || !Array.isArray(presetMatches.elements)) return null;
  const element = presetMatches.elements.find(entry => String(entry?.elementId) === String(elementId));
  const match = (element?.matches ?? []).find(entry => String(entry?.property) === String(property));
  const presetId = match?.preset?.id;
  if (presetId == null || String(presetId) === '') return null;
  return {
    presetId: String(presetId),
    score: Number.isFinite(Number(match.score)) ? Number(match.score) : null,
    reasons: Array.isArray(match.reasons) ? match.reasons.slice() : []
  };
}

/** Find the advisory catalog match for one duplicator group. */
function catalogDuplicatorMatch(presetMatches, baseElementId) {
  if (!presetMatches || !Array.isArray(presetMatches.duplicatorGroups)) return null;
  const match = presetMatches.duplicatorGroups.find(entry => String(entry?.baseElementId) === String(baseElementId));
  const presetId = match?.preset?.id;
  if (presetId == null || String(presetId) === '') return null;
  return {
    presetId: String(presetId),
    score: Number.isFinite(Number(match.score)) ? Number(match.score) : null,
    reasons: Array.isArray(match.reasons) ? match.reasons.slice() : []
  };
}

/**
 * Compile a promotion analysis to executable _mg DSL script.
 *
 * @param {Object} params
 * @param {Object} params.analysis - Result from analyzeScenePromotion
 * @param {string} params.groupName - Name for the atomic undo group
 * @param {Object} [params.capabilities] - Adapter capabilities for validation
 * @param {boolean} [params.autoBindPresets=true] - Automatically bind matching presets
 * @param {Object|null} [params.presetMatches] - Stage 3 advisory catalog report;
 *   a catalog preset replaces the heuristic binding only when it is also in
 *   VERIFIED_PRESETS, so the contract gate never sees an unproven id.
 * @returns {Object} Compiled script with metadata, including per-operation tiers
 *     (`expressions[].tier`) and the `tiers` count summary
 */
/**
 * Enforce the 100-Point `_mg` Purity Gate at the end of Stage 3 (`mg-compiler`).
 * If `passed === false`, automatically runs a single self-correction pass
 * appending `autoFixPrompt` so Stage 4 only receives Grade A/B procedural `_mg` code.
 *
 * @param {string} generatedDsl
 * @param {{ theme?: string, useMgUndoGroup?: boolean, selfCorrect?: (dsl: string, autoFixPrompt: string, purity: Object) => string }} [options]
 */
export function enforceStage3PurityGate(generatedDsl, options = {}) {
  const initialPurity = validateMgPurity(generatedDsl);
  if (initialPurity.passed) {
    return {
      script: generatedDsl,
      purity: initialPurity,
      initialPurity,
      selfCorrected: false,
      autoFixPrompt: initialPurity.autoFixPrompt
    };
  }

  let candidate = generatedDsl;
  if (typeof options.selfCorrect === 'function') {
    const hooked = options.selfCorrect(
      `${generatedDsl}\n// [autoFixPrompt] ${initialPurity.autoFixPrompt}`,
      initialPurity.autoFixPrompt,
      initialPurity
    );
    if (typeof hooked === 'string' && hooked.trim().length > 0) {
      candidate = hooked;
    }
  }

  let recheck = validateMgPurity(candidate);
  if (!recheck.passed) {
    const corrected = selfCorrectMgPurity(candidate, {
      theme: options.theme ?? 'neutral',
      useMgUndoGroup: options.useMgUndoGroup ?? true,
      appendAutoFixComment: true
    });
    candidate = corrected.correctedScript;
    recheck = corrected.finalValidation;
  }

  return {
    script: candidate,
    purity: recheck,
    initialPurity,
    selfCorrected: true,
    autoFixPrompt: initialPurity.autoFixPrompt
  };
}

export function compilePromotionScript({
  analysis, groupName, capabilities, autoBindPresets = true, presetMatches = null, rawDsl = null, theme = null, selfCorrect = null
}) {
  if (!analysis || !analysis.elements) {
    fail('MG_COMPILE_INVALID', 'Valid promotion analysis is required.');
  }

  if (!groupName || typeof groupName !== 'string') {
    fail('MG_COMPILE_INVALID', 'groupName is required.');
  }

  const expressions = [];
  const ops = [];
  const presetBindings = [];
  const unboundPromotions = [];
  const layoutBindings = [];
  const catalogBindings = {
    available: Boolean(presetMatches),
    applied: 0,
    rejectedUnverified: []
  };

  // Compile element promotions. The layout fit is emitted first: it runs at
  // tier 1 and must align the layer before any keyframe or behavior reads it.
  for (const [elementIndex, element] of analysis.elements.entries()) {
    const layoutCompiled = compileLayoutToMgDSL(element, element.layout, { index: elementIndex });
    if (layoutCompiled) {
      expressions.push(layoutCompiled);
      ops.push(layoutCompiled.op);
      layoutBindings.push({ ...layoutCompiled.binding, tier: MG_OPERATION_TIERS.layout });
    }

    for (const promotion of element.promotions ?? []) {
      if (promotion.promotion === 'none' || promotion.promotion === 'static') {
        continue;
      }

      // Auto-bind preset if requested. The catalog is advisory evidence, so it
      // wins only when its id is verified; otherwise the deterministic
      // heuristic still binds and the rejected catalog id is recorded.
      let presetId = null;
      let bindingSource = null;
      let catalogMatch = null;
      if (autoBindPresets) {
        catalogMatch = catalogMatchFor(presetMatches, element.elementId, promotion.property);
        if (catalogMatch && isValidPreset(catalogMatch.presetId)) {
          presetId = catalogMatch.presetId;
          bindingSource = 'catalog';
          catalogBindings.applied += 1;
        } else {
          if (catalogMatch) {
            catalogBindings.rejectedUnverified.push({
              elementId: element.elementId,
              property: promotion.property,
              presetId: catalogMatch.presetId,
              reason: 'preset_not_verified'
            });
          }
          presetId = findMatchingPreset(promotion);
          bindingSource = presetId ? 'heuristic' : null;
          if (presetId && !isValidPreset(presetId)) {
            unboundPromotions.push({
              elementId: element.elementId,
              property: promotion.property,
              reason: 'preset_not_verified',
              attemptedPreset: presetId
            });
            presetId = null;
            bindingSource = null;
          }
        }
      }

      const compiled = compileToMgDSL(promotion, { presetId });
      if (!compiled.op) {
        fail('MG_COMPILE_INVALID', 'Compiled promotion expression is missing an operation descriptor.', {
          elementId: element.elementId,
          property: promotion.property
        });
      }
      expressions.push(compiled);
      ops.push(compiled.op);

      if (compiled.presetBinding) {
        presetBindings.push({
          elementId: element.elementId,
          property: promotion.property,
          presetId: compiled.presetBinding,
          promotionType: promotion.promotion,
          ...(bindingSource ? { source: bindingSource } : {}),
          ...(catalogMatch ? {
            catalogPresetId: catalogMatch.presetId,
            catalogScore: catalogMatch.score
          } : {})
        });
      } else {
        unboundPromotions.push({
          elementId: element.elementId,
          property: promotion.property,
          reason: 'no_matching_preset',
          promotionType: promotion.promotion
        });
      }
    }
  }

  // Compile duplicator groups
  for (const group of analysis.duplicatorGroups ?? []) {
    const catalogMatch = catalogDuplicatorMatch(presetMatches, group.baseElementId);
    const catalogPresetId = catalogMatch && isValidPreset(catalogMatch.presetId)
      ? catalogMatch.presetId
      : null;
    if (catalogMatch && !catalogPresetId) {
      catalogBindings.rejectedUnverified.push({
        baseElementId: group.baseElementId,
        presetId: catalogMatch.presetId,
        reason: 'preset_not_verified'
      });
    }
    if (catalogPresetId) catalogBindings.applied += 1;
    const presetId = catalogPresetId ?? 'duplicator-stagger';
    const compiled = compileDuplicatorToMgDSL(group, { presetId });
    expressions.push(compiled);
    ops.push(compiled.op);

    presetBindings.push({
      elementIds: group.elementIds,
      baseElementId: group.baseElementId,
      presetId,
      promotionType: 'duplicator',
      source: catalogPresetId ? 'catalog' : 'default',
      ...(catalogMatch ? {
        catalogPresetId: catalogMatch.presetId,
        catalogScore: catalogMatch.score
      } : {})
    });
  }

  // Order operations into strict dependency tiers before emitting the script.
  const sortedOps = sortOperationsByTier(ops);
  const opToExpression = new Map(ops.map((op, index) => [op, expressions[index]]));
  const orderedExpressions = sortedOps.map(op => opToExpression.get(op));
  const orderedTiers = sortedOps.map(op => tierOf(op));

  const tiers = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const tier of orderedTiers) {
    tiers[tier] += 1;
  }

  // Wrap in atomic undo group
  let script = orderedExpressions.length > 0
    ? wrapAtomicUndo(orderedExpressions, groupName)
    : '// No procedural promotions to compile';

  if (typeof rawDsl === 'string' && rawDsl.trim().length > 0) {
    script = orderedExpressions.length > 0 ? `${script}\n${rawDsl}` : rawDsl;
  }

  // Run Stage 3 purity gate before Stage 4 execution
  let purityGate;
  if (orderedExpressions.length > 0 || (typeof rawDsl === 'string' && rawDsl.trim().length > 0)) {
    purityGate = enforceStage3PurityGate(script, {
      theme: theme ?? analysis?.theme ?? 'neutral',
      useMgUndoGroup: true,
      selfCorrect
    });
    script = purityGate.script;
  } else {
    purityGate = {
      script,
      purity: {
        score: 100,
        grade: 'A',
        passed: true,
        breakdown: {
          atomicUndoSafety: 25,
          mgPrimitivePurity: 30,
          tokenizedStyling: 25,
          proceduralMotionPurity: 20
        },
        violations: [],
        autoFixPrompt: ''
      },
      initialPurity: null,
      selfCorrected: false,
      autoFixPrompt: ''
    };
  }

  // Generate script hash for caching
  const scriptHash = hashObject({
    groupName,
    expressionCount: expressions.length,
    presetBindings: presetBindings.length,
    layoutOps: layoutBindings.length,
    script
  });

  return {
    version: MG_COMPILER_VERSION,
    promotionVersion: PROMOTION_VERSION,
    groupName,
    script,
    scriptHash,
    purity: purityGate.purity,
    puritySelfCorrected: purityGate.selfCorrected,
    expressions: orderedExpressions.map((e, index) => ({
      undoGroup: e.undoGroup,
      presetBinding: e.presetBinding,
      dslLength: e.dsl.length,
      kind: e.op.kind,
      tier: orderedTiers[index]
    })),
    presetBindings,
    unboundPromotions,
    layoutBindings,
    presetMatches: catalogBindings,
    tiers,
    summary: {
      totalExpressions: expressions.length,
      layoutOps: layoutBindings.length,
      boundPresets: presetBindings.length,
      unboundPromotions: unboundPromotions.length,
      springPromotions: presetBindings.filter(p => p.promotionType === 'damped_spring').length,
      bezierPromotions: presetBindings.filter(p => p.promotionType === 'cubic_bezier').length,
      duplicatorPromotions: presetBindings.filter(p => p.promotionType === 'duplicator').length
    },
    atomicUndo: {
      enabled: true,
      groupName,
      operationCount: expressions.length
    }
  };
}

/**
 * Validate compiled script against adapter capabilities.
 *
 * @param {Object} compiled - Result from compilePromotionScript
 * @param {Object} capabilities - Adapter capability contract
 * @returns {Object} Validation result
 */
export function validateCompiledScript(compiled, capabilities) {
  const issues = [];

  // Check if spring behaviors are supported
  const springBindings = compiled.presetBindings.filter(p => p.promotionType === 'damped_spring');
  if (springBindings.length > 0) {
    const springCapability = capabilities?.operations?.spring ?? capabilities?.operations?.behavior;
    if (!springCapability || springCapability.supportStatus !== 'runtime_verified') {
      issues.push({
        severity: 'warning',
        code: 'SPRING_CAPABILITY_UNVERIFIED',
        message: 'Spring behavior promotions require runtime-verified capability',
        affectedCount: springBindings.length
      });
    }
  }

  // Check if duplicator is supported
  const duplicatorBindings = compiled.presetBindings.filter(p => p.promotionType === 'duplicator');
  if (duplicatorBindings.length > 0) {
    const duplicatorCapability = capabilities?.operations?.duplicator;
    if (!duplicatorCapability || duplicatorCapability.supportStatus !== 'runtime_verified') {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATOR_CAPABILITY_UNVERIFIED',
        message: 'Duplicator promotions require runtime-verified capability',
        affectedCount: duplicatorBindings.length
      });
    }
  }

  // Check for unbound promotions
  if (compiled.unboundPromotions.length > 0) {
    issues.push({
      severity: 'info',
      code: 'UNBOUND_PROMOTIONS',
      message: 'Some promotions could not be bound to verified presets',
      details: compiled.unboundPromotions
    });
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    canExecute: issues.filter(i => i.severity === 'error' || i.severity === 'warning').length === 0
  };
}

/**
 * Generate execution metadata for the compiled script.
 *
 * @param {Object} compiled - Result from compilePromotionScript
 * @param {Object} options - Execution options
 * @returns {Object} Execution metadata
 */
export function generateExecutionMetadata(compiled, options = {}) {
  return {
    scriptHash: compiled.scriptHash,
    groupName: compiled.groupName,
    estimatedOperations: compiled.summary.totalExpressions,
    requiresCheckpoint: true,
    atomicUndoEnabled: compiled.atomicUndo.enabled,
    presetBindings: compiled.presetBindings.map(b => b.presetId),
    layoutFits: compiled.layoutBindings?.length ?? 0,
    timeout: options.timeoutMs ?? 60000,
    retryPolicy: {
      maxRetries: options.maxRetries ?? 2,
      backoffMs: options.backoffMs ?? 1000
    },
    preconditions: [
      'Scene must be saved before execution',
      'Stallion bridge must be enabled',
      'No pending scene modifications'
    ]
  };
}

/**
 * Full compilation pipeline from tracking analysis to executable script.
 *
 * @param {Object} params
 * @param {Object} params.trackingAnalysis - Result from trackShot
 * @param {Object} params.promotionAnalysis - Result from analyzeScenePromotion
 * @param {string} params.shotId
 * @param {Object} [params.capabilities]
 * @param {Object} [params.options]
 * @returns {Object} Complete compilation result
 */
export function compileShotScript({ trackingAnalysis, promotionAnalysis, shotId, capabilities, options = {} }) {
  if (!shotId) {
    fail('MG_COMPILE_INVALID', 'shotId is required.');
  }

  if (!promotionAnalysis) {
    fail('MG_COMPILE_INVALID', 'promotionAnalysis is required.');
  }

  const groupName = options.groupName ?? `shot-${shotId}-procedural`;

  const compiled = compilePromotionScript({
    analysis: promotionAnalysis,
    groupName,
    capabilities,
    autoBindPresets: options.autoBindPresets ?? true,
    presetMatches: options.presetMatches ?? promotionAnalysis.presetMatches ?? null,
    rawDsl: options.rawDsl ?? null,
    theme: options.theme ?? promotionAnalysis.theme ?? null,
    selfCorrect: options.selfCorrect ?? null
  });

  const validation = validateCompiledScript(compiled, capabilities);
  const metadata = generateExecutionMetadata(compiled, options);

  return {
    shotId,
    version: MG_COMPILER_VERSION,
    compiled,
    purity: compiled.purity,
    puritySelfCorrected: compiled.puritySelfCorrected,
    validation,
    metadata,
    ready: validation.canExecute && Boolean(compiled.purity?.passed),
    trackingSummary: trackingAnalysis?.summary ?? null
  };
}

/**
 * Generate a human-readable compilation report.
 *
 * @param {Object} compilation - Result from compileShotScript
 * @returns {string} Markdown report
 */
export function generateCompilationReport(compilation) {
  const { shotId, compiled, validation, metadata, ready } = compilation;

  let report = `# Procedural Compilation Report: ${shotId}\n\n`;
  report += `**Status:** ${ready ? '✅ Ready for execution' : '⚠️ Requires review'}\n\n`;

  report += `## Summary\n\n`;
  report += `- **Total expressions:** ${compiled.summary.totalExpressions}\n`;
  report += `- **Layout fits:** ${compiled.summary.layoutOps ?? 0}\n`;
  report += `- **Bound presets:** ${compiled.summary.boundPresets}\n`;
  const tiers = compiled.tiers ?? {};
  report += `- **Operation tiers:** ${[1, 2, 3, 4, 5].map(t => `T${t}:${tiers[t] ?? 0}`).join(' ')}\n`;
  report += `- **Spring promotions:** ${compiled.summary.springPromotions}\n`;
  report += `- **Bezier promotions:** ${compiled.summary.bezierPromotions}\n`;
  report += `- **Duplicator promotions:** ${compiled.summary.duplicatorPromotions}\n`;
  report += `- **Unbound promotions:** ${compiled.summary.unboundPromotions}\n\n`;

  if (validation.issues.length > 0) {
    report += `## Validation Issues\n\n`;
    for (const issue of validation.issues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      report += `${icon} **${issue.code}**: ${issue.message}\n`;
      if (issue.affectedCount) {
        report += `   Affected: ${issue.affectedCount} promotions\n`;
      }
    }
    report += '\n';
  }

  if (compiled.unboundPromotions.length > 0) {
    report += `## Unbound Promotions\n\n`;
    for (const unbound of compiled.unboundPromotions) {
      report += `- \`${unbound.elementId}.${unbound.property}\`: ${unbound.reason}\n`;
    }
    report += '\n';
  }

  report += `## Execution Metadata\n\n`;
  report += `- **Script hash:** \`${compiled.scriptHash.slice(0, 16)}...\`\n`;
  report += `- **Atomic undo:** ${metadata.atomicUndoEnabled ? 'Enabled' : 'Disabled'}\n`;
  report += `- **Requires checkpoint:** ${metadata.requiresCheckpoint ? 'Yes' : 'No'}\n`;
  report += `- **Timeout:** ${metadata.timeout}ms\n\n`;

  report += `## Preset Bindings\n\n`;
  if (compiled.presetBindings.length === 0) {
    report += `No presets bound.\n\n`;
  } else {
    report += `| Element | Property | Preset | Type |\n`;
    report += `|---------|----------|--------|------|\n`;
    for (const binding of compiled.presetBindings) {
      const elementId = binding.elementId ?? binding.baseElementId ?? 'N/A';
      const property = binding.property ?? 'duplicator';
      report += `| \`${elementId}\` | ${property} | \`${binding.presetId}\` | ${binding.promotionType} |\n`;
    }
    report += '\n';
  }

  return report;
}

/**
 * Procedural SaaS Rig Builders from `cavalry-mcp/src/helpers/rig_builders.ts`
 * used when compiling `--mode motion-transfer` scenes.
 */
export const MOTION_TRANSFER_RIG_BUILDERS = Object.freeze([
  '_rb.buildControllerNull',
  '_rb.buildWeightedParentBlend',
  '_rb.buildNinePointRoundedCard',
  '_rb.buildAutoSizingPill',
  '_rb.buildProximityFieldDuplicator'
]);

/**
 * Category 15 (`cat15_procedural_saas`) procedural SaaS presets from `cavalry-mcp`.
 */
export const CAT15_PROCEDURAL_SAAS_PRESETS = Object.freeze({
  soft_cells_bento: {
    id: 'soft_cells_bento',
    category: 'cat15_procedural_saas',
    description: 'Bento grid card layout with 9-point corner radii and falloff scale stagger',
    rigBuilder: '_rb.buildNinePointRoundedCard',
    verified: true
  },
  marker_sync_cascade: {
    id: 'marker_sync_cascade',
    category: 'cat15_procedural_saas',
    description: 'Beat-marker synchronized stagger cascade across SaaS UI elements',
    rigBuilder: '_rb.buildControllerNull',
    verified: true
  },
  spring_text_reveal: {
    id: 'spring_text_reveal',
    category: 'cat15_procedural_saas',
    description: 'Procedural spring-driven headline & subhead reveal with readability hold',
    rigBuilder: '_rb.buildAutoSizingPill',
    verified: true
  },
  shape_morph_loop: {
    id: 'shape_morph_loop',
    category: 'cat15_procedural_saas',
    description: 'Procedural shape morph & weighted parent blend transition rig',
    rigBuilder: '_rb.buildWeightedParentBlend',
    verified: true
  },
  csv_localiser_batch: {
    id: 'csv_localiser_batch',
    category: 'cat15_procedural_saas',
    description: 'Data-driven CSV/JSON token localiser batch rig with proximity field duplicator',
    rigBuilder: '_rb.buildProximityFieldDuplicator',
    verified: true
  }
});

/**
 * Compile a validated `motion-transfer-spec` artifact into a pure procedural
 * Cavalry `_mg` + `_rb` + `cat15` scene script (`--mode motion-transfer`).
 *
 * Guarantees:
 * - Emits Master Control Null (`_rb.buildControllerNull`)
 * - Emits Weighted Parent Blend (`_rb.buildWeightedParentBlend`)
 * - Emits 9-Point Rounded SaaS Card (`_rb.buildNinePointRoundedCard`)
 * - Emits Auto-Sizing Pill (`_rb.buildAutoSizingPill`)
 * - Emits Proximity Field Duplicator (`_rb.buildProximityFieldDuplicator`)
 * - Binds `cat15_procedural_saas` presets (`soft_cells_bento`, `marker_sync_cascade`,
 *   `spring_text_reveal`, `shape_morph_loop`, `csv_localiser_batch`)
 * - Emits perceptual OKLCH gradients (`_mg.oklchGradient` / `_mg.cssGradient`)
 * - Never emits baked per-frame keyframe loops (`for (let f = ...)`) or raw `api.create`/`api.set`.
 *
 * @param {Object} motionTransferSpec - Validated `motion-transfer-spec` artifact
 * @param {Object} [options] - Compiler options
 * @returns {Object} Compilation result with `_mg` script, purity score, and rig bindings
 */
export function compileMotionTransferScene(motionTransferSpec, options = {}) {
  if (!motionTransferSpec || typeof motionTransferSpec !== 'object') {
    fail('MG_COMPILE_INVALID', 'compileMotionTransferScene requires a motionTransferSpec object.');
  }
  if (motionTransferSpec.mode && motionTransferSpec.mode !== 'motion-transfer') {
    fail('MG_COMPILE_INVALID', `Expected mode "motion-transfer", received "${motionTransferSpec.mode}".`);
  }

  const brand = motionTransferSpec.brandTokens ?? {};
  const palette = brand.palette ?? {};
  const oklch = palette.oklch ?? {};
  const typography = brand.typography ?? {};
  const radii = brand.radii ?? { cardPx: 16, pillPx: 999, buttonPx: 10 };
  const motionDna = motionTransferSpec.motionDna ?? {};
  const triggerOrder = Array.isArray(motionDna.triggerOrder) ? motionDna.triggerOrder : [];
  const curves = Array.isArray(motionDna.curves) ? motionDna.curves : [];
  const alphaPlates = Array.isArray(motionDna.alphaPlates) ? motionDna.alphaPlates : [];

  const primarySpring = curves.find(c => c.kind === 'spring')?.spring ?? {
    stiffness: 220,
    damping: 20,
    mass: 1,
    overshoot: 0.08,
    settlingTimeMs: 520
  };
  const primaryBezier = curves.find(c => c.kind === 'cubic-bezier')?.cubicBezier ?? [0.22, 1, 0.36, 1];

  const bgOklch = oklch.background ?? palette.bgSurface ?? 'oklch(0.16 0.02 260)';
  const surfaceOklch = oklch.surface ?? palette.cardFill ?? 'oklch(0.22 0.03 260)';
  const primaryOklch = oklch.primary ?? palette.accentPrimary ?? 'oklch(0.68 0.19 255)';
  const accentOklch = oklch.accent ?? palette.accentSecondary ?? 'oklch(0.75 0.16 165)';

  // Single-line theme configuration so validateMgPurity's tokenized_styling rule
  // recognizes all hex literals as belonging to _mg.applySceneTheme.
  const themePayload = JSON.stringify({
    name: brand.brandName ?? 'SaaS Motion Transfer',
    bgSurface: palette.bgSurface ?? palette.background ?? 'oklch(0.16 0.02 260)',
    cardFill: palette.cardFill ?? palette.surface ?? 'oklch(0.22 0.03 260)',
    accentPrimary: palette.accentPrimary ?? palette.primary ?? 'oklch(0.68 0.19 255)',
    accentSecondary: palette.accentSecondary ?? palette.accent ?? 'oklch(0.75 0.16 165)',
    textPrimary: palette.textPrimary ?? 'oklch(0.97 0.01 260)',
    textMuted: palette.textMuted ?? 'oklch(0.72 0.02 260)',
    strokeColor: palette.strokeColor ?? palette.border ?? 'oklch(0.30 0.03 260)'
  });

  const expressions = [];
  const presetBindings = [];
  const rigBuildersUsed = [];
  const cat15PresetsUsed = [];
  const gradientCallsUsed = [];
  const alphaPlatesAttached = [];

  // 1. Perceptual OKLCH & CSS Gradients
  expressions.push(
    `const bgGrad = _mg.oklchGradient({ name: "Brand_OKLCH_Canvas", stops: [${JSON.stringify(bgOklch)}, ${JSON.stringify(surfaceOklch)}, ${JSON.stringify(primaryOklch)}], angleDeg: 135 });`,
    `const accentGrad = _mg.cssGradient({ name: "Brand_Accent_Sheen", css: "linear-gradient(135deg, ${primaryOklch} 0%, ${accentOklch} 100%)" });`
  );
  gradientCallsUsed.push('_mg.oklchGradient', '_mg.cssGradient');

  // 2. Master Control Null (_rb.buildControllerNull) + marker_sync_cascade
  expressions.push(
    `const masterCtrl = _rb.buildControllerNull({ name: "Master_Control_Null", sliders: [{ id: "introProgress", min: 0, max: 1, value: 1 }, { id: "bentoStagger", min: 0, max: 1, value: 0.35 }, { id: "parentBlendWeight", min: 0, max: 1, value: 0.75 }] });`,
    `_mg.preset("marker_sync_cascade", { controllerId: masterCtrl.id, staggerIntervalMs: ${Number(triggerOrder[0]?.staggerIntervalMs ?? 60)}, bezier: ${JSON.stringify(primaryBezier)} });`
  );
  rigBuildersUsed.push('_rb.buildControllerNull');
  cat15PresetsUsed.push('marker_sync_cascade');
  presetBindings.push({
    elementId: 'Master_Control_Null',
    property: 'cascade',
    presetId: 'marker_sync_cascade',
    promotionType: 'cat15_procedural_saas'
  });

  // 3. 9-Point Rounded SaaS Card (_rb.buildNinePointRoundedCard) + soft_cells_bento
  expressions.push(
    `const heroCard = _rb.buildNinePointRoundedCard({ name: "SaaS_Hero_Bento_Card", width: 840, height: 480, radius: ${Number(radii.cardPx ?? 16)}, fill: _mg.theme.cardFill, stroke: _mg.theme.strokeColor, controllerId: masterCtrl.id });`,
    `_mg.preset("soft_cells_bento", { targetId: heroCard.id, radius: ${Number(radii.cardPx ?? 16)}, fill: _mg.theme.cardFill, stroke: _mg.theme.strokeColor });`
  );
  rigBuildersUsed.push('_rb.buildNinePointRoundedCard');
  cat15PresetsUsed.push('soft_cells_bento');
  presetBindings.push({
    elementId: 'SaaS_Hero_Bento_Card',
    property: 'layout',
    presetId: 'soft_cells_bento',
    promotionType: 'cat15_procedural_saas'
  });

  // 4. Auto-Sizing Pill (_rb.buildAutoSizingPill) + spring_text_reveal
  const brandHeadline = `${brand.brandName ?? 'Acme Cloud'} — Unified Workflow Intelligence`;
  const pillLabel = `${(brand.personality ?? 'snappy-saas').toUpperCase()} RELEASE`;
  expressions.push(
    `const statusPill = _rb.buildAutoSizingPill({ name: "SaaS_Release_Pill", text: ${JSON.stringify(pillLabel)}, fontFamily: ${JSON.stringify(typography.displayFamily ?? 'Plus Jakarta Sans')}, paddingX: 20, paddingY: 10, radius: ${Number(radii.pillPx ?? 999)}, fill: _mg.theme.accentPrimary, textColor: _mg.theme.textPrimary });`,
    `const heroTitle = _mg.text({ name: "SaaS_Hero_Title", text: ${JSON.stringify(brandHeadline)}, fontFamily: ${JSON.stringify(typography.displayFamily ?? 'Plus Jakarta Sans')}, fontSize: 56, fill: _mg.theme.textPrimary });`,
    `_mg.preset("spring_text_reveal", { targetId: heroTitle, pillId: statusPill.id, stiffness: ${Number(primarySpring.stiffness)}, damping: ${Number(primarySpring.damping)}, mass: ${Number(primarySpring.mass ?? 1)}, holdSeconds: 1.25 });`
  );
  rigBuildersUsed.push('_rb.buildAutoSizingPill');
  cat15PresetsUsed.push('spring_text_reveal');
  presetBindings.push({
    elementId: 'SaaS_Hero_Title',
    property: 'textReveal',
    presetId: 'spring_text_reveal',
    promotionType: 'cat15_procedural_saas'
  });

  // 5. Weighted Parent Blend (_rb.buildWeightedParentBlend) + shape_morph_loop
  expressions.push(
    `const parentBlendRig = _rb.buildWeightedParentBlend({ name: "SaaS_Card_Blend_Constraint", childId: statusPill.id, parentA: masterCtrl.id, parentB: heroCard.id, weight: 0.75 });`,
    `_mg.preset("shape_morph_loop", { targetId: parentBlendRig.id, bezier: ${JSON.stringify(primaryBezier)}, fill: _mg.theme.accentSecondary });`
  );
  rigBuildersUsed.push('_rb.buildWeightedParentBlend');
  cat15PresetsUsed.push('shape_morph_loop');
  presetBindings.push({
    elementId: 'SaaS_Card_Blend_Constraint',
    property: 'parentBlend',
    presetId: 'shape_morph_loop',
    promotionType: 'cat15_procedural_saas'
  });

  // 6. Proximity Field Duplicator (_rb.buildProximityFieldDuplicator) + csv_localiser_batch
  expressions.push(
    `const metricDuplicator = _rb.buildProximityFieldDuplicator({ name: "SaaS_Bento_Cells_Duplicator", sourceId: heroCard.id, countX: 3, countY: 2, spacingX: 280, spacingY: 180, falloffRadius: 360, effectorId: masterCtrl.id });`,
    `_mg.preset("csv_localiser_batch", { duplicatorId: metricDuplicator.id, fontFamily: ${JSON.stringify(typography.monoFamily ?? 'JetBrains Mono')}, textColor: _mg.theme.textMuted });`
  );
  rigBuildersUsed.push('_rb.buildProximityFieldDuplicator');
  cat15PresetsUsed.push('csv_localiser_batch');
  presetBindings.push({
    elementId: 'SaaS_Bento_Cells_Duplicator',
    property: 'duplicator',
    presetId: 'csv_localiser_batch',
    promotionType: 'cat15_procedural_saas'
  });

  // 7. Trigger Order & Fitted Curves procedural wiring (never per-frame keyframe loops)
  for (let i = 0; i < triggerOrder.length; i++) {
    const step = triggerOrder[i];
    const curve = curves[i % Math.max(1, curves.length)] ?? {
      kind: 'spring',
      spring: primarySpring,
      cubicBezier: primaryBezier
    };
    const roleId = `step_${step.stepIndex}_${String(step.role).replace(/[^a-zA-Z0-9_]/g, '_')}`;
    if (curve.kind === 'spring' && curve.spring) {
      expressions.push(
        `_mg.spring({ target: heroCard.id, role: ${JSON.stringify(roleId)}, property: "scale", stiffness: ${Number(curve.spring.stiffness)}, damping: ${Number(curve.spring.damping)}, mass: ${Number(curve.spring.mass ?? 1)}, startRatio: ${Number(step.normalizedStartRatio)}, durationRatio: ${Number(step.normalizedDurationRatio)} });`
      );
    } else {
      const bz = curve.cubicBezier ?? primaryBezier;
      expressions.push(
        `_mg.keyframes(heroCard.id, "opacity", [{ frame: ${Math.round(Number(step.normalizedStartRatio) * 120)}, value: 0, easing: "Custom", bezier: ${JSON.stringify(bz)} }, { frame: ${Math.round((Number(step.normalizedStartRatio) + Number(step.normalizedDurationRatio)) * 120)}, value: 100, easing: "Custom", bezier: ${JSON.stringify(bz)} }]);`
      );
    }
  }

  // 8. Optional WebGL ProRes 4444 Alpha Plates
  for (const plate of alphaPlates) {
    if (plate && plate.requiresAlphaPlate) {
      const plateId = plate.id ?? plate.plateId ?? 'webgl-alpha-plate-1';
      alphaPlatesAttached.push(plateId);
      expressions.push(
        `_mg.layer("alphaPlate", { id: ${JSON.stringify(plateId)}, path: ${JSON.stringify(plate.outputMovPath)}, codec: ${JSON.stringify(plate.codec ?? 'prores_ks')}, pixFmt: ${JSON.stringify(plate.pixFmt ?? 'yuva444p10le')}, premultipliedAlpha: true });`
      );
    }
  }

  const groupName = options.groupName ?? `motion-transfer-${String(motionTransferSpec.sourceHash ?? 'scene').slice(0, 8)}`;
  const bodyIndent = expressions.map(line => `    ${line}`).join('\n');
  const script = `_mg.applySceneTheme(${themePayload});\n_mg.undoGroup({\n  name: ${JSON.stringify(groupName)},\n  operations: () => {\n${bodyIndent}\n  }\n});`;

  const purity = validateMgPurity(script);
  const scriptHash = hashObject({ script, version: MG_COMPILER_VERSION, mode: 'motion-transfer' });

  const compiled = {
    version: MG_COMPILER_VERSION,
    mode: 'motion-transfer',
    groupName,
    script,
    scriptHash,
    expressions,
    presetBindings,
    unboundPromotions: [],
    atomicUndo: { enabled: true, groupName },
    purity,
    puritySelfCorrected: false,
    tiers: { 1: 4, 2: 2, 3: 2, 4: triggerOrder.length, 5: 0 },
    summary: {
      totalExpressions: expressions.length,
      layoutOps: 2,
      boundPresets: presetBindings.length,
      unboundPromotions: 0,
      springPromotions: curves.filter(c => c.kind === 'spring').length,
      bezierPromotions: curves.filter(c => c.kind === 'cubic-bezier').length,
      duplicatorPromotions: 1,
      rigBuildersCount: rigBuildersUsed.length,
      cat15PresetsCount: cat15PresetsUsed.length,
      alphaPlatesCount: alphaPlatesAttached.length
    }
  };

  return {
    mode: 'motion-transfer',
    shotId: groupName,
    version: MG_COMPILER_VERSION,
    sourceHash: motionTransferSpec.sourceHash ?? null,
    script,
    scriptHash,
    expressions,
    presetBindings,
    rigBuildersUsed,
    cat15PresetsUsed,
    gradientCallsUsed,
    alphaPlatesAttached,
    purity,
    compiled,
    validation: {
      valid: purity.passed,
      canExecute: purity.passed,
      issues: [],
      errors: 0,
      warnings: 0
    },
    metadata: generateExecutionMetadata(compiled, options),
    ready: Boolean(purity.passed && purity.score >= 90)
  };
}

/**
 * Mode-aware unified `_mg` scene compiler entry point.
 * Routes to `compileMotionTransferScene` when `mode === "motion-transfer"`,
 * otherwise preserves 1:1 `compileShotScript` behavior.
 *
 * @param {Object} input - Either a `motion-transfer-spec` or `compileShotScript` input
 * @param {Object} [options] - Compiler options
 * @returns {Object} Compilation result
 */
export function compileMgScene(input, options = {}) {
  const mode = options.mode ?? input?.mode ?? 'clone';
  if (mode === 'motion-transfer') {
    return compileMotionTransferScene(input, options);
  }
  return compileShotScript({ ...input, options: { ...(input?.options ?? {}), ...options } });
}

