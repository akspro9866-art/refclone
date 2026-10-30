#!/usr/bin/env node
// Measure text/ink regions by colour class across a frame sequence.
// Intended for light or dark flat-background shots; reports per-frame bboxes,
// row bands, palette and frame-to-frame difference.
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
const out = take('--out');
if (!frameDir || !out) {
  console.error('usage: measure-text.mjs --frames <dir> --out <json>');
  process.exit(2);
}

const files = (await readdir(frameDir)).filter((f) => /^f-\d{6}\.png$/.test(f)).sort();
function frameNo(f) { return Number(f.slice(2, 8)); }
function bbox(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (!mask[y * w + x]) continue;
    count += 1;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return count ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, right: maxX + 1, bottom: maxY + 1, count } : null;
}
function bands(mask, w, h) {
  const out = [];
  let cur = null;
  for (let y = 0; y < h; y += 1) {
    let c = 0, min = w, max = -1;
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      c += 1; if (x < min) min = x; if (x > max) max = x;
    }
    if (c > 0) {
      if (!cur) cur = { y0: y, y1: y, count: 0, min, max };
      cur.y1 = y; cur.count += c; cur.min = Math.min(cur.min, min); cur.max = Math.max(cur.max, max);
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
function palette(data, w, h, pred, top = 6) {
  const m = new Map();
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!pred(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    m.set(k, (m.get(k) ?? 0) + 1); n += 1;
  }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, c]) => ({ hex: `#${k.toString(16).padStart(6, '0')}`, count: c, share: Number((c / n).toFixed(4)) }));
}

let prev = null, prevData = null;
const frames = [];
for (const file of files) {
  const png = PNG.sync.read(await readFile(path.join(frameDir, file)));
  const { width, height, data } = png;
  const dark = new Uint8Array(width * height);
  const blue = new Uint8Array(width * height);
  const bright = new Uint8Array(width * height);
  let darkN = 0, blueN = 0, brightN = 0;
  for (let p = 0, i = 0; p < width * height; p += 1, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) <= 140) { dark[p] = 1; darkN += 1; }
    if (b - Math.max(r, g) >= 35 && b >= 100) { blue[p] = 1; blueN += 1; }
    if (Math.min(r, g, b) >= 245) { bright[p] = 1; brightN += 1; }
  }
  const rec = {
    frame: frameNo(file), width, height,
    dark: { count: darkN, bbox: bbox(dark, width, height), bands: bands(dark, width, height) },
    blue: { count: blueN, bbox: bbox(blue, width, height), bands: bands(blue, width, height) },
    bright: { count: brightN, bbox: bbox(bright, width, height) },
    palette: palette(data, width, height, (r, g, b, a) => a > 0, 8),
  };
  if (prev && prev.width === width && prev.height === height) {
    let changed = 0, total = 0, sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.max(Math.abs(data[i] - prevData[i]), Math.abs(data[i + 1] - prevData[i + 1]), Math.abs(data[i + 2] - prevData[i + 2]));
      total += 1; sum += d; if (d > 10) changed += 1;
    }
    rec.diff = { changedShare: Number((changed / total).toFixed(6)), meanMaxChannel: Number((sum / total).toFixed(3)) };
  }
  frames.push(rec);
  prev = rec; prevData = data;
}
await writeFile(out, `${JSON.stringify({ frameDirectory: frameDir.replace(/\\/g, '/'), frameCount: frames.length, frames }, null, 2)}\n`);
const compact = frames.map((f) => ({
  frame: f.frame,
  dark: f.dark.bbox && `${f.dark.bbox.x},${f.dark.bbox.y},${f.dark.bbox.width}x${f.dark.bbox.height}#${f.dark.count}`,
  blue: f.blue.bbox && `${f.blue.bbox.x},${f.blue.bbox.y},${f.blue.bbox.width}x${f.blue.bbox.height}#${f.blue.count}`,
  diff: f.diff?.changedShare,
}));
console.log(JSON.stringify({ out, first: compact[0], last: compact[compact.length - 1], distinctDark: [...new Set(compact.map((c) => c.dark))].length, distinctBlue: [...new Set(compact.map((c) => c.blue))].length }, null, 2));
