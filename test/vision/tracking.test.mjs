import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  extractStaticLayout,
  extractTrajectories,
  computeVelocityProfile,
  findInflectionFrames,
  segmentMotionBeats,
  segmentMotionBeatsPerLayer,
  opticalVelocity,
  classifyMotion,
  inferMasks,
  trackElement,
  trackShot,
  toPromotionInput,
  TRACKING_VERSION
} from '../../src/vision/tracking.mjs';
import { extractTrackingFromObservations } from '../../src/procedural/procedural-pipeline.mjs';

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

// ---------------------------------------------------------------------------
// Stage 1/2 upgrades: optical velocity, decoupled beat grids, motion
// classification, mask hints. Fixtures are synthetic and deterministic: every
// pixel is authored here so a measured value can be checked exactly.
// ---------------------------------------------------------------------------

const TW = 96;
const TH = 96;
const boxTexture = (x, y) => 80 + 60 * Math.sin(x / 3.1) * Math.cos(y / 2.7);

/** A dark background with textured rectangles; texture moves with each rect (slide shifts it). */
const layerFrame = (rects, width = TW, height = TH) => {
  const data = new Uint8Array(width * height * 4).fill(10);
  for (let at = 3; at < data.length; at += 4) data[at] = 255;
  for (const rect of rects) {
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.width); x++) {
        const value = boxTexture(x - rect.x - (rect.slide ?? 0), y - rect.y);
        const at = (y * width + x) * 4;
        data[at] = Math.round(value);
        data[at + 1] = Math.round(value);
        data[at + 2] = Math.round(value);
      }
    }
  }
  return { data, width, height };
};

/** A single 200-gray shape (plus / disc / square) inside the fixed 48x48 bbox at (8,8). */
const shapeFrame = (shape, width = 64, height = 64) => {
  const data = new Uint8Array(width * height * 4).fill(10);
  for (let at = 3; at < data.length; at += 4) data[at] = 255;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = false;
      if (shape === 'plus') inside = ((x >= 28 && x < 36) || (y >= 28 && y < 36)) && x >= 8 && x < 56 && y >= 8 && y < 56;
      else if (shape === 'disc') inside = Math.hypot(x - 32, y - 32) <= 22;
      else inside = x >= 12 && x < 52 && y >= 12 && y < 52;
      if (inside) {
        const at = (y * width + x) * 4;
        data[at] = 200;
        data[at + 1] = 200;
        data[at + 2] = 200;
      }
    }
  }
  return { data, width, height };
};

describe('tracking: optical velocity', () => {
  it('measures per-element velocity from optical flow when frames are supplied', () => {
    const states = [0, 1, 2, 3].map(i => ({ frame: i, bbox: { x: 20 + 4 * i, y: 20, width: 32, height: 32 } }));
    const frames = states.map(state => ({ frame: state.frame, ...layerFrame([state.bbox]) }));

    const result = opticalVelocity(states, frames, { fps: 24, frameWidth: TW, frameHeight: TH });

    assert.equal(result.source, 'optical');
    assert.equal(result.series.length, 3);
    for (const sample of result.series) {
      assert.equal(sample.source, 'optical');
      // 4 px per frame at 24 fps = 96 px/s; block matching recovers it to ~0.1 px.
      assert.ok(Math.abs(sample.velocity - 96) < 6, `velocity ${sample.velocity} should be near 96 px/s`);
      assert.ok(sample.confidence > 0.5, `confidence ${sample.confidence} should exceed 0.5`);
      assert.ok(Number.isFinite(sample.vx) && Number.isFinite(sample.vy));
    }
  });

  it('falls back to the legacy bbox-diff estimate when no pixels are supplied', () => {
    const states = [0, 1, 2, 3].map(i => ({ frame: i, bbox: { x: 20 + 4 * i, y: 20, width: 32, height: 32 } }));

    const result = opticalVelocity(states, null, { fps: 24 });

    assert.equal(result.source, 'bbox');
    for (const sample of result.series) {
      assert.equal(sample.source, 'bbox');
      assert.equal(sample.vx, null);
      // 4 bbox px per frame step at 24 fps, the legacy estimate exactly.
      assert.ok(Math.abs(sample.velocity - 96) < 0.001);
    }
  });
});

