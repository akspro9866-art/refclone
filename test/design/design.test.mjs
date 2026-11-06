import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesignTokens, validateDesign, registerDesign, DOCUMENTED_EASINGS } from '../../src/design/design.mjs';
import { readJson, validateArtifact } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'design-'));

const evidence = (frames = [0]) => ({ status: 'measured', method: 'fixture', frames, confidence: 0.9, notes: 'Synthetic fixture.' });
const box = (x, y, width, height) => ({ x, y, width, height });
const font = () => ({ family: null, style: null, sizePx: null });
const state = (frame, x, width = 0.08, height = 0.06763333, y = 0.4565) => ({ frame, bbox: box(x, y, width, height), opacity: 1 });
const element = (id, type, role, copy, bbox, color, states = [], unresolved = []) => ({
  id, type, role, copy, bbox, color, font: font(), assetId: null,
  evidence: evidence(states.length ? [states[0].frame] : [0]), states, unresolved
});
const event = (id, elementId, type, frames, property, from, to) => ({
  id, elementId, type, frames, property, from, to, evidence: evidence(frames)
});
const requirement = (id, type, elementId = null, status = 'unresolved') => ({
  id, type, elementId, status, notes: 'Synthetic fixture requirement.'
});
const cut = frame => ({ type: 'cut', durationFrames: 0, evidence: evidence([frame - 1, frame]) });

function fixtureSpec() {
  const fps = { num: 24, den: 1 };
  return {
    schemaVersion: 1, sourceHash: 'a'.repeat(64), resolution: { width: 736, height: 414 }, fps, totalFrames: 216,
    review: { status: 'confirmed', notes: 'Synthetic design fixture.' },
    shots: [
      {
        id: 'shot-001', startFrame: 0, endFrameExclusive: 28, startSeconds: 0, endSeconds: 28 / 24, durationSeconds: 28 / 24,
        transition: { type: 'none', durationFrames: 0, evidence: evidence([0]) },
        elements: [
          element('s1-bg', 'rect', 'background', null, box(0, 0, 1, 1), '#f7f5f6'),
          element('s1-you', 'text', 'headline word', 'You', box(0.3125, 0.4565, 0.0747, 0.067633), '#1a1e35', [state(5, 0.47), state(27, 0.3125, 0.0747)], ['Exact font unresolved.']),
          element('s1-build', 'text', 'headline word', 'build', box(0.4035, 0.4565, 0.0978, 0.067633), '#1a1e35', [state(9, 0.5, 0.0978), state(27, 0.4035, 0.0978)], ['Exact font unresolved.'])
        ],
        events: [
          event('s1-appear-you', 's1-you', 'appearance', [5], 'visibility', false, true),
          event('s1-appear-build', 's1-build', 'appearance', [9], 'visibility', false, true),
          event('s1-drift-you', 's1-you', 'drift', [18, 27], 'x', 250, 230),
          event('s1-drift-build', 's1-build', 'drift', [18, 27], 'x', 316, 296)
        ],
        requiredAssets: [requirement('font-sans-headline', 'font', 's1-you')],
        unresolved: ['Whether line re-centering is reflow or animated x is unresolved.']
      },
      {
        id: 'shot-002', startFrame: 28, endFrameExclusive: 127, startSeconds: 28 / 24, endSeconds: 127 / 24, durationSeconds: 99 / 24,
        transition: cut(28),
        elements: [
          element('s2-bg', 'rect', 'background', null, box(0, 0, 1, 1), '#2c55d4'),
          element('s2-wall', 'text', 'word wall (repeated qualities vocabulary)', null, box(0, 0, 1, 1), '#11254f', [], ['Full wall copy is not transcribed.']),
          element('s2-honesty', 'text', 'highlighted quality', 'honesty', box(0.3954, 0.4396, 0.2378, 0.1184), '#ffffff', [state(28, 0.3954, 0.2378, 0.1184, 0.4396), state(38, 0.3736, 0.2378, 0.1184, 0.4396)])
        ],
        events: [
          event('s2-pan-honesty', 's2-honesty', 'pan-left', [28, 38], 'x', 291, 275),
          event('s2-wall-layout', 's2-wall', 'layout-change', [39, 50, 61], 'word-arrangement', null, null)
        ],
        requiredAssets: [requirement('font-sans-wall', 'font', 's2-wall'), requirement('font-serif-highlight', 'font', 's2-honesty')],
        unresolved: ['Full word-wall copy and per-beat arrangements are not transcribed.']
      },
      {
        id: 'shot-003', startFrame: 127, endFrameExclusive: 168, startSeconds: 127 / 24, endSeconds: 7, durationSeconds: 41 / 24,
        transition: cut(127),
        elements: [
          element('s3-bg', 'rect', 'background', null, box(0, 0, 1, 1), '#f7f5f6'),
          element('s3-you', 'text', 'headline word', 'You', box(0.2799, 0.4565, 0.0747, 0.067633), '#1a1e35', [state(127, 0.3288), state(146, 0.2799, 0.0747)], ['Exact font unresolved.']),
          element('s3-build', 'text', 'headline word', 'build', box(0.3709, 0.4565, 0.0978, 0.067633), '#1a1e35', [state(127, 0.4239, 0.0978), state(146, 0.3709, 0.0978)], ['Exact font unresolved.']),
          element('s3-trust', 'text', 'highlighted final word', 'trust.', box(0.6196, 0.4686, 0.0897, 0.0531), '#2e51d4', [state(127, 0.7283, 0.087, 0.0531, 0.4686), state(146, 0.6196, 0.0897, 0.0531, 0.4686)], ['Exact serif font unresolved.'])
        ],
        events: [
          event('s3-settle-you', 's3-you', 'settle', [127, 146], 'x', 242, 206),
          event('s3-settle-build', 's3-build', 'settle', [127, 146], 'x', 312, 276),
          event('s3-settle-trust', 's3-trust', 'settle', [127, 146], 'x', 536, 456)
        ],
        requiredAssets: [requirement('font-sans-headline', 'font', 's3-you'), requirement('font-serif-trust', 'font', 's3-trust')],
        unresolved: ['Grouped versus separate settle is unresolved.']
      },
      {
        id: 'shot-004', startFrame: 168, endFrameExclusive: 216, startSeconds: 7, endSeconds: 9, durationSeconds: 2,
        transition: cut(168),
        elements: [
          element('s4-bg', 'rect', 'background', null, box(0, 0, 1, 1), '#0c264a'),
          element('s4-logo', 'image', 'RE/MAX brand logo', null, box(0.356, 0.4517, 0.2976, 0.0966), null, [
            { frame: 168, bbox: box(0.40625, 0.4517, 0.1807, 0.0966), opacity: 1 },
            { frame: 185, bbox: box(0.3573, 0.4517, 0.2853, 0.0966), opacity: 1 },
            { frame: 215, bbox: box(0.356, 0.4517, 0.2976, 0.0966), opacity: 1 }
          ], ['Original vector asset unavailable.'])
        ],
        events: [event('s4-reveal', 's4-logo', 'scale-x-reveal', [168, 185, 192], 'scaleX', 0.607, 1)],
        requiredAssets: [requirement('brand-remax-logo', 'logo', 's4-logo', 'missing')],
        unresolved: ['Reveal easing is unresolved.']
      }
    ],
    transformations: []
  };
}

