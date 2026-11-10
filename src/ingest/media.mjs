import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, hashFile, hashObject, readJson, validateArtifact,
  writeJsonNew, writeJsonState, fileRecord, verifyFiles, withJobLock, runProcess,
} from '../core.mjs';

export const INGEST_VERSION = '1.0.0';
export const DEFAULT_INGESTION = Object.freeze({
  sceneThreshold: 0.08, minShotFrames: 3, sampleIntervalFrames: 12,
  boundaryRadius: 2, maxFrames: 96, maxDurationSeconds: 300,
  processTimeoutMs: 120000,
});
const ARTIFACTS = ['media-metadata', 'shot-boundaries', 'keyframes', 'audio-analysis'];
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const numberOrNull = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const gcd = (a, b) => b ? gcd(b, a % b) : a;

export function parseRational(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) return null;
  const num = Number(match[1]), den = Number(match[2]);
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) return null;
  const divisor = gcd(num, den);
  return { num: num / divisor, den: den / divisor };
}

function settingsFor(overrides = {}) {
  const settings = { ...DEFAULT_INGESTION, ...overrides };
  for (const key of Object.keys(settings)) {
    if (!(key in DEFAULT_INGESTION)) fail('CONFIG_INVALID', `Unknown ingestion setting: ${key}`);
    if (!Number.isFinite(settings[key])) fail('CONFIG_INVALID', `${key} must be finite`);
  }
  if (settings.sceneThreshold < 0 || settings.sceneThreshold > 1) fail('CONFIG_INVALID', 'sceneThreshold must be in [0,1]');
  for (const key of ['minShotFrames', 'sampleIntervalFrames', 'maxFrames', 'processTimeoutMs']) {
    if (!Number.isSafeInteger(settings[key]) || settings[key] <= 0) fail('CONFIG_INVALID', `${key} must be a positive integer`);
  }
  if (!Number.isSafeInteger(settings.boundaryRadius) || settings.boundaryRadius < 0 || settings.boundaryRadius > 100) fail('CONFIG_INVALID', 'boundaryRadius must be an integer in [0,100]');
  if (settings.maxFrames > 1000 || settings.maxDurationSeconds <= 0 || settings.maxDurationSeconds > 3600) fail('CONFIG_INVALID', 'Sampling/duration exceeds bounded ingestion limits');
  return settings;
}

export function classifyTiming(timeline, timeBase) {
  if (timeline.length < 2) return { detected: null, reason: 'Fewer than two measured presentation timestamps; VFR cannot be established.' };
  if (timeline.some(f => !Number.isFinite(f.ptsSeconds))) return { detected: null, reason: 'Presentation timestamps are missing.' };
  const intervals = timeline.slice(1).map((f, i) => f.ptsSeconds - timeline[i].ptsSeconds);
  if (intervals.some(d => d <= 0)) return { detected: null, reason: 'Non-increasing presentation timestamps require explicit timeline repair/review.' };
  const base = parseRational(timeBase);
  const tolerance = Math.max(0.000002, base ? base.num / base.den * 1.1 : 0.000002);
  const range = intervals.reduce((r, d) => ({ min: Math.min(r.min, d), max: Math.max(r.max, d) }), { min: Infinity, max: -Infinity });
  const spread = range.max - range.min;
  return {
    detected: spread > tolerance,
    reason: `${intervals.length} decoded PTS intervals inspected; spread=${spread.toPrecision(6)}s, tolerance=${tolerance.toPrecision(6)}s. Nominal/average rates alone were not used to infer CFR.`,
  };
}

