import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { ingest } from '../../src/ingest/media.mjs';
import { analyzeReference, measureRaster, maskBounds, draftSpecification, validateSpecification, importSpecificationReview } from '../../src/ingest/analysis.mjs';
import { hashObject, hashFile, readJson, runProcess, validateArtifact } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'analysis-'));

function image(width, height, paint) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, rgba = paint(x, y);
    png.data[at] = rgba[0]; png.data[at + 1] = rgba[1]; png.data[at + 2] = rgba[2]; png.data[at + 3] = rgba[3] ?? 255;
  }
  return png;
}

test('raster measurements report exact modal RGB and threshold pixel bounds', () => {
  const png = image(10, 10, (x, y) => x >= 2 && x < 7 && y >= 3 && y < 6 ? [255, 255, 255] : [18, 40, 200]);
  const measured = measureRaster(png);
  assert.equal(measured.dominantColor, '#1228c8');
  assert.equal(measured.palette[0].pixels, 85);
  assert.deepEqual(measured.lightForeground.pixelBounds, { left: 2, top: 3, rightExclusive: 7, bottomExclusive: 6 });
  assert.deepEqual(measured.lightForeground.bbox, { x: 0.2, y: 0.3, width: 0.5, height: 0.3 });
  assert.deepEqual(measured.darkForeground.pixelBounds ?? null, null);
  assert.equal(measured.foreground.pixels, 15, 'foreground excludes the modal background itself');
});