function fixtureManifest(spec, status = 'pending') {
  const asset = (id, type, status, origin = 'missing') => ({
    id, type, path: null, sha256: null, width: null, height: null,
    fontFamily: null, fontStyle: null, provenance: 'Synthetic fixture open requirement.',
    licenseStatus: 'unresolved', origin, intendedUse: `Fixture use for ${id}`, dependencies: [], status
  });
  const assets = [
    asset('font-sans-headline', 'font', 'unresolved'),
    asset('font-sans-wall', 'font', 'unresolved'),
    asset('font-serif-highlight', 'font', 'unresolved'),
    asset('font-serif-trust', 'font', 'unresolved'),
    asset('brand-remax-logo', 'logo', 'missing'),
    asset('shot-002-wall-copy', 'copy', 'missing')
  ];
  return {
    schemaVersion: 1, sourceHash: spec.sourceHash, assets,
    missing: assets.filter(item => item.status !== 'valid').map(item => item.id),
    review: { status, notes: 'Synthetic fixture review.' }
  };
}

test('design tokens are measured from the confirmed spec and unresolved values stay null', async () => {
  const spec = fixtureSpec();
  const manifest = fixtureManifest(spec);
  const tokens = buildDesignTokens(spec, { assetManifest: manifest });
  await validateArtifact('design-tokens', tokens);
  assert.equal(tokens.sourceHash, spec.sourceHash);
  assert.equal(tokens.tokens['color.background.canvas'].value, '#f7f5f6');
  assert.equal(tokens.tokens['color.background.brand'].value, '#2c55d4');
  assert.equal(tokens.tokens['color.text.primary'].value, '#1a1e35');
  assert.equal(tokens.tokens['type.headline.family'].value, null);
  assert.equal(tokens.tokens['type.headline.family'].evidence.status, 'unresolved');
  assert.equal(tokens.tokens['type.headline.inkHeightPx'].value, 28);
  assert.equal(tokens.tokens['motion.cut.durationFrames'].value, 0);
  assert.deepEqual(tokens.tokens['motion.cut.frames'].value, [28, 127, 168]);
  assert.equal(tokens.tokens['motion.highlight.pan.durationFrames'].value, 10);
  assert.equal(tokens.tokens['shape.cornerRadiusPx'].value, null);
  assert.deepEqual(tokens.components.map(component => component.id), ['background', 'headline', 'word-wall', 'highlight', 'logo-mark', 'scene-cut']);
  assert.equal(tokens.components.find(component => component.id === 'background').supportStatus, 'runtime_verified');
  assert.equal(tokens.presets.length, 7);
  assert.ok(tokens.presets.every(preset => preset.initialState && preset.finalState));
  assert.ok(tokens.unknowns.some(note => note.includes('font-sans-headline')));
  assert.ok(tokens.unknowns.some(note => note.includes('shot-002-wall-copy')));
});

