// Stage 5 tests: local perceptual comparison, compact delta patches and the sparse
// closed loop. The fake transport renders deterministic PNGs, so the pass count and the
// patch payload are asserted instead of inspected through a live Cavalry session.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  buildDeltaPatch, compareImages, distributeDrift, inkBounds, runPerceptualGate, sparseBeatFrames
} from '../src/stages/perceptualDiff.mjs';
import { estimateTokens } from '../src/dsl/_mg.mjs';
import { BLUE, RED, WHITE, canvas, plate } from './fixtures.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

function block(width, height, left, top, size = 6, color = RED) {
  return PNG.sync.write(plate(canvas(width, height, WHITE), color, left, top, left + size, top + size));
}

test('odiff reports a local mismatch percentage and its bounding box', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'compare-'));
  const referencePath = path.join(directory, 'reference.png');
  const renderPath = path.join(directory, 'render.png');
  await fs.writeFile(referencePath, block(40, 30, 5, 5, 4));
  await fs.writeFile(renderPath, block(40, 30, 8, 5, 4));
  const comparison = await compareImages(referencePath, renderPath, path.join(directory, 'diff.png'));
  assert.equal(comparison.engine, 'odiff');
  assert.equal(comparison.match, false);
  assert.equal(comparison.reason, 'pixel-diff');
  assert.ok(Math.abs(comparison.mismatchPct - 2) < 0.05, `mismatch ${comparison.mismatchPct}`);
  assert.ok(comparison.bbox);
  assert.ok(comparison.bbox.x1 <= 5 && comparison.bbox.x2 >= 11);
  assert.ok(comparison.bbox.y1 <= 5 && comparison.bbox.y2 >= 8);
  assert.ok(comparison.diffPath);
  assert.equal((await fs.stat(comparison.diffPath)).isFile(), true);

  const layoutPath = path.join(directory, 'layout.png');
  await fs.writeFile(layoutPath, block(40, 20, 5, 5, 4));
  const shifted = await compareImages(referencePath, layoutPath, path.join(directory, 'layout-diff.png'));
  assert.equal(shifted.match, false);
  assert.equal(shifted.reason, 'pixel-diff');
  assert.ok(shifted.mismatchPct > 30, `layout mismatch ${shifted.mismatchPct}`);
  const identical = await compareImages(referencePath, referencePath, path.join(directory, 'same.png'));
  assert.equal(identical.match, true);
  assert.equal(identical.mismatchPct, 0);
  assert.equal(identical.bbox, null);
});

test('ink bounds ignore the corner background and locate the moving block', () => {
  const bounds = inkBounds(block(40, 30, 10, 8, 6));
  assert.equal(bounds.empty, false);
  assert.deepEqual(bounds.bbox, { x1: 10, y1: 8, x2: 15, y2: 13, width: 6, height: 6 });
  assert.deepEqual(bounds.centre, { x: 12.5, y: 10.5 });
  const empty = inkBounds(PNG.sync.write(canvas(10, 10, BLUE)));
  assert.equal(empty.empty, true);
});

test('delta patches are compact absolute values with a known pose', () => {
  const absolute = buildDeltaPatch({
    layerId: 'block', layerRef: 'L0', current: { position: { x: 100, y: 200 } }, dx: 3, dy: -2, mismatchPct: 0.5
  });
  assert.deepEqual(absolute, {
    targetRef: 'L0', attrs: { 'position.x': 103, 'position.y': 198 }, mismatchPct: 0.5
  });
  const relative = buildDeltaPatch({ layerId: 'block', dx: 3, dy: 0 });
  assert.deepEqual(relative, { target: 'block', delta: { 'position.x': 3 } });
  assert.throws(() => buildDeltaPatch({ dx: 1 }), /layer id or compiled layer reference/);
});

test('sparse beat frames select inflection frames, clamp and deduplicate', () => {
  assert.deepEqual(sparseBeatFrames([
    { inFrame: 0, peakFrame: 1, outFrame: 2 },
    { inFrame: 10, peakFrame: 15, outFrame: 20 }
  ]), [1, 11, 15, 19]);
});

