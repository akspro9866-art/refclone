import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  ASSET_VERSION, DEFAULT_FONT_CANDIDATES, buildAssetManifest, buildMissingAssetReport,
  collectAssetRequirements, discoverProjectAssets, discoverFontDirectory, guessFontFaceFromFile,
  parseFontRegistry, registerAssets, splitFontFace, validateAssets, assetValidationInputHash,
  missingAssetReportMarkdown
} from '../../src/design/assets.mjs';
import { hashFile, readJson, validateArtifact } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'assets-'));
const sourceHash = 'a'.repeat(64);

function registryText() {
  return [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    '    Arial (TrueType)    REG_SZ    arial.ttf',
    '    Arial Bold (TrueType)    REG_SZ    arialbd.ttf',
    '    Segoe UI (TrueType)    REG_SZ    segoeui.ttf',
    '    Segoe UI Semibold (TrueType)    REG_SZ    seguisb.ttf',
    '    Bodoni MT Condensed Bold Italic (TrueType)    REG_SZ    BOD_CBI.TTF',
    '    Baskerville Old Face (TrueType)    REG_SZ    BASKVILL.TTF',
    '    Not A Font (OpenType)    REG_SZ    notafont.otf',
    ''
  ].join('\n');
}

test('font registry parsing separates family from style without downloading fonts', () => {
  assert.deepEqual(splitFontFace('Segoe UI Semibold'), { family: 'Segoe UI', style: 'Semibold' });
  assert.deepEqual(splitFontFace('Arial Bold Italic'), { family: 'Arial', style: 'Bold Italic' });
  assert.deepEqual(splitFontFace('Bodoni MT Condensed Bold Italic'), { family: 'Bodoni MT', style: 'Condensed Bold Italic' });
  assert.deepEqual(splitFontFace('Baskerville Old Face'), { family: 'Baskerville Old Face', style: 'Regular' });
  assert.deepEqual(splitFontFace('Book Antiqua'), { family: 'Book Antiqua', style: 'Regular' });
  const records = parseFontRegistry(registryText(), { key: 'HKLM', directory: 'C:/Windows/Fonts' });
  assert.equal(records.length, 7);
  assert.deepEqual(records[0], {
    name: 'Arial', family: 'Arial', style: 'Regular', file: 'arial.ttf', key: 'HKLM',
    path: 'C:/Windows/Fonts/arial.ttf'
  });
  assert.equal(records.find(record => record.file === 'BOD_CBI.TTF').family, 'Bodoni MT');
  // Registry paths describe Windows even when this job runs elsewhere. Joining them with the
  // host's rules would prepend the working directory on Linux or macOS, where "C:/Windows/Fonts"
  // is a relative path rather than an absolute one, and the recorded font path becomes nonsense.
  assert.equal(records.find(record => record.file === 'BASKVILL.TTF').path, 'C:/Windows/Fonts/BASKVILL.TTF');
  const absoluteEntry = parseFontRegistry(
    '    Foo (TrueType)    REG_SZ    C:\\Windows\\Fonts\\foo.ttf',
    { key: 'HKLM', directory: 'C:/Windows/Fonts' }
  )[0];
  assert.equal(absoluteEntry.path, 'C:/Windows/Fonts/foo.ttf', 'an absolute registry value is kept as-is');
  for (const record of records) {
    assert.equal(
      record.path.includes(`${process.cwd().replaceAll('\\', '/')}/`), false,
      `the host working directory never leaks into ${record.name}`
    );
  }
  assert.ok(DEFAULT_FONT_CANDIDATES.sans.some(face => face.family === 'Lato'));
  assert.ok(DEFAULT_FONT_CANDIDATES.sans.some(face => face.family === 'CanvaSans'));
  assert.deepEqual(guessFontFaceFromFile('Lato-BoldItalic.ttf'), { family: 'Lato', style: 'BoldItalic' });
  assert.deepEqual(guessFontFaceFromFile('Montserrat-VariableFont_wght.ttf'), { family: 'Montserrat', style: 'VariableFont wght' });
});

async function writePng(filePath, width = 3, height = 2, color = [20, 30, 40, 255]) {
  const png = new PNG({ width, height });
  for (let at = 0; at < png.data.length; at += 4) png.data.set(color, at);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, PNG.sync.write(png));
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

