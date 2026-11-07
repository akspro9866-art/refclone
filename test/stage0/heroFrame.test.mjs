// Stage0 contract: least-motion hero selection without a t0 bias, fail-closed
// ambiguity rejection, a real lossless FFmpeg fixture inspected end-to-end, and
// hash/seal tamper detection. Inspection must never claim Stage1 before the
// compile-time static batch gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { selectHero, measureSolidScene, measureHeroCandidate, hashJson, hashBytes } from '../../src/stage0/heroFrameDeconstructor.ts';
import { loadInspection } from '../../src/strict/contract.mjs';
import { strictFixture, STRICT_BG, STRICT_FG } from '../helpers/strictFixture.mjs';

function scene(rectX, { width = 32, height = 32, color = STRICT_FG } = {}) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = STRICT_BG[0]; image.data[i * 4 + 1] = STRICT_BG[1]; image.data[i * 4 + 2] = STRICT_BG[2]; image.data[i * 4 + 3] = 255;
  }
  for (let y = 12; y < 20; y++) for (let x = rectX; x < rectX + 8; x++) {
    const i = (y * width + x) * 4;
    image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2];
  }
  return { image };
}

test('selectHero picks the least-motion frame, not frame zero', () => {
  // A still middle frame surrounded by motion: a t0 bias would wrongly pick 0.
  const frames = [scene(4), scene(12), scene(12), scene(12), scene(20)];
  const hero = selectHero(frames);
  assert.equal(hero.index, 2, 'the zero-motion middle frame is the hero');
  assert.ok(hero.motion < selectHero([scene(4), scene(12), scene(20), scene(28)]).motion);
});

test('selectHero skips an ambiguous frame and blocks when none qualify', () => {
  const gradient = { image: new PNG({ width: 32, height: 32 }) };
  for (let i = 0; i < 32 * 32; i++) {
    gradient.image.data[i * 4] = i % 256; gradient.image.data[i * 4 + 1] = (i * 7) % 256; gradient.image.data[i * 4 + 2] = (i * 13) % 256; gradient.image.data[i * 4 + 3] = 255;
  }
  // Frame zero is an unmeasurable gradient; the solid frames still win.
  const hero = selectHero([gradient, scene(12), scene(12), scene(12)]);
  assert.ok(hero.index >= 1, 'an ambiguous frame is never the hero');
  assert.throws(() => selectHero([gradient, gradient, gradient, gradient]), /STAGE0_NO_UNOCCLUDED_SOLID_HERO/);
  assert.throws(() => selectHero([scene(4), scene(8)]), /STAGE0_FRAME_BUDGET/);
});

test('measureSolidScene rejects overlap/L-shapes, gradients and transparent pixels', () => {
  // An L-shaped region has count != bounding-box area: carve the top-right
  // out of the solid 8x8 rectangle (x 8..15, y 12..19).
  const l = scene(8);
  for (let y = 12; y < 16; y++) for (let x = 12; x < 16; x++) {
    const i = (y * 32 + x) * 4; l.image.data[i] = STRICT_BG[0]; l.image.data[i + 1] = STRICT_BG[1]; l.image.data[i + 2] = STRICT_BG[2];
  }
  assert.throws(() => measureSolidScene(l.image), /STAGE0_AMBIGUOUS_SHAPE/);
  const transparent = scene(8); transparent.image.data[3] = 0;
  assert.throws(() => measureSolidScene(transparent.image), /STAGE0_AMBIGUOUS_ALPHA/);
  // Border pixel changed away from background => occluded/non-uniform border.
  const border = scene(8); border.image.data[0] = 200; border.image.data[1] = 200; border.image.data[2] = 200;
  assert.throws(() => measureSolidScene(border.image), /STAGE0_OCCLUDED_OR_NONUNIFORM_BORDER/);
  assert.throws(() => measureSolidScene(new PNG({ width: 4, height: 4 })), /STAGE0_DIMENSIONS/);
});

test('measureHeroCandidate reports a local static gate and no Stage1 claim', () => {
  const frames = [scene(8), scene(10), scene(12), scene(14)];
  const candidate = measureHeroCandidate(frames);
  assert.equal(candidate.stage1Ran, false);
  assert.equal(candidate.stage1Status, 'pending-static-batch-gate');
  assert.equal(candidate.staticScene, null);
  assert.equal(candidate.detectedBeats, null);
  assert.equal(candidate.layerTrajectories, null);
  assert.ok(candidate.heroSsim >= 0.99, 'independent reconstruction passes the local gate');
  assert.equal(candidate.layers.length, 1);
  assert.ok(candidate.reconstruction, 'a real raster is produced');
});

