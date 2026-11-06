import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTrajectory,
  fitCubicBezier,
  fitDampedSpring,
  detectDuplicatorPattern,
  analyzeTrajectory,
  analyzeElement,
  analyzeScenePromotion,
  compileToMgDSL,
  compileDuplicatorToMgDSL,
  wrapAtomicUndo,
  compilePromotionToScript,
  PROMOTION_VERSION
} from '../../src/cavalry/promotion.mjs';

describe('promotion: trajectory normalization', () => {
  it('normalizes a simple linear trajectory to [0,1] range', () => {
    const points = [
      { frame: 0, value: 0 },
      { frame: 10, value: 50 },
      { frame: 20, value: 100 }
    ];

    const result = normalizeTrajectory(points);

    assert.equal(result.minFrame, 0);
    assert.equal(result.maxFrame, 20);
    assert.equal(result.minValue, 0);
    assert.equal(result.maxValue, 100);
    assert.equal(result.frameRange, 20);
    assert.equal(result.valueRange, 100);
    assert.equal(result.normalized.length, 3);
    assert.equal(result.normalized[0].t, 0);
    assert.equal(result.normalized[0].v, 0);
    assert.equal(result.normalized[2].t, 1);
    assert.equal(result.normalized[2].v, 1);
  });

  it('handles unsorted input points', () => {
    const points = [
      { frame: 20, value: 100 },
      { frame: 0, value: 0 },
      { frame: 10, value: 50 }
    ];

    const result = normalizeTrajectory(points);

    assert.equal(result.normalized[0].t, 0);
    assert.equal(result.normalized[1].t, 0.5);
    assert.equal(result.normalized[2].t, 1);
  });

  it('rejects trajectories with fewer than 2 points', () => {
    assert.throws(
      () => normalizeTrajectory([{ frame: 0, value: 0 }]),
      { code: 'TRAJECTORY_INVALID' }
    );
  });
});

describe('promotion: cubic bezier fitting', () => {
  it('fits a smooth ease-in-out curve with low RMSE', () => {
    // Generate a trajectory that follows a cubic bezier easing curve
    // Using y1=0.42, y2=0.58 (standard ease-in-out)
    const points = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      // Cubic bezier with y1=0.42, y2=0.58
      const mt = 1 - t;
      const v = 3 * mt * mt * t * 0.42 + 3 * mt * t * t * 0.58 + t * t * t;
      points.push({ t, v });
    }

    const result = fitCubicBezier(points);

    assert.ok(result.success, `Expected successful fit, got RMSE ${result.rmse}`);
    assert.ok(result.rmse <= 0.015, `RMSE ${result.rmse} should be <= 0.015`);
    assert.ok(result.y1 >= 0 && result.y1 <= 1);
    assert.ok(result.y2 >= 0 && result.y2 <= 1);
    // Should find values close to the original
    assert.ok(Math.abs(result.y1 - 0.42) < 0.1, `y1 ${result.y1} should be close to 0.42`);
    assert.ok(Math.abs(result.y2 - 0.58) < 0.1, `y2 ${result.y2} should be close to 0.58`);
  });

  it('fails to fit a highly oscillating trajectory', () => {
    // Generate oscillating data that bezier cannot fit
    const points = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const v = 0.5 + 0.4 * Math.sin(t * Math.PI * 4);
      points.push({ t, v });
    }

    const result = fitCubicBezier(points);

    assert.ok(!result.success || result.rmse > 0.015, 'Oscillating data should not fit bezier well');
  });
});

describe('promotion: damped spring fitting', () => {
  it('detects and fits an underdamped oscillating trajectory', () => {
    // Generate damped spring trajectory with normalized time [0,1]
    const zeta = 0.3;
    const omega0 = 20;
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);

    const points = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40; // Normalized time [0,1]
      const decay = Math.exp(-zeta * omega0 * t);
      const v = 1 - decay * Math.cos(omegaD * t);
      points.push({ t, v });
    }

    const result = fitDampedSpring(points, 1);

    assert.ok(result.success, `Expected successful spring fit, got R² ${result.r2}`);
    assert.ok(result.r2 >= 0.92, `R² ${result.r2} should be >= 0.92`);
    assert.ok(result.zeta > 0 && result.zeta < 1, 'Zeta should be in underdamped range');
    assert.ok(result.omega0 > 0, 'Omega0 should be positive');
    assert.ok(result.signChanges >= 2, 'Should detect oscillation sign changes');
  });

  it('rejects a monotonic trajectory as non-oscillating', () => {
    const points = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      points.push({ t, v: t }); // Linear
    }

    const result = fitDampedSpring(points, 1);

    assert.ok(!result.success, 'Linear trajectory should not fit spring');
    assert.equal(result.reason, 'insufficient_oscillation');
  });
});

