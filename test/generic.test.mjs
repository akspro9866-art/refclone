import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveCatalog, loadCatalog, componentFor, presetFor, eventKind, validateCatalogShape } from '../src/catalog.mjs';
import { buildGenericDesignTokens, validateGenericDesign, presetOperations } from '../src/generic-design.mjs';
import { buildGenericScenePlan, registerGenericDesign, registerGenericScenePlan } from '../src/generic-planner.mjs';
import { adapterCapabilityContract } from '../src/cavalry.mjs';
import { toAdapterOperations, previewAdapterBatch } from '../src/planner.mjs';
import { absolutePath, hashObject, readJson, validateArtifact } from '../src/core.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'generic-'));

// Every fixture below is synthetic: it is defined by this file, is not an
// observation of the user reference, and must not be read as one.
const SOURCE = 'a'.repeat(64);
const evidence = (frames = [0], notes = 'Defined by this test; not an observation of the user reference.') => ({
  status: 'measured', method: 'synthetic generic fixture', frames, confidence: 0.9, notes
});
const box = (x, y, width, height) => ({ x, y, width, height });
const state = (frame, bbox) => ({ frame, bbox, opacity: 1 });
const RESOLVED_FONT = { family: 'FixtureSans', style: 'Regular', sizePx: 24 };
const NO_FONT = { family: null, style: null, sizePx: null };

function denseStates(start, end, base) {
  const states = [];
  for (let frame = start; frame <= end; frame += 1) {
    const progress = (frame - start) / Math.max(1, end - start);
    states.push(state(frame, { ...base, x: base.x - 0.02 * progress }));
  }
  return states;
}

function element({ id, type, role, copy = null, bbox, color = null, assetId = null, states = [], font = NO_FONT, unresolved = [] }) {
  return {
    id, type, role, copy, bbox, color, font, assetId,
    evidence: evidence(states.length ? states.map(item => item.frame) : [bbox ? 0 : 0]),
    states: states.length ? states : [state(0, bbox)], unresolved
  };
}

const event = (id, elementId, type, frames, property, from, to) => ({
  id, elementId, type, frames, property, from, to, evidence: evidence(frames)
});

const requirement = (id, type, status = 'available', elementId = null) => ({
  id, type, status, elementId, notes: `Synthetic ${id} requirement (${status}).`
});

function shot({ id, startFrame, endFrameExclusive, elements, events = [], requiredAssets = [], transition }) {
  return {
    id, startFrame, endFrameExclusive,
    startSeconds: startFrame / 24, endSeconds: endFrameExclusive / 24,
    durationSeconds: (endFrameExclusive - startFrame) / 24,
    elements, events, requiredAssets,
    transition: transition ?? { type: 'none', durationFrames: 0, evidence: evidence([startFrame], 'Program start.') },
    unresolved: []
  };
}

/**
 * Two-shot fixture: a dense left-drift on one text element in shot 1 and an
 * optional static image in shot 2, joined by a measured hard cut.
 */
function fixtureSpec({ dense = true, font = RESOLVED_FONT, withImage = false, imageStatus = 'available' } = {}) {
  const states = dense ? denseStates(2, 10, box(0.1, 0.2, 0.1, 0.1)) : [state(2, box(0.1, 0.2, 0.1, 0.1)), state(10, box(0.08, 0.2, 0.1, 0.1))];
  const imageStates = [state(12, box(0.7, 0.6, 0.2, 0.2)), state(23, box(0.7, 0.6, 0.2, 0.2))];
  return {
    schemaVersion: 1, sourceHash: SOURCE,
    resolution: { width: 200, height: 100 }, fps: { num: 24, den: 1 }, totalFrames: 24,
    review: { status: 'confirmed', notes: 'Synthetic generic fixture review.' },
    transformations: [],
    shots: [
      shot({
        id: 'shot-1', startFrame: 0, endFrameExclusive: 12,
        elements: [
          element({ id: 's1-bg', type: 'rect', role: 'background', bbox: box(0, 0, 1, 1), color: '#101030' }),
          element({ id: 's1-title', type: 'text', role: 'title', copy: 'Alpha', bbox: box(0.1, 0.2, 0.1, 0.1), color: '#ffffff', font, states })
        ],
        events: [event('s1-title-drift', 's1-title', 'left-drift', states.map(item => item.frame), 'position.x', 20, 16)]
      }),
      shot({
        id: 'shot-2', startFrame: 12, endFrameExclusive: 24,
        elements: [
          element({ id: 's2-bg', type: 'rect', role: 'background', bbox: box(0, 0, 1, 1), color: '#101030' }),
          ...(withImage ? [element({ id: 's2-mark', type: 'image', role: 'brand mark', bbox: box(0.7, 0.6, 0.2, 0.2), assetId: 'fixture-mark', states: imageStates })] : [])
        ],
        requiredAssets: withImage ? [requirement('fixture-mark', 'image', imageStatus, 's2-mark')] : [],
        transition: { type: 'cut', durationFrames: 0, evidence: evidence([11, 12], 'Adjacent decoded frames compared; no blended frame observed.') }
      })
    ]
  };
}

