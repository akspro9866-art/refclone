// Band-tracking measurement tests.
//
// Every frame here is authored by the test with a linear box filter, so the intended
// sub-pixel position is known analytically and a measured dx can be compared against
// it rather than against a plausible-looking number. This is the only way to prove the
// claim the module makes: that a 1/8 px shift is a measurement, not a rounding artefact.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  DEFAULT_BAND_OPTIONS, findGaps, findRowBands, frameOf, gapEdges, inkField, lineProfile, measureBand,
  nccAt, resample, rowInk, trackAnchor, trackBands, trackProfile
} from '../src/stages/bandTracking.mjs';

const BG = [44, 85, 212];
const INK = [255, 255, 255];
// max |channel - background| for pure ink over BG: |255-44| = 211.
const FULL_WEIGHT = 211 / 255;

/** Rasterize a white box at a float position with a 1px linear coverage filter. */
function blockFrame({ width = 64, height = 24, blocks = [] }) {
  const png = new PNG({ width, height });
  for (let at = 0; at < png.data.length; at += 4) {
    png.data[at] = BG[0]; png.data[at + 1] = BG[1]; png.data[at + 2] = BG[2]; png.data[at + 3] = 255;
  }
  for (const block of blocks) {
    const { x, y, w, h } = block;
    for (let row = Math.floor(y) - 1; row <= Math.ceil(y + h) + 1; row += 1) {
      if (row < 0 || row >= height) continue;
      const coverageY = Math.min(1, Math.max(0, Math.min(y + h, row + 1) - Math.max(y, row)));
      for (let col = Math.floor(x) - 1; col <= Math.ceil(x + w) + 1; col += 1) {
        if (col < 0 || col >= width) continue;
        const coverageX = Math.min(1, Math.max(0, Math.min(x + w, col + 1) - Math.max(x, col)));
        const coverage = coverageX * coverageY;
        if (coverage <= 0) continue;
        const at = (row * width + col) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          png.data[at + channel] = Math.round(BG[channel] + (INK[channel] - BG[channel]) * coverage);
        }
      }
    }
  }
  return png;
}

const profileOf = (png, bandStart, bandEnd) => lineProfile(inkField(png), {
  width: png.width,
  height: png.height,
  axis: 'x',
  bandStart,
  bandEnd
}).profile;

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'refclone-bands-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeFrames(directory, pictures) {
  await fs.mkdir(directory, { recursive: true });
  const files = [];
  for (let index = 0; index < pictures.length; index += 1) {
    const file = path.join(directory, `f-${String(index).padStart(6, '0')}.png`);
    await fs.writeFile(file, PNG.sync.write(pictures[index]));
    files.push(file);
  }
  return files;
}

