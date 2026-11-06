import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

import {
  ATOMIC_CONVERGENCE_VERSION,
  loadAtomicConvergenceConfig,
  normalizeReferenceFrames,
  normalizeExpectedLayers,
  expectedLayersFromCriticalFrames,
  evaluateAtomicSnapshot,
  buildAtomicCorrections,
  buildAtomicPatchScript,
  runAtomicConvergence,
  createStage5Adapters
} from '../../src/vision/atomic-convergence.mjs';

const WIDTH = 96;
const HEIGHT = 54;
const BASE_WIDTH = 20;
const BASE_HEIGHT = 10;
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

function renderFrame(boxes, colour = FILL) {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  png.data.fill(0);
  for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = 255;
  for (const box of boxes) paint(png, box, colour);
  return png;
}

function pixelBox(x, y, width = BASE_WIDTH, height = BASE_HEIGHT) {
  return { x, y, width, height };
}

/**
 * A tiny scene model: one 20x10 card animated between two positions. The
 * initial transform is offset and scaled down, so one correction round can put
 * it exactly on the reference.
 */
function createScene() {
  const state = new Map([
    [0, { cx: 37, cy: 30, sx: 0.7, sy: 0.7 }],
    [10, { cx: 67, cy: 40, sx: 0.7, sy: 0.7 }]
  ]);
  const boxAt = frame => {
    const entry = state.get(frame);
    const width = BASE_WIDTH * entry.sx;
    const height = BASE_HEIGHT * entry.sy;
    return {
      x: entry.cx - width / 2,
      y: entry.cy - height / 2,
      width,
      height,
      centre: { x: entry.cx, y: entry.cy }
    };
  };
  const attrsAt = frame => {
    const entry = state.get(frame);
    return {
      'position.x': entry.cx,
      'position.y': entry.cy,
      'scale.x': entry.sx,
      'scale.y': entry.sy,
      rotation: 0
    };
  };
  const apply = entry => {
    const frames = entry.frame == null ? [...state.keys()] : [Math.round(entry.frame)];
    for (const frame of frames) {
      const current = state.get(frame);
      if (!current) continue;
      if (entry.attrs) {
        if (entry.attrs['position.x'] !== undefined) current.cx = Number(entry.attrs['position.x']);
        if (entry.attrs['position.y'] !== undefined) current.cy = Number(entry.attrs['position.y']);
        if (entry.attrs['scale.x'] !== undefined) current.sx = Number(entry.attrs['scale.x']);
        if (entry.attrs['scale.y'] !== undefined) current.sy = Number(entry.attrs['scale.y']);
      }
      if (entry.delta) {
        if (entry.delta['position.x'] !== undefined) current.cx += Number(entry.delta['position.x']);
        if (entry.delta['position.y'] !== undefined) current.cy += Number(entry.delta['position.y']);
      }
      if (entry.multiply) {
        if (entry.multiply['scale.x'] !== undefined) current.sx *= Number(entry.multiply['scale.x']);
        if (entry.multiply['scale.y'] !== undefined) current.sy *= Number(entry.multiply['scale.y']);
      }
    }
  };
  return { state, boxAt, attrsAt, apply };
}

function expectedCard(frames) {
  const boxes = {};
  for (const { frame, box } of frames) boxes[frame] = box;
  return [{
    elementId: 'shot-foreground',
    match: { name: 'Card', alias: '@hero_card' },
    boxes,
    space: 'pixels',
    animated: true
  }];
}

function snapshotProviderFor(scene, referenceFrames, options = {}) {
  return async request => ({
    ok: true,
    kind: 'snapshot-batch',
    requested: request.frames.length,
    frames: request.frames.map(frame => ({
      frame,
      exists: true,
      frameHash: `hash-${frame}`,
      png: options.render(frame, scene),
      layers: options.layers === false ? [] : [{
        id: 'shape#0',
        ref: 'shape#0',
        type: 'shape',
        name: 'Card',
        visible: true,
        bbox: scene.boxAt(frame),
        attrs: scene.attrsAt(frame)
      }]
    }))
  });
}

const referenceFrames = [
  { frame: 0, png: renderFrame([pixelBox(20, 20)]) },
  { frame: 10, png: renderFrame([pixelBox(50, 30)]) }
];
const expected = expectedCard([
  { frame: 0, box: pixelBox(20, 20) },
  { frame: 10, box: pixelBox(50, 30) }
]);

