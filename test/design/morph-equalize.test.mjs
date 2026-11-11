import test from 'node:test';
import assert from 'node:assert/strict';
import { MORPH_EQUALIZE_VERSION, equalizeMorphPaths, evaluateBezierEasing } from '../../src/design/morph-equalize.mjs';
import { WorkflowError } from '../../src/core.mjs';

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};
const commandCount = d => (d.match(/[a-zA-Z]/g) ?? []).filter(letter => letter.toUpperCase() !== 'M').length;

const TRIANGLE = 'M0 0 L100 0 L50 86.6 Z';
const SQUARE = 'M0 0 H100 V100 H0 Z';
const CIRCLE = 'M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50 Z';

test('equalized morph paths carry the same measured segment count', () => {
  const result = equalizeMorphPaths(TRIANGLE, SQUARE);
  assert.equal(result.version, MORPH_EQUALIZE_VERSION);
  assert.ok(result.segmentCount > 0);
  assert.equal(commandCount(result.from), commandCount(result.to), 'both paths draw the same number of segments');
  assert.ok(result.segmentCount >= commandCount(result.from), 'segmentCount is measured from the equalized paths');
  assert.notEqual(result.from, result.to);
  assert.match(result.hash, /^[0-9a-f]{64}$/);
});

test('equalization is deterministic and keyed by both paths', () => {
  const first = equalizeMorphPaths(TRIANGLE, SQUARE);
  const second = equalizeMorphPaths(TRIANGLE, SQUARE);
  assert.deepEqual(first, second);
  assert.notEqual(equalizeMorphPaths(TRIANGLE, CIRCLE).hash, first.hash);
  assert.notEqual(equalizeMorphPaths(SQUARE, TRIANGLE).hash, first.hash);
});

test('multi-subpath inputs keep their drawings and matching segment counts', () => {
  const result = equalizeMorphPaths('M0 0 L100 0 Z M10 10 L20 10 Z', 'M0 0 C10 10 20 10 30 0 Z');
  assert.ok(result.segmentCount > 4);
  assert.equal(commandCount(result.from), commandCount(result.to));
  assert.ok((result.from.match(/M/g) ?? []).length >= 2, 'the two source subpaths are preserved');
});

test('roundValues bounds the emitted decimals', () => {
  const result = equalizeMorphPaths(CIRCLE, SQUARE, { roundValues: 2 });
  for (const d of [result.from, result.to]) {
    for (const number of d.match(/-?\d+\.\d+/g) ?? []) {
      assert.ok(number.split('.')[1].length <= 2, `${number} keeps at most two decimals`);
    }
  }
  const coarse = equalizeMorphPaths(CIRCLE, SQUARE, { roundValues: 0 });
  assert.ok(!/\.\d/.test(coarse.from), 'roundValues 0 emits integers');
});

test('unusable paths and rounding requests are refused', () => {
  for (const [from, to] of [['', SQUARE], [TRIANGLE, '   '], [TRIANGLE, 'banana'], [42, SQUARE]]) {
    assert.throws(() => equalizeMorphPaths(from, to), errorCode('MORPH_PATH_INVALID'));
  }
  assert.throws(() => equalizeMorphPaths(TRIANGLE, SQUARE, { roundValues: 11 }), errorCode('MORPH_PATH_INVALID'));
  assert.throws(() => equalizeMorphPaths(TRIANGLE, SQUARE, { roundValues: 1.5 }), errorCode('MORPH_PATH_INVALID'));
});

test('cubic-bezier easing follows the CSS timing-function semantics', () => {
  assert.equal(evaluateBezierEasing([0, 0, 1, 1], 0), 0);
  assert.equal(evaluateBezierEasing([0, 0, 1, 1], 1), 1);
  assert.ok(Math.abs(evaluateBezierEasing([0, 0, 1, 1], 0.25) - 0.25) < 1e-6);
  const ease = [0.42, 0, 0.58, 1];
  let previous = -1;
  for (let step = 0; step <= 10; step += 1) {
    const value = evaluateBezierEasing(ease, step / 10);
    assert.ok(value >= previous, 'the ease curve is monotonic');
    assert.ok(value >= 0 && value <= 1);
    previous = value;
  }
  assert.ok(Math.abs(evaluateBezierEasing(ease, 0.5) - 0.5) < 1e-6, 'the symmetric curve passes through 0.5');
});

test('invalid easing inputs are refused', () => {
  for (const points of [[0, 0, 1], [0, 0, 1, 1, 1], [0, 0, 'a', 1], [-0.1, 0, 1, 1], [0, 0, 1.2, 1]]) {
    assert.throws(() => evaluateBezierEasing(points, 0.5), errorCode('BEZIER_INVALID'));
  }
  assert.throws(() => evaluateBezierEasing([0, 0, 1, 1], -0.1), errorCode('BEZIER_INVALID'));
  assert.throws(() => evaluateBezierEasing([0, 0, 1, 1], 1.1), errorCode('BEZIER_INVALID'));
});