test('mask bounds exclude transparent pixels and return null when empty', () => {
  const png = image(4, 4, (x, y) => (x === 3 && y === 3 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  assert.deepEqual(maskBounds(png, (r, g, b) => r > 200).pixelBounds, { left: 3, top: 3, rightExclusive: 4, bottomExclusive: 4 });
  assert.equal(maskBounds(png, () => false).bbox, null);
  assert.throws(() => measureRaster(image(2, 2, () => [0, 0, 0, 0])), { code: 'IMAGE_EMPTY' });
});

function metadataFixture() {
  const fps = { num: 24, den: 1 };
  return { schemaVersion: 1, sourceHash: 'a'.repeat(64), source: { path: 'C:/fixture.mp4', sha256: 'a'.repeat(64), sizeBytes: 1 },
    video: { codec: 'h264', container: 'mp4', width: 100, height: 50, durationSeconds: 1, fps, rFrameRate: '24/1', avgFrameRate: '24/1', timeBase: '1/24', frameCount: 24, rotationDegrees: 0, vfr: { detected: false, reason: 'fixture' } },
    audio: { present: false, streams: [] }, tools: { ffmpeg: 'test', ffprobe: 'test' },
    frameTimeline: Array.from({ length: 24 }, (_, index) => ({ index, ptsSeconds: index / 24, durationSeconds: 1 / 24 })) };
}
const boundariesFixture = sourceHash => ({ schemaVersion: 1, sourceHash, fps: { num: 24, den: 1 }, durationSeconds: 1, totalFrames: 24,
  detector: { name: 'fixture', threshold: 0.1, minShotFrames: 2 }, candidates: [], review: { status: 'confirmed', notes: 'fixture reviewed' },
  shots: [{ id: 'shot-001', startFrame: 0, endFrameExclusive: 12, startSeconds: 0, endSeconds: 0.5 }, { id: 'shot-002', startFrame: 12, endFrameExclusive: 24, startSeconds: 0.5, endSeconds: 1 }] });

test('draft specification is explicitly unresolved and measured, not a rebuilt scene', async () => {
  const metadata = metadataFixture(), boundaries = boundariesFixture(metadata.sourceHash);
  const observations = { schemaVersion: 1, sourceHash: metadata.sourceHash, methodVersion: 'test', frames: [0, 6, 12, 18].map(frame => ({
    frame, timeSeconds: frame / 24, path: `C:/fixture/${frame}.png`, sha256: 'b'.repeat(64),
    measurement: { width: 100, height: 50, palette: [{ color: '#112233', pixels: 4900, fraction: 0.98 }], dominantColor: '#112233',
      foreground: { pixels: 0, bbox: null, pixelBounds: null }, lightForeground: { pixels: 0, bbox: null, pixelBounds: null }, darkForeground: { pixels: 0, bbox: null, pixelBounds: null }, method: 'fixture' } })) };
  const spec = draftSpecification(metadata, boundaries, observations);
  await validateArtifact('shot-spec', spec);
  assert.equal(spec.shots.length, 2); assert.equal(spec.shots[0].elements[0].color, '#112233');
  assert.equal(spec.shots[0].elements[0].evidence.status, 'tool_estimate');
  assert.equal(spec.shots[0].transition.type, 'unresolved');
  assert.equal(spec.review.status, 'pending');
  assert.deepEqual(spec.transformations, []);
  assert.deepEqual([spec.shots[0].startSeconds, spec.shots[0].endSeconds, spec.shots[0].durationSeconds], [0, 0.5, 0.5]);
  assert.deepEqual(spec.shots[0].requiredAssets, []);
  const check = await validateSpecification(spec, metadata, boundaries);
  assert.equal(check.ready, false);
  assert.equal(check.readyForAssetValidation, false, 'unresolved transitions block even asset validation');
  assert.ok(check.diagnostics.some(d => /review is pending/.test(d.message)));
  assert.ok(check.diagnostics.some(d => d.code === 'TRANSITION_UNRESOLVED' && d.blocking === true));
  assert.ok(check.diagnostics.some(d => d.code === 'REVIEW_PENDING' && d.blocking === true));
  const mismatched = structuredClone(boundaries); mismatched.shots[0].startFrame = 1;
  await assert.rejects(validateSpecification(spec, metadata, mismatched), { code: 'SHOT_COVERAGE' });
  const retimed = structuredClone(spec); retimed.shots[0].durationSeconds = 0.6;
  await assert.rejects(validateSpecification(retimed, metadata, boundaries), { code: 'SHOT_TIME_MISMATCH' });
});

test('unresolved typography is advisory for asset validation but blocks build readiness', async () => {
  const metadata = metadataFixture(), boundaries = boundariesFixture(metadata.sourceHash);
  const observations = { schemaVersion: 1, sourceHash: metadata.sourceHash, methodVersion: 'test', frames: [0, 12].map(frame => ({
    frame, timeSeconds: frame / 24, path: `C:/fixture/${frame}.png`, sha256: 'b'.repeat(64),
    measurement: { width: 100, height: 50, palette: [{ color: '#112233', pixels: 4900, fraction: 0.98 }], dominantColor: '#112233',
      foreground: { pixels: 0, bbox: null, pixelBounds: null }, lightForeground: { pixels: 0, bbox: null, pixelBounds: null }, darkForeground: { pixels: 0, bbox: null, pixelBounds: null }, method: 'fixture' } })) };
  const spec = draftSpecification(metadata, boundaries, observations);
  spec.review = { status: 'confirmed', notes: 'reviewed fixture' };
  for (const shot of spec.shots) {
    shot.transition = { type: 'cut', durationFrames: 0, evidence: { status: 'human_confirmed', method: 'fixture', frames: [shot.startFrame], confidence: 1, notes: 'fixture cut' } };
    shot.unresolved = [];
    shot.elements.push({ id: `${shot.id}-headline`, type: 'text', role: 'headline', copy: 'Fixture', bbox: { x: 0.1, y: 0.4, width: 0.5, height: 0.1 },
      color: '#112233', font: { family: null, style: null, sizePx: null }, assetId: null, states: [], unresolved: ['Exact font unverified.'],
      evidence: { status: 'tool_estimate', method: 'fixture mask', frames: [shot.startFrame], confidence: 0.5, notes: 'fixture' } });
    shot.requiredAssets.push({ id: `${shot.id}-headline-font`, type: 'font', status: 'unresolved', elementId: `${shot.id}-headline`, notes: 'Fixture font requirement.' });
  }
  const check = await validateSpecification(spec, metadata, boundaries);
  assert.equal(check.ready, false, 'unverified typography still blocks the build gate');
  assert.equal(check.readyForAssetValidation, true, 'asset validation may proceed while fonts are resolved');
  assert.ok(check.diagnostics.every(d => d.blocking === false));
  assert.ok(check.diagnostics.some(d => d.code === 'TYPOGRAPHY_UNRESOLVED'));
  assert.ok(check.diagnostics.filter(d => d.code === 'ASSET_REQUIREMENT_OPEN').length === 2);
});

test('review import is bound to exact base and cannot authorize silent copy changes', async () => {
  const metadata = metadataFixture(), boundaries = boundariesFixture(metadata.sourceHash);
  const observations = { schemaVersion: 1, sourceHash: metadata.sourceHash, methodVersion: 'test', frames: [0, 12].map(frame => ({
    frame, timeSeconds: frame / 24, path: `C:/fixture/${frame}.png`, sha256: 'b'.repeat(64),
    measurement: { width: 100, height: 50, palette: [{ color: '#112233', pixels: 4900, fraction: 0.98 }], dominantColor: '#112233',
      foreground: { pixels: 0, bbox: null, pixelBounds: null }, lightForeground: { pixels: 0, bbox: null, pixelBounds: null }, darkForeground: { pixels: 0, bbox: null, pixelBounds: null }, method: 'fixture' } })) };
  const base = draftSpecification(metadata, boundaries, observations), baseHash = hashObject(base);
  const reviewed = structuredClone(base);
  reviewed.shots[0].elements[0].color = '#112234';
  assert.equal(importSpecificationReview(base, { sourceHash: base.sourceHash, baseHash, reviewer: 'test', notes: 'corrected pixel role', spec: reviewed }).shots[0].elements[0].color, '#112234');
  reviewed.transformations = [{ id: 'change', shotId: null, elementId: null, property: 'copy', sourceValue: 'You', targetValue: 'X', reason: 'unapproved', review: { status: 'confirmed', notes: 'fixture' },
    evidence: { status: 'human_confirmed', method: 'fixture', frames: [0], confidence: 1, notes: 'fixture' } }];
  assert.throws(() => importSpecificationReview(base, { sourceHash: base.sourceHash, baseHash, reviewer: 'test', notes: 'sneaks content change', spec: reviewed }), { code: 'TRANSFORMATION_APPROVAL_REQUIRED' });
  assert.throws(() => importSpecificationReview(base, { sourceHash: base.sourceHash, baseHash: 'c'.repeat(64), reviewer: 'test', notes: 'stale', spec: reviewed }), { code: 'REVIEW_INVALID' });
});

let ingestIndex;
async function realIngest() {
  if (ingestIndex) return ingestIndex;
  const frames = path.join(root, 'source'); await fs.mkdir(frames);
  for (let n = 0; n < 8; n++) {
    const png = image(96, 54, (x, y) => {
      const background = n < 4 ? [240, 238, 235] : [20, 35, 100];
      return x > 12 + n * 4 && x <= 20 + n * 4 && y >= 20 && y < 30 ? [250, 245, 40] : background;
    });
    await fs.writeFile(path.join(frames, `f-${String(n).padStart(3, '0')}.png`), PNG.sync.write(png), { flag: 'wx' });
  }
  const video = path.join(root, 'reference.mp4');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-framerate', '24', '-i', path.join(frames, 'f-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const result = await ingest(video, { jobsDirectory: path.join(root, 'jobs'), ingestion: { sampleIntervalFrames: 1, minShotFrames: 2 } });
  ingestIndex = result.indexPath;
  return ingestIndex;
}

test('real ingestion feeds measured analysis, report, cache and validation', { timeout: 120000 }, async () => {
  const indexPath = await realIngest();
  const result = await analyzeReference(indexPath);
  assert.equal(result.cached, false);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.validation.ready, false);
  const observations = await readJson(result.observationsPath);
  assert.equal(observations.frames.length, 8);
  for (const frame of observations.frames) {
    assert.match(frame.measurement.dominantColor, /^#[0-9a-f]{6}$/);
    assert.ok(frame.measurement.foreground.pixels > 0);
  }
  const html = await fs.readFile(result.reportPath, 'utf8');
  assert.match(html, /Needs review/); assert.match(html, /data:image\/png;base64/);
  const spec = await readJson(result.shotSpecPath);
  await validateArtifact('shot-spec', spec);
  assert.equal(spec.shots.length, 2);
  const again = await analyzeReference(indexPath);
  assert.equal(again.cached, true); assert.equal(again.runDirectory, result.runDirectory);
  const corrupt = (await readJson(indexPath));
  await fs.writeFile(result.reportPath, 'TEST-ONLY corrupted report');
  const third = await analyzeReference(indexPath);
  assert.equal(third.cached, false); assert.notEqual(third.runDirectory, result.runDirectory);
  assert.equal(await fs.readFile(result.reportPath, 'utf8'), 'TEST-ONLY corrupted report');
  assert.equal((await readJson(indexPath)).key, corrupt.key);
});

test('reviewed measured copy still requires exact semantic approval', { timeout: 120000 }, async () => {
  const indexPath = await realIngest();
  const base = await analyzeReference(indexPath);
  const spec = await readJson(base.shotSpecPath);
  assert.equal(base.baseHash, hashObject(spec));
  for (const shot of spec.shots) {
    shot.elements.length = 0;
    shot.transition = { type: 'cut', durationFrames: 0, evidence: { status: 'human_confirmed', method: 'reviewed synthetic fixture', frames: [shot.startFrame], confidence: 1, notes: 'Instant hard boundary confirmed from adjacent frames.' } };
    shot.unresolved = [];
  }
  spec.review = { status: 'confirmed', notes: 'Reviewed synthetic raster fixture; no text exists in it.' };
  for (const shot of spec.shots) shot.unresolved = [];
  const review = { sourceHash: spec.sourceHash, baseHash: base.baseHash, reviewer: 'automated review fixture', notes: 'Only boundaries and absence of text were reviewed.', spec };
  const result = await analyzeReference(indexPath, { review });
  assert.equal(result.cached, false);
  assert.equal(result.status, 'needs_review', 'Boundary review remains pending in ingestion artifact');
  assert.ok(!result.validation.diagnostics.some(d => /transition remains unresolved/.test(d.message)));
});
