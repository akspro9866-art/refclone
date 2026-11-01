// Frame-selection tests. `--frames` is the difference between a full-length render
// and a two-second look at one transition, so its parsing, its agreement with the
// plan, and the cache key that isolates each selection are pinned here. Everything
// below is pure: no scene plan on disk, no FFmpeg, no Cavalry bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameListSignature, parseFrameSpec, plannedFrames, renderCacheKey, resolveFrames
} from '../src/render.mjs';

const PLAN = {
  project: { width: 736, height: 414, fps: { num: 24, den: 1 }, totalFrames: 216 },
  shots: [
    { id: 'shot-a', startFrame: 0, endFrameExclusive: 28 },
    { id: 'shot-wall', startFrame: 28, endFrameExclusive: 127 },
    { id: 'shot-c', startFrame: 127, endFrameExclusive: 168 },
    { id: 'shot-d', startFrame: 168, endFrameExclusive: 216 }
  ]
};

const failure = fn => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
};

test('a frame spec is inclusive, accepts either separator, and deduplicates in order', () => {
  assert.deepEqual(parseFrameSpec('28:31'), [28, 29, 30, 31]);
  assert.deepEqual(parseFrameSpec('28-31'), [28, 29, 30, 31]);
  assert.deepEqual(parseFrameSpec('7'), [7]);
  assert.deepEqual(parseFrameSpec('  28 : 30  '), [28, 29, 30]);
  assert.deepEqual(parseFrameSpec('60,2-4,4,3,60'), [2, 3, 4, 60]);
  assert.deepEqual(parseFrameSpec('0:10:3'), [0, 3, 6, 9]);
  assert.deepEqual(parseFrameSpec('0-1:1'), [0, 1]);
  assert.deepEqual(parseFrameSpec('5:5'), [5]);
});

test('a malformed frame spec is refused with its own code, not with a render attempt', () => {
  for (const spec of ['', '   ', 'x', '216:28', '1:2:0', '1.5', '-3', '0,', ',1', '2-4-6-8']) {
    const error = failure(() => parseFrameSpec(spec));
    assert.equal(error.code, 'RENDER_FRAME_SPEC_INVALID', `${JSON.stringify(spec)} must be rejected`);
  }
  assert.equal(failure(() => parseFrameSpec('216:28')).message.includes('backwards'), true);
  // Widening the parse limit would let a typo allocate a million-frame plan.
  assert.equal(failure(() => parseFrameSpec('0:100001')).code, 'RENDER_FRAME_SPEC_INVALID');
});

test('the planned frame list follows the plan, and a shot narrows it', () => {
  assert.deepEqual(plannedFrames(PLAN).length, 216);
  assert.deepEqual(plannedFrames(PLAN, 'shot-wall').length, 99);
  assert.deepEqual(plannedFrames(PLAN, 'shot-wall').slice(0, 3), [28, 29, 30]);
  assert.deepEqual(plannedFrames(PLAN, 'shot-wall').slice(-1), [126]);
});

test('resolveFrames defaults to the shot range and validates a selection against it', () => {
  assert.deepEqual(resolveFrames(PLAN).frames.length, 216);
  assert.deepEqual(resolveFrames(PLAN, { shot: 'shot-c' }).frames.length, 41);
  assert.deepEqual(resolveFrames(PLAN, { shot: 'shot-c', frames: '127:131' }).frames, [127, 128, 129, 130, 131]);
  // Frames outside the rendered shot are refused even though the plan covers them.
  const outside = failure(() => resolveFrames(PLAN, { shot: 'shot-c', frames: '0' }));
  assert.equal(outside.code, 'RENDER_FRAME_UNMAPPED');
  assert.deepEqual(outside.details.frames, [0]);
  assert.deepEqual(outside.details.shots.map(shot => shot.id), ['shot-c']);
});

test('a selection that runs past the timeline names every offending frame', () => {
  const error = failure(() => resolveFrames(PLAN, { frames: '210:220' }));
  assert.equal(error.code, 'RENDER_FRAME_UNMAPPED');
  assert.deepEqual(error.details.frames, [216, 217, 218, 219, 220]);
  assert.equal(failure(() => resolveFrames(PLAN, { shot: 'nope' })).code, 'RENDER_SHOT_NOT_FOUND');
});

test('a frame signature collapses contiguous runs so two selections never collide', () => {
  assert.deepEqual(frameListSignature([0, 1, 2, 10, 11, 50]), { count: 6, runs: '0-2,10-11,50' });
  assert.deepEqual(frameListSignature([7]), { count: 1, runs: '7' });
  assert.deepEqual(frameListSignature([]), { count: 0, runs: '' });
  assert.deepEqual(frameListSignature(plannedFrames(PLAN)), { count: 216, runs: '0-215' });
});

test('the render cache key covers the selection, the encoder and the raster', () => {
  const config = { ffmpeg: 'ffmpeg', render: { scalePercent: 100, crf: 18 } };
  const base = renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), config);
  assert.equal(base, renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), config, plannedFrames(PLAN)));
  const variants = [
    renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), config, [28, 29, 30]),
    renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), config, [0, 1, 5]),
    renderCacheKey(PLAN, 'c'.repeat(64), 'b'.repeat(64), config),
    renderCacheKey(PLAN, 'a'.repeat(64), 'd'.repeat(64), config),
    renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), { ffmpeg: 'ffmpeg', render: { scalePercent: 50 } }),
    renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), { ffmpeg: 'ffmpeg-nightly', render: {} })
  ];
  for (const variant of variants) assert.notEqual(variant, base);
  // Two selections that share a count but not a range must not share a directory.
  assert.notEqual(
    renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), config, [0, 1, 2]),
    renderCacheKey(PLAN, 'a'.repeat(64), 'b'.repeat(64), config, [3, 4, 5])
  );
});