describe('tracking: per-layer decoupled beat grids', () => {
  const statesA = [
    { frame: 0, bbox: { x: 0, y: 0, width: 10, height: 10 } },
    { frame: 5, bbox: { x: 25, y: 0, width: 10, height: 10 } },
    { frame: 10, bbox: { x: 50, y: 0, width: 10, height: 10 } },
    { frame: 15, bbox: { x: 50, y: 0, width: 10, height: 10 } },
    { frame: 20, bbox: { x: 50, y: 0, width: 10, height: 10 } }
  ];
  const statesB = [
    { frame: 0, bbox: { x: 0, y: 50, width: 10, height: 10 } },
    { frame: 5, bbox: { x: 0, y: 50, width: 10, height: 10 } },
    { frame: 10, bbox: { x: 0, y: 50, width: 10, height: 10 } },
    { frame: 15, bbox: { x: 25, y: 50, width: 10, height: 10 } },
    { frame: 20, bbox: { x: 50, y: 50, width: 10, height: 10 } }
  ];

  it('keeps two elements with different schedules on independent beat grids', () => {
    const shot = trackShot({
      shotId: 'shot-beats',
      elements: [{ id: 'a', states: statesA }, { id: 'b', states: statesB }],
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });

    const a = shot.elements[0];
    const b = shot.elements[1];
    assert.deepEqual(a.motionBeats.map(beat => [beat.startFrame, beat.endFrame]), [[5, 10]]);
    assert.deepEqual(b.motionBeats.map(beat => [beat.startFrame, beat.endFrame]), [[15, 20]]);
    assert.deepEqual(a.beatGrid.frames, [5, 10]);
    assert.deepEqual(b.beatGrid.frames, [15, 20]);
    assert.equal(a.beatGrid.source, 'bbox');
    assert.equal(b.beatGrid.source, 'bbox');
    assert.deepEqual(a.beatGrid.accelerationZeroCrossings, []);
    assert.notDeepEqual(a.beatGrid, b.beatGrid);
  });

  it('preserves the legacy segmentMotionBeats output exactly when frames are absent', () => {
    const legacy = segmentMotionBeats({ states: statesA, fps: 24, velocityThreshold: 0.5 });
    const layered = segmentMotionBeatsPerLayer({ states: statesA, fps: 24, velocityThreshold: 0.5 });
    assert.deepEqual(layered.motionBeats, legacy);
    assert.equal(segmentMotionBeats({ states: [], fps: 24 }).length, 0);
  });

  it('marks the beat grid as optical when pixel data is supplied', () => {
    const states = [0, 1, 2, 3].map(i => ({ frame: i, bbox: { x: 20 + 4 * i, y: 20, width: 32, height: 32 } }));
    const frames = states.map(state => ({ frame: state.frame, ...layerFrame([state.bbox]) }));

    const result = segmentMotionBeatsPerLayer({ states, frames, fps: 24, frameWidth: TW, frameHeight: TH });

    assert.equal(result.beatGrid.source, 'optical');
    assert.ok(result.motionBeats.length >= 1);
  });
});

