import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPSULE_RECIPES_VERSION, capsuleDesignTokens, capsuleRecipeKey, discoverCapsuleRecipes,
  loadCapsuleLibrary, loadCapsuleRecipe, missingReadOrderFiles, VENDORED_CAPSULES
} from '../../src/design/capsule-recipes.mjs';
import { validateArtifact, WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'capsules-'));

const errorCode = (code, verify = () => {}) => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  verify(error);
  return true;
};

function manifest() {
  return [
    'schema_version: capsule.package.v1',
    'profile: video.okf.capsule.v1',
    'name: demo',
    'display_name: Demo Capsule',
    'version: 1',
    'status: active',
    'execution_mode: preset',
    'category: demo',
    'primary_workflow: demo_workflow',
    'summary: A minimal capsule used by the loader tests.',
    'capabilities: [motion_template]',
    'tags: [demo]',
    'when_to_use: [demo]',
    'when_not_to_use: []',
    'read_order:',
    '  routing: [index.md]',
    '  planning: []',
    '  generation: []',
    '  qa: []',
    '  learning: []',
    'entrypoints:',
    '  preset: demo_preset'
  ].join('\n');
}

const INPUT_SCHEMA = 'fields:\n  title:\n    required: true\n    type: string\n';
const RUNTIME = [
  'roles: {}',
  'output_contract:',
  '  bgm: none',
  'video_elements:',
  '  fixed:',
  '    aspect_ratio: "16:9"',
  '    output_width_px: 1920',
  '    output_height_px: 1080',
  '  defaults:',
  '    target_duration: 5',
  '  forbidden: [generated_text]'
].join('\n');

async function writeCapsule(directory, { manifestText = manifest(), input = INPUT_SCHEMA, runtime = RUNTIME, quality = null } = {}) {
  await fs.mkdir(path.join(directory, 'contracts'), { recursive: true });
  await fs.writeFile(path.join(directory, 'capsule.yaml'), `${manifestText}\n`);
  await fs.writeFile(path.join(directory, 'contracts', 'input_schema.yaml'), input);
  await fs.writeFile(path.join(directory, 'contracts', 'runtime.yaml'), runtime);
  if (quality) {
    await fs.mkdir(path.join(directory, 'quality'), { recursive: true });
    await fs.writeFile(path.join(directory, 'quality', 'rules.yaml'), quality.rules);
    await fs.writeFile(path.join(directory, 'quality', 'release_gates.yaml'), quality.gates);
  }
  return directory;
}

test('the vendored capsule library loads both packages as schema-valid recipes', async () => {
  const directories = await discoverCapsuleRecipes();
  assert.deepEqual(directories.map(directory => path.basename(directory)),
    ['dual_role_real_screen_recording.capsule', 'repo_signal_grid.capsule']);
  const recipes = await loadCapsuleLibrary();
  assert.equal(recipes.length, 2);
  assert.deepEqual(recipes.map(report => report.recipe.name), ['dual_role_real_screen_recording', 'repo_signal_grid']);
  for (const report of recipes) {
    assert.equal(report.schemaVersion, 1);
    assert.match(report.sourceHash, /^[0-9a-f]{64}$/);
    assert.equal(await validateArtifact('capsule-recipe', report), report);
    assert.equal(path.basename(report.directory), `${report.recipe.name}.capsule`);
    assert.ok(report.contracts.input_schema.fields, 'input schema fields are preserved');
    assert.ok(report.contracts.runtime.video_elements.fixed, 'runtime video elements are preserved');
  }
});

test('capsule design tokens stay upstream values; no default is invented', async () => {
  const [dualRole, signalGrid] = await loadCapsuleLibrary();
  const tokens = capsuleDesignTokens(signalGrid);
  assert.equal(tokens.fixed.aspect_ratio, '6:7');
  assert.equal(tokens.fixed.output_width_px, 1080);
  assert.equal(tokens.defaults.target_duration, 15);
  assert.ok(tokens.forbidden.includes('reconstructed_source_cards'));
  assert.ok(capsuleDesignTokens(dualRole).forbidden.includes('source_creator_face'));
  // A package with no `forbidden` key stays an empty list, never a guessed ban.
  const bare = await writeCapsule(path.join(root, 'tokens.capsule'), {
    manifestText: manifest().replace('name: demo', 'name: tokens'),
    runtime: RUNTIME.replace('\n  forbidden: [generated_text]', '')
  });
  assert.deepEqual(capsuleDesignTokens(await loadCapsuleRecipe(bare)).forbidden, []);
  assert.throws(() => capsuleDesignTokens({}), errorCode('CAPSULE_INVALID'));
});