function fixtureManifest(spec, { status = 'valid', review = 'confirmed' } = {}) {
  return {
    schemaVersion: 1, sourceHash: spec.sourceHash,
    assets: spec.shots.flatMap(item => item.requiredAssets).map(record => ({
      id: record.id, type: record.type,
      path: status === 'valid' ? 'C:/synthetic/fixture-mark.png' : null,
      sha256: status === 'valid' ? 'b'.repeat(64) : null,
      width: 40, height: 40, fontFamily: null, fontStyle: null,
      provenance: 'Synthetic fixture asset supplied by this test; not a user asset.',
      licenseStatus: 'unresolved', origin: status === 'valid' ? 'supplied' : 'missing',
      intendedUse: 'Synthetic fixture use only.', dependencies: [], status
    })),
    missing: status === 'valid' ? [] : spec.shots.flatMap(item => item.requiredAssets.map(record => record.id)),
    review: { status: review, notes: 'Synthetic generic fixture review.' }
  };
}

function capabilitiesWithout(...ids) {
  const contract = structuredClone(adapterCapabilityContract());
  for (const id of ids) contract.operations[id] = { ...contract.operations[id], supportStatus: 'documented' };
  return contract;
}

async function compile(options = {}) {
  const spec = fixtureSpec(options);
  const catalog = deriveCatalog(spec);
  const assetManifest = options.assetManifest ?? fixtureManifest(spec, options.manifest ?? {});
  const design = buildGenericDesignTokens(spec, catalog, { assetManifest, capabilities: options.capabilities });
  const designValidation = await validateGenericDesign(design, { spec, assetManifest, capabilities: options.capabilities });
  const plan = await buildGenericScenePlan({ spec, assetManifest, tokens: design, catalog, designValidation, capabilities: options.capabilities });
  return { spec, catalog, assetManifest, design, designValidation, plan };
}

test('derived catalog covers only the element types and event kinds the fixture observes', () => {
  const catalog = deriveCatalog(fixtureSpec({ withImage: true }));
  assert.deepEqual(catalog.components.map(item => item.id).sort(), ['image', 'rect', 'scene-cut', 'text']);
  assert.deepEqual(catalog.presets.map(item => item.id), ['left-drift', 'scene-cut']);
  assert.equal(catalog.source, 'derived');
  assert.equal(catalog.sourceHash, SOURCE);
  assert.deepEqual(eventKind('left-drift'), 'translate');
  assert.deepEqual(eventKind('scale-x-reveal'), 'scale');
  assert.deepEqual(eventKind('scene-cut'), 'transition');
  assert.deepEqual(eventKind('word-appear'), 'appearance');
  // A single-shot reference with no recorded events yields no transition preset.
  const sparse = deriveCatalog({ ...fixtureSpec(), shots: [fixtureSpec().shots[0]] });
  assert.deepEqual(sparse.components.map(item => item.id), ['rect', 'text']);
  assert.deepEqual(sparse.presets.map(item => item.id), ['left-drift']);
});

test('derived catalog satisfies the component-catalog artifact contract', async () => {
  const catalog = deriveCatalog(fixtureSpec({ withImage: true }));
  assert.equal(await validateArtifact('component-catalog', catalog), catalog);
  assert.throws(() => validateCatalogShape({ ...catalog, components: [...catalog.components, catalog.components[0]] }),
    error => error.code === 'CATALOG_DUPLICATE_COMPONENT');
  assert.throws(() => validateCatalogShape({ ...catalog, presets: [{ ...catalog.presets[0], eventTypes: [] }] }),
    error => error.code === 'CATALOG_PRESET_EVENT_TYPES');
});