test('atomic convergence defaults match the Stage 5 contract and clamp at 3 rounds', () => {
  const defaults = loadAtomicConvergenceConfig({});
  assert.equal(defaults.version, ATOMIC_CONVERGENCE_VERSION);
  assert.equal(defaults.ssimMin, 0.985);
  assert.equal(defaults.bboxDriftPxMax, 1);
  assert.equal(defaults.maxIterations, 3);
  assert.equal(defaults.snapshotScale, 100);

  const clamped = loadAtomicConvergenceConfig({
    atomicConvergence: { ssimMin: 1.4, bboxDriftPxMax: -2, maxIterations: 9, positionGain: 2 }
  });
  assert.equal(clamped.ssimMin, 1);
  assert.equal(clamped.bboxDriftPxMax, 0);
  assert.equal(clamped.maxIterations, 3);
  assert.equal(clamped.positionGain, 1);
});

test('critical-frame envelopes convert to pixel layers and keep match metadata', () => {
  const critical = {
    elements: [{
      elementId: 'beat_01_card',
      animated: true,
      boxes: {
        0: { x: 0.1, y: 0.2, width: 0.1, height: 0.1 },
        12: { x: 0.5, y: 0.4, width: 0.1, height: 0.1 }
      }
    }]
  };
  const layers = expectedLayersFromCriticalFrames(critical, {
    matches: { beat_01_card: { name: 'Card', alias: '@hero_card' } }
  });
  assert.equal(layers.length, 1);
  assert.deepEqual(layers[0].match, { name: 'Card', alias: '@hero_card' });
  const normalized = normalizeExpectedLayers(layers, { frameWidth: 200, frameHeight: 100 });
  assert.deepEqual(normalized[0].pixelBoxes.get(0), pixelBox(20, 20));
  assert.deepEqual(normalized[0].pixelBoxes.get(12), pixelBox(100, 40));
  assert.equal(normalized[0].animated, true);
});

test('runAtomicConvergence corrects position and scale in one _mg.patch round', async () => {
  const scene = createScene();
  const scripts = [];
  const provider = snapshotProviderFor(scene, referenceFrames, {
    render: frame => renderFrame([scene.boxAt(frame)])
  });
  const executor = async (script, meta) => {
    scripts.push(script);
    for (const entry of meta.entries) scene.apply(entry);
    return { ok: true, patched: meta.entries.length };
  };

  const result = await runAtomicConvergence({
    shotId: 'shot-a',
    referenceFrames,
    expectedLayers: expected,
    snapshotProvider: provider,
    patchExecutor: executor
  });

  assert.equal(result.converged, true);
  assert.equal(result.stopReason, 'gate_passed');
  assert.equal(result.iterationsRun, 1);
  assert.equal(result.rounds.length, 2);
  assert.ok(result.gate.ssim.global >= 0.985, `ssim ${result.gate.ssim.global}`);
  assert.ok(result.gate.bbox.maxDriftPx <= 1, `drift ${result.gate.bbox.maxDriftPx}`);
  assert.equal(result.final.iteration, 1);

  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /_mg\.patch\(/);
  assert.doesNotMatch(scripts[0], /_mg\.(shape|text|create|layer)\(/);
  assert.match(scripts[0], /"alias": "@hero_card"/);
  assert.match(scripts[0], /"frame": 0/);
  assert.match(scripts[0], /"frame": 10/);

  // The first round measured the initial 7 px / 5 px offset and 0.7 scale.
  const baseline = result.rounds[0];
  assert.equal(baseline.measured, true);
  assert.ok(baseline.layers[0].maxDriftPx > 8);
  assert.equal(result.rounds[1].corrections, 2);
});

test('runAtomicConvergence stops without writing when geometry is inside tolerance but colour is wrong', async () => {
  const scene = createScene();
  scene.state.get(0).cx = 30;
  scene.state.get(0).cy = 25;
  scene.state.get(0).sx = 1;
  scene.state.get(0).sy = 1;
  const singleReference = [{ frame: 0, png: referenceFrames[0].png }];
  const singleExpected = expectedCard([{ frame: 0, box: pixelBox(20, 20) }]);
  const provider = snapshotProviderFor(scene, singleReference, {
    render: () => renderFrame([scene.boxAt(0)], [20, 60, 220])
  });
  let patches = 0;
  const result = await runAtomicConvergence({
    referenceFrames: singleReference,
    expectedLayers: singleExpected,
    snapshotProvider: provider,
    patchExecutor: async () => { patches += 1; return { ok: true }; }
  });

  assert.equal(result.converged, false);
  assert.equal(result.stopReason, 'no_corrections');
  assert.equal(patches, 0);
  assert.equal(result.gate.bbox.passed, true);
  assert.equal(result.gate.ssim.passed, false);
  assert.ok(result.gate.color.maxDelta > 0.5);
  assert.ok(result.gate.failures.includes('ssim'));
});

test('runAtomicConvergence reports a failed patch instead of claiming a new measurement', async () => {
  const scene = createScene();
  const provider = snapshotProviderFor(scene, referenceFrames, {
    render: frame => renderFrame([scene.boxAt(frame)])
  });
  const result = await runAtomicConvergence({
    referenceFrames,
    expectedLayers: expected,
    snapshotProvider: provider,
    patchExecutor: async () => { throw new Error('stallion refused the script'); }
  });

  assert.equal(result.converged, false);
  assert.equal(result.stopReason, 'patch_failed');
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[1].measured, false);
  assert.equal(result.rounds[1].patch.applied, false);
  assert.match(result.rounds[1].patch.error, /refused/);
});