test('the ink field is linear in edge coverage, which is what makes sub-pixel real', () => {
  const field = inkField(blockFrame({ blocks: [{ x: 10, y: 4, w: 8, h: 6 }] }), {});
  const { width } = { width: 64 };
  const solid = field[8 * width + 14];
  assert.ok(Math.abs(solid - FULL_WEIGHT) < 1e-9, `a fully covered pixel weighs 211/255, got ${solid}`);
  assert.equal(field[8 * width + 9], 0, 'background far from the block weighs nothing');
  // An integer-aligned block has hard edges: column 17 is the last covered column and
  // column 18 weighs nothing. Nothing sub-pixel exists to be measured here, which is
  // exactly why the fractional cases below carry the claim.
  assert.ok(Math.abs(field[8 * width + 17] - FULL_WEIGHT) < 1e-9, 'the last column of the block is fully covered');
  assert.equal(field[8 * width + 18], 0, 'one past the block is background again');
  // A quarter-pixel overhang weighs a quarter, and the complementary column weighs the
  // rest: weight is proportional to coverage, so the profile encodes the edge position.
  const quarter = inkField(blockFrame({ blocks: [{ x: 10.25, y: 4, w: 8, h: 6 }] }), {});
  assert.ok(Math.abs(quarter[8 * width + 18] - FULL_WEIGHT * 0.25) < 0.01, `a 25% column weighs 25%, got ${quarter[8 * width + 18]}`);
  assert.ok(Math.abs(quarter[8 * width + 10] - FULL_WEIGHT * 0.75) < 0.01, `the complementary 75% column weighs 75%, got ${quarter[8 * width + 10]}`);
  const shifted = inkField(blockFrame({ blocks: [{ x: 10.5, y: 4, w: 8, h: 6 }] }), {});
  assert.ok(Math.abs(shifted[8 * width + 11] - FULL_WEIGHT) < 1e-9, 'the column inside a half-shifted block is fully covered');
  assert.ok(Math.abs(shifted[8 * width + 10] - FULL_WEIGHT / 2) < 0.02, `a 50% covered column weighs half, got ${shifted[8 * width + 10]}`);
  assert.throws(() => inkField(blockFrame({}), { background: 'nope' }), /#rrggbb/);
});

test('profiles sum across a band and keep the coordinate origin', () => {
  const png = blockFrame({ width: 64, height: 24, blocks: [{ x: 10, y: 4, w: 8, h: 6 }] });
  const field = inkField(png, {});
  const full = lineProfile(field, { width: 64, height: 24, bandStart: 4, bandEnd: 10 });
  assert.equal(full.origin, 0);
  assert.equal(full.profile.length, 64);
  assert.ok(Math.abs(full.profile[14] - 6 * FULL_WEIGHT) < 0.01, `six covered rows, got ${full.profile[14]}`);
  assert.equal(full.profile[30], 0);
  const cropped = lineProfile(field, { width: 64, height: 24, bandStart: 0, bandEnd: 24, domainStart: 12, domainEnd: 20 });
  assert.deepEqual([cropped.origin, cropped.profile.length], [12, 8]);
  // The block covers columns 10..17, so inside the 12..20 domain the ink stops at
  // index 5 and the last two columns are background — the crop shifted, not the content.
  assert.ok(cropped.profile[0] > 0 && cropped.profile[5] > 0, 'the crop still contains the block');
  assert.deepEqual([cropped.profile[6], cropped.profile[7]], [0, 0], 'and ends where the block ends');
  const vertical = lineProfile(field, { width: 64, height: 24, axis: 'y', bandStart: 10, bandEnd: 18 });
  assert.equal(vertical.profile.length, 24);
  assert.ok(vertical.profile[7] > 0 && vertical.profile[20] === 0);
});

test('band discovery splits text lines and merges within the gap tolerance', () => {
  const png = blockFrame({
    width: 64,
    height: 32,
    blocks: [{ x: 4, y: 4, w: 20, h: 4 }, { x: 8, y: 20, w: 20, h: 4 }]
  });
  const rows = rowInk(inkField(png, {}), { width: 64, height: 32 });
  const bands = findRowBands(rows, { minInk: 1, minGap: 1 });
  assert.deepEqual(bands.map(band => [band.start, band.end]), [[4, 8], [20, 24]]);
  assert.equal(bands[0].id, 'rows-4-8');
  assert.ok(bands[0].ink > 0);
  const merged = findRowBands(rows, { minInk: 1, minGap: 20 });
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].start, merged[0].end], [4, 24]);
  assert.deepEqual(findRowBands(new Float64Array(8), {}), []);
});

test('resampling is exact at integers and linear between them', () => {
  const profile = Float64Array.from([0, 2, 5, 1, 0]);
  const identity = resample(profile, 1);
  assert.deepEqual([...identity], [0, 2, 5, 1, 0]);
  const up = resample(profile, 4);
  assert.equal(up.length, 20);
  assert.equal(up[4], 2, 'sample 4 stands for coordinate 1');
  assert.equal(up[6], 3.5, 'coordinate 1.5 is the midpoint of 2 and 5');
  assert.throws(() => resample(profile, 0), /integer >= 1/);
  assert.deepEqual([...resample(new Float64Array(0), 8)], []);
});

