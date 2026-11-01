// Stage 5 tests: local perceptual comparison, compact delta patches, the sparse closed
// loop and its band-attributed drift mode. The fake transport renders deterministic PNGs,
// so the pass count and the patch payload are asserted instead of inspected through a live
// Cavalry session.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  attributeBandDrift, bandDriftEnabled, beatBands, buildDeltaPatch, compareImages,
  distributeDrift, inkBounds, measureBandDrift, runPerceptualGate, sparseBeatFrames
} from '../src/stages/perceptualDiff.mjs';
import { estimateTokens } from '../src/dsl/_mg.mjs';
import { BLUE, RED, WHITE, canvas, plate, textLine } from './fixtures.mjs';

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

// Band drift needs copy rather than blocks: a solid rectangle carries the same ink in
// every row, so a vertical profile has nothing to lock onto. Two lines of text give each
// band structure on both axes, which is what a real title card looks like.
const LINES = { width: 160, height: 60 };
function twoLines({ aLeft = 8, aTop = 8, bLeft = 8, bTop = 32, color = RED, bColor = color, bText = 'LINE' } = {}) {
  const png = canvas(LINES.width, LINES.height, WHITE);
  textLine(png, 'TEXT', { left: aLeft, top: aTop, color, scale: 2 });
  textLine(png, bText, { left: bLeft, top: bTop, color: bColor, scale: 2 });
  return PNG.sync.write(png);
}

async function linesFixture(state = {}) {
  const directory = await fs.mkdtemp(path.join(work, 'band-'));
  const referencePath = path.join(directory, 'reference.png');
  await fs.writeFile(referencePath, twoLines());
  const layers = [
    { id: 'line-a', base: { position: { x: 30, y: 15 }, scale: 1, rotation: 0, opacity: 100 }, moves: [] },
    { id: 'line-b', base: { position: { x: 30, y: 39 }, scale: 1, rotation: 0, opacity: 100 }, moves: [] }
  ];
  return {
    directory,
    beats: [{ beatIndex: 0, inFrame: 0, peakFrame: 5, outFrame: 10 }],
    referenceFrames: new Map([[1, referencePath], [5, referencePath], [9, referencePath]]),
    scene: { layers },
    layersForBeat: () => layers.map(layer => ({
      id: layer.id, amplitude: 10, expected: { position: { ...layer.base.position } }
    })),
    layerRefs: { 'line-a': 'L0', 'line-b': 'L1' },
    state
  };
}

function linesTransport(state) {
  let current = { ...state };
  const execs = [];
  return {
    execs,
    available: true,
    async renderFrames({ frames, directory }) {
      await fs.mkdir(directory, { recursive: true });
      const rendered = [];
      for (const frame of frames) {
        const filePath = path.join(directory, `render-${String(frame).padStart(6, '0')}.png`);
        await fs.writeFile(filePath, twoLines(current));
        rendered.push({ frame, path: filePath });
      }
      return rendered;
    },
    async exec(script) {
      execs.push(script);
      // The patch is applied: from here the transport renders the reference itself.
      current = {};
      return { ok: true };
    }
  };
}

test('band drift is opt-in, and supplying a band list implies it', () => {
  assert.equal(bandDriftEnabled(undefined, undefined), false);
  assert.equal(bandDriftEnabled(null, [{ y: 8, height: 14 }]), true);
  assert.equal(bandDriftEnabled(true, null), true);
  assert.equal(bandDriftEnabled(false, [{ y: 8, height: 14 }]), false);
});

test('bands are the reference ink rows unless the caller supplies its own', () => {
  const reference = PNG.sync.read(twoLines());
  const discovered = beatBands(reference, null, {});
  assert.deepEqual(discovered.bands.map(band => band.rect.y), [8, 32]);
  assert.deepEqual(discovered.bands.map(band => band.rect.height), [14, 14]);
  assert.match(discovered.basis, /reference ink band/);

  // Any of the shapes a caller plausibly holds resolves to the same rect.
  const supplied = beatBands(reference, [
    { id: 'first', start: 8, end: 22 },
    { id: 'second', rect: { x: 0, y: 32, width: LINES.width, height: 14 } },
    { id: 'third', y: 8, height: 14 }
  ], {});
  assert.deepEqual(supplied.bands.map(band => band.rect), [
    { x: 0, y: 8, width: LINES.width, height: 14 },
    { x: 0, y: 32, width: LINES.width, height: 14 },
    { x: 0, y: 8, width: LINES.width, height: 14 }
  ]);
  assert.equal(supplied.basis, '3 supplied band(s)');
  assert.throws(() => beatBands(reference, [{ note: 'not a band' }], {}),
    error => error.code === 'PERCEPTUAL_BANDS_INVALID');
});

