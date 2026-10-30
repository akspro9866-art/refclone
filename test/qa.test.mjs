import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { compareFrames, estimateShift, shotStatus, aggregateShot } from '../src/qa.mjs';

function createFrame(width, height, fillFn) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const [r, g, b] = fillFn(x, y);
      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = 255;
    }
  }
  return png;
}

function solidFrame(width, height, color) {
  return createFrame(width, height, () => color);
}

function gradientFrame(width, height) {
  return createFrame(width, height, (x, y) => [
    Math.floor((x / width) * 255),
    Math.floor((y / height) * 255),
    128
  ]);
}

function shiftedFrame(frame, dx, dy) {
  const { width, height } = frame;
  const shifted = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(width - 1, x - dx));
      const sy = Math.max(0, Math.min(height - 1, y - dy));
      const from = (sy * width + sx) * 4;
      const to = (y * width + x) * 4;
      shifted.data[to] = frame.data[from];
      shifted.data[to + 1] = frame.data[from + 1];
      shifted.data[to + 2] = frame.data[from + 2];
      shifted.data[to + 3] = frame.data[from + 3];
    }
  }
  return shifted;
}

function featureFrame(width, height, bx, by, bw, bh) {
  // Dark background with one bright block: an unambiguous feature for shift detection.
  return createFrame(width, height, (x, y) =>
    (x >= bx && x < bx + bw && y >= by && y < by + bh) ? [240, 240, 240] : [16, 16, 16]);
}

// Minimal 5x7 bitmap font so distinct characters produce distinct ink.
const GLYPHS = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110']
};

function textFrame(width, height, text, scale = 4) {
  const png = solidFrame(width, height, [255, 255, 255]);
  const glyphWidth = 5 * scale, glyphHeight = 7 * scale, advance = 6 * scale;
  const startX = Math.floor((width - text.length * advance) / 2);
  const startY = Math.floor((height - glyphHeight) / 2);
  for (let i = 0; i < text.length; i++) {
    const glyph = GLYPHS[text[i]];
    if (!glyph) continue;
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = startX + i * advance + gx * scale + sx;
            const y = startY + gy * scale + sy;
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            const index = (y * width + x) * 4;
            png.data[index] = 20;
            png.data[index + 1] = 20;
            png.data[index + 2] = 20;
          }
        }
      }
    }
  }
  return png;
}

test('compareFrames detects color differences', () => {
  const reference = solidFrame(64, 64, [100, 100, 100]);
  const render = solidFrame(64, 64, [120, 120, 120]);
  const result = compareFrames(reference, render, { changedPixelDelta: 24 });

  assert.ok(result.mae > 0, 'MAE should be positive');
  assert.ok(result.mae >= 19 && result.mae <= 21, `Expected MAE ~20, got ${result.mae}`);
  // Flat blocks have zero variance, so SSIM is bounded by the luminance term:
  // a pure brightness change keeps structure but cannot reach 1.0.
  assert.ok(result.ssim > 0.95 && result.ssim < 1.0, `Expected SSIM ~0.98, got ${result.ssim}`);
  assert.ok(result.changedFraction === 0, 'Delta 20 < threshold 24 should not count as changed');
});

test('compareFrames detects changed pixels above threshold', () => {
  const reference = solidFrame(64, 64, [100, 100, 100]);
  const render = solidFrame(64, 64, [130, 130, 130]);
  const result = compareFrames(reference, render, { changedPixelDelta: 24 });

  assert.ok(result.mae >= 29 && result.mae <= 31, `Expected MAE ~30, got ${result.mae}`);
  assert.equal(result.changedFraction, 1.0, 'All pixels differ by 30 > 24 threshold');
  assert.ok(result.diffBbox, 'Should have bounding box');
  assert.equal(result.diffBbox.x, 0);
  assert.equal(result.diffBbox.y, 0);
  assert.equal(result.diffBbox.width, 64);
  assert.equal(result.diffBbox.height, 64);
});

test('compareFrames detects layout shift', () => {
  // Moving a bright block produces a strong, localized structural difference.
  const reference = featureFrame(128, 128, 32, 32, 32, 32);
  const render = featureFrame(128, 128, 64, 48, 32, 32);
  const result = compareFrames(reference, render, { changedPixelDelta: 24 });

  assert.ok(result.mae > 5, 'Relocated block should have significant MAE');
  assert.ok(result.ssim < 0.95, 'Relocation reduces structural similarity');
  assert.ok(result.changedFraction > 0.05, 'Both block footprints changed');
  assert.ok(result.diffBbox, 'Should have a bounding box spanning both positions');
  assert.ok(result.diffCentroid, 'Should have a centroid');
  assert.equal(result.topCells.length, 3, 'Should rank top cells');
});

test('estimateShift detects translation', () => {
  // A single bright block on a dark field is unambiguous. A full-resolution
  // shift of (4, 6) maps to (2, 3) on the estimator's 2x downsampled grid.
  const reference = featureFrame(128, 128, 40, 40, 24, 24);
  const render = shiftedFrame(reference, 4, 6);
  const result = estimateShift(reference, render, { radius: 6 });

  assert.equal(result.dx, 2, 'Should detect horizontal shift in downsampled units');
  assert.equal(result.dy, 3, 'Should detect vertical shift in downsampled units');
  assert.ok(result.residual < result.zeroResidual, 'Aligned residual should be lower');
  assert.ok(result.improvement > 0.3, 'Shift detection should improve alignment significantly');
});

test('estimateShift reports zero shift for identical frames', () => {
  const reference = gradientFrame(128, 128);
  const result = estimateShift(reference, reference, { radius: 6 });

  assert.equal(result.dx, 0);
  assert.equal(result.dy, 0);
  assert.equal(result.residual, 0);
  assert.equal(result.zeroResidual, 0);
  assert.equal(result.improvement, 0);
});