test('design validation blocks construction while fonts, logo and copy are open', async () => {
  const spec = fixtureSpec();
  const manifest = fixtureManifest(spec);
  const tokens = buildDesignTokens(spec, { assetManifest: manifest });
  const validation = await validateDesign(tokens, { spec, assetManifest: manifest });
  const detail = () => JSON.stringify(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), null, 1);
  assert.equal(validation.valid, true, detail());
  assert.equal(validation.status, 'blocked');
  assert.equal(validation.buildReady, false);
  assert.equal(validation.counts.errors, 0);
  assert.ok(validation.diagnostics.some(diagnostic => diagnostic.code === 'COMPONENT_BLOCKED' && diagnostic.componentId === 'headline'));
  assert.ok(validation.diagnostics.some(diagnostic => diagnostic.code === 'REVIEW_PENDING'));
  assert.ok(validation.diagnostics.some(diagnostic => diagnostic.code === 'ASSET_REQUIREMENT_OPEN' && diagnostic.requirementId === 'brand-remax-logo'));
  assert.ok(validation.diagnostics.some(diagnostic => diagnostic.code === 'ASSET_REQUIREMENT_OPEN' && diagnostic.requirementId === 'shot-002-wall-copy'));
});

test('a fully available spec yields build-ready tokens; stale blocked statuses are rejected', async () => {
  const spec = fixtureSpec();
  for (const shot of spec.shots) for (const asset of shot.requiredAssets) asset.status = 'available';
  spec.shots[1].elements[1].unresolved = [];
  spec.shots[3].elements[1].unresolved = [];
  const tokens = buildDesignTokens(spec);
  const validation = await validateDesign(tokens, { spec });
  assert.equal(validation.valid, true);
  assert.equal(validation.status, 'valid');
  assert.equal(validation.buildReady, true, JSON.stringify(validation.diagnostics));
  assert.equal(tokens.components.find(component => component.id === 'headline').supportStatus, 'runtime_verified');
  assert.equal(tokens.presets.find(preset => preset.id === 'wall-layout-step').supportStatus, 'documented');
  assert.equal(tokens.presets.find(preset => preset.id === 'headline-word-appear').easing, 'None');

  const manifest = fixtureManifest(spec, 'confirmed');
  for (const asset of manifest.assets) { asset.path = 'C:/fixture/file.bin'; asset.sha256 = 'b'.repeat(64); asset.status = 'valid'; asset.origin = 'supplied'; }
  manifest.missing = [];
  const stale = structuredClone(tokens);
  stale.components.find(component => component.id === 'headline').supportStatus = 'blocked';
  const check = await validateDesign(stale, { spec, assetManifest: manifest });
  assert.equal(check.valid, false);
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'DESIGN_STATUS_STALE'));
});

