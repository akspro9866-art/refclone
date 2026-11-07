// Deterministic contract for the analytical curve fitter: known cubic/spring
// recovery, fail-closed input validation, bounded parameters, and an overshoot
// amplitude whose generated expression agrees with the numeric evaluator.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fitCurve, curveAt, curveExpression, bezierAt } from '../../src/math/curveFitter.ts';

const samplesFrom = (kind, params, count = 41) =>
  Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return { t, y: curveAt({ kind, params }, t) };
  });

const evalExpression = (expression, t) =>
  new vm.Script(expression).runInNewContext({ t }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });

test('fitCurve recovers a known cubic bezier and accepts it', () => {
  const params = [0.42, 0, 0.58, 1];
  const fit = fitCurve(samplesFrom('bezier', params, 21));
  assert.equal(fit.kind, 'bezier');
  assert.equal(fit.accepted, true);
  assert.ok(fit.rmse < 1e-3, `rmse ${fit.rmse}`);
  assert.ok(fit.maxError < 1e-3, `maxError ${fit.maxError}`);
  params.forEach((expected, i) => assert.ok(Math.abs(fit.params[i] - expected) < 0.02, `param ${i}: ${fit.params[i]} vs ${expected}`));
});

test('fitCurve recovers a known spring within bounds and accepts it', () => {
  const fit = fitCurve(samplesFrom('spring', [0.3, 8, 1.15]));
  assert.equal(fit.kind, 'spring');
  assert.equal(fit.accepted, true);
  assert.ok(fit.rmse < 1e-3, `rmse ${fit.rmse}`);
  assert.ok(fit.overshootPeak.value > 0, 'a spring overshoots its endpoint');
  const bounds = [[0.05, 0.95], [0.5, 40], [0.7, 1.3]];
  fit.params.forEach((value, i) => assert.ok(value >= bounds[i][0] && value <= bounds[i][1], `param ${i} bounded: ${value}`));
});

test('bezier parameters stay inside the qualified box for an aggressive ease', () => {
  // Dips below zero early but never overshoots the endpoint, so it stays a
  // bezier (an overshooting trajectory is classified as a spring instead).
  const fit = fitCurve(samplesFrom('bezier', [0.9, -0.4, 0.1, 1], 33));
  assert.equal(fit.kind, 'bezier');
  const bounds = [[0, 1], [-0.5, 1.5], [0, 1], [-0.5, 1.5]];
  fit.params.forEach((value, i) => assert.ok(value >= bounds[i][0] - 1e-9 && value <= bounds[i][1] + 1e-9, `param ${i} bounded: ${value}`));
});

test('the spring expression reproduces curveAt including amplitude != 1', () => {
  const fit = fitCurve(samplesFrom('spring', [0.25, 10, 1.25]));
  assert.equal(fit.kind, 'spring');
  assert.notEqual(fit.params[2], 1, 'amplitude is carried, not normalized away');
  const first = 0, last = 1;
  for (const u of [0, 0.13, 0.37, 0.5, 0.71, 0.9, 1]) {
    const numeric = curveAt(fit, u);
    const expressed = evalExpression(fit.expression, u);
    assert.ok(Math.abs(numeric - expressed) < 1e-9, `expression agrees at u=${u}: ${expressed} vs ${numeric}`);
  }
  // The reported overshoot peak is consistent with the normalized evaluator.
  const peakU = (fit.overshootPeak.t - first) / (last - first);
  assert.ok(Math.abs(curveAt(fit, peakU) - (1 + fit.overshootPeak.value)) <= fit.maxError + 1e-9, 'overshootPeak.value matches the curve peak');
});

test('the bezier expression reproduces bezierAt across the domain', () => {
  const fit = fitCurve(samplesFrom('bezier', [0.33, 0.33, 0.67, 0.67], 25));
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(evalExpression(fit.expression, u) - bezierAt(u, fit.params)) < 1e-9, `expression agrees at u=${u}`);
  }
  assert.equal(curveExpression(fit), fit.expression, 'expression is generated from the bounded params');
});

test('fitCurve rejects non-finite, unordered, too-short and closed samples', () => {
  assert.throws(() => fitCurve([{ t: 0, y: 0 }, { t: 1, y: 1 }]), /CURVE_SAMPLES/);
  assert.throws(() => fitCurve([{ t: 0, y: 0 }, { t: 1, y: 1 }, { t: 1, y: 2 }, { t: 2, y: 3 }]), /CURVE_SAMPLES/);
  assert.throws(() => fitCurve([{ t: 0, y: 0 }, { t: 1, y: NaN }, { t: 2, y: 2 }, { t: 3, y: 3 }]), /CURVE_SAMPLES/);
  assert.throws(() => fitCurve([{ t: 0, y: 0 }, { t: 1, y: 1 }, { t: 2, y: 2 }, { t: 3, y: Infinity }]), /CURVE_SAMPLES/);
  assert.throws(() => fitCurve([{ t: 0, y: 5 }, { t: 1, y: 5 }, { t: 2, y: 5 }, { t: 3, y: 5 }]), /CURVE_CLOSED_OR_STATIC/);
  assert.throws(() => fitCurve(samplesFrom('bezier', [0.42, 0, 0.58, 1], 600)), /CURVE_SAMPLES/);
});

test('fitCurve rejects an out-of-budget tolerance', () => {
  const samples = samplesFrom('bezier', [0.42, 0, 0.58, 1], 12);
  for (const tolerance of [0, -0.01, 0.06, NaN]) {
    assert.throws(() => fitCurve(samples, tolerance), /CURVE_SAMPLES/);
  }
});

test('a noisy closed-loop trajectory is not accepted as a qualified beat', () => {
  // A wobble the analytical family cannot fit within tolerance must block.
  const samples = Array.from({ length: 24 }, (_, i) => ({ t: i, y: i + 6 * Math.sin(i * 1.7) }));
  const fit = fitCurve(samples);
  assert.equal(fit.accepted, false, `rmse ${fit.rmse} should exceed tolerance`);
});