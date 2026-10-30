#!/usr/bin/env node
// Estimate dominant integer translation between consecutive PNG frames using
// column/row projection matching on "ink" pixels (non-background, non-white).
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
const backgroundHex = take('--background', '#2c55d4');
const range = Number(take('--range', '8'));
if (!frameDir || !outputPath) {
  console.error('usage: measure-shift.mjs --frames <dir> --out <json> [--background #rrggbb] [--range 8]');
  process.exit(2);
}
const bg = [1, 3, 5].map((i) => parseInt(backgroundHex.slice(i, i + 2), 16));

const files = (await readdir(frameDir)).filter((f) => /^f-\d{6}\.png$/.test(f)).sort();

function profiles(png) {
  const { width, height, data } = png;
  const col = new Float64Array(width);
  const row = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const min = Math.min(r, g, b), max = Math.max(r, g, b);
      if (min >= 190 && max - min <= 40) continue; // white highlight excluded
      const dist = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
      if (dist <= 50) continue;
      col[x] += 1;
      row[y] += 1;
    }
  }
  return { col, row, width, height };
}

function bestShift(a, b, maxShift) {
  let best = { shift: 0, cost: Infinity };
  const scores = [];
  for (let s = -maxShift; s <= maxShift; s += 1) {
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i += 1) {
      const j = i + s;
      if (j < 0 || j >= b.length) continue;
      const d = a[i] - b[j];
      sum += d * d;
      n += 1;
    }
    const cost = n ? sum / n : Infinity;
    scores.push({ shift: s, cost: Number(cost.toFixed(2)) });
    if (cost < best.cost) best = { shift: s, cost };
  }
  return { ...best, scores };
}

let previous = null;
let previousFile = null;
const results = [];
for (const file of files) {
  const png = PNG.sync.read(await readFile(path.join(frameDir, file)));
  const p = profiles(png);
  if (previous) {
    // If current content moved LEFT by dx, current profile[i] == previous[i+dx].
    const x = bestShift(p.col, previous.col, range);
    const y = bestShift(p.row, previous.row, range);
    results.push({
      from: Number(previousFile.slice(2, 8)),
      to: Number(file.slice(2, 8)),
      dxLeft: x.shift,
      dxCost: Number(x.cost.toFixed(2)),
      dyDown: y.shift,
      dyCost: Number(y.cost.toFixed(2)),
    });
  }
  previous = p;
  previousFile = file;
}

await writeFile(outputPath, `${JSON.stringify({ frameDirectory: frameDir.replace(/\\/g, '/'), background: backgroundHex, results }, null, 2)}\n`);
const summary = results.map((r) => `${r.from}->${r.to} dx=${r.dxLeft} dy=${r.dyDown}`);
console.log(summary.join('\n'));
