import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  AUTOANALYSIS_VERSION, DEFAULT_AUTOANALYSIS, settingsFor, dominantColor, foregroundMask,
  componentsIn, mergeComponents, hypothesizeKind, statesForTrack, motionForTrack, buildTracks,
  frameDifference, proposeTransition, planSampling, buildAutoSpec, validateAutoAnalysis, autoAnalyze
} from '../../src/ingest/autoanalyze.mjs';
import { ingest, normalizeMetadata } from '../../src/ingest/media.mjs';
import { validateSpecification } from '../../src/ingest/analysis.mjs';
import { readJson, hashFile, runProcess, validateArtifact, verifyFiles } from '../../src/core.mjs';
import { BLUE, canvas, plate, RED, syntheticClip, TWO_SHOT_CLIP, twoShotPaint, WHITE } from '../helpers/fixtures.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'autoanalyze-'));
const SOURCE = 'a'.repeat(64);

const regionsOf = (png, settings = DEFAULT_AUTOANALYSIS) => {
  const background = dominantColor(png);
  return mergeComponents(componentsIn(foregroundMask(png, background.rgb, settings.colorDistance)), { gapPx: settings.gapPx })
    .filter(region => region.pixels >= settings.minRegionPixels);
};
const sample = (left, top, right, bottom, frame) => ({
  left, top, right, bottom, pixels: (right - left) * (bottom - top), parts: 1,
  density: 1, meanColor: '#ffffff', frame
});

const metadataFor = (frames, width = 40, height = 20) => normalizeMetadata({
  streams: [{ codec_type: 'video', codec_name: 'png', width, height, avg_frame_rate: '24/1', r_frame_rate: '24/1', time_base: '1/24', duration: String(frames / 24) }],
  format: { format_name: 'mov' }
}, Array.from({ length: frames }, (_, index) => ({ pts_time: String(index / 24), duration_time: String(1 / 24) })),
  { path: 'C:/fixture.mov', sha256: SOURCE, sizeBytes: 128 }, { ffmpeg: 'test', ffprobe: 'test' });

const boundariesFor = (shots) => ({
  schemaVersion: 1, sourceHash: SOURCE,
  review: { status: 'confirmed', notes: 'Synthetic fixture boundary expectation.' },
  shots: shots.map(([id, startFrame, endFrameExclusive]) => ({
    id, startFrame, endFrameExclusive,
    startSeconds: startFrame / 24, endSeconds: endFrameExclusive / 24
  }))
});

test('settings merge, and a bad threshold is rejected instead of silently used', () => {
  const merged = settingsFor({ gapPx: 3, ocr: { enabled: true, provider: 'caller-supplied' } });
  assert.equal(merged.gapPx, 3);
  assert.equal(merged.colorDistance, DEFAULT_AUTOANALYSIS.colorDistance);
  assert.deepEqual(merged.ocr, { enabled: true, provider: 'caller-supplied' });
  assert.throws(() => settingsFor({ gapPx: 0 }), { code: 'AUTOANALYSIS_SETTING_INVALID' });
  assert.throws(() => settingsFor({ colorDistance: -1 }), { code: 'AUTOANALYSIS_SETTING_INVALID' });
  assert.throws(() => settingsFor({ ocr: { enabled: true } }), { code: 'AUTOANALYSIS_SETTING_INVALID' });
});

test('modal color and threshold mask count the decoded pixels exactly', () => {
  const png = plate(canvas(40, 20, BLUE), WHITE, 4, 4, 10, 10);
  const background = dominantColor(png);
  assert.equal(background.color, '#1419dc');
  assert.equal(background.pixels, 764);
  assert.ok(Math.abs(background.fraction - 764 / 800) < 1e-9);
  const mask = foregroundMask(png, background.rgb, DEFAULT_AUTOANALYSIS.colorDistance);
  assert.equal(mask.pixels, 36);
  const transparent = new PNG({ width: 4, height: 4 });
  transparent.data.fill(255);
  for (let at = 3; at < transparent.data.length; at += 4) transparent.data[at] = 0;
  assert.throws(() => dominantColor(transparent), { code: 'IMAGE_EMPTY' });
});

