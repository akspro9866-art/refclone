// Catalog unit tests. The fixtures here are authored by this file: they are synthetic
// vocabulary, not observations of any reference, and they exist to prove what the
// reference-agnostic catalog will and will not agree to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  componentById, componentFor, deriveCatalog, eventKind, loadCatalog,
  presetById, presetFor, validateCatalogShape
} from '../src/catalog.mjs';
import { absolutePath, validateArtifact } from '../src/core.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'catalog-'));

const SOURCE = 'c'.repeat(64);
const element = (type, role = null) => ({ type, role });
const shotOf = ({ elements = [], events = [] }) => ({ elements, events });

/** A spec object only needs the fields deriveCatalog reads: element types and event labels. */
function specOf(shots) {
  return { schemaVersion: 1, sourceHash: SOURCE, shots };
}

test('event labels are classified by motion family, with generic as the honest fallback', () => {
  assert.equal(eventKind('left-drift'), 'translate');
  assert.equal(eventKind('slide-in'), 'translate');
  assert.equal(eventKind('scale-reveal'), 'scale');
  assert.equal(eventKind('word-appear'), 'appearance');
  assert.equal(eventKind('grid-reflow'), 'layout');
  assert.equal(eventKind('scene_cut'), 'transition');
  // The most specific pattern wins, so a label mixing families is a transition.
  assert.equal(eventKind('scale in after cut'), 'transition');
  // An unfamiliar label does not get a borrowed template.
  assert.equal(eventKind('pulse'), 'generic');
  assert.equal(eventKind(null), 'generic');
});

test('labels that slug to one id share a preset and an unknown label takes the generic template', () => {
  const catalog = deriveCatalog(specOf([shotOf({
    elements: [element('text'), element('rect'), element('shape')],
    events: [
      { type: 'left-drift', frames: [0, 4] },
      { type: 'left drift', frames: [0, 6] },
      { type: 'pulse', frames: [2, 3] }
    ]
  })]));
  const drift = catalog.presets.find(preset => preset.id === 'left-drift');
  assert.equal(catalog.presets.filter(preset => preset.id === 'left-drift').length, 1, 'one preset per slug');
  assert.deepEqual(drift.eventTypes, ['left-drift', 'left drift'], 'both measured labels stay answerable');
  assert.equal(drift.kind, 'translate');
  assert.ok([4, 6].includes(drift.durationFrames), 'the duration is an observed span, never an invented one');
  assert.equal(drift.easing, null, 'a translate preset has no easing without evidence');

  const pulse = catalog.presets.find(preset => preset.id === 'pulse');
  assert.equal(pulse.kind, 'generic');
  assert.deepEqual(pulse.requiredInputs, ['elementId']);
  assert.match(pulse.validation.join(' '), /Template shape is generic/);

  // A type outside the planner vocabulary gets no component, and an element of that
  // type is refused rather than mapped onto the nearest lookalike.
  assert.equal(catalog.components.some(component => component.type === 'shape'), false);
  assert.throws(() => componentFor({ id: 'x', type: 'shape', role: 'thing' }, catalog),
    error => error.code === 'COMPONENT_UNMAPPED');
  assert.equal(catalog.components.every(component => component.fallback === true), true);
});

test('a transition observed inside one shot still contributes the cut vocabulary', async () => {
  const single = deriveCatalog(specOf([shotOf({
    elements: [element('text')],
    events: [{ type: 'hard cut', frames: [7, 8] }]
  })]));
  assert.deepEqual(single.components.map(component => component.id), ['text', 'scene-cut']);
  assert.deepEqual(single.presets.map(preset => preset.id), ['hard-cut', 'scene-cut']);
  for (const preset of single.presets) {
    assert.equal(preset.kind, 'transition');
    assert.equal(preset.easing, 'None', 'the cut easing record is timing, not a curve');
    assert.equal(preset.durationFrames, 0);
  }
  assert.equal(await validateArtifact('component-catalog', single), single);
  // Two shots with no transition event still get the structural cut component.
  const two = deriveCatalog(specOf([shotOf({ elements: [element('rect')] }), shotOf({ elements: [element('rect')] })]));
  assert.deepEqual(two.presets.map(preset => preset.id), ['scene-cut']);
  // And a single static shot carries no transition vocabulary at all.
  const static_ = deriveCatalog(specOf([shotOf({ elements: [element('rect')] })]));
  assert.deepEqual(static_.components.map(component => component.id), ['rect']);
  assert.deepEqual(static_.presets, []);
  assert.throws(() => deriveCatalog(null), error => error.code === 'CATALOG_SPEC_REQUIRED');
});

