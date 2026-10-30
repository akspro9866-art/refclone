import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLANNER_VERSION, parseFps, buildScenePlan, validateScenePlan, buildDryRun,
  registerScenePlan, operationToAdapter, toAdapterOperations, previewAdapterBatch
} from '../src/planner.mjs';
import { buildDesignTokens } from '../src/design.mjs';
import { hashObject, readJson, validateArtifact } from '../src/core.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'planner-'));

const evidence = (frames = [0]) => ({
  status: 'measured', method: 'synthetic planner fixture', frames, confidence: 0.9,
  notes: 'Defined by this test; these are not observations of the user reference.'
});
const font = () => ({ family: null, style: null, sizePx: null });
const box = (x, y, width, height) => ({ x, y, width, height });
const state = (frame, bbox) => ({ frame, bbox, opacity: 1 });

function element({ id, type, role, copy = null, bbox, color = null, assetId = null, states = [], unresolved = [] }) {
  return {
    id, type, role, copy, bbox, color, font: font(), assetId,
    evidence: states.length ? evidence(states.map(item => item.frame)) : evidence([0]),
    states, unresolved
  };
}

function event(id, elementId, type, frames, property, from, to) {
  return { id, elementId, type, frames, property, from, to, evidence: evidence(frames) };
}

function requirement(id, type, elementId = null, status = 'missing') {
  return { id, type, status, elementId, notes: `Synthetic open requirement ${id}.` };
}

function fixtureSpec() {
  return {
    schemaVersion: 1, sourceHash: 'd'.repeat(64),
    resolution: { width: 200, height: 100 }, fps: { num: 24, den: 1 }, totalFrames: 24,
    review: { status: 'confirmed', notes: 'Synthetic planner fixture review.' },
    shots: [{
      id: 'shot-1', startFrame: 0, endFrameExclusive: 24,
      startSeconds: 0, endSeconds: 1, durationSeconds: 1,
      elements: [
        element({ id: 's1-bg', type: 'rect', role: 'background', bbox: box(0, 0, 1, 1), color: '#123456' }),
        element({
          id: 's1-you', type: 'text', role: 'headline word', copy: 'You',
          bbox: box(0.1, 0.2, 0.1, 0.2), color: '#ffffff',
          states: [state(2, box(0.1, 0.2, 0.1, 0.2)), state(20, box(0.08, 0.2, 0.1, 0.2))]
        }),
        element({
          id: 's1-build', type: 'text', role: 'headline word', copy: 'build',
          bbox: box(0.3, 0.2, 0.1, 0.2), color: '#ffffff',
          states: [state(5, box(0.3, 0.2, 0.1, 0.2)), state(20, box(0.28, 0.2, 0.1, 0.2))]
        }),
        element({
          id: 's1-wall', type: 'text', role: 'word wall (repeated vocabulary)', copy: null,
          bbox: box(0, 0, 1, 1), color: '#11254f', states: [],
          unresolved: ['Wall copy and layout are unresolved.']
        }),
        element({
          id: 's1-fast', type: 'text', role: 'highlighted quality', copy: 'fast',
          bbox: box(0.5, 0.2, 0.2, 0.2), color: '#ffffff',
          states: [state(1, box(0.5, 0.2, 0.2, 0.2)), state(11, box(0.48, 0.2, 0.2, 0.2))]
        }),
        element({
          id: 's1-trust', type: 'text', role: 'highlighted final word', copy: 'trust.',
          bbox: box(0.75, 0.2, 0.15, 0.2), color: '#0000ff',
          states: [state(0, box(0.75, 0.2, 0.15, 0.2)), state(10, box(0.73, 0.2, 0.15, 0.2))]
        }),
        element({
          id: 's1-logo', type: 'image', role: 'logo mark', copy: null,
          bbox: box(0.8, 0.7, 0.15, 0.1), assetId: 'brand-remax-logo',
          states: [state(1, box(0.8, 0.7, 0.1, 0.1)), state(23, box(0.8, 0.7, 0.15, 0.1))],
          unresolved: ['The original logo vector is unavailable.']
        })
      ],
      events: [
        event('s1-appear-you', 's1-you', 'appearance', [2], 'visibility', false, true),
        event('s1-appear-build', 's1-build', 'appearance', [5], 'visibility', false, true),
        event('s1-drift-you', 's1-you', 'drift', [10, 20], 'x', 240, 220),
        event('s1-drift-build', 's1-build', 'drift', [10, 20], 'x', 340, 320),
        event('s1-settle-you', 's1-you', 'settle', [2, 10], 'x', 240, 204),
        event('s1-settle-build', 's1-build', 'settle', [5, 13], 'x', 340, 304),
        event('s1-pan-fast', 's1-fast', 'pan-left', [1, 11], 'x', 300, 284),
        event('s1-wall-layout', 's1-wall', 'layout-change', [6, 12, 18], 'word-arrangement', null, null),
        event('s1-logo-reveal', 's1-logo', 'scale-x-reveal', [1, 16], 'scaleX', 0.6, 1)
      ],
      transition: { type: 'none', durationFrames: 0, evidence: evidence([0]) },
      requiredAssets: [
        requirement('font-sans-headline', 'font'),
        requirement('font-sans-wall', 'font', 's1-wall'),
        requirement('wall-copy', 'copy', 's1-wall'),
        requirement('font-serif-highlight', 'font'),
        requirement('font-serif-trust', 'font', 's1-trust'),
        requirement('brand-remax-logo', 'image', 's1-logo')
      ],
      unresolved: ['Wall copy and per-beat layouts are not transcribed.']
    }],
    transformations: []
  };
}

