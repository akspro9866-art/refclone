import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockFlow,
  accelerationZeroCrossings,
  fitContourBezier,
  solvePivot,
  toGrayScale,
  OPTICAL_VERSION
} from '../src/optical.mjs';

// Deterministic smooth texture: every pixel is authored by the test, so a
// measured displacement can be checked against the exact intended value.
const W = 96;
const H = 96;
const pattern = (x, y) =>
  128 + 50 * Math.sin(x / 5.3) * Math.cos(y / 4.1) + 20 * Math.sin((x + y) / 7.7);

const makeFrame = (dx = 0, dy = 0, width = W, height = H) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      const sy = y - dy;
      const value = sx >= 0 && sy >= 0 && sx < width && sy < height ? pattern(sx, sy) : 128;
      const at = (y * width + x) * 4;
      data[at] = Math.round(value);
      data[at + 1] = Math.round(value);
      data[at + 2] = Math.round(value);
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
};

describe('optical: module surface', () => {
  it('exports a version and all measurement primitives', () => {
    assert.equal(typeof OPTICAL_VERSION, 'string');
    assert.equal(typeof blockFlow, 'function');
    assert.equal(typeof accelerationZeroCrossings, 'function');
    assert.equal(typeof fitContourBezier, 'function');
    assert.equal(typeof solvePivot, 'function');
    assert.equal(typeof toGrayScale, 'function');
  });
});

describe('optical: blockFlow', () => {
  it('recovers a known translation within sub-pixel tolerance', () => {
    const frameA = makeFrame(0, 0);
    const frameB = makeFrame(4, -6);
    const box = { x: 16, y: 16, width: 64, height: 64 };

    const flow = blockFlow(frameA, frameB, box);

    assert.ok(Math.abs(flow.vx - 4) < 0.75, `vx ${flow.vx} should be within 0.75 of 4`);
    assert.ok(Math.abs(flow.vy + 6) < 0.75, `vy ${flow.vy} should be within 0.75 of -6`);
    assert.ok(Math.abs(flow.magnitude - Math.hypot(4, 6)) < 0.75);
    assert.ok(flow.confidence > 0.5, `confidence ${flow.confidence} should exceed 0.5`);
  });

  it('recovers a negative displacement and reports zero motion for identical frames', () => {
    const frameA = makeFrame(0, 0);
    const box = { x: 16, y: 16, width: 64, height: 64 };

    const backwards = blockFlow(frameA, makeFrame(-3, 2), box);
    assert.ok(Math.abs(backwards.vx + 3) < 0.75, `vx ${backwards.vx} should be within 0.75 of -3`);
    assert.ok(Math.abs(backwards.vy - 2) < 0.75, `vy ${backwards.vy} should be within 0.75 of 2`);

    const still = blockFlow(frameA, makeFrame(0, 0), box);
    assert.ok(Math.abs(still.vx) < 0.1);
    assert.ok(Math.abs(still.vy) < 0.1);
    assert.ok(still.confidence > 0.5);
  });

  it('reports zero confidence on a textureless region instead of inventing motion', () => {
    const flat = () => {
      const data = new Uint8Array(W * H * 4).fill(100);
      return { data, width: W, height: H };
    };
    const flow = blockFlow(flat(), flat(), { x: 16, y: 16, width: 64, height: 64 });
    assert.equal(flow.vx, 0);
    assert.equal(flow.vy, 0);
    assert.equal(flow.confidence, 0);
  });

  it('is deterministic across repeated calls', () => {
    const box = { x: 16, y: 16, width: 64, height: 64 };
    const first = blockFlow(makeFrame(0, 0), makeFrame(4, -6), box);
    const second = blockFlow(makeFrame(0, 0), makeFrame(4, -6), box);
    assert.deepEqual(first, second);
  });

  it('rejects mismatched frames and degenerate boxes', () => {
    assert.throws(
      () => blockFlow(makeFrame(0, 0), makeFrame(0, 0, 80, 80), { x: 0, y: 0, width: 32, height: 32 }),
      { code: 'OPTICAL_INVALID' }
    );
    assert.throws(
      () => blockFlow(makeFrame(0, 0), makeFrame(0, 0), { x: 5000, y: 5000, width: 8, height: 8 }),
      { code: 'OPTICAL_INVALID' }
    );
  });
});

describe('optical: accelerationZeroCrossings', () => {
  it('finds the four acceleration sign changes of a two-period sine', () => {
    const series = [];
    for (let i = 0; i < 64; i++) {
      series.push({ frame: i, velocity: Math.sin((2 * Math.PI * i) / 32) });
    }
    const crossings = accelerationZeroCrossings(series);
    assert.equal(crossings.length, 4);
    const expected = [9, 25, 41, 57]; // one sample after each velocity extremum
    crossings.forEach((frame, index) => {
      assert.ok(Math.abs(frame - expected[index]) <= 1, `crossing ${frame} near ${expected[index]}`);
    });
  });

  it('returns no crossings for a flat series within epsilon', () => {
    const series = [];
    for (let i = 0; i < 32; i++) {
      series.push({ frame: i, velocity: 1 + 1e-9 * Math.sin(i) });
    }
    assert.deepEqual(accelerationZeroCrossings(series), []);
  });

  it('accepts plain numeric magnitudes and ignores too-short series', () => {
    assert.deepEqual(accelerationZeroCrossings([0, 1, 0, -1, 0, 1, 0]), [2, 4, 6]);
    assert.deepEqual(accelerationZeroCrossings([1, 2]), []);
    assert.deepEqual(accelerationZeroCrossings([]), []);
  });

  it('supports non-uniform frame spacing', () => {
    const series = [
      { frame: 0, velocity: 0 },
      { frame: 10, velocity: 10 },
      { frame: 30, velocity: 10 },
      { frame: 40, velocity: 0 }
    ];
    // Acceleration rises, stays flat, then falls: one genuine sign change.
    assert.deepEqual(accelerationZeroCrossings(series), [40]);
  });
});