test('each band is measured on its own, with the sign a patch needs', () => {
  const reference = PNG.sync.read(twoLines());
  const render = PNG.sync.read(twoLines({ aLeft: 11, bTop: 35 }));
  const bands = beatBands(reference, null, {}).bands;
  const measurement = measureBandDrift(reference, render, bands, {});
  assert.equal(measurement.summary.bands, 2);
  assert.equal(measurement.summary.patchable, 2);
  assert.equal(measurement.summary.maxCorrectionPx, 3);
  const [upper, lower] = measurement.bands;
  assert.equal(upper.id, 'rows-8-22');
  assert.deepEqual(upper.correctionPx, { dx: -3, dy: 0 });
  assert.deepEqual(lower.correctionPx, { dx: 0, dy: -3 });
  assert.equal(upper.quantumPx, 0.125);
  assert.equal(upper.noiseFloorPx, 0.125);
  assert.equal(upper.aboveNoiseFloor, true);

  // A band of empty rows is refused with a reason, never reported as a plausible zero.
  const blank = measureBandDrift(reference, render, [{ id: 'empty', rect: { x: 0, y: 52, width: LINES.width, height: 6 } }], {});
  assert.equal(blank.bands[0].measured, false);
  assert.equal(blank.bands[0].patchable, false);
  assert.equal(blank.bands[0].reason, 'flat-reference');

  // Drift at or under the floor is evidence about a placement that is already right.
  const tiny = measureBandDrift(reference, PNG.sync.read(twoLines({ aLeft: 9 })), bands, { noiseFloorPx: 4 });
  assert.deepEqual(tiny.bands.map(band => band.patchable), [false, false]);
  assert.deepEqual(tiny.summary.belowNoiseFloor, ['rows-8-22', 'rows-32-46']);
  assert.equal(tiny.summary.patchable, 0);
});

test('a band is claimed by the layer drawn inside it, or reported as unattributed', () => {
  const opposite = value => (value === 0 ? 0 : -value);
  const band = (id, y, correctionPx) => ({
    id, rect: { x: 0, y, width: LINES.width, height: 14 }, patchable: true,
    correctionPx, dxPx: opposite(correctionPx.dx), dyPx: opposite(correctionPx.dy)
  });
  const targets = [
    { id: 'line-a', expected: { position: { x: 30, y: 15 } } },
    { id: 'line-b', expected: { position: { x: 30, y: 39 } } }
  ];
  const split = attributeBandDrift({ bands: [band('rows-8-22', 8, { dx: -3, dy: 0 }), band('rows-32-46', 32, { dx: 0, dy: -3 })] }, targets);
  assert.deepEqual(split.corrections.map(entry => [entry.target.id, entry.correctionPx.dx, entry.correctionPx.dy]),
    [['line-a', -3, 0], ['line-b', 0, -3]]);
  assert.deepEqual(split.corrections.map(entry => entry.basis), ['position-in-band', 'position-in-band']);
  assert.deepEqual([split.contested, split.unattributed], [[], []]);

  // Two bands on one rigid layer are two measurements of one displacement: the median wins.
  const agreed = attributeBandDrift({ bands: [band('a1', 8, { dx: -3, dy: 0 }), band('a2', 10, { dx: -5, dy: 0 })] }, [targets[0]]);
  assert.equal(agreed.corrections.length, 1);
  assert.deepEqual(agreed.corrections[0].correctionPx, { dx: -4, dy: 0 });
  assert.deepEqual(agreed.corrections[0].spreadPx, { dx: 2, dy: 0 });

  // Bands that disagree by more than a rigid layer can explain are not averaged into a guess.
  const contested = attributeBandDrift({ bands: [band('a1', 8, { dx: -3, dy: 0 }), band('a2', 10, { dx: -6, dy: 0 })] }, [targets[0]]);
  assert.equal(contested.corrections.length, 0);
  assert.equal(contested.contested.length, 1);
  assert.match(contested.contested[0].reason, /disagree by 3 px/);

  // A band no candidate owns is reported, not dumped on the primary layer.
  const orphan = attributeBandDrift({ bands: [band('rows-52-58', 52, { dx: -4, dy: 0 })] }, targets);
  assert.equal(orphan.corrections.length, 0);
  assert.deepEqual(orphan.unattributed, [{ id: 'rows-52-58', dxPx: 4, dyPx: 0, reason: 'no-active-layer-in-band' }]);
});

