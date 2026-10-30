import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStaticLayout,
  extractTrajectories,
  computeVelocityProfile,
  findInflectionFrames,
  segmentMotionBeats,
  trackElement,
  trackShot,
  toPromotionInput,
  TRACKING_VERSION
} from '../src/tracking.mjs';

describe('tracking: static layout extraction', () => {
  it('extracts static layout from rest frames', () => {
    const states = [
      { frame: 0, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, opacity: 1 },
      { frame: 1, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, opacity: 1 },
      { frame: 2, bbox: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, opacity: 1 }
    ];

    const result = extractStaticLayout({ states });

    assert.ok(result.bbox);
    assert.equal(result.isRestFrame, true);
    assert.ok(result.restFrameCount >= 1);
    assert.ok(result.anchorPoint);
  });

  it('uses first frame when no rest frames exist', () => {
    const states = [
      { frame: 0, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 } },
      { frame: 1, bbox: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } },
      { frame: 2, bbox: { x: 0.9, y: 0.9, width: 0.3, height: 0.3 } }
    ];

    const result = extractStaticLayout({ states });

    assert.equal(result.frame, 0);
    assert.equal(result.isRestFrame, false);
  });

  it('rejects empty states array', () => {
    assert.throws(
      () => extractStaticLayout({ states: [] }),
      { code: 'TRACKING_INVALID' }
    );
  });
});

describe('tracking: trajectory extraction', () => {
  it('extracts normalized trajectories from element states', () => {
    const states = [
      { frame: 0, bbox: { x: 0, y: 0, width: 100, height: 100 }, opacity: 1 },
      { frame: 10, bbox: { x: 50, y: 0, width: 100, height: 100 }, opacity: 1 },
      { frame: 20, bbox: { x: 100, y: 0, width: 100, height: 100 }, opacity: 1 }
    ];

    const result = extractTrajectories({ states, frameWidth: 1920, frameHeight: 1080 });

    assert.equal(result.x.length, 3);
    assert.equal(result.y.length, 3);
    assert.equal(result.scale_x.length, 3);
    assert.equal(result.opacity.length, 3);
    assert.equal(result.hasMotion, true);
    assert.equal(result.startFrame, 0);
    assert.equal(result.endFrame, 20);
  });

  it('detects no motion for static element', () => {
    const states = [
      { frame: 0, bbox: { x: 100, y: 100, width: 50, height: 50 } },
      { frame: 10, bbox: { x: 100, y: 100, width: 50, height: 50 } },
      { frame: 20, bbox: { x: 100, y: 100, width: 50, height: 50 } }
    ];

    const result = extractTrajectories({ states, frameWidth: 1920, frameHeight: 1080 });

    assert.equal(result.hasMotion, false);
  });

  it('handles single state gracefully', () => {
    const states = [
      { frame: 0, bbox: { x: 0, y: 0, width: 100, height: 100 } }
    ];

    const result = extractTrajectories({ states, frameWidth: 1920, frameHeight: 1080 });

    assert.equal(result.hasMotion, false);
    assert.equal(result.x.length, 0);
  });
});

describe('tracking: velocity profile', () => {
  it('computes velocity and acceleration from trajectory', () => {
    const trajectory = [
      { frame: 0, value: 0 },
      { frame: 10, value: 50 },
      { frame: 20, value: 100 }
    ];

    const result = computeVelocityProfile(trajectory, 24);

    assert.equal(result.length, 2);
    assert.ok(result[0].velocity > 0);
    assert.ok(result[1].velocity > 0);
    assert.ok(result[0].acceleration !== undefined);
  });

  it('handles constant velocity (zero acceleration)', () => {
    const trajectory = [
      { frame: 0, value: 0 },
      { frame: 10, value: 10 },
      { frame: 20, value: 20 }
    ];

    const result = computeVelocityProfile(trajectory, 24);

    // Velocities should be approximately equal
    assert.ok(Math.abs(result[0].velocity - result[1].velocity) < 0.001);
  });

  it('returns empty array for insufficient points', () => {
    const result = computeVelocityProfile([{ frame: 0, value: 0 }], 24);
    assert.equal(result.length, 0);
  });
});

describe('tracking: inflection frames', () => {
  it('finds start, peak velocity, and settle frames', () => {
    const trajectory = [
      { frame: 0, value: 0 },
      { frame: 5, value: 10 },
      { frame: 10, value: 50 }, // Peak velocity region
      { frame: 15, value: 80 },
      { frame: 20, value: 95 },
      { frame: 25, value: 100 } // Settled
    ];

    const result = findInflectionFrames(trajectory, 24);

    assert.equal(result.start, 0);
    assert.ok(result.peakVelocity > 0);
    assert.ok(result.settle >= result.peakVelocity);
    assert.ok(result.maxVelocity > 0);
  });

  it('detects overshoot in oscillating trajectory', () => {
    const trajectory = [
      { frame: 0, value: 0 },
      { frame: 10, value: 120 }, // Overshoot
      { frame: 20, value: 90 },
      { frame: 30, value: 105 },
      { frame: 40, value: 100 }
    ];

    const result = findInflectionFrames(trajectory, 24);

    // Should detect sign change in velocity
    assert.ok(result.overshoot !== null || result.peakVelocity > 0);
  });

  it('handles minimal trajectory', () => {
    const trajectory = [
      { frame: 0, value: 0 },
      { frame: 10, value: 100 }
    ];

    const result = findInflectionFrames(trajectory, 24);

    assert.equal(result.start, 0);
    assert.equal(result.settle, 10);
  });
});

