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
  computeThreeChannelDiff,
  analyzeElementPerceptual,
  analyzeShotPerceptual,
  generateRefinementReport,
  DEFAULT_CHANNEL_THRESHOLDS,
  PERCEPTUAL_VERSION
} from '../src/perceptual.mjs';
import {
  toLab,
  labDistance,
  labHistogram,
  histogramDiff,
  silhouetteMask,
  maskIoU,
  chamferDistance,
  opticalFlowMagnitude,
  flowFieldDiff
} from '../src/pixels.mjs';

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

// Helper to create a plain RGBA frame ({data, width, height}) with an optional
// per-pixel painter function (x, y) => color.
function makeFrame(width, height, painterOrColor = { r: 255, g: 255, b: 255 }) {
  const data = new Uint8Array(width * height * 4);
  const painter = typeof painterOrColor === 'function' ? painterOrColor : () => painterOrColor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const color = painter(x, y);
      data[idx] = color.r;
      data[idx + 1] = color.g;
      data[idx + 2] = color.b;
      data[idx + 3] = 255;
    }
  }
  return { data, width, height };
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

describe('perceptual: tier 3 opacity correction', () => {
  const box = { x: 16, y: 16, width: 32, height: 32 };
  const background = { r: 20, g: 20, b: 20 };
  const scene = (foreground, foregroundBox = box) => makeFrame(64, 64, (x, y) => (
    x >= foregroundBox.x && x < foregroundBox.x + foregroundBox.width
      && y >= foregroundBox.y && y < foregroundBox.y + foregroundBox.height
      ? foreground
      : background
  ));

  const analyze = (reference, rendered, renderedBox = box) => analyzeElementPerceptual({
    elementId: 'opacity-element',
    frameComparisons: [{ frame: 0, reference, rendered, referenceBox: box, renderedBox }],
    referenceTrajectory: [{ frame: 0, value: 0 }],
    renderedTrajectory: [{ frame: 0, value: 0 }],
    frameWidth: 64,
    frameHeight: 64,
    fps: 24
  });

  it('turns a contrast gap on an aligned silhouette into a bounded opacity delta', () => {
    const result = analyze(scene({ r: 220, g: 220, b: 220 }), scene({ r: 120, g: 120, b: 120 }));

    // Contrast gap: (220 - 20)/255 - (120 - 20)/255 = 100/255.
    assert.ok(Math.abs(result.metrics.lumaContrastDelta - 100 / 255) < 1e-12);
    // The correction takes half the gap and stays well inside the +/-0.5 bound.
    assert.ok(Math.abs(result.correctionDeltas.opacity - 50 / 255) < 1e-12);
    assert.ok(result.correctionDeltas.opacity > 0, 'a faint render must raise opacity');
    assert.deepEqual(result.correctionDeltas.position, { x: 0, y: 0 });
    assert.equal(result.correctionDeltas.scale.x, 1);
    assert.equal(result.channels.failedChannels.includes('geometry'), false);
  });

  it('emits nothing when the two frames share the same contrast', () => {
    const reference = scene({ r: 220, g: 220, b: 220 });
    const result = analyze(reference, scene({ r: 220, g: 220, b: 220 }));

    assert.equal(result.metrics.lumaContrastDelta, 0);
    assert.equal(result.correctionDeltas.opacity, 0);
  });

  it('keeps a luma gap on a misaligned silhouette out of the opacity channel', () => {
    const result = analyze(
      scene({ r: 220, g: 220, b: 220 }),
      scene({ r: 120, g: 120, b: 120 }),
      { x: 40, y: 16, width: 32, height: 32 }
    );

    assert.ok(result.metrics.lumaContrastDelta > 0.05, 'the luma gap is still measured');
    assert.equal(result.correctionDeltas.opacity, 0, 'geometry misalignment is not an alpha symptom');
  });

  it('clamps the direct delta to +/-0.5 and ignores a sub-threshold gap', () => {
    const aligned = { iouPass: true, centroidPass: true };
    assert.equal(computeCorrectionDeltas({ ...aligned, lumaContrastDelta: 5 }, {}).opacity, 0.5);
    assert.equal(computeCorrectionDeltas({ ...aligned, lumaContrastDelta: -5 }, {}).opacity, -0.5);
    assert.equal(computeCorrectionDeltas({ ...aligned, lumaContrastDelta: 0.04 }, {}).opacity, 0);
    assert.equal(
      computeCorrectionDeltas({ iouPass: false, centroidPass: true, lumaContrastDelta: 0.4 }, {}).opacity,
      0
    );
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

  it('routes the measured boxes into the geometry correction', () => {
    const reference = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });
    const rendered = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });

    // The same silhouette, displaced by 20px on both axes: equal areas, so the
    // scale correction is identity and any position correction can only come
    // from the boxes on the comparison. `compareFrames` returns metrics only, so
    // reading the boxes back off frameMetrics silently produced a no-op.
    const result = analyzeElementPerceptual({
      elementId: 'offset-element',
      frameComparisons: [
        {
          frame: 0,
          reference,
          rendered,
          referenceBox: { x: 10, y: 10, width: 80, height: 80 },
          renderedBox: { x: 30, y: 30, width: 80, height: 80 }
        }
      ],
      referenceTrajectory: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }],
      renderedTrajectory: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }],
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    assert.equal(result.metrics.averageCentroidOffset > 0.02, true, 'the fixture must miss the centroid gate');
    assert.deepEqual(result.correctionDeltas.position, { x: -10, y: -10 }, 'half the centroid displacement');
    assert.deepEqual(result.correctionDeltas.scale, { x: 1, y: 1 }, 'equal areas cannot imply a scale change');
  });

  it('does not turn an unmeasured trajectory into an infinite timing correction', () => {
    const reference = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });
    const rendered = createTestPNG(100, 100, { r: 128, g: 128, b: 128 });

    // `computeTimingDelta` returns Infinity when either trajectory is empty.
    // That reads as "no render was measured", so the gate must report no
    // correction rather than an unbounded one the caller would clamp silently.
    const result = analyzeElementPerceptual({
      elementId: 'unmeasured-timing',
      frameComparisons: [
        {
          frame: 0,
          reference,
          rendered,
          referenceBox: { x: 10, y: 10, width: 80, height: 80 },
          renderedBox: { x: 10, y: 10, width: 80, height: 80 }
        }
      ],
      referenceTrajectory: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }],
      renderedTrajectory: [],
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    assert.equal(result.metrics.timingDelta, Infinity);
    assert.equal(result.needsRefinement, true);
    assert.equal(result.correctionDeltas.timing, 0);
    assert.equal(Number.isFinite(result.correctionDeltas.timing), true);
    // The channel-routed temporal delta is derived from the same lag, so it has
    // nothing to work from either.
    assert.equal(Math.abs(result.correctionDeltas.temporalDeltas.beatFrames), 0);
    assert.equal(Math.abs(result.correctionDeltas.temporalDeltas.staggerOffset), 0);
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