test('an authored catalog matches by role and pattern before the derived fallback', async () => {
  const authoredPath = path.join(root, 'authored-catalog.json');
  const catalog = deriveCatalog(fixtureSpec());
  const authored = {
    ...catalog, source: 'authored', sourceHash: SOURCE,
    components: [
      // Non-fallback entries win by exact role or role pattern; the per-type
      // fallbacks stay in the catalog to answer everything else.
      { ...catalog.components.find(item => item.id === 'rect'), id: 'frame-background', fallback: false, match: { type: 'rect', rolePattern: '^back' } },
      { ...catalog.components.find(item => item.id === 'text'), id: 'title-text', fallback: false, match: { type: 'text', role: 'title' } },
      ...catalog.components.filter(item => item.fallback)
    ]
  };
  await fs.writeFile(authoredPath, `${JSON.stringify(authored, null, 2)}\n`, 'utf8');
  const loaded = await loadCatalog({ catalogPath: authoredPath });
  assert.equal(loaded.source, 'authored');
  const spec = fixtureSpec();
  assert.equal(componentFor(spec.shots[0].elements[0], loaded).id, 'frame-background');
  assert.equal(componentFor(spec.shots[0].elements[1], loaded).id, 'title-text');
  // An element no authored match intended falls back instead of failing.
  assert.equal(componentFor({ id: 'other', type: 'text', role: 'caption' }, loaded).id, 'text');
  assert.equal(presetFor({ type: 'Left-Drift' }, loaded)?.id, 'left-drift');
  assert.equal(presetFor({ type: 'unobserved-motion' }, loaded), null);
  await assert.rejects(loadCatalog({ catalogPath: path.join(root, 'missing-catalog.json') }),
    error => error.code === 'FILE_READ_FAILED');
});

test('componentFor refuses to substitute a component of another type', () => {
  const catalog = deriveCatalog(fixtureSpec());
  assert.throws(() => componentFor({ id: 'odd', type: 'image', role: 'photo' }, catalog),
    error => error.code === 'COMPONENT_UNMAPPED');
});

test('generic design claims verification from the capability contract only', async () => {
  const { design, designValidation, catalog } = await compile();
  assert.equal(await validateArtifact('design-tokens', design), design);
  assert.equal(designValidation.valid, true);
  assert.equal(designValidation.status, 'valid');
  assert.deepEqual(designValidation.counts, { components: 3, presets: 2, errors: 0, open: 0 });
  // Dense measurements plus verified motion operations admit the "None" record.
  assert.equal(design.presets.find(item => item.id === 'left-drift').easing, 'None');
  assert.equal(design.presets.find(item => item.id === 'left-drift').supportStatus, 'runtime_verified');
  assert.equal(design.presets.find(item => item.id === 'scene-cut').supportStatus, 'runtime_verified');
  assert.ok(design.presets.find(item => item.id === 'left-drift').validation
    .some(note => /implementation record, not a claim/i.test(note)), 'the density rule must be recorded');
  // Removing the keyframe capability removes the claim, not just the label.
  const degraded = await compile({ capabilities: capabilitiesWithout('keyframe') });
  assert.equal(degraded.design.presets.find(item => item.id === 'left-drift').supportStatus, 'documented');
  assert.equal(degraded.design.presets.find(item => item.id === 'left-drift').easing, null);
  assert.equal(degraded.designValidation.status, 'valid');
  // Timing-only kinds never need the keyframe operations.
  assert.deepEqual(presetOperations('transition'), ['setLayerTiming']);
  assert.deepEqual(presetOperations('translate'), ['setLayerTiming', 'keyframe', 'setEasing', 'setInterpolation']);
  assert.equal(catalog.presets.length, 2);
});