test('the correlation is a true normalized score and follows the declared sign', () => {
  const reference = Float64Array.from([0, 0, 1, 4, 6, 6, 4, 1, 0, 0, 0, 0]);
  const same = nccAt(reference, reference, 0);
  assert.ok(Math.abs(same.score - 1) < 1e-9);
  const scaled = nccAt(reference, resample(reference.map(value => value * 3), 1), 0);
  assert.ok(Math.abs(scaled.score - 1) < 1e-9, 'a per-frame brightness change cannot move the peak');
  const shifted = resample(Float64Array.from([0, 0, 0, 0, 1, 4, 6, 6, 4, 1, 0, 0]), 1);
  // Shifting by 3 walks the last three reference columns off the end of the target, and
  // they are excluded from the sums rather than scored as zeroes.
  assert.equal(nccAt(reference, shifted, 3 * 1).samples, 9, 'only the overlap is scored');
  assert.ok(nccAt(reference, reference, 0, { minSamples: 200 }).score === -Infinity, 'too little overlap is refused');
  assert.ok(nccAt(reference, Float64Array.from(reference).fill(2), 0).score === -Infinity, 'a flat target has no correlation');
});

test('a half-pixel translation is measured as a half pixel, not as zero or one', () => {
  const bandStart = 4;
  const bandEnd = 10;
  for (const offset of [0, 0.25, 0.5, 0.75, 1, 3, 6.5]) {
    const reference = profileOf(blockFrame({ blocks: [{ x: 10, y: bandStart, w: 8, h: 6 }] }), bandStart, bandEnd);
    const target = profileOf(blockFrame({ blocks: [{ x: 10 + offset, y: bandStart, w: 8, h: 6 }] }), bandStart, bandEnd);
    const result = trackProfile(reference, target, { rangePx: 8, upsample: 8 });
    assert.equal(result.reason, null, `offset ${offset} failed: ${result.reason}`);
    assert.ok(Math.abs(result.dxPx - offset) <= 0.125 + 1 / 16, `offset ${offset} measured ${result.dxPx}`);
    assert.ok(result.score > 0.9, `offset ${offset} scored ${result.score}`);
    assert.equal(result.quantumPx, 0.125);
  }
});

test('leftward motion is negative and the range is respected', () => {
  const reference = profileOf(blockFrame({ blocks: [{ x: 20, y: 4, w: 8, h: 6 }] }), 4, 10);
  const target = profileOf(blockFrame({ blocks: [{ x: 16, y: 4, w: 8, h: 6 }] }), 4, 10);
  assert.equal(trackProfile(reference, target, { rangePx: 8, upsample: 8 }).dxPx, -4);
  const far = profileOf(blockFrame({ blocks: [{ x: 40, y: 4, w: 8, h: 6 }] }), 4, 10);
  const clamped = trackProfile(reference, far, { rangePx: 8, upsample: 8 });
  assert.ok(Math.abs(clamped.dxPx) <= 8.0001, `a shift outside the range is reported at the edge, got ${clamped.dxPx}`);
  assert.ok(clamped.marginPx === null || clamped.marginPx >= 0);
});

test('an unmatchable reference is refused rather than answered', () => {
  const blank = new Float64Array(64);
  const other = profileOf(blockFrame({ blocks: [{ x: 10, y: 4, w: 8, h: 6 }] }), 4, 10);
  assert.equal(trackProfile(blank, other, {}).reason, 'flat-reference');
  // A blank target carries no variance at any shift, so every score is undefined. The
  // honest answer is "nothing was measured", not the zero that would read as "no motion".
  const blankTarget = trackProfile(other, blank, { rangePx: 8 });
  assert.equal(blankTarget.reason, 'no-overlap');
  assert.equal(blankTarget.dxPx, null);
  assert.equal(trackProfile(new Float64Array(0), new Float64Array(0), {}).reason, 'empty-profile');
  // A refusal names the shapes it saw, so the log says why without another measurement.
  assert.match(trackProfile(other, other.slice(0, 20), {}).reason, /^profile-length-mismatch \(64 vs 20\)$/);
});