test('beat drift is partitioned by overlap or displacement and degrades on complete overlap', () => {
  const targets = [
    { id: 'a', amplitude: 80, expected: { position: { x: 100, y: 10 } } },
    { id: 'b', amplitude: 20, expected: { position: { x: 300, y: 10 } } }
  ];
  const shares = distributeDrift(targets, { dx: 10, dy: -5 });
  assert.deepEqual(shares.map(share => share.target.id), ['a', 'b']);
  assert.deepEqual(shares.map(share => share.weight), [0.8, 0.2]);
  assert.deepEqual(shares.map(share => share.dx), [8, 2]);
  assert.deepEqual(shares.map(share => share.dy), [-4, -1]);
  assert.equal(shares[0].basis, 'displacement');

  // When every candidate has a known projected box, the mismatch region decides.
  const spatial = distributeDrift([
    { id: 'a', box: { x1: 0, y1: 0, x2: 10, y2: 10 }, expected: { position: { x: 10, y: 10 } } },
    { id: 'b', box: { x1: 20, y1: 0, x2: 40, y2: 10 }, expected: { position: { x: 30, y: 10 } } }
  ], { dx: 6, dy: 0, mismatchBox: { x1: 0, y1: 0, x2: 40, y2: 10 } });
  assert.equal(spatial[0].basis, 'mismatch-overlap');
  assert.deepEqual(spatial.map(share => share.weight), [0.3333, 0.6667]);

  // Indistinguishable tracks get the whole delta on the primary layer, not a guess.
  const overlapping = distributeDrift([
    { id: 'a', amplitude: 50, expected: { position: { x: 100, y: 10 } } },
    { id: 'b', amplitude: 50, expected: { position: { x: 100.1, y: 10 } } }
  ], { dx: 7, dy: 3 });
  assert.equal(overlapping.length, 1);
  assert.equal(overlapping[0].target.id, 'a');
  assert.equal(overlapping[0].dx, 7);
  assert.equal(overlapping[0].dy, 3);
  assert.equal(overlapping[0].fallback, 'primary');

  const single = distributeDrift([{ id: 'only', amplitude: 5 }], { dx: 2, dy: 1 });
  assert.equal(single.length, 1);
  assert.equal(single[0].basis, 'single');
  assert.deepEqual([single[0].dx, single[0].dy, single[0].weight], [2, 1, 1]);
  assert.deepEqual(distributeDrift([], { dx: 1, dy: 1 }), []);
});

function fakeTransport({ width = 40, height = 30, startX, converge = true }) {
  let x = startX;
  const calls = [];
  return {
    calls,
    get x() { return x; },
    available: true,
    async renderFrames({ frames, directory }) {
      await fs.mkdir(directory, { recursive: true });
      const rendered = [];
      for (const frame of frames) {
        const filePath = path.join(directory, `render-${String(frame).padStart(6, '0')}.png`);
        await fs.writeFile(filePath, block(width, height, x, 10));
        rendered.push({ frame, path: filePath });
      }
      return rendered;
    },
    async exec(script) {
      calls.push(script);
      if (converge) x = 10;
      return { ok: true };
    }
  };
}

async function gateFixture(baseX = 7) {
  const directory = await fs.mkdtemp(path.join(work, 'gate-'));
  const referencePath = path.join(directory, 'reference.png');
  await fs.writeFile(referencePath, block(40, 30, 10, 10));
  const beats = [{ beatIndex: 0, inFrame: 0, peakFrame: 10, outFrame: 20 }];
  const referenceFrames = new Map([[1, referencePath], [10, referencePath], [19, referencePath]]);
  const scene = {
    layers: [{
      id: 'block',
      base: { position: { x: baseX, y: 10 }, scale: 1, rotation: 0, opacity: 100 },
      moves: []
    }]
  };
  return { directory, referencePath, beats, referenceFrames, scene };
}

test('the gate converges on an exact first render without sending a patch', async () => {
  const fixture = await gateFixture();
  const client = fakeTransport({ startX: 10 });
  const gate = await runPerceptualGate({
    client, beats: fixture.beats, referenceFrames: fixture.referenceFrames,
    scene: fixture.scene, layerForBeat: () => 'block', layerRefs: { block: 'L0' },
    outputDirectory: fixture.directory, threshold: 1.5, maxPasses: 3
  });
  assert.equal(gate.status, 'converged');
  assert.equal(gate.convergedAtPass, 1);
  assert.equal(gate.passes.length, 1);
  assert.equal(gate.patches.length, 0);
  assert.equal(client.calls.length, 0);
  assert.deepEqual(gate.frames, [1, 10, 19]);
  assert.equal(gate.beats[0].status, 'CONVERGED');
  assert.equal(gate.beats[0].engine, 'odiff');
});

