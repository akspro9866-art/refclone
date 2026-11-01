import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  compareFrames, compareRegions, deriveRegions, elementRects, estimateShift,
  measureRegion, modalColor, shotStatus, aggregateShot
} from '../src/qa.mjs';
import { textLine } from './fixtures.mjs';

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

// The shared 5x7 bitmap font (test/fixtures.mjs) gives distinct characters distinct ink,
// which is what the ink and region tests below need: solid blocks cannot be registered
// vertically at all, so they cannot show what a per-region measurement does.
function textFrame(width, height, text, scale = 4) {
  const png = solidFrame(width, height, [255, 255, 255]);
  return textLine(png, text, {
    left: Math.floor((width - text.length * 6 * scale) / 2),
    top: Math.floor((height - 7 * scale) / 2),
    color: [20, 20, 20],
    scale
  });
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

// Region scoring fixtures: two lines of copy on a flat field, so each reference ink band
// is one line and the intended answer for each case is known from how it was drawn.
const REGION_SIZE = { width: 220, height: 100 };
const INK = [20, 20, 20], FAINT = [150, 150, 150];

function twoLines({ aLeft = 12, bTop = 60, bLeft = 12, bText = 'LINE', aColor = INK, scale = 3 } = {}) {
  const png = solidFrame(REGION_SIZE.width, REGION_SIZE.height, [255, 255, 255]);
  textLine(png, 'TEXT', { left: aLeft, top: 20, color: aColor, scale });
  textLine(png, bText, { left: bLeft, top: bTop, color: INK, scale });
  return png;
}

const REGION_ELEMENTS = [
  { id: 'el-a', rect: { x: 12, y: 20, width: 66, height: 21 } },
  { id: 'el-b', rect: { x: 12, y: 60, width: 66, height: 21 } }
];

test('regions are the reference ink bands, with the background they were measured against', () => {
  const reference = twoLines();
  assert.equal(modalColor(reference).hex, '#ffffff');
  const derived = deriveRegions(reference);
  assert.equal(derived.background, '#ffffff');
  assert.deepEqual(derived.regions.map(region => region.rect.y), [20, 60]);
  assert.deepEqual(derived.regions.map(region => region.rect.height), [21, 21]);
  assert.deepEqual(derived.regions.map(region => region.id), ['rows-20-41', 'rows-60-81']);
  assert.equal(derived.found, 2);
  assert.equal(derived.truncated, 0);
  assert.match(derived.basis, /reference ink band/);

  // A dense frame is capped by ink weight, not by the first rows it happens to reach.
  const busy = solidFrame(REGION_SIZE.width, REGION_SIZE.height, [255, 255, 255]);
  for (const top of [8, 32, 56, 80]) textLine(busy, 'TEXT', { left: 12, top, color: INK, scale: 3 });
  const capped = deriveRegions(busy, { regionMaxCount: 2 });
  assert.equal(capped.found, 4);
  assert.equal(capped.truncated, 2);
  assert.equal(capped.regions.length, 2);
});

test('a slid line reads as position, with the correction a patch needs', () => {
  const reference = twoLines();
  const result = compareRegions(reference, twoLines({ aLeft: 15 }), { elementRects: REGION_ELEMENTS });
  assert.equal(result.background, '#ffffff');
  assert.match(result.basis, /2 of 2 reference ink band/);
  const [upper, lower] = result.regions;
  assert.equal(upper.diagnostic, 'position');
  assert.equal(upper.elementId, 'el-a');
  assert.equal(upper.drift.dxPx, 3, 'the render content sits 3 px right of the reference');
  assert.equal(upper.drift.dyPx, 0);
  assert.deepEqual(upper.drift.correctionPx, { dx: -3, dy: 0 });
  assert.equal(upper.drift.quantumPx, 0.125);
  assert.equal(upper.geometry.gain, 1, 'one rigid slide accounts for the whole region error');
  assert.equal(upper.alsoAppearance, false);
  assert.equal(lower.diagnostic, 'match', 'the untouched line is not reported as a problem');
  assert.deepEqual(
    [result.summary.position, result.summary.texture, result.summary.mixed, result.summary.attributed],
    [1, 0, 0, 2]
  );
  assert.equal(result.summary.worstRegionId, 'rows-20-41');
});

test('a displacement wider than the frame shift radius is still placement, not mystery', () => {
  const reference = twoLines();
  // 7 px of drift is past the whole-frame search radius (6) and inside the region drift
  // range (8). Probing the slide only as far as the frame radius would call a purely
  // displaced line "mixed", because the rest of the slide was never tested.
  const result = compareRegions(reference, twoLines({ aLeft: 19 }), { elementRects: REGION_ELEMENTS });
  const [upper] = result.regions;
  assert.equal(upper.drift.dxPx, 7);
  assert.equal(upper.diagnostic, 'position');
  assert.equal(upper.geometry.gain, 1, `the measured slide removes the whole error (gain ${upper.geometry.gain})`);
  assert.deepEqual(upper.drift.correctionPx, { dx: -7, dy: 0 });
  assert.equal(upper.alsoAppearance, false);
});

test('a glyph change is appearance: no slide explains it, so nothing is patchable', () => {
  const reference = twoLines();
  const result = compareRegions(reference, twoLines({ bText: 'SINE' }), { elementRects: REGION_ELEMENTS });
  const [, lower] = result.regions;
  assert.equal(lower.diagnostic, 'texture');
  assert.equal(lower.elementId, 'el-b');
  assert.ok(lower.mae > 0);
  assert.ok(lower.geometry.gain <= 0.25, `gain ${lower.geometry.gain}`);
  assert.equal(lower.drift.aboveNoiseFloor, false);
  assert.equal(result.summary.position, 0, 'an appearance error must not be reported as a position one');
  assert.equal(result.summary.texture, 1);
});

test('a drift at or under the patch floor is aligned: reported, never patched', () => {
  const reference = twoLines();
  // Two pixels of real drift, but a floor above it: the slide is not something a
  // position key can be set to, so the honest verdict is "placed as well as it measures".
  const result = compareRegions(reference, twoLines({ aLeft: 14 }), { regionNoiseFloorPx: 3.5 });
  const [upper] = result.regions;
  assert.equal(upper.diagnostic, 'aligned');
  assert.equal(upper.drift.aboveNoiseFloor, false);
  assert.equal(upper.geometry.gain, 1);
  assert.match(upper.reason, /patch floor/);
  assert.deepEqual([result.summary.aligned, result.summary.position], [1, 0]);
});

test('a slide and a texture change together read as mixed, or as position that also needs appearance', () => {
  const reference = twoLines();
  // A 2 px slide over faint ink: the slide helps, but most of the error is in the pixels.
  const mixed = compareRegions(reference, twoLines({ aLeft: 14, aColor: FAINT })).regions[0];
  assert.equal(mixed.diagnostic, 'mixed');
  assert.ok(mixed.geometry.gain > 0.25 && mixed.geometry.gain < 0.6, `gain ${mixed.geometry.gain}`);
  assert.ok(mixed.geometry.maeAfterShift > 3, 'the residual after the best slide is real');

  // A wrong glyph on a shifted line is mostly geometry, and still also an appearance problem.
  const both = compareRegions(reference, twoLines({ bLeft: 14, bText: 'SINE' })).regions[1];
  assert.equal(both.diagnostic, 'position');
  assert.equal(both.alsoAppearance, true);
});

test('measureRegion refuses what it cannot honestly score', () => {
  const reference = twoLines();
  const tooSmall = measureRegion(reference, twoLines({ aLeft: 15 }), { id: 'sliver', rect: { x: 0, y: 20, width: 220, height: 6 } });
  assert.equal(tooSmall.diagnostic, 'unmeasurable');
  assert.equal(tooSmall.reason, 'region-too-small');
  assert.equal(tooSmall.mae, null);
  assert.throws(() => measureRegion(reference, reference, { rect: { x: 1.5, y: 20, width: 20, height: 20 } }),
    { code: 'QA_REGION_INVALID' });
});

test('elementRects reads every geometry shape a plan may carry, and none it cannot', () => {
  const frame = { width: 200, height: 100 };
  const rects = elementRects({
    elements: [
      { id: 'normalized', parameters: { bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } } },
      { id: 'pixel-bounds', parameters: { pixelBounds: { left: 10, top: 20, rightExclusive: 60, bottomExclusive: 40 } } },
      { id: 'centred', parameters: { widthPx: 40, heightPx: 20, center: { x: 100, y: 50 } } },
      { id: 'positioned', parameters: { widthPx: 40, heightPx: 20, position: { x: 100, y: 50 } } },
      { id: 'origin', parameters: { widthPx: 40, heightPx: 20, origin: { x: 100, y: 50 } } },
      // What a generic or saas scene-plan actually writes for a text or image layer.
      { id: 'planner-centre', parameters: { widthPx: 46, heightPx: 14, centerXPx: 43, centerYPx: 27, x: -57, y: 23 } },
      // A full-frame background reuses the same keys with the comp centre as (0, 0).
      // That is not a frame-pixel centre, so the layer stays unattributed.
      { id: 'planner-background', parameters: { widthPx: 200, heightPx: 100, centerXPx: 0, centerYPx: 0 } },
      { id: 'no-geometry', parameters: { text: 'hi' } },
      { id: 'degenerate', parameters: { widthPx: 0, heightPx: 5, center: { x: 1, y: 1 } } }
    ]
  }, frame);
  assert.deepEqual(rects.map(entry => entry.rect), [
    { x: 20, y: 20, width: 100, height: 40 },
    { x: 10, y: 20, width: 50, height: 20 },
    { x: 80, y: 40, width: 40, height: 20 },
    { x: 80, y: 40, width: 40, height: 20 },
    { x: 100, y: 50, width: 40, height: 20 },
    { x: 20, y: 20, width: 46, height: 14 }
  ]);
  assert.deepEqual(rects.map(entry => entry.id),
    ['normalized', 'pixel-bounds', 'centred', 'positioned', 'origin', 'planner-centre']);
});

test('a supplied region list is scored without rediscovering the bands', () => {
  const reference = twoLines();
  const result = compareRegions(reference, twoLines({ bTop: 64 }), {
    regions: [{ id: 'given', rect: { x: 0, y: 60, width: 220, height: 21 } }],
    elementRects: REGION_ELEMENTS
  });
  assert.equal(result.basis, 'supplied region list');
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].id, 'given');
  assert.equal(result.regions[0].diagnostic, 'position');
  assert.equal(result.regions[0].elementId, 'el-b');
});
