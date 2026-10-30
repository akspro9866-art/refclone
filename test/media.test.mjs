import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { ingest, parseRational, classifyTiming, normalizeMetadata, timelineBounds, parseSceneCandidates, detectBoundaries, applyBoundaryReview, selectFrames, pcmEnergy, DEFAULT_INGESTION } from '../src/media.mjs';
import { hashFile, runProcess, readJson, validateArtifact } from '../src/core.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'media-'));
const sourceHash = 'a'.repeat(64);
const metadata = normalizeMetadata({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 64, height: 36, avg_frame_rate: '24/1', r_frame_rate: '24/1', time_base: '1/12288', duration: '1' }], format: { format_name: 'mp4' } },
  Array.from({ length: 24 }, (_, i) => ({ pts_time: String(i / 24), duration_time: String(1 / 24) })), { path: 'C:/fixture.mp4', sha256: sourceHash, sizeBytes: 128 }, { ffmpeg: 'test', ffprobe: 'test' });

test('rational rates are preserved and invalid rates remain unknown', () => {
  assert.deepEqual(parseRational('30000/1001'), { num: 30000, den: 1001 });
  assert.deepEqual(parseRational('48/2'), { num: 24, den: 1 });
  for (const v of ['0/0', '1/0', 'N/A', '', '24', '-1/1']) assert.equal(parseRational(v), null);
});

test('VFR uses complete PTS intervals, not nominal rates', () => {
  assert.equal(classifyTiming(metadata.frameTimeline, '1/12288').detected, false);
  assert.equal(classifyTiming([{ ptsSeconds: 0 }], '1/1000').detected, null);
  assert.equal(classifyTiming([{ ptsSeconds: 0 }, { ptsSeconds: 0.04 }, { ptsSeconds: 0.12 }], '1/1000').detected, true);
  assert.equal(classifyTiming([{ ptsSeconds: 0 }, { ptsSeconds: 0 }], '1/1000').detected, null);
});

test('scene candidates map selected ordinal to SOURCE frame through PTS', () => {
  const candidates = parseSceneCandidates('frame:0 pts:4096 pts_time:0.333333\nlavfi.scene_score=0.900000\nframe:1 pts:8192 pts_time:0.666667\nlavfi.scene_score=0.500000', metadata);
  assert.deepEqual(candidates.map(c => c.frame), [8, 16]);
  assert.throws(() => parseSceneCandidates('frame:0 pts:1 pts_time:99\nlavfi.scene_score=1', metadata), { code: 'SCENE_TIMESTAMP_MISMATCH' });
  assert.throws(() => parseSceneCandidates('lavfi.scene_score=1', metadata), { code: 'SCENE_OUTPUT_INVALID' });
});

test('suppression retains raw candidates and review versions semantic cuts', () => {
  const candidates = [8, 9, 16, 23].map(frame => ({ frame, timeSeconds: frame / 24, score: 0.5 }));
  const boundaries = detectBoundaries(metadata, candidates);
  assert.deepEqual(boundaries.shots.map(s => s.startFrame), [0, 8, 16]);
  assert.equal(boundaries.review.status, 'pending');
  assert.equal(boundaries.candidates.length, 4);
  const reviewed = applyBoundaryReview(metadata, boundaries, { sourceHash, reviewer: 'fixture review', notes: 'Deliberate synthetic cut at 12.', cuts: [12] });
  assert.deepEqual(reviewed.shots.map(s => s.startFrame), [0, 12]);
  assert.equal(reviewed.review.status, 'confirmed');
  assert.deepEqual(reviewed.candidates, candidates);
  for (const cuts of [[0], [24], [12, 12], [15, 5], [1.2]]) assert.throws(() => applyBoundaryReview(metadata, boundaries, { sourceHash, reviewer: 'test', notes: 'test', cuts }), { code: 'REVIEW_INVALID' });
  assert.throws(() => applyBoundaryReview(metadata, boundaries, { sourceHash: 'b'.repeat(64), reviewer: 'test', notes: 'test', cuts: [] }), { code: 'SOURCE_MISMATCH' });
});