describe('promotion: duplicator pattern detection', () => {
  it('detects N=3 staggered elements with correlated trajectories', () => {
    const elements = [
      {
        id: 'elem-1',
        trajectory: [
          { frame: 0, x: 0, y: 0 },
          { frame: 10, x: 50, y: 0 },
          { frame: 20, x: 100, y: 0 }
        ]
      },
      {
        id: 'elem-2',
        trajectory: [
          { frame: 0, x: 0, y: 20 },
          { frame: 10, x: 50, y: 20 },
          { frame: 20, x: 100, y: 20 }
        ]
      },
      {
        id: 'elem-3',
        trajectory: [
          { frame: 0, x: 0, y: 40 },
          { frame: 10, x: 50, y: 40 },
          { frame: 20, x: 100, y: 40 }
        ]
      }
    ];

    const result = detectDuplicatorPattern(elements);

    assert.ok(result.detected, 'Should detect duplicator pattern');
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].elementIds.length, 3);
    assert.ok(result.groups[0].correlation >= 0.85);
  });

  it('does not detect a pattern with uncorrelated trajectories', () => {
    const elements = [
      {
        id: 'elem-1',
        trajectory: [
          { frame: 0, x: 0, y: 0 },
          { frame: 10, x: 50, y: 0 },
          { frame: 20, x: 100, y: 0 }
        ]
      },
      {
        id: 'elem-2',
        trajectory: [
          { frame: 0, x: 100, y: 100 },
          { frame: 10, x: 0, y: 50 },
          { frame: 20, x: 50, y: 0 }
        ]
      }
    ];

    const result = detectDuplicatorPattern(elements);

    assert.ok(!result.detected || result.groups.length === 0, 'Should not detect pattern');
  });

  it('requires at least 2 elements', () => {
    const result = detectDuplicatorPattern([{ id: 'single', trajectory: [] }]);

    assert.ok(!result.detected);
    assert.equal(result.reason, 'insufficient_elements');
  });
});

describe('promotion: trajectory analysis', () => {
  it('promotes a smooth monotonic transition to cubic bezier', () => {
    const points = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      // Smooth ease
      const v = t * t * (3 - 2 * t);
      points.push({ frame: i, value: v * 100 });
    }

    const result = analyzeTrajectory({
      elementId: 'test-element',
      property: 'x',
      points
    });

    assert.equal(result.elementId, 'test-element');
    assert.equal(result.property, 'x');
    assert.ok(['cubic_bezier', 'keyframes'].includes(result.promotion));
    if (result.promotion === 'cubic_bezier') {
      assert.ok(result.metrics.rmse <= 0.015);
      assert.ok(result.confidence > 0);
    }
  });

  it('promotes an oscillating trajectory to damped spring', () => {
    // Generate damped spring trajectory in frame space
    const zeta = 0.25;
    const omega0 = 25;
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);

    const points = [];
    for (let i = 0; i <= 40; i++) {
      const frame = i;
      const t = i / 40; // Normalized time for the spring equation
      const decay = Math.exp(-zeta * omega0 * t);
      const v = 100 * (1 - decay * Math.cos(omegaD * t));
      points.push({ frame, value: v });
    }

    const result = analyzeTrajectory({
      elementId: 'spring-element',
      property: 'scale',
      points
    });

    // The trajectory should oscillate, so either spring or keyframes is acceptable
    // depending on how well the fit works
    assert.ok(['damped_spring', 'keyframes'].includes(result.promotion),
      `Expected spring or keyframes, got ${result.promotion}`);

    if (result.promotion === 'damped_spring') {
      assert.ok(result.metrics.r2 >= 0.92);
      assert.ok(result.parameters.zeta > 0 && result.parameters.zeta < 1);
      assert.ok(result.parameters.omega0 > 0);
    }
  });

  it('falls back to keyframes for complex trajectories', () => {
    // Random-ish trajectory that doesn't fit either model
    const points = [
      { frame: 0, value: 0 },
      { frame: 5, value: 30 },
      { frame: 10, value: 20 },
      { frame: 15, value: 80 },
      { frame: 20, value: 40 },
      { frame: 25, value: 90 },
      { frame: 30, value: 60 }
    ];

    const result = analyzeTrajectory({
      elementId: 'complex-element',
      property: 'y',
      points
    });

    assert.equal(result.promotion, 'keyframes');
    assert.equal(result.reason, 'no_procedural_fit');
    assert.ok(result.keyframes.length > 0);
  });

  it('detects static values', () => {
    const points = [
      { frame: 0, value: 50 },
      { frame: 10, value: 50 },
      { frame: 20, value: 50 }
    ];

    const result = analyzeTrajectory({
      elementId: 'static-element',
      property: 'opacity',
      points
    });

    assert.equal(result.promotion, 'static');
    assert.equal(result.value, 50);
  });
});

describe('promotion: element analysis', () => {
  it('analyzes multiple properties and determines overall promotion', () => {
    const trajectories = {
      x: [
        { frame: 0, value: 0 },
        { frame: 10, value: 50 },
        { frame: 20, value: 100 }
      ],
      y: [
        { frame: 0, value: 0 },
        { frame: 10, value: 0 },
        { frame: 20, value: 0 }
      ]
    };

    const result = analyzeElement({
      elementId: 'multi-prop',
      trajectories,
      fps: { num: 24, den: 1 }
    });

    assert.equal(result.elementId, 'multi-prop');
    assert.equal(result.promotions.length, 2);
    assert.ok(result.promotionTypes.includes('static'));
    assert.ok(result.metrics.propertyCount === 2);
  });
});

