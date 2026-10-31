// Live procedural flow: Stage 4 executes once through the transport, its returned
// ids are the only patch targets, and Stage 5 converges with compact patch scripts.
// The transport is faked; a real Cavalry/Stallion session is not available in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { runProcedural } from '../src/procedural.mjs';
import { estimateTokens } from '../src/dsl/_mg.mjs';
import { syntheticScene } from './fixtures/procedural.mjs';
import { canvas, plate, RED, WHITE } from './fixtures.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

const WIDTH = 640;
const HEIGHT = 360;
const REFERENCE_X = 300;
const RENDER_X = 260;
const BLOCK = 80;

function blockPng(x) {
  return PNG.sync.write(plate(canvas(WIDTH, HEIGHT, WHITE), RED, x, 120, x + BLOCK, 120 + BLOCK));
}

function liveClient() {
  const ids = Array.from({ length: 10 }, (_, index) => `live-${index}`);
  const execs = [];
  let patched = false;
  return {
    execs,
    get patched() { return patched; },
    available: true,
    async exec(script) {
      execs.push(script);
      if (!script.includes('_mg.patch(')) return { ok: true, value: ids };
      patched = true;
      return { ok: true, value: [] };
    },
    async renderFrames({ frames, directory }) {
      await fs.mkdir(directory, { recursive: true });
      const rendered = [];
      for (const frame of frames) {
        const filePath = path.join(directory, `render-${String(frame).padStart(6, '0')}.png`);
        await fs.writeFile(filePath, blockPng(patched ? REFERENCE_X : RENDER_X));
        rendered.push({ frame, path: filePath });
      }
      return rendered;
    }
  };
}

async function fixture(directory) {
  const scenePath = path.join(directory, 'scene.json');
  await fs.writeFile(scenePath, JSON.stringify(syntheticScene()), 'utf8');
  const referencePath = path.join(directory, 'reference.png');
  await fs.writeFile(referencePath, blockPng(REFERENCE_X));
  // The scene fixture has 91 frames; every frame resolves to the same plate, so
  // any sparse beat frame the gate picks is comparable.
  const referenceFrames = new Map();
  for (let frame = 0; frame <= 90; frame += 1) referenceFrames.set(frame, referencePath);
  return { scenePath, referenceFrames };
}

test('one pass patches every active layer with live ids and converges on pass two', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'live-'));
  const { scenePath, referenceFrames } = await fixture(directory);
  const client = liveClient();
  const result = await runProcedural(scenePath, {
    client,
    referenceFrames,
    liveInfo: { connected: true, server: { name: 'fake-cavalry-mcp' } },
    threshold: 1.5,
    maxPasses: 3
  });

  assert.equal(result.status, 'converged');
  assert.equal(result.live.connected, true);
  assert.equal(result.live.executed, true);
  assert.equal(result.live.layers, 10);
  assert.equal(result.gate.status, 'converged');
  assert.equal(result.gate.convergedAtPass, 2);
  assert.equal(result.gate.passes.length, 2);
  // Beat 0 has four active layers (cap), beat 1 three, beat 2 two: nine targets,
  // all batched into ONE refinement script.
  assert.equal(result.gate.patches.length, 9);
  assert.ok(result.limitations.some(line => /Live Stage 5/.test(line)));

  // Exactly one Stage 4 execution and one batched patch script; nothing re-emits the scene.
  assert.equal(client.execs.length, 2);
  assert.equal(client.execs[0], result.script);
  const patchScript = client.execs[1];
  assert.match(patchScript, /_mg\.patch\(/);
  assert.equal(patchScript.includes('targetRef'), false);
  assert.equal(patchScript.includes('L0'), false);
  // A refinement pass must never re-emit the comp header/reset the composition.
  assert.equal(patchScript.includes('_mg.comp('), false);
  assert.ok(estimateTokens(patchScript) < 400, `patch tokens ${estimateTokens(patchScript)}`);
  // Beat 0 -> word-0..word-3, beat 1 -> mark/disc-a/disc-b, beat 2 -> caption/dial.
  for (const target of ['live-0', 'live-1', 'live-2', 'live-3', 'live-5', 'live-6', 'live-7', 'live-8', 'live-9']) {
    assert.ok(patchScript.includes(`"target":"${target}"`), `missing ${target}`);
  }
  // The leader has a provable pose (absolute attr); stagger followers only a delta.
  assert.match(patchScript, /"target":"live-0","attrs":/);
  assert.match(patchScript, /"delta":\{"position\.x":10\}/);
  assert.match(patchScript, /"frame":(1|31|61)/);

  // Attribution explains the split: each beat's shares cover its measured drift.
  const attribution = result.gate.passes[0].attribution;
  assert.deepEqual(attribution.map(entry => entry.beatIndex), [0, 1, 2]);
  assert.deepEqual(attribution.map(entry => entry.targets.length), [4, 3, 2]);
  for (const entry of attribution) {
    assert.equal(entry.basis, 'displacement');
    const sum = entry.targets.reduce((total, target) => total + target.dx, 0);
    assert.ok(Math.abs(sum - entry.drift.dx) < 0.1, `beat ${entry.beatIndex} dx shares ${sum}`);
    const weights = entry.targets.reduce((total, target) => total + target.weight, 0);
    assert.ok(Math.abs(weights - 1) < 0.001);
  }
});

test('a Stage 4 script that does not return one id per reference fails before any render', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'live-ids-'));
  const { scenePath, referenceFrames } = await fixture(directory);
  let renders = 0;
  const client = {
    available: true,
    async exec() { return { ok: true, value: ['only-one-id'] }; },
    async renderFrames() { renders += 1; return []; }
  };
  await assert.rejects(runProcedural(scenePath, { client, referenceFrames }), error =>
    error.code === 'LIVE_LAYER_IDS_MISSING' && error.details.expected === 10 && error.details.returned === 1);
  assert.equal(renders, 0);
});

test('without a client the orchestrator reports the gate unavailable, never converged', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'live-none-'));
  const { scenePath } = await fixture(directory);
  const result = await runProcedural(scenePath, {});
  assert.equal(result.status, 'compiled');
  assert.equal(result.live, null);
  assert.equal(result.gate.status, 'unavailable');
  assert.equal(result.gate.converged, false);
});
