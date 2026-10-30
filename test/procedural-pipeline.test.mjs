import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadProceduralConfig,
  extractTrackingFromObservations,
  runProceduralPromotion,
  compileProceduralScript,
  runPerceptualDiffGate,
  runProceduralPipeline,
  runClosedLoopProceduralPipeline,
  applyCorrectionDeltas,
  generateProceduralReport,
  PROCEDURAL_PIPELINE_VERSION
} from '../src/procedural-pipeline.mjs';
import { TRACKING_VERSION } from '../src/tracking.mjs';
import { PROMOTION_VERSION } from '../src/promotion.mjs';
import { MG_COMPILER_VERSION } from '../src/mg-compiler.mjs';
import { PERCEPTUAL_VERSION } from '../src/perceptual.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));

describe('procedural-pipeline: config loading', () => {
  it('loads procedural config with defaults when missing', () => {
    const config = loadProceduralConfig({});

    assert.equal(config.promotion.bezierRmseMax, 0.015);
    assert.equal(config.promotion.springRSquaredMin, 0.92);
    assert.equal(config.promotion.duplicatorMinElements, 2);
    assert.equal(config.promotion.duplicatorCorrelationMin, 0.85);
    assert.equal(config.perceptual.iouMin, 0.90);
    assert.equal(config.perceptual.centroidOffsetMax, 0.02);
    assert.equal(config.perceptual.timingDeltaMaxFrames, 1);
    assert.equal(config.perceptual.ssimMin, 0.88);
  });

  it('loads procedural config from config.json values', async () => {
    const configPath = path.join(project, 'config.json');
    const configText = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configText);

    const proceduralConfig = loadProceduralConfig(config);

    assert.equal(proceduralConfig.promotion.bezierRmseMax, config.proceduralPromotion.bezierRmseMax);
    assert.equal(proceduralConfig.promotion.springRSquaredMin, config.proceduralPromotion.springRSquaredMin);
    assert.equal(proceduralConfig.perceptual.iouMin, config.perceptualDiff.iouMin);
    assert.equal(proceduralConfig.perceptual.ssimMin, config.perceptualDiff.ssimMin);
    assert.ok(proceduralConfig.promotion.presets.spring.length > 0);
    assert.ok(proceduralConfig.promotion.presets.bezier.length > 0);
    assert.ok(proceduralConfig.promotion.presets.duplicator.length > 0);
  });
});