export function normalizeMetadata(probe, frames, source, tools) {
  const video = probe.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) fail('NO_VIDEO', 'Input contains no playable video stream');
  const width = Number(video.width), height = Number(video.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 33554432) fail('VIDEO_DIMENSIONS', 'Missing or unsupported video dimensions', { width, height });
  const timeline = frames.map((f, index) => ({
    index, ptsSeconds: numberOrNull(f.best_effort_timestamp_time ?? f.pts_time),
    durationSeconds: numberOrNull(f.duration_time ?? f.pkt_duration_time),
  }));
  if (!timeline.length) fail('NO_FRAMES', 'FFprobe decoded no video frames');
  const rotation = video.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? video.tags?.rotate;
  const audio = (probe.streams ?? []).filter(s => s.codec_type === 'audio');
  return {
    schemaVersion: 1, sourceHash: source.sha256, source,
    video: {
      codec: video.codec_name ?? null, container: probe.format?.format_name ?? null,
      width, height, durationSeconds: numberOrNull(video.duration ?? probe.format?.duration),
      fps: parseRational(video.avg_frame_rate) ?? parseRational(video.r_frame_rate),
      rFrameRate: video.r_frame_rate ?? null, avgFrameRate: video.avg_frame_rate ?? null,
      timeBase: video.time_base ?? null, frameCount: timeline.length,
      rotationDegrees: rotation === undefined ? 0 : numberOrNull(rotation),
      vfr: classifyTiming(timeline, video.time_base),
    },
    audio: { present: audio.length > 0, streams: audio }, tools, frameTimeline: timeline,
  };
}

export function timelineBounds(metadata) {
  const frames = metadata.frameTimeline;
  if (!metadata.video.fps || !frames.length || frames.some((f, i) => f.index !== i || !Number.isFinite(f.ptsSeconds) || (i > 0 && f.ptsSeconds <= frames[i - 1].ptsSeconds))) fail('TIMELINE_UNRESOLVED', 'Missing rate, timestamps or non-increasing PTS prevent frame-accurate ingestion');
  const first = frames[0].ptsSeconds, last = frames.at(-1);
  let end = last.durationSeconds > 0 ? last.ptsSeconds + last.durationSeconds : null;
  if (end === null && metadata.video.durationSeconds > last.ptsSeconds - first) end = first + metadata.video.durationSeconds;
  if (end === null || end <= last.ptsSeconds) fail('TIMELINE_UNRESOLVED', 'Final frame duration is unavailable; not inventing an end time');
  return { first, end, duration: end - first };
}

export function parseSceneCandidates(text, metadata) {
  const candidates = [];
  let pts = null;
  for (const line of text.split(/\r?\n/)) {
    const timestamp = /\bpts_time:([-+\d.eE]+)/.exec(line);
    if (timestamp) pts = Number(timestamp[1]);
    const score = /lavfi\.scene_score=([-+\d.eE]+)/.exec(line);
    if (!score) continue;
    if (!Number.isFinite(pts)) fail('SCENE_OUTPUT_INVALID', 'Scene score without a measured timestamp');
    // FFmpeg's printed frame number is the SELECTED ordinal, not the source frame.
    let lo = 0, hi = metadata.frameTimeline.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (metadata.frameTimeline[mid].ptsSeconds < pts) lo = mid + 1; else hi = mid;
    }
    const choices = [lo, Math.max(0, lo - 1)];
    const frame = choices.sort((a, b) => Math.abs(metadata.frameTimeline[a].ptsSeconds - pts) - Math.abs(metadata.frameTimeline[b].ptsSeconds - pts))[0];
    if (Math.abs(metadata.frameTimeline[frame].ptsSeconds - pts) > 0.00002) fail('SCENE_TIMESTAMP_MISMATCH', 'Cannot map detector PTS to source frame', { pts });
    const value = Number(score[1]);
    if (!Number.isFinite(value) || value < 0 || value > 1) fail('SCENE_OUTPUT_INVALID', 'Invalid scene score');
    candidates.push({ frame, timeSeconds: metadata.frameTimeline[frame].ptsSeconds, score: value });
    pts = null;
  }
  return candidates;
}