test('generic design validation rejects claims the contract cannot support', async () => {
  const base = await compile();
  const codesOf = validation => validation.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
  const lyingComponent = structuredClone(base.design);
  lyingComponent.components = lyingComponent.components.map(item => ({ ...item, supportStatus: 'runtime_verified' }));
  const degraded = capabilitiesWithout('createPrimitive');
  const componentCheck = await validateGenericDesign(lyingComponent, { spec: base.spec, capabilities: degraded });
  assert.ok(codesOf(componentCheck).includes('RUNTIME_CLAIM_UNSUPPORTED'), 'createPrimitive is only documented here');

  const lyingPreset = structuredClone(base.design);
  lyingPreset.presets = lyingPreset.presets.map(item => ({ ...item, easing: 'Back', supportStatus: 'runtime_verified' }));
  const easingCheck = await validateGenericDesign(lyingPreset, { spec: base.spec });
  assert.ok(codesOf(easingCheck).includes('PRESET_EASING_UNSUPPORTED'));
  assert.ok(codesOf(easingCheck).includes('RUNTIME_CLAIM_EASING'));

  const sparseClaim = structuredClone(base.design);
  sparseClaim.presets = sparseClaim.presets.map(item => item.id === 'left-drift'
    ? { ...item, supportStatus: 'runtime_verified', easing: 'None' } : item);
  const sparseCheck = await validateGenericDesign(sparseClaim, { spec: fixtureSpec({ dense: false }) });
  assert.ok(codesOf(sparseCheck).includes('RUNTIME_CLAIM_EVIDENCE'), 'sparse states cannot support a motion claim');

  const nullEasing = structuredClone(base.design);
  nullEasing.presets = nullEasing.presets.map(item => ({ ...item, easing: null, validation: [] }));
  assert.ok(codesOf(await validateGenericDesign(nullEasing, { spec: base.spec })).includes('PRESET_EASING_UNRESOLVED_NOTE'));
});

test('a dense generic plan with resolved inputs is executable and compiles', async () => {
  const { plan } = await compile({ withImage: true });
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.validation.executable, true, JSON.stringify(plan.validation.diagnostics));
  assert.equal(plan.validation.counts.errors, 0);
  assert.equal(plan.validation.counts.open, 0);
  assert.equal(plan.planner.version.includes('+generic'), true);
  const operations = toAdapterOperations(plan);
  assert.equal(operations.length, plan.operations.length);
  assert.equal(previewAdapterBatch(plan).compiled, true);
  assert.ok(operations.some(item => item.action === 'createText'));
  assert.ok(operations.some(item => item.action === 'importAsset'));
  assert.ok(operations.some(item => item.action === 'timing'));
});

test('sparse motion stays blocked instead of inventing a curve', async () => {
  const { plan } = await compile({ dense: false });
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.validation.executable, false);
  const codes = plan.validation.diagnostics.map(item => item.code);
  assert.ok(codes.includes('EASING_UNRESOLVED'));
  assert.ok(codes.includes('EXECUTION_GATED'));
  const drift = plan.events.find(item => item.id === 's1-title-drift');
  assert.equal(drift.supportStatus, 'blocked');
  assert.equal(drift.easing, null);
  assert.equal(plan.keyframes.length, 2, 'the two measured states are still recorded');
  assert.equal(plan.keyframes.every(item => item.supportStatus === 'blocked'), true);
  assert.equal(plan.operations.filter(item => item.phase === 'animation').length, 0, 'no animation operation is emitted');
  assert.ok(plan.keyframes.every(item => /unresolved/i.test(item.notes)));
});

test('unresolved typography blocks the element rather than substituting a face', async () => {
  const { plan } = await compile({ font: NO_FONT });
  assert.equal(plan.validation.executable, false);
  const title = plan.elements.find(item => item.id === 's1-title');
  assert.equal(title.status, 'blocked');
  assert.deepEqual(title.blockers, ['fontFamily is unresolved', 'fontStyle is unresolved', 'fontSizePx is unresolved']);
  assert.equal(title.parameters.fontFamily, null);
  assert.equal(plan.operations.filter(item => item.phase === 'animation').length, 0);
  assert.ok(plan.unresolved.some(note => /font family|typography/i.test(note)), 'the open requirement is recorded');
});

test('a measured track that never changes emits no keyframes', async () => {
  const { plan } = await compile({ withImage: true });
  const imageKeyframes = plan.keyframes.filter(item => item.elementId === 's2-mark');
  assert.deepEqual(imageKeyframes, [], 'identical measured states carry no motion');
  assert.equal(plan.operations.filter(item => item.elementId === 's2-mark' && item.phase === 'animation').length, 0);
  assert.equal(plan.operations.filter(item => item.elementId === 's2-mark').length, 2, 'create and timing remain');
});

test('an unresolved asset keeps the plan honest', async () => {
  const spec = fixtureSpec({ withImage: true });
  const assetManifest = fixtureManifest(spec, { status: 'missing' });
  const { plan } = await compile({ withImage: true, assetManifest });
  assert.equal(plan.validation.executable, false);
  assert.equal(plan.assets.find(item => item.id === 'fixture-mark').status, 'missing');
  assert.ok(plan.unresolved.some(note => /fixture-mark/i.test(note)));
  assert.ok(plan.elements.find(item => item.id === 's2-mark').blockers.some(note => /fixture-mark is missing/i.test(note)));
});

