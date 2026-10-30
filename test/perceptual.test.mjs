import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  computeIoU,
  computeCentroidOffset,
  computeSSIM,
  computeTimingDelta,
  compareFrames,
  compareTrajectories,
  computeCorrectionDeltas,
  analyzeElementPerceptual,
  analyzeShotPerceptual,
  generateRefinementReport,
  PERCEPTUAL_VERSION
} from '../src/perceptual.mjs';

// Helper to create a simple test PNG
function createTestPNG(width, height, color = { r: 255, g: 255, b: 255 }) {
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
}

describe('perceptual: IoU computation', () => {
  it('computes perfect IoU for identical boxes', () => {
    const box = { x: 10, y: 10, width: 100, height: 100 };
    const iou = computeIoU(box, box);
    assert.equal(iou, 1);
  });

  it('computes zero IoU for non-overlapping boxes', () => {
    const box1 = { x: 0, y: 0, width: 50, height: 50 };
    const box2 = { x: 100, y: 100, width: 50, height: 50 };
    const iou = computeIoU(box1, box2);
    assert.equal(iou, 0);
  });

  it('computes partial IoU for overlapping boxes', () => {
    const box1 = { x: 0, y: 0, width: 100, height: 100 };
    const box2 = { x: 50, y: 50, width: 100, height: 100 };
    const iou = computeIoU(box1, box2);

    // Intersection: 50x50 = 2500
    // Union: 10000 + 10000 - 2500 = 17500
    // IoU: 2500/17500 ≈ 0.143
    assert.ok(iou > 0.14 && iou < 0.15);
  });

  it('handles null boxes', () => {
    assert.equal(computeIoU(null, { x: 0, y: 0, width: 10, height: 10 }), 0);
    assert.equal(computeIoU({ x: 0, y: 0, width: 10, height: 10 }, null), 0);
  });
});

describe('perceptual: centroid offset', () => {
  it('computes zero offset for boxes with same center', () => {
    const box1 = { x: 0, y: 0, width: 100, height: 100 };
    const box2 = { x: 10, y: 10, width: 80, height: 80 };
    const offset = computeCentroidOffset(box1, box2, 1920, 1080);

    // Both have center at (50, 50)
    assert.ok(offset < 0.001);
  });

  it('computes normalized offset for shifted boxes', () => {
    const box1 = { x: 0, y: 0, width: 100, height: 100 };
    const box2 = { x: 100, y: 0, width: 100, height: 100 };
    const offset = computeCentroidOffset(box1, box2, 1920, 1080);

    // Centers: (50, 50) vs (150, 50)
    // Offset: 100/1920 ≈ 0.052
    assert.ok(offset > 0.05 && offset < 0.06);
  });

  it('handles null boxes', () => {
    assert.equal(computeCentroidOffset(null, null, 1920, 1080), Infinity);
  });
});

describe('perceptual: SSIM computation', () => {
  it('computes SSIM of 1 for identical images', () => {
    const img = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });
    const ssim = computeSSIM(img, img);
    assert.ok(ssim > 0.99);
  });

  it('computes lower SSIM for different images', () => {
    const img1 = createTestPNG(100, 100, { r: 0, g: 0, b: 0 });
    const img2 = createTestPNG(100, 100, { r: 255, g: 255, b: 255 });
    const ssim = computeSSIM(img1, img2);

    // Very different images should have low SSIM
    assert.ok(ssim < 0.5);
  });

  it('rejects dimension mismatch', () => {
    const img1 = createTestPNG(100, 100);
    const img2 = createTestPNG(200, 200);

    assert.throws(
      () => computeSSIM(img1, img2),
      { code: 'SSIM_DIMENSION_MISMATCH' }
    );
  });

  it('handles null images', () => {
    assert.equal(computeSSIM(null, null), 0);
  });
});

describe('perceptual: timing delta', () => {
  it('computes zero delta for aligned trajectories', () => {
    const traj = [
      { frame: 0, value: 0 },
      { frame: 10, value: 50 },
      { frame: 20, value: 100 }
    ];

    const delta = computeTimingDelta(traj, traj, 24);
    assert.equal(delta, 0);
  });

  it('computes delta for shifted peak velocity', () => {
    const traj1 = [
      { frame: 0, value: 0 },
      { frame: 5, value: 80 }, // Peak at frame 5
      { frame: 10, value: 100 }
    ];

    const traj2 = [
      { frame: 0, value: 0 },
      { frame: 7, value: 80 }, // Peak at frame 7
      { frame: 14, value: 100 }
    ];

    const delta = computeTimingDelta(traj1, traj2, 24);
    assert.ok(delta >= 1 && delta <= 3);
  });

  it('handles empty trajectories', () => {
    assert.equal(computeTimingDelta([], [], 24), Infinity);
    assert.equal(computeTimingDelta(null, null, 24), Infinity);
  });
});