// ---------------------------------------------------------------------------
// v2: 3-channel structured diff vector (pixels.mjs kernels + perceptual.mjs)
// ---------------------------------------------------------------------------

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe('pixels: toLab (sRGB -> CIE Lab, D65)', () => {
  it('maps white to L=100 with neutral a/b', () => {
    const lab = toLab(makeFrame(2, 2, WHITE).data, 2, 2);
    assert.equal(lab.length, 12);
    assert.ok(Math.abs(lab[0] - 100) < 1e-6, `L was ${lab[0]}`);
    assert.ok(Math.abs(lab[1]) < 1e-6, `a was ${lab[1]}`);
    assert.ok(Math.abs(lab[2]) < 1e-6, `b was ${lab[2]}`);
  });

  it('maps black to L=0', () => {
    const lab = toLab(makeFrame(2, 2, BLACK).data, 2, 2);
    assert.ok(Math.abs(lab[0]) < 1e-9, `L was ${lab[0]}`);
    assert.equal(lab[1], 0);
    assert.equal(lab[2], 0);
  });

  it('places pure red at positive a and b with mid lightness', () => {
    const lab = toLab(makeFrame(1, 1, { r: 255, g: 0, b: 0 }).data, 1, 1);
    assert.ok(lab[0] > 50 && lab[0] < 60, `L was ${lab[0]}`);
    assert.ok(lab[1] > 0, `a was ${lab[1]}`);
    assert.ok(lab[2] > 0, `b was ${lab[2]}`);
  });

  it('places mid gray near L=53 and stays deterministic', () => {
    const first = toLab(makeFrame(3, 3, { r: 128, g: 128, b: 128 }).data, 3, 3);
    const second = toLab(makeFrame(3, 3, { r: 128, g: 128, b: 128 }).data, 3, 3);
    assert.ok(first[0] > 52 && first[0] < 55, `L was ${first[0]}`);
    assert.deepEqual(Array.from(first), Array.from(second));
  });

  it('rejects buffers too small for the declared dimensions', () => {
    assert.throws(() => toLab(new Uint8Array(4), 2, 2), TypeError);
  });
});

