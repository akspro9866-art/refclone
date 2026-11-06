/**
 * Critical evaluation frames — deterministic role extraction.
 *
 * Every fixture is a hand-authored series whose range, velocity and tail are
 * known exactly, so each role can be asserted against an arithmetic result
 * rather than a loose threshold.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CRITICAL_FRAMES_VERSION,
  CRITICAL_FRAME_ROLES,
  analyzeCriticalTrajectory,
  analyzeElementCriticalFrames,
  detectCriticalFrames
} from '../../src/vision/critical-frames.mjs';

const series = values => values.map((value, frame) => ({ frame, value }));

describe('critical frames: trajectory roles', () => {
  it('exposes the four documented roles and a version', () => {
    assert.equal(CRITICAL_FRAMES_VERSION, '1.0.0');
    assert.deepEqual(CRITICAL_FRAME_ROLES, [
      'frame_start',
      'frame_max_velocity',
      'frame_overshoot_peak',
      'frame_settle'
    ]);
  });

  it('finds start and peak velocity on a monotone ramp without inventing overshoot', () => {
    const result = analyzeCriticalTrajectory({
      elementId: 'ramp',
      points: series(Array.from({ length: 25 }, (_, frame) => frame))
    });

    assert.equal(result.animated, true);
    // 2% of the 24-unit range = 0.48; frame 1 is the first sample past it.
    assert.equal(result.roles.frame_start, 1);
    // Every interval has the same speed, so the first interval's end wins.
    assert.equal(result.roles.frame_max_velocity, 1);
    assert.equal(result.roles.frame_overshoot_peak, 1);
    assert.equal(result.overshootDetected, false);
    // A constant-speed ramp never settles; the last sample is the fallback.
    assert.equal(result.roles.frame_settle, 24);
    assert.deepEqual(result.frames, [1, 24]);
  });

  it('finds the overshoot excursion and the first stable settle of a spring', () => {
    // 0 → 110 → 96 → 100: a visible overshoot that recovers to rest.
    const samples = [
      { frame: 0, value: 0 },
      { frame: 4, value: 40 },
      { frame: 8, value: 90 },
      { frame: 12, value: 110 },
      { frame: 16, value: 96 },
      { frame: 20, value: 101 },
      { frame: 24, value: 100 },
      { frame: 30, value: 100 }
    ];
    const result = analyzeCriticalTrajectory({ elementId: 'spring', points: samples });

    assert.equal(result.animated, true);
    assert.equal(result.roles.frame_start, 4, 'first sample past 2% of the 110 range');
    assert.equal(result.roles.frame_max_velocity, 8, '12.5 units/frame is the fastest interval');
    assert.equal(result.overshootDetected, true);
    assert.equal(result.roles.frame_overshoot_peak, 12, 'the 110 peak is 10 units past the 100 rest value');
    assert.equal(result.roles.frame_settle, 24, 'speed is at rest from 24 to the end');
    assert.deepEqual(result.frames, [4, 8, 12, 24]);
    assert.equal(result.settleValue, 100);
  });

  it('treats a constant series as static and keeps only the endpoints', () => {
    const result = analyzeCriticalTrajectory({
      elementId: 'still',
      points: series(Array.from({ length: 11 }, () => 50))
    });

    assert.equal(result.animated, false);
    assert.deepEqual(result.roles, {
      frame_start: 0,
      frame_max_velocity: null,
      frame_overshoot_peak: null,
      frame_settle: 10
    });
    assert.deepEqual(result.frames, [0, 10]);
    assert.equal(result.overshootDetected, false);
  });

  it('dedupes repeated frames deterministically (last sample wins)', () => {
    const result = analyzeCriticalTrajectory({
      elementId: 'dupes',
      points: [
        { frame: 0, value: 0 },
        { frame: 5, value: 10 },
        { frame: 5, value: 20 },
        { frame: 10, value: 30 }
      ]
    });

    assert.equal(result.roles.frame_start, 5);
    assert.equal(result.maxVelocity, 4);
  });

  it('returns null below two samples', () => {
    assert.equal(analyzeCriticalTrajectory({ elementId: 'empty', points: [] }), null);
    assert.equal(analyzeCriticalTrajectory({ elementId: 'one', points: [{ frame: 3, value: 9 }] }), null);
  });
});

describe('critical frames: element envelope', () => {
  const states = [0, 4, 8, 12, 16, 20, 24, 30].map(frame => ({
    frame,
    bbox: { x: 100 + frame * 20, y: 300, width: 200, height: 100 }
  }));
  const trajectories = {
    x: [
      { frame: 0, value: 0 },
      { frame: 4, value: 40 },
      { frame: 8, value: 90 },
      { frame: 12, value: 110 },
      { frame: 16, value: 96 },
      { frame: 20, value: 101 },
      { frame: 24, value: 100 },
      { frame: 30, value: 100 }
    ],
    y: [0, 4, 8, 12, 16, 20, 24, 30].map(frame => ({ frame, value: 350 }))
  };

  it('merges properties into element roles and interpolates normalized boxes', () => {
    const result = analyzeElementCriticalFrames({
      elementId: 'hero',
      trajectories,
      states,
      frameWidth: 1920,
      frameHeight: 1080
    });

    assert.equal(result.animated, true);
    assert.equal(result.peakProperty, 'x');
    assert.equal(result.roles.frame_start, 4);
    assert.equal(result.roles.frame_max_velocity, 8);
    assert.equal(result.roles.frame_overshoot_peak, 12);
    assert.equal(result.roles.frame_settle, 24);
    assert.equal(result.overshootDetected, true);
    assert.deepEqual(result.frames, [0, 4, 8, 12, 24, 30]);

    // Frame 4: bbox x = 180 px, width 200 px on a 1920×1080 frame.
    const at4 = result.boxes[4];
    assert.ok(at4);
    assert.ok(Math.abs(at4.x - 180 / 1920) < 1e-12);
    assert.ok(Math.abs(at4.y - 300 / 1080) < 1e-12);
    assert.ok(Math.abs(at4.width - 200 / 1920) < 1e-12);
    assert.ok(Math.abs(at4.height - 100 / 1080) < 1e-12);
    assert.ok(Object.values(at4).every(value => value >= 0));

    const properties = Object.fromEntries(result.properties.map(entry => [entry.property, entry]));
    assert.equal(properties.x.animated, true);
    assert.equal(properties.y.animated, false);
    // Properties with no samples (scale, rotation, opacity) are omitted rather
    // than reported as static: an absent series is not evidence of stillness.
    assert.equal(properties.opacity, undefined);
  });

  it('rejects a missing element id', () => {
    assert.throws(
      () => analyzeElementCriticalFrames({ trajectories, states }),
      error => error.code === 'CRITICAL_FRAMES_INVALID'
    );
  });
});

describe('critical frames: shot report', () => {
  it('accepts tracked and raw element shapes and unions their frames', () => {
    const trajectories = {
      x: [
        { frame: 0, value: 0 },
        { frame: 10, value: 100 },
        { frame: 20, value: 100 }
      ]
    };
    const states = [
      { frame: 0, bbox: { x: 0, y: 0, width: 100, height: 100 } },
      { frame: 10, bbox: { x: 100, y: 0, width: 100, height: 100 } },
      { frame: 20, bbox: { x: 100, y: 0, width: 100, height: 100 } }
    ];

    const report = detectCriticalFrames({
      elements: [
        { elementId: 'tracked', trajectories, states },
        { id: 'raw', trajectories: { y: trajectories.x }, states }
      ],
      frameWidth: 1920,
      frameHeight: 1080
    });

    assert.equal(report.version, CRITICAL_FRAMES_VERSION);
    assert.equal(report.elements.length, 2);
    assert.deepEqual(report.frames, [10, 20]);
    assert.equal(report.summary.elementCount, 2);
    assert.equal(report.summary.animatingElements, 2);
    assert.equal(report.summary.frameCount, 2);
  });

  it('reports an empty shot without throwing', () => {
    const report = detectCriticalFrames({ elements: [] });
    assert.deepEqual(report.frames, []);
    assert.deepEqual(report.summary, {
      elementCount: 0,
      animatingElements: 0,
      frameCount: 0,
      overshootCount: 0
    });
  });
});
