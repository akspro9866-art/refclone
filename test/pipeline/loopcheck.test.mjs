import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOPCHECK_VERSION, checkLoop } from '../../src/pipeline/loopcheck.mjs';
import { WorkflowError } from '../../src/core.mjs';

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

const WIDTH = 32;
const HEIGHT = 32;
const rgba = value => new Uint8Array(WIDTH * HEIGHT * 4).fill(value);
const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const N = 30;
const cycleValue = n => clamp(128 + 100 * Math.sin(2 * Math.PI * n / N));
const base = { fps: 30, duration: 1, width: WIDTH, height: HEIGHT };

test('a hold loop whose tail is a still copy of frame 0 passes', () => {
  const constant = rgba(64);
  const report = checkLoop({
    ...base, loop: 'hold',
    seek: () => constant, renderFrame: () => constant
  });
  assert.equal(report.version, LOOPCHECK_VERSION);
  assert.equal(report.status, 'pass');
  assert.equal(report.frames, N);
  assert.equal(report.maxDiff, 0);
  assert.equal(report.hold, N - 1);
  assert.equal(report.seam, null);
  assert.equal(report.fstep, null);
  assert.ok(report.notes.some(note => /static tail/.test(note)));
  assert.ok(report.notes.some(note => /LOOPCHECK PASS \(hold loop/.test(note)));
});

test('a hold loop that moves before the loop point fails on pixel purity', () => {
  const constant = rgba(64);
  const moving = rgba(200);
  const report = checkLoop({
    ...base, loop: 'hold',
    seek: seconds => (seconds > 0.5 ? moving : constant), renderFrame: () => constant
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.maxDiff > 0);
  assert.ok(report.notes.some(note => /LOOPCHECK FAIL \(max diff/.test(note)));
});

test('a frame reader that disagrees with the seek reader fails', () => {
  const report = checkLoop({
    ...base, loop: 'hold',
    seek: () => rgba(10), renderFrame: () => rgba(200)
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.maxDiff, 190);
});

test('a cycle loop that moves continuously through the seam passes', () => {
  const report = checkLoop({
    ...base, loop: 'cycle',
    seek: seconds => rgba(cycleValue(seconds * N)),
    renderFrame: index => rgba(cycleValue(index))
  });
  assert.equal(report.status, 'pass');
  assert.equal(report.maxDiff, 0);
  assert.equal(report.hold, null);
  assert.ok(report.seam && report.seam.ok);
  assert.ok(report.fstep && report.fstep.ok);
  assert.ok(report.seam.px <= report.seam.limit);
  assert.ok(report.notes.some(note => /seam continuity/.test(note)));
  assert.ok(report.notes.some(note => /LOOPCHECK PASS \(cycle loop, continuous over the seam/.test(note)));
});

test('a cycle film that restarts inside its own length jumps at the seam and fails', () => {
  const sawtooth = index => rgba(clamp((index % 31) * 8));
  const report = checkLoop({
    ...base, loop: 'cycle',
    seek: () => rgba(128),
    renderFrame: sawtooth
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.maxDiff, 0, 'the seeks themselves are pure; the failure is the frame step');
  assert.ok(report.fstep && report.fstep.ok === false);
  assert.ok(report.fstep.value > report.fstep.limit);
  assert.equal(report.fstep.worst.tile.length, 2);
  assert.ok(report.notes.some(note => /frame step across the seam/.test(note)));
});

test('a declared cut at the loop point reports the seam numbers as information', () => {
  const sawtooth = index => rgba(clamp((index % 31) * 8));
  const report = checkLoop({
    ...base, loop: 'cycle', seamCut: true,
    seek: () => rgba(128),
    renderFrame: sawtooth
  });
  assert.equal(report.status, 'pass');
  assert.equal(report.fstep.ok, false, 'the measurement is kept even though the cut is declared');
  assert.equal(report.seam.ok, true);
  assert.ok(report.notes.some(note => /declared cut/.test(note)));
});

test('a cycle loop whose renders are impure fails the purity checks', () => {
  let calls = 0;
  const report = checkLoop({
    ...base, loop: 'cycle',
    seek: () => rgba(128),
    renderFrame: () => { calls += 1; return rgba(clamp(60 + calls)); }
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.maxDiff > 0);
});

test('loop none measures purity only', () => {
  const constant = rgba(90);
  const pass = checkLoop({ ...base, loop: 'none', seek: () => constant, renderFrame: () => constant });
  assert.equal(pass.status, 'pass');
  assert.equal(pass.seam, null);
  assert.equal(pass.fstep, null);
  assert.equal(pass.hold, null);
  const moving = checkLoop({ ...base, loop: 'none', seek: seconds => rgba(seconds > 0.5 ? 200 : 90), renderFrame: () => rgba(90) });
  assert.equal(moving.status, 'fail');
});

test('mismatched frame buffers are a frame error, not a pass', () => {
  assert.throws(() => checkLoop({
    ...base, loop: 'hold',
    seek: () => rgba(10), renderFrame: () => new Uint8Array(16)
  }), errorCode('LOOPCHECK_FRAME_INVALID'));
});

test('invalid loop inputs are refused before any pixels are read', () => {
  const valid = { ...base, seek: () => rgba(0), renderFrame: () => rgba(0) };
  assert.throws(() => checkLoop({ ...valid, loop: 'pingpong' }), errorCode('LOOPCHECK_CONFIG_INVALID'));
  assert.throws(() => checkLoop({ ...valid, fps: 0 }), errorCode('LOOPCHECK_CONFIG_INVALID'));
  assert.throws(() => checkLoop({ ...valid, duration: -1 }), errorCode('LOOPCHECK_CONFIG_INVALID'));
  assert.throws(() => checkLoop({ ...valid, width: 0 }), errorCode('LOOPCHECK_CONFIG_INVALID'));
  assert.throws(() => checkLoop({ ...valid, renderFrame: null }), errorCode('LOOPCHECK_CONFIG_INVALID'));
  assert.throws(() => checkLoop(null), errorCode('LOOPCHECK_CONFIG_INVALID'));
});