describe('pixels: Lab distance and histogram distance', () => {
  it('computes zero distance for identical Lab points', () => {
    assert.equal(labDistance([100, 0, 0], [100, 0, 0]), 0);
  });

  it('computes euclidean distance between Lab points', () => {
    assert.equal(labDistance([100, 0, 0], [50, 0, 0]), 50);
    assert.ok(Math.abs(labDistance([0, 3, 4], [0, 0, 0]) - 5) < 1e-12);
  });

  it('gives zero histogram distance for identical buffers', () => {
    const lab = toLab(makeFrame(4, 4, { r: 128, g: 128, b: 128 }).data, 4, 4);
    const h1 = labHistogram(lab, 8);
    const h2 = labHistogram(toLab(makeFrame(4, 4, { r: 128, g: 128, b: 128 }).data, 4, 4), 8);
    assert.equal(h1.length, 512);
    assert.ok(Math.abs(h1.reduce((s, v) => s + v, 0) - 1) < 1e-12, 'histogram must sum to 1');
    assert.equal(histogramDiff(h1, h2), 0);
  });

  it('gives maximal chi-square distance for disjoint colors', () => {
    const white = labHistogram(toLab(makeFrame(4, 4, WHITE).data, 4, 4), 8);
    const black = labHistogram(toLab(makeFrame(4, 4, BLACK).data, 4, 4), 8);
    const diff = histogramDiff(white, black);
    assert.ok(Math.abs(diff - 1) < 1e-12, `diff was ${diff}`);
  });

  it('rejects histograms of different lengths', () => {
    assert.throws(() => histogramDiff(new Float64Array(8), new Float64Array(16)), TypeError);
  });
});