function fixtureManifest(spec) {
  const asset = (id, type) => ({
    id, type, path: null, sha256: null, width: null, height: null,
    fontFamily: null, fontStyle: null,
    provenance: `Synthetic open requirement ${id}.`, licenseStatus: 'unresolved',
    origin: 'missing', intendedUse: `Fixture use for ${id}`, dependencies: [], status: 'missing'
  });
  const assets = [
    asset('font-sans-headline', 'font'),
    asset('font-sans-wall', 'font'),
    asset('wall-copy', 'copy'),
    asset('font-serif-highlight', 'font'),
    asset('font-serif-trust', 'font'),
    asset('brand-remax-logo', 'image')
  ];
  return {
    schemaVersion: 1, sourceHash: spec.sourceHash, assets,
    missing: assets.map(item => item.id),
    review: { status: 'pending', notes: 'Synthetic pending manifest review.' }
  };
}

async function fixtureInputs() {
  const spec = fixtureSpec();
  const assetManifest = fixtureManifest(spec);
  await validateArtifact('shot-spec', spec);
  await validateArtifact('asset-manifest', assetManifest);
  const tokens = buildDesignTokens(spec, { assetManifest });
  await validateArtifact('design-tokens', tokens);
  return { spec, assetManifest, tokens };
}

const errorsOf = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code);