describe('perceptual: frame comparison', () => {
  it('compares rendered frame against reference', () => {
    const reference = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });
    const rendered = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });

    const referenceBox = { x: 10, y: 10, width: 80, height: 80 };
    const renderedBox = { x: 12, y: 12, width: 78, height: 78 };

    const result = compareFrames({
      reference,
      rendered,
      referenceBox,
      renderedBox,
      frameWidth: 1920,
      frameHeight: 1080
    });

    assert.ok(result.iou > 0);
    assert.ok(result.centroidOffset >= 0);
    assert.ok(result.ssim > 0);
    assert.ok(result.thresholds.iou === 0.90);
    assert.ok(result.thresholds.centroidOffset === 0.02);
    assert.ok(result.thresholds.ssim === 0.88);
  });
});

describe('perceptual: trajectory comparison', () => {
  it('compares reference and rendered trajectories', () => {
    const referenceTrajectory = [
      { frame: 0, value: 0 },
      { frame: 10, value: 50 },
      { frame: 20, value: 100 }
    ];

    const renderedTrajectory = [
      { frame: 0, value: 0 },
      { frame: 11, value: 50 },
      { frame: 22, value: 100 }
    ];

    const result = compareTrajectories({
      referenceTrajectory,
      renderedTrajectory,
      fps: 24
    });

    assert.ok(result.timingDelta >= 0);
    assert.ok(result.threshold === 1);
    assert.ok(typeof result.timingPass === 'boolean');
  });
});

describe('perceptual: correction deltas', () => {
  it('computes position correction for failed centroid', () => {
    const metrics = {
      centroidPass: false,
      centroidOffset: 0.05,
      iouPass: true,
      timingPass: true
    };

    const params = {
      referenceBox: { x: 100, y: 100, width: 50, height: 50 },
      renderedBox: { x: 110, y: 110, width: 50, height: 50 },
      frameWidth: 1920,
      frameHeight: 1080
    };

    const deltas = computeCorrectionDeltas(metrics, params);

    assert.ok(deltas.position.x !== 0 || deltas.position.y !== 0);
    assert.equal(deltas.scale.x, 1);
    assert.equal(deltas.scale.y, 1);
  });

  it('computes scale correction for failed IoU', () => {
    const metrics = {
      iouPass: false,
      centroidPass: true,
      timingPass: true
    };

    const params = {
      referenceBox: { x: 0, y: 0, width: 100, height: 100 },
      renderedBox: { x: 0, y: 0, width: 50, height: 50 }
    };

    const deltas = computeCorrectionDeltas(metrics, params);

    // Should scale up
    assert.ok(deltas.scale.x > 1 || deltas.scale.y > 1);
  });

  it('computes timing correction for failed timing', () => {
    const metrics = {
      timingPass: false,
      timingDelta: 3,
      iouPass: true,
      centroidPass: true
    };

    const deltas = computeCorrectionDeltas(metrics, {});

    assert.ok(deltas.timing !== 0);
  });

  it('returns zero deltas when all metrics pass', () => {
    const metrics = {
      iouPass: true,
      centroidPass: true,
      ssimPass: true,
      timingPass: true
    };

    const deltas = computeCorrectionDeltas(metrics, {});

    assert.equal(deltas.position.x, 0);
    assert.equal(deltas.position.y, 0);
    assert.equal(deltas.scale.x, 1);
    assert.equal(deltas.scale.y, 1);
    assert.equal(deltas.timing, 0);
  });
});

describe('perceptual: element analysis', () => {
  it('analyzes perceptual quality across frames', () => {
    const reference = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });
    const rendered = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });

    const frameComparisons = [
      {
        frame: 0,
        reference,
        rendered,
        referenceBox: { x: 10, y: 10, width: 80, height: 80 },
        renderedBox: { x: 10, y: 10, width: 80, height: 80 }
      },
      {
        frame: 10,
        reference,
        rendered,
        referenceBox: { x: 20, y: 20, width: 80, height: 80 },
        renderedBox: { x: 20, y: 20, width: 80, height: 80 }
      }
    ];

    const result = analyzeElementPerceptual({
      elementId: 'test-element',
      frameComparisons,
      referenceTrajectory: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }],
      renderedTrajectory: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }],
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    assert.equal(result.elementId, 'test-element');
    assert.equal(result.version, PERCEPTUAL_VERSION);
    assert.ok(result.metrics.averageIoU > 0);
    assert.ok(result.metrics.averageSSIM > 0);
    assert.ok(result.frameMetrics.length === 2);
    assert.ok(result.correctionDeltas);
    assert.ok(typeof result.needsRefinement === 'boolean');
  });

  it('rejects missing elementId', () => {
    assert.throws(
      () => analyzeElementPerceptual({ frameComparisons: [], frameWidth: 100, frameHeight: 100, fps: 24 }),
      { code: 'PERCEPTUAL_INVALID' }
    );
  });

  it('handles empty frame comparisons', () => {
    const result = analyzeElementPerceptual({
      elementId: 'empty-element',
      frameComparisons: [],
      referenceTrajectory: [],
      renderedTrajectory: [],
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    assert.equal(result.metrics.frameCount, 0);
    assert.equal(result.metrics.averageIoU, 0);
  });
});