describe('pixels: silhouette masks and mask IoU', () => {
  // 16x16 white frames with an 8x8 black square: A at (2,2), B shifted +2px.
  const frameA = makeFrame(16, 16, (x, y) => (x >= 2 && x < 10 && y >= 2 && y < 10) ? BLACK : WHITE);
  const frameB = makeFrame(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 2 && y < 10) ? BLACK : WHITE);
  const maskA = silhouetteMask(frameA.data, 16, 16, { backgroundLuma: 255, tolerance: 16 });
  const maskB = silhouetteMask(frameB.data, 16, 16, { backgroundLuma: 255, tolerance: 16 });

  it('produces 0/255 masks sized width*height', () => {
    assert.equal(maskA.length, 256);
    assert.ok(maskA.every(v => v === 0 || v === 255));
    assert.equal(maskA[0], 0); // corner is background
    assert.equal(maskA[2 * 16 + 2], 255); // square pixel is foreground
  });

  it('computes full IoU for identical masks', () => {
    assert.equal(maskIoU(maskA, maskA), 1);
  });

  it('computes intersection/union for shifted rectangles', () => {
    // Intersection 6x8 = 48, union 64 + 64 - 48 = 80 -> 0.6
    const iou = maskIoU(maskA, maskB);
    assert.ok(Math.abs(iou - 0.6) < 1e-12, `IoU was ${iou}`);
  });

  it('counts two empty masks as identical silhouettes', () => {
    const emptyA = silhouetteMask(makeFrame(8, 8, { r: 128, g: 128, b: 128 }).data, 8, 8, {});
    const emptyB = silhouetteMask(makeFrame(8, 8, { r: 128, g: 128, b: 128 }).data, 8, 8, {});
    assert.equal(maskIoU(emptyA, emptyB), 1);
  });

  it('accepts an explicit background color', () => {
    const byColor = silhouetteMask(frameA.data, 16, 16, { backgroundColor: WHITE, tolerance: 10 });
    assert.equal(maskIoU(byColor, maskA), 1);
  });

  it('auto-detects the background luma from the frame corners', () => {
    const auto = silhouetteMask(frameA.data, 16, 16, {});
    assert.equal(maskIoU(auto, maskA), 1);
  });
});

describe('pixels: chamfer distance', () => {
  const maskAt = offsetX => {
    const frame = makeFrame(16, 16, (x, y) => (x >= offsetX && x < offsetX + 8 && y >= 2 && y < 10) ? BLACK : WHITE);
    return silhouetteMask(frame.data, 16, 16, { backgroundLuma: 255, tolerance: 16 });
  };

  it('is exactly 0 for identical masks', () => {
    const mask = maskAt(2);
    assert.equal(chamferDistance(mask, mask, 16, 16), 0);
  });

  it('is small (about 1px) for a 1px-shifted mask', () => {
    const chamfer = chamferDistance(maskAt(2), maskAt(3), 16, 16);
    assert.ok(chamfer > 0, `chamfer was ${chamfer}`);
    assert.ok(chamfer <= 1.5, `chamfer was ${chamfer}`);
  });

  it('returns the worst-case pixel sentinel when exactly one edge set is empty', () => {
    const empty = silhouetteMask(makeFrame(16, 16, WHITE).data, 16, 16, { backgroundLuma: 255, tolerance: 16 });
    const square = maskAt(2);
    assert.equal(chamferDistance(empty, square, 16, 16), 32);
    assert.equal(chamferDistance(square, empty, 16, 16), 32);
    assert.equal(chamferDistance(empty, empty, 16, 16), 0);
  });
});

