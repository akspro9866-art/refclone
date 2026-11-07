// CLI integration for the strict commands: they use the strict APIs and exit
// nonzero when blocked, while legacy commands keep their existing behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { strictFixture, beatSpecFor } from '../helpers/strictFixture.mjs';

const cli = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
const validator = fileURLToPath(new URL('../../src/strict/validate-cli.mjs', import.meta.url));
// The strict converge command must see no qualified transport in CI.
const env = { ...process.env };
delete env.STALLION_URL;
delete env.STALLION_HOST;

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, timeout: 60000 });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* help text or error payload */ }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

async function writeSpec(inspection, mutate) {
  const spec = beatSpecFor(inspection);
  if (mutate) mutate(spec);
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'strict-cli-')), 'beat-spec.json');
  await fs.writeFile(file, JSON.stringify(spec, null, 2));
  return file;
}

test('CLI inspect measures the candidate hero and exits zero', async () => {
  const { clip, directory } = await strictFixture();
  const result = run(['inspect', clip.video, '--out', path.join(directory, 'cli-inspect')]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.status, 'inspected');
  assert.equal(result.json.stage1Ran, false);
  assert.deepEqual(result.json.recommendedPresetPacks, []);
  assert.equal(result.json.detectedBeats, null);
  assert.equal(result.json.layerTrajectories, null);
  assert.ok(result.json.heroFrameSpec);
});

test('CLI converge blocks an unqualified live host with a nonzero exit', async () => {
  const { inspection } = await strictFixture();
  const specFile = await writeSpec(inspection);
  const result = run(['converge', specFile]);
  assert.equal(result.status, 1, 'a blocked strict result exits nonzero');
  assert.equal(result.json.ok, false);
  assert.match(result.json.reason, /LIVE_HOST_UNQUALIFIED/);
});

test('CLI validate accepts a BeatSpec and a refclone compile hook, blocks presets', async () => {
  const { inspection } = await strictFixture();
  const specFile = await writeSpec(inspection);
  const valid = run(['validate', specFile]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.json.status, 'valid');

  const hookFile = path.join(path.dirname(specFile), 'hook.json');
  await fs.writeFile(hookFile, JSON.stringify({ tool_name: 'refclone_compile_and_converge', tool_input: { beatSpec: beatSpecFor(inspection) } }));
  const hook = run(['validate', hookFile]);
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(hook.json.status, 'valid');

  // The plugin hook uses the read-only stdin adapter, not a temporary payload file.
  const stdinRun = input => spawnSync(process.execPath, [validator], { input, encoding: 'utf8', env, timeout: 60000 });
  const adapter = stdinRun(JSON.stringify({ tool_name: 'refclone_compile_and_converge', tool_input: { beatSpec: beatSpecFor(inspection) } }));
  assert.equal(adapter.status, 0, adapter.stderr);
  assert.equal(JSON.parse(adapter.stdout).status, 'valid');
  for (const input of ['{', JSON.stringify({ tool_name: 'refclone_compile_and_converge', tool_input: { beatSpec: {} } }), JSON.stringify({ tool_name: 'cavalry_read_layers', tool_input: {} })]) {
    const rejected = stdinRun(input);
    assert.equal(rejected.status, 1);
    assert.ok(['blocked', 'irrelevant'].includes(JSON.parse(rejected.stdout || rejected.stderr).status));
  }

  const presetFile = await writeSpec(inspection, spec => { spec.layers[0].presetId = 'some_preset'; });
  const blocked = run(['validate', presetFile]);
  assert.equal(blocked.status, 1);
  assert.equal(blocked.json.ok, false);
});

test('legacy CLI behaviour is preserved', async () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /refclone - reference-faithful video cloning/);
  assert.match(help.stdout, /zero-slop/);
  const unknown = run(['not-a-command']);
  assert.equal(unknown.status, 1);
  const badFlag = run(['inspect']);
  assert.equal(badFlag.status, 1, 'inspect requires an input path');
});