#!/usr/bin/env node
// Stack identical crops from multiple frames into one labelled-free strip.
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
const frameDir = take('--frames');
const out = take('--out');
const frames = (take('--list') || '').split(',').filter(Boolean).map(Number);
const [rx, ry, rw, rh] = (take('--rect') || '').split(',').map(Number);
const zoom = Number(take('--zoom', '1'));
const gap = Number(take('--gap', '2'));
if (!frameDir || !out || frames.length === 0 || !rw || !rh) {
  console.error('usage: crop-strip.mjs --frames <dir> --list 33,44 --rect x,y,w,h [--zoom 2] [--gap 2] --out strip.png');
  process.exit(2);
}
const cellW = Math.round(rw * zoom);
const cellH = Math.round(rh * zoom);
const width = cellW;
const height = frames.length * cellH + (frames.length - 1) * gap;
const outPng = new PNG({ width, height });
outPng.data.fill(255);
for (let n = 0; n < frames.length; n += 1) {
  const file = path.join(frameDir, `f-${String(frames[n]).padStart(6, '0')}.png`);
  const src = PNG.sync.read(await readFile(file));
  const baseY = n * (cellH + gap);
  for (let y = 0; y < cellH; y += 1) {
    const sy = Math.min(src.height - 1, Math.max(0, ry + Math.floor(y / zoom)));
    for (let x = 0; x < cellW; x += 1) {
      const sx = Math.min(src.width - 1, Math.max(0, rx + Math.floor(x / zoom)));
      const si = (sy * src.width + sx) * 4;
      const di = ((baseY + y) * width + x) * 4;
      outPng.data[di] = src.data[si];
      outPng.data[di + 1] = src.data[si + 1];
      outPng.data[di + 2] = src.data[si + 2];
      outPng.data[di + 3] = 255;
    }
  }
}
await writeFile(out, PNG.sync.write(outPng));
console.log(JSON.stringify({ out, frames, rect: { x: rx, y: ry, width: rw, height: rh }, zoom, strip: { width, height } }));