describe('pixels: block-matcher optical flow', () => {
  // 16x16 frames with a full-height 8px black bar: A at x in [0,7], B shifted
  // +4px. The bar spans every block row so no background block can slide onto
  // an object-free region (a flat partial object would let SAD-0 "escape"
  // vectors appear); every block is pinned by the bar or the background.
  const frameA = makeFrame(16, 16, x => (x < 8) ? BLACK : WHITE);
  const frameB = makeFrame(16, 16, x => (x >= 4 && x < 12) ? BLACK : WHITE);

  it('recovers a synthetic 4px translation on the moving blocks', () => {
    const flow = opticalFlowMagnitude(frameA, frameB);
    assert.equal(flow.cols, 2);
    assert.equal(flow.rows, 2);
    assert.equal(flow.dx[0], 4);
    assert.equal(flow.dy[0], 0);
    assert.equal(flow.magnitude[0], 4);
    assert.equal(flow.dx[2], 4, 'lower object block sees the same shift');
  });

  it('reports zero flow on static background blocks', () => {
    const flow = opticalFlowMagnitude(frameA, frameB);
    assert.equal(flow.dx[1], 0);
    assert.equal(flow.dy[1], 0);
    assert.equal(flow.dx[3], 0);
    assert.equal(flow.dy[3], 0);
  });

  it('produces an all-zero field for identical frames', () => {
    const flow = opticalFlowMagnitude(frameA, frameA);
    assert.ok(Array.from(flow.magnitude).every(m => m === 0));
    assert.equal(flowFieldDiff(flow, opticalFlowMagnitude(frameA, frameA)), 0);
  });

  it('diffs moving vs static flow at the expected mean', () => {
    // The two object blocks move 4px, the two background blocks 0px:
    // mean |velocity difference| = (4 + 0 + 4 + 0) / 4 = 2 px/frame.
    const moving = opticalFlowMagnitude(frameA, frameB);
    const staticFlow = opticalFlowMagnitude(frameA, frameA);
    const diff = flowFieldDiff(moving, staticFlow);
    assert.ok(Math.abs(diff - 2) < 1e-12, `diff was ${diff}`);
  });

  it('restricts the diff to a region box', () => {
    const moving = opticalFlowMagnitude(frameA, frameB);
    const staticFlow = opticalFlowMagnitude(frameA, frameA);
    // Restricting to block 0 (0..8) sees the full 4px difference.
    const diff = flowFieldDiff(moving, staticFlow, { x: 0, y: 0, width: 8, height: 8 });
    assert.equal(diff, 4);
    // The background column alone shows no velocity difference at all.
    const backgroundOnly = flowFieldDiff(moving, staticFlow, { x: 8, y: 0, width: 8, height: 16 });
    assert.equal(backgroundOnly, 0);
  });

  it('rejects mismatched flow grids', () => {
    const flowA = opticalFlowMagnitude(frameA, frameA);
    const flowB = opticalFlowMagnitude(frameA, frameA, { blockSize: 4 });
    assert.throws(() => flowFieldDiff(flowA, flowB), TypeError);
  });
});