test('components merge across letter gaps and keep weighted measurements', () => {
  let png = canvas(40, 20, BLUE);
  for (const left of [10, 16, 22]) png = plate(png, WHITE, left, 4, left + 4, 9);
  png = plate(png, WHITE, 34, 16, 40, 20);
  const parts = componentsIn(foregroundMask(png, BLUE, DEFAULT_AUTOANALYSIS.colorDistance));
  assert.equal(parts.length, 4, 'three bars and one block are separate connected components');
  const merged = mergeComponents(parts, { gapPx: DEFAULT_AUTOANALYSIS.gapPx });
  assert.equal(merged.length, 2, 'gap proximity groups the bars, not the distant block');
  const band = merged[0];
  assert.equal(band.parts, 3);
  assert.equal(band.pixels, 60);
  assert.deepEqual({ left: band.left, top: band.top, right: band.right, bottom: band.bottom }, { left: 10, top: 4, right: 26, bottom: 9 });
  assert.equal(band.meanColor, '#ffffff');
  assert.equal(mergeComponents(parts, { gapPx: 0 }).length, 4, 'without a gap allowance nothing is grouped');
  assert.equal(hypothesizeKind(band, { width: 40, height: 20 }).type, 'text');
  assert.equal(hypothesizeKind(merged[1], { width: 40, height: 20 }).type, 'image');
  assert.equal(hypothesizeKind(merged[1], { width: 40, height: 20 }).basis.includes('connected component'), true);
  assert.equal(hypothesizeKind({ ...band, left: 0, top: 0, right: 40, bottom: 20, pixels: 800, density: 1 }, { width: 40, height: 20 }).type, 'rect');
  assert.ok(hypothesizeKind(band, { width: 40, height: 20, hasTextRecognizer: true }).confidence > hypothesizeKind(band, { width: 40, height: 20 }).confidence);
});

test('identical measurements collapse to their endpoints while motion keeps every frame', () => {
  const still = Array.from({ length: 10 }, (_, frame) => sample(10, 4, 16, 10, frame));
  const stillStates = statesForTrack(still, { tolerancePx: DEFAULT_AUTOANALYSIS.tolerancePx });
  assert.deepEqual(stillStates.map(state => state.frame), [0, 9]);
  assert.equal(stillStates[0].changed, true);
  assert.equal(stillStates[1].changed, false, 'the endpoint repeats the previous measurement');
  const moving = Array.from({ length: 6 }, (_, frame) => sample(2 + frame * 3, 4, 8 + frame * 3, 10, frame));
  assert.deepEqual(statesForTrack(moving, { tolerancePx: DEFAULT_AUTOANALYSIS.tolerancePx }).map(state => state.frame), [0, 1, 2, 3, 4, 5]);
});

test('motion labels name the largest measured change and never imply a curve', () => {
  const shot = { id: 'shot-001', startFrame: 0, endFrameExclusive: 12 };
  const still = statesForTrack(Array.from({ length: 10 }, (_, frame) => sample(10, 4, 16, 10, frame)), { tolerancePx: 0.5 });
  assert.deepEqual({ ...motionForTrack(still, shot) }, { kind: 'static', property: null, from: null, to: null, direction: null, frames: [], dense: false });
  const late = statesForTrack(Array.from({ length: 7 }, (_, index) => sample(10, 4, 16, 10, index + 3)), { tolerancePx: 0.5 });
  assert.deepEqual(motionForTrack(late, { ...shot, startFrame: 0 }), { kind: 'appear', property: 'visible', from: false, to: true, direction: null, frames: [3], dense: true });
  const right = statesForTrack(Array.from({ length: 5 }, (_, frame) => sample(frame * 3, 4, 6 + frame * 3, 10, frame)), { tolerancePx: 0.5 });
  const translate = motionForTrack(right, shot);
  assert.equal(translate.kind, 'translate-x');
  assert.equal(translate.direction, 'right');
  assert.equal(translate.dense, true);
  assert.deepEqual(translate.frames, [1, 2, 3, 4]);
  const taller = statesForTrack(Array.from({ length: 4 }, (_, frame) => sample(10, 4, 16, 6 + frame * 3, frame)), { tolerancePx: 0.5 });
  const scaleY = motionForTrack(taller, shot);
  assert.equal(scaleY.kind, 'scale-y');
  assert.equal(scaleY.direction, 'grow');
  assert.equal(scaleY.dense, true);
  assert.equal(scaleY.to, 1);
  assert.ok(Math.abs(scaleY.from - 2 / 11) < 1e-4, 'scale is relative to the last measured extent');
  const sparse = statesForTrack([sample(0, 0, 6, 6, 0), sample(9, 0, 15, 6, 6), sample(18, 0, 24, 6, 12)], { tolerancePx: 0.5 });
  assert.equal(motionForTrack(sparse, { startFrame: 0, endFrameExclusive: 13 }).dense, false, 'strided measurements cannot claim a consecutive path');
});