test('word gaps are found by emptiness, not by colour', () => {
  const png = blockFrame({
    width: 96,
    height: 24,
    blocks: [{ x: 4, y: 4, w: 10, h: 6 }, { x: 30, y: 4, w: 14, h: 6 }, { x: 70, y: 4, w: 8, h: 6 }]
  });
  const profile = profileOf(png, 4, 10);
  const gaps = findGaps(profile, { minWidth: 6, gapWeight: DEFAULT_BAND_OPTIONS.gapWeight });
  assert.deepEqual(gaps.map(gap => [gap.left, gap.right]), [[14, 30], [44, 70]]);
  assert.deepEqual(gaps.map(gap => gap.width), [16, 26]);
  assert.ok(findGaps(profile, { minWidth: 2, gapWeight: 0 }).length >= gaps.length);
  const noGaps = Float64Array.from({ length: 20 }, () => 5);
  assert.deepEqual(findGaps(noGaps, { minWidth: 2 }), []);
  assert.deepEqual(findGaps(Float64Array.from([5, 0, 0, 0, 5]), { minWidth: 2 }).length, 1);
});

test('anchors of a rigidly moved band agree, and a moved word breaks them', async t => {
  const directory = await temporaryDirectory(t);
  const layout = [
    { x: 4, y: 4, w: 10, h: 6 },
    { x: 30, y: 4, w: 14, h: 6 },
    { x: 70, y: 4, w: 8, h: 6 }
  ];
  const rigid = await writeFrames(directory, [0, 1, 2].map(index => blockFrame({
    width: 96,
    height: 24,
    blocks: layout.map(block => ({ ...block, x: block.x + index * 1.5 }))
  })));
  const report = await trackBands(rigid, {
    frameDirectory: directory,
    bands: [{ id: 'line', start: 4, end: 10 }],
    rangePx: 8,
    upsample: 8,
    minGapPx: 6
  });
  const band = report.bands[0];
  assert.equal(band.gapCount, 2);
  assert.deepEqual(band.gaps.map(gap => [gap.leftX, gap.rightX]), [[14, 30], [44, 70]]);
  assert.equal(band.series[2].dxPx, 3);
  // Two gaps, both edges of each: four anchors, all reading the same translation.
  assert.deepEqual(band.series[2].anchors.map(anchor => anchor.id),
    ['gap-0-left', 'gap-0-right', 'gap-1-left', 'gap-1-right']);
  assert.deepEqual(band.series[2].anchors.map(anchor => anchor.dxPx), [3, 3, 3, 3]);
  assert.equal(band.series[2].anchorSpreadPx, 0);
  assert.equal(band.series[2].maxGapWidthDeltaPx, 0, 'the space between words did not change');
  assert.equal(report.summary.rigidBands, 1);
  assert.equal(report.summary.nonRigidBands, 0);
  assert.deepEqual(report.summary.reflowingBands, []);
  assert.equal(report.summary.maxDisplacementPx, 3);
  // One word slides on its own: the anchors disagree, and the gap that separates it from
  // its neighbour changes width. That is the evidence that no single translation — and
  // therefore no single set of position keys — describes this band.
  const partial = await writeFrames(path.join(directory, 'partial'), [0, 1].map(index => blockFrame({
    width: 96,
    height: 24,
    blocks: layout.map((block, which) => ({ ...block, x: block.x + (which === 1 ? index * 6 : 0) }))
  })));
  const split = await trackBands(partial, {
    bands: [{ id: 'line', start: 4, end: 10 }], rangePx: 8, upsample: 8, minGapPx: 6
  });
  const moved = split.bands[0];
  const last = moved.series[1].anchors;
  assert.deepEqual(last.map(anchor => anchor.dxPx), [0, 6, 6, 0], 'the neighbours of the moved word stay, its own edges go');
  assert.equal(moved.maxAnchorSpreadPx, 6, `anchors disagree, spread ${moved.maxAnchorSpreadPx}`);
  assert.equal(moved.maxGapWidthDeltaPx, 6, 'both adjacent gaps change width');
  assert.equal(split.summary.nonRigidBands, 1);
  assert.deepEqual(split.summary.reflowingBands, ['line']);
});