function makeShots(metadata, cuts) {
  const { end } = timelineBounds(metadata), total = metadata.frameTimeline.length;
  return [0, ...cuts].map((startFrame, i, starts) => {
    const endFrameExclusive = starts[i + 1] ?? total;
    return { id: `shot-${String(i + 1).padStart(3, '0')}`, startFrame, endFrameExclusive,
      startSeconds: metadata.frameTimeline[startFrame].ptsSeconds,
      endSeconds: endFrameExclusive === total ? end : metadata.frameTimeline[endFrameExclusive].ptsSeconds };
  });
}

export function detectBoundaries(metadata, candidates, settings = DEFAULT_INGESTION) {
  const cuts = [], total = metadata.frameTimeline.length;
  for (const c of [...candidates].sort((a, b) => a.frame - b.frame)) {
    if (c.frame - (cuts.at(-1) ?? 0) >= settings.minShotFrames && total - c.frame >= settings.minShotFrames) cuts.push(c.frame);
  }
  return {
    schemaVersion: 1, sourceHash: metadata.sourceHash, fps: metadata.video.fps,
    durationSeconds: timelineBounds(metadata).duration, totalFrames: total,
    detector: { name: 'ffmpeg-scene-PTS-mapped', threshold: settings.sceneThreshold, minShotFrames: settings.minShotFrames },
    candidates, review: { status: 'pending', notes: 'Heuristic candidates, not confirmed semantic cuts. Review exact boundary frames; near-duplicate candidates remain recorded.' },
    shots: makeShots(metadata, cuts),
  };
}

export function applyBoundaryReview(metadata, boundaries, review) {
  if (boundaries.sourceHash !== metadata.sourceHash || review.sourceHash !== metadata.sourceHash) fail('SOURCE_MISMATCH', 'Boundary review belongs to another source');
  if (typeof review.reviewer !== 'string' || !review.reviewer.trim() || typeof review.notes !== 'string' || !review.notes.trim() || !Array.isArray(review.cuts)) fail('REVIEW_INVALID', 'Review requires reviewer, notes and cuts (source frame indices)');
  let previous = 0;
  for (const cut of review.cuts) {
    if (!Number.isSafeInteger(cut) || cut <= previous || cut >= metadata.frameTimeline.length) fail('REVIEW_INVALID', 'Cuts must be increasing unique interior source frame indices');
    previous = cut;
  }
  return { ...boundaries, review: { status: 'confirmed', notes: `${review.reviewer}: ${review.notes}` }, shots: makeShots(metadata, review.cuts) };
}

export function selectFrames(metadata, boundaries, settings = DEFAULT_INGESTION) {
  const selected = new Map(), total = metadata.frameTimeline.length;
  const add = (frame, role) => {
    if (frame < 0 || frame >= total) return;
    const roles = selected.get(frame) ?? new Set(); roles.add(role); selected.set(frame, roles);
  };
  for (const shot of boundaries.shots) {
    add(shot.startFrame, 'shot-start'); add(shot.endFrameExclusive - 1, 'shot-end');
    add(Math.floor((shot.startFrame + shot.endFrameExclusive - 1) / 2), 'shot-interior');
  }
  for (const frame of new Set([...boundaries.candidates.map(c => c.frame), ...boundaries.shots.slice(1).map(s => s.startFrame)])) {
    for (let delta = -settings.boundaryRadius; delta <= settings.boundaryRadius; delta++) add(frame + delta, 'transition');
  }
  if (selected.size > settings.maxFrames) fail('SAMPLING_BUDGET', 'Mandatory shot/transition samples exceed maxFrames; increase the explicit budget or review boundaries', { required: selected.size, maxFrames: settings.maxFrames });
  const regular = [];
  for (let frame = 0; frame < total; frame += settings.sampleIntervalFrames) {
    if (selected.has(frame)) add(frame, 'interval'); else regular.push(frame);
  }
  const slots = settings.maxFrames - selected.size;
  if (regular.length <= slots) regular.forEach(f => add(f, 'interval'));
  else if (slots > 0) for (let i = 0; i < slots; i++) add(regular[Math.floor(i * regular.length / slots)], 'budgeted-interval');
  return [...selected].sort(([a], [b]) => a - b).map(([frame, roles]) => ({ frame, roles: [...roles].sort() }));
}

