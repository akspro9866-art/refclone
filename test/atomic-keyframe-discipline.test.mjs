import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

import {
  expectedLayersFromCriticalFrames,
  normalizeExpectedLayers,
  evaluateAtomicSnapshot,
  buildAtomicCorrections,
  runAtomicConvergence
} from '../src/atomic-convergence.mjs';

const WIDTH = 96;
const HEIGHT = 54;
const CARD_WIDTH = 20;
const CARD_HEIGHT = 10;
const FILL = [220, 40, 60];

function paint(png, box, colour) {
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(png.width, Math.round(box.x + box.width));
  const y1 = Math.min(png.height, Math.round(box.y + box.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = colour[0];
      png.data[offset + 1] = colour[1];
      png.data[offset + 2] = colour[2];
      png.data[offset + 3] = 255;
    }
  }
  return png;
}

function renderFrame(boxes) {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  png.data.fill(0);
  for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = 255;
  for (const box of boxes) paint(png, box, FILL);
  return png;
}

function pixelBox(x, y, width = CARD_WIDTH, height = CARD_HEIGHT) {
  return { x, y, width, height };
}

// The reference card travels linearly from (20,20) to (60,26). The rendered
// layer matches on the two boundary keyframes (0 and 10) and leads mid-curve
// (+6 px at 5, +3 px at 8). Only a curve retune can change those samples.
const REFERENCE_BOXES = {
  0: pixelBox(20, 20),
  5: pixelBox(40, 23),
  8: pixelBox(52, 24.8),
  10: pixelBox(60, 26)
};
const RENDERED_BOXES = {
  0: REFERENCE_BOXES[0],
  5: pixelBox(46, 23),
  8: pixelBox(55, 24.8),
  10: REFERENCE_BOXES[10]
};
const ROLES = Object.freeze({
  frame_start: 0,
  frame_max_velocity: 5,
  frame_overshoot_peak: 8,
  frame_settle: 10
});

function referenceFrames() {
  return Object.entries(REFERENCE_BOXES).map(([frame, box]) => ({
    frame: Number(frame),
    png: renderFrame([box])
  }));
}

function expectedCard() {
  return [{
    elementId: 'mid_curve_card',
    match: { name: 'Card', alias: '@mid_curve_card' },
    boxes: REFERENCE_BOXES,
    space: 'pixels',
    animated: true,
    roles: ROLES
  }];
}

function snapshotProvider() {
  return async request => ({
    ok: true,
    kind: 'snapshot-batch',
    requested: request.frames.length,
    frames: request.frames.map(frame => ({
      frame,
      exists: true,
      frameHash: `hash-${frame}`,
      png: renderFrame([RENDERED_BOXES[frame]]),
      layers: [{
        id: 'shape#0',
        ref: 'shape#0',
        type: 'shape',
        name: 'Card',
        visible: true,
        bbox: RENDERED_BOXES[frame],
        attrs: {
          'position.x': RENDERED_BOXES[frame].x + CARD_WIDTH / 2,
          'position.y': RENDERED_BOXES[frame].y + CARD_HEIGHT / 2,
          'scale.x': 1,
          'scale.y': 1,
          rotation: 0
        }
      }]
    }))
  });
}

test('critical-frame roles survive normalization and classify boundary vs mid-curve frames', () => {
  const layers = expectedLayersFromCriticalFrames({
    elements: [{
      elementId: 'mid_curve_card',
      animated: true,
      roles: ROLES,
      boxes: REFERENCE_BOXES
    }]
  });
  assert.deepEqual(layers[0].roles, ROLES);

  const normalized = normalizeExpectedLayers(layers, { frameWidth: WIDTH, frameHeight: HEIGHT });
  assert.deepEqual(normalized[0].roles, ROLES);
  assert.deepEqual(normalized[0].boundaryFrames, [0, 10]);
  assert.deepEqual(normalized[0].intermediateFrames, [5, 8]);

  const direct = normalizeExpectedLayers([{
    elementId: 'mid_curve_card',
    match: { name: 'Card', alias: '@mid_curve_card' },
    boxes: REFERENCE_BOXES,
    space: 'pixels',
    animated: true,
    roles: ROLES
  }], { frameWidth: WIDTH, frameHeight: HEIGHT });
  assert.deepEqual(direct[0].roleBoxes['5'], REFERENCE_BOXES[5]);
  assert.deepEqual(direct[0].roleBoxes['10'], REFERENCE_BOXES[10]);
});