describe('perceptual: shot analysis', () => {
  it('aggregates element analyses for a shot', () => {
    const elements = [
      {
        elementId: 'elem-1',
        overallPass: true,
        metrics: { averageIoU: 0.95, averageCentroidOffset: 0.01, averageSSIM: 0.92, timingDelta: 0, frameCount: 10 },
        correctionDeltas: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, timing: 0, opacity: 0 }
      },
      {
        elementId: 'elem-2',
        overallPass: false,
        metrics: { averageIoU: 0.70, averageCentroidOffset: 0.05, averageSSIM: 0.75, timingDelta: 2, frameCount: 10 },
        correctionDeltas: { position: { x: 5, y: 5 }, scale: { x: 1.1, y: 1.1 }, timing: -1, opacity: 0 }
      }
    ];

    const result = analyzeShotPerceptual({ shotId: 'shot-1', elements });

    assert.equal(result.shotId, 'shot-1');
    assert.equal(result.version, PERCEPTUAL_VERSION);
    assert.equal(result.overallPass, false);
    assert.equal(result.summary.totalElements, 2);
    assert.equal(result.summary.passingElements, 1);
    assert.equal(result.summary.failingElements, 1);
    assert.equal(result.refinementNeeded.length, 1);
    assert.equal(result.refinementNeeded[0].elementId, 'elem-2');
  });

  it('handles empty shot', () => {
    const result = analyzeShotPerceptual({ shotId: 'empty-shot', elements: [] });

    assert.equal(result.summary.totalElements, 0);
    assert.equal(result.overallPass, false);
  });

  it('rejects missing shotId', () => {
    assert.throws(
      () => analyzeShotPerceptual({ elements: [] }),
      { code: 'PERCEPTUAL_INVALID' }
    );
  });
});

describe('perceptual: refinement report', () => {
  it('generates structured refinement report', () => {
    const shotAnalysis = {
      shotId: 'shot-1',
      overallPass: false,
      summary: {
        totalElements: 2,
        passingElements: 1,
        failingElements: 1,
        averageIoU: 0.85,
        averageSSIM: 0.85
      },
      refinementNeeded: [
        {
          elementId: 'elem-2',
          deltas: { position: { x: 5, y: 5 }, scale: { x: 1.1, y: 1.1 }, timing: -1, opacity: 0 },
          failedMetrics: ['averageIoU', 'averageCentroidOffset']
        }
      ]
    };

    const report = generateRefinementReport(shotAnalysis, { iteration: 1, maxIterations: 5 });

    assert.equal(report.shotId, 'shot-1');
    assert.equal(report.status, 'needs_refinement');
    assert.equal(report.iterations, 1);
    assert.equal(report.maxIterations, 5);
    assert.ok(report.recommendations.length > 0);
    assert.equal(report.canIterate, true);
  });

  it('generates pass report for successful shot', () => {
    const shotAnalysis = {
      shotId: 'shot-pass',
      overallPass: true,
      summary: { totalElements: 1, passingElements: 1, failingElements: 0, averageIoU: 0.95, averageSSIM: 0.92 },
      refinementNeeded: []
    };

    const report = generateRefinementReport(shotAnalysis);

    assert.equal(report.status, 'pass');
    assert.equal(report.canIterate, false);
  });

  it('respects max iterations', () => {
    const shotAnalysis = {
      shotId: 'shot-max',
      overallPass: false,
      summary: { totalElements: 1, passingElements: 0, failingElements: 1, averageIoU: 0.5, averageSSIM: 0.5 },
      refinementNeeded: [{ elementId: 'elem', deltas: {}, failedMetrics: ['averageIoU'] }]
    };

    const report = generateRefinementReport(shotAnalysis, { iteration: 5, maxIterations: 5 });

    assert.equal(report.canIterate, false);
  });
});