test('runAtomicConvergence reports a failed follow-up snapshot', async () => {
  const scene = createScene();
  const provider = snapshotProviderFor(scene, referenceFrames, {
    render: frame => renderFrame([scene.boxAt(frame)])
  });
  let calls = 0;
  const result = await runAtomicConvergence({
    referenceFrames,
    expectedLayers: expected,
    snapshotProvider: async request => {
      calls += 1;
      if (calls > 1) throw new Error('bridge offline');
      return provider(request);
    },
    patchExecutor: async (script, meta) => {
      for (const entry of meta.entries) scene.apply(entry);
      return { ok: true };
    }
  });

  assert.equal(result.stopReason, 'snapshot_failed');
  assert.equal(result.converged, false);
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[1].gate, null);
  assert.match(result.rounds[1].error, /offline/);
});

test('an unmatched expected layer fails the gate and produces no correction', async () => {
  const scene = createScene();
  const provider = snapshotProviderFor(scene, referenceFrames, {
    render: frame => renderFrame([scene.boxAt(frame)]),
    layers: false
  });
  const result = await runAtomicConvergence({
    referenceFrames,
    expectedLayers: expected,
    snapshotProvider: provider,
    patchExecutor: async () => ({ ok: true })
  });

  assert.equal(result.converged, false);
  assert.equal(result.stopReason, 'no_corrections');
  assert.ok(result.gate.failures.includes('layer:shot-foreground:unmatched'));
  assert.equal(result.rounds[0].layers[0].measuredFrames, 0);
});

test('static layers emit delta + multiply without frame targeting', () => {
  const reference = [{ frame: 0, png: renderFrame([pixelBox(10, 20)]) }];
  const layers = normalizeExpectedLayers([{
    elementId: 'chip',
    match: { name: 'Chip' },
    boxes: { 0: pixelBox(10, 20) },
    space: 'pixels'
  }], { frameWidth: WIDTH, frameHeight: HEIGHT });
  const evaluation = evaluateAtomicSnapshot({
    referenceFrames: reference,
    expectedLayers: layers,
    snapshot: [{
      frame: 0,
      layers: [{
        id: 'shape#3',
        name: 'Chip',
        visible: true,
        bbox: { x: 12, y: 20, width: 10, height: 5 }
      }]
    }]
  });

  const correction = buildAtomicCorrections(evaluation);
  assert.equal(correction.entries.length, 1);
  assert.equal(correction.entries[0].target, 'shape#3');
  assert.equal(correction.entries[0].frame, undefined);
  assert.equal(correction.entries[0].delta['position.x'], 3);
  assert.equal(correction.entries[0].multiply['scale.x'], 2);
  assert.equal(correction.entries[0].multiply['scale.y'], 2);
  assert.equal(correction.summary.staticEntries, 1);
});