function specFixture(requiredAssets, { elements = null } = {}) {
  return {
    schemaVersion: 1, sourceHash,
    resolution: { width: 100, height: 50 }, fps: { num: 24, den: 1 }, totalFrames: 24,
    review: { status: 'confirmed', notes: 'fixture reviewed' }, transformations: [],
    shots: [{
      id: 'shot-001', startFrame: 0, endFrameExclusive: 24, startSeconds: 0, endSeconds: 1, durationSeconds: 1,
      elements: elements ?? [{
        id: 'logo', type: 'image', role: 'logo', copy: null,
        bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, color: null,
        font: { family: null, style: null, sizePx: null }, assetId: null,
        evidence: { status: 'human_confirmed', method: 'fixture', frames: [0], confidence: 1, notes: 'fixture' },
        states: [], unresolved: []
      }],
      events: [],
      transition: { type: 'cut', durationFrames: 0, evidence: { status: 'human_confirmed', method: 'fixture', frames: [0], confidence: 1, notes: 'fixture' } },
      requiredAssets, unresolved: []
    }]
  };
}

const wallCopyRequirement = {
  id: 'shot-002-wall-copy', type: 'copy', status: 'missing', elementId: 'wall',
  notes: 'Wall copy is not transcribed.'
};

const wallElement = {
  id: 'wall', type: 'text', role: 'word wall', copy: null,
  bbox: { x: 0, y: 0.5, width: 1, height: 0.5 }, color: null,
  font: { family: null, style: null, sizePx: null }, assetId: null,
  evidence: { status: 'human_confirmed', method: 'fixture', frames: [0], confidence: 1, notes: 'fixture' },
  states: [], unresolved: ['Copy is not transcribed.']
};
const logoElement = {
  id: 'logo', type: 'image', role: 'logo', copy: null,
  bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, color: null,
  font: { family: null, style: null, sizePx: null }, assetId: null,
  evidence: { status: 'human_confirmed', method: 'fixture', frames: [0], confidence: 1, notes: 'fixture' },
  states: [], unresolved: []
};

test('project asset discovery hashes files, measures PNG dimensions and ignores hidden files', async () => {
  const directory = path.join(root, 'discovery');
  await writePng(path.join(directory, 'nested', 'pixel.png'), 7, 4);
  await writeText(path.join(directory, 'brand.ttf'), 'not a real font, but a hashed supplied file');
  await writeText(path.join(directory, '.ignored'), 'hidden');
  const result = await discoverProjectAssets(directory);
  assert.equal(result.exists, true);
  assert.equal(result.files.length, 2);
  const png = result.files.find(file => file.relativePath === 'nested/pixel.png');
  assert.equal(png.type, 'image');
  assert.equal(png.width, 7);
  assert.equal(png.height, 4);
  assert.equal(png.sha256, await hashFile(png.path));
  const font = result.files.find(file => file.relativePath === 'brand.ttf');
  assert.equal(font.type, 'font');
  assert.equal(font.width, null);
  assert.match(font.id, /^supplied-/);
  const missing = await discoverProjectAssets(path.join(root, 'absent'));
  assert.equal(missing.exists, false);
  assert.equal(missing.files.length, 0);
});

test('application font directories are hashed and recorded as candidates without copying', async () => {
  const directory = path.join(root, 'app-fonts');
  await writeText(path.join(directory, 'Lato-Regular.ttf'), 'lato fixture bytes');
  await writeText(path.join(directory, 'Montserrat-VariableFont_wght.ttf'), 'montserrat fixture bytes');
  await writeText(path.join(directory, 'notes.txt'), 'ignored');
  const found = await discoverFontDirectory(directory);
  assert.equal(found.exists, true);
  assert.equal(found.records.length, 2);
  const lato = found.records.find(record => record.family === 'Lato');
  assert.equal(lato.style, 'Regular');
  assert.match(lato.source, /Application font directory/);
  assert.equal(lato.sha256, await hashFile(lato.path));
  assert.equal(found.records.find(record => record.family === 'Montserrat').style, 'VariableFont wght');
  const spec = specFixture([{ id: 'font-sans-headline', type: 'font', status: 'unresolved', notes: 'Exact sans unverified.' }]);
  const manifest = await buildAssetManifest({
    spec, projectAssets: [], installedFonts: found.records,
    candidateFaces: { sans: [{ family: 'Lato', style: 'Regular' }], serif: [] }
  });
  const candidate = manifest.assets.find(asset => asset.id === 'font-candidate-lato-regular');
  assert.ok(candidate);
  assert.equal(candidate.sha256, lato.sha256);
  assert.match(candidate.provenance, /Application font directory/);
  assert.equal(manifest.assets.find(asset => asset.id === 'font-sans-headline').dependencies[0], 'font-candidate-lato-regular');
});