test('planner: identity plan preserves measured geometry, timing and open requirements', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();
  const plan = await buildScenePlan({ spec, assetManifest, tokens });

  assert.equal(plan.planner.version, PLANNER_VERSION);
  assert.equal(plan.planner.determinism, 'stable_order_and_ids');
  assert.equal(plan.timing.mapping, 'identity');
  assert.equal(plan.timing.maxSourceFrameMappingErrorFrames, 0);
  assert.equal(plan.timing.maxSourceFrameMappingErrorSeconds, 0);
  assert.deepEqual(plan.project.fps, { num: 24, den: 1 });
  assert.equal(plan.project.totalFrames, 24);
  assert.deepEqual(plan.project.frameRange, { startFrame: 0, endFrame: 23 });

  const shot = plan.shots[0];
  assert.equal(shot.startFrame, 0);
  assert.equal(shot.endFrameExclusive, 24);
  assert.equal(shot.startSeconds, 0);
  assert.equal(shot.endSeconds, 1);
  assert.equal(shot.durationSeconds, 1);
  assert.equal(shot.status, 'blocked');
  assert.equal(shot.transition.type, 'none');
  assert.equal(shot.transition.supportStatus, 'ready');
  assert.deepEqual(shot.requiredAssetIds, [
    'font-sans-headline', 'font-sans-wall', 'wall-copy',
    'font-serif-highlight', 'font-serif-trust', 'brand-remax-logo'
  ]);

  const background = plan.elements.find(item => item.id === 's1-bg');
  assert.equal(background.status, 'ready');
  assert.equal(background.parameters.color, '#123456');
  assert.equal(background.parameters.widthPx, 200);
  assert.equal(background.parameters.heightPx, 100);
  assert.deepEqual(plan.operations.map(operation => operation.id),
    ['op-s1-bg-create', 'op-s1-bg-set', 'op-s1-bg-timing']);
  assert.ok(plan.operations.every(operation => operation.elementId === 's1-bg'));

  const create = plan.operations.find(operation => operation.action === 'createPrimitive');
  assert.deepEqual(create.params, { type: 'rectangle', name: 's1-bg', as: 's1-bg' });
  assert.equal(create.runtimeVerified, true);
  const set = plan.operations.find(operation => operation.action === 'set');
  assert.deepEqual(set.params.attributes.position, [0, 0]);
  assert.deepEqual(set.params.attributes['generator.dimensions'], [200, 100]);
  assert.deepEqual(set.params.attributes['material.materialColor'], { r: 18, g: 52, b: 86, a: 255 });
  const timing = plan.operations.find(operation => operation.action === 'timing');
  assert.deepEqual(timing.params, { inFrame: 0, outFrame: 23 });
  assert.equal(timing.supportStatus, 'runtime_verified');
  assert.equal(timing.runtimeVerified, true);

  // Text and image creation are runtime-verified, but open fonts and assets
  // still prevent executable create operations from being emitted.
  assert.ok(!plan.operations.some(operation => ['keyframe', 'ensurePrimitive'].includes(operation.action)));
  assert.ok(!plan.operations.some(operation => ['createText', 'importAsset'].includes(operation.action)));
  assert.ok(plan.unresolved.some(note => note.includes('font-sans-headline')));
  assert.equal(plan.elements.find(item => item.id === 's1-you').status, 'blocked');
  assert.ok(plan.elements.find(item => item.id === 's1-you').blockers.some(note => note.includes('fontFamily')));

  const youKeys = plan.keyframes.filter(keyframe => keyframe.elementId === 's1-you');
  assert.deepEqual(youKeys.map(keyframe => keyframe.targetFrame), [2, 20]);
  assert.deepEqual(youKeys.map(keyframe => keyframe.value), [-370, -374]);
  assert.deepEqual(youKeys.map(keyframe => keyframe.sourceValue), [30, 26]);
  assert.ok(youKeys.every(keyframe => keyframe.attributePath === 'position.x' &&
    keyframe.easing === null && keyframe.supportStatus === 'blocked'));
  const logoKeys = plan.keyframes.filter(keyframe => keyframe.elementId === 's1-logo');
  assert.deepEqual(logoKeys.map(keyframe => `${keyframe.attributePath}@${keyframe.targetFrame}`),
    ['position.x@1', 'position.x@23', 'scale.x@1', 'scale.x@23']);
  assert.deepEqual(logoKeys.filter(keyframe => keyframe.attributePath === 'position.x').map(keyframe => keyframe.value), [70, 75]);
  assert.deepEqual(logoKeys.filter(keyframe => keyframe.attributePath === 'scale.x').map(keyframe => keyframe.value), [0.67, 1]);
  assert.ok(logoKeys.every(keyframe => keyframe.easing === null && keyframe.supportStatus === 'blocked'));

  assert.equal(plan.validation.valid, true, JSON.stringify(errorsOf(plan.validation)));
  assert.equal(plan.validation.status, 'blocked');
  assert.equal(plan.validation.executable, false);
  assert.equal(plan.validation.counts.errors, 0);
  assert.equal(plan.validation.counts.operations, 3);
  assert.equal(plan.validation.counts.animationOperations, 0);
  assert.equal(plan.validation.counts.blockedElements, 6);
  assert.equal(plan.validation.counts.assets, 6);
  assert.equal(plan.validation.counts.events, 9);
  assert.equal(plan.validation.counts.keyframes, 12);
  for (const code of ['PRESET_BLOCKED', 'EASING_UNRESOLVED', 'EXECUTION_GATED']) {
    assert.ok(plan.validation.diagnostics.some(diagnostic => diagnostic.code === code), `missing ${code}`);
  }
  assert.ok(plan.assets.every(asset => asset.status === 'missing'));
});

