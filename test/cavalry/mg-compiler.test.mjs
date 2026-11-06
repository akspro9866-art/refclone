import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFIED_PRESETS,
  findMatchingPreset,
  isValidPreset,
  compilePromotionScript,
  validateCompiledScript,
  generateExecutionMetadata,
  compileShotScript,
  generateCompilationReport,
  MG_COMPILER_VERSION
} from '../../src/cavalry/mg-compiler.mjs';
import { PROMOTION_VERSION } from '../../src/cavalry/promotion.mjs';

describe('mg-compiler: verified presets', () => {
  it('contains spring presets', () => {
    assert.ok(VERIFIED_PRESETS['spring-oscillator']);
    assert.ok(VERIFIED_PRESETS['spring-bounce']);
    assert.ok(VERIFIED_PRESETS['spring-snappy']);
    assert.equal(VERIFIED_PRESETS['spring-oscillator'].type, 'behavior');
    assert.equal(VERIFIED_PRESETS['spring-oscillator'].category, 'spring');
  });

  it('contains bezier presets', () => {
    assert.ok(VERIFIED_PRESETS['bezier-smooth']);
    assert.ok(VERIFIED_PRESETS['bezier-snap']);
    assert.ok(VERIFIED_PRESETS['bezier-glide']);
    assert.equal(VERIFIED_PRESETS['bezier-smooth'].type, 'easing');
  });

  it('contains duplicator presets', () => {
    assert.ok(VERIFIED_PRESETS['duplicator-stagger']);
    assert.ok(VERIFIED_PRESETS['duplicator-cascade']);
    assert.ok(VERIFIED_PRESETS['duplicator-wave']);
    assert.equal(VERIFIED_PRESETS['duplicator-stagger'].type, 'duplicator');
  });

  it('all presets are marked verified', () => {
    for (const [id, preset] of Object.entries(VERIFIED_PRESETS)) {
      assert.equal(preset.verified, true, `Preset ${id} should be verified`);
      assert.equal(preset.id, id);
    }
  });
});

describe('mg-compiler: preset matching', () => {
  it('matches spring preset based on damping ratio', () => {
    const lowDamping = {
      promotion: 'damped_spring',
      parameters: { zeta: 0.2, omega0: 20 },
      metrics: { r2: 0.95 }
    };

    const highDamping = {
      promotion: 'damped_spring',
      parameters: { zeta: 0.8, omega0: 20 },
      metrics: { r2: 0.95 }
    };

    const mediumDamping = {
      promotion: 'damped_spring',
      parameters: { zeta: 0.5, omega0: 20 },
      metrics: { r2: 0.95 }
    };

    assert.equal(findMatchingPreset(lowDamping), 'spring-bounce');
    assert.equal(findMatchingPreset(highDamping), 'spring-snappy');
    assert.equal(findMatchingPreset(mediumDamping), 'spring-oscillator');
  });

  it('matches bezier preset based on control points', () => {
    const smooth = {
      promotion: 'cubic_bezier',
      parameters: { y1: 0.25, y2: 0.75 },
      metrics: { rmse: 0.01 }
    };

    const snap = {
      promotion: 'cubic_bezier',
      parameters: { y1: 0.6, y2: 0.9 },
      metrics: { rmse: 0.01 }
    };

    const glide = {
      promotion: 'cubic_bezier',
      parameters: { y1: 0.1, y2: 0.3 },
      metrics: { rmse: 0.01 }
    };

    assert.equal(findMatchingPreset(smooth), 'bezier-smooth');
    assert.equal(findMatchingPreset(snap), 'bezier-snap');
    assert.equal(findMatchingPreset(glide), 'bezier-glide');
  });

  it('returns null for unknown promotion types', () => {
    const unknown = { promotion: 'keyframes', parameters: {}, metrics: {} };
    assert.equal(findMatchingPreset(unknown), null);
  });
});

describe('mg-compiler: preset validation', () => {
  it('validates known presets', () => {
    assert.equal(isValidPreset('spring-oscillator'), true);
    assert.equal(isValidPreset('bezier-smooth'), true);
    assert.equal(isValidPreset('duplicator-stagger'), true);
  });

  it('rejects unknown presets', () => {
    assert.equal(isValidPreset('unknown-preset'), false);
    assert.equal(isValidPreset(null), false);
    assert.equal(isValidPreset(undefined), false);
  });
});