test('boundary residuals target the existing keyframe and mid-curve residuals target easing', () => {
  const layers = normalizeExpectedLayers(expectedCard(), { frameWidth: WIDTH, frameHeight: HEIGHT });
  const evaluation = evaluateAtomicSnapshot({
    referenceFrames: referenceFrames(),
    expectedLayers: layers,
    snapshot: {
      ok: true,
      frames: new Map(Object.entries(RENDERED_BOXES).map(([frame, box]) => [
        Number(frame),
        {
          frame: Number(frame),
          png: renderFrame([box]),
          layers: [{
            id: 'shape#0',
            name: 'Card',
            visible: true,
            bbox: box,
            attrs: {
              'position.x': box.x + CARD_WIDTH / 2,
              'position.y': box.y + CARD_HEIGHT / 2,
              'scale.x': 1,
              'scale.y': 1,
              rotation: 0
            }
          }]
        }
      ]))
    }
  });

  const measurements = evaluation.layers[0].measurements;
  const boundary = measurements.find(entry => entry.frame === 0);
  const velocity = measurements.find(entry => entry.frame === 5);
  const overshoot = measurements.find(entry => entry.frame === 8);
  assert.equal(boundary.frameClass, 'boundary');
  assert.equal(boundary.frameRole, 'frame_start');
  assert.equal(velocity.frameClass, 'intermediate');
  assert.equal(velocity.frameRole, 'frame_max_velocity');
  assert.equal(overshoot.frameClass, 'intermediate');
  assert.equal(overshoot.frameRole, 'frame_overshoot_peak');
  assert.equal(boundary.driftPx, 0);

  const correction = buildAtomicCorrections(evaluation);
  assert.equal(correction.summary.boundaryEntries, 0, 'aligned boundary keys need no write');
  assert.equal(correction.summary.easingEntries, 1, 'both mid-curve samples share one anchor');
  const easing = correction.entries.find(entry => entry.easing);
  assert.ok(easing, 'a mid-curve residual must produce an easing adjustment');
  assert.equal(easing.frame, undefined, 'easing entries never target a frame');
  assert.deepEqual(easing.easing.frames, [0], 'the adjustment anchors on the start keyframe');
  assert.equal(easing.easing.name, 'SlowIn', 'the render leads the reference at max velocity');
  assert.deepEqual(easing.easing.attrs, ['position.x', 'position.y']);
  assert.ok(!correction.entries.some(entry => entry.frame === 5 || entry.frame === 8));
});

test('a 3-round convergence pass on an animated layer never increases the keyframe count', async () => {
  const expected = expectedCard();
  const provider = snapshotProvider();
  const keyframes = new Set([0, 10]);
  const keyframeCountBefore = keyframes.size;
  const scripts = [];
  const applied = [];

  const result = await runAtomicConvergence({
    shotId: 'shot-keyframe-discipline',
    referenceFrames: referenceFrames(),
    expectedLayers: expected,
    snapshotProvider: provider,
    patchExecutor: async (script, meta) => {
      scripts.push(script);
      for (const entry of meta.entries) {
        applied.push(entry);
        // Mirror patchKeyframeSafe: a frame-targeted write adds a keyframe only
        // when that frame is not already a key. Easing changes no keys.
        if (entry.frame != null) keyframes.add(Math.round(Number(entry.frame)));
      }
      return { ok: true, patched: meta.entries.length };
    }
  });

  assert.equal(result.iterationsRun, 3);
  assert.equal(result.stopReason, 'max_iterations');
  assert.equal(scripts.length, 3);
  assert.ok(applied.length >= 3, 'every round must emit a correction');
  assert.ok(applied.every(entry => entry.easing != null), 'mid-curve rounds emit easing only');
  assert.ok(applied.every(entry => entry.frame == null), 'no round bakes a keyframe');
  assert.ok(applied.every(entry => keyframes.has(entry.easing.frames[0])), 'anchors must be existing keyframes');
  assert.equal(keyframes.size, keyframeCountBefore, 'keyframeCount_after === keyframeCount_before');
  assert.equal(keyframes.size, 2);
  assert.doesNotMatch(scripts[0], /_mg\.(kf|keyframe|keyframes)\(/);
});

test('a boundary residual still patches the existing keyframe in place', () => {
  const movedBox = pixelBox(24, 20);
  const layers = normalizeExpectedLayers([{
    elementId: 'boundary_card',
    match: { name: 'Card', alias: '@boundary_card' },
    boxes: { 0: REFERENCE_BOXES[0], 10: REFERENCE_BOXES[10] },
    space: 'pixels',
    animated: true,
    roles: ROLES
  }], { frameWidth: WIDTH, frameHeight: HEIGHT });
  const evaluation = evaluateAtomicSnapshot({
    referenceFrames: [
      { frame: 0, png: renderFrame([REFERENCE_BOXES[0]]) },
      { frame: 10, png: renderFrame([REFERENCE_BOXES[10]]) }
    ],
    expectedLayers: layers,
    snapshot: {
      ok: true,
      frames: new Map([
        [0, {
          frame: 0,
          png: renderFrame([movedBox]),
          layers: [{
            id: 'shape#9',
            name: 'Card',
            visible: true,
            bbox: movedBox,
            attrs: {
              'position.x': movedBox.x + CARD_WIDTH / 2,
              'position.y': movedBox.y + CARD_HEIGHT / 2,
              'scale.x': 1,
              'scale.y': 1,
              rotation: 0
            }
          }]
        }],
        [10, {
          frame: 10,
          png: renderFrame([REFERENCE_BOXES[10]]),
          layers: [{
            id: 'shape#9',
            name: 'Card',
            visible: true,
            bbox: REFERENCE_BOXES[10],
            attrs: {
              'position.x': REFERENCE_BOXES[10].x + CARD_WIDTH / 2,
              'position.y': REFERENCE_BOXES[10].y + CARD_HEIGHT / 2,
              'scale.x': 1,
              'scale.y': 1,
              rotation: 0
            }
          }]
        }]
      ])
    }
  });

  const correction = buildAtomicCorrections(evaluation);
  assert.equal(correction.summary.boundaryEntries, 1);
  assert.equal(correction.summary.easingEntries, 0);
  const entry = correction.entries[0];
  assert.equal(entry.alias, '@boundary_card');
  assert.equal(entry.frame, 0, 'the write lands on the existing start keyframe');
  assert.equal(entry.attrs['position.x'], 30, 'rendered centre 34 corrected by -4 px');
  assert.equal(entry.attrs['position.y'], undefined, 'a zero vertical residual writes nothing');
  assert.equal(entry.easing, undefined);
});