test('the patch script is one atomic _mg.patch array and rejects an empty payload', () => {
  const script = buildAtomicPatchScript([
    { alias: '@hero_card', attrs: { 'position.x': 30 }, frame: 4 }
  ], { iteration: 2, shotId: 'shot-a' });
  assert.match(script, /_mg\.patch\(\[/);
  assert.match(script, /"alias": "@hero_card"/);
  assert.match(script, /"frame": 4/);
  assert.throws(() => buildAtomicPatchScript([]), /at least one correction entry/);
});

test('a render that ignores corrections stops at the configured maximum', async () => {
  const scene = createScene();
  const provider = snapshotProviderFor(scene, referenceFrames, {
    render: frame => renderFrame([scene.boxAt(frame)])
  });
  let patches = 0;
  const result = await runAtomicConvergence({
    referenceFrames,
    expectedLayers: expected,
    snapshotProvider: provider,
    patchExecutor: async () => { patches += 1; return { ok: true }; }
  });

  assert.equal(result.converged, false);
  assert.equal(result.stopReason, 'max_iterations');
  assert.equal(result.iterationsRun, 3);
  assert.equal(patches, 3);
  assert.equal(result.rounds.length, 4);
});

test('reference frames without pixels are rejected instead of silently skipped', () => {
  assert.throws(() => normalizeReferenceFrames([{ frame: 0, path: 'C:/missing/frame.png' }]), /no decodable pixels/);
  assert.throws(() => normalizeReferenceFrames([]), /no usable frames/);
});

test('createStage5Adapters validates both runtime clients', () => {
  assert.throws(() => createStage5Adapters({}), /Stallion client/);
  assert.throws(
    () => createStage5Adapters({ stallionClient: { snapshotBatch() {} } }),
    /Cavalry adapter/
  );
  assert.throws(
    () => createStage5Adapters({ snapshot: 3, stallionClient: { snapshotBatch() {} }, cavalryAdapter: { runScript() {} } }),
    /snapshot defaults/
  );
});

test('the Stage 5 adapters forward frames and attrs to one snapshot-batch call', async () => {
  const calls = [];
  const stallionClient = {
    async snapshotBatch(batch) {
      calls.push(batch);
      return {
        ok: true,
        kind: 'snapshot-batch',
        frames: batch.frames.map(frame => ({
          frame,
          exists: true,
          frameHash: `hash-${frame}`,
          pngBase64: PNG.sync.write(renderFrame([pixelBox(20, 20)])).toString('base64'),
          layers: []
        }))
      };
    }
  };
  const adapters = createStage5Adapters({
    stallionClient,
    cavalryAdapter: { runScript() {} },
    snapshot: { outDir: 'C:/tmp/evidence', timeoutMs: 5000 }
  });

  const result = await adapters.snapshotProvider({
    frames: [0, 10],
    scale: 100,
    attrs: ['position.x', 'scale.x'],
    iteration: 2,
    shotId: 'shot-01'
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].frames, [0, 10]);
  assert.equal(calls[0].scale, 100);
  assert.deepEqual(calls[0].attrs, ['position.x', 'scale.x']);
  assert.equal(calls[0].outDir, 'C:/tmp/evidence');
  assert.equal(calls[0].timeoutMs, 5000);
  assert.equal(result.decodedCount, 2);
  assert.equal(result.iteration, 2);
  assert.equal(result.decodedFrames.length, 2);
});

test('the Stage 5 patch adapter dispatches strict contract scripts and echoes meta', async () => {
  const scripts = [];
  const cavalryAdapter = {
    async runScript(code, options) {
      scripts.push({ code, options });
      return { ok: true, operation: 'runScript', value: { patched: 1 } };
    }
  };
  const adapters = createStage5Adapters({
    stallionClient: { snapshotBatch() {} },
    cavalryAdapter,
    script: { timeoutMs: 9000 }
  });

  const result = await adapters.patchExecutor('_mg.patch([]);', {
    iteration: 1,
    shotId: 'shot-01',
    scriptHash: 'abc123'
  });

  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].code, '_mg.patch([]);');
  assert.equal(scripts[0].options.contractMode, 'strict');
  assert.equal(scripts[0].options.timeoutMs, 9000);
  assert.equal(scripts[0].options.readOnly, false);
  assert.equal(result.iteration, 1);
  assert.equal(result.scriptHash, 'abc123');
  assert.equal(result.ok, true);
});

test('the composed adapters converge a scene through one real patch script', async () => {
  const scene = createScene();
  const stallionClient = {
    async snapshotBatch(batch) {
      return {
        ok: true,
        kind: 'snapshot-batch',
        frames: batch.frames.map(frame => ({
          frame,
          exists: true,
          frameHash: `hash-${frame}`,
          pngBase64: PNG.sync.write(renderFrame([scene.boxAt(frame)])).toString('base64'),
          layers: [{
            id: 'shape#0',
            ref: 'shape#0',
            type: 'shape',
            name: 'Card',
            visible: true,
            bbox: scene.boxAt(frame),
            attrs: scene.attrsAt(frame)
          }]
        }))
      };
    }
  };
  const cavalryAdapter = {
    async runScript(code) {
      const match = code.match(/_mg\.patch\(([\s\S]*)\);\s*$/);
      assert.ok(match, 'generated script is one _mg.patch call');
      for (const entry of JSON.parse(match[1])) scene.apply(entry);
      return { ok: true, operation: 'runScript' };
    }
  };
  const adapters = createStage5Adapters({ stallionClient, cavalryAdapter });

  const result = await runAtomicConvergence({
    referenceFrames,
    expectedLayers: expected,
    ...adapters
  });

  assert.equal(result.converged, true);
  assert.equal(result.stopReason, 'gate_passed');
  assert.equal(result.iterationsRun, 1);
  assert.equal(result.rounds.length, 2);
  assert.match(result.rounds[1].patch.scriptHash, /^[a-f0-9]{64}$/);
});
