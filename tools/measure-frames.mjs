#!/usr/bin/env node
// Deterministic pixel measurements over an extracted frame sequence.
// Evidence support for reference analysis; does not modify sources or jobs.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
function take(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  args.splice(i, 2);
  return value;
}
const frameDir = take('--frames');
const outputPath = take('--out');
if (!frameDir || !outputPath) {
  console.error('usage: measure-frames.mjs --frames <dir> --out <json> [--white 190] [--dark 120]');
  process.exit(2);
}
const whiteFloor = Number(take('--white', '190'));
const darkCeil = Number(take('--dark', '120'));

const files = (await readdir(frameDir))
  .filter((f) => /^f-\d{6}\.png$/.test(f))
  .sort();

function frameNumber(file) {
  return Number(file.slice(2, 8));
}

function bboxOf(mask, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, right: maxX + 1, bottom: maxY + 1, count };
}

function bandsOf(mask, width, height, axis = 'y') {
  const bands = [];
  const limit = axis === 'y' ? height : width;
  let current = null;
  for (let line = 0; line < limit; line += 1) {
    let count = 0, min = Infinity, max = -1;
    const cross = axis === 'y' ? width : height;
    for (let c = 0; c < cross; c += 1) {
      const x = axis === 'y' ? c : line;
      const y = axis === 'y' ? line : c;
      if (!mask[y * width + x]) continue;
      count += 1;
      if (c < min) min = c;
      if (c > max) max = c;
    }
    if (count > 0) {
      if (!current) current = { start: line, end: line, count: 0, min, max };
      current.end = line;
      current.count += count;
      current.min = Math.min(current.min, min);
      current.max = Math.max(current.max, max);
    } else if (current) {
      bands.push({ start: current.start, end: current.end, length: current.end - current.start + 1, count: current.count, min: current.min, max: current.max });
      current = null;
    }
  }
  if (current) bands.push({ start: current.start, end: current.end, length: current.end - current.start + 1, count: current.count, min: current.min, max: current.max });
  return bands;
}

function paletteOf(data, width, height, top = 8) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, top)
    .map(([key, count]) => ({
      hex: `#${key.toString(16).padStart(6, '0')}`,
      rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255],
      count,
      share: Number((count / (width * height)).toFixed(6)),
    }));
}

let previous = null;
let previousData = null;
let previousWhite = null;
const frames = [];
for (const file of files) {
  const buffer = await readFile(path.join(frameDir, file));
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const white = new Uint8Array(width * height);
  const dark = new Uint8Array(width * height);
  let whiteCount = 0, darkCount = 0;
  for (let p = 0, i = 0; p < width * height; p += 1, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const min = Math.min(r, g, b), max = Math.max(r, g, b);
    if (min >= whiteFloor && max - min <= 40) { white[p] = 1; whiteCount += 1; }
    if (max <= darkCeil) { dark[p] = 1; darkCount += 1; }
  }
  const record = {
    frame: frameNumber(file),
    file,
    width,
    height,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    palette: paletteOf(data, width, height),
    white: { count: whiteCount, bbox: bboxOf(white, width, height), rowBands: bandsOf(white, width, height, 'y') },
    dark: { count: darkCount, bbox: bboxOf(dark, width, height) },
  };
  if (previous && previous.width === width && previous.height === height) {
    let sum = 0, maxDelta = 0, changed = 0, pixels = 0, nonWhitePixels = 0, nonWhiteChanged = 0;
    for (let p = 0, i = 0; p < width * height; p += 1, i += 4) {
      const dr = Math.abs(data[i] - previousData[i]);
      const dg = Math.abs(data[i + 1] - previousData[i + 1]);
      const db = Math.abs(data[i + 2] - previousData[i + 2]);
      const delta = Math.max(dr, dg, db);
      pixels += 1;
      sum += dr + dg + db;
      if (delta > maxDelta) maxDelta = delta;
      if (delta > 10) changed += 1;
      if (!white[p] && !previousWhite[p]) {
        nonWhitePixels += 1;
        if (delta > 10) nonWhiteChanged += 1;
      }
    }
    record.diffFromPrevious = {
      meanChannelAbs: Number((sum / (pixels * 3)).toFixed(4)),
      maxChannelAbs: maxDelta,
      changedShare: Number((changed / pixels).toFixed(6)),
      nonWhiteChangedShare: nonWhitePixels ? Number((nonWhiteChanged / nonWhitePixels).toFixed(8)) : null,
      nonWhiteChangedPixels: nonWhiteChanged,
    };
  }
  frames.push(record);
  previous = record;
  previousData = data;
  previousWhite = white;
}

const whites = frames.filter((f) => f.white.count > 0);
let whiteRun = null;
const whiteRuns = [];
for (const f of frames) {
  if (f.white.count > 0) {
    if (!whiteRun) whiteRun = { start: f.frame, end: f.frame, frames: 1, bboxes: [] };
    whiteRun.end = f.frame;
    whiteRun.frames += 1;
    whiteRun.bboxes.push({ frame: f.frame, ...f.white.bbox });
  } else if (whiteRun) {
    whiteRuns.push(whiteRun);
    whiteRun = null;
  }
}
if (whiteRun) whiteRuns.push(whiteRun);

const staticRuns = [];
let staticRun = null;
for (const f of frames) {
  const diff = f.diffFromPrevious;
  const isStatic = diff && diff.nonWhiteChangedShare !== null && diff.nonWhiteChangedShare <= 0.000001;
  if (isStatic) {
    if (!staticRun) staticRun = { start: f.frame - 1, end: f.frame, frames: 2 };
    staticRun.end = f.frame;
    staticRun.frames += 1;
  } else if (staticRun) {
    staticRuns.push(staticRun);
    staticRun = null;
  }
}
if (staticRun) staticRuns.push(staticRun);

const report = {
  schema: 'refclone/measurement-report@1',
  frameDirectory: frameDir.replace(/\\/g, '/'),
  thresholds: { whiteFloor, whiteChromaMax: 40, darkCeil, changedDelta: 10 },
  frameCount: frames.length,
  frames,
  summary: {
    whiteRuns,
    framesWithNoWhite: frames.filter((f) => f.white.count === 0).map((f) => f.frame),
    staticNonWhiteRuns: staticRuns,
  },
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  out: outputPath,
  frames: frames.length,
  whiteRuns: whiteRuns.map((r) => ({ start: r.start, end: r.end, frames: r.frames, firstBbox: r.bboxes[0], lastBbox: r.bboxes[r.bboxes.length - 1] })),
  staticNonWhiteRuns: staticRuns,
  noWhiteFrames: report.summary.framesWithNoWhite.slice(0, 20),
}, null, 2));