test('the lean vendored packages name the read-order files they do not ship', async () => {
  const [dualRole, signalGrid] = await loadCapsuleLibrary();
  assert.deepEqual(await missingReadOrderFiles(dualRole), ['assets/index.yaml']);
  const missing = await missingReadOrderFiles(signalGrid);
  assert.ok(missing.includes('assets/index.yaml'), 'heavy assets are excluded from the vendored copy');
  assert.ok(missing.includes('quality/rules.yaml'), 'repo_signal_grid ships no quality contract upstream');
});

test('a capsule recipe identity hashes the manifest and its contracts', async () => {
  const [signalGrid] = await loadCapsuleLibrary();
  const key = await capsuleRecipeKey(signalGrid);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, await capsuleRecipeKey(signalGrid));
  assert.equal(CAPSULE_RECIPES_VERSION, '1.0.0');
  assert.equal(path.basename(VENDORED_CAPSULES), 'capsule-cinema');
});

test('a missing capsule.yaml is a package error, not an empty recipe', async () => {
  const directory = path.join(root, 'empty.capsule');
  await fs.mkdir(directory, { recursive: true });
  await assert.rejects(loadCapsuleRecipe(directory), errorCode('CAPSULE_PACKAGE_MISSING'));
  await assert.rejects(discoverCapsuleRecipes(path.join(root, 'absent')), errorCode('CAPSULE_LIBRARY_MISSING'));
});

test('capsule name and directory must agree', async () => {
  const directory = await writeCapsule(path.join(root, 'wrong-name.capsule'));
  await assert.rejects(loadCapsuleRecipe(directory), errorCode('CAPSULE_NAME_MISMATCH', error => {
    assert.equal(error.details.name, 'demo');
  }));
});

test('a preset capsule must name its entrypoint and a local script its input fields', async () => {
  const noEntry = await writeCapsule(path.join(root, 'no_entry.capsule'), {
    manifestText: manifest().replace('name: demo', 'name: no_entry').replace('entrypoints:\n  preset: demo_preset', 'entrypoints: {}')
  });
  await assert.rejects(loadCapsuleRecipe(noEntry), errorCode('CAPSULE_ENTRYPOINT_MISSING'));

  const emptyFields = await writeCapsule(path.join(root, 'local.capsule'), {
    manifestText: manifest().replace('name: demo', 'name: local').replace('execution_mode: preset', 'execution_mode: local_script')
      .replace('  preset: demo_preset', '  local_script: run.py'),
    input: 'fields: {}\n'
  });
  await assert.rejects(loadCapsuleRecipe(emptyFields), errorCode('CAPSULE_CONTRACT_INVALID'));
});

test('release gates must resolve to declared rules, while checker bindings stay verbatim', async () => {
  const rules = 'rules:\n  - id: gate_one\n    category: planning\n    type: input_gate\n';
  const unresolved = await writeCapsule(path.join(root, 'gate.capsule'), {
    manifestText: manifest().replace('name: demo', 'name: gate'),
    quality: { rules, gates: 'gates:\n  - gate_two\n' }
  });
  await assert.rejects(loadCapsuleRecipe(unresolved), errorCode('CAPSULE_GATE_UNRESOLVED', error => {
    assert.equal(error.details.gate, 'gate_two');
  }));

  const bound = await writeCapsule(path.join(root, 'bound.capsule'), {
    manifestText: manifest().replace('name: demo', 'name: bound'),
    quality: {
      rules,
      gates: 'gates:\n  - gate_one\n  - id: binding_one\n    phase: release\n    checker: path_non_empty\n    params: { path: demo }\n'
    }
  });
  const report = await loadCapsuleRecipe(bound);
  assert.equal(report.contracts.quality.release_gates.gates.length, 2);
});

test('a half-shipped quality contract is refused', async () => {
  const directory = path.join(root, 'half.capsule');
  await writeCapsule(directory, { manifestText: manifest().replace('name: demo', 'name: half') });
  await fs.mkdir(path.join(directory, 'quality'), { recursive: true });
  await fs.writeFile(path.join(directory, 'quality', 'rules.yaml'), 'rules: []\n');
  await assert.rejects(loadCapsuleRecipe(directory), errorCode('CAPSULE_CONTRACT_INVALID', error => {
    assert.equal(error.details.rules, true);
    assert.equal(error.details.releaseGates, false);
  }));
});

test('a malformed contract is a contract error, not a repaired value', async () => {
  const directory = await writeCapsule(path.join(root, 'bad.capsule'), {
    manifestText: manifest().replace('name: demo', 'name: bad'),
    input: 'fields: [unterminated\n'
  });
  await assert.rejects(loadCapsuleRecipe(directory), errorCode('CAPSULE_CONTRACT_INVALID'));
});