test('structural validation catches what the JSON schema cannot', () => {
  const catalog = deriveCatalog(specOf([shotOf({ elements: [element('text')], events: [{ type: 'left-drift', frames: [0, 2] }] })]));
  assert.equal(catalog.source, 'derived');
  assert.equal(validateCatalogShape(catalog), undefined, 'a derived catalog is structurally sound');

  assert.throws(() => validateCatalogShape({ components: null, presets: [] }), error => error.code === 'CATALOG_INVALID');
  assert.throws(() => validateCatalogShape(null), error => error.code === 'CATALOG_INVALID');
  assert.throws(() => validateCatalogShape({ ...catalog, presets: [...catalog.presets, catalog.presets[0]] }),
    error => error.code === 'CATALOG_DUPLICATE_PRESET');
  assert.throws(() => validateCatalogShape({ ...catalog, components: [...catalog.components, { ...catalog.components[0], id: 'text-2' }] }),
    error => error.code === 'CATALOG_MULTIPLE_FALLBACK');
  // A non-fallback component must answer its own type: a text component that matches
  // rects would silently re-tint an element the reviewer never approved.
  assert.throws(() => validateCatalogShape({
    ...catalog,
    components: [{ ...catalog.components[0], fallback: false, match: { type: 'rect' } }]
  }), error => error.code === 'CATALOG_MATCH_MISMATCH');
});

test('loadCatalog resolves an authored catalog relative to the config that names it', async () => {
  const nested = path.join(root, 'nested');
  await fs.mkdir(nested, { recursive: true });
  const spec = specOf([shotOf({ elements: [element('text')], events: [{ type: 'left-drift', frames: [0, 2] }] })]);
  const derived = deriveCatalog(spec);
  const authored = {
    ...derived, source: 'derived',
    components: [
      { ...derived.components[0], id: 'title-text', fallback: false, match: { type: 'text', role: 'title' } },
      ...derived.components.filter(component => component.fallback)
    ]
  };
  const catalogFile = path.join(nested, 'catalog.json');
  await fs.writeFile(catalogFile, `${JSON.stringify(authored, null, 2)}\n`, 'utf8');
  const configPath = path.join(root, 'config.json');
  await fs.writeFile(configPath, `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`, 'utf8');

  const viaConfig = await loadCatalog({
    config: { catalog: { source: 'authored', catalogPath: './nested/catalog.json' }, _configPath: absolutePath(configPath) },
    spec
  });
  assert.equal(viaConfig.source, 'authored', 'loading an authored file re-labels it regardless of the label inside');
  assert.equal(viaConfig._path, absolutePath(catalogFile));
  assert.equal(componentFor({ id: 'a', type: 'text', role: 'title' }, viaConfig).id, 'title-text');
  assert.equal(componentFor({ id: 'b', type: 'text', role: 'subhead' }, viaConfig).id, 'text');

  // An explicit path argument wins over the config, and a derived config ignores the file.
  const viaArgument = await loadCatalog({ catalogPath: catalogFile, config: { catalog: { source: 'derived', catalogPath: null } } });
  assert.equal(viaArgument.source, 'authored');
  const stillDerived = await loadCatalog({ config: { catalog: { source: 'derived', catalogPath: catalogFile }, _configPath: absolutePath(configPath) }, spec });
  assert.equal(stillDerived.source, 'derived');
  assert.equal(stillDerived.sourceHash, SOURCE);

  // A shipped template catalog carries no source identity, so one authored vocabulary
  // can serve every reference instead of being locked to the video it was written for.
  const templateFile = path.join(nested, 'template-catalog.json');
  await fs.writeFile(templateFile, `${JSON.stringify({ ...authored, sourceHash: null }, null, 2)}\n`, 'utf8');
  const viaTemplate = await loadCatalog({ catalogPath: templateFile });
  assert.equal(viaTemplate.sourceHash, null);
  assert.equal(viaTemplate.source, 'authored');

  // No config and no spec: nothing can be derived, and the failure names the missing input.
  await assert.rejects(loadCatalog({ config: { catalog: { source: 'authored', catalogPath: './nested/nope.json' }, _configPath: absolutePath(configPath) } }),
    error => error.code === 'FILE_READ_FAILED');
  await assert.rejects(loadCatalog({}), error => error.code === 'CATALOG_SPEC_REQUIRED');
});

test('catalog lookups return null instead of a plausible substitute', () => {
  const catalog = deriveCatalog(specOf([shotOf({ elements: [element('image')], events: [{ type: 'scale-reveal', frames: [0, 3] }] })]));
  assert.equal(componentById(catalog, 'image').type, 'image');
  assert.equal(componentById(catalog, 'no-such-component'), null);
  assert.equal(presetById(catalog, 'scale-reveal').kind, 'scale');
  assert.equal(presetById(catalog, 'no-such-preset'), null);
  assert.equal(presetFor({ type: 'SCALE-REVEAL' }, catalog).id, 'scale-reveal');
  assert.equal(presetFor({ type: 'left-drift' }, catalog), null, 'an unobserved motion label is not answered by the nearest preset');
  assert.equal(presetFor({}, catalog), null);
  // The scale template keeps its range unresolved rather than defaulting to 1.
  const preset = presetById(catalog, 'scale-reveal');
  assert.equal(preset.easing, null);
  assert.deepEqual(preset.initialState, { scaleFrom: null });
  assert.deepEqual(preset.finalState, { scaleTo: null });
  assert.deepEqual(componentFor({ id: 'm', type: 'image', role: 'photo' }, catalog).operations, ['importAsset', 'keyframe', 'setLayerTiming']);
});
