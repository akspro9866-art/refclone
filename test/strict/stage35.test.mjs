// Stage 3.5 contract validation: direct BeatSpec and compile-hook payloads,
// fail-closed rejection of unmeasured/preset routes, and proof that validation
// performs zero HTTP (no backend interpretation or transport is involved).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStage35 } from '../../src/strict/index.mjs';
import { strictFixture, beatSpecFor } from '../helpers/strictFixture.mjs';

test('validateStage35 accepts a direct BeatSpec and a compile payload with zero HTTP', async () => {
  const { inspection } = await strictFixture();
  const spec = beatSpecFor(inspection);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('validation must not perform HTTP'); };
  try {
    const direct = await validateStage35(spec);
    assert.equal(direct.ok, true);
    assert.equal(direct.status, 'valid');
    assert.match(direct.manifestHash, /^[a-f0-9]{64}$/);
    assert.equal(direct.tokens.stage2Caller, null);
    assert.match(direct.hostStaticGate, /not-run/);

    const wrapped = await validateStage35({ beatSpec: spec, outputDir: inspection.jobDir, maxIterations: 2 });
    assert.equal(wrapped.status, 'valid');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 0, 'no HTTP request is made during validation');
});

test('validateStage35 recognizes refclone_ and cavalry_ compile hooks', async () => {
  const { inspection } = await strictFixture();
  const spec = beatSpecFor(inspection);
  for (const name of ['refclone_compile_and_converge', 'cavalry_compile_and_converge', 'refclone_clone_beat', 'cavalry_exec_mg']) {
    const result = await validateStage35({ tool_name: name, tool_input: { beatSpec: spec } });
    assert.equal(result.status, 'valid', `${name} is a relevant compile hook`);
  }
  // toolInput spelling and a JSON-string payload are both accepted.
  const stringPayload = await validateStage35({ toolName: 'refclone_compile_and_converge', toolInput: JSON.stringify({ beatSpec: spec }) });
  assert.equal(stringPayload.status, 'valid');
  // An unrelated tool is irrelevant, not blocked.
  const irrelevant = await validateStage35({ tool_name: 'cavalry_read_layers', tool_input: {} });
  assert.equal(irrelevant.ok, true);
  assert.equal(irrelevant.status, 'irrelevant');
});

test('validateStage35 blocks preset, unmeasured-route and malformed payloads', async () => {
  const { inspection } = await strictFixture();
  const spec = beatSpecFor(inspection);

  const preset = structuredClone(spec);
  preset.layers[0].presetId = 'some_preset';
  assert.equal((await validateStage35(preset)).status, 'blocked');

  const wrongRig = structuredClone(spec);
  wrongRig.layers[0].rig = 'static';
  wrongRig.layers[0].motionId = null;
  const rigResult = await validateStage35(wrongRig);
  assert.equal(rigResult.status, 'blocked');
  assert.match(rigResult.reason, /BEATSPEC_UNMEASURED_RIG_OR_MOTION/);

  const extraField = { ...spec, surprise: true };
  assert.match((await validateStage35(extraField)).reason, /unsupported field/);

  const missingLayer = { ...spec, layers: [] };
  assert.equal((await validateStage35(missingLayer)).status, 'blocked');

  const badHookName = await validateStage35({ tool_name: 42, tool_input: {} });
  assert.equal(badHookName.status, 'blocked');
  assert.match(badHookName.reason, /HOOK_TOOL_NAME/);

  const badBudget = await validateStage35({ beatSpec: spec, maxIterations: 99 });
  assert.equal(badBudget.status, 'blocked');
  assert.match(badBudget.reason, /ITERATION_BUDGET/);
});