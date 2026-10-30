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

import { WorkflowError, hashObject } from './core.mjs';
import {
  compileToMgDSL,
  compileDuplicatorToMgDSL,
  wrapAtomicUndo,
  PROMOTION_VERSION
} from './promotion.mjs';

export const MG_COMPILER_VERSION = '1.0.0';

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

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

/**
 * Compile a promotion analysis to executable _mg DSL script.
 *
 * @param {Object} params
 * @param {Object} params.analysis - Result from analyzeScenePromotion
 * @param {string} params.groupName - Name for the atomic undo group
 * @param {Object} [params.capabilities] - Adapter capabilities for validation
 * @param {boolean} [params.autoBindPresets=true] - Automatically bind matching presets
 * @returns {Object} Compiled script with metadata
 */
export function compilePromotionScript({ analysis, groupName, capabilities, autoBindPresets = true }) {
  if (!analysis || !analysis.elements) {
    fail('MG_COMPILE_INVALID', 'Valid promotion analysis is required.');
  }

  if (!groupName || typeof groupName !== 'string') {
    fail('MG_COMPILE_INVALID', 'groupName is required.');
  }

  const expressions = [];
  const presetBindings = [];
  const unboundPromotions = [];

  // Compile element promotions
  for (const element of analysis.elements) {
    for (const promotion of element.promotions) {
      if (promotion.promotion === 'none' || promotion.promotion === 'static') {
        continue;
      }

      // Auto-bind preset if requested
      let presetId = null;
      if (autoBindPresets) {
        presetId = findMatchingPreset(promotion);
        if (presetId && !isValidPreset(presetId)) {
          unboundPromotions.push({
            elementId: element.elementId,
            property: promotion.property,
            reason: 'preset_not_verified',
            attemptedPreset: presetId
          });
          presetId = null;
        }
      }

      const compiled = compileToMgDSL(promotion, { presetId });
      expressions.push(compiled);

      if (compiled.presetBinding) {
        presetBindings.push({
          elementId: element.elementId,
          property: promotion.property,
          presetId: compiled.presetBinding,
          promotionType: promotion.promotion
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
    const compiled = compileDuplicatorToMgDSL(group, { presetId: 'duplicator-stagger' });
    expressions.push(compiled);

    presetBindings.push({
      elementIds: group.elementIds,
      baseElementId: group.baseElementId,
      presetId: 'duplicator-stagger',
      promotionType: 'duplicator'
    });
  }

  // Wrap in atomic undo group
  const script = expressions.length > 0
    ? wrapAtomicUndo(expressions, groupName)
    : '// No procedural promotions to compile';

  // Generate script hash for caching
  const scriptHash = hashObject({
    groupName,
    expressionCount: expressions.length,
    presetBindings: presetBindings.length,
    script
  });

  return {
    version: MG_COMPILER_VERSION,
    promotionVersion: PROMOTION_VERSION,
    groupName,
    script,
    scriptHash,
    expressions: expressions.map(e => ({
      undoGroup: e.undoGroup,
      presetBinding: e.presetBinding,
      dslLength: e.dsl.length
    })),
    presetBindings,
    unboundPromotions,
    summary: {
      totalExpressions: expressions.length,
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
    autoBindPresets: options.autoBindPresets ?? true
  });

  const validation = validateCompiledScript(compiled, capabilities);
  const metadata = generateExecutionMetadata(compiled, options);

  return {
    shotId,
    version: MG_COMPILER_VERSION,
    compiled,
    validation,
    metadata,
    ready: validation.canExecute,
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
  report += `- **Bound presets:** ${compiled.summary.boundPresets}\n`;
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