test('one compact patch per pass moves the layer and converges on pass two', async () => {
  const fixture = await gateFixture(6);
  // Four pixels of drift is 4% of the frame, above the 1.5% convergence threshold.
  const client = fakeTransport({ startX: 6 });
  const gate = await runPerceptualGate({
    client, beats: fixture.beats, referenceFrames: fixture.referenceFrames,
    scene: fixture.scene, layerForBeat: () => 'block', layerRefs: { block: 'L0' },
    outputDirectory: fixture.directory, threshold: 1.5, maxPasses: 3
  });
  assert.equal(gate.status, 'converged');
  assert.equal(gate.convergedAtPass, 2);
  assert.equal(gate.passes.length, 2);
  assert.equal(gate.patches.length, 1);
  assert.equal(client.calls.length, 1);
  assert.ok(gate.passes[0].script);
  assert.ok(estimateTokens(gate.passes[0].script) < 150, `patch tokens ${estimateTokens(gate.passes[0].script)}`);
  assert.match(gate.passes[0].script, /_mg\.patch\(/);
  assert.match(gate.passes[0].script, /"target":L0/);
  assert.match(gate.passes[0].script, /"position\.x":10/);
  assert.equal(client.calls[0], gate.passes[0].script);
  assert.equal(gate.passes[0].patches[0].mismatchPct > 0, true);
});

test('one Stage 5 pass batches a patch for every selected layer', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'gate-multi-'));
  const width = 80;
  const height = 30;
  const reference = plate(plate(canvas(width, height, WHITE), RED, 10, 8, 18, 16), RED, 40, 8, 48, 16);
  const drifted = plate(plate(canvas(width, height, WHITE), RED, 8, 8, 16, 16), RED, 34, 8, 42, 16);
  const referencePath = path.join(directory, 'reference.png');
  await fs.writeFile(referencePath, PNG.sync.write(reference));
  let patched = false;
  const execs = [];
  const client = {
    available: true,
    async renderFrames({ frames, directory: passDirectory }) {
      await fs.mkdir(passDirectory, { recursive: true });
      const rendered = [];
      for (const frame of frames) {
        const filePath = path.join(passDirectory, `render-${frame}.png`);
        await fs.writeFile(filePath, PNG.sync.write(patched ? reference : drifted));
        rendered.push({ frame, path: filePath });
      }
      return rendered;
    },
    async exec(script) {
      execs.push(script);
      patched = true;
      return { ok: true };
    }
  };
  const beats = [{ beatIndex: 0, inFrame: 0, peakFrame: 5, outFrame: 10 }];
  const referenceFrames = new Map([[1, referencePath], [5, referencePath], [9, referencePath]]);
  const scene = {
    layers: [
      { id: 'left', base: { position: { x: 14, y: 12 }, scale: 1, rotation: 0, opacity: 100 }, moves: [] },
      { id: 'right', base: { position: { x: 44, y: 12 }, scale: 1, rotation: 0, opacity: 100 }, moves: [] }
    ]
  };
  const layerBoxes = {
    left: { x1: 10, y1: 8, x2: 18, y2: 16 },
    right: { x1: 40, y1: 8, x2: 48, y2: 16 }
  };
  const gate = await runPerceptualGate({
    client, beats, referenceFrames, scene, threshold: 1.5, maxPasses: 2,
    layersForBeat: () => [
      { id: 'left', amplitude: 20, expected: { position: { x: 14, y: 12 } }, box: layerBoxes.left },
      { id: 'right', amplitude: 20, expected: { position: { x: 44, y: 12 } }, box: layerBoxes.right }
    ],
    layerRefs: { left: 'L0', right: 'L1' },
    outputDirectory: directory
  });
  assert.equal(gate.status, 'converged');
  assert.equal(gate.convergedAtPass, 2);
  assert.equal(execs.length, 1, 'exactly one batched refinement script');
  const pass = gate.passes[0];
  assert.equal(pass.patches.length, 2);
  assert.equal(pass.attribution.length, 1);
  assert.equal(pass.attribution[0].basis, 'mismatch-overlap');
  assert.equal(pass.attribution[0].targets.length, 2);
  const script = pass.script;
  assert.equal(script.includes('_mg.comp('), false);
  assert.equal((script.match(/_mg\.patch\(\[/g) ?? []).length, 1, 'both layers share one _mg.patch array');
  const left = pass.patches.find(patch => patch.targetRef === 'L0');
  const right = pass.patches.find(patch => patch.targetRef === 'L1');
  assert.ok(left && right);
  assert.ok(left.attrs['position.x'] > 14 && left.attrs['position.x'] < 17, `left ${left.attrs['position.x']}`);
  assert.ok(right.attrs['position.x'] > 44 && right.attrs['position.x'] < 47, `right ${right.attrs['position.x']}`);
});

test('an unrepaired mismatch is reported as unconverged after the pass ceiling', async () => {
  const fixture = await gateFixture();
  const client = fakeTransport({ startX: 7, converge: false });
  const gate = await runPerceptualGate({
    client, beats: fixture.beats, referenceFrames: fixture.referenceFrames,
    scene: fixture.scene, layerForBeat: () => 'block', layerRefs: { block: 'L0' },
    outputDirectory: fixture.directory, threshold: 0.01, maxPasses: 2
  });
  assert.equal(gate.status, 'unconverged');
  assert.equal(gate.converged, false);
  assert.equal(gate.passes.length, 2);
  assert.equal(client.calls.length, 1);
  assert.equal(gate.patches.length, 1);
  assert.ok(gate.limitations.some(line => /max-passes/.test(line)));
});

test('without a render transport the gate is unavailable, never a fake convergence', async () => {
  const unavailable = await runPerceptualGate({
    client: null, beats: [{ beatIndex: 0, inFrame: 0, peakFrame: 5, outFrame: 9 }],
    referenceFrames: null, threshold: 1.5, maxPasses: 3
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.converged, false);
  assert.ok(unavailable.limitations[0].includes('Stallion'));
  await assert.rejects(runPerceptualGate({ client: null, beats: [], threshold: -1 }),
    error => error.code === 'PERCEPTUAL_OPTIONS_INVALID');
});