test('compareFrames detects ink (text) differences', () => {
  const reference = textFrame(256, 128, 'TEXT', 4);
  const render = textFrame(256, 128, 'TEST', 4);
  const result = compareFrames(reference, render, { changedPixelDelta: 24 });

  assert.ok(result.inkIou !== null, 'Should compute ink IoU for text frames');
  assert.ok(result.inkIou < 0.95, 'Different text should have lower ink IoU');
  assert.ok(result.mae > 0, 'MAE should be positive');
});

test('compareFrames returns null inkIoU for solid backgrounds', () => {
  const reference = solidFrame(128, 128, [200, 200, 200]);
  const render = solidFrame(128, 128, [200, 200, 200]);
  const result = compareFrames(reference, render, { changedPixelDelta: 24 });

  assert.equal(result.inkIou, null, 'Solid frames should have null ink IoU');
  assert.equal(result.mae, 0);
  assert.equal(result.ssim, 1.0);
  assert.equal(result.changedFraction, 0);
});

test('compareFrames rejects dimension mismatch', () => {
  const reference = solidFrame(64, 64, [100, 100, 100]);
  const render = solidFrame(128, 128, [100, 100, 100]);

  assert.throws(() => compareFrames(reference, render, { changedPixelDelta: 24 }), {
    name: 'WorkflowError',
    code: 'QA_FRAME_DIMENSIONS'
  });
});

test('shotStatus applies threshold logic correctly', () => {
  const thresholds = {
    shotPassMae: 5,
    shotPassSsim: 0.8,
    shotReviewMae: 24,
    shotReviewSsim: 0.3
  };

  // Pass: low MAE, high SSIM
  assert.equal(shotStatus({ maeMean: 2, ssimMean: 0.95 }, thresholds), 'pass');
  assert.equal(shotStatus({ maeMean: 5, ssimMean: 0.8 }, thresholds), 'pass');

  // Needs review: moderate MAE or SSIM
  assert.equal(shotStatus({ maeMean: 10, ssimMean: 0.9 }, thresholds), 'needs_review');
  assert.equal(shotStatus({ maeMean: 2, ssimMean: 0.5 }, thresholds), 'needs_review');
  assert.equal(shotStatus({ maeMean: 24, ssimMean: 0.8 }, thresholds), 'needs_review');

  // Fail: high MAE or low SSIM
  assert.equal(shotStatus({ maeMean: 25, ssimMean: 0.9 }, thresholds), 'fail');
  assert.equal(shotStatus({ maeMean: 2, ssimMean: 0.29 }, thresholds), 'fail');
  assert.equal(shotStatus({ maeMean: 30, ssimMean: 0.2 }, thresholds), 'fail');
});

test('aggregateShot computes correct statistics', () => {
  const thresholds = {
    shotPassMae: 5,
    shotPassSsim: 0.8,
    shotReviewMae: 24,
    shotReviewSsim: 0.3
  };

  const frames = [
    { metrics: { mae: 2.5, ssim: 0.95, changedFraction: 0.01, inkIou: 0.9 } },
    { metrics: { mae: 3.5, ssim: 0.92, changedFraction: 0.02, inkIou: 0.85 } },
    { metrics: { mae: 5.5, ssim: 0.88, changedFraction: 0.03, inkIou: 0.8 } },
    { metrics: { mae: 4.5, ssim: 0.90, changedFraction: 0.015, inkIou: null } }
  ];

  const result = aggregateShot('test-shot', frames, thresholds);

  assert.equal(result.shotId, 'test-shot');
  assert.equal(result.metrics.frameCount, 4);
  assert.equal(result.metrics.maeMean, 4.0);
  assert.equal(result.metrics.maeMedian, 4.0);
  assert.equal(result.metrics.maeMax, 5.5);
  assert.equal(result.metrics.maeP95, 5.5);
  assert.equal(result.metrics.ssimMean, 0.9125);
  assert.equal(result.metrics.ssimMin, 0.88);
  assert.equal(result.metrics.changedFractionMean, 0.0188);
  assert.equal(result.metrics.inkIouMean, 0.85);
  assert.equal(result.worst.metrics.mae, 5.5);
  assert.equal(result.status, 'pass');
});

test('aggregateShot handles null ink values', () => {
  const thresholds = {
    shotPassMae: 5,
    shotPassSsim: 0.8,
    shotReviewMae: 24,
    shotReviewSsim: 0.3
  };

  const frames = [
    { metrics: { mae: 2, ssim: 0.95, changedFraction: 0.01, inkIou: null } },
    { metrics: { mae: 3, ssim: 0.92, changedFraction: 0.02, inkIou: null } }
  ];

  const result = aggregateShot('solid-shot', frames, thresholds);

  assert.equal(result.metrics.inkIouMean, null, 'All-null ink should aggregate to null');
});

test('aggregateShot detects failure status', () => {
  const thresholds = {
    shotPassMae: 5,
    shotPassSsim: 0.8,
    shotReviewMae: 24,
    shotReviewSsim: 0.3
  };

  const frames = [
    { metrics: { mae: 30, ssim: 0.25, changedFraction: 0.8, inkIou: 0.1 } },
    { metrics: { mae: 28, ssim: 0.28, changedFraction: 0.75, inkIou: 0.12 } }
  ];

  const result = aggregateShot('failed-shot', frames, thresholds);

  assert.equal(result.status, 'fail');
  assert.ok(result.metrics.maeMean > 24);
  assert.ok(result.metrics.ssimMean < 0.3);
});