test('band drift sends one correction per drawn band and converges on pass two', async () => {
  const fixture = await linesFixture({ aLeft: 11, bTop: 35 });
  const client = linesTransport(fixture.state);
  const gate = await runPerceptualGate({
    client, beats: fixture.beats, referenceFrames: fixture.referenceFrames, scene: fixture.scene,
    layersForBeat: fixture.layersForBeat, layerRefs: fixture.layerRefs,
    outputDirectory: fixture.directory, threshold: 1.5, maxPasses: 3, bandDrift: true
  });
  assert.equal(gate.status, 'converged');
  assert.equal(gate.convergedAtPass, 2);
  assert.equal(gate.bandDrift.enabled, true);
  assert.equal(client.execs.length, 1, 'one batched refinement pass');
  assert.deepEqual(gate.patches.map(patch => patch.targetRef), ['L0', 'L1']);
  // Each layer is corrected in its own axis only — a shared centroid would slide both in both.
  assert.deepEqual(gate.patches[0].attrs, { 'position.x': 27 });
  assert.deepEqual(gate.patches[1].attrs, { 'position.y': 36 });
  assert.deepEqual(gate.patches.map(patch => patch.bands), [['rows-8-22'], ['rows-32-46']]);
  const attribution = gate.passes[0].attribution[0];
  assert.equal(attribution.basis, 'band-drift');
  assert.equal(attribution.maxCorrectionPx, 3);
  assert.deepEqual(attribution.targets.map(entry => entry.dx), [-3, 0]);
  assert.deepEqual(attribution.targets.map(entry => entry.dy), [0, -3]);
  assert.equal(attribution.bands.patchable, 2);
  assert.deepEqual([attribution.contested, attribution.unattributed], [[], []]);
  const script = gate.passes[0].script;
  assert.equal((script.match(/_mg\.patch\(\[/g) ?? []).length, 1, 'both corrections share one patch array');
  assert.ok(estimateTokens(script) < 200, `patch tokens ${estimateTokens(script)}`);
});

test('a texture-only difference sends no patch instead of thrashing the layer', async () => {
  const fixture = await linesFixture({ color: BLUE });
  const client = linesTransport(fixture.state);
  const gate = await runPerceptualGate({
    client, beats: fixture.beats, referenceFrames: fixture.referenceFrames, scene: fixture.scene,
    layersForBeat: fixture.layersForBeat, layerRefs: fixture.layerRefs,
    outputDirectory: fixture.directory, threshold: 0.05, maxPasses: 3, bandDrift: true
  });
  assert.equal(gate.status, 'unconverged');
  assert.equal(gate.converged, false);
  assert.equal(gate.patches.length, 0);
  assert.equal(client.execs.length, 0, 'nothing was sent to Cavalry');
  assert.ok(gate.limitations.some(line => /sent no patch/.test(line) && /noise floor/.test(line)),
    `limitations ${JSON.stringify(gate.limitations)}`);
  assert.ok(gate.limitations.some(line => /max-passes/.test(line)));
  const report = gate.passes[0].bandDrift.beats[0];
  assert.equal(report.summary.patchable, 0);
  assert.deepEqual(report.summary.belowNoiseFloor, ['rows-8-22', 'rows-32-46']);
  assert.equal(gate.passes.length, 1, 'the loop stops at the first refusal instead of spending its passes');
});

test('a drift under --noise-floor is measured, reported and left alone', async () => {
  const fixture = await linesFixture({ aLeft: 11 });
  const client = linesTransport(fixture.state);
  const gate = await runPerceptualGate({
    client, beats: fixture.beats, referenceFrames: fixture.referenceFrames, scene: fixture.scene,
    layersForBeat: fixture.layersForBeat, layerRefs: fixture.layerRefs,
    outputDirectory: fixture.directory, threshold: 1.5, maxPasses: 3, bandDrift: true, noiseFloorPx: 4
  });
  assert.equal(gate.patches.length, 0);
  assert.equal(gate.bandDrift.noiseFloorPx, 4);
  assert.ok(gate.limitations.some(line => /4 px noise floor/.test(line)),
    `limitations ${JSON.stringify(gate.limitations)}`);
});