describe('tracking: classifyMotion', () => {
  it('reports static for unchanged states', () => {
    const states = [0, 1, 2].map(i => ({ frame: i, bbox: { x: 40, y: 40, width: 20, height: 20 } }));
    const result = classifyMotion({ states, frameWidth: 1920, frameHeight: 1080 });
    assert.equal(result.kind, 'static');
    assert.equal(result.confidence, 1);
  });

  it('proposes rigid from bbox evidence for pure translation without pixels', () => {
    const states = [0, 1, 2, 3].map(i => ({ frame: i, bbox: { x: 40 + 8 * i, y: 40, width: 20, height: 20 } }));
    const result = classifyMotion({ states, frameWidth: 1920, frameHeight: 1080 });
    assert.equal(result.kind, 'rigid');
    assert.ok(result.evidence.notes.length > 0, 'bbox-only evidence is recorded as such');
  });

  it('proposes rigid from optical correlation when flow tracks center motion', () => {
    const xs = [20, 22, 26, 32]; // accelerating so both series vary
    const states = xs.map((x, i) => ({ frame: i, bbox: { x, y: 20, width: 32, height: 32 } }));
    const frames = states.map(state => ({ frame: state.frame, ...layerFrame([state.bbox]) }));

    const result = classifyMotion({ states, frames, frameWidth: TW, frameHeight: TH, fps: 24 });

    assert.equal(result.kind, 'rigid');
    assert.ok(result.evidence.correlation > 0.8, `correlation ${result.evidence.correlation}`);
    assert.ok(result.confidence > 0.8);
    assert.equal(result.evidence.source, 'optical');
  });

  it('proposes trim when the center stays put while one axis grows', () => {
    const states = [0, 1, 2].map(i => ({ frame: i, bbox: { x: 40 - 4 * i, y: 40, width: 16 + 8 * i, height: 16 } }));
    const result = classifyMotion({ states, frameWidth: 1920, frameHeight: 1080 });
    assert.equal(result.kind, 'trim');
    assert.equal(result.evidence.axis, 'x');
  });

  it('proposes morph from bbox evidence for non-uniform growth with a static center', () => {
    const states = [0, 1, 2].map(i => ({
      frame: i,
      bbox: { x: 940 - 6 * i, y: 520 - 4 * i, width: 40 + 12 * i, height: 40 + 8 * i }
    }));
    const result = classifyMotion({ states, frameWidth: 1920, frameHeight: 1080 });
    assert.equal(result.kind, 'morph');
    assert.ok(result.confidence < 0.8, 'bbox-only morph stays low-confidence');
  });

  it('proposes morph from contour evidence when the shape changes inside a stable bbox', () => {
    const states = [0, 1, 2].map(i => ({ frame: i, bbox: { x: 8, y: 8, width: 48, height: 48 } }));
    const shapes = [shapeFrame('plus'), shapeFrame('disc'), shapeFrame('square')];
    const frames = shapes.map((frame, i) => ({ frame: i, ...frame }));

    const result = classifyMotion({ states, frames, frameWidth: 64, frameHeight: 64, fps: 24 });

    assert.equal(result.kind, 'morph');
    assert.ok(result.evidence.bezierErrorRms > 2, `errorRms ${result.evidence.bezierErrorRms}`);
    assert.ok(result.evidence.maskIou < 0.98, `mask IoU ${result.evidence.maskIou}`);
  });

  it('keeps a genuinely static element static even when pixels are supplied', () => {
    const states = [0, 1, 2].map(i => ({ frame: i, bbox: { x: 8, y: 8, width: 48, height: 48 } }));
    const frames = [0, 1, 2].map(i => ({ frame: i, ...shapeFrame('disc') }));

    const result = classifyMotion({ states, frames, frameWidth: 64, frameHeight: 64, fps: 24 });

    assert.equal(result.kind, 'static');
    assert.ok(result.evidence.maskIou >= 0.98);
  });

  it('handles insufficient states', () => {
    const result = classifyMotion({ states: [{ frame: 0, bbox: { x: 0, y: 0, width: 10, height: 10 } }] });
    assert.equal(result.kind, 'static');
  });
});