describe('perceptual: three-channel diff', () => {
  // Low-contrast square (luma 124 on 128, away from the frame border) so global
  // SSIM and the Lab histogram stay well inside their gates while the silhouette
  // still sees the square (contrast 4 > tolerance 2).
  const faintSquare = offsetX => makeFrame(16, 16, (x, y) =>
    (x >= offsetX && x < offsetX + 8 && y >= 2 && y < 10) ? { r: 124, g: 124, b: 124 } : { r: 128, g: 128, b: 128 });
  const tolerance2 = { tolerance: 2 };

  it('passes all channels on identical frames', () => {
    const frame = faintSquare(0);
    const diff = computeThreeChannelDiff(frame, frame, tolerance2);
    assert.equal(diff.pass, true);
    assert.deepEqual(diff.failedChannels, []);
    assert.equal(diff.geometry.silhouetteIoU, 1);
    assert.equal(diff.geometry.chamfer, 0);
    assert.equal(diff.appearance.labHistogramDiff, 0);
    assert.equal(diff.appearance.ssim, 1);
  });

  it('fails only the geometry channel on a translated silhouette', () => {
    const diff = computeThreeChannelDiff(faintSquare(0), faintSquare(4), tolerance2);
    assert.deepEqual(diff.failedChannels, ['geometry']);
    assert.equal(diff.pass, false);
    assert.ok(Math.abs(diff.geometry.silhouetteIoU - 1 / 3) < 1e-12, `IoU was ${diff.geometry.silhouetteIoU}`);
    assert.ok(diff.geometry.silhouetteIoU < 0.90, 'silhouette IoU gate must fail');
    assert.ok(diff.geometry.chamfer > 0, `chamfer was ${diff.geometry.chamfer}`);
    assert.ok(diff.geometry.bboxIoU < 1);
    assert.equal(diff.appearance.labHistogramDiff, 0, 'same colors, only moved');
  });

  it('fails geometry through the chamfer gate alone when tightened', () => {
    // Diagonal 1px shift of the faint square: silhouette IoU 0.62 stays above
    // the loosened 0.5 gate (and SSIM/Lab stay green), but the mean edge
    // chamfer (0.964px, no coinciding edges) exceeds the tightened 0.9px gate.
    const maskPair = (offsetX, offsetY) => makeFrame(16, 16, (x, y) =>
      (x >= offsetX && x < offsetX + 8 && y >= offsetY && y < offsetY + 8) ? { r: 124, g: 124, b: 124 } : { r: 128, g: 128, b: 128 });
    const diff = computeThreeChannelDiff(maskPair(2, 2), maskPair(3, 3), {
      tolerance: 2,
      thresholds: { silhouetteIoU: 0.5, chamfer: 0.9 }
    });
    assert.deepEqual(diff.failedChannels, ['geometry']);
    assert.ok(diff.geometry.silhouetteIoU >= 0.5, `IoU was ${diff.geometry.silhouetteIoU}`);
    assert.ok(diff.geometry.chamfer > 0.9, `chamfer was ${diff.geometry.chamfer}`);
  });

  it('fails only the appearance channel on a recolored frame', () => {
    const gray = makeFrame(16, 16, { r: 128, g: 128, b: 128 });
    const bright = makeFrame(16, 16, { r: 200, g: 200, b: 200 });
    const diff = computeThreeChannelDiff(gray, bright);
    assert.deepEqual(diff.failedChannels, ['appearance']);
    assert.equal(diff.geometry.silhouetteIoU, 1, 'both silhouettes are empty/uniform');
    assert.ok(diff.appearance.labHistogramDiff > 0.12, `lab diff was ${diff.appearance.labHistogramDiff}`);
  });

  it('fails only the temporal channel on a time-shifted pair', () => {
    // Full-height bar frames: the reference bar moves 4px right by the next
    // frame while the render stays static. Identical frame-0 pairs keep the
    // geometry and appearance channels green; the flow channel sees the lag.
    const barFrame = barOffsetX => makeFrame(16, 16, x => (x >= barOffsetX && x < barOffsetX + 8) ? BLACK : WHITE);
    const frame0 = barFrame(0);
    const diff = computeThreeChannelDiff(frame0, frame0, {
      referenceNext: barFrame(4),   // reference moves 4px by the next frame
      renderedNext: barFrame(0)     // render is static
    });
    assert.deepEqual(diff.failedChannels, ['temporal']);
    assert.equal(diff.geometry.silhouetteIoU, 1, 'frame-0 pixels are identical');
    // Object blocks (0,0) and (0,1) report 4px, background blocks 0px:
    // mean |velocity difference| = (4 + 0 + 4 + 0) / 4 = 2 px/frame.
    assert.ok(Math.abs(diff.temporal.flowDelta - 2) < 1e-12, `flowDelta was ${diff.temporal.flowDelta}`);
  });

  it('honors configured threshold overrides', () => {
    const diff = computeThreeChannelDiff(faintSquare(0), faintSquare(4), {
      ...tolerance2,
      thresholds: { silhouetteIoU: 0.3, chamfer: 5 }
    });
    assert.deepEqual(diff.failedChannels, []);
    assert.equal(diff.pass, true);
  });

  it('degrades to null channel metrics when pixel data is unavailable', () => {
    const diff = computeThreeChannelDiff(null, null, {});
    assert.equal(diff.geometry.silhouetteIoU, null);
    assert.equal(diff.geometry.chamfer, null);
    assert.equal(diff.temporal.flowDelta, null);
    assert.equal(diff.temporal.timingDelta, null);
    assert.equal(diff.appearance.labHistogramDiff, null);
    assert.equal(diff.appearance.ssim, null);
    assert.equal(diff.pass, true);
    assert.deepEqual(diff.failedChannels, []);
  });

  it('uses the documented default thresholds', () => {
    assert.deepEqual(DEFAULT_CHANNEL_THRESHOLDS, {
      silhouetteIoU: 0.90,
      chamfer: 2.0,
      flowDelta: 0.75,
      labHistogramDiff: 0.12,
      ssim: 0.88
    });
  });
});