test('anchor windows and band-level measurement share one coordinate system', () => {
  const png = blockFrame({
    width: 96,
    height: 24,
    blocks: [{ x: 4, y: 4, w: 10, h: 6 }, { x: 30, y: 4, w: 14, h: 6 }]
  });
  const moved = blockFrame({
    width: 96,
    height: 24,
    blocks: [{ x: 8.5, y: 4, w: 10, h: 6 }, { x: 34.5, y: 4, w: 14, h: 6 }]
  });
  const reference = profileOf(png, 4, 10);
  const target = profileOf(moved, 4, 10);
  assert.equal(trackProfile(reference, target, { rangePx: 8, upsample: 8 }).dxPx, 4.5);
  assert.deepEqual(gapEdges(findGaps(reference, { minWidth: 6 }).map((gap, index) => ({ ...gap, id: `gap-${index}` })))
    .map(edge => [edge.id, edge.x]), [['gap-0-left', 14], ['gap-0-right', 30]]);
  // Each edge sits on an ink-to-empty transition, so its window straddles content on one
  // side and nothing on the other, and it reads the band shift in band coordinates.
  const left = trackAnchor(reference, target, 14, { window: 8, rangePx: 8, upsample: 8 });
  assert.equal(left.dxPx, 4.5, 'the left edge of the gap reads the same shift as the band');
  assert.deepEqual(left.window, { from: 6, to: 22 });
  assert.equal(trackAnchor(reference, target, 30, { window: 8, rangePx: 8, upsample: 8 }).dxPx, 4.5);
  // The centre of a gap wider than the window is empty on both sides: there is no edge
  // there, so the primitive says so instead of correlating a flat window.
  assert.equal(trackAnchor(reference, target, 22, { window: 8, rangePx: 8 }).reason, 'window-has-no-edge');
  // The other refusal is a window of nothing but ink: a solid block interior has ink on
  // both sides and no transition to lock onto, even though the correlation is perfect.
  const solid = Float64Array.from({ length: 40 }, () => 5);
  assert.equal(trackAnchor(solid, solid, 20, { window: 4, rangePx: 8 }).reason, 'window-has-no-edge');
  assert.equal(trackAnchor(reference, target, 0, { window: 2 }).reason, 'window-too-small');
  assert.equal(trackAnchor(reference, reference, 14, { window: 8, rangePx: 8 }).dxPx, 0);
});

test('trackBands measures auto-detected bands across a sequence', async t => {
  const directory = await temporaryDirectory(t);
  const files = await writeFrames(directory, [0, 1, 2, 3].map(index => blockFrame({
    width: 96,
    height: 32,
    blocks: [
      { x: 4 + index * 2, y: 4, w: 12, h: 5 },
      { x: 40 + index, y: 20, w: 20, h: 6 }
    ]
  })));
  const report = await trackBands(files, { frameDirectory: directory, rangePx: 8, upsample: 8, anchors: false });
  assert.equal(report.schema, 'refclone/band-tracks@1');
  assert.deepEqual(report.raster, { width: 96, height: 32 });
  assert.equal(report.frameCount, 4);
  assert.deepEqual(report.bands.map(band => band.band), [{ start: 4, end: 9 }, { start: 20, end: 26 }]);
  assert.deepEqual(report.bands[0].series.map(record => record.dxPx), [0, 2, 4, 6]);
  assert.deepEqual(report.bands[1].series.map(record => record.dxPx), [0, 1, 2, 3]);
  assert.equal(report.bands[0].displacementPx, 6);
  assert.equal(report.bands[0].anchorFrame, 0);
  assert.deepEqual(report.bands[0].unresolvedFrames, []);
  assert.equal(report.parameters.bandSource, 'auto-rows');
  assert.equal(report.summary.bandsWithMotion, 2);
  assert.match(report.resolutionNote, /quantised to 0\.125 px/);
  // The reference frame is a choice, and every dx then reads from it.
  const anchored = await trackBands(files, { rangePx: 8, upsample: 8, referenceIndex: 2, anchors: false });
  assert.equal(anchored.anchorFrame, 2);
  assert.deepEqual(anchored.bands[0].series.map(record => record.dxPx), [-4, -2, 0, 2]);
});