test('a real lossless FFmpeg clip inspects with pending Stage1 and required fields', async () => {
  const { inspection } = await strictFixture();
  assert.equal(inspection.ok, true);
  assert.equal(inspection.status, 'inspected');
  assert.equal(inspection.stage1Ran, false);
  assert.equal(inspection.stage1Status, 'pending-static-batch-gate');
  assert.deepEqual(inspection.recommendedPresetPacks, []);
  assert.equal(inspection.detectedBeats, null);
  assert.equal(inspection.layerTrajectories, null);
  assert.equal(inspection.staticScene, null);
  assert.ok(inspection.heroFrameSpec, 'hero spec carries real measured info');
  assert.ok(Number.isInteger(inspection.heroFrameSpec.frame));
  assert.match(inspection.heroFrameSpec.sha256, /^[a-f0-9]{64}$/);
  assert.ok(inspection.heroFrameSpec.ssim >= 0.99);
  assert.equal(inspection.heroFrameSpec.layers.length, 1);
  assert.deepEqual(inspection.heroFrameSpec.background, STRICT_BG);
  assert.equal(inspection.layers[0].rig, null, 'rig is pending, never guessed');
  assert.deepEqual(inspection.tokens, { local: 0, stage2Caller: null });

  // The sealed artifact stores only the candidate static measurement.
  const artifact = JSON.parse(await fs.readFile(inspection.inspectionPath, 'utf8'));
  assert.equal(artifact.measurements.stage1Ran, false);
  assert.equal(artifact.measurements.layerTrajectories, null);
  assert.ok(artifact.frames.length >= 4);
  const loaded = await loadInspection(inspection.inspectionPath);
  assert.equal(loaded.candidate.heroFrame, artifact.measurements.heroFrame);
});

test('tampering with sealed pixels, measurements or the seal is rejected', async () => {
  const { inspection, directory } = await strictFixture();
  const artifact = JSON.parse(await fs.readFile(inspection.inspectionPath, 'utf8'));

  // 1. Corrupt one hashed frame PNG.
  const framePath = artifact.frames[0].path;
  const original = await fs.readFile(framePath);
  await fs.writeFile(framePath, Buffer.concat([original, Buffer.from([0])]));
  await assert.rejects(() => loadInspection(inspection.inspectionPath), /INSPECTION_HASH_MISMATCH/);
  await fs.writeFile(framePath, original);

  // 2. Re-seal a tampered measurement under its own valid hash filename.
  const tampered = structuredClone(artifact);
  tampered.measurements.heroFrame = (tampered.measurements.heroFrame + 1) % tampered.frames.length;
  const tamperedPath = path.join(directory, `inspection-${hashJson(tampered)}.json`);
  await fs.writeFile(tamperedPath, JSON.stringify(tampered, null, 2) + '\n', { flag: 'wx' });
  await assert.rejects(() => loadInspection(tamperedPath), /INSPECTION_MEASUREMENTS_CHANGED_OR_HERO_UNLOCKED/);

  // 3. A renamed (unsealed) inspection file is rejected.
  const renamed = path.join(directory, 'inspection-not-the-seal.json');
  await fs.writeFile(renamed, JSON.stringify(artifact), { flag: 'wx' });
  await assert.rejects(() => loadInspection(renamed), /INSPECTION_SEAL_MISMATCH/);

  // 4. The hero reconstruction raster is hash-bound too.
  const heroOriginal = await fs.readFile(artifact.heroRaster.path);
  await fs.writeFile(artifact.heroRaster.path, Buffer.concat([heroOriginal, Buffer.from([0])]));
  await assert.rejects(() => loadInspection(inspection.inspectionPath), /INSPECTION_HASH_MISMATCH/);
  await fs.writeFile(artifact.heroRaster.path, heroOriginal);

  // The untouched inspection still loads.
  assert.ok(await loadInspection(inspection.inspectionPath));
  assert.match(hashBytes(original), /^[a-f0-9]{64}$/);
});