describe('optical: fitContourBezier', () => {
  const MW = 64;
  const MH = 64;

  const rectMask = () => {
    const mask = new Uint8Array(MW * MH);
    for (let y = 17; y <= 46; y++) {
      for (let x = 12; x <= 51; x++) mask[y * MW + x] = 255;
    }
    return mask;
  };

  it('fits the largest contour of a rectangle with low error', () => {
    const fit = fitContourBezier(rectMask(), { width: MW, height: MH });
    assert.equal(fit.closed, true);
    assert.ok(fit.segments.length >= 2 && fit.segments.length <= 4, `segments ${fit.segments.length}`);
    assert.equal(fit.controlPoints.length, fit.segments.length * 4);
    assert.ok(fit.errorRms < 1, `errorRms ${fit.errorRms} should be under 1 px on a rectangle`);
    for (const segment of fit.segments) {
      for (const point of [segment.p0, segment.p1, segment.p2, segment.p3]) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      }
    }
  });

  it('fits a circle within a small tolerance of the outline', () => {
    const mask = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (Math.hypot(x - 32, y - 32) <= 20) mask[y * MW + x] = 255;
      }
    }
    const fit = fitContourBezier(mask, { width: MW, height: MH });
    assert.ok(fit.segments.length >= 2 && fit.segments.length <= 4);
    assert.ok(fit.errorRms < 2, `errorRms ${fit.errorRms} should be under 2 px on a circle`);
  });

  it('uses the largest component when a mask holds several', () => {
    const mask = rectMask();
    for (let y = 2; y <= 6; y++) {
      for (let x = 2; x <= 6; x++) mask[y * MW + x] = 255;
    }
    const fit = fitContourBezier(mask, { width: MW, height: MH });
    // The rectangle dominates; its fit error stays low regardless of the blob.
    assert.ok(fit.errorRms < 1);
  });

  it('returns an empty fit for an empty mask and accepts bare Uint8Array input', () => {
    const fit = fitContourBezier(new Uint8Array(MW * MH), { width: MW, height: MH });
    assert.deepEqual(fit.segments, []);
    assert.equal(fit.closed, true);
    assert.equal(fit.errorRms, 0);
    assert.ok(fitContourBezier(rectMask(), { width: MW, height: MH }).segments.length >= 2);
  });

  it('requires dimensions when given a bare Uint8Array', () => {
    assert.throws(() => fitContourBezier(rectMask()), { code: 'OPTICAL_INVALID' });
  });
});

describe('optical: solvePivot', () => {
  it('recovers the pivot of synthetic circular motion within 1 px', () => {
    const samples = [];
    for (let i = 0; i < 16; i++) {
      const angle = (2 * Math.PI * i) / 16;
      samples.push({ x: 100 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle), angle });
    }
    const result = solvePivot(samples);
    assert.ok(Math.abs(result.pivotX - 100) < 1, `pivotX ${result.pivotX}`);
    assert.ok(Math.abs(result.pivotY - 50) < 1, `pivotY ${result.pivotY}`);
    assert.ok(result.residualRms < 0.5, `residualRms ${result.residualRms}`);
    assert.equal(result.isRotation, true);
  });

  it('reports isRotation false for linear motion', () => {
    const samples = [];
    for (let i = 0; i < 10; i++) samples.push({ x: i * 10, y: i * 10 });
    const result = solvePivot(samples);
    assert.equal(result.isRotation, false);
    assert.ok(Number.isFinite(result.pivotX) && Number.isFinite(result.pivotY));
    assert.ok(Number.isFinite(result.residualRms));
  });

  it('never reports rotation for fewer than three samples', () => {
    assert.equal(solvePivot([{ x: 0, y: 0 }, { x: 10, y: 0 }]).isRotation, false);
    assert.equal(solvePivot([{ x: 3, y: 4 }]).isRotation, false);
  });

  it('is deterministic and rejects empty input', () => {
    const samples = [];
    for (let i = 0; i < 12; i++) {
      const angle = (2 * Math.PI * i) / 12;
      samples.push({ x: 10 + 8 * Math.cos(angle), y: -5 + 8 * Math.sin(angle) });
    }
    assert.deepEqual(solvePivot(samples), solvePivot(samples));
    assert.throws(() => solvePivot([]), { code: 'OPTICAL_INVALID' });
  });
});
