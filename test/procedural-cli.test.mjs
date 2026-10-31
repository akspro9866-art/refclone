// CLI tests for the procedural route: the dry-run emits the one batched script with no
// frame-baked arrays, and every malformed flag combination fails before any file work.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { defaultFixturePath } from '../src/procedural.mjs';
import { syntheticScene } from './fixtures/procedural.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

const failure = async args => {
  try {
    await main(args);
  } catch (error) {
    return error;
  }
  throw new Error(`expected a failure for: ${args.join(' ')}`);
};

test('procedural --dry-run emits one under-budget script with zero frame tables', async () => {
  const result = await main(['procedural', '--dry-run']);
  assert.equal(result.status, 'dry-run');
  assert.equal(result.layers, 10);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].members, 5);
  assert.equal(result.frameBakedArrays, 0);
  assert.equal(result.tokenBudget.ok, true);
  assert.ok(result.tokenEstimate < 800);
  assert.equal((result.script.match(/\[\[\s*-?\d/g) ?? []).length, 0);
  assert.match(result.script, /^_mg\.ease=/);
  assert.equal(result.artifacts, null);

  // --smooth takes the same boolean-flag path and must stay inside the same budget.
  const smoothed = await main(['procedural', '--dry-run', '--smooth']);
  assert.equal(smoothed.status, 'dry-run');
  assert.equal(smoothed.layers, 10);
  assert.equal(smoothed.frameBakedArrays, 0);
  assert.ok(smoothed.tokenEstimate < 800);
});

test('procedural rejects unknown, repeated and incomplete flags as usage errors', async () => {
  assert.equal((await failure(['procedural'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--nope', 'x'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--dry-run', '--dry-run'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--dry-run', '--input'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--dry-run', '--output', 'a', '--output', 'b'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--input', path.join(work, 'missing.json')])).code, 'FILE_READ_FAILED');
  assert.equal((await failure(['procedural', '--dry-run', '--threshold', '250'])).code, 'PROCEDURAL_OPTIONS_INVALID');
  assert.equal((await failure(['procedural', '--dry-run', '--max-passes', '1.5'])).code, 'PROCEDURAL_OPTIONS_INVALID');
  // maxLayersPerBeat is validated before any stage runs.
  assert.equal((await failure(['procedural', '--dry-run', '--max-layers-per-beat', '0'])).code, 'PROCEDURAL_OPTIONS_INVALID');
  assert.equal((await failure(['procedural', '--dry-run', '--max-layers-per-beat', '9'])).code, 'PROCEDURAL_OPTIONS_INVALID');
});

test('procedural --output writes the script once and never overwrites it', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'cli-procedural-'));
  const input = path.join(directory, 'scene.json');
  await fs.writeFile(input, JSON.stringify(syntheticScene()), 'utf8');
  const output = path.join(directory, 'out');
  const first = await main(['procedural', '--dry-run', '--input', input, '--output', output]);
  assert.ok(first.artifacts);
  assert.equal((await fs.stat(first.artifacts.scriptPath)).isFile(), true);
  assert.equal((await fs.stat(first.artifacts.reportPath)).isFile(), true);
  const script = await fs.readFile(first.artifacts.scriptPath, 'utf8');
  assert.equal(script.trim(), first.script);
  const again = await failure(['procedural', '--dry-run', '--input', input, '--output', output]);
  assert.equal(again.code, 'OUTPUT_EXISTS');
});

test('procedural --live validates its flags and mcp block before any connection', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'cli-live-'));
  const frames = path.join(directory, 'frames');
  await fs.mkdir(frames, { recursive: true });
  const fixture = defaultFixturePath();

  // Live needs reference frames (or a video input for auto extraction); dry-run and
  // live are mutually exclusive; live-only flags are rejected without --live.
  assert.equal((await failure(['procedural', '--live', '--input', fixture])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--live', '--reference', frames])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--live', '--input', fixture, '--auto-reference'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--live', '--input', fixture, '--reference', frames, '--auto-reference'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--dry-run', '--live', '--reference', frames])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--dry-run', '--reference', frames])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--dry-run', '--auto-reference'])).code, 'CLI_USAGE');
  assert.equal((await failure(['procedural', '--dry-run', '--stallion-url', 'http://127.0.0.1:9999'])).code, 'CLI_USAGE');

  // The shipped placeholder must fail as a named config error, not a spawn error,
  // and before any socket is opened.
  const placeholder = path.join(directory, 'config.json');
  await fs.writeFile(placeholder, JSON.stringify({
    schemaVersion: 1,
    mcp: { command: 'node', args: ['REPLACE_ME/cavalry-mcp/dist/index.js'] }
  }), 'utf8');
  assert.equal((await failure([
    'procedural', '--live', '--input', fixture, '--reference', frames, '--config', placeholder
  ])).code, 'ADAPTER_CONFIG_INVALID');

  const valid = path.join(directory, 'config-valid.json');
  await fs.writeFile(valid, JSON.stringify({
    schemaVersion: 1,
    mcp: { command: 'node', args: [path.join(directory, 'no-server.js')] }
  }), 'utf8');
  assert.equal((await failure([
    'procedural', '--live', '--input', fixture, '--reference', frames, '--config', valid,
    '--stallion-url', 'ftp://127.0.0.1:9'
  ])).code, 'TRANSPORT_CONFIG_INVALID');
});