function validateIngestRelations(artifacts) {
  const metadata = artifacts['media-metadata'], boundaries = artifacts['shot-boundaries'], keys = artifacts.keyframes;
  const total = metadata.frameTimeline.length;
  timelineBounds(metadata);
  if (ARTIFACTS.some(name => artifacts[name].sourceHash !== metadata.sourceHash)) fail('SOURCE_MISMATCH', 'Ingestion artifacts do not share the same source');
  if (metadata.source.sha256 !== metadata.sourceHash || boundaries.totalFrames !== total || metadata.video.frameCount !== total || hashObject(metadata.video.fps) !== hashObject(boundaries.fps)) fail('ARTIFACT_INCONSISTENT', 'Metadata and boundaries disagree');
  let end = 0;
  const ids = new Set();
  for (const s of boundaries.shots) {
    if (ids.has(s.id) || s.startFrame !== end || s.endFrameExclusive <= s.startFrame || s.endFrameExclusive > total || Math.abs(s.startSeconds - metadata.frameTimeline[s.startFrame].ptsSeconds) > 1e-8) fail('ARTIFACT_INCONSISTENT', 'Invalid shot coverage or identity');
    const expectedEnd = s.endFrameExclusive === total ? timelineBounds(metadata).end : metadata.frameTimeline[s.endFrameExclusive].ptsSeconds;
    if (Math.abs(s.endSeconds - expectedEnd) > 1e-8) fail('ARTIFACT_INCONSISTENT', 'Shot end timestamp mismatch');
    ids.add(s.id); end = s.endFrameExclusive;
  }
  if (end !== total) fail('ARTIFACT_INCONSISTENT', 'Shot coverage is incomplete');
  let previous = -1;
  for (const f of keys.frames) {
    const matching = boundaries.shots.filter(s => f.frame >= s.startFrame && f.frame < s.endFrameExclusive).map(s => s.id);
    if (f.frame <= previous || f.frame >= total || f.timeSeconds !== metadata.frameTimeline[f.frame].ptsSeconds || f.width !== metadata.video.width || f.height !== metadata.video.height || hashObject(f.shotIds) !== hashObject(matching)) fail('ARTIFACT_INCONSISTENT', 'Frame record does not match source timeline or shots');
    previous = f.frame;
  }
  if (metadata.audio.present !== artifacts['audio-analysis'].present || !keys.frames.length || keys.frames.length > keys.sampling.maxFrames) fail('ARTIFACT_INCONSISTENT', 'Sampling/audio records disagree');
}

export async function createContactSheet(frames, outputPath) {
  const columns = Math.min(4, frames.length), cellWidth = 368, labelHeight = 14;
  const first = frames[0];
  const imageHeight = Math.round(cellWidth * first.height / first.width), cellHeight = imageHeight + labelHeight;
  const sheet = new PNG({ width: columns * cellWidth, height: Math.ceil(frames.length / columns) * cellHeight });
  sheet.data.fill(22);
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
  // Tiny bitmap numerals identify the exact source frame without relying on a font install.
  const digits = ['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001001001001','111101111101111','111101111001111'];
  for (let k = 0; k < frames.length; k++) {
    const png = PNG.sync.read(await fs.readFile(frames[k].path));
    const ox = (k % columns) * cellWidth, oy = Math.floor(k / columns) * cellHeight;
    for (let y = 0; y < imageHeight; y++) for (let x = 0; x < cellWidth; x++) {
      const from = (Math.min(png.height - 1, Math.floor(y * png.height / imageHeight)) * png.width + Math.min(png.width - 1, Math.floor(x * png.width / cellWidth))) * 4;
      const to = ((oy + y) * sheet.width + ox + x) * 4;
      png.data.copy(sheet.data, to, from, from + 4);
    }
    [...String(frames[k].frame)].forEach((digit, j) => {
      for (let p = 0; p < 15; p++) if (digits[Number(digit)][p] === '1') {
        for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
          const at = ((oy + imageHeight + 2 + Math.floor(p / 3) * 2 + yy) * sheet.width + ox + 4 + j * 8 + p % 3 * 2 + xx) * 4;
          sheet.data[at] = sheet.data[at + 1] = sheet.data[at + 2] = 235;
        }
      }
    });
  }
  await fs.writeFile(outputPath, PNG.sync.write(sheet), { flag: 'wx' });
  return fileRecord(outputPath);
}