test('a band with no ink in the anchor is reported as unmeasured, not as zero motion', async t => {
  const directory = await temporaryDirectory(t);
  const files = await writeFrames(directory, [0, 1].map(index => blockFrame({
    width: 64,
    height: 24,
    blocks: [{ x: 4 + index * 3, y: 4, w: 8, h: 6 }]
  })));
  const report = await trackBands(files, {
    bands: [{ id: 'empty', start: 16, end: 22 }, { id: 'ink', start: 4, end: 10 }],
    anchors: false
  });
  assert.equal(report.bands[0].framesMeasured, 0);
  assert.deepEqual(report.bands[0].unresolvedFrames, [0, 1]);
  // The anchor frame is not "measured at zero" either: an empty band has nothing to
  // anchor, so its own frame carries the same refusal as the frames compared to it.
  assert.deepEqual(report.bands[0].series.map(record => record.reason), ['flat-reference', 'flat-reference']);
  assert.deepEqual([report.bands[0].displacementPx, report.bands[0].meanScore], [null, null]);
  assert.deepEqual(report.summary.unmeasuredBands, ['empty']);
  assert.equal(report.bands[1].framesMeasured, 2);
});

test('trackBands refuses inputs it cannot measure', async t => {
  const directory = await temporaryDirectory(t);
  const files = await writeFrames(directory, [0, 1].map(() => blockFrame({ blocks: [{ x: 4, y: 4, w: 8, h: 6 }] })));
  await assert.rejects(() => trackBands(files.slice(0, 1)), /at least two frames/i);
  await assert.rejects(() => trackBands(files, { axis: 'y' }), /needs explicit column bands/);
  await assert.rejects(() => trackBands(files, { axis: 'diagonal' }), /axis must be/);
  await assert.rejects(() => trackBands(files, { bands: [{ id: 'wide', start: 4, end: 400 }] }), /inside 0\.\.24/);
  await assert.rejects(() => trackBands(files, { bands: [{ id: 'flip', start: 9, end: 4 }] }), /inside 0\.\.24/);
  await assert.rejects(() => trackBands(files, { bands: [{ id: 'domain', start: 4, end: 10, origin: 0, domainEnd: 400 }] }), /integer domain/);
  await assert.rejects(() => trackBands(files, { domainStart: 10, domainEnd: 4 }), /outside 0\.\.64/);
  // Ten text rows in every frame: band discovery is capped, because an unbounded number
  // of bands is a sign the frame was not restricted rather than a sign it has ten lines.
  const oversized = await writeFrames(path.join(directory, 'many'), Array.from({ length: 2 }, () => blockFrame({
    width: 64,
    height: 100,
    blocks: Array.from({ length: 10 }, (_, row) => ({ x: 4, y: row * 4, w: 8, h: 3 }))
  })));
  await assert.rejects(() => trackBands(oversized, { maxBands: 8 }), /over the 8-band limit/);
  const withinLimit = await trackBands(oversized, { maxBands: 12, anchors: false });
  assert.equal(withinLimit.bands.length, 10, 'the same frames measure once the cap is honest');
  const mixed = await writeFrames(path.join(directory, 'mixed'), [
    blockFrame({ width: 64, height: 24, blocks: [{ x: 4, y: 4, w: 8, h: 6 }] }),
    blockFrame({ width: 32, height: 24, blocks: [{ x: 4, y: 4, w: 8, h: 6 }] })
  ]);
  await assert.rejects(() => trackBands(mixed), /32x24, but the anchor frame is 64x24/);
});