describe('mg-compiler: script compilation', () => {
  const mockAnalysis = {
    version: PROMOTION_VERSION,
    fps: { num: 24, den: 1 },
    elements: [
      {
        elementId: 'elem-1',
        promotions: [
          {
            elementId: 'elem-1',
            property: 'x',
            promotion: 'cubic_bezier',
            parameters: { y1: 0.25, y2: 0.75, startFrame: 0, endFrame: 20, startValue: 0, endValue: 100 },
            metrics: { rmse: 0.01, threshold: 0.015 }
          },
          {
            elementId: 'elem-1',
            property: 'scale',
            promotion: 'damped_spring',
            parameters: { zeta: 0.3, omega0: 20, startFrame: 0, endFrame: 40, startValue: 0, targetValue: 1 },
            metrics: { r2: 0.95, threshold: 0.92 }
          }
        ]
      }
    ],
    duplicatorGroups: [
      {
        elementIds: ['elem-1', 'elem-2', 'elem-3'],
        baseElementId: 'elem-1',
        lagFrames: 2,
        spatialOffset: { x: 0, y: 20 },
        correlation: 0.95
      }
    ],
    summary: {
      totalElements: 1,
      springPromotions: 1,
      bezierPromotions: 1,
      keyframeFallbacks: 0,
      duplicatorGroups: 1
    }
  };

  it('compiles promotion analysis to script', () => {
    const result = compilePromotionScript({
      analysis: mockAnalysis,
      groupName: 'test-group'
    });

    assert.equal(result.version, MG_COMPILER_VERSION);
    assert.equal(result.promotionVersion, PROMOTION_VERSION);
    assert.equal(result.groupName, 'test-group');
    assert.ok(result.script.length > 0);
    assert.ok(result.scriptHash.length === 64);
    assert.ok(result.summary.totalExpressions >= 3);
    assert.ok(result.atomicUndo.enabled);
  });

  it('auto-binds presets when enabled', () => {
    const result = compilePromotionScript({
      analysis: mockAnalysis,
      groupName: 'auto-bind',
      autoBindPresets: true
    });

    assert.ok(result.presetBindings.length > 0);
    const springBinding = result.presetBindings.find(b => b.promotionType === 'damped_spring');
    assert.ok(springBinding);
    assert.ok(isValidPreset(springBinding.presetId));
  });

  it('skips preset binding when disabled', () => {
    const result = compilePromotionScript({
      analysis: mockAnalysis,
      groupName: 'no-bind',
      autoBindPresets: false
    });

    // Should still have expressions but no preset bindings
    assert.ok(result.summary.totalExpressions > 0);
  });

  it('handles empty analysis', () => {
    const emptyAnalysis = {
      version: PROMOTION_VERSION,
      fps: { num: 24, den: 1 },
      elements: [],
      duplicatorGroups: [],
      summary: { totalElements: 0, springPromotions: 0, bezierPromotions: 0, keyframeFallbacks: 0, duplicatorGroups: 0 }
    };

    const result = compilePromotionScript({
      analysis: emptyAnalysis,
      groupName: 'empty'
    });

    assert.ok(result.script.includes('No procedural promotions'));
    assert.equal(result.summary.totalExpressions, 0);
  });

  it('rejects invalid analysis', () => {
    assert.throws(
      () => compilePromotionScript({ analysis: null, groupName: 'test' }),
      { code: 'MG_COMPILE_INVALID' }
    );

    assert.throws(
      () => compilePromotionScript({ analysis: mockAnalysis, groupName: null }),
      { code: 'MG_COMPILE_INVALID' }
    );
  });
});

describe('mg-compiler: script validation', () => {
  it('validates script against capabilities', () => {
    const compiled = {
      presetBindings: [
        { elementId: 'elem', property: 'scale', presetId: 'spring-oscillator', promotionType: 'damped_spring' }
      ],
      unboundPromotions: [],
      summary: { totalExpressions: 1 }
    };

    const capabilities = {
      operations: {
        spring: { supportStatus: 'runtime_verified' },
        behavior: { supportStatus: 'runtime_verified' }
      }
    };

    const result = validateCompiledScript(compiled, capabilities);

    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });

  it('warns about unverified spring capability', () => {
    const compiled = {
      presetBindings: [
        { elementId: 'elem', property: 'scale', presetId: 'spring-oscillator', promotionType: 'damped_spring' }
      ],
      unboundPromotions: [],
      summary: { totalExpressions: 1 }
    };

    const capabilities = {
      operations: {
        spring: { supportStatus: 'unverified' }
      }
    };

    const result = validateCompiledScript(compiled, capabilities);

    assert.ok(result.issues.some(i => i.code === 'SPRING_CAPABILITY_UNVERIFIED'));
  });

  it('reports unbound promotions', () => {
    const compiled = {
      presetBindings: [],
      unboundPromotions: [
        { elementId: 'elem', property: 'x', reason: 'no_matching_preset', promotionType: 'keyframes' }
      ],
      summary: { totalExpressions: 1 }
    };

    const result = validateCompiledScript(compiled, {});

    assert.ok(result.issues.some(i => i.code === 'UNBOUND_PROMOTIONS'));
  });
});