test('sample budget preserves mandatory endpoints and transition neighborhoods', () => {
  const boundaries = detectBoundaries(metadata, [{ frame: 12, timeSeconds: 0.5, score: 1 }]);
  const samples = selectFrames(metadata, boundaries);
  for (const frame of [0, 11, 12, 23, 10, 13, 14]) assert.ok(samples.some(s => s.frame === frame));
  assert.equal(new Set(samples.map(s => s.frame)).size, samples.length);
  assert.throws(() => selectFrames(metadata, boundaries, { ...DEFAULT_INGESTION, maxFrames: 2 }), { code: 'SAMPLING_BUDGET' });
});

test('timeline rejects absent/nonmonotonic PTS; no fallback to guessed fps', () => {
  assert.equal(timelineBounds(metadata).duration, 1);
  const wrong = structuredClone(metadata); wrong.frameTimeline[1].ptsSeconds = 0;
  assert.throws(() => timelineBounds(wrong), { code: 'TIMELINE_UNRESOLVED' });
});

test('PCM energy has known RMS/peak and preserves alignment', () => {
  const buffer = Buffer.alloc(16); [1, -1, 0, 0].forEach((v, i) => buffer.writeFloatLE(v, i * 4));
  assert.deepEqual(pcmEnergy(buffer, 4, 2, 1.5), [
    { startSeconds: 1.5, endSeconds: 2, rms: 1, peak: 1 },
    { startSeconds: 2, endSeconds: 2.5, rms: 0, peak: 0 },
  ]);
});

let fixture;
async function makeFixture() {
  if (fixture) return fixture;
  const dir = path.join(root, 'source-frames'); await fs.mkdir(dir);
  for (let n = 0; n < 8; n++) {
    const png = new PNG({ width: 64, height: 36 });
    for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      png.data[i] = n < 4 ? 20 : 230; png.data[i + 1] = 25; png.data[i + 2] = n < 4 ? 220 : 20; png.data[i + 3] = 255;
      if (x >= n * 6 + 2 && x < n * 6 + 8 && y >= 12 && y < 24) png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
    }
    await fs.writeFile(path.join(dir, `input-${String(n).padStart(3, '0')}.png`), PNG.sync.write(png), { flag: 'wx' });
  }
  const video = path.join(root, 'fractional.mov');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-framerate', '30000/1001', '-i', path.join(dir, 'input-%03d.png'), '-c:v', 'png', video]);
  fixture = { video, dir };
  return fixture;
}

test('real fractional-fps video: exact decoded samples, timestamps, missing audio, hash cache, corruption recovery', { timeout: 120000 }, async () => {
  const { video, dir } = await makeFixture();
  const options = { jobsDirectory: path.join(root, 'jobs'), ingestion: { sampleIntervalFrames: 1, minShotFrames: 2, maxFrames: 24 } };
  const first = await ingest(video, options);
  assert.equal(first.cached, false);
  const media = first.data['media-metadata'];
  assert.deepEqual(media.video.fps, { num: 30000, den: 1001 });
  assert.equal(media.video.frameCount, 8); assert.equal(media.audio.present, false);
  assert.equal(media.video.vfr.detected, false);
  assert.equal(first.data['audio-analysis'].present, false);
  assert.deepEqual(first.data['audio-analysis'].windows, []);
  assert.equal(first.data.keyframes.frames.length, 8);
  assert.ok(first.data['shot-boundaries'].candidates.some(c => c.frame === 4));
  for (const frame of first.data.keyframes.frames) {
    const expected = PNG.sync.read(await fs.readFile(path.join(dir, `input-${String(frame.frame).padStart(3, '0')}.png`)));
    const actual = PNG.sync.read(await fs.readFile(frame.path));
    assert.deepEqual(actual.data, expected.data, `source frame ${frame.frame} is mapped exactly, not by seek approximation`);
    assert.ok(Math.abs(frame.timeSeconds - frame.frame * 1001 / 30000) < 0.000002);
  }
  for (const [name, file] of Object.entries(first.artifacts)) await validateArtifact(name, await readJson(file));
  const second = await ingest(video, options);
  assert.equal(second.cached, true); assert.equal(second.runDirectory, first.runDirectory);
  const oldFrame = first.data.keyframes.frames[0].path;
  await fs.writeFile(oldFrame, 'deliberately corrupt TEST-ONLY cache fixture');
  const third = await ingest(video, options);
  assert.equal(third.cached, false); assert.notEqual(third.runDirectory, first.runDirectory);
  assert.equal(await fs.readFile(oldFrame, 'utf8'), 'deliberately corrupt TEST-ONLY cache fixture', 'Invalid prior run is retained, not silently overwritten');
  assert.equal(await hashFile(third.data.keyframes.frames[0].path), third.data.keyframes.frames[0].sha256);
  const reviewed = await ingest(video, { ...options, boundaryReview: { sourceHash: first.sourceHash, reviewer: 'automated synthetic-fixture expectation', notes: 'Generated background changes exactly at source frame 4.', cuts: [4] } });
  assert.equal(reviewed.cached, false); assert.equal(reviewed.data['shot-boundaries'].review.status, 'confirmed');
  assert.notEqual(reviewed.runDirectory, third.runDirectory);
});

test('very short one-frame video remains valid with unknown VFR', { timeout: 30000 }, async () => {
  const video = path.join(root, 'one-frame.mp4');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=24', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const result = await ingest(video, { jobsDirectory: path.join(root, 'short-jobs') });
  assert.equal(result.data.keyframes.frames.length, 1);
  assert.equal(result.data['media-metadata'].video.vfr.detected, null);
  assert.equal(result.data['shot-boundaries'].shots.length, 1);
});

test('real audio is measured without invented labels', { timeout: 30000 }, async () => {
  const video = path.join(root, 'audio.mp4');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=24:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=0.5', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
  const result = await ingest(video, { jobsDirectory: path.join(root, 'audio-jobs') });
  const audio = result.data['audio-analysis'];
  assert.equal(audio.present, true); assert.ok(audio.windows.length >= 4);
  assert.ok(audio.windows.some(w => w.rms > 0.05 && w.peak > 0.1));
});

test('real nonzero source PTS remain aligned during scene detection and extraction', { timeout: 30000 }, async () => {
  const { video } = await makeFixture();
  const shifted = path.join(root, 'shifted.mov');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-itsoffset', '2', '-i', video, '-c', 'copy', shifted]);
  const result = await ingest(shifted, { jobsDirectory: path.join(root, 'shifted-jobs'), ingestion: { sampleIntervalFrames: 1, minShotFrames: 2 } });
  assert.ok(result.data['media-metadata'].frameTimeline[0].ptsSeconds >= 1.99);
  assert.ok(result.data['shot-boundaries'].candidates.some(c => c.frame === 4 && c.timeSeconds > 2));
  assert.equal(result.data.keyframes.frames.length, 8);
});

test('real variable-frame-rate input is detected from decoded intervals', { timeout: 30000 }, async () => {
  const { video } = await makeFixture();
  const vfr = path.join(root, 'variable.mkv');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', video, '-vf', 'setpts=if(lt(N\\,4)\\,N\\,4+2*(N-4))*1001/(30000*TB)', '-fps_mode', 'vfr', '-c:v', 'ffv1', vfr]);
  const result = await ingest(vfr, { jobsDirectory: path.join(root, 'vfr-jobs'), ingestion: { sampleIntervalFrames: 1, minShotFrames: 2 } });
  assert.equal(result.data['media-metadata'].video.vfr.detected, true);
  assert.equal(result.data['media-metadata'].video.frameCount, 8);
  assert.equal(result.data.keyframes.frames.length, 8);
});

test('unreadable/invalid input and missing executable report structured errors', { timeout: 30000 }, async () => {
  const options = { jobsDirectory: path.join(root, 'invalid-jobs') };
  await assert.rejects(ingest(path.join(root, 'absent.mp4'), options), { code: 'INPUT_UNREADABLE' });
  const invalid = path.join(root, 'not-video.mp4'); await fs.writeFile(invalid, 'not a video');
  await assert.rejects(ingest(invalid, options), { code: 'PROCESS_FAILED' });
  const { video } = await makeFixture();
  await assert.rejects(ingest(video, { ...options, ffmpeg: path.join(root, 'missing-ffmpeg') }), { code: 'TOOL_MISSING' });
  await assert.rejects(ingest(video, { ...options, ingestion: { maxDurationSeconds: 0.01 } }), { code: 'INPUT_DURATION_LIMIT' });
  await assert.rejects(ingest(video, { ...options, ingestion: { maxFrames: 0 } }), { code: 'CONFIG_INVALID' });
});