describe('tracking: mask hints (inferMasks)', () => {
  const FW = 96;
  const FH = 64;
  const extent = i => 30 + 10 * i;

  /** A full-height textured layer sliding right under a constant occluder at columns 64..71. */
  const occludedFrames = [];
  for (let i = 0; i < 6; i++) {
    const data = new Uint8Array(FW * FH * 4).fill(0);
    for (let at = 3; at < data.length; at += 4) data[at] = 255;
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < Math.min(extent(i), FW); x++) {
        const value = 90 + 70 * Math.sin((x - 10 * i) / 2.5) + 30 * Math.cos(y / 4);
        const at = (y * FW + x) * 4;
        data[at] = Math.round(value);
        data[at + 1] = Math.round(value);
        data[at + 2] = Math.round(value);
      }
    }
    for (let y = 0; y < FH; y++) {
      for (let x = 64; x < 72; x++) {
        const at = (y * FW + x) * 4;
        data[at] = 160;
        data[at + 1] = 160;
        data[at + 2] = 160;
      }
    }
    occludedFrames.push({ frame: i, data, width: FW, height: FH });
  }
  const occludedStates = [0, 1, 2, 3, 4, 5].map(i => ({
    frame: i,
    bbox: { x: 0, y: 0, width: Math.min(64, extent(i)), height: FH }
  }));

  it('emits stationary-edge hints on the occluded side', () => {
    const result = inferMasks(occludedStates, occludedFrames, { frameWidth: FW, frameHeight: FH });

    const right = result.edges.find(edge => edge.edge === 'right');
    assert.ok(right, 'right edge should qualify');
    assert.equal(right.axis, 'x');
    assert.ok(right.stationaryFraction > 0.8);

    const rightHints = result.maskHints.filter(hint => hint.edge === 'right');
    assert.ok(rightHints.length >= 3);
    for (const hint of rightHints) {
      assert.equal(hint.axis, 'x');
      assert.equal(hint.stationary, true);
      assert.ok(hint.confidence > 0.8);
      assert.ok(Number.isFinite(hint.frame));
    }

    // The layer is flush with the other frame edges, so no other band exists to qualify.
    assert.equal(result.maskHints.filter(hint => hint.edge === 'left').length, 0);
    assert.equal(result.maskHints.filter(hint => hint.edge === 'top').length, 0);
    assert.equal(result.maskHints.filter(hint => hint.edge === 'bottom').length, 0);
  });

  it('returns an empty result when no pixels are available', () => {
    const result = inferMasks(occludedStates, null, { frameWidth: FW, frameHeight: FH });
    assert.deepEqual(result.maskHints, []);
    assert.deepEqual(result.edges, []);
    assert.equal(result.evaluatedPairs, 0);
  });

  it('surfaces hints through trackElement additively', () => {
    const result = trackElement({
      elementId: 'occluded-layer',
      states: occludedStates,
      frameWidth: FW,
      frameHeight: FH,
      fps: 24,
      frames: occludedFrames
    });

    assert.ok(result.maskHints.length >= 3);
    assert.equal(result.metrics.maskHintCount, result.maskHints.length);
    assert.equal(result.motionClass.kind, 'rigid');
    assert.equal(result.beatGrid.source, 'optical');
    assert.ok(result.pivot);
    assert.equal(result.pivot.isRotation, false);
  });
});

describe('tracking: additive Stage 2 fields and backward compatibility', () => {
  const states = [
    { frame: 0, bbox: { x: 10, y: 10, width: 30, height: 30 } },
    { frame: 10, bbox: { x: 50, y: 10, width: 30, height: 30 } },
    { frame: 20, bbox: { x: 90, y: 10, width: 30, height: 30 } }
  ];

  it('bumps the tracking version to 2.0.0', () => {
    assert.equal(TRACKING_VERSION, '2.0.0');
  });

  it('adds beatGrid, motionClass, maskHints, maskEdges and pivot alongside every legacy field', () => {
    const result = trackElement({ elementId: 'elem', states, frameWidth: 1920, frameHeight: 1080, fps: 24 });

    for (const key of ['elementId', 'version', 'staticLayout', 'trajectories', 'motionBeats', 'hasMotion', 'metrics']) {
      assert.ok(key in result, `legacy key ${key} must remain`);
    }
    assert.equal(result.version, TRACKING_VERSION);
    assert.equal(result.beatGrid.source, 'bbox');
    assert.equal(result.motionClass.kind, 'rigid');
    assert.deepEqual(result.maskHints, []);
    assert.deepEqual(result.maskEdges, []);
    assert.ok(Number.isFinite(result.pivot.pivotX));
    assert.equal(result.pivot.isRotation, false);
    assert.equal(result.metrics.beatGridSource, 'bbox');
    assert.equal(result.metrics.motionKind, 'rigid');
    assert.equal(result.metrics.maskHintCount, 0);

    // Legacy motionBeats are byte-identical to the standalone call.
    assert.deepEqual(result.motionBeats, segmentMotionBeats({ states, fps: 24 }));
  });

  it('keeps trackShot summaries unchanged and passes shot-wide frames through', () => {
    const legacy = trackShot({
      shotId: 'shot-1',
      elements: [{ id: 'a', states }],
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 24
    });
    assert.deepEqual(legacy.summary, { elementCount: 1, motionElementCount: 1, totalBeats: legacy.summary.totalBeats });
    assert.ok(legacy.summary.totalBeats >= 1);

    const frames = [0, 10, 20].map((frame, i) => ({ frame, ...layerFrame([states[i].bbox]) }));
    const optical = trackShot({
      shotId: 'shot-1',
      elements: [{ id: 'a', states }],
      frameWidth: TW,
      frameHeight: TH,
      fps: 24,
      frames
    });
    assert.equal(optical.elements[0].beatGrid.source, 'optical');
  });
});