describe('mg-compiler: execution metadata', () => {
  it('generates execution metadata', () => {
    const compiled = {
      scriptHash: 'abc123',
      groupName: 'test-group',
      summary: { totalExpressions: 5 },
      presetBindings: [{ presetId: 'spring-oscillator' }],
      atomicUndo: { enabled: true }
    };

    const metadata = generateExecutionMetadata(compiled, { timeoutMs: 30000 });

    assert.equal(metadata.scriptHash, 'abc123');
    assert.equal(metadata.groupName, 'test-group');
    assert.equal(metadata.estimatedOperations, 5);
    assert.equal(metadata.requiresCheckpoint, true);
    assert.equal(metadata.atomicUndoEnabled, true);
    assert.equal(metadata.timeout, 30000);
    assert.ok(metadata.preconditions.length > 0);
  });

  it('uses default timeout', () => {
    const compiled = {
      scriptHash: 'abc',
      groupName: 'test',
      summary: { totalExpressions: 1 },
      presetBindings: [],
      atomicUndo: { enabled: true }
    };

    const metadata = generateExecutionMetadata(compiled);
    assert.equal(metadata.timeout, 60000);
  });
});

describe('mg-compiler: shot compilation', () => {
  it('compiles complete shot script', () => {
    const trackingAnalysis = {
      summary: { elementCount: 2, motionElementCount: 2, totalBeats: 3 }
    };

    const promotionAnalysis = {
      version: PROMOTION_VERSION,
      fps: { num: 24, den: 1 },
      elements: [
        {
          elementId: 'elem-1',
          promotions: [
            {
              elementId: 'elem-1',
              property: 'x',
              promotion: 'cubic_bezier',
              parameters: { y1: 0.25, y2: 0.75, startFrame: 0, endFrame: 20, startValue: 0, endValue: 100 },
              metrics: { rmse: 0.01, threshold: 0.015 }
            }
          ]
        }
      ],
      duplicatorGroups: [],
      summary: { totalElements: 1, springPromotions: 0, bezierPromotions: 1, keyframeFallbacks: 0, duplicatorGroups: 0 }
    };

    const result = compileShotScript({
      trackingAnalysis,
      promotionAnalysis,
      shotId: 'shot-1'
    });

    assert.equal(result.shotId, 'shot-1');
    assert.equal(result.version, MG_COMPILER_VERSION);
    assert.ok(result.compiled);
    assert.ok(result.validation);
    assert.ok(result.metadata);
    assert.ok(typeof result.ready === 'boolean');
    assert.ok(result.trackingSummary);
  });

  it('rejects missing shotId', () => {
    assert.throws(
      () => compileShotScript({ promotionAnalysis: {}, shotId: null }),
      { code: 'MG_COMPILE_INVALID' }
    );
  });

  it('rejects missing promotionAnalysis', () => {
    assert.throws(
      () => compileShotScript({ shotId: 'shot-1', promotionAnalysis: null }),
      { code: 'MG_COMPILE_INVALID' }
    );
  });
});

describe('mg-compiler: compilation report', () => {
  it('generates human-readable report', () => {
    const compilation = {
      shotId: 'shot-1',
      compiled: {
        scriptHash: 'abc123def456',
        summary: {
          totalExpressions: 3,
          boundPresets: 2,
          unboundPromotions: 1,
          springPromotions: 1,
          bezierPromotions: 1,
          duplicatorPromotions: 0
        },
        presetBindings: [
          { elementId: 'elem-1', property: 'scale', presetId: 'spring-oscillator', promotionType: 'damped_spring' },
          { elementId: 'elem-1', property: 'x', presetId: 'bezier-smooth', promotionType: 'cubic_bezier' }
        ],
        unboundPromotions: [
          { elementId: 'elem-2', property: 'y', reason: 'no_matching_preset' }
        ]
      },
      validation: {
        valid: true,
        issues: [],
        canExecute: true
      },
      metadata: {
        atomicUndoEnabled: true,
        requiresCheckpoint: true,
        timeout: 60000
      },
      ready: true
    };

    const report = generateCompilationReport(compilation);

    assert.ok(report.includes('# Procedural Compilation Report'));
    assert.ok(report.includes('shot-1'));
    assert.ok(report.includes('Ready for execution'));
    assert.ok(report.includes('spring-oscillator'));
    assert.ok(report.includes('bezier-smooth'));
    assert.ok(report.includes('elem-2'));
  });

  it('includes validation issues in report', () => {
    const compilation = {
      shotId: 'shot-issues',
      compiled: {
        scriptHash: 'abc',
        summary: { totalExpressions: 1, boundPresets: 1, unboundPromotions: 0, springPromotions: 1, bezierPromotions: 0, duplicatorPromotions: 0 },
        presetBindings: [{ elementId: 'elem', property: 'scale', presetId: 'spring-oscillator', promotionType: 'damped_spring' }],
        unboundPromotions: []
      },
      validation: {
        valid: true,
        issues: [{ severity: 'warning', code: 'SPRING_CAPABILITY_UNVERIFIED', message: 'Test warning', affectedCount: 1 }],
        canExecute: false
      },
      metadata: { atomicUndoEnabled: true, requiresCheckpoint: true, timeout: 60000 },
      ready: false
    };

    const report = generateCompilationReport(compilation);

    assert.ok(report.includes('Requires review'));
    assert.ok(report.includes('SPRING_CAPABILITY_UNVERIFIED'));
    assert.ok(report.includes('Test warning'));
  });
});