test('a pending asset review keeps a structurally valid plan unexecutable', async () => {
  const spec = fixtureSpec({ withImage: true });
  const { plan } = await compile({ withImage: true, assetManifest: fixtureManifest(spec, { status: 'valid', review: 'pending' }) });
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.validation.executable, false);
  assert.ok(plan.validation.diagnostics.some(item => item.code === 'ASSET_REVIEW_PENDING'));
});

test('generic artifacts carry no saas vocabulary', async () => {
  const { catalog, design, plan } = await compile({ withImage: true });
  const text = JSON.stringify({ catalog, design, plan });
  for (const banned of ['remax', 'word-wall', 'word wall', 'headline', 'highlight', 'logo-mark', 'brand-remax-logo']) {
    assert.equal(text.toLowerCase().includes(banned.toLowerCase()), false, `generic artifacts must not mention ${banned}`);
  }
  assert.equal(plan.elements.every(item => ['rect', 'text', 'image'].includes(item.componentType)), true);
});

test('generic design and plan registration write into their own job directories', async () => {
  const jobDirectory = path.join(root, 'job');
  const spec = fixtureSpec({ withImage: true });
  const specPath = path.join(jobDirectory, 'shot-spec.json');
  const manifestPath = path.join(jobDirectory, 'asset-manifest.json');
  await fs.mkdir(jobDirectory, { recursive: true });
  await fs.writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  await fs.writeFile(manifestPath, `${JSON.stringify(fixtureManifest(spec), null, 2)}\n`, 'utf8');
  const design = await registerGenericDesign(specPath, { assetManifestPath: manifestPath, jobDirectory });
  assert.equal(design.runDirectory.startsWith(absolutePath(path.join(jobDirectory, 'design-generic'))), true);
  assert.equal((await readJson(design.tokensPath)).sourceHash, SOURCE);
  const planned = await registerGenericScenePlan(specPath, {
    assetManifestPath: manifestPath, tokensPath: design.tokensPath, jobDirectory
  });
  assert.equal(planned.runDirectory.startsWith(absolutePath(path.join(jobDirectory, 'plan-generic'))), true);
  assert.equal(planned.record.executable, true);
  assert.equal(planned.executable, true);
  assert.equal((await readJson(path.join(path.dirname(planned.runDirectory), 'index.json'))).kind, 'generic-scene-plan');
  assert.match(await fs.readFile(planned.dryRunMarkdownPath, 'utf8'), /scene/i, 'a readable dry run accompanies the plan');
  // Resume: the same inputs reuse the recorded run instead of writing a new one.
  const designAgain = await registerGenericDesign(specPath, { assetManifestPath: manifestPath, jobDirectory });
  assert.equal(designAgain.cached, true);
  assert.equal(designAgain.runDirectory, design.runDirectory);
  const plannedAgain = await registerGenericScenePlan(specPath, {
    assetManifestPath: manifestPath, tokensPath: design.tokensPath, jobDirectory
  });
  assert.equal(plannedAgain.cached, true);
  assert.equal(plannedAgain.runDirectory, planned.runDirectory);
  // A corrupt cached artifact is a cache miss, and the prior run stays untouched.
  await fs.writeFile(planned.planPath, 'deliberately corrupt TEST-ONLY cache fixture', 'utf8');
  const replanned = await registerGenericScenePlan(specPath, {
    assetManifestPath: manifestPath, tokensPath: design.tokensPath, jobDirectory
  });
  assert.equal(replanned.cached, false);
  assert.notEqual(replanned.runDirectory, planned.runDirectory);
  assert.equal(await fs.readFile(planned.planPath, 'utf8'), 'deliberately corrupt TEST-ONLY cache fixture');
  // A pending spec review is refused before anything is written.
  const pendingDirectory = path.join(root, 'job-pending');
  await fs.mkdir(pendingDirectory, { recursive: true });
  const pendingSpecPath = path.join(pendingDirectory, 'shot-spec.json');
  await fs.writeFile(pendingSpecPath, `${JSON.stringify({ ...spec, review: { status: 'pending', notes: 'Awaiting review.' } }, null, 2)}\n`, 'utf8');
  await assert.rejects(registerGenericDesign(pendingSpecPath, { jobDirectory: pendingDirectory }),
    error => error.code === 'SPEC_REVIEW_PENDING');
  assert.equal(await fs.readdir(pendingDirectory).then(items => items.includes('design-generic')), false);
});
