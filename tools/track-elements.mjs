#!/usr/bin/env node
// Build element motion tracks from dense reference frames.
// Outputs measured pixel boxes per frame; no semantic interpretation.
import { readFile, writeFile } from 'node:fs/promises';
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
const root = take('--frames');
const out = take('--out');
if (!root || !out) {
  console.error('usage: track-elements.mjs --frames <review-frames-dir> --out <json>');
  process.exit(2);
}

function groups(mask, w, h, gap = 6) {
  const cols = new Uint8Array(w);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (mask[y * w + x]) cols[x] = 1;
  const boxes = [];
  let x = 0;
  while (x < w) {
    while (x < w && !cols[x]) x += 1;
    if (x >= w) break;
    const start = x;
    let last = x;
    while (x < w) {
      if (cols[x]) last = x;
      if (x - last > gap) break;
      x += 1;
    }
    let minY = h, maxY = -1, count = 0;
    for (let y = 0; y < h; y += 1) for (let xx = start; xx <= last; xx += 1) if (mask[y * w + xx]) {
      count += 1; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (count > 30) boxes.push({ x: start, right: last + 1, width: last - start + 1, y: minY, height: maxY - minY + 1, pixels: count });
  }
  return boxes;
}

function masks(png) {
  const { width, height, data } = png;
  const dark = new Uint8Array(width * height);
  const blue = new Uint8Array(width * height);
  const white = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < width * height; p += 1, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) <= 140) dark[p] = 1;
    if (b - Math.max(r, g) >= 70 && b >= 150) blue[p] = 1;
    if (Math.min(r, g, b) >= 190) white[p] = 1;
  }
  return { dark, blue, white, width, height };
}

function union(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (mask[y * w + x]) {
    count += 1; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return count ? { x: x0, y: y0, right: x1 + 1, bottom: y1 + 1, width: x1 - x0 + 1, height: y1 - y0 + 1, pixels: count } : null;
}

async function frame(dir, n) {
  return PNG.sync.read(await readFile(path.join(root, dir, `f-${String(n).padStart(6, '0')}.png`)));
}

const report = { schema: 'refclone/element-tracks@1', shots: {} };

const shot1 = [];
for (let n = 0; n <= 27; n += 1) {
  const png = await frame('shot1', n), m = masks(png);
  shot1.push({ frame: n, words: groups(m.dark, m.width, m.height) });
}
report.shots.shot001 = { words: shot1 };

const shot3 = [];
for (let n = 127; n <= 167; n += 1) {
  const png = await frame('shot3', n), m = masks(png);
  shot3.push({ frame: n, words: groups(m.dark, m.width, m.height), blue: union(m.blue, m.width, m.height) });
}
report.shots.shot003 = { words: shot3 };

const shot2 = [];
for (let n = 28; n <= 126; n += 1) {
  const png = await frame('shot2', n), m = masks(png);
  shot2.push({ frame: n, highlight: union(m.white, m.width, m.height) });
}
report.shots.shot002 = { highlight: shot2 };

const shot4 = [];
for (let n = 168; n <= 215; n += 1) {
  const png = await frame('shot4', n), m = masks(png);
  shot4.push({ frame: n, white: union(m.white, m.width, m.height), blue: union(m.blue, m.width, m.height) });
}
report.shots.shot004 = { logo: shot4 };

await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  out,
  shot001: { frames: shot1.length, first: shot1[0], last: shot1[shot1.length - 1] },
  shot003: { frames: shot3.length, first: shot3[0], last: shot3[shot3.length - 1] },
  shot002: { frames: shot2.length, first: shot2[0], last: shot2[shot2.length - 1] },
  shot004: { frames: shot4.length, first: shot4[0], last: shot4[shot4.length - 1] },
}, null, 2));