async function fixtureAssets({ withLogo = true } = {}) {
  const directory = path.join(root, `fixture-${Math.random().toString(16).slice(2)}`);
  const arial = path.join(directory, 'arial.ttf');
  const georgia = path.join(directory, 'georgia.ttf');
  const logo = path.join(directory, 'project', 'logo.png');
  await writeText(arial, 'candidate arial bytes');
  await writeText(georgia, 'candidate georgia bytes');
  if (withLogo) await writePng(logo, 8, 6);
  const projectAssets = withLogo ? (await discoverProjectAssets(path.join(directory, 'project'))).files : [];
  return {
    directory, arial, georgia, logo, projectAssets,
    installedFonts: [
      { family: 'Arial', style: 'Regular', path: arial, key: 'HKLM' },
      { family: 'Georgia', style: 'Regular', path: georgia, key: 'HKLM' }
    ],
    candidateFaces: {
      sans: [{ family: 'Arial', style: 'Regular' }],
      serif: [{ family: 'Georgia', style: 'Regular' }]
    }
  };
}

test('manifest records requirements, candidate fonts, supplied files and explicit missing entries', async () => {
  const fixture = await fixtureAssets();
  const requirements = [
    { id: 'font-sans-headline', type: 'font', status: 'unresolved', notes: 'Exact sans is unverified.' },
    { id: 'brand-remax-logo', type: 'logo', status: 'missing', elementId: 'logo', notes: 'No vector logo supplied.' }
  ];
  const spec = specFixture(requirements, { elements: [logoElement, wallElement] });
  const manifest = await buildAssetManifest({
    spec, projectAssets: fixture.projectAssets, installedFonts: fixture.installedFonts,
    candidateFaces: fixture.candidateFaces, additionalRequirements: [wallCopyRequirement],
    discoveryNotes: ['fixture discovery'], searchNotes: 'No supplied fonts were found.'
  });
  await validateArtifact('asset-manifest', manifest);
  assert.equal(manifest.sourceHash, sourceHash);
  assert.equal(manifest.review.status, 'pending');
  assert.match(manifest.review.notes, /No supplied fonts were found/);
  const headline = manifest.assets.find(asset => asset.id === 'font-sans-headline');
  assert.equal(headline.status, 'unresolved');
  assert.equal(headline.origin, 'missing');
  assert.deepEqual(headline.dependencies, ['font-candidate-arial-regular']);
  const candidate = manifest.assets.find(asset => asset.id === 'font-candidate-arial-regular');
  assert.equal(candidate.status, 'unresolved');
  assert.equal(candidate.origin, 'installed');
  assert.equal(candidate.path, fixture.arial);
  assert.equal(candidate.sha256, await hashFile(fixture.arial));
  assert.match(candidate.intendedUse, /font-sans-headline/);
  assert.equal(manifest.assets.some(asset => asset.id.startsWith('font-candidate-georgia')), false);
  const wall = manifest.assets.find(asset => asset.id === 'shot-002-wall-copy');
  assert.equal(wall.status, 'missing');
  assert.match(wall.intendedUse, /shot-001/);
  assert.equal(manifest.assets.find(asset => asset.type === 'image').origin, 'supplied');
  assert.deepEqual(manifest.missing, ['font-sans-headline', 'brand-remax-logo', 'shot-002-wall-copy']);
  const validation = await validateAssets(manifest, { spec, additionalRequirements: [wallCopyRequirement] });
  assert.equal(validation.status, 'blocked');
  assert.equal(validation.valid, true);
  assert.equal(validation.buildReady, false);
  assert.equal(validation.counts.errors, 0);
  assert.equal(validation.counts.open, 4, 'three requirements plus pending review');
  assert.ok(validation.diagnostics.some(item => item.code === 'REQUIRED_ASSET_OPEN' && item.assetId === 'brand-remax-logo'));
  assert.ok(validation.diagnostics.some(item => item.code === 'REQUIRED_ASSET_OPEN' && item.assetId === 'shot-002-wall-copy'));
  assert.ok(validation.diagnostics.some(item => item.code === 'REVIEW_PENDING'));
  const report = buildMissingAssetReport(manifest, validation, { spec, additionalRequirements: [wallCopyRequirement] });
  assert.equal(report.requirements.length, 3);
  assert.equal(report.buildReady, false);
  assert.match(report.requirements.find(entry => entry.id === 'font-sans-headline').candidates[0].fontFamily, /Arial/);
  const markdown = missingAssetReportMarkdown(report, manifest);
  assert.match(markdown, /# Missing-asset report/);
  assert.match(markdown, /font-sans-headline/);
  // The limitations list is reference-agnostic: it describes what a decoded frame can
  // and cannot prove, never the copy, brand or vocabulary of one particular reference.
  assert.match(markdown, /Decoded reference frames are visual evidence only/);
  assert.match(markdown, /stays untranscribed until a human records it/);
  assert.equal(report.limitations.some(item => /RE\/MAX|word.?wall/i.test(item)), false,
    'no single reference brand text in the shared report');

  const cached = await validateAssets(manifest, { spec, additionalRequirements: [wallCopyRequirement], previous: validation });
  assert.equal(cached.cached, true);
  const changedHash = assetValidationInputHash(structuredClone(manifest).assets[0]);
  assert.notEqual(assetValidationInputHash(manifest), changedHash);
});

test('validation detects hash corruption, incomplete missing lists, origin conflicts and dependency cycles', async () => {
  const fixture = await fixtureAssets();
  const spec = specFixture([{ id: 'brand-remax-logo', type: 'logo', status: 'missing', elementId: 'logo', notes: 'No logo.' }]);
  const manifest = await buildAssetManifest({
    spec, projectAssets: fixture.projectAssets, installedFonts: fixture.installedFonts,
    candidateFaces: fixture.candidateFaces
  });
  const baseline = await validateAssets(manifest, { spec });
  assert.equal(baseline.status, 'blocked');
  const corruptedFile = manifest.assets.find(asset => asset.type === 'image');
  await fs.writeFile(corruptedFile.path, 'corrupted bytes', 'utf8');
  const corrupted = await validateAssets(manifest, { spec });
  assert.equal(corrupted.status, 'invalid');
  assert.ok(corrupted.diagnostics.some(item => item.code === 'HASH_MISMATCH' && item.assetId === corruptedFile.id));

  await writePng(corruptedFile.path, 8, 6);
  const incomplete = structuredClone(manifest);
  incomplete.missing = [];
  const incompleteResult = await validateAssets(incomplete, { spec });
  assert.equal(incompleteResult.status, 'invalid');
  assert.ok(incompleteResult.diagnostics.some(item => item.code === 'MISSING_LIST_INCOMPLETE'));

  const conflict = structuredClone(manifest);
  conflict.assets.find(asset => asset.id === 'brand-remax-logo').origin = 'missing';
  conflict.assets.find(asset => asset.id === 'brand-remax-logo').status = 'valid';
  const conflictResult = await validateAssets(conflict, { spec });
  assert.ok(conflictResult.diagnostics.some(item => item.code === 'ORIGIN_STATUS_CONFLICT'));

  const cyclic = structuredClone(manifest);
  const requirementEntry = cyclic.assets.find(asset => asset.id === 'brand-remax-logo');
  const suppliedEntry = cyclic.assets.find(asset => asset.type === 'image');
  requirementEntry.dependencies = [suppliedEntry.id];
  suppliedEntry.dependencies = [requirementEntry.id];
  const cycleResult = await validateAssets(cyclic, { spec });
  assert.ok(cycleResult.diagnostics.some(item => item.code === 'DEPENDENCY_CYCLE'));

  const moved = structuredClone(manifest);
  moved.sourceHash = 'b'.repeat(64);
  const movedResult = await validateAssets(moved, { spec });
  assert.ok(movedResult.diagnostics.some(item => item.code === 'SOURCE_MISMATCH'));
});

test('a valid manifest with confirmed review and no unmet requirements is build-ready', async () => {
  const directory = path.join(root, 'valid-manifest');
  const logo = path.join(directory, 'logo.png');
  await writePng(logo, 4, 3);
  const manifest = {
    schemaVersion: 1, sourceHash,
    assets: [{
      id: 'supplied-logo', type: 'image', path: logo.replaceAll('\\', '/'), sha256: await hashFile(logo),
      width: 4, height: 3, fontFamily: null, fontStyle: null,
      provenance: 'fixture', licenseStatus: 'unresolved', origin: 'supplied',
      intendedUse: 'fixture', dependencies: [], status: 'valid'
    }],
    missing: [], review: { status: 'confirmed', notes: 'fixture review' }
  };
  const validation = await validateAssets(manifest);
  assert.equal(validation.status, 'valid');
  assert.equal(validation.buildReady, true);
  const spec = specFixture([]);
  const withSpec = await validateAssets(manifest, { spec });
  assert.equal(withSpec.status, 'valid', 'extra supplied assets do not block an otherwise valid manifest');
});

test('explicit assignment can satisfy a requirement, while unapproved assignments remain unresolved', async () => {
  const fixture = await fixtureAssets();
  const spec = specFixture([{ id: 'brand-remax-logo', type: 'logo', status: 'missing', elementId: 'logo', notes: 'No logo supplied at analysis time.' }]);
  const supplied = fixture.projectAssets.find(asset => asset.type === 'image');
  const approved = await buildAssetManifest({
    spec, projectAssets: fixture.projectAssets, installedFonts: fixture.installedFonts,
    candidateFaces: fixture.candidateFaces,
    assignments: { 'brand-remax-logo': { assetId: supplied.id, approved: true, notes: 'fixture approval' } },
    review: { status: 'confirmed', notes: 'manifest reviewed' }
  });
  const approvedEntry = approved.assets.find(asset => asset.id === 'brand-remax-logo');
  assert.equal(approvedEntry.status, 'valid');
  assert.equal(approvedEntry.origin, 'supplied');
  assert.equal(approvedEntry.path, supplied.path);
  assert.deepEqual(approved.missing, []);
  const validation = await validateAssets(approved, { spec });
  assert.equal(validation.status, 'valid');
  assert.equal(validation.buildReady, true);

  const unapproved = await buildAssetManifest({
    spec, projectAssets: fixture.projectAssets, installedFonts: fixture.installedFonts,
    candidateFaces: fixture.candidateFaces,
    assignments: { 'brand-remax-logo': { assetId: supplied.id } }
  });
  const unapprovedEntry = unapproved.assets.find(asset => asset.id === 'brand-remax-logo');
  assert.equal(unapprovedEntry.status, 'missing');
  assert.equal(unapprovedEntry.path, null);
  assert.ok(unapprovedEntry.dependencies.includes(supplied.id));
  assert.match(unapprovedEntry.provenance, /not approved/);
  assert.ok(unapproved.missing.includes('brand-remax-logo'));

  await assert.rejects(buildAssetManifest({
    spec, projectAssets: fixture.projectAssets, installedFonts: fixture.installedFonts,
    candidateFaces: fixture.candidateFaces,
    assignments: { 'brand-remax-logo': { assetId: 'not-a-file' } }
  }), { code: 'ASSET_ASSIGNMENT_UNKNOWN_ASSET' });
});

test('asset registration is resumable, cached by hashes, and writes versioned artifacts', async () => {
  const fixture = await fixtureAssets({ withLogo: false });
  const job = path.join(root, 'job');
  const specPath = path.join(job, 'analysis', 'key', 'run', 'shot-spec.json');
  const spec = specFixture([
    { id: 'font-sans-headline', type: 'font', status: 'unresolved', notes: 'Exact sans unverified.' }
  ], { elements: [logoElement, wallElement] });
  await fs.mkdir(path.dirname(specPath), { recursive: true });
  await fs.writeFile(specPath, `${JSON.stringify(spec)}\n`);
  const options = {
    assetsDirectory: path.join(job, 'assets-src'),
    installedFonts: fixture.installedFonts,
    candidateFaces: fixture.candidateFaces,
    additionalRequirements: [wallCopyRequirement],
    searchNotes: 'Fixture search note.'
  };
  const first = await registerAssets(specPath, options);
  assert.equal(first.cached, false);
  assert.equal(first.version, ASSET_VERSION);
  assert.equal(first.validation.status, 'blocked');
  const manifest = await readJson(first.manifestPath);
  await validateArtifact('asset-manifest', manifest);
  assert.equal(manifest.assets.find(asset => asset.id === 'shot-002-wall-copy').elementId, undefined);
  assert.ok(manifest.review.notes.includes('Fixture search note.'));
  await fs.access(first.reportPath);
  await fs.access(first.markdownPath);
  const second = await registerAssets(specPath, options);
  assert.equal(second.cached, true);
  assert.equal(second.validation.cached, true);
  assert.equal(second.manifestPath, first.manifestPath);
  assert.deepEqual(second.validation.counts, first.validation.counts);
});