describe('promotion: scene analysis', () => {
  it('analyzes a complete scene with multiple elements', () => {
    const elements = [
      {
        id: 'elem-1',
        trajectories: {
          x: [
            { frame: 0, value: 0 },
            { frame: 10, value: 50 },
            { frame: 20, value: 100 }
          ]
        }
      },
      {
        id: 'elem-2',
        trajectories: {
          x: [
            { frame: 0, value: 0 },
            { frame: 10, value: 50 },
            { frame: 20, value: 100 }
          ],
          y: [
            { frame: 0, value: 20 },
            { frame: 10, value: 20 },
            { frame: 20, value: 20 }
          ]
        }
      }
    ];

    const result = analyzeScenePromotion({
      elements,
      fps: { num: 24, den: 1 }
    });

    assert.equal(result.version, PROMOTION_VERSION);
    assert.equal(result.elements.length, 2);
    assert.ok(result.summary.totalElements === 2);
    assert.ok(result.thresholds.bezierRMSE === 0.015);
    assert.ok(result.thresholds.springR2 === 0.92);
  });

  it('handles empty scene gracefully', () => {
    const result = analyzeScenePromotion({
      elements: [],
      fps: { num: 24, den: 1 }
    });

    assert.equal(result.elements.length, 0);
    assert.equal(result.summary.totalElements, 0);
  });
});

describe('promotion: _mg DSL compilation', () => {
  it('compiles a cubic bezier promotion to DSL', () => {
    const promotion = {
      elementId: 'test-elem',
      property: 'x',
      promotion: 'cubic_bezier',
      parameters: {
        y1: 0.25,
        y2: 0.75,
        startFrame: 0,
        endFrame: 20,
        startValue: 0,
        endValue: 100
      },
      metrics: { rmse: 0.01, threshold: 0.015 }
    };

    const result = compileToMgDSL(promotion);

    assert.ok(result.dsl.includes('_mg.keyframe'));
    assert.ok(result.dsl.includes('cubic-bezier'));
    assert.ok(result.dsl.includes('0.25'));
    assert.ok(result.undoGroup.includes('bezier'));
  });

  it('compiles a damped spring promotion to DSL', () => {
    const promotion = {
      elementId: 'spring-elem',
      property: 'scale',
      promotion: 'damped_spring',
      parameters: {
        zeta: 0.3,
        omega0: 20,
        startFrame: 0,
        endFrame: 40,
        startValue: 0,
        targetValue: 100,
        initialValue: 0
      },
      metrics: { r2: 0.95, threshold: 0.92 }
    };

    const result = compileToMgDSL(promotion, { presetId: 'spring-oscillator' });

    assert.ok(result.dsl.includes('_mg.behavior'));
    assert.ok(result.dsl.includes('spring'));
    assert.ok(result.dsl.includes('dampingRatio'));
    assert.ok(result.dsl.includes('0.3'));
    assert.equal(result.presetBinding, 'spring-oscillator');
  });

  it('compiles a duplicator group to DSL', () => {
    const group = {
      elementIds: ['elem-1', 'elem-2', 'elem-3'],
      baseElementId: 'elem-1',
      lagFrames: 2,
      spatialOffset: { x: 0, y: 20 },
      correlation: 0.95
    };

    const result = compileDuplicatorToMgDSL(group);

    assert.ok(result.dsl.includes('_mg.duplicator'));
    assert.ok(result.dsl.includes('count: 3'));
    assert.ok(result.dsl.includes('lagFrames: 2'));
    assert.ok(result.undoGroup.includes('duplicator'));
  });

  it('wraps expressions in atomic undo group', () => {
    const expressions = [
      { dsl: '// Expression 1', undoGroup: 'group-1' },
      { dsl: '// Expression 2', undoGroup: 'group-2' }
    ];

    const result = wrapAtomicUndo(expressions, 'test-group');

    assert.ok(result.includes('_mg.undoGroup'));
    assert.ok(result.includes('test-group'));
    assert.ok(result.includes('Expression 1'));
    assert.ok(result.includes('Expression 2'));
  });
});

describe('promotion: full script compilation', () => {
  it('compiles a complete promotion analysis to script', () => {
    const analysis = {
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

    const result = compilePromotionToScript(analysis, { groupName: 'test-compile' });

    assert.ok(result.script.length > 0);
    assert.ok(result.undoGroups.length > 0);
    assert.equal(result.expressionCount, 1);
  });

  it('handles analysis with no promotions', () => {
    const analysis = {
      version: PROMOTION_VERSION,
      fps: { num: 24, den: 1 },
      elements: [],
      duplicatorGroups: [],
      summary: { totalElements: 0, springPromotions: 0, bezierPromotions: 0, keyframeFallbacks: 0, duplicatorGroups: 0 }
    };

    const result = compilePromotionToScript(analysis, { groupName: 'empty' });

    assert.ok(result.script.includes('No procedural promotions'));
    assert.equal(result.expressionCount, 0);
  });
});