async function extractFrames(source, metadata, boundaries, settings, outputDir, ffmpeg) {
  const samples = selectFrames(metadata, boundaries, settings);
  const directory = path.join(outputDir, 'frames'); await fs.mkdir(directory);
  const filter = `select=${samples.map(s => `eq(n\\,${s.frame})`).join('+')}`;
  await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-n', '-copyts', '-noautorotate', '-i', source,
    '-map', '0:v:0', '-vf', filter, '-fps_mode', 'passthrough', '-start_number', '0', path.join(directory, 'sample-%06d.png')], { timeoutMs: settings.processTimeoutMs });
  const files = (await fs.readdir(directory)).filter(n => n.endsWith('.png'));
  if (files.length !== samples.length) fail('FRAME_EXTRACTION_COUNT', 'Expected and extracted sample counts differ', { expected: samples.length, actual: files.length });
  const frames = [];
  for (let i = 0; i < samples.length; i++) {
    const destination = path.join(directory, `frame-${String(samples[i].frame).padStart(6, '0')}.png`);
    await fs.rename(path.join(directory, `sample-${String(i).padStart(6, '0')}.png`), destination);
    const png = PNG.sync.read(await fs.readFile(destination));
    if (png.width !== metadata.video.width || png.height !== metadata.video.height) fail('FRAME_DIMENSIONS', 'Extracted dimensions differ from coded raster; orientation was not silently changed');
    frames.push({ id: `frame-${String(samples[i].frame).padStart(6, '0')}`, ...samples[i], timeSeconds: metadata.frameTimeline[samples[i].frame].ptsSeconds,
      ...await fileRecord(destination), width: png.width, height: png.height,
      shotIds: boundaries.shots.filter(s => samples[i].frame >= s.startFrame && samples[i].frame < s.endFrameExclusive).map(s => s.id) });
  }
  return { schemaVersion: 1, sourceHash: metadata.sourceHash, frames,
    contactSheet: await createContactSheet(frames, path.join(outputDir, 'contact-sheet.png')),
    sampling: { intervalFrames: settings.sampleIntervalFrames, boundaryRadius: settings.boundaryRadius, maxFrames: settings.maxFrames } };
}

/**
 * Extract an explicit list of source frames as PNGs for dense measurement.
 *
 * This is the additive companion to the ingestion sampler: the pipeline needs
 * consecutive frames inside a shot to measure motion, while ingestion keeps its
 * own budgeted sample selection untouched. Frames are selected by exact source
 * frame ordinal, so the returned records stay tied to the measured PTS timeline.
 */