test('a region tracked across frames stays one track and a new region does not close it', () => {
  const frames = [0, 1, 2].map(frame => {
    let png = canvas(40, 20, BLUE);
    png = plate(png, WHITE, 4 + frame * 4, 4, 10 + frame * 4, 10);
    if (frame === 2) png = plate(png, WHITE, 30, 14, 36, 20);
    return { frame, regions: regionsOf(png) };
  });
  const shot = { id: 'shot-001', startFrame: 0, endFrameExclusive: 3 };
  const tracks = buildTracks(frames, { width: 40, height: 20, settings: DEFAULT_AUTOANALYSIS, shot });
  assert.equal(tracks.length, 2, 'the moving block and the frame-2 block are separate tracks');
  assert.deepEqual(tracks.map(track => track.id), ['auto-shot-001-region-1', 'auto-shot-001-region-2']);
  assert.equal(tracks[0].firstFrame, 0);
  assert.equal(tracks[0].lastFrame, 2, 'the tracked region is not closed on the frame a new region appears');
  assert.equal(tracks[0].states.length, 3);
  assert.equal(tracks[0].motion.kind, 'translate-x');
  assert.equal(tracks[0].motion.dense, true);
  assert.equal(tracks[1].firstFrame, 2);
  assert.equal(tracks[1].lastFrame, 2, 'a region born on the last sampled frame is not dropped');
  assert.equal(tracks[1].motion.kind, 'appear', 'a single late measurement is an appearance, not a motion path');
  assert.ok(tracks[0].unresolved.some(note => note.includes('nearest-centroid')));
  assert.ok(tracks[0].unresolved.some(note => note.includes('alpha')));
  assert.equal(tracks[0].states[1].bbox.x, 8 / 40, 'state boxes are normalized source raster measurements');
  assert.deepEqual(tracks[0].states[1].pixelBounds, { left: 8, top: 4, rightExclusive: 14, bottomExclusive: 10 });
});

test('sampling stays dense inside the budget and declares its stride beyond it', () => {
  const boundaries = boundariesFor([['shot-001', 0, 8], ['shot-002', 8, 16]]);
  const dense = planSampling(boundaries, 16, settingsFor({}));
  assert.equal(dense.dense, true);
  assert.equal(dense.stride, 1);
  assert.deepEqual(dense.frames, Array.from({ length: 16 }, (_, frame) => frame));
  const strided = planSampling(boundaries, 16, settingsFor({ maxTrackFramesPerShot: 4 }));
  assert.equal(strided.dense, false);
  assert.equal(strided.stride, 2);
  assert.deepEqual(strided.frames, [0, 2, 4, 6, 7, 8, 10, 12, 14, 15]);
  assert.equal(strided.frames.every(frame => frame >= 0 && frame < 16), true);
});

test('a cut is proposed only from consecutive decoded frames', () => {
  const map = new Map([[7, { png: canvas(40, 20, BLUE) }], [8, { png: canvas(40, 20, RED) }]]);
  const previous = { id: 'shot-001', startFrame: 0, endFrameExclusive: 8 };
  const shot = { id: 'shot-002', startFrame: 8, endFrameExclusive: 16 };
  const cut = proposeTransition(previous, shot, map, { dense: true });
  assert.equal(cut.type, 'cut');
  assert.match(cut.notes, /7 -> 8/);
  assert.ok(cut.confidence > 0);
  assert.equal(proposeTransition(previous, shot, map, { dense: false }).type, 'unresolved');
  assert.match(proposeTransition(previous, shot, map, { dense: false }).notes, /strided/);
  assert.equal(proposeTransition(previous, shot, new Map(), { dense: true }).type, 'unresolved');
  assert.match(proposeTransition(previous, shot, new Map(), { dense: true }).notes, /not decoded/);
  const identical = new Map([[7, { png: canvas(40, 20, BLUE) }], [8, { png: canvas(40, 20, BLUE) }]]);
  assert.match(proposeTransition(previous, shot, identical, { dense: true }).notes, /near-identical/);
  assert.throws(() => frameDifference(canvas(4, 4, BLUE), canvas(6, 4, BLUE)), { code: 'FRAME_COMPARISON_INVALID' });
  assert.ok(Math.abs(frameDifference(canvas(4, 4, BLUE), plate(canvas(4, 4, BLUE), WHITE, 0, 0, 2, 4)) - 0.5) < 1e-9);
});

test('the draft shot-spec proposes without deciding, and the gates still block it', async () => {
  const metadata = metadataFor(16, 64, 36);
  const boundaries = boundariesFor([['shot-001', 0, 8], ['shot-002', 8, 16]]);
  const shotFrames = (startFrame, endFrameExclusive) => Array.from({ length: endFrameExclusive - startFrame },
    (_, index) => ({ frame: startFrame + index, timeSeconds: (startFrame + index) / 24, path: `C:/fixtures/f${startFrame + index}.png`, sha256: 'b'.repeat(64), width: 64, height: 36 }));
  const one = (startFrame, shotId) => {
    let png = canvas(64, 36, BLUE);
    png = plate(png, WHITE, 4, 12, 10, 24);
    return buildTracks([{ frame: startFrame, regions: regionsOf(png) }], {
      width: 64, height: 36, settings: DEFAULT_AUTOANALYSIS, shot: { id: shotId, startFrame, endFrameExclusive: startFrame + 1 }
    });
  };
  const moving = buildTracks([0, 1, 2].map(frame => {
    let png = canvas(64, 36, BLUE);
    png = plate(png, WHITE, 4 + frame * 5, 12, 10 + frame * 5, 24);
    return { frame, regions: regionsOf(png) };
  }), { width: 64, height: 36, settings: DEFAULT_AUTOANALYSIS, shot: { id: 'shot-001', startFrame: 0, endFrameExclusive: 8 } });
  const auto = {
    shots: [
      {
        id: 'shot-001', startFrame: 0, endFrameExclusive: 8,
        background: { color: '#1419dc', pixels: 2232, fraction: 0.96875, stableFrames: 3 },
        tracks: moving, transition: { type: 'none', confidence: 1, notes: 'First shot of the reference: the media starts here, so there is no incoming transition to propose.' }
      },
      {
        id: 'shot-002', startFrame: 8, endFrameExclusive: 16,
        background: { color: '#1419dc', pixels: 2232, fraction: 0.96875, stableFrames: 3 },
        tracks: one(8, 'shot-002'), transition: { type: 'cut', confidence: 0.7, notes: 'Dense adjacent-frame comparison shows 7 -> 8 changing on 6.25% of pixels.' }
      }
    ],
    sampling: { maxTrackFramesPerShot: 240, requestedFrames: 16, decodedFrames: 16, stride: 1, dense: true },
    ocr: { used: false, provider: null, notes: 'No recognizer ran.' },
    frameRecords: [...shotFrames(0, 8), ...shotFrames(8, 16)]
  };
  const spec = buildAutoSpec({ metadata, boundaries, auto });
  await validateArtifact('shot-spec', spec);
  assert.equal(spec.review.status, 'pending');
  assert.equal(spec.totalFrames, 16);
  assert.deepEqual(spec.transformations, []);
  const elements = spec.shots.flatMap(shot => shot.elements);
  assert.equal(elements.every(element => element.copy === null), true, 'no copy is invented');
  assert.equal(elements.every(element => !element.font.family && !element.font.style && !element.font.sizePx), true, 'typography is never inferred from ink shapes');
  assert.equal(elements.every(element => element.evidence.status === 'tool_estimate' || element.evidence.status === 'measured'), true);
  assert.deepEqual(spec.shots[0].transition, {
    type: 'none', durationFrames: 0,
    evidence: { status: 'measured', method: 'Reference start', frames: [0], confidence: 1, notes: auto.shots[0].transition.notes }
  });
  assert.equal(spec.shots[1].transition.type, 'cut');
  assert.equal(spec.shots[1].transition.evidence.status, 'tool_estimate', 'a proposed cut is not a reviewed edit decision');
  assert.ok(spec.shots[1].unresolved.some(note => note.includes('pixel-comparison proposal')));
  const tracked = spec.shots.flatMap(shot => shot.elements.filter(element => !element.id.endsWith('background')));
  assert.equal(tracked.every(element => element.states.every(state => state.opacity === 1)), true);
  assert.deepEqual(spec.shots[0].events.map(event => event.type), ['translate-x']);
  assert.equal(spec.shots[0].events[0].elementId, spec.shots[0].elements[1].id);
  assert.deepEqual(spec.shots[0].events[0].frames, [1, 2]);
  assert.equal(spec.shots[1].events.length, 0, 'a static endpoint measurement produces no event');
  const imageElements = tracked.filter(element => element.type === 'image');
  assert.ok(imageElements.length >= 1);
  for (const element of imageElements) {
    assert.equal(element.assetId, `${element.id}-source`);
    const requirement = spec.shots.find(shot => shot.elements.includes(element)).requiredAssets.find(asset => asset.id === element.assetId);
    assert.equal(requirement.status, 'unresolved', 'a missing asset is recorded, never substituted');
    assert.match(requirement.notes, /will not substitute/);
  }
  assert.equal(tracked.filter(element => element.type === 'text').every(element => element.assetId === null), true);
  for (const token of ['remax', 'word-wall', 'headline', 'highlight', 'logo-mark']) {
    assert.equal(JSON.stringify(spec).toLowerCase().includes(token), false, `the draft carries no ${token} vocabulary`);
  }
  const validation = await validateSpecification(spec, metadata, boundaries);
  assert.equal(validation.ready, false, 'a CV draft is never build-ready on its own');
  assert.equal(validation.readyForAssetValidation, false, 'the pending review still blocks the gates');
  assert.ok(validation.diagnostics.some(d => d.code === 'REVIEW_PENDING' && d.blocking));
  assert.ok(validation.diagnostics.some(d => d.code === 'ELEMENT_UNRESOLVED'));
  assert.ok(validation.diagnostics.some(d => d.code === 'ASSET_REQUIREMENT_OPEN'));
  assert.equal(validation.diagnostics.some(d => d.code === 'ZERO_AREA'), false);
  assert.equal(validation.diagnostics.some(d => d.code === 'SHOT_TIME_MISMATCH'), false);
  assert.equal(validation.diagnostics.some(d => d.code === 'TRANSITION_UNRESOLVED' && d.blocking), false);

  const strided = buildAutoSpec({
    metadata, boundaries,
    auto: { ...auto, sampling: { ...auto.sampling, dense: false, stride: 2 }, frameRecords: [auto.frameRecords[0], auto.frameRecords[14]] }
  });
  assert.equal(strided.shots[1].transition.type, 'unresolved', 'a strided pass cannot turn a proposal into a cut');
  assert.equal(strided.shots[1].transition.evidence.status, 'unresolved');
  assert.match(strided.shots[1].transition.evidence.notes, /placeholder/);
  assert.ok(strided.shots[0].unresolved.some(note => note.includes('stride 2')));

  assert.throws(() => buildAutoSpec({ metadata, boundaries: boundariesFor([['shot-009', 0, 16]]), auto }), { code: 'AUTO_SHOT_UNKNOWN' });
  assert.throws(() => buildAutoSpec({ metadata, boundaries, auto: { ...auto, frameRecords: auto.frameRecords.filter(r => r.frame < 8) } }), { code: 'AUTO_SHOT_UNSAMPLED' });
});

