#!/usr/bin/env node
// Coarse-to-fine 2D patch match between two PNG frames.
// Reports the offset (dx, dy) at which the source patch best matches the target.
import { readFile } from 'node:fs/promises';
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
const fileA = take('--a');
const fileB = take('--b');
const rect = (take('--rect') || '').split(',').map(Number);
const rangeX = Number(take('--range-x', '200'));
const rangeY = Number(take('--range-y', '200'));
const scale = Number(take('--scale', '4'));
if (!fileA || !fileB || rect.length !== 4) {
  console.error('usage: match-patch.mjs --a prev.png --b next.png --rect x,y,w,h [--range-x 200] [--range-y 200] [--scale 4]');
  process.exit(2);
}
const A = PNG.sync.read(await readFile(fileA));
const B = PNG.sync.read(await readFile(fileB));
const [rx, ry, rw, rh] = rect;

function lum(png, x, y) {
  const i = (y * png.width + x) * 4;
  return (png.data[i] * 299 + png.data[i + 1] * 587 + png.data[i + 2] * 114) / 1000;
}
function sadAt(ox, oy, step) {
  let sum = 0, n = 0;
  for (let y = 0; y < rh; y += step) {
    const sy = ry + y;
    const ty = sy + oy;
    if (sy < 0 || sy >= A.height || ty < 0 || ty >= B.height) continue;
    for (let x = 0; x < rw; x += step) {
      const sx = rx + x;
      const tx = sx + ox;
      if (sx < 0 || sx >= A.width || tx < 0 || tx >= B.width) continue;
      sum += Math.abs(lum(A, sx, sy) - lum(B, tx, ty));
      n += 1;
    }
  }
  return n ? sum / n : Infinity;
}
let best = { dx: 0, dy: 0, cost: Infinity };
for (let dy = -rangeY; dy <= rangeY; dy += scale) {
  for (let dx = -rangeX; dx <= rangeX; dx += scale) {
    const cost = sadAt(dx, dy, scale);
    if (cost < best.cost) best = { dx, dy, cost };
  }
}
let fine = { ...best };
for (let dy = best.dy - scale; dy <= best.dy + scale; dy += 1) {
  for (let dx = best.dx - scale; dx <= best.dx + scale; dx += 1) {
    const cost = sadAt(dx, dy, 1);
    if (cost < fine.cost) fine = { dx, dy, cost };
  }
}
const result = {
  a: fileA.replace(/\\/g, '/'),
  b: fileB.replace(/\\/g, '/'),
  rect: { x: rx, y: ry, width: rw, height: rh },
  search: { rangeX, rangeY, coarseStep: scale },
  best: { dx: fine.dx, dy: fine.dy, meanAbsLuma: Number(fine.cost.toFixed(3)) },
  coarseBest: { dx: best.dx, dy: best.dy, meanAbsLuma: Number(best.cost.toFixed(3)) },
};
console.log(JSON.stringify(result, null, 2));
