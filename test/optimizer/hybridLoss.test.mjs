// Exact-weight contract for the hybrid loss: GIoU geometry, measured-color
// foreground alpha (not composite opacity), the named perceptual channel, and
// fail-closed rejection of missing metrics and self-comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { giou, hybridLoss, foregroundMask, maskIoU, cavalryBoxToRaster, assertRaster, assertBox } from '../../src/optimizer/hybridLoss.ts';

const BG = [0, 0, 0];
const COLOR = [255, 0, 0];
const box = (x, y, width, height) => ({ x, y, width, height });

function raster(rectX, { width = 20, height = 20, color = COLOR, alpha = 255 } = {}) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = BG[0]; image.data[i * 4 + 1] = BG[1]; image.data[i * 4 + 2] = BG[2]; image.data[i * 4 + 3] = 255;
  }
  for (let y = 5; y < 15; y++) for (let x = rectX; x < rectX + 10; x++) {
    const i = (y * width + x) * 4;
    image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = alpha;
  }
  return image;
}

const critical = { start: 0, peakVelocity: 0, overshoot: 0, settle: 0 };
const layers = [{ layerId: 'l1', color: COLOR }];
const frame = (image, b) => ({ image, boxes: { l1: b } });

test('giou is 1 for identical boxes, 1/3 for half overlap, negative when disjoint', () => {
  assert.equal(giou(box(0, 0, 10, 10), box(0, 0, 10, 10)), 1);
  assert.ok(Math.abs(giou(box(0, 0, 10, 10), box(5, 0, 10, 10)) - 1 / 3) < 1e-12);
  const disjoint = giou(box(0, 0, 10, 10), box(100, 100, 10, 10));
  assert.ok(disjoint < 0 && disjoint >= -1, `disjoint GIoU penalizes distance: ${disjoint}`);
  // Farther apart is a worse (more negative) score than touching.
  assert.ok(giou(box(0, 0, 10, 10), box(200, 200, 10, 10)) < disjoint);
});

test('hybridLoss applies the exact requested weights per row', () => {
  const reference = { 0: frame(raster(2), box(2, 5, 10, 10)) };
  const candidate = { 0: frame(raster(6), box(6, 5, 10, 10)) };
  const loss = hybridLoss({ reference, candidate, criticalFrames: critical, layers, background: BG });
  assert.equal(loss.rows.length, 4, 'one row per critical event per layer');
  for (const row of loss.rows) {
    assert.equal(row.perceptual, Math.max(1 - row.ssim, row.rgbMae), 'perceptual is max(1-SSIM, RGB-MAE)');
    const expected = 0.55 * (1 - row.giou) + 0.25 * (1 - row.alphaIoU) + 0.20 * row.perceptual;
    assert.ok(Math.abs(row.loss - expected) < 1e-12, `exact weights: ${row.loss} vs ${expected}`);
    assert.ok(row.giou < 1 && row.alphaIoU < 1, 'a shifted candidate is penalized');
  }
  const mean = loss.rows.reduce((s, r) => s + r.loss, 0) / loss.rows.length;
  assert.ok(Math.abs(loss.loss - mean) < 1e-12);
  assert.match(loss.perceptualMethod, /SSIM/);
  assert.match(loss.alphaMethod, /foreground mask/);
});

test('a pixel-identical candidate scores zero loss', () => {
  const a = raster(2), b = raster(2);
  const loss = hybridLoss({ reference: { 0: frame(a, box(2, 5, 10, 10)) }, candidate: { 0: frame(b, box(2, 5, 10, 10)) }, criticalFrames: critical, layers, background: BG });
  assert.equal(loss.loss, 0);
  assert.equal(loss.rows[0].ssim, 1);
  assert.equal(loss.rows[0].rgbMae, 0);
  assert.equal(loss.rows[0].giou, 1);
  assert.equal(loss.rows[0].alphaIoU, 1);
});

test('foreground alpha is measured against the background, not composite opacity', () => {
  const image = raster(2);
  const mask = foregroundMask(image, BG, COLOR);
  assert.equal(mask.length, 400);
  assert.equal(mask.reduce((s, v) => s + v, 0), 100, 'exactly the 10x10 foreground is selected');
  // A different-colored foreground is excluded by the color selector.
  const other = foregroundMask(image, BG, [0, 255, 0]);
  assert.equal(other.reduce((s, v) => s + v, 0), 0);
  // Without a color selector any non-background pixel counts.
  const any = foregroundMask(image, BG);
  assert.equal(any.reduce((s, v) => s + v, 0), 100);
  assert.equal(maskIoU(mask, foregroundMask(raster(2), BG, COLOR)), 1);
  assert.ok(maskIoU(mask, foregroundMask(raster(6), BG, COLOR)) < 1);
});

test('hybridLoss rejects missing layers, frames, boxes and self-comparison', () => {
  const a = raster(2);
  const good = { reference: { 0: frame(a, box(2, 5, 10, 10)) }, candidate: { 0: frame(raster(2), box(2, 5, 10, 10)) }, criticalFrames: critical, layers, background: BG };
  assert.throws(() => hybridLoss({ ...good, layers: [] }), /LOSS_LAYERS_MISSING/);
  assert.throws(() => hybridLoss({ ...good, criticalFrames: { start: 0, peakVelocity: 0, overshoot: 0 } }), /LOSS_FRAME_MISSING/);
  assert.throws(() => hybridLoss({ ...good, candidate: {} }), /LOSS_FRAME_MISSING/);
  assert.throws(() => hybridLoss({ ...good, candidate: { 0: { image: raster(2), boxes: {} } } }), /LOSS_BOX_MISSING/);
  // The very same raster object on both sides is not evidence of a match.
  const shared = frame(a, box(2, 5, 10, 10));
  assert.throws(() => hybridLoss({ ...good, reference: { 0: shared }, candidate: { 0: shared } }), /LOSS_SELF_COMPARISON/);
});

test('raster and box guards reject malformed pixels and geometry', () => {
  assert.throws(() => assertRaster({ width: 2, height: 2, data: new Uint8Array(3) }), /LOSS_PIXELS_MISSING/);
  assert.throws(() => assertBox(box(0, 0, 0, 10)), /LOSS_BOX_MISSING/);
  assert.throws(() => assertBox(box(0, 0, NaN, 10)), /LOSS_BOX_MISSING/);
  assert.throws(() => foregroundMask(raster(2), [0, 0]), /LOSS_BACKGROUND_MISSING/);
  assert.throws(() => maskIoU(new Uint8Array(0), new Uint8Array(0)), /LOSS_MASK_MISSING/);
});

test('cavalryBoxToRaster flips the y-up comp centre into raster top-left space', () => {
  const converted = cavalryBoxToRaster({ x: 0, y: 0, width: 10, height: 10, centreX: 0, centreY: 0 }, 100, 80);
  assert.deepEqual(converted, box(45, 35, 10, 10));
  assert.throws(() => cavalryBoxToRaster({ x: 0, y: 0, width: 10, height: 10, centreX: NaN, centreY: 0 }, 100, 80), /LOSS_CENTRE_MISSING/);
});