test('planner: rational retiming uses integer half-up mapping and stays deterministic', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();
  const plan = await buildScenePlan({ spec, assetManifest, tokens, targetFps: { num: 25, den: 1 } });

  assert.deepEqual(plan.project.fps, { num: 25, den: 1 });
  assert.equal(plan.project.totalFrames, 25);
  assert.deepEqual(plan.project.frameRange, { startFrame: 0, endFrame: 24 });
  assert.equal(plan.shots[0].endFrameExclusive, 25);
  assert.equal(plan.shots[0].endSeconds, 1);
  assert.equal(plan.timing.mapping, 'rational_nearest_half_up');
  assert.ok(Math.abs(plan.timing.maxSourceFrameMappingErrorFrames - 0.48) < 1e-9);
  assert.ok(Math.abs(plan.timing.maxSourceFrameMappingErrorSeconds - 0.02) < 1e-12);

  const youKeys = plan.keyframes.filter(keyframe => keyframe.elementId === 's1-you');
  assert.deepEqual(youKeys.map(keyframe => keyframe.targetFrame), [2, 21]);
  const layout = plan.events.find(item => item.type === 'layout-change');
  assert.deepEqual(layout.sourceFrames, [6, 12, 18]);
  assert.deepEqual(layout.targetFrames, [6, 13, 19]);
  assert.equal(plan.validation.valid, true, JSON.stringify(errorsOf(plan.validation)));
  assert.equal(plan.validation.status, 'blocked');

  const again = await buildScenePlan({ spec, assetManifest, tokens, targetFps: { num: 25, den: 1 } });
  assert.equal(hashObject(again), hashObject(plan), 'Same inputs must produce the same logical plan.');

  assert.deepEqual(parseFps('24000/1001'), { num: 24000, den: 1001 });
  assert.deepEqual(parseFps('25'), { num: 25, den: 1 });
  assert.throws(() => parseFps('23.976'), { code: 'FPS_INVALID' });
  assert.throws(() => parseFps('1/0'), { code: 'FPS_INVALID' });
  await assert.rejects(
    buildScenePlan({ spec, assetManifest, tokens, targetFps: { num: 0, den: 1 } }),
    { code: 'FPS_INVALID' }
  );
});

test('planner: collapsing a rational rate is rejected as a frame collision', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();
  const plan = await buildScenePlan({ spec, assetManifest, tokens, targetFps: { num: 12, den: 1 } });
  assert.equal(plan.validation.valid, false);
  assert.equal(plan.validation.status, 'invalid');
  assert.ok(plan.validation.diagnostics.some(diagnostic => diagnostic.code === 'FRAME_MAPPING_COLLISION'));
  assert.throws(() => toAdapterOperations(plan), { code: 'PLAN_NOT_EXECUTABLE' });
});

test('planner: malformed timing, geometry, conflicts and stale records are diagnosed', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();
  const base = await buildScenePlan({ spec, assetManifest, tokens });

  const cases = [
    ['short shot range', plan => { plan.shots[0].endFrameExclusive = 23; }, 'SHOT_SEQUENCE'],
    ['wrong seconds', plan => { plan.shots[0].endSeconds = 0.5; }, 'TIMING_SECONDS'],
    ['wrong keyframe frame', plan => {
      plan.keyframes.find(keyframe => keyframe.elementId === 's1-you').targetFrame = 7;
    }, 'FRAME_MAPPING'],
    ['background does not cover frame', plan => {
      plan.elements.find(item => item.componentType === 'rect').parameters.widthPx = 199;
    }, 'BACKGROUND_DIMENSIONS'],
    ['element status stale', plan => {
      plan.elements.find(item => item.id === 's1-build').status = 'ready';
    }, 'ELEMENT_STATUS_STALE'],
    ['shot status stale', plan => { plan.shots[0].status = 'ready'; }, 'SHOT_STATUS_STALE'],
    ['operation status stale', plan => { plan.operations[0].runtimeVerified = false; }, 'OPERATION_STATUS_STALE'],
    ['missing operation dependency', plan => {
      plan.operations.find(operation => operation.action === 'set').dependsOn = [];
    }, 'DEPENDENCY_MISMATCH'],
    ['undocumented easing', plan => { plan.events[0].easing = 'EaseOut'; }, 'EVENT_EASING_UNKNOWN'],
    ['duplicate keyframe time', plan => {
      const duplicate = structuredClone(plan.keyframes[0]);
      duplicate.id = 'kf-duplicate';
      plan.keyframes.push(duplicate);
      plan.shots[0].keyframeIds.push(duplicate.id);
    }, 'KEYFRAME_DUPLICATE'],
    ['available asset without file', plan => { plan.assets[1].status = 'available'; }, 'ASSET_STATUS_STALE'],
    ['missing checkpoint guard', plan => { plan.execution.requiresCheckpoint = false; }, 'EXECUTION_SAFETY'],
    ['composition mismatch', plan => { plan.execution.globalPreconditions[0].width = 201; }, 'EXECUTION_PRECONDITION'],
    ['unknown dependency target', plan => {
      plan.dependencies.push({
        id: 'dep-unknown', type: 'asset', from: 's1-you', to: 'missing-asset', notes: 'Fixture.'
      });
    }, 'REFERENCE_MISSING'],
    ['copy altered', plan => {
      plan.elements.find(item => item.id === 's1-you').parameters.copy = 'Changed';
    }, 'COPY_MISMATCH'],
    ['placement altered', plan => {
      plan.elements.find(item => item.id === 's1-you').parameters.x = 999;
    }, 'PARAMETER_MISMATCH'],
    ['unknown component', plan => {
      plan.elements.find(item => item.id === 's1-you').componentId = 'button';
    }, 'COMPONENT_MISSING'],
    ['event frame count mismatch', plan => {
      plan.events[0].sourceFrames = [2];
      plan.events[0].targetFrames = [2, 3];
    }, 'EVENT_FRAME_COUNT'],
    ['duplicate create', plan => {
      const duplicate = structuredClone(plan.operations[0]);
      duplicate.id = 'op-extra-create';
      plan.operations.push(duplicate);
      plan.shots[0].operationIds.push(duplicate.id);
    }, 'OPERATION_CONFLICT'],
    ['timing does not span shot', plan => {
      plan.operations.find(operation => operation.action === 'timing').params.outFrame = 22;
    }, 'OPERATION_PARAMETER'],
    ['transition overlap', plan => { plan.shots[0].transitionOverlapFrames = 2; }, 'TRANSITION_OVERLAP']
  ];

  for (const [label, mutate, code] of cases) {
    const plan = structuredClone(base);
    mutate(plan);
    const before = structuredClone(plan);
    const result = await validateScenePlan(plan, { spec, assetManifest, tokens });
    assert.equal(result.valid, false, `${label}: expected invalid`);
    assert.equal(result.status, 'invalid', label);
    assert.equal(result.executable, false, label);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.severity === 'error'),
      `${label}: expected ${code}; got ${errorsOf(result).join(', ')}`);
    assert.deepEqual(plan, before, `${label}: validation must not rewrite the plan`);
  }

  const clean = await validateScenePlan(structuredClone(base), {
    spec, assetManifest, tokens, checkRecorded: true
  });
  assert.equal(clean.valid, true, JSON.stringify(errorsOf(clean)));
  assert.ok(!clean.diagnostics.some(diagnostic => diagnostic.code === 'VALIDATION_STALE'));

  const tampered = structuredClone(base);
  tampered.validation.executable = true;
  const stale = await validateScenePlan(tampered, {
    spec, assetManifest, tokens, checkRecorded: true
  });
  assert.ok(stale.diagnostics.some(diagnostic => diagnostic.code === 'VALIDATION_STALE'));
  assert.equal(stale.executable, false);
});

test('planner: measured off-frame geometry is preserved and reported, never clipped', async () => {
  const { spec, assetManifest } = await fixtureInputs();
  const cropped = structuredClone(spec);
  cropped.shots[0].elements.find(item => item.id === 's1-you').states[0].bbox.x = -0.2;
  const tokens = buildDesignTokens(cropped, { assetManifest });
  const plan = await buildScenePlan({ spec: cropped, assetManifest, tokens });

  assert.equal(plan.validation.valid, true, JSON.stringify(errorsOf(plan.validation)));
  const element = plan.elements.find(item => item.id === 's1-you');
  assert.equal(element.parameters.x, -130);
  assert.equal(element.parameters.y, 20);
  assert.equal(element.bbox, undefined);
  assert.ok(plan.validation.diagnostics.some(diagnostic =>
    diagnostic.code === 'ELEMENT_CROPPED_AS_MEASURED' &&
    diagnostic.severity === 'info' && diagnostic.elementId === 's1-you'));
});

test('planner: component parameters stay declarative and exact copy is preserved', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();
  const plan = await buildScenePlan({ spec, assetManifest, tokens });

  const you = plan.elements.find(item => item.id === 's1-you');
  assert.equal(you.parameters.copy, 'You');
  assert.equal(you.parameters.fontFamily, null);
  assert.equal(you.parameters.x, -70);
  assert.ok(!JSON.stringify(plan.operations).includes('You'), 'Operations must not embed source copy.');

  const stacking = plan.relationships.find(item => item.type === 'stacking-order');
  assert.deepEqual(stacking.elementIds,
    ['s1-bg', 's1-you', 's1-build', 's1-wall', 's1-fast', 's1-trust', 's1-logo']);
  const line = plan.relationships.find(item => item.type === 'line-order');
  assert.deepEqual(line.elementIds, ['s1-you', 's1-build', 's1-fast', 's1-trust']);
});

test('planner: dry run and adapter compilation stay gated and deterministic', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();
  const plan = await buildScenePlan({ spec, assetManifest, tokens });

  assert.throws(() => toAdapterOperations(plan), { code: 'PLAN_NOT_EXECUTABLE' });
  const preview = previewAdapterBatch(plan);
  assert.equal(preview.compiled, true);
  assert.equal(preview.operationCount, 3);
  assert.equal(preview.preconditions.length, 1);
  assert.match(preview.codeSha256, /^[0-9a-f]{64}$/);
  assert.ok(preview.codeBytes > 0);

  const adapterOperations = plan.operations.map(operationToAdapter);
  assert.deepEqual(adapterOperations.map(operation => operation.action),
    ['createPrimitive', 'set', 'timing']);
  assert.equal(adapterOperations[1].elementId, '$s1-bg');
  assert.deepEqual(adapterOperations[2],
    { id: 'op-s1-bg-timing', action: 'timing', elementId: '$s1-bg', inFrame: 0, outFrame: 23 });
  const fake = structuredClone(plan);
  fake.validation.executable = true;
  assert.equal(toAdapterOperations(fake).length, 3);

  const first = buildDryRun(plan);
  const second = buildDryRun(plan);
  assert.equal(first.json.planHash, second.json.planHash);
  assert.equal(first.markdown, second.markdown);
  assert.equal(first.json.executable, false);
  assert.equal(first.json.status, 'blocked');
  assert.equal(first.json.compilation.operationCount, 3);
  assert.match(first.markdown, /No Cavalry scene was opened/);
  assert.match(first.markdown, /Status: \*\*blocked\*\*/);
});

test('planner: reviews, source identity and design validity gate planning', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();

  await assert.rejects(
    buildScenePlan({ spec: { ...spec, review: { status: 'pending', notes: 'Fixture.' } }, assetManifest, tokens }),
    { code: 'SPEC_REVIEW_PENDING' }
  );
  await assert.rejects(
    buildScenePlan({ spec, assetManifest: { ...assetManifest, sourceHash: 'e'.repeat(64) }, tokens }),
    { code: 'SOURCE_MISMATCH' }
  );
  await assert.rejects(
    buildScenePlan({ spec, assetManifest, tokens: { ...tokens, sourceHash: 'e'.repeat(64) } }),
    { code: 'SOURCE_MISMATCH' }
  );
  await assert.rejects(buildScenePlan({ spec }), { code: 'PLAN_INPUT_REQUIRED' });

  const badTokens = structuredClone(tokens);
  badTokens.tokens['color.background.canvas'] = { value: '#000000', evidence: evidence([0]) };
  await assert.rejects(
    buildScenePlan({ spec, assetManifest, tokens: badTokens }),
    { code: 'DESIGN_INVALID' }
  );
});

test('planner: discovery candidates attached as dependencies stay out of the plan', async () => {
  const { spec, tokens } = await fixtureInputs();
  const assetManifest = fixtureManifest(spec);
  assetManifest.assets[0].dependencies = ['font-candidate-lato-bold'];
  assetManifest.assets.push({
    id: 'font-candidate-lato-bold', type: 'font', path: 'C:/fixture/Lato-Bold.ttf', sha256: 'c'.repeat(64),
    width: null, height: null, fontFamily: 'Lato', fontStyle: 'Bold',
    provenance: 'Installed candidate hypothesis; the exact reference face is unverified.',
    licenseStatus: 'unresolved', origin: 'installed', intendedUse: 'Candidate for font-sans-headline',
    dependencies: [], status: 'unresolved'
  });
  await validateArtifact('asset-manifest', assetManifest);

  const plan = await buildScenePlan({ spec, assetManifest, tokens });
  assert.ok(!plan.assets.some(asset => asset.id === 'font-candidate-lato-bold'),
    'A candidate is a dependency hypothesis, not a plan requirement.');
  assert.equal(plan.assets.length, 6);

  const candidateTokens = buildDesignTokens(spec, { assetManifest });
  const validation = await validateScenePlan(plan, { spec, assetManifest, tokens: candidateTokens });
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics.filter(d => d.severity === 'error')));
  assert.ok(!validation.diagnostics.some(diagnostic =>
    diagnostic.code === 'REQUIREMENT_MISSING' && diagnostic.requirementId === 'font-candidate-lato-bold'));

  // An open manifest asset that is not a candidate still has to be recorded.
  const unrecorded = structuredClone(plan);
  unrecorded.assets = unrecorded.assets.filter(asset => asset.id !== 'font-sans-wall');
  const strict = await validateScenePlan(unrecorded, { spec, assetManifest, tokens: candidateTokens });
  assert.ok(strict.diagnostics.some(diagnostic =>
    diagnostic.code === 'REQUIREMENT_MISSING' && diagnostic.requirementId === 'font-sans-wall'));
});

test('planner: registration is versioned, cache-resumable and refuses invalid plans', async () => {
  const { spec, assetManifest, tokens } = await fixtureInputs();
  const runDirectory = path.join(root, 'job', 'analysis', 'content-key', 'run-key');
  const specPath = path.join(runDirectory, 'shot-spec.json');
  const manifestPath = path.join(runDirectory, 'asset-manifest.json');
  const tokensPath = path.join(runDirectory, 'design-tokens.json');
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
  await fs.writeFile(manifestPath, JSON.stringify(assetManifest, null, 2));
  await fs.writeFile(tokensPath, JSON.stringify(tokens, null, 2));

  const first = await registerScenePlan(specPath, { assetManifestPath: manifestPath, tokensPath });
  assert.equal(first.cached, false);
  assert.equal(first.version, PLANNER_VERSION);
  assert.equal(first.valid, true);
  assert.equal(first.status, 'blocked');
  assert.equal(first.executable, false);
  const written = await readJson(first.planPath);
  assert.deepEqual(written.validation, first.validation);
  await fs.access(first.dryRunMarkdownPath);

  const second = await registerScenePlan(specPath, { assetManifestPath: manifestPath, tokensPath });
  assert.equal(second.cached, true);
  assert.equal(second.planPath, first.planPath);

  const retimed = await registerScenePlan(specPath, {
    assetManifestPath: manifestPath, tokensPath, targetFps: { num: 25, den: 1 }
  });
  assert.equal(retimed.cached, false);
  assert.notEqual(retimed.planPath, first.planPath);
  assert.equal((await readJson(retimed.planPath)).project.totalFrames, 25);

  const invalidSpec = structuredClone(spec);
  invalidSpec.shots[0].transition = { type: 'wipe', durationFrames: 1, evidence: evidence([0, 1]) };
  const invalidRun = path.join(root, 'bad-job', 'analysis', 'content-key', 'run-key');
  const invalidSpecPath = path.join(invalidRun, 'shot-spec.json');
  await fs.mkdir(invalidRun, { recursive: true });
  await fs.writeFile(invalidSpecPath, JSON.stringify(invalidSpec, null, 2));
  await assert.rejects(
    registerScenePlan(invalidSpecPath, { assetManifestPath: manifestPath, tokensPath }),
    error => error.code === 'PLAN_INVALID'
  );
  await assert.rejects(fs.access(path.join(root, 'bad-job', 'plan')), { code: 'ENOENT' });
});