describe('perceptual: correction delta channel routing', () => {
  it('routes temporal failures to timing-only deltas', () => {
    const deltas = computeCorrectionDeltas({
      iouPass: true, centroidPass: true, ssimPass: true,
      timingPass: false, timingDelta: 2
    }, {});
    assert.equal(deltas.timing, -1, 'legacy top-level timing delta unchanged');
    assert.equal(deltas.temporalDeltas.beatFrames, -1);
    assert.equal(deltas.temporalDeltas.staggerOffset, -0.5);
    assert.equal(deltas.temporalDeltas.bezierWeight, 0);
    assert.equal(deltas.temporalDeltas.bezierAngle, 0);
    assert.equal(deltas.appearanceDeltas.colorShift, 0);
    assert.deepEqual(deltas.appearanceDeltas.fill, { L: 0, a: 0, b: 0 });
  });

  it('routes appearance failures to color-only deltas', () => {
    const deltas = computeCorrectionDeltas({
      iouPass: true, centroidPass: true, timingPass: true,
      ssimPass: false, ssim: 0.5
    }, {});
    assert.equal(deltas.timing, 0);
    assert.deepEqual(deltas.temporalDeltas, { beatFrames: 0, staggerOffset: 0, bezierWeight: 0, bezierAngle: 0 });
    assert.ok(Math.abs(deltas.appearanceDeltas.colorShift - 0.5 * (0.88 - 0.5)) < 1e-9,
      `colorShift was ${deltas.appearanceDeltas.colorShift}`);
  });

  it('signs fill deltas from reference/rendered Lab means', () => {
    const deltas = computeCorrectionDeltas({
      failedChannels: ['appearance'], iouPass: true, centroidPass: true, timingPass: true
    }, {
      referenceLabMean: [60, 10, -5],
      renderedLabMean: [50, 0, 5]
    });
    assert.deepEqual(deltas.appearanceDeltas.fill, { L: 5, a: 5, b: -5 });
    assert.equal(deltas.temporalDeltas.beatFrames, 0);
  });

  it('routes flow-only temporal failures through the flow shortfall', () => {
    const deltas = computeCorrectionDeltas({
      failedChannels: ['temporal'], flowDelta: 1.75,
      iouPass: true, centroidPass: true, timingPass: true
    }, {});
    // lag = 1.75 - 0.75 = 1.0 -> beatFrames = -0.5
    assert.equal(deltas.temporalDeltas.beatFrames, -0.5);
    assert.equal(deltas.appearanceDeltas.colorShift, 0);
  });

  it('keeps the legacy top-level delta shape untouched', () => {
    const deltas = computeCorrectionDeltas({
      iouPass: true, centroidPass: true, ssimPass: true, timingPass: true
    }, {});
    assert.deepEqual(Object.keys(deltas).sort(),
      ['appearanceDeltas', 'opacity', 'position', 'scale', 'temporalDeltas', 'timing']);
    assert.deepEqual(deltas.position, { x: 0, y: 0 });
    assert.deepEqual(deltas.scale, { x: 1, y: 1 });
    assert.equal(deltas.timing, 0);
    assert.equal(deltas.opacity, 0);
  });
});