test('structural checks catch what the schema cannot express', async () => {
  const shotFrames = [{ frame: 0, regions: regionsOf(plate(canvas(40, 20, BLUE), WHITE, 4, 4, 10, 10)) }];
  const tracks = buildTracks(shotFrames, { width: 40, height: 20, settings: DEFAULT_AUTOANALYSIS, shot: { id: 'shot-001', startFrame: 0, endFrameExclusive: 1 } });
  const analysis = {
    schemaVersion: 1, sourceHash: SOURCE, methodVersion: AUTOANALYSIS_VERSION,
    sampling: { maxTrackFramesPerShot: 240, requestedFrames: 1, decodedFrames: 1, stride: 1, dense: true },
    ocr: { used: false, provider: null, notes: 'No recognizer ran.' },
    frames: [{ frame: 0, timeSeconds: 0, path: 'C:/fixtures/f0.png', sha256: 'b'.repeat(64), width: 40, height: 20 }],
    shots: [{
      id: 'shot-001', startFrame: 0, endFrameExclusive: 1,
      background: { color: '#1419dc', pixels: 764, fraction: 0.955, stableFrames: 1 },
      tracks, transition: { type: 'none', confidence: 1, notes: 'Reference start.' }
    }],
    limitations: ['Measured regions are threshold masks.']
  };
  assert.deepEqual(validateAutoAnalysis(analysis), []);
  const withoutTracks = structuredClone(analysis);
  withoutTracks.shots[0].tracks = [];
  assert.deepEqual(validateAutoAnalysis(withoutTracks), [], 'a shot with no measured region is structurally valid and honestly empty');

  const reused = structuredClone(analysis);
  reused.shots.push({ ...structuredClone(analysis.shots[0]), id: 'shot-002', startFrame: 1, endFrameExclusive: 2 });
  assert.ok(validateAutoAnalysis(reused).some(note => note.includes('reused across shots')));

  const unordered = structuredClone(analysis);
  unordered.shots[0].tracks[0].states = [{ ...unordered.shots[0].tracks[0].states[0], frame: 1 }, { ...unordered.shots[0].tracks[0].states[0], frame: 0 }];
  unordered.shots[0].tracks[0].firstFrame = 1;
  unordered.shots[0].tracks[0].lastFrame = 0;
  assert.ok(validateAutoAnalysis(unordered).some(note => note.includes('not increasing')));

  const outside = structuredClone(analysis);
  outside.shots[0].tracks[0].motion = { ...outside.shots[0].tracks[0].motion, kind: 'translate-x', frames: [9] };
  assert.ok(validateAutoAnalysis(outside).some(note => note.includes('outside its visible range')));

  const staticWithFrames = structuredClone(analysis);
  staticWithFrames.shots[0].tracks[0].motion = { ...staticWithFrames.shots[0].tracks[0].motion, frames: [0] };
  assert.ok(validateAutoAnalysis(staticWithFrames).some(note => note.includes('under a static kind')));

  const duplicateFrame = structuredClone(analysis);
  duplicateFrame.frames.push({ ...duplicateFrame.frames[0] });
  assert.ok(validateAutoAnalysis(duplicateFrame).some(note => note.includes('unique by source frame')));

  await validateArtifact('auto-analysis', analysis);
  assert.equal(analysis.shots[0].tracks[0].hypothesis.type, 'image');
  const invented = structuredClone(analysis);
  invented.shots[0].tracks[0].states[0].meanColor = 'white';
  await assert.rejects(validateArtifact('auto-analysis', invented), { code: 'SCHEMA_INVALID' });
});

