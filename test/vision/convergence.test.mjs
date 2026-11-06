import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  CONVERGENCE_VERSION,
  CONVERGENCE_TIERS,
  CONVERGENCE_DEFAULTS,
  loadConvergenceConfig,
  perceptualScore,
  dampCorrectionDeltas,
  createConvergenceTracker
} from '../../src/vision/convergence.mjs';
import { runClosedLoopProceduralPipeline, loadProceduralConfig } from '../../src/procedural/procedural-pipeline.mjs';

const solid = (width, height, color) => {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color[0];
    png.data[index + 1] = color[1];
    png.data[index + 2] = color[2];
    png.data[index + 3] = 255;
  }
  return png;
};

const observations = [
  { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
  { frame: 10, measurement: { foreground: { bbox: { x: 0.4, y: 0.1, width: 0.2, height: 0.2 } } } },
  { frame: 20, measurement: { foreground: { bbox: { x: 0.7, y: 0.1, width: 0.2, height: 0.2 } } } }
];

/** One comparison whose silhouette agreement is controlled by the box gap. */
const comparison = gap => [{
  frame: 0,
  reference: solid(64, 64, [120, 120, 120]),
  rendered: solid(64, 64, [120, 120, 120]),
  referenceBox: { x: 8, y: 8, width: 40, height: 40 },
  renderedBox: { x: 8 + gap, y: 8 + gap, width: 40, height: 40 }
}];

describe('convergence: config', () => {
  it('documents three ordered tiers and ships defaults for each', () => {
    assert.deepEqual(CONVERGENCE_TIERS.map(tier => tier.name), ['geometry', 'timing', 'appearance']);
    assert.deepEqual(CONVERGENCE_TIERS.map(tier => tier.channels), [['position', 'scale'], ['timing'], ['opacity']]);
    assert.deepEqual(
      CONVERGENCE_TIERS.map(tier => CONVERGENCE_DEFAULTS.tierDamping[tier.tier]),
      [0.75, 0.5, 0.35],
      'correction authority must strictly decrease down the hierarchy'
    );
  });

  it('normalizes a missing section to the documented defaults', () => {
    const config = loadConvergenceConfig({});
    assert.equal(config.version, CONVERGENCE_VERSION);
    assert.equal(config.minImprovementRatio, 0.015);
    assert.equal(config.plateauPasses, 2);
    assert.equal(config.bestSnapshot, true);
    assert.deepEqual(config.tierDamping, CONVERGENCE_DEFAULTS.tierDamping);
  });

  it('reads a configured section and accepts tiers keyed by number, string or name', () => {
    const config = loadConvergenceConfig({
      tierDamping: { 1: 1, '2': 0.25, appearance: 0.9 },
      minImprovementRatio: 0.05,
      plateauPasses: 3,
      bestSnapshot: false
    });
    assert.deepEqual(config.tierDamping, { 1: 1, 2: 0.25, 3: 0.9 });
    assert.equal(config.minImprovementRatio, 0.05);
    assert.equal(config.plateauPasses, 3);
    assert.equal(config.bestSnapshot, false);
  });

  it('clamps fractions into a survivable range and rejects a meaningless weighting', () => {
    const clamped = loadConvergenceConfig({ tierDamping: { 1: 5 }, minImprovementRatio: -1, plateauPasses: 0.4 });
    assert.equal(clamped.tierDamping[1], 1);
    assert.equal(clamped.minImprovementRatio, 0);
    assert.equal(clamped.plateauPasses, 1);

    assert.throws(
      () => loadConvergenceConfig({ scoreWeights: { iou: 0, ssim: 0, centroid: 0, timing: 0 } }),
      { name: 'WorkflowError', code: 'PROCEDURAL_INVALID' }
    );
  });

  it('is reachable through the procedural config the pipeline loads', () => {
    const procedural = loadProceduralConfig({
      perceptualDiff: { convergence: { minImprovementRatio: 0.02, tierDamping: { timing: 0.2 } } }
    });
    assert.equal(procedural.convergence.version, CONVERGENCE_VERSION);
    assert.equal(procedural.convergence.minImprovementRatio, 0.02);
    assert.equal(procedural.convergence.tierDamping['2'], 0.2);
    assert.deepEqual(loadProceduralConfig({}).convergence.tierDamping, CONVERGENCE_DEFAULTS.tierDamping);
  });
});

describe('convergence: perceptual score', () => {
  const config = loadConvergenceConfig({});

  it('returns no measurement when there is nothing to score', () => {
    assert.deepEqual(perceptualScore(null, config), { measured: false, score: null, channels: [], overallPass: null });
    const artifact = { overallPass: false };
    assert.equal(perceptualScore(artifact, config).measured, false);
    assert.equal(perceptualScore(artifact, config).overallPass, false);
  });

  it('scores 1 exactly at the thresholds and below 1 as they are missed', () => {
    const atThreshold = perceptualScore({
      overallPass: true,
      metrics: { averageIoU: 0.9, averageCentroidOffset: 0.02, averageSSIM: 0.88, timingDelta: 1 },
      thresholds: { iou: 0.9, centroidOffset: 0.02, ssim: 0.88, timingDelta: 1 }
    }, config);
    assert.equal(atThreshold.score, 1);
    assert.equal(atThreshold.measured, true);

    const missed = perceptualScore({
      overallPass: false,
      metrics: { averageIoU: 0.45, averageCentroidOffset: 0.04, averageSSIM: 0.44, timingDelta: 2 },
      thresholds: { iou: 0.9, centroidOffset: 0.02, ssim: 0.88, timingDelta: 1 }
    }, config);
    assert.ok(missed.score < 1 && missed.score > 0, `expected a partial score, got ${missed.score}`);
    // Each channel is half satisfied, so the weighted mean is half satisfied.
    assert.equal(missed.score, 0.5);
    assert.deepEqual(missed.channels.map(channel => channel.name), ['iou', 'ssim', 'centroid', 'timing']);
  });

  it('caps a channel that clears its threshold instead of paying for another failure', () => {
    const skewed = perceptualScore({
      overallPass: false,
      metrics: { averageIoU: 1, averageCentroidOffset: 0, averageSSIM: 1, timingDelta: 50 },
      thresholds: { iou: 0.9, centroidOffset: 0.02, ssim: 0.88, timingDelta: 1 }
    }, config);
    assert.equal(skewed.channels.find(channel => channel.name === 'iou').satisfaction, 1);
    assert.ok(skewed.score < 0.9, `one failed channel must not be hidden: ${skewed.score}`);
  });

  it('treats non-finite metrics as the worst case, not as a missing channel', () => {
    const broken = perceptualScore({
      overallPass: false,
      metrics: { averageIoU: NaN, averageCentroidOffset: Infinity, averageSSIM: undefined, timingDelta: 0 },
      thresholds: { iou: 0.9, centroidOffset: 0.02, ssim: 0.88, timingDelta: 1 }
    }, config);
    assert.equal(broken.channels.find(channel => channel.name === 'iou').satisfaction, 0);
    assert.equal(broken.channels.find(channel => channel.name === 'centroid').satisfaction, 0);
    assert.equal(broken.channels.find(channel => channel.name === 'timing').satisfaction, 1);
  });
});

describe('convergence: tier damping', () => {
  const config = loadConvergenceConfig({});
  const raw = { position: { x: 2, y: -1 }, scale: { x: 1.2, y: 0.8 }, timing: 4, opacity: 0.5 };

  it('keeps each tier its documented fraction of the correction', () => {
    const { damped, tiers, factor } = dampCorrectionDeltas(raw, config, { consecutiveRegressions: 0 });
    assert.equal(factor, 1);
    assert.deepEqual(damped.position, { x: 1.5, y: -0.75 });
    assert.deepEqual(damped.scale, { x: 1.15, y: 0.85 }, 'scale damping must be relative to 1, not to 0');
    assert.equal(damped.timing, 2);
    assert.equal(damped.opacity, 0.175);
    assert.deepEqual(tiers.map(tier => tier.effectiveDamping), [0.75, 0.5, 0.35]);
    assert.deepEqual(tiers.map(tier => tier.moved), [true, true, true]);
  });

  it('reports the magnitude each tier was asked to move', () => {
    const { tiers } = dampCorrectionDeltas(raw, config, {});
    assert.equal(tiers[0].magnitude, 3.4);
    assert.equal(tiers[1].magnitude, 4);
    assert.equal(tiers[2].magnitude, 0.5);
  });

  it('decays every tier while the score keeps regressing, down to a floor', () => {
    const once = dampCorrectionDeltas(raw, config, { consecutiveRegressions: 1 });
    assert.equal(once.factor, 0.5);
    assert.equal(once.damped.timing, 1);

    const three = dampCorrectionDeltas(raw, config, { consecutiveRegressions: 3 });
    assert.equal(three.factor, 0.15, '0.5^3 is under the floor, so the floor wins');
    assert.equal(three.damped.opacity, 0.5 * 0.35 * 0.15);
  });

  it('survives an empty or malformed aggregate', () => {
    const { damped, tiers } = dampCorrectionDeltas({}, config, { consecutiveRegressions: -2 });
    assert.deepEqual(damped, { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, timing: 0, opacity: 0 });
    assert.equal(tiers.every(tier => tier.moved), false);
    assert.equal(dampCorrectionDeltas(null, config, {}).damped.timing, 0);
  });
});

describe('convergence: tracker history, plateau and snapshot', () => {
  const config = loadConvergenceConfig({});
  const scored = score => ({ measured: true, score, overallPass: false, channels: [] });

  it('needs a normalized config', () => {
    assert.throws(() => createConvergenceTracker({}), { name: 'WorkflowError', code: 'PROCEDURAL_INVALID' });
  });

  it('computes relative improvement against the previous round', () => {
    const tracker = createConvergenceTracker(config);
    tracker.observe({ iteration: 0, score: scored(0.5), measured: true });
    const second = tracker.observe({ iteration: 1, score: scored(0.6), measured: true });
    assert.equal(second.improvementRatio, 0.2);
    assert.equal(second.regression, false);
    assert.equal(second.isBest, true);
    const third = tracker.observe({ iteration: 2, score: scored(0.54), measured: true });
    assert.equal(third.improvementRatio, -0.1);
    assert.equal(third.regression, true);
    assert.equal(tracker.consecutiveRegressions, 1);
  });

  it('declares a plateau only after enough consecutive near-idle measured passes', () => {
    const tracker = createConvergenceTracker(config);
    tracker.observe({ iteration: 0, score: scored(0.50), measured: true });
    tracker.observe({ iteration: 1, score: scored(0.5025), measured: true });
    assert.equal(tracker.plateau.detected, false, 'one near-idle pass is not a plateau');
    const third = tracker.observe({ iteration: 2, score: scored(0.5040), measured: true });
    assert.equal(third.plateau, true);
    assert.match(tracker.plateau.reason, /less than 1.5% for 2 consecutive measured passes/);
  });

  it('resets the streak when a round actually moves', () => {
    const tracker = createConvergenceTracker(config);
    tracker.observe({ iteration: 0, score: scored(0.5), measured: true });
    tracker.observe({ iteration: 1, score: scored(0.501), measured: true });
    tracker.observe({ iteration: 2, score: scored(0.62), measured: true });
    tracker.observe({ iteration: 3, score: scored(0.621), measured: true });
    assert.equal(tracker.plateau.detected, false);
    assert.equal(tracker.plateau.smallImprovementStreak, 1);
  });

  it('does not call a reused measurement a stall', () => {
    const tracker = createConvergenceTracker(config);
    tracker.observe({ iteration: 0, score: scored(0.5), measured: true });
    for (let i = 1; i <= 3; i += 1) {
      tracker.observe({ iteration: i, score: scored(0.5), measured: false });
    }
    assert.equal(tracker.plateau.detected, false, 'the loop cannot learn from a comparison it did not re-render');
  });

  it('keeps the first of equal scores as the best snapshot', () => {
    const tracker = createConvergenceTracker(config);
    tracker.observe({ iteration: 0, score: scored(0.7), measured: true, promotion: { tag: 'a' } });
    tracker.observe({ iteration: 1, score: scored(0.7), measured: true, promotion: { tag: 'b' } });
    assert.equal(tracker.best.iteration, 0);
    assert.deepEqual(tracker.best.promotion, { tag: 'a' });
  });

  it('rolls back to the snapshot only when the last round is genuinely worse', () => {
    const tracker = createConvergenceTracker(config);
    tracker.observe({ iteration: 0, score: scored(0.4), measured: true, promotion: { tag: 'baseline' } });
    tracker.observe({ iteration: 1, score: scored(0.8), measured: true, promotion: { tag: 'best' } });
    tracker.observe({ iteration: 2, score: scored(0.5), measured: true, promotion: { tag: 'regressed' } });

    const rollback = tracker.rollback(0.5);
    assert.equal(rollback.rolledBackTo, 1);
    assert.deepEqual(rollback.snapshot.promotion, { tag: 'best' });
    assert.match(rollback.reason, /iteration 2 scored 0.5000 against the best 0.8000 at iteration 1/);
    assert.equal(tracker.rollback(0.8).rolledBackTo, null, 'an equal final score is not a regression');
    assert.equal(tracker.rollback(null).rolledBackTo, null, 'an unmeasured final round cannot be compared');
  });

  it('honours bestSnapshot: false and reports the config it used', () => {
    const off = createConvergenceTracker(loadConvergenceConfig({ bestSnapshot: false }));
    off.observe({ iteration: 0, score: scored(0.4), measured: true, promotion: { tag: 'a' } });
    off.observe({ iteration: 1, score: scored(0.9), measured: true, promotion: { tag: 'b' } });
    off.observe({ iteration: 2, score: scored(0.2), measured: true, promotion: { tag: 'c' } });
    const rollback = off.rollback(0.2);
    assert.equal(rollback.rolledBackTo, null);
    assert.equal(rollback.reason, 'bestSnapshot disabled');
    assert.equal(rollback.snapshot, null);
    assert.equal(off.summary().config.bestSnapshot, false);
    assert.deepEqual(off.summary().tiers.map(tier => tier.channels), CONVERGENCE_TIERS.map(tier => [...tier.channels]));
    assert.equal(off.summary().history.length, 3);
  });

  it('records an unmeasured round without inventing a score', () => {
    const tracker = createConvergenceTracker(config);
    const first = tracker.observe({ iteration: 0, score: { measured: false, score: null, channels: [] }, measured: false });
    assert.equal(first.improvementRatio, null);
    assert.equal(tracker.summary().best, null);
    assert.equal(tracker.rollback(null).rolledBackTo, null);
  });
});

describe('convergence: closed-loop integration', () => {
  // A flat rendered trajectory never reaches a peak velocity, so the timing
  // channel reports a large but *finite* delta: tier 2 then has a real
  // correction to damp instead of an unmeasured one.
  const flatRenderedTrajectory = [
    { frame: 0, value: 0.1 },
    { frame: 10, value: 0.1 },
    { frame: 20, value: 0.1 }
  ];

  const runLoop = (overrides = {}) => runClosedLoopProceduralPipeline({
    shotId: 'shot-convergence',
    observations,
    metadata: { video: { width: 64, height: 64, fps: 24 } },
    capabilities: {},
    config: {},
    frameComparisons: comparison(24),
    maxIterations: 2,
    renderEvaluator: async () => ({
      frameComparisons: comparison(24),
      renderedTrajectory: flatRenderedTrajectory
    }),
    ...overrides
  });

  it('damps each tier by its documented fraction and decays it while the score regresses', async () => {
    const result = await runLoop();
    assert.equal(result.iterationsRun, 2);

    // Round 1 corrects geometry only: the baseline had no rendered trajectory,
    // so timing was unmeasured and must not be turned into a correction.
    const first = result.iterations[1];
    assert.equal(first.damping.factor, 1);
    assert.deepEqual(first.damping.tiers.map(tier => tier.effectiveDamping), [0.75, 0.5, 0.35]);
    assert.deepEqual(first.damping.tiers.map(tier => tier.moved), [true, false, false]);
    assert.equal(first.rawDeltas.position.x, -12, 'the measured box gap must reach the geometry correction');
    assert.equal(first.appliedDeltas.position.x, first.rawDeltas.position.x * 0.75);
    assert.equal(first.appliedDeltas.position.y, first.rawDeltas.position.y * 0.75);
    assert.equal(first.appliedDeltas.scale.x, 1 + (first.rawDeltas.scale.x - 1) * 0.75);
    assert.equal(first.appliedDeltas.timing, 0);

    // Round 1 measured a real timing error, and its score went backwards, so
    // round 2 halves every tier.
    const second = result.iterations[2];
    assert.equal(second.damping.factor, 0.5);
    assert.deepEqual(second.damping.tiers.map(tier => tier.effectiveDamping), [0.375, 0.25, 0.175]);
    assert.deepEqual(second.damping.tiers.map(tier => tier.moved), [true, true, false]);
    assert.equal(second.rawDeltas.timing, -5);
    assert.equal(second.appliedDeltas.timing, second.rawDeltas.timing * 0.25);
    assert.equal(second.appliedDeltas.position.x, second.rawDeltas.position.x * 0.375);
    assert.ok(
      Math.abs(second.appliedDeltas.position.x) < Math.abs(first.appliedDeltas.position.x),
      'the same raw error must be corrected less once the score has regressed'
    );

    assert.equal(
      second.damping.tiers[2].magnitude, 0,
      'the fixture renders identical colours over misaligned boxes, so tier 3 has nothing to damp'
    );

    assert.equal(result.convergence.history[1].measured, true);
    assert.equal(result.convergence.history[1].regression, true);
    assert.equal(result.convergence.stopReason, 'max_iterations');
  });

  it('damps a tier-3 opacity correction once geometry is aligned', async () => {
    // Same silhouette in both frames; the rendered foreground is dimmer, which
    // is the only alpha evidence a composited frame carries.
    const box = { x: 16, y: 16, width: 32, height: 32 };
    const background = [20, 20, 20];
    const scene = foreground => {
      const png = solid(64, 64, background);
      for (let y = box.y; y < box.y + box.height; y++) {
        for (let x = box.x; x < box.x + box.width; x++) {
          const src = (y * 64 + x) * 4;
          png.data[src] = foreground;
          png.data[src + 1] = foreground;
          png.data[src + 2] = foreground;
        }
      }
      return png;
    };
    const lumaComparison = [{
      frame: 0,
      reference: scene(220),
      rendered: scene(120),
      referenceBox: box,
      renderedBox: box
    }];

    const result = await runLoop({
      frameComparisons: lumaComparison,
      renderEvaluator: async () => ({ frameComparisons: lumaComparison })
    });

    const first = result.iterations[1];
    const appearance = first.damping.tiers[2];
    assert.equal(first.damping.factor, 1);
    assert.equal(appearance.tier, 3);
    assert.equal(appearance.name, 'appearance');
    assert.equal(appearance.moved, true, 'the contrast gap must reach the tier-3 channel');
    assert.ok(Math.abs(first.rawDeltas.opacity - 50 / 255) < 1e-12,
      `expected half the 100/255 contrast gap, read ${first.rawDeltas.opacity}`);
    assert.ok(Number.isFinite(appearance.magnitude) && appearance.magnitude > 0);
    assert.ok(Math.abs(first.appliedDeltas.opacity - (50 / 255) * 0.35) < 1e-12,
      'tier 3 keeps its documented 0.35 fraction');
    assert.equal(appearance.effectiveDamping, 0.35);
    assert.equal(first.rawDeltas.position.x, 0, 'aligned boxes need no geometry correction');
    assert.equal(first.rawDeltas.scale.x, 1);
    assert.deepEqual(first.damping.tiers.map(tier => tier.moved), [false, false, true]);
  });

  it('stops early once two consecutive measured passes stop moving the score', async () => {
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-plateau',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: { perceptualDiff: { convergence: { minImprovementRatio: 0.015, plateauPasses: 2 } } },
      frameComparisons: comparison(24),
      maxIterations: 4,
      renderEvaluator: async () => ({ frameComparisons: comparison(24) })
    });

    assert.equal(result.converged, false);
    assert.equal(result.convergence.plateau.detected, true);
    assert.equal(result.convergence.stopReason, 'plateau');
    assert.ok(result.iterationsRun < 4, `the loop should stop before the ceiling, ran ${result.iterationsRun}`);
    assert.equal(result.summary.plateauDetected, true);
  });

  it('runs the full ceiling when the measurement is never renewed', async () => {
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-unmeasured',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: {},
      frameComparisons: comparison(24),
      maxIterations: 2
    });

    assert.equal(result.iterationsRun, 2, 'a reused comparison set is not evidence of a stall');
    assert.equal(result.convergence.plateau.detected, false);
    assert.deepEqual(result.convergence.history.map(round => round.measured), [true, false, false]);
    assert.equal(result.convergence.stopReason, 'max_iterations');
  });

  it('delivers the best-scoring round when the final round regresses', async () => {
    const gaps = [24, 0, 30];
    let call = 0;
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-rollback',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: {},
      frameComparisons: comparison(gaps[0]),
      maxIterations: 2,
      renderEvaluator: async () => ({ frameComparisons: comparison(gaps[(call += 1)]) })
    });

    assert.equal(result.converged, false, 'the last measurement still decides convergence');
    assert.equal(result.iterations.length, 3);
    const history = result.convergence.history.map(round => round.score);
    assert.ok(history[1] > history[0], `round 1 should improve on the baseline: ${history}`);
    assert.ok(history[2] < history[1], `round 2 should regress: ${history}`);

    assert.equal(result.convergence.best.iteration, 1);
    assert.equal(result.convergence.rolledBackTo, 1);
    assert.equal(result.summary.rolledBackTo, 1);
    assert.equal(result.convergence.deliveredScore, result.convergence.best.score);

    // The delivered artifact and script are the snapshot's, and they describe
    // each other: recompiling the snapshot parameters reproduces the script.
    assert.equal(result.stages.promotion.analysis, result.iterations[1].promotion);
    assert.notEqual(result.stages.promotion.analysis, result.iterations[2].promotion);
    assert.equal(result.stages.compilation.script, result.iterations[1].compilation.script);
    assert.equal(result.stages.compilation.contractOk, true);
    assert.equal(result.convergence.deliveredIteration, 1);
  });

  it('keeps the final round when it is the best one', async () => {
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-no-rollback',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: {},
      frameComparisons: comparison(28),
      maxIterations: 1,
      renderEvaluator: async () => ({ frameComparisons: comparison(1) })
    });

    assert.equal(result.convergence.rolledBackTo, null);
    assert.equal(result.convergence.deliveredIteration, 1);
    assert.equal(result.stages.promotion.analysis, result.iterations[1].promotion);
    assert.equal(result.convergence.history[1].regression, false);
    assert.equal(result.convergence.rollbackReason, null);
  });

  it('reports the convergence contract fields on every round', async () => {
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-fields',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: {},
      frameComparisons: comparison(24),
      maxIterations: 1,
      renderEvaluator: async () => ({ frameComparisons: comparison(12) })
    });

    assert.equal(result.convergence.version, CONVERGENCE_VERSION);
    assert.deepEqual(Object.keys(result.convergence).sort(), [
      'baselineScore', 'best', 'config', 'deliveredIteration', 'deliveredScore', 'history',
      'plateau', 'rollbackReason', 'rolledBackTo', 'score', 'stopReason', 'tiers', 'version'
    ]);
    assert.equal(result.iterations[0].compilation.contract.ok, true);
    assert.equal(result.iterations[0].compilation.contract.counts.error, 0);
    assert.equal(result.iterations[1].compilation.contract.violations.length, 0);
    assert.equal(result.summary.contractOk, true);
    assert.equal(result.summary.contractErrors, 0);
  });
});
