// Cross-repository contract: the script refclone compiles must execute, unchanged,
// against cavalry-mcp's actual _mg prelude and its mock Cavalry API. The checkout is
// optional (refclone must pass standalone), so this suite skips unless a built
// cavalry-mcp is found at CAVALRY_MCP_ROOT or a sibling directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compilePatch } from '../src/dsl/_mg.mjs';
import { defaultFixturePath, runProcedural } from '../src/procedural.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

function locateCavalryMcp(from = project) {
  const candidates = [
    process.env.CAVALRY_MCP_ROOT,
    path.join(from, '..', 'cavalry-mcp'),
    path.join(from, '..', '..', 'cavalry-mcp')
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (
      fs.existsSync(path.join(root, 'dist', 'runtime', 'mg_helpers.js')) &&
      fs.existsSync(path.join(root, 'test', 'mock-cavalry-api.js'))
    ) return root;
  }
  return null;
}

const cavalryRoot = locateCavalryMcp();
const skip = cavalryRoot ? false : 'no built cavalry-mcp checkout found; set CAVALRY_MCP_ROOT to enable the cross-repo contract';

const ACCEPTED_EASINGS = new Set([
  'None', 'SlowIn', 'SlowOut', 'SlowInSlowOut', 'VerySlowIn', 'VerySlowOut',
  'VerySlowInVerySlowOut', 'SpringIn', 'SpringOut', 'SpringInSpringOut',
  'AnticipateIn', 'OvershootOut', 'AnticipateInOvershootOut', 'BounceOut'
]);

test('the compiled Stage 4 script runs against cavalry-mcp’s real _mg prelude', { skip }, async () => {
  const { MG_HELPERS_SOURCE } = await import(pathToFileURL(path.join(cavalryRoot, 'dist', 'runtime', 'mg_helpers.js')).href);
  const { createMockApiState, buildMockApi } = await import(pathToFileURL(path.join(cavalryRoot, 'test', 'mock-cavalry-api.js')).href);

  const result = await runProcedural(defaultFixturePath(), { dryRun: true });
  assert.equal(result.layers, 10);

  // Every helper the compiler emits must be defined by the prelude or by the
  // script's own missing-helper shim; nothing may be undefined at runtime.
  const used = new Set([...result.script.matchAll(/_mg\.([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]));
  assert.ok(used.has('svg') && used.has('stagger'));
  for (const name of used) {
    const inPrelude = new RegExp(`\\n  ${name}\\(`).test(MG_HELPERS_SOURCE);
    const shimmed = new RegExp(`_mg\\.${name}=_mg\\.${name}\\|\\|`).test(result.script);
    assert.ok(inPrelude || shimmed, `_mg.${name} is neither in the prelude nor shimmed by the script`);
  }

  const state = createMockApiState();
  let api = buildMockApi(state);
  // The fixture's svg layer carries an inline d; the editable route is optional
  // in Cavalry, so supply it explicitly as the runtime's guarded branch expects.
  class Path {
    moveTo() {}
    lineTo() {}
    curveTo() {}
    quadTo() {}
    closePath() {}
  }
  api = Object.assign(api, {
    createEditable(pathObject, name) {
      assert.ok(pathObject instanceof Path);
      state.order.push(`createEditable:${name}`);
      return api.create('shape', name);
    }
  });
  const context = vm.createContext({ api, cavalry: { Path }, console });
  const ids = new vm.Script(`(function () {\n${MG_HELPERS_SOURCE}\n${result.script}\n})()`).runInContext(context);

  assert.equal(Array.isArray(ids), true);
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  assert.equal(state.layers.size, 10);
  assert.ok(state.order.includes('createEditable:Vector Mark'));
  for (const easing of state.easings) {
    assert.notEqual(easing.name, 'Custom');
    assert.equal(ACCEPTED_EASINGS.has(easing.name), true, `unexpected easing ${easing.name}`);
  }
  // Boundary keyframes really landed for the promoted moves and the stagger group.
  assert.ok(state.keyframes.length >= 10, `keyframes ${state.keyframes.length}`);

  // Stage 5 parity: a patch script compiled by refclone must edit the live id in
  // place, keep the layer count and never re-declare the composition.
  const target = String(ids[0]);
  const before = Number(api.get(target, 'position.x'));
  const patchScript = compilePatch([{ target, delta: { 'position.x': 40 }, frame: 5 }]);
  assert.equal(patchScript.includes('_mg.comp('), false);
  new vm.Script(`(function () {\n${MG_HELPERS_SOURCE}\n${patchScript}\n})()`).runInContext(context);
  assert.equal(state.layers.size, 10);
  // A framed patch writes a keyframe at the failing frame; the base value is kept.
  assert.equal(Number(api.get(target, 'position.x')), before);
  const keyed = state.keyframes.filter(entry =>
    entry.layerId === target && 'position.x' in entry.attributes && entry.frame === 5);
  assert.equal(keyed.length, 1);
  assert.equal(keyed[0].attributes['position.x'], before + 40);
});