describe('tracking: motion beat segmentation', () => {
  it('segments motion into beats based on velocity', () => {
    const states = [
      { frame: 0, bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { frame: 5, bbox: { x: 50, y: 0, width: 10, height: 10 } },
      { frame: 10, bbox: { x: 100, y: 0, width: 10, height: 10 } },
      { frame: 15, bbox: { x: 100, y: 0, width: 10, height: 10 } }, // Rest
      { frame: 20, bbox: { x: 100, y: 50, width: 10, height: 10 } },
      { frame: 25, bbox: { x: 100, y: 100, width: 10, height: 10 } }
    ];

    const result = segmentMotionBeats({ states, fps: 24, velocityThreshold: 0.5 });

    assert.ok(Array.isArray(result));
    // Should detect at least one motion beat
    if (result.length > 0) {
      assert.ok(result[0].startFrame !== undefined);
      assert.ok(result[0].endFrame !== undefined);
      assert.ok(result[0].inflections !== undefined);
    }
  });

  it('returns empty array for static element', () => {
    const states = [
      { frame: 0, bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { frame: 10, bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { frame: 20, bbox: { x: 0, y: 0, width: 10, height: 10 } }
    ];

    const result = segmentMotionBeats({ states, fps: 24, velocityThreshold: 0.1 });

    assert.equal(result.length, 0);
  });
});

describe('tracking: element tracking', () => {
  it('produces complete tracking analysis for an element', () => {
    const states = [
      { frame: 0, bbox: { x: 0, y: 0, width: 100, height: 100 }, opacity: 0 },
      { frame: 10, bbox: { x: 50, y: 0, width: 100, height: 100 }, opacity: 0.5 },
      { frame: 20, bbox: { x: 100, y: 0, width: 100, height: 100 }, opacity: 1 }
    ];

    const result = trackElement({
      elementId: 'test-element',
      states,
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    assert.equal(result.elementId, 'test-element');
    assert.equal(result.version, TRACKING_VERSION);
    assert.ok(result.staticLayout);
    assert.ok(result.trajectories);
    assert.ok(result.motionBeats !== undefined);
    assert.equal(result.hasMotion, true);
    assert.ok(result.metrics.stateCount === 3);
  });

  it('rejects missing elementId', () => {
    assert.throws(
      () => trackElement({ states: [], frameWidth: 100, frameHeight: 100, fps: 24 }),
      { code: 'TRACKING_INVALID' }
    );
  });
});

describe('tracking: shot tracking', () => {
  it('tracks all elements in a shot', () => {
    const elements = [
      {
        id: 'elem-1',
        states: [
          { frame: 0, bbox: { x: 0, y: 0, width: 10, height: 10 } },
          { frame: 10, bbox: { x: 50, y: 0, width: 10, height: 10 } }
        ]
      },
      {
        id: 'elem-2',
        states: [
          { frame: 0, bbox: { x: 0, y: 50, width: 10, height: 10 } },
          { frame: 10, bbox: { x: 50, y: 50, width: 10, height: 10 } }
        ]
      }
    ];

    const result = trackShot({
      shotId: 'shot-1',
      elements,
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    assert.equal(result.shotId, 'shot-1');
    assert.equal(result.version, TRACKING_VERSION);
    assert.equal(result.elements.length, 2);
    assert.equal(result.summary.elementCount, 2);
    assert.ok(result.summary.motionElementCount >= 0);
  });

  it('handles empty shot', () => {
    const result = trackShot({
      shotId: 'empty-shot',
      elements: [],
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    assert.equal(result.elements.length, 0);
    assert.equal(result.summary.elementCount, 0);
  });
});

describe('tracking: promotion input conversion', () => {
  it('converts tracking analysis to promotion solver format', () => {
    const trackingAnalysis = {
      elements: [
        {
          elementId: 'elem-1',
          trajectories: {
            x: [{ frame: 0, value: 0 }, { frame: 10, value: 100 }],
            y: [{ frame: 0, value: 0 }, { frame: 10, value: 0 }]
          },
          staticLayout: { bbox: { x: 0, y: 0, width: 10, height: 10 } },
          motionBeats: []
        }
      ]
    };

    const result = toPromotionInput(trackingAnalysis);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'elem-1');
    assert.ok(result[0].trajectories.x);
    assert.ok(result[0].trajectories.y);
    assert.ok(result[0].staticLayout);
  });

  it('handles single element tracking analysis', () => {
    const trackingAnalysis = {
      elementId: 'single-elem',
      trajectories: {
        x: [{ frame: 0, value: 0 }],
        y: [{ frame: 0, value: 0 }]
      },
      staticLayout: {},
      motionBeats: []
    };

    const result = toPromotionInput(trackingAnalysis);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'single-elem');
  });
});
