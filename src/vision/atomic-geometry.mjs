/**
 * Stage 5 geometry and colour measurement for atomic convergence.
 *
 * Box normalisation, expected-box interpolation, snapshot-layer matching and
 * the pixel crops/colour statistics the convergence gate consumes. These are
 * pure helpers over already-decoded frames; the loop that applies them lives
 * in atomic-convergence.mjs.
 */

import fs from 'node:fs';
import { PNG } from 'pngjs';

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
export const numeric = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
export const round4 = value => Number(Number(value).toFixed(4));
export const round6 = value => Number(Number(value).toFixed(6));
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function isPixelFrame(frame) {
  return Boolean(frame)
    && isFiniteNumber(frame.width) && frame.width > 0
    && isFiniteNumber(frame.height) && frame.height > 0
    && frame.data
    && typeof frame.data.length === 'number';
}

export function decodeImage(entry) {
  if (!entry) return null;
  if (isPixelFrame(entry)) return { width: entry.width, height: entry.height, data: entry.data };
  if (isPixelFrame(entry.png)) return entry.png;
  if (typeof entry.pngBase64 === 'string' && entry.pngBase64.length > 0) {
    try {
      return PNG.sync.read(Buffer.from(entry.pngBase64, 'base64'));
    } catch {
      return null;
    }
  }
  const file = typeof entry.file === 'string' ? entry.file : (typeof entry.path === 'string' ? entry.path : '');
  if (!file) return null;
  try {
    return PNG.sync.read(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export function normalizeBox(box, space, frameWidth, frameHeight) {
  if (!box) return null;
  const raw = Array.isArray(box)
    ? { x: box[0], y: box[1], width: box[2], height: box[3] }
    : box;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (space === 'pixels') return { x, y, width, height };
  return {
    x: x * frameWidth,
    y: y * frameHeight,
    width: width * frameWidth,
    height: height * frameHeight
  };
}

export function expectedBoxMap(boxes) {
  const map = new Map();
  if (Array.isArray(boxes)) {
    for (const entry of boxes) {
      const frame = Math.round(Number(entry?.frame));
      if (!Number.isFinite(frame)) continue;
      const box = { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
      if (normalizeBox(box, 'normalized', 1, 1)) map.set(frame, box);
    }
  } else if (boxes && typeof boxes === 'object') {
    for (const [key, value] of Object.entries(boxes)) {
      const frame = Math.round(Number(key));
      if (!Number.isFinite(frame)) continue;
      if (Array.isArray(value)) {
        const [x, y, width, height] = value;
        const box = { x, y, width, height };
        if (normalizeBox(box, 'normalized', 1, 1)) map.set(frame, box);
      } else if (value && typeof value === 'object') {
        map.set(frame, { ...value });
      }
    }
  }
  return map;
}

export function boxListRange(pixelBoxes) {
  // Variation across samples, not the size of one sample: a single static box
  // must stay static even though its extent is larger than the epsilon.
  if (pixelBoxes.size < 2) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minWidth = Infinity;
  let minHeight = Infinity;
  let maxWidth = -Infinity;
  let maxHeight = -Infinity;
  for (const box of pixelBoxes.values()) {
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;
    minX = Math.min(minX, centreX);
    minY = Math.min(minY, centreY);
    maxX = Math.max(maxX, centreX);
    maxY = Math.max(maxY, centreY);
    minWidth = Math.min(minWidth, box.width);
    minHeight = Math.min(minHeight, box.height);
    maxWidth = Math.max(maxWidth, box.width);
    maxHeight = Math.max(maxHeight, box.height);
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.max(maxX - minX, maxY - minY, maxWidth - minWidth, maxHeight - minHeight);
}

export function interpolateBox(pixelBoxes, frame) {
  const exact = pixelBoxes.get(frame);
  if (exact) return { ...exact };
  const frames = [...pixelBoxes.keys()].sort((a, b) => a - b);
  if (frames.length === 0) return null;
  // Outside the measured range the layer is not expected to exist; clamping a
  // box into a frame the tracker never observed would invent evidence.
  if (frame < frames[0] || frame > frames[frames.length - 1]) return null;
  for (let index = 1; index < frames.length; index += 1) {
    const previousFrame = frames[index - 1];
    const currentFrame = frames[index];
    if (frame > currentFrame) continue;
    const span = currentFrame - previousFrame;
    const t = span > 0 ? (frame - previousFrame) / span : 0;
    const a = pixelBoxes.get(previousFrame);
    const b = pixelBoxes.get(currentFrame);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      width: a.width + (b.width - a.width) * t,
      height: a.height + (b.height - a.height) * t
    };
  }
  return { ...pixelBoxes.get(frames[frames.length - 1]) };
}

export function snapshotLayerBox(layer) {
  const box = layer?.bbox ?? layer?.boundingBox ?? layer?.worldBoundingBox ?? layer?.compBoundingBox;
  if (!box || typeof box !== 'object') return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function matchLayer(expected, snapshotFrame, resolver) {
  const candidates = Array.isArray(snapshotFrame?.layers)
    ? snapshotFrame.layers.filter(layer => layer && layer.visible !== false && snapshotLayerBox(layer))
    : [];
  if (candidates.length === 0) return null;

  if (typeof resolver === 'function') {
    const resolved = resolver(expected, snapshotFrame);
    if (resolved) return resolved;
  }

  const match = expected.match ?? {};
  const tests = [];
  if (match.id != null) tests.push(layer => String(layer.id) === String(match.id));
  if (match.ref != null) tests.push(layer => String(layer.ref) === String(match.ref));
  const names = [].concat(match.name ?? [], match.names ?? [])
    .filter(value => value != null)
    .map(String);
  for (const name of names) tests.push(layer => String(layer.name) === name);
  const fallbacks = [expected.name, expected.elementId, expected.key]
    .filter(value => value != null)
    .map(String);
  for (const name of fallbacks) tests.push(layer => String(layer.name) === name);

  for (const test of tests) {
    const hit = candidates.find(test);
    if (hit) return hit;
  }
  return null;
}

export function boxCentre(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function compareBoxes(expected, rendered) {
  const expectedCentre = boxCentre(expected);
  const renderedCentre = boxCentre(rendered);
  const dx = expectedCentre.x - renderedCentre.x;
  const dy = expectedCentre.y - renderedCentre.y;
  const centreDistance = Math.hypot(dx, dy);
  const widthDelta = expected.width - rendered.width;
  const heightDelta = expected.height - rendered.height;
  return {
    dx: round6(dx),
    dy: round6(dy),
    centreDistance: round6(centreDistance),
    widthDelta: round6(widthDelta),
    heightDelta: round6(heightDelta),
    driftPx: round6(Math.max(centreDistance, Math.abs(widthDelta), Math.abs(heightDelta)))
  };
}

function clampBox(box, frameWidth, frameHeight) {
  const x0 = clamp(Math.floor(box.x), 0, frameWidth);
  const y0 = clamp(Math.floor(box.y), 0, frameHeight);
  const x1 = clamp(Math.ceil(box.x + box.width), 0, frameWidth);
  const y1 = clamp(Math.ceil(box.y + box.height), 0, frameHeight);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function unionBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function cropFrame(png, box) {
  if (!isPixelFrame(png) || !box) return null;
  const clamped = clampBox(box, png.width, png.height);
  if (!clamped || clamped.width < 2 || clamped.height < 2) return null;
  const data = new Uint8Array(clamped.width * clamped.height * 4);
  for (let row = 0; row < clamped.height; row += 1) {
    const sourceStart = ((clamped.y + row) * png.width + clamped.x) * 4;
    const targetStart = row * clamped.width * 4;
    data.set(png.data.subarray(sourceStart, sourceStart + clamped.width * 4), targetStart);
  }
  return { width: clamped.width, height: clamped.height, data };
}

/**
 * Alpha-weighted mean colour inside a box. Weighting by alpha estimates the
 * element's own fill instead of blending transparent pixels into it; a plain
 * mean over an antialiased edge would read darker than the paint.
 */
export function meanColour(png, box) {
  if (!isPixelFrame(png) || !box) return null;
  const clamped = clampBox(box, png.width, png.height);
  if (!clamped) return null;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let y = clamped.y; y < clamped.y + clamped.height; y += 1) {
    for (let x = clamped.x; x < clamped.x + clamped.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const alpha = png.data[offset + 3] / 255;
      red += png.data[offset] * alpha;
      green += png.data[offset + 1] * alpha;
      blue += png.data[offset + 2] * alpha;
      weight += alpha;
    }
  }
  if (weight <= 0) return null;
  return { r: red / weight / 255, g: green / weight / 255, b: blue / weight / 255 };
}

export function compareColour(reference, rendered) {
  if (!reference || !rendered) return null;
  const dr = reference.r - rendered.r;
  const dg = reference.g - rendered.g;
  const db = reference.b - rendered.b;
  return {
    r: round6(dr),
    g: round6(dg),
    b: round6(db),
    magnitude: round6(Math.sqrt((dr * dr + dg * dg + db * db) / 3))
  };
}

export function normalizeSnapshotResult(result) {
  const source = Array.isArray(result)
    ? result
    : Array.isArray(result?.decodedFrames) && result.decodedFrames.length
      ? result.decodedFrames
      : Array.isArray(result?.frames)
        ? result.frames
        : Array.isArray(result?.decoded)
          ? result.decoded
          : [];
  const frames = new Map();
  for (const entry of source) {
    const frame = Math.round(Number(entry?.frame));
    if (!Number.isFinite(frame)) continue;
    let png = isPixelFrame(entry?.png) ? entry.png : null;
    if (!png) png = decodeImage(entry);
    frames.set(frame, {
      frame,
      png,
      layers: Array.isArray(entry?.layers) ? entry.layers : [],
      exists: entry?.exists !== false,
      frameHash: entry?.frameHash ?? null,
      error: entry?.error ?? null
    });
  }
  return {
    frames,
    digest: Array.isArray(result) ? null : (result?.digest ?? null),
    requested: Array.isArray(result?.requested) ? result.requested : null,
    missing: Array.isArray(result?.undecodedFrames) ? result.undecodedFrames : []
  };
}
