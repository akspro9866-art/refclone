import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUALIZE_PATHS_VERSION, equalizePaths, equalizeSegments, transform3d
} from '../../src/design/equalizePaths.mjs';
import * as cavalry from '../../src/cavalry/equalizePaths.mjs';
import { equalizeMorphPaths } from '../../src/design/morph-equalize.mjs';
import { WorkflowError } from '../../src/core.mjs';

const TRIANGLE = 'M0 0 L100 0 L50 86.6 Z';
const SQUARE = 'M0 0 H100 V100 H0 Z';
const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

test('equalizePaths: design re-exports the cavalry implementation', () => {
  assert.equal(equalizePaths, cavalry.equalizePaths);
  assert.equal(equalizeSegments, cavalry.equalizeSegments);
  assert.equal(transform3d, cavalry.transform3d);
  assert.equal(EQUALIZE_PATHS_VERSION, cavalry.EQUALIZE_PATHS_VERSION);
});

test('equalizePaths: a morph pair gets one measured segment count and a stable hash', () => {
  const first = equalizePaths(TRIANGLE, SQUARE);
  const second = equalizePaths(TRIANGLE, SQUARE);
  assert.deepEqual(first, second);
  assert.equal(first.version, EQUALIZE_PATHS_VERSION);
  assert.ok(first.segmentCount > 0);
  assert.equal(first.from.match(/[MLC]/g)?.length, first.to.match(/[MLC]/g)?.length);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(equalizeMorphPaths(TRIANGLE, SQUARE), first, 'the legacy design name stays byte-identical');
});

test('equalizeSegments: the lower-level variant also matches segment counts', () => {
  const result = equalizeSegments(TRIANGLE, SQUARE);
  assert.ok(result.segmentCount > 0);
  assert.equal(result.from.match(/[MLC]/g)?.length, result.to.match(/[MLC]/g)?.length);
  assert.notEqual(result.hash, equalizePaths(TRIANGLE, SQUARE).hash, 'segment mode is identified in the hash');
});

test('transform3d: 2D and 3D transforms are deterministic and projected in 2D', () => {
  const flat = transform3d(TRIANGLE, { rotate: 45, origin: [50, 43.3] });
  assert.equal(flat.identity, false);
  assert.deepEqual(flat, transform3d(TRIANGLE, { rotate: 45, origin: [50, 43.3] }));

  const tilted = transform3d(TRIANGLE, { rotateX: 60, origin: [50, 43.3] });
  assert.equal(tilted.identity, false);
  assert.match(tilted.d, /^M/);
  assert.notEqual(tilted.d, TRIANGLE);
  assert.notEqual(tilted.hash, flat.hash);

  const perspective = transform3d(TRIANGLE, { rotateY: 30, perspective: 500, translateZ: 20, origin: [50, 43.3] });
  assert.notEqual(perspective.d, tilted.d);

  assert.deepEqual(transform3d(TRIANGLE, null), {
    version: EQUALIZE_PATHS_VERSION, d: TRIANGLE, identity: true,
    hash: transform3d(TRIANGLE, null).hash
  });
});

test('equalize/transform refuse unusable inputs instead of returning a guess', () => {
  for (const [from, to] of [['', SQUARE], [TRIANGLE, '  '], [TRIANGLE, 'banana'], [42, SQUARE]]) {
    assert.throws(() => equalizePaths(from, to), errorCode('MORPH_PATH_INVALID'));
  }
  assert.throws(() => equalizePaths(TRIANGLE, SQUARE, { roundValues: 11 }), errorCode('MORPH_PATH_INVALID'));
  assert.throws(() => transform3d('', { rotate: 5 }), errorCode('MORPH_PATH_INVALID'));
  assert.throws(() => transform3d(TRIANGLE, { matrix: [1, 2, 3] }), errorCode('VECTOR_TRANSFORM_INVALID'));
  assert.throws(() => transform3d(TRIANGLE, { rotateX: 30 }, { roundValues: 12 }), errorCode('VECTOR_TRANSFORM_INVALID'));
  assert.throws(() => transform3d(TRIANGLE, { origin: [0] }), errorCode('VECTOR_TRANSFORM_INVALID'));
});