export async function extractFrameRange(source, metadata, frames, outputDirectory, { ffmpeg = 'ffmpeg', timeoutMs = 120000 } = {}) {
  const indices = [...new Set(frames.map(Number))].sort((left, right) => left - right);
  if (!indices.length) fail('FRAME_RANGE_EMPTY', 'Dense extraction requires at least one source frame.');
  const total = metadata.frameTimeline.length;
  for (const frame of indices) {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= total) fail('FRAME_OUT_OF_RANGE', 'Dense extraction cites a frame outside the measured timeline.', { frame, total });
  }
  await fs.mkdir(outputDirectory, { recursive: true });
  const directory = path.join(outputDirectory, 'frames');
  await fs.mkdir(directory, { recursive: false });
  const filter = `select=${indices.map(frame => `eq(n\\,${frame})`).join('+')}`;
  await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-n', '-copyts', '-noautorotate', '-i', source,
    '-map', '0:v:0', '-vf', filter, '-fps_mode', 'passthrough', '-start_number', '0', path.join(directory, 'dense-%06d.png')], { timeoutMs });
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.png'));
  if (files.length !== indices.length) fail('FRAME_EXTRACTION_COUNT', 'Expected and extracted dense frame counts differ', { expected: indices.length, actual: files.length });
  const records = [];
  for (let index = 0; index < indices.length; index += 1) {
    const frame = indices[index];
    const destination = path.join(directory, `frame-${String(frame).padStart(6, '0')}.png`);
    await fs.rename(path.join(directory, `dense-${String(index).padStart(6, '0')}.png`), destination);
    const png = PNG.sync.read(await fs.readFile(destination));
    if (png.width !== metadata.video.width || png.height !== metadata.video.height) fail('FRAME_DIMENSIONS', 'Extracted dimensions differ from coded raster; orientation was not silently changed');
    records.push({ frame, timeSeconds: metadata.frameTimeline[frame].ptsSeconds, ...await fileRecord(destination), width: png.width, height: png.height });
  }
  return records;
}

export function pcmEnergy(buffer, sampleRate = 8000, windowSamples = 800, startSeconds = 0) {
  if (buffer.length % 4 !== 0) fail('AUDIO_INVALID', 'Incomplete f32le sample');
  const count = buffer.length / 4, windows = [];
  for (let start = 0; start < count; start += windowSamples) {
    const end = Math.min(count, start + windowSamples); let squareSum = 0, peak = 0;
    for (let i = start; i < end; i++) {
      const value = buffer.readFloatLE(i * 4);
      if (!Number.isFinite(value)) fail('AUDIO_INVALID', 'Non-finite decoded audio sample');
      squareSum += value * value; peak = Math.max(peak, Math.abs(value));
    }
    windows.push({ startSeconds: startSeconds + start / sampleRate, endSeconds: startSeconds + end / sampleRate, rms: Math.sqrt(squareSum / (end - start)), peak });
  }
  return windows;
}

async function analyzeAudio(source, metadata, ffmpeg, settings) {
  if (!metadata.audio.present) return { schemaVersion: 1, sourceHash: metadata.sourceHash, present: false, method: 'none', windows: [], notes: ['No audio stream in the source; no transcript or sound labels generated.'] };
  const start = numberOrNull(metadata.audio.streams[0].start_time);
  if (start === null) fail('AUDIO_TIMELINE_UNRESOLVED', 'Audio start timestamp unavailable; cannot align energy windows');
  const { stdout } = await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'],
    { encoding: null, timeoutMs: settings.processTimeoutMs, maxOutputBytes: Math.ceil(settings.maxDurationSeconds * 8000 * 4 + 1048576) });
  return { schemaVersion: 1, sourceHash: metadata.sourceHash, present: true, method: 'ffmpeg-first-audio-stream-mono-8000Hz-f32le-100ms-linear-energy', windows: pcmEnergy(stdout, 8000, 800, start),
    notes: ['Linear amplitude after mono downmix; not loudness, speech recognition or beat detection.', `Analyzed first of ${metadata.audio.streams.length} audio stream(s); stream metadata is preserved. Timestamp gaps inside an audio stream are not reconstructed.`] };
}

async function cachedArtifacts(indexPath, key) {
  try {
    const index = await readJson(indexPath);
    if (index.key !== key || !Array.isArray(index.outputs) || !await verifyFiles(index.outputs)) return null;
    const artifacts = {};
    for (const name of ARTIFACTS) {
      artifacts[name] = await readJson(index.artifacts[name]);
      await validateArtifact(name, artifacts[name]);
      if (!index.outputs.some(r => r.path === index.artifacts[name])) return null;
    }
    validateIngestRelations(artifacts);
    const files = [...artifacts.keyframes.frames, artifacts.keyframes.contactSheet];
    for (const f of files) if (!index.outputs.some(r => r.path === f.path && r.sha256 === f.sha256)) return null;
    return { ...index, cached: true, data: artifacts };
  } catch { return null; }
}

export async function ingest(reference, options = {}) {
  const sourcePath = absolutePath(reference), settings = settingsFor(options.ingestion);
  let sourceStat;
  try { sourceStat = await fs.stat(sourcePath); await fs.access(sourcePath, fs.constants.R_OK); }
  catch { fail('INPUT_UNREADABLE', 'Reference file does not exist or is unreadable', { path: sourcePath }); }
  if (!sourceStat.isFile() || sourceStat.size === 0) fail('INPUT_INVALID', 'Reference must be a nonempty regular file');
  const ffmpeg = options.ffmpeg ?? 'ffmpeg', ffprobe = options.ffprobe ?? 'ffprobe';
  const tools = {};
  for (const [name, command] of Object.entries({ ffmpeg, ffprobe })) {
    const result = await runProcess(command, ['-version'], { timeoutMs: 10000 });
    tools[name] = result.stdout.split(/\r?\n/, 1)[0];
    if (!tools[name].startsWith(`${name} version `)) fail('TOOL_INVALID', `Unexpected ${name} version response`);
  }
  const sourceHash = await hashFile(sourcePath);
  const source = { path: sourcePath, sha256: sourceHash, sizeBytes: sourceStat.size };
  const review = options.boundaryReview ?? null;
  const key = hashObject({ version: INGEST_VERSION, sourceHash, sourcePath, settings, tools, ffmpeg, ffprobe, review });
  const jobDirectory = absolutePath(path.join(options.jobsDirectory ?? path.join(process.cwd(), 'jobs'), sourceHash.slice(0, 16)));
  await fs.mkdir(jobDirectory, { recursive: true });
  return withJobLock(jobDirectory, async () => {
    const cacheDirectory = path.join(jobDirectory, 'ingest', key);
    await fs.mkdir(cacheDirectory, { recursive: true });
    const indexPath = path.join(cacheDirectory, 'index.json');
    const cached = await cachedArtifacts(indexPath, key);
    if (cached) return cached;
    const runDirectory = absolutePath(path.join(cacheDirectory, randomUUID()));
    await fs.mkdir(runDirectory);
    const statePath = path.join(runDirectory, 'job-state.json');
    const state = { schemaVersion: 1, sourceHash, jobId: path.basename(jobDirectory), status: 'running', sourcePath,
      configHash: hashObject({ settings, tools, review }), toolVersions: tools,
      stages: { ingest: { status: 'running', inputHash: key, outputs: [], error: null } },
      scene: { projectPath: null, elements: {}, lastCheckpoint: null }, corrections: [], updatedAt: new Date().toISOString() };
    await validateArtifact('job-state', state); await writeJsonNew(statePath, state);
    try {
      const common = ['-v', 'error'];
      const info = await runProcess(ffprobe, [...common, '-show_streams', '-show_format', '-of', 'json', sourcePath], { timeoutMs: settings.processTimeoutMs });
      let probe; try { probe = JSON.parse(info.stdout); } catch { fail('PROBE_INVALID', 'FFprobe returned invalid metadata JSON'); }
      const stream = probe.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
      if (!stream) fail('NO_VIDEO', 'Input contains no playable video');
      if (stream.index !== probe.streams.find(s => s.codec_type === 'video')?.index) fail('STREAM_SELECTION', 'Attached cover-art video precedes the motion stream; explicit stream selection is required');
      const reportedDuration = numberOrNull(stream.duration ?? probe.format?.duration);
      if (reportedDuration !== null && reportedDuration > settings.maxDurationSeconds) fail('INPUT_DURATION_LIMIT', 'Reference exceeds configured duration limit', { reportedDuration });
      const frameResult = await runProcess(ffprobe, [...common, '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,pts_time,duration_time,pkt_duration_time', '-of', 'json', sourcePath], { timeoutMs: settings.processTimeoutMs });
      let rawFrames; try { rawFrames = JSON.parse(frameResult.stdout); } catch { fail('PROBE_INVALID', 'FFprobe returned invalid frame JSON'); }
      const metadata = normalizeMetadata(probe, rawFrames.frames ?? [], source, tools);
      const bounds = timelineBounds(metadata);
      if (bounds.duration > settings.maxDurationSeconds + 0.001) fail('INPUT_DURATION_LIMIT', 'Decoded timeline exceeds configured duration limit');
      if (metadata.video.durationSeconds === null) metadata.video.durationSeconds = bounds.duration;
      await writeJsonNew(path.join(runDirectory, 'ffprobe-raw.json'), probe);
      await writeJsonNew(path.join(runDirectory, 'ffprobe-frames.json'), rawFrames);
      const detection = await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-copyts', '-noautorotate', '-i', sourcePath, '-map', '0:v:0', '-vf', `select=gt(scene\\,${settings.sceneThreshold}),metadata=print:file=-`, '-an', '-f', 'null', '-'], { timeoutMs: settings.processTimeoutMs });
      await fs.writeFile(path.join(runDirectory, 'scene-scores.txt'), detection.stdout, { flag: 'wx' });
      let boundaries = detectBoundaries(metadata, parseSceneCandidates(detection.stdout, metadata), settings);
      if (review) boundaries = applyBoundaryReview(metadata, boundaries, review);
      const keyframes = await extractFrames(sourcePath, metadata, boundaries, settings, runDirectory, ffmpeg);
      const audio = await analyzeAudio(sourcePath, metadata, ffmpeg, settings);
      const data = { 'media-metadata': metadata, 'shot-boundaries': boundaries, keyframes, 'audio-analysis': audio };
      validateIngestRelations(data);
      const artifacts = {}, outputs = [];
      for (const name of ARTIFACTS) {
        await validateArtifact(name, data[name]);
        const record = await writeJsonNew(path.join(runDirectory, `${name}.json`), data[name]);
        artifacts[name] = record.path; outputs.push(record);
      }
      outputs.push(...keyframes.frames.map(({ path: file, sha256 }) => ({ path: file, sha256 })), keyframes.contactSheet);
      for (const file of ['ffprobe-raw.json', 'ffprobe-frames.json', 'scene-scores.txt']) outputs.push(await fileRecord(path.join(runDirectory, file)));
      if (review) outputs.push(await writeJsonNew(path.join(runDirectory, 'boundary-review-input.json'), review));
      if (await hashFile(sourcePath) !== sourceHash) fail('INPUT_CHANGED', 'Reference changed during ingestion; outputs not accepted');
      state.status = state.stages.ingest.status = 'complete'; state.stages.ingest.outputs = outputs; state.updatedAt = new Date().toISOString();
      await validateArtifact('job-state', state); await writeJsonState(statePath, state);
      const index = { version: INGEST_VERSION, key, sourceHash, jobDirectory, runDirectory, artifacts, outputs,
        statePath: absolutePath(statePath), indexPath: absolutePath(indexPath) };
      await writeJsonState(indexPath, index);
      return { ...index, cached: false, data };
    } catch (error) {
      state.status = state.stages.ingest.status = 'failed';
      state.stages.ingest.error = typeof error.toJSON === 'function' ? error.toJSON() : { code: 'INGEST_FAILED', message: error.message };
      state.updatedAt = new Date().toISOString();
      await writeJsonState(statePath, state);
      throw error;
    }
  });
}

export { captureLiveUrl, extractElementTrajectories } from './capture.ts';
export { traceWebGlShaders } from './gl.ts';
export { fitMotionCurve, fitCubicBezier, fitSpringParameters, computeVelocityCurve } from './easing.ts';
export { renderProRes4444AlphaPlate, buildProRes4444FfmpegArgs, buildCavalryAlphaPlateDescriptor } from './alpha-plate.mjs';

export function isLiveUrl(input) {
  return typeof input === 'string' && /^https?:\/\//i.test(input.trim());
}