test('measureBand keeps the per-frame series a motion fit needs', () => {
  const profiles = [0, 1, 2].map(index => profileOf(blockFrame({
    width: 64,
    height: 24,
    blocks: [{ x: 8 + index * 2.5, y: 4, w: 10, h: 6 }]
  }), 4, 10));
  const band = measureBand([10, 11, 12], profiles, { id: 'row', start: 4, end: 10, origin: 0, domainEnd: 64 }, {
    rangePx: 8, upsample: 8, anchors: false
  });
  assert.deepEqual(band.series.map(record => record.frame), [10, 11, 12]);
  assert.deepEqual(band.series.map(record => record.dxPx), [0, 2.5, 5]);
  // Total ink is a per-frame number a fit can sanity-check against a fade or an
  // opacity ramp: the same content merely translated keeps it, up to 8-bit rounding.
  const inks = band.series.map(record => record.ink);
  assert.equal(inks.every(value => Number.isFinite(value)), true, 'ink is a finite weight per frame');
  assert.ok(Math.max(...inks) - Math.min(...inks) < 0.1, `pure translation conserves ink, got ${inks.join(', ')}`);
  assert.ok(inks[0] > 0, 'and the band really has ink');
  assert.equal(band.displacementPx, 5);
  assert.deepEqual([band.minDxPx, band.maxDxPx], [0, 5]);
  assert.equal(band.firstDxPx, 0);
  assert.equal(band.lastDxPx, 5);
  assert.equal(band.framesRequested, 3);
  assert.equal(band.quantumPx, 0.125);
  assert.ok(band.meanScore > 0.9);
  assert.equal(band.series.every(record => record.anchors.length === 0), true, '--no-anchors keeps the artifact small');
});

// Both cases below were found by running the tool against the real 736x414 reference
// rather than by reading the code: a 3-digit frame name silently relabelled every
// measurement, and an absolute ink threshold made band discovery collapse a real frame
// into one full-height band. A unit test would not have noticed either, because a
// synthetic 64 px clip has neither problem.
test('frame numbers come from the filename at any zero padding', async t => {
  const directory = await temporaryDirectory(t);
  assert.deepEqual(['frame-028.png', 'shot1-frame-012.png', 'input-000.png', 'no-digits.png'].map(frameOf),
    [28, 12, 0, null], 'the last digit run is the frame');
  const files = [];
  for (const [index, frame] of [28, 29, 30].entries()) {
    const file = path.join(directory, `frame-${String(frame).padStart(3, '0')}.png`);
    await fs.writeFile(file, PNG.sync.write(blockFrame({ blocks: [{ x: 10 + index * 2, y: 4, w: 8, h: 6 }] })));
    files.push(file);
  }
  const report = await trackBands(files, { bands: [{ id: 'line', start: 4, end: 10 }], rangePx: 8, upsample: 8, anchors: false });
  assert.equal(report.anchorFrame, 28, 'the anchor frame is the real frame number, not the list position');
  assert.deepEqual(report.bands[0].series.map(record => record.frame), [28, 29, 30]);
  assert.deepEqual(report.bands[0].series.map(record => record.dxPx), [0, 2, 4]);
});

test('band discovery thresholds against the frame it is looking at', async t => {
  const directory = await temporaryDirectory(t);
  // A 100 px wide frame: one text row worth 20 covered columns, plus a two-column speck.
  // The speck carries 1.65 ink — above an absolute threshold of 1, below the resolved
  // 2% of the domain width — so only the calibrated default separates text from noise.
  const files = await writeFrames(directory, [0, 1].map(index => blockFrame({
    width: 100,
    height: 20,
    blocks: [{ x: 10 + index, y: 4, w: 20, h: 6 }, { x: 60, y: 15, w: 2, h: 1 }]
  })));
  const calibrated = await trackBands(files, { rangePx: 8, upsample: 8, anchors: false });
  assert.equal(calibrated.parameters.resolvedMinRowInk, 2, '2% of a 100 px domain');
  assert.deepEqual(calibrated.bands.map(band => [band.band.start, band.band.end]), [[4, 10]], 'the speck is not a text line');
  const explicit = await trackBands(files, { rangePx: 8, upsample: 8, anchors: false, minRowInk: 1 });
  assert.equal(explicit.bands.length, 2, 'an explicit threshold is honoured even when it finds noise');
  assert.equal(explicit.parameters.resolvedMinRowInk, 1);
});