test('end to end over a real generated reference: proposals, gates, report and cache', { timeout: 180000 }, async () => {
  const { video } = await syntheticClip(root, { ...TWO_SHOT_CLIP, paint: twoShotPaint });
  const options = { jobsDirectory: path.join(root, 'jobs'), ingestion: { sampleIntervalFrames: 1, minShotFrames: 2, maxFrames: 24 } };
  const provisional = await ingest(video, options);
  const reviewed = await ingest(video, {
    ...options,
    boundaryReview: { sourceHash: provisional.sourceHash, reviewer: 'automated synthetic-fixture expectation', notes: 'Background and content change exactly at source frame 8.', cuts: [8] }
  });

  const result = await autoAnalyze(reviewed.indexPath, { autoAnalysis: { maxReportFramesPerShot: 4 } });
  assert.equal(result.cached, false);
  assert.equal(result.sourceHash, reviewed.sourceHash);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.sampling.dense, true);
  assert.equal(result.sampling.decodedFrames, 16);
  assert.equal(result.ocr.used, false);
  assert.match(result.ocr.notes, /No recognizer ran/);
  assert.equal(await verifyFiles(result.outputs), true, 'every written artifact re-hashes');
  assert.equal(await hashFile(video), reviewed.sourceHash, 'the pass does not mutate the reference');

  const analysis = await readJson(result.analysisPath);
  await validateArtifact('auto-analysis', analysis);
  assert.equal(analysis.frames.length, 16);
  assert.equal(analysis.frames.every(frame => /auto-analysis/.test(frame.path)), true);
  assert.deepEqual(analysis.shots.map(shot => shot.id), ['shot-001', 'shot-002']);
  assert.equal(analysis.shots[0].tracks.length, 1, 'the moving block is one track, not eight');
  assert.equal(analysis.shots[0].tracks[0].motion.kind, 'translate-x');
  assert.equal(analysis.shots[0].tracks[0].motion.dense, true);
  assert.equal(analysis.shots[1].tracks.length, 2, 'the grouped bars and the solid block are two tracks');
  assert.deepEqual(analysis.shots[1].tracks.map(track => track.hypothesis.type).sort(), ['image', 'text']);
  assert.equal(analysis.shots[0].transition.type, 'none');
  assert.equal(analysis.shots[1].transition.type, 'cut');
  assert.ok(analysis.limitations.some(note => note.includes('alpha')));

  const spec = await readJson(result.shotSpecDraftPath);
  await validateArtifact('shot-spec', spec);
  assert.equal(spec.review.status, 'pending');
  assert.equal(spec.shots.length, 2);
  assert.equal(spec.shots.flatMap(shot => shot.elements).every(element => element.copy === null), true);
  assert.equal(spec.shots[0].events.length, 1);
  assert.equal(spec.shots[0].events[0].type, 'translate-x');
  assert.ok(result.counts.assets >= 1, 'raster regions produce unresolved asset requirements');
  assert.equal(spec.shots.flatMap(shot => shot.requiredAssets).every(asset => asset.status === 'unresolved'), true);
  const validation = await readJson(path.join(result.runDirectory, 'auto-spec-validation.json'));
  assert.equal(validation.ready, false);
  assert.ok(validation.diagnostics.some(diagnostic => diagnostic.code === 'REVIEW_PENDING'));
  assert.ok(validation.diagnostics.some(diagnostic => diagnostic.code === 'TYPOGRAPHY_UNRESOLVED'));

  const report = await fs.readFile(result.reportPath, 'utf8');
  assert.match(report, /Proposals only/);
  assert.match(report, /not used/);
  assert.match(report, /translate-x/);
  assert.match(report, /data:image\/png;base64,/, 'review plates are embedded');
  assert.equal(analysis.shots.every(shot => shot.stableFrames === undefined), true, 'the artifact carries only schema fields');

  const again = await autoAnalyze(reviewed.indexPath, { autoAnalysis: { maxReportFramesPerShot: 4 } });
  assert.equal(again.cached, true);
  assert.equal(again.runDirectory, result.runDirectory);
  const strided = await autoAnalyze(reviewed.indexPath, { autoAnalysis: { maxReportFramesPerShot: 4, maxTrackFramesPerShot: 4 } });
  assert.equal(strided.cached, false);
  assert.equal(strided.sampling.dense, false);
  const stridedSpec = await readJson(strided.shotSpecDraftPath);
  assert.equal(stridedSpec.shots[1].transition.type, 'unresolved', 'a strided pass never proposes a cut');

  await assert.rejects(autoAnalyze(path.join(root, 'missing-index.json')), { code: 'FILE_READ_FAILED' });
});