describe('perceptual: element analysis 3-channel integration', () => {
  const faintSquare = offsetX => makeFrame(16, 16, (x, y) =>
    (x >= offsetX && x < offsetX + 8 && y >= 2 && y < 10) ? { r: 124, g: 124, b: 124 } : { r: 128, g: 128, b: 128 });
  const identicalBox = { x: 0, y: 2, width: 8, height: 8 };
  const shiftedBox = { x: 4, y: 2, width: 8, height: 8 };
  // Restrict the flow channel to the object's block column so the flat
  // background outside it cannot produce SAD-0 escape vectors.
  const objectColumnBox = { x: 0, y: 0, width: 8, height: 16 };

  it('passes every channel on identical frames and trajectories', () => {
    const frame = makeFrame(16, 16, { r: 128, g: 128, b: 128 });
    const result = analyzeElementPerceptual({
      elementId: 'channel-pass',
      frameComparisons: [
        { frame: 0, reference: frame, rendered: frame, referenceBox: identicalBox, renderedBox: identicalBox },
        { frame: 10, reference: frame, rendered: frame, referenceBox: identicalBox, renderedBox: identicalBox }
      ],
      referenceTrajectory: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }],
      renderedTrajectory: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }],
      frameWidth: 16,
      frameHeight: 16,
      fps: 24
    });
    assert.equal(result.overallPass, true);
    assert.equal(result.needsRefinement, false);
    assert.deepEqual(result.channels.failedChannels, []);
    assert.equal(result.channels.geometry.silhouetteIoU, 1);
    assert.equal(result.channels.geometry.chamfer, 0);
    assert.equal(result.channels.temporal.flowDelta, 0);
    assert.equal(result.channels.appearance.labHistogramDiff, 0);
    assert.deepEqual(result.correctionDeltas.temporalDeltas, { beatFrames: 0, staggerOffset: 0, bezierWeight: 0, bezierAngle: 0 });
    assert.deepEqual(result.correctionDeltas.appearanceDeltas.fill, { L: 0, a: 0, b: 0 });
  });

  it('catches a motion lag the measured boxes miss, and routes it to temporal deltas', () => {
    // Measured boxes claim alignment in both frames, but the rendered square
    // never moves: frame 0 matches, frame 1 lags 4px behind the reference.
    const result = analyzeElementPerceptual({
      elementId: 'channel-lag',
      frameComparisons: [
        { frame: 0, reference: faintSquare(0), rendered: faintSquare(0), referenceBox: identicalBox, renderedBox: identicalBox },
        { frame: 1, reference: faintSquare(4), rendered: faintSquare(0), referenceBox: shiftedBox, renderedBox: shiftedBox }
      ],
      referenceTrajectory: [{ frame: 0, value: 0 }, { frame: 1, value: 4 }],
      renderedTrajectory: [{ frame: 0, value: 0 }, { frame: 1, value: 4 }],
      frameWidth: 16,
      frameHeight: 16,
      fps: 24,
      tolerance: 2,
      flowBox: objectColumnBox
    });
    assert.equal(result.version, '2.0.0');
    // Legacy gates pass (identical boxes, high SSIM, zero timing delta)...
    assert.ok(result.metrics.averageSSIM >= 0.88);
    assert.equal(result.metrics.timingDelta, 0);
    // ...but the channel vector still fails geometry and temporal.
    assert.ok(result.channels.failedChannels.includes('geometry'));
    assert.ok(result.channels.failedChannels.includes('temporal'));
    assert.ok(!result.channels.failedChannels.includes('appearance'));
    assert.equal(result.overallPass, false);
    assert.equal(result.needsRefinement, true);
    // Both object-column blocks report the full 4px reference motion against
    // the static render -> mean |velocity difference| = 4 px/frame.
    assert.ok(Math.abs(result.channels.temporal.flowDelta - 4) < 1e-12,
      `flowDelta was ${result.channels.temporal.flowDelta}`);
    // flowDelta 4.0 vs threshold 0.75 -> lag 3.25 -> beatFrames -1.625
    assert.equal(result.correctionDeltas.temporalDeltas.beatFrames, -1.625);
    assert.equal(result.correctionDeltas.appearanceDeltas.colorShift, 0);
  });

  it('treats an unverifiable rendered trajectory as a temporal failure', () => {
    const frame = makeFrame(16, 16, { r: 128, g: 128, b: 128 });
    const result = analyzeElementPerceptual({
      elementId: 'channel-no-trajectory',
      frameComparisons: [
        { frame: 0, reference: frame, rendered: frame, referenceBox: identicalBox, renderedBox: identicalBox }
      ],
      referenceTrajectory: [{ frame: 0, value: 0 }],
      renderedTrajectory: [],
      frameWidth: 16,
      frameHeight: 16,
      fps: 24
    });
    assert.ok(result.channels.failedChannels.includes('temporal'));
    assert.equal(result.channels.temporal.timingDelta, Infinity);
    assert.equal(result.overallPass, false);
  });
});