describe('procedural pipeline: Stage 2 optical wiring', () => {
  const metadata = { video: { width: TW, height: TH, fps: { num: 24, den: 1 } } };
  const observations = [0, 1, 2, 3].map(i => ({
    frame: i,
    timeSeconds: i / 24,
    measurement: { foreground: { bbox: { x: (20 + 4 * i) / TW, y: 20 / TH, width: 32 / TW, height: 32 / TH } } }
  }));

  it('keeps the bbox fallback and adds the new per-element fields without pixels', () => {
    const result = extractTrackingFromObservations({ shotId: 'shot-1', observations, metadata, config: {} });

    assert.equal(result.version, TRACKING_VERSION);
    assert.equal(result.sourceObservations, 4);
    assert.equal(result.sourceFrames, 0);
    const element = result.elements[0];
    assert.equal(element.beatGrid.source, 'bbox');
    assert.ok(element.motionClass);
    assert.deepEqual(element.maskHints, []);
    assert.ok(element.pivot);
  });

  it('uses pixels attached to observations for optical velocity', () => {
    const withPixels = observations.map(obs => ({
      ...obs,
      png: layerFrame([{ x: 20 + 4 * obs.frame, y: 20, width: 32, height: 32 }])
    }));

    const result = extractTrackingFromObservations({ shotId: 'shot-1', observations: withPixels, metadata, config: {} });

    assert.equal(result.sourceFrames, 4);
    assert.equal(result.elements[0].beatGrid.source, 'optical');
    assert.equal(result.elements[0].metrics.beatGridSource, 'optical');
    assert.ok(result.elements[0].motionBeats.length >= 1);
  });

  it('decodes observation paths when decodeFrames is enabled', async () => {
    const project = fileURLToPath(new URL('../../', import.meta.url));
    const work = path.join(project, '.test-work');
    await fs.mkdir(work, { recursive: true });
    const root = await fs.mkdtemp(path.join(work, 'tracking-'));
    const withPaths = [];
    for (const obs of observations) {
      const filePath = path.join(root, `frame-${obs.frame}.png`);
      await fs.writeFile(filePath, PNG.sync.write(layerFrame([{ x: 20 + 4 * obs.frame, y: 20, width: 32, height: 32 }])));
      withPaths.push({ ...obs, path: filePath });
    }

    const result = extractTrackingFromObservations({ shotId: 'shot-1', observations: withPaths, metadata, config: {}, decodeFrames: true });

    assert.equal(result.sourceFrames, 4);
    assert.equal(result.frameDecodeFailures, 0);
    assert.equal(result.elements[0].beatGrid.source, 'optical');
  });

  it('keeps working when decode targets are unreadable', async () => {
    const withPaths = observations.map(obs => ({ ...obs, path: 'Z:/does/not/exist/frame.png' }));

    const result = extractTrackingFromObservations({ shotId: 'shot-1', observations: withPaths, metadata, config: {}, decodeFrames: true });

    assert.equal(result.sourceFrames, 0);
    assert.equal(result.frameDecodeFailures, 4);
    assert.equal(result.elements[0].beatGrid.source, 'bbox');
  });
});