test('the CV pass refuses references it cannot measure honestly', { timeout: 180000 }, async () => {
  const directory = await fs.mkdtemp(path.join(work, 'autoanalyze-guards-'));
  const { video } = await syntheticClip(directory, {
    width: 48, height: 27, frames: 6, name: 'source.mov', fps: '30000/1001',
    paint: ({ frame, canvas: surface, plate: block }) => block(surface(48, 27, BLUE), WHITE, 4 + frame * 3, 8, 12 + frame * 3, 16)
  });

  // A variable frame-rate reference (common for screen recordings) has no reliable
  // source-frame ordinal, so the pass stops instead of guessing a timeline.
  const variable = path.join(directory, 'variable.mkv');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', video,
    '-vf', 'setpts=if(lt(N\\,4)\\,N\\,4+2*(N-4))*1001/(30000*TB)', '-fps_mode', 'vfr', '-c:v', 'ffv1', variable]);
  const vfrIngest = await ingest(variable, {
    jobsDirectory: path.join(directory, 'vfr-jobs'), ingestion: { sampleIntervalFrames: 1, minShotFrames: 2 }
  });
  assert.equal(vfrIngest.data['media-metadata'].video.vfr.detected, true, 'the fixture really is variable frame rate');
  await assert.rejects(autoAnalyze(vfrIngest.indexPath), { code: 'VFR_UNSUPPORTED' });

  // Ingestion output integrity is re-checked before a single pixel is decoded: a
  // tampered frame would silently move every measured box.
  const tampered = await ingest(video, {
    jobsDirectory: path.join(directory, 'tampered-jobs'), ingestion: { sampleIntervalFrames: 1, minShotFrames: 2 }
  });
  const frame = tampered.data.keyframes.frames[0];
  await fs.writeFile(frame.path, 'tampered');
  assert.equal(await verifyFiles(tampered.outputs), false);
  await assert.rejects(autoAnalyze(tampered.indexPath), { code: 'INPUT_INTEGRITY' });
});