test('schema and evidence checks reject invented components, colors and statuses', async () => {
  const spec = fixtureSpec();
  const tokens = buildDesignTokens(spec);

  const extra = structuredClone(tokens);
  extra.components.push({ id: 'button', type: 'button', requiredInputs: ['copy'], supported: true });
  let check = await validateDesign(extra, { spec });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'COMPONENT_UNUSED'));

  const missing = structuredClone(tokens);
  missing.components = missing.components.filter(component => component.id !== 'headline');
  check = await validateDesign(missing, { spec });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'COMPONENT_MISSING'));

  const color = structuredClone(tokens);
  color.tokens['color.text.primary'].value = '#123456';
  check = await validateDesign(color, { spec });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'COLOR_NOT_MEASURED'));

  const nullStatus = structuredClone(tokens);
  nullStatus.tokens['type.headline.family'].evidence.status = 'measured';
  check = await validateDesign(nullStatus, { spec });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'TOKEN_NULL_STATUS'));

  const valueStatus = structuredClone(tokens);
  valueStatus.tokens['color.text.primary'].evidence.status = 'unresolved';
  check = await validateDesign(valueStatus, { spec });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'TOKEN_VALUE_UNRESOLVED'));

  const badSchema = structuredClone(tokens);
  badSchema.components[0].supportStatus = 'trusted';
  await assert.rejects(validateArtifact('design-tokens', badSchema), { code: 'SCHEMA_INVALID' });
});

test('preset easing is limited to documented labels or explicit null', async () => {
  const spec = fixtureSpec();
  const tokens = buildDesignTokens(spec);
  assert.ok(DOCUMENTED_EASINGS.includes('SlowOut'));

  const unknown = structuredClone(tokens);
  unknown.presets.find(preset => preset.id === 'wall-pan-left').easing = 'EaseOut';
  let check = await validateDesign(unknown, { spec });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'PRESET_EASING_UNKNOWN'));

  const documented = structuredClone(tokens);
  documented.presets.find(preset => preset.id === 'wall-pan-left').easing = 'SlowOut';
  check = await validateDesign(documented, { spec });
  assert.ok(!check.diagnostics.some(diagnostic => diagnostic.code === 'PRESET_EASING_UNKNOWN'));

  const silent = structuredClone(tokens);
  const preset = silent.presets.find(item => item.id === 'headline-left-drift');
  preset.validation = ['Synthetic structure only.'];
  check = await validateDesign(silent, { spec });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'PRESET_EASING_UNRESOLVED_NOTE'));
});

test('open font requirements forbid non-null font family tokens', async () => {
  const spec = fixtureSpec();
  const manifest = fixtureManifest(spec);
  const tokens = buildDesignTokens(spec, { assetManifest: manifest });
  const claimed = structuredClone(tokens);
  claimed.tokens['type.headline.family'] = {
    value: 'Arial', evidence: evidence([27])
  };
  const check = await validateDesign(claimed, { spec, assetManifest: manifest });
  assert.ok(check.diagnostics.some(diagnostic => diagnostic.code === 'FONT_FAMILY_CLAIM'));
});

test('build rejects an incomplete reference role set', () => {
  const spec = fixtureSpec();
  spec.shots[3].elements = spec.shots[3].elements.filter(element => element.id !== 's4-logo');
  assert.throws(() => buildDesignTokens(spec), { code: 'DESIGN_REFERENCE_ROLE_MISSING' });
});

test('design registration is versioned, validated and cache-resumable', async () => {
  const specPath = path.join(root, 'job', 'analysis', 'content-key', 'run-key', 'shot-spec.json');
  await fs.mkdir(path.dirname(specPath), { recursive: true });
  await fs.writeFile(specPath, JSON.stringify(fixtureSpec(), null, 2));

  const first = await registerDesign(specPath);
  assert.equal(first.cached, false);
  assert.equal(first.version, '1.0.0');
  assert.equal(first.validation.status, 'blocked');
  assert.equal(first.buildReady, false);
  const tokens = await readJson(first.tokensPath);
  assert.equal(tokens.sourceHash, 'a'.repeat(64));
  await validateArtifact('design-tokens', tokens);
  const validation = await readJson(first.validationPath);
  assert.equal(validation.buildReady, false);
  assert.ok(first.tokensPath.includes(path.join('job', 'design')));

  const second = await registerDesign(specPath);
  assert.equal(second.cached, true);
  assert.equal(second.tokensSha256, first.tokensSha256);

  const spec = fixtureSpec();
  spec.review.notes = 'Changed fixture notes invalidate the cache key.';
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
  const third = await registerDesign(specPath);
  assert.equal(third.cached, false);
  assert.notEqual(third.key, first.key);
});