describe('procedural-pipeline: Stage 2 tracking extraction', () => {
  it('extracts tracking from autoanalyze observations', () => {
    const observations = [
      {
        frame: 0,
        timeSeconds: 0,
        path: '/fake/frame0.png',
        sha256: 'abc123',
        measurement: {
          foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }
        }
      },
      {
        frame: 10,
        timeSeconds: 0.417,
        path: '/fake/frame10.png',
        sha256: 'def456',
        measurement: {
          foreground: { bbox: { x: 0.3, y: 0.1, width: 0.2, height: 0.2 } }
        }
      },
      {
        frame: 20,
        timeSeconds: 0.833,
        path: '/fake/frame20.png',
        sha256: 'ghi789',
        measurement: {
          foreground: { bbox: { x: 0.5, y: 0.1, width: 0.2, height: 0.2 } }
        }
      }
    ];

    const metadata = {
      video: { width: 1920, height: 1080, fps: { num: 24, den: 1 } }
    };

    const result = extractTrackingFromObservations({
      shotId: 'shot-001',
      observations,
      metadata,
      config: {}
    });

    assert.equal(result.shotId, 'shot-001');
    assert.equal(result.version, TRACKING_VERSION);
    assert.equal(result.sourceObservations, 3);
    assert.ok(result.elements.length > 0);
    assert.ok(result.summary);
  });

  it('handles empty observations gracefully', () => {
    const result = extractTrackingFromObservations({
      shotId: 'shot-empty',
      observations: [],
      metadata: { video: { width: 1920, height: 1080, fps: 24 } },
      config: {}
    });

    assert.equal(result.shotId, 'shot-empty');
    assert.equal(result.elements.length, 0);
  });

  it('rejects missing shotId', () => {
    assert.throws(
      () => extractTrackingFromObservations({ observations: [], metadata: {}, config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );
  });
});

describe('procedural-pipeline: Stage 3 promotion', () => {
  it('runs procedural promotion on tracking analysis', () => {
    const trackingAnalysis = {
      shotId: 'shot-001',
      version: TRACKING_VERSION,
      fps: { num: 24, den: 1 },
      elements: [
        {
          elementId: 'elem-1',
          trajectories: {
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
          },
          staticLayout: { bbox: { x: 0, y: 0, width: 10, height: 10 } },
          motionBeats: []
        }
      ],
      summary: { elementCount: 1, motionElementCount: 1, totalBeats: 0 }
    };

    const result = runProceduralPromotion({
      trackingAnalysis,
      config: { promotion: {} }
    });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.version, PROMOTION_VERSION);
    assert.ok(result.elements);
    assert.ok(result.summary);
    assert.ok(result.thresholds);
  });

  it('rejects missing trackingAnalysis', () => {
    assert.throws(
      () => runProceduralPromotion({ trackingAnalysis: null, config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );
  });
});

describe('procedural-pipeline: Stage 4 compilation', () => {
  it('compiles promotion analysis to _mg DSL script', () => {
    const promotionAnalysis = {
      schemaVersion: 1,
      version: PROMOTION_VERSION,
      fps: { num: 24, den: 1 },
      elements: [
        {
          elementId: 'elem-1',
          fps: { num: 24, den: 1 },
          overallPromotion: 'cubic_bezier',
          promotions: [
            {
              elementId: 'elem-1',
              property: 'x',
              promotion: 'cubic_bezier',
              parameters: { y1: 0.25, y2: 0.75, startFrame: 0, endFrame: 20, startValue: 0, endValue: 100 },
              metrics: { rmse: 0.01, threshold: 0.015 }
            }
          ],
          promotionTypes: ['cubic_bezier'],
          metrics: { propertyCount: 1, springCount: 0, bezierCount: 1, keyframeCount: 0 }
        }
      ],
      duplicatorGroups: [],
      summary: { totalElements: 1, springPromotions: 0, bezierPromotions: 1, keyframeFallbacks: 0, duplicatorGroups: 0 },
      thresholds: { bezierRMSE: 0.015, springR2: 0.92, duplicatorMinElements: 2, duplicatorCorrelation: 0.85 }
    };

    const trackingAnalysis = {
      shotId: 'shot-001',
      summary: { elementCount: 1, motionElementCount: 1, totalBeats: 0 }
    };

    const result = compileProceduralScript({
      promotionAnalysis,
      trackingAnalysis,
      shotId: 'shot-001',
      capabilities: {},
      config: {}
    });

    assert.equal(result.version, MG_COMPILER_VERSION);
    assert.equal(result.promotionVersion, PROMOTION_VERSION);
    assert.equal(result.shotId, 'shot-001');
    assert.ok(result.compiled);
    assert.ok(result.compiled.script);
    assert.ok(result.compiled.scriptHash);
    assert.ok(typeof result.ready === 'boolean');
  });

  it('rejects missing promotionAnalysis', () => {
    assert.throws(
      () => compileProceduralScript({ promotionAnalysis: null, shotId: 'shot-1', config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );
  });
});

describe('procedural-pipeline: Stage 5 perceptual diff', () => {
  it('runs perceptual diff gate on frame comparisons', async () => {
    const { PNG } = await import('pngjs');

    // Create simple test images
    const createTestPNG = (width, height, color) => {
      const png = new PNG({ width, height });
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (width * y + x) << 2;
          png.data[idx] = color.r;
          png.data[idx + 1] = color.g;
          png.data[idx + 2] = color.b;
          png.data[idx + 3] = 255;
        }
      }
      return png;
    };

    const reference = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });
    const rendered = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });

    const frameComparisons = [
      {
        frame: 0,
        reference,
        rendered,
        referenceBox: { x: 10, y: 10, width: 80, height: 80 },
        renderedBox: { x: 10, y: 10, width: 80, height: 80 }
      }
    ];

    const result = runPerceptualDiffGate({
      shotId: 'shot-001',
      frameComparisons,
      referenceTrajectory: [{ frame: 0, value: 0 }],
      renderedTrajectory: [{ frame: 0, value: 0 }],
      metadata: { video: { width: 1920, height: 1080, fps: 24 } },
      config: { perceptual: {} }
    });

    assert.ok(result.artifact);
    assert.equal(result.artifact.schemaVersion, 1);
    assert.equal(result.artifact.version, PERCEPTUAL_VERSION);
    assert.equal(result.artifact.shotId, 'shot-001');
    assert.ok(typeof result.artifact.overallPass === 'boolean');
    assert.ok(result.refinementReport);
  });

  it('rejects missing shotId', () => {
    assert.throws(
      () => runPerceptualDiffGate({ frameComparisons: [], metadata: {}, config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );
  });
});

