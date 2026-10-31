// _mg DSL tests: one batched script, runtime shims only for the helpers that are used,
// and a patch-only refinement below the 150-token ceiling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePatch, compilePromotion, compileScene, estimateTokens, MgScript } from '../src/dsl/_mg.mjs';
import { promoteTracks } from '../src/stages/proceduralPromotion.mjs';
import { syntheticScene } from './fixtures/procedural.mjs';

test('the compiler records every additive helper and emits one script', () => {
  const script = new MgScript({ width: 640, height: 360, fps: 30, endFrame: 90, background: '#0B0C10' });
  const measured = script.measure('targetX', 320);
  assert.equal(measured, 320);
  const title = script.text('TITLE', 48, '#FFFFFF', { position: { x: 320, y: 140 } });
  const badge = script.shape('Badge', { attrs: { fill: '#F59E0B' }, pos: { x: 40, y: 40 }, scale: 0.5, rotation: 45, opacity: 80 });
  const mark = script.svg('comp', { d: 'M0,0L10,0L10,10Z', name: 'Mark', pos: { x: 200, y: 80 }, scale: 2 });
  const row = script.splitRow(['ONE', 'TWO'], { pos: { x: 320, y: 300 }, gap: 16, size: 30 });
  const inline = script.inlineRow([{ text: 'A' }, { text: 'B' }], { id: 'inline', pos: { x: 0, y: 0 } });
  script.ease(title, 'position.y', { inFrame: 0, outFrame: 15, from: 240, to: 160, magicEasing: 'ExpoOut' });
  script.ease(badge, 'scale', { inFrame: 10, outFrame: 24, from: 0.5, to: 1, bezier: [0.34, 1.56, 0.64, 1] });
  script.ease(mark, 'position.x', { inFrame: 5, outFrame: 20, from: 320, to: 480, easing: { kind: 'preset', name: 'CubicInOut' } });
  script.stagger([title, badge, mark], { attr: 'position.y', inFrame: 0, outFrame: 15, from: 240, to: 160, delayFrames: 3, easing: { kind: 'preset', name: 'ExpoOut' } });
  script.patch([{ targetRef: mark, attrs: { 'position.x': 481 } }, { target: 'live-layer', delta: { 'position.y': 2 } }]);
  script.cut(30);
  script.bg('#000000');

  const compiled = script.compile();
  assert.equal(compiled.stats.layers, 7);
  assert.equal(compiled.stats.texts, 3);
  assert.equal(compiled.stats.paths, 1);
  assert.equal(compiled.stats.moves, 3);
  assert.equal(compiled.stats.groups, 1);
  assert.equal(compiled.stats.patches, 2);
  assert.equal(compiled.stats.cuts, 1);
  assert.equal(compiled.tokenEstimate, estimateTokens(compiled.script));
  assert.match(compiled.script, /^_mg\.ease=_mg\.ease\|\|/);
  for (const shim of ['svg', 'stagger', 'patch', 'cut', 'splitRow', 'inlineRow']) assert.match(compiled.script, new RegExp(`_mg\\.${shim}=_mg\\.${shim}\\|\\|`));
  assert.equal(compiled.script.includes('_mg.measure='), false);
  assert.equal(compiled.script.includes('_mg.bg='), false);
  assert.match(compiled.script, /var C=_mg\.comp\(640,360,30,90,"#000000"\),L=\{\};/);
  assert.match(compiled.script, /_mg\.text\("TITLE",48,"#FFFFFF"/);
  assert.match(compiled.script, /_mg\.layer\("basicShape","Badge"/);
  assert.match(compiled.script, /_mg\.svg\(C,\{/);
  assert.match(compiled.script, /_mg\.splitRow\(\["ONE","TWO"\]/);
  assert.match(compiled.script, /_mg\.inlineRow\(\[\{"text":"A"\}/);
  assert.match(compiled.script, /_mg\.ease\(L0,"position\.y",\{"inFrame":0,"outFrame":15,"from":240,"to":160,"magicEasing":"ExpoOut"\}/);
  assert.match(compiled.script, /"bezier":\[0\.34,1\.56,0\.64,1\]/);
  assert.match(compiled.script, /_mg\.stagger\(\[L0,L1,L2\]/);
  assert.match(compiled.script, /_mg\.patch\(\[\{"target":L2,"attrs":\{"position\.x":481\}\}/);
  assert.match(compiled.script, /"target":"live-layer","delta"/);
  assert.match(compiled.script, /_mg\.cut\(30\)/);
  assert.equal(compiled.script.includes('[[0,'), false);
  assert.equal(script.measurements.targetX, 320);
});

test('runtime shims are optional and compile({runtime:false}) emits only the scene', () => {
  const script = new MgScript({ width: 10, height: 10, fps: 10, endFrame: 10 });
  script.text('X');
  script.ease('L0', 'opacity', { inFrame: 0, outFrame: 10, from: 0, to: 100, magicEasing: 'ExpoOut' });
  const compiled = script.compile({ runtime: false });
  assert.equal(compiled.script.includes('_mg.ease=_mg.ease'), false);
  assert.ok(compiled.script.startsWith('var C=_mg.comp('));
  assert.throws(() => script.ease('L0', 'opacity', { inFrame: 1, outFrame: 1, from: 0, to: 1 }), /distinct/);
  assert.throws(() => script.stagger(['L0'], { attr: 'opacity', inFrame: 0, outFrame: 1, from: 0, to: 1, delayFrames: 1 }), /at least two/);
  assert.throws(() => script.svg('comp', {}), /path or d/);
});

test('a patch-only script stays below 150 tokens and replaces raw layer references', () => {
  const script = compilePatch([
    { targetRef: 'L7', attrs: { 'position.x': 481.25, 'position.y': 80 } },
    { target: 'live-id', delta: { 'position.x': 2 } }
  ]);
  assert.ok(estimateTokens(script) < 150, `patch tokens ${estimateTokens(script)}`);
  assert.match(script, /_mg\.patch\(\[\{"target":L7,"attrs":\{"position\.x":481\.25/);
  assert.match(script, /"target":"live-id","delta"/);
  assert.equal(script.includes('@@REF'), false);
  assert.equal(script.includes('[[0,'), false);
});

test('compileScene wires moves, groups and patches by layer id', () => {
  const compiled = compileScene({
    width: 64, height: 36, fps: 24, endFrame: 30,
    layers: [
      { kind: 'shape', name: 'A', id: 'a', pos: { x: 1, y: 2 } },
      { kind: 'text', text: 'B', id: 'b', pos: { x: 3, y: 4 } }
    ],
    moves: [{ layerId: 'a', attr: 'position.x', inFrame: 0, outFrame: 10, from: 1, to: 5, easing: { kind: 'preset', name: 'ExpoOut' } }],
    groups: [{ refs: ['L0', 'L1'], attr: 'position.y', inFrame: 0, outFrame: 10, from: 2, to: 20, delayFrames: 2, magicEasing: 'ExpoOut' }],
    patches: [{ targetRef: 'L1', delta: { 'position.y': 1 } }],
    cuts: [5]
  });
  assert.match(compiled.script, /_mg\.ease\(L0,"position\.x"/);
  assert.match(compiled.script, /_mg\.stagger\(\[L0,L1\]/);
  assert.match(compiled.script, /_mg\.patch\(\{"target":L1/);
  assert.match(compiled.script, /_mg\.cut\(5\)/);
});

test('compilePromotion emits ten layers, one group and no frame-baked arrays', async () => {
  const scene = syntheticScene();
  const promotion = promoteTracks(scene, { beats: scene.beats, maxError: 2 });
  const compiled = compilePromotion(promotion, {
    width: scene.width, height: scene.height, fps: scene.fps,
    endFrame: scene.endFrame, background: scene.background
  });
  assert.equal(compiled.layers, 10);
  assert.equal(compiled.groups, 1);
  assert.ok(compiled.tokenEstimate < 800, `tokens ${compiled.tokenEstimate}`);
  assert.equal((compiled.script.match(/\[\[\s*-?\d/g) ?? []).length, 0);
  assert.match(compiled.script, /_mg\.stagger\(\[L0,L1,L2,L3,L4\]/);
  assert.equal(compiled.stats.moves, 6);
  assert.ok(Object.keys(compiled.layerRefs).length === 10);
  assert.equal(compiled.limitations.length, 1);
  assert.match(compiled.limitations[0], /Custom cubic-bezier/);

  const compiledBytes = Buffer.byteLength(compiled.script);
  assert.equal(compiled.bytes, compiledBytes);
});