describe('procedural-pipeline: full 5-stage execution', () => {
  it('runs complete procedural pipeline end-to-end', async () => {
    const observations = [
      {
        frame: 0,
        timeSeconds: 0,
        path: '/fake/frame0.png',
        sha256: 'abc123',
        measurement: {
          foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }
        }
      },
      {
        frame: 10,
        timeSeconds: 0.417,
        path: '/fake/frame10.png',
        sha256: 'def456',
        measurement: {
          foreground: { bbox: { x: 0.3, y: 0.1, width: 0.2, height: 0.2 } }
        }
      },
      {
        frame: 20,
        timeSeconds: 0.833,
        path: '/fake/frame20.png',
        sha256: 'ghi789',
        measurement: {
          foreground: { bbox: { x: 0.5, y: 0.1, width: 0.2, height: 0.2 } }
        }
      }
    ];

    const metadata = {
      video: { width: 1920, height: 1080, fps: { num: 24, den: 1 } }
    };

    const config = {
      proceduralPromotion: {
        bezierRmseMax: 0.015,
        springRSquaredMin: 0.92,
        duplicatorMinElements: 2,
        duplicatorCorrelationMin: 0.85
      },
      perceptualDiff: {
        iouMin: 0.90,
        centroidOffsetMax: 0.02,
        timingDeltaMaxFrames: 1,
        ssimMin: 0.88
      }
    };

    const result = await runProceduralPipeline({
      shotId: 'shot-e2e',
      observations,
      metadata,
      capabilities: {},
      config
    });

    assert.equal(result.version, PROCEDURAL_PIPELINE_VERSION);
    assert.equal(result.shotId, 'shot-e2e');

    // Verify all stages present
    assert.ok(result.stages.tracking);
    assert.ok(result.stages.promotion);
    assert.ok(result.stages.compilation);

    // Verify stage versions
    assert.equal(result.stages.tracking.version, TRACKING_VERSION);
    assert.equal(result.stages.promotion.version, PROMOTION_VERSION);
    assert.equal(result.stages.compilation.version, MG_COMPILER_VERSION);

    // Verify summary
    assert.ok(result.summary);
    assert.ok(typeof result.summary.totalElements === 'number');
    assert.ok(typeof result.summary.springPromotions === 'number');
    assert.ok(typeof result.summary.bezierPromotions === 'number');
    assert.ok(typeof result.summary.scriptReady === 'boolean');

    // Verify config was loaded
    assert.ok(result.config);
    assert.ok(result.config.promotion);
    assert.ok(result.config.perceptual);
  });

  it('includes perceptual stage when frame comparisons provided', async () => {
    const { PNG } = await import('pngjs');

    const createTestPNG = (width, height, color) => {
      const png = new PNG({ width, height });
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (width * y + x) << 2;
          png.data[idx] = color.r;
          png.data[idx + 1] = color.g;
          png.data[idx + 2] = color.b;
          png.data[idx + 3] = 255;
        }
      }
      return png;
    };

    const reference = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });
    const rendered = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });

    const observations = [
      { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
      { frame: 10, measurement: { foreground: { bbox: { x: 0.3, y: 0.1, width: 0.2, height: 0.2 } } } }
    ];

    const frameComparisons = [
      {
        frame: 0,
        reference,
        rendered,
        referenceBox: { x: 10, y: 10, width: 80, height: 80 },
        renderedBox: { x: 10, y: 10, width: 80, height: 80 }
      }
    ];

    const result = await runProceduralPipeline({
      shotId: 'shot-perceptual',
      observations,
      metadata: { video: { width: 1920, height: 1080, fps: 24 } },
      capabilities: {},
      config: {},
      frameComparisons
    });

    assert.ok(result.stages.perceptual);
    assert.equal(result.stages.perceptual.version, PERCEPTUAL_VERSION);
    assert.ok(result.stages.perceptual.artifact);
    assert.ok(result.stages.perceptual.refinementReport);
    assert.ok(typeof result.summary.perceptualPass === 'boolean');
  });

  it('rejects missing required parameters', async () => {
    await assert.rejects(
      () => runProceduralPipeline({ observations: [], metadata: {}, config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );

    await assert.rejects(
      () => runProceduralPipeline({ shotId: 'test', metadata: {}, config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );
  });
});

describe('procedural-pipeline: report generation', () => {
  it('generates human-readable procedural report', async () => {
    const observations = [
      { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
      { frame: 10, measurement: { foreground: { bbox: { x: 0.3, y: 0.1, width: 0.2, height: 0.2 } } } }
    ];

    const pipelineResult = await runProceduralPipeline({
      shotId: 'shot-report',
      observations,
      metadata: { video: { width: 1920, height: 1080, fps: 24 } },
      capabilities: {},
      config: {}
    });

    const report = generateProceduralReport(pipelineResult);

    assert.ok(report.includes('# Procedural Pipeline Report'));
    assert.ok(report.includes('shot-report'));
    assert.ok(report.includes('Stage 2: Kinematic Tracking'));
    assert.ok(report.includes('Stage 3: Procedural Promotion'));
    assert.ok(report.includes('Stage 4: _mg DSL Compilation'));
    assert.ok(report.includes('Summary'));
  });
});

describe('procedural-pipeline: applyCorrectionDeltas', () => {
  const buildPromotionArtifact = async () => {
    const observations = [
      { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
      { frame: 5, measurement: { foreground: { bbox: { x: 0.3, y: 0.15, width: 0.2, height: 0.2 } } } },
      { frame: 10, measurement: { foreground: { bbox: { x: 0.5, y: 0.2, width: 0.2, height: 0.2 } } } }
    ];
    const tracking = extractTrackingFromObservations({
      shotId: 'shot-deltas',
      observations,
      metadata: { video: { width: 1920, height: 1080, fps: 24 } },
      config: loadProceduralConfig({})
    });
    return runProceduralPromotion({ trackingAnalysis: tracking, config: loadProceduralConfig({}) });
  };

  it('shifts x/y promotions by position deltas and re-validates', async () => {
    const artifact = await buildPromotionArtifact();
    const xPromotion = artifact.elements[0].promotions.find(p => p.property === 'x');
    assert.ok(xPromotion, 'expected an x property promotion to correct');
    const before = xPromotion.parameters?.startValue ?? xPromotion.keyframes?.[0]?.value ?? xPromotion.value;

    const adjusted = await applyCorrectionDeltas(artifact, {
      position: { x: 12.5, y: -4 },
      scale: { x: 1, y: 1 },
      timing: 0,
      opacity: 0
    });

    const adjustedX = adjusted.elements[0].promotions.find(p => p.property === 'x');
    const after = adjustedX.parameters?.startValue ?? adjustedX.keyframes?.[0]?.value ?? adjustedX.value;
    assert.ok(Number.isFinite(after));
    assert.notEqual(after, before);
    // Schema re-validation happens inside applyCorrectionDeltas; reaching here means it passed.
    assert.equal(adjusted.schemaVersion, 1);
    assert.equal(adjusted.elements.length, artifact.elements.length);
  });

  it('shifts frames by timing delta and clamps to non-negative integers', async () => {
    const artifact = await buildPromotionArtifact();
    const adjusted = await applyCorrectionDeltas(artifact, {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      timing: -100,
      opacity: 0
    });
    for (const element of adjusted.elements) {
      for (const promotion of element.promotions) {
        for (const kf of promotion.keyframes ?? []) {
          assert.ok(Number.isInteger(kf.frame) && kf.frame >= 0, 'frame must be a non-negative integer');
        }
        if (promotion.parameters?.startFrame !== undefined) {
          assert.ok(promotion.parameters.startFrame >= 0);
        }
      }
    }
  });

  it('rejects missing arguments', async () => {
    await assert.rejects(() => applyCorrectionDeltas(null, { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, timing: 0, opacity: 0 }),
      { code: 'PROCEDURAL_INVALID' });
    const artifact = await buildPromotionArtifact();
    await assert.rejects(() => applyCorrectionDeltas(artifact, null), { code: 'PROCEDURAL_INVALID' });
  });
});

describe('procedural-pipeline: closed-loop refinement', () => {
  const makePng = async (width, height, color) => {
    const { PNG } = await import('pngjs');
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (width * y + x) << 2;
        png.data[idx] = color.r; png.data[idx + 1] = color.g; png.data[idx + 2] = color.b; png.data[idx + 3] = 255;
      }
    }
    return png;
  };

  it('converges across iterations when the render evaluator supplies a passing frame', async () => {
    const observations = [
      { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
      { frame: 10, measurement: { foreground: { bbox: { x: 0.4, y: 0.1, width: 0.2, height: 0.2 } } } }
    ];

    const reference = await makePng(64, 64, { r: 100, g: 100, b: 100 });
    // Initial rendered frame is mismatched (different color + offset box) so the gate fails.
    const badRendered = await makePng(64, 64, { r: 250, g: 10, b: 10 });
    const goodRendered = await makePng(64, 64, { r: 100, g: 100, b: 100 });

    // The reference x-trajectory the pipeline will track; the evaluator mirrors it back
    // so the timing delta collapses to zero on the refined round.
    const referenceTracking = extractTrackingFromObservations({
      shotId: 'shot-closed-loop',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      config: loadProceduralConfig({})
    });
    const matchedTrajectory = referenceTracking.elements?.[0]?.trajectories?.x ?? [];

    const failingComparisons = [{
      frame: 0, reference, rendered: badRendered,
      referenceBox: { x: 8, y: 8, width: 48, height: 48 },
      renderedBox: { x: 30, y: 30, width: 20, height: 20 }
    }];
    const passingComparisons = [{
      frame: 0, reference, rendered: goodRendered,
      referenceBox: { x: 8, y: 8, width: 48, height: 48 },
      renderedBox: { x: 8, y: 8, width: 48, height: 48 }
    }];

    let evaluatorCalls = 0;
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-closed-loop',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: { perceptualDiff: { maxRefinementIterations: 5 } },
      frameComparisons: failingComparisons,
      maxIterations: 2,
      renderEvaluator: async () => {
        evaluatorCalls += 1;
        // After the first refinement the "render" matches the reference in both
        // appearance and timing.
        return { frameComparisons: passingComparisons, renderedTrajectory: matchedTrajectory };
      }
    });

    assert.equal(result.version, PROCEDURAL_PIPELINE_VERSION);
    assert.equal(result.converged, true, 'loop should converge once the evaluator returns a passing frame');
    assert.ok(result.iterationsRun >= 1, 'at least one refinement iteration should run');
    assert.ok(result.iterationsRun <= 2, 'must respect maxIterations');
    assert.equal(evaluatorCalls, result.iterationsRun);
    // Iteration 0 failed, the final iteration passed.
    assert.equal(result.iterations[0].perceptual.overallPass, false);
    assert.equal(result.iterations[result.iterations.length - 1].perceptual.overallPass, true);
    assert.ok(result.iterations[1].appliedDeltas, 'refinement iteration records the applied deltas');
    assert.equal(result.stages.perceptual.overallPass, true);
  });

  it('stops at maxIterations and reports non-convergence when the gate never passes', async () => {
    const observations = [
      { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
      { frame: 10, measurement: { foreground: { bbox: { x: 0.4, y: 0.1, width: 0.2, height: 0.2 } } } }
    ];
    const reference = await makePng(64, 64, { r: 100, g: 100, b: 100 });
    const badRendered = await makePng(64, 64, { r: 250, g: 10, b: 10 });
    const failingComparisons = [{
      frame: 0, reference, rendered: badRendered,
      referenceBox: { x: 8, y: 8, width: 48, height: 48 },
      renderedBox: { x: 40, y: 40, width: 8, height: 8 }
    }];

    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-no-converge',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: { perceptualDiff: { maxRefinementIterations: 5 } },
      frameComparisons: failingComparisons,
      maxIterations: 2
      // No renderEvaluator: the same failing comparisons are reused every round.
    });

    assert.equal(result.converged, false);
    assert.equal(result.iterationsRun, 2);
    assert.equal(result.maxIterations, 2);
    assert.equal(result.iterations.length, 3); // iteration 0 + 2 refinements
    assert.equal(result.stages.perceptual.overallPass, false);
  });

  it('reports converged with no iterations when no frame comparisons are supplied', async () => {
    const observations = [
      { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
      { frame: 10, measurement: { foreground: { bbox: { x: 0.4, y: 0.1, width: 0.2, height: 0.2 } } } }
    ];
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-no-perceptual',
      observations,
      metadata: { video: { width: 64, height: 64, fps: 24 } },
      capabilities: {},
      config: {},
      frameComparisons: [],
      maxIterations: 2
    });
    assert.equal(result.converged, true);
    assert.equal(result.iterationsRun, 0);
    assert.equal(result.stages.perceptual, null);
    assert.equal(result.summary.perceptualPass, null);
  });

  it('clamps maxIterations to the configured ceiling', async () => {
    const observations = [
      { frame: 0, measurement: { foreground: { bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } } },
      { frame: 10, measurement: { foreground: { bbox: { x: 0.4, y: 0.1, width: 0.2, height: 0.2 } } } }
    ];
    const reference = await makePng(32, 32, { r: 100, g: 100, b: 100 });
    const badRendered = await makePng(32, 32, { r: 250, g: 10, b: 10 });
    const failingComparisons = [{
      frame: 0, reference, rendered: badRendered,
      referenceBox: { x: 4, y: 4, width: 24, height: 24 },
      renderedBox: { x: 20, y: 20, width: 4, height: 4 }
    }];
    const result = await runClosedLoopProceduralPipeline({
      shotId: 'shot-clamped',
      observations,
      metadata: { video: { width: 32, height: 32, fps: 24 } },
      capabilities: {},
      config: { perceptualDiff: { maxRefinementIterations: 1 } },
      frameComparisons: failingComparisons,
      maxIterations: 10
    });
    assert.equal(result.maxIterations, 1, 'configured ceiling wins over a larger request');
    assert.ok(result.iterationsRun <= 1);
  });

  it('rejects missing required parameters', async () => {
    await assert.rejects(
      () => runClosedLoopProceduralPipeline({ observations: [], metadata: {}, config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );
    await assert.rejects(
      () => runClosedLoopProceduralPipeline({ shotId: 'x', metadata: {}, config: {} }),
      { code: 'PROCEDURAL_INVALID' }
    );
  });
});

describe('procedural-pipeline: public module index', () => {
  it('re-exports the procedural pipeline surface from src/index.mjs', async () => {
    const index = await import('../src/index.mjs');
    for (const name of ['runProceduralPipeline', 'runClosedLoopProceduralPipeline', 'applyCorrectionDeltas', 'generateProceduralReport', 'cliMain']) {
      assert.equal(typeof index[name], 'function', `${name} must be exported from the public index`);
    }
    assert.equal(typeof index.PROCEDURAL_PIPELINE_VERSION, 'string');
    assert.equal(typeof index.VERIFIED_PRESETS, 'object');
  });
});
