// Per-band sub-pixel motion measurement.
//
// A whole-frame ink centroid cannot tell a 0.3 px row drift from a reflow, and an
// integer cross-correlation cannot resolve the easing the reference actually shows.
// This module measures one ink profile per band, aligns each frame against one
// anchored reference frame by normalized cross-correlation of an interpolated
// profile, and separately tracks the gaps between words so a band can be shown to
// carry its content rigidly — or not.
//
// The signal is a soft ink weight, not a binarized mask: a binarized profile is a
// step function whose edge pixels are all-or-nothing, so a half-pixel translation
// of antialiased type either leaves it identical or moves it a whole pixel, and any
// sub-pixel number read off it is an artefact of the threshold. `weight(pixel)`
// below is max channel distance from the modal background over 255, which is exactly
// linear in edge coverage for any alpha blend — so the sub-pixel information is
// present in the measurement rather than invented by the interpolation.
//
// Everything here is a pure function of decoded pixels: no plan, no scene, no
// interpretation. A value the pixels do not support is reported as null with its
// reason, never as a plausible number.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

export const BAND_TRACKING_SCHEMA = 'refclone/band-tracks@1';

export const DEFAULT_BAND_OPTIONS = {
  background: '#2c55d4',
  axis: 'x',
  rangePx: 24,
  upsample: 8,
  // Band discovery is calibrated per frame, not by a constant: an absolute ink sum of 1
  // makes every row of a real 736-px frame "ink", which collapses the whole frame into
  // one useless band. `minRowInkRatio` is resolved against the domain width, so a row
  // counts once 2% of its columns carry ink — one text line does that easily, JPEG noise
  // across a flat background does not. An explicit minRowInk overrides the ratio.
  minRowInk: null,
  minRowInkRatio: 0.02,
  minRowGap: 1,
  minGapPx: 6,
  gapWeight: 0.5,
  anchorWindowPx: 12,
  maxBands: 32,
  maxAnchors: 8,
  anchors: true
};

function roundTo(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  // Negating a measured zero produces -0, which reads as a directional claim in a
  // report and a patch payload that says nothing moved.
  return rounded === 0 ? 0 : rounded;
}

function hexToRgb(hex) {
  const value = String(hex ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`Background must be #rrggbb, got "${hex}".`);
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
}

/**
 * Soft ink weight per pixel, in [0, 1].
 *
 * `max |channel - background| / 255`, times alpha. A pixel that is an alpha blend
 * of ink over the background scores proportionally to its coverage, so the profile
 * built from these weights is a linear encoding of sub-pixel edge position.
 * Transparent pixels are 0: nothing was drawn there.
 */
export function inkField({ width, height, data }, options = {}) {
  const bg = hexToRgb(options.background ?? DEFAULT_BAND_OPTIONS.background);
  const field = new Float64Array(width * height);
  for (let pixel = 0, index = 0; pixel < field.length; pixel += 1, index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    const distance = Math.max(
      Math.abs(data[index] - bg[0]),
      Math.abs(data[index + 1] - bg[1]),
      Math.abs(data[index + 2] - bg[2])
    );
    field[pixel] = (distance / 255) * (alpha / 255);
  }
  return field;
}

/**
 * Ink weight per line along the measurement axis, summed across the band.
 *
 * For axis 'x' the band is a row range and the profile has one value per column;
 * for axis 'y' the band is a column range and the profile has one value per row.
 * The returned `origin` is the coordinate of `profile[0]`, which every reported
 * position needs to stay in the frame's own pixel space.
 */
export function lineProfile(field, { width, height, axis = 'x', bandStart = 0, bandEnd = null, domainStart = 0, domainEnd = null }) {
  const b0 = Math.max(0, bandStart);
  const b1 = Math.min(axis === 'x' ? height : width, bandEnd ?? (axis === 'x' ? height : width));
  const d1 = domainEnd ?? (axis === 'x' ? width : height);
  const length = Math.max(0, d1 - domainStart);
  const profile = new Float64Array(length);
  for (let line = domainStart; line < d1; line += 1) {
    let sum = 0;
    for (let cross = b0; cross < b1; cross += 1) {
      const x = axis === 'x' ? line : cross;
      const y = axis === 'x' ? cross : line;
      sum += field[y * width + x];
    }
    profile[line - domainStart] = sum;
  }
  return { profile, origin: domainStart };
}

/** Ink weight per row across a column range — the input to band discovery. */
export function rowInk(field, { width, height, from = 0, to = null }) {
  const rows = new Float64Array(height);
  const end = to ?? width;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = from; x < end; x += 1) sum += field[y * width + x];
    rows[y] = sum;
  }
  return rows;
}

/**
 * Maximal runs of rows carrying ink, merged across gaps shorter than `minGap`.
 * One text line becomes one band. `start`/`end` are [start, endExclusive).
 */
export function findRowBands(rows, { minInk = 1, minGap = DEFAULT_BAND_OPTIONS.minRowGap } = {}) {
  const runs = [];
  let current = null;
  for (let y = 0; y < rows.length; y += 1) {
    if (rows[y] >= minInk) {
      if (!current) current = { start: y, end: y, ink: 0 };
      current.end = y;
      current.ink += rows[y];
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  const merged = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous && run.start - previous.end < minGap) {
      previous.end = run.end;
      previous.ink += run.ink;
    } else {
      merged.push({ ...run });
    }
  }
  return merged.map((band, index) => ({
    index,
    id: `rows-${band.start}-${band.end + 1}`,
    start: band.start,
    end: band.end + 1,
    height: band.end - band.start + 1,
    ink: roundTo(band.ink, 4)
  }));
}

/**
 * Modal colour of a decoded frame, in the `#rrggbb` form `inkField` expects.
 *
 * A flat background dominates by pixel count, so the mode is the background estimate
 * that costs no assumptions about the foreground. `sample` strides the scan because a
 * 4K frame's mode is not changed by the ten thousand pixels nobody looked at.
 */
export function modalBackground(png, { sample = 3 } = {}) {
  const counts = new Map();
  let total = 0;
  for (let y = 0; y < png.height; y += sample) {
    for (let x = 0; x < png.width; x += sample) {
      const at = (y * png.width + x) * 4;
      if (png.data[at + 3] === 0) continue;
      const key = (png.data[at] << 16) | (png.data[at + 1] << 8) | png.data[at + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  let best = null, bestCount = 0;
  for (const [key, count] of counts) if (count > bestCount) { best = key; bestCount = count; }
  if (best === null) return { hex: null, rgb: null, fraction: 0 };
  const rgb = [(best >> 16) & 255, (best >> 8) & 255, best & 255];
  return {
    hex: `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`,
    rgb,
    fraction: total ? Math.round((bestCount / total) * 1e4) / 1e4 : 0
  };
}

/**
 * The ink bands of one frame, as full-frame rectangles.
 *
 * Same discovery `trackBands` runs when no band list is supplied, but returned as
 * rectangles for anyone who wants to *score* a band rather than track it across frames:
 * QA's regions and Stage 5's drift bands come from here, so "row 50 to 78" means the
 * same pixels in both. `maxBands` keeps the inkiest bands, because a frame dense enough
 * to overflow the cap is better served by its loudest lines than by its first ones.
 */
export function inkRects(png, options = {}) {
  const settings = { ...DEFAULT_BAND_OPTIONS, ...options };
  const background = settings.background ?? modalBackground(png).hex;
  if (!background) throw new Error('The frame carries no pixel data, so no background can be measured.');
  const field = inkField(png, { background });
  const domainStart = settings.domainStart ?? 0;
  const domainEnd = settings.domainEnd ?? png.width;
  const rowStart = settings.rowStart ?? 0;
  const rowEnd = settings.rowEnd ?? png.height;
  const minInk = settings.minRowInk ?? Math.max(1, Math.round(settings.minRowInkRatio * Math.max(1, domainEnd - domainStart)));
  const rows = rowInk(field, { width: png.width, height: png.height, from: domainStart, to: domainEnd }).subarray(rowStart, rowEnd);
  const found = findRowBands(rows, { minInk, minGap: settings.minRowGap }).map(band => ({
    index: band.index,
    id: `rows-${band.start + rowStart}-${band.end + rowStart}`,
    start: band.start + rowStart,
    end: band.end + rowStart,
    height: band.height,
    ink: band.ink
  }));
  const kept = found.length > settings.maxBands
    ? [...found].sort((a, b) => b.ink - a.ink).slice(0, settings.maxBands).sort((a, b) => a.start - b.start)
    : found;
  return {
    background,
    minInk,
    found: found.length,
    truncated: Math.max(0, found.length - kept.length),
    bands: kept.map(band => ({ ...band, rect: { x: domainStart, y: band.start, width: domainEnd - domainStart, height: band.height } }))
  };
}

/**
 * Sub-pixel displacement of one rectangle of `render` against the same rectangle of
 * `reference`, on both axes, from the same soft-ink profiles the motion measurement
 * uses.
 *
 * This is the one definition of "the render sits d px to the right" that the pipeline
 * has: QA's region scores and Stage 5's patch candidates are both read through it, so
 * a number in a report and a number in a patch cannot come from different measurements.
 * Sign: positive dxPx/dyPx means the render content sits right of or below the
 * reference content, so the correction a layer needs is the negation — `correctionPx`
 * carries that already, in the units a position attribute takes.
 * A flat band, a band whose competing peak is as good as its winner, and a band that
 * is too short to correlate are all refusals with a reason, never a plausible zero.
 */
export function rectDisplacement(reference, render, rect, options = {}) {
  const settings = { ...DEFAULT_BAND_OPTIONS, ...options };
  const empty = {
    measured: false, dxPx: null, dyPx: null, correctionPx: null, score: { x: null, y: null },
    marginPx: { x: null, y: null }, peakWidthPx: { x: null, y: null }, quantumPx: roundTo(1 / settings.upsample, 6),
    noiseFloorPx: settings.noiseFloorPx ?? roundTo(1 / settings.upsample, 6),
    aboveNoiseFloor: false, reason: null
  };
  const background = settings.background ?? modalBackground(reference).hex;
  if (!background) return { ...empty, reason: 'no-background' };
  if (!Number.isInteger(rect.width) || !Number.isInteger(rect.height) || rect.width < 4 || rect.height < 4) {
    return { ...empty, reason: `rect is ${rect.width}x${rect.height}, under the 4 px a profile needs` };
  }
  if (reference.width !== render.width || reference.height !== render.height) {
    return { ...empty, reason: `rasters differ (${reference.width}x${reference.height} vs ${render.width}x${render.height})` };
  }
  const fieldA = settings.fields?.reference ?? inkField(reference, { background });
  const fieldB = settings.fields?.render ?? inkField(render, { background });
  const factor = settings.upsample;
  const search = { rangePx: settings.rangePx, upsample: factor };
  const axes = {};
  for (const axis of ['x', 'y']) {
    const frame = { width: reference.width, height: reference.height, axis };
    const window = axis === 'x'
      ? { bandStart: rect.y, bandEnd: rect.y + rect.height, domainStart: rect.x, domainEnd: rect.x + rect.width }
      : { bandStart: rect.x, bandEnd: rect.x + rect.width, domainStart: rect.y, domainEnd: rect.y + rect.height };
    const a = lineProfile(fieldA, { ...frame, ...window }).profile;
    const b = lineProfile(fieldB, { ...frame, ...window }).profile;
    axes[axis] = trackProfile(a, b, search);
  }
  const measured = Number.isFinite(axes.x.dxPx) && Number.isFinite(axes.y.dxPx);
  const noiseFloorPx = settings.noiseFloorPx ?? roundTo(1 / factor, 6);
  return {
    measured,
    dxPx: axes.x.dxPx, dyPx: axes.y.dxPx,
    correctionPx: measured ? { dx: roundTo(-axes.x.dxPx, 4), dy: roundTo(-axes.y.dxPx, 4) } : null,
    score: { x: axes.x.score, y: axes.y.score },
    marginPx: { x: axes.x.marginPx, y: axes.y.marginPx },
    peakWidthPx: { x: axes.x.peakWidthPx, y: axes.y.peakWidthPx },
    quantumPx: axes.x.quantumPx ?? roundTo(1 / factor, 6),
    noiseFloorPx: roundTo(noiseFloorPx, 6),
    aboveNoiseFloor: measured && (Math.abs(axes.x.dxPx) > noiseFloorPx || Math.abs(axes.y.dxPx) > noiseFloorPx),
    reason: measured ? null : (axes.x.reason ?? axes.y.reason) ?? 'unmeasurable',
    background
  };
}

/**
 * Linear resampling of a 1-D profile by an integer factor.
 *
 * Sample `out[j]` stands for the profile value at coordinate `j / factor`. Linear
 * is deliberate: it is deterministic, adds no ringing, and cannot invent an edge
 * the pixels do not contain. The sub-pixel information is already in the soft
 * weights, so the interpolation is a coordinate change rather than a guess.
 */
export function resample(profile, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new Error(`Upsample factor must be an integer >= 1, got ${factor}.`);
  const n = profile.length;
  if (n === 0) return new Float64Array(0);
  if (factor === 1) return Float64Array.from(profile);
  const out = new Float64Array(n * factor);
  const last = n - 1;
  for (let j = 0; j < out.length; j += 1) {
    const t = j / factor;
    const i0 = Math.min(last, Math.floor(t));
    const i1 = Math.min(last, i0 + 1);
    const f = t - i0;
    out[j] = profile[i0] * (1 - f) + profile[i1] * f;
  }
  return out;
}

/**
 * Normalized cross-correlation of `reference` against `target` at one sub-pixel
 * shift, over the reference window [from, to).
 *
 * `target` is resampled, so `shift` counts sub-pixels: coordinate `j` of `target`
 * stands for original position `j / factor`. Comparing `reference[i]` with
 * `target[i * factor + shift]` means content that moved right by d peaks at
 * `shift = d * factor`. That is the sign convention the whole module follows.
 * NCC is invariant to a scale factor on either profile, so a per-frame change of
 * overall ink strength cannot move the peak.
 */
export function nccAt(reference, target, shift, { factor = 1, from = 0, to = null, minSamples = 8 } = {}) {
  const end = Math.min(to ?? reference.length, reference.length);
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = from; i < end; i += 1) {
    const j = i * factor + shift;
    if (j < 0 || j >= target.length) continue;
    const x = reference[i];
    const y = target[j];
    n += 1;
    sx += x; sy += y;
    sxx += x * x; syy += y * y;
    sxy += x * y;
  }
  if (n < minSamples) return { score: -Infinity, samples: n };
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 1e-9 || vy <= 1e-9) return { score: -Infinity, samples: n };
  return { score: cov / Math.sqrt(vx * vy), samples: n };
}

/**
 * Sub-pixel alignment of one profile against the reference profile of the same
 * length and origin.
 *
 * Besides `dxPx`, quantised to 1/`upsample` px, it reports two honesty measures:
 * `peakWidthPx` (how far the shift can move before the match loses 1% of its
 * height) and `marginPx` (the gap to the strongest competing peak outside +-1 px),
 * which is what separates a locked band from a sparse one whose alignment is
 * guesswork at any precision.
 */
export function trackProfile(reference, target, {
  rangePx = DEFAULT_BAND_OPTIONS.rangePx,
  upsample: factor = DEFAULT_BAND_OPTIONS.upsample,
  from = 0,
  to = null
} = {}) {
  const empty = { dxPx: null, score: null, peakWidthPx: null, marginPx: null, reason: null };
  if (reference.length === 0 || target.length === 0) return { ...empty, reason: 'empty-profile' };
  if (Math.abs(reference.length - target.length) > 1) {
    return { ...empty, reason: `profile-length-mismatch (${reference.length} vs ${target.length})` };
  }
  if (reference.every(value => value === 0)) return { ...empty, reason: 'flat-reference' };
  const upsampled = resample(target, factor);
  const maxShift = Math.round(rangePx * factor);
  // One scan of the correlation curve: the peak, its competitor and its plateau are
  // all read back out of it, so a frame pair costs one pass rather than three.
  const curve = new Float64Array(2 * maxShift + 1).fill(-Infinity);
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    curve[shift + maxShift] = nccAt(reference, upsampled, shift, { factor, from, to }).score;
  }
  let bestIndex = -1;
  for (let index = 0; index < curve.length; index += 1) {
    if (Number.isFinite(curve[index]) && (bestIndex === -1 || curve[index] > curve[bestIndex])) bestIndex = index;
  }
  if (bestIndex === -1) return { ...empty, reason: 'no-overlap' };
  let competitor = -Infinity;
  for (let index = 0; index < curve.length; index += 1) {
    if (Math.abs(index - bestIndex) > factor && Number.isFinite(curve[index]) && curve[index] > competitor) competitor = curve[index];
  }
  const threshold = curve[bestIndex] - Math.abs(curve[bestIndex]) * 0.01;
  let plateauLow = bestIndex;
  let plateauHigh = bestIndex;
  for (let index = 0; index < curve.length; index += 1) {
    if (Number.isFinite(curve[index]) && curve[index] >= threshold) {
      if (index < plateauLow) plateauLow = index;
      if (index > plateauHigh) plateauHigh = index;
    }
  }
  const score = curve[bestIndex];
  return {
    dxPx: roundTo((bestIndex - maxShift) / factor),
    score: roundTo(score, 5),
    peakWidthPx: roundTo((plateauHigh - plateauLow) / factor, 4),
    marginPx: Number.isFinite(competitor) && score > competitor ? roundTo(score - competitor, 5) : null,
    quantumPx: roundTo(1 / factor, 6),
    reason: null
  };
}

/**
 * Runs of at least `minWidth` empty columns inside a band profile: the gaps between
 * words (or letters, with a smaller `minWidth`). A column is empty when its ink is
 * below `gapWeight`, so antialiasing bleed does not close a real gap.
 *
 * A run that touches either end of the domain is padding rather than a gap between
 * two pieces of content, and it is dropped: there is no edge to anchor on.
 */
export function findGaps(profile, { minWidth = DEFAULT_BAND_OPTIONS.minGapPx, gapWeight = DEFAULT_BAND_OPTIONS.gapWeight } = {}) {
  const gaps = [];
  let start = null;
  const flush = right => {
    if (start !== null && right - start >= minWidth) {
      gaps.push({ left: start, right, center: (start + right) / 2, width: right - start });
    }
    start = null;
  };
  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] <= gapWeight) {
      if (start === null) start = i;
    } else {
      flush(i);
    }
  }
  flush(profile.length);
  return gaps.filter(gap => gap.left > 0 && gap.right < profile.length);
}

/**
 * Track one ink edge by correlating a window centred on it.
 *
 * The window straddles content on one side and emptiness on the other, which is the
 * strongest sub-pixel feature a 1-D ink profile has — an antialiased stroke boundary
 * puts real fractional weight on the columns either side of the transition, so the
 * correlation peak lands between pixels rather than on one. A window with no such
 * transition (solid ink, or solid emptiness inside a wide gap) carries no position
 * information at all and is rejected rather than answered with a plausible number.
 *
 * Because every anchor of a band shares the band's coordinate system, their `dxPx`
 * values are directly comparable: the spread between them is the rigid-body error,
 * and it is the evidence that a line eased as a whole rather than word by word.
 */
export function trackAnchor(reference, target, edge, {
  window = DEFAULT_BAND_OPTIONS.anchorWindowPx,
  rangePx = DEFAULT_BAND_OPTIONS.rangePx,
  upsample: factor = DEFAULT_BAND_OPTIONS.upsample,
  gapWeight = DEFAULT_BAND_OPTIONS.gapWeight
} = {}) {
  const half = Math.max(2, Math.round(window));
  const from = Math.max(0, Math.floor(edge - half));
  const to = Math.min(reference.length, Math.ceil(edge + half));
  if (to - from < 4) return { dxPx: null, score: null, reason: 'window-too-small' };
  let columnsWithInk = 0;
  for (let i = from; i < to; i += 1) if (reference[i] > gapWeight) columnsWithInk += 1;
  if (columnsWithInk === 0 || columnsWithInk === to - from) {
    return { dxPx: null, score: null, reason: 'window-has-no-edge' };
  }
  const result = trackProfile(reference, target, { rangePx, upsample: factor, from, to });
  if (result.dxPx === null) return result;
  return { ...result, window: { from, to } };
}

/**
 * The two ink→empty transitions of one gap, in profile coordinates.
 *
 * Both edges are tracked, not the gap centre: a centre window is empty on both sides
 * whenever the gap is wider than twice the window, and the left edge belongs to the
 * piece of content before the gap while the right edge belongs to the piece after it,
 * so tracking both is what lets the measurement see a gap change width instead of
 * silently averaging the two words into one number.
 */
export function gapEdges(gaps) {
  return gaps.flatMap(gap => [
    { id: `${gap.id}-left`, gapId: gap.id, x: gap.left, side: 'left', gap },
    { id: `${gap.id}-right`, gapId: gap.id, x: gap.right, side: 'right', gap }
  ]);
}

/**
 * Measure one band across frames, anchored on one reference frame.
 *
 * Every `dxPx` is displacement relative to that anchor, which is what a motion fit
 * consumes and what keeps per-frame noise from accumulating into drift.
 */
export function measureBand(frameNumbers, profiles, band, options = {}) {
  const settings = { ...DEFAULT_BAND_OPTIONS, ...options };
  const { rangePx, upsample: factor, anchorWindowPx, minGapPx, gapWeight, maxAnchors, anchors: withAnchors } = settings;
  const referenceIndex = Math.max(0, Math.min(frameNumbers.length - 1, settings.referenceIndex ?? 0));
  const anchor = profiles[referenceIndex];
  // An anchor with no ink cannot anchor anything, so its own frame is not "measured at
  // zero displacement" either — it is unmeasurable like every other frame of that band.
  const anchorIsFlat = anchor.every(value => value === 0);
  const gapList = findGaps(anchor, { minWidth: minGapPx, gapWeight })
    .sort((a, b) => b.width - a.width || a.center - b.center)
    .slice(0, maxAnchors)
    .sort((a, b) => a.center - b.center)
    .map((gap, index) => ({ ...gap, id: `gap-${index}` }));
  const edges = gapEdges(gapList);
  const series = [];
  for (let index = 0; index < frameNumbers.length; index += 1) {
    const isAnchor = index === referenceIndex;
    const match = isAnchor
      ? (anchorIsFlat
        ? { dxPx: null, score: null, peakWidthPx: null, marginPx: null, reason: 'flat-reference' }
        : { dxPx: 0, score: 1, peakWidthPx: 0, marginPx: null, reason: null })
      : trackProfile(anchor, profiles[index], { rangePx, upsample: factor });
    // Each record carries its own edge, so an unmeasurable anchor drops out without
    // shifting the labels of the ones that remain.
    const anchorRecords = withAnchors && !isAnchor
      ? edges.map(edge => ({
        edge,
        ...trackAnchor(anchor, profiles[index], edge.x, { window: anchorWindowPx, rangePx, upsample: factor, gapWeight })
      }))
      : [];
    const measured = anchorRecords.filter(record => Number.isFinite(record.dxPx));
    // A gap that keeps its width means the two edges moved together, which is the
    // signature of a line translated as a block; a gap that grows or shrinks means the
    // words around it moved independently and no single translation describes the band.
    const gapWidthDeltaPx = {};
    for (const gap of gapList) {
      const left = measured.find(record => record.edge.id === `${gap.id}-left`);
      const right = measured.find(record => record.edge.id === `${gap.id}-right`);
      if (left && right) gapWidthDeltaPx[gap.id] = roundTo(right.dxPx - left.dxPx, 4);
    }
    const deltas = Object.values(gapWidthDeltaPx).filter(value => Number.isFinite(value));
    series.push({
      frame: frameNumbers[index],
      dxPx: match.dxPx,
      score: match.score,
      peakWidthPx: match.peakWidthPx,
      marginPx: match.marginPx,
      reason: match.reason,
      ink: roundTo(profiles[index].reduce((total, value) => total + value, 0), 4),
      anchors: measured.length > 1
        ? measured.map(record => ({
          id: record.edge.id,
          gapId: record.edge.gapId,
          side: record.edge.side,
          edgeX: roundTo(record.edge.x + band.origin, 3),
          dxPx: record.dxPx,
          score: record.score,
          marginPx: record.marginPx
        }))
        : [],
      anchorSpreadPx: measured.length > 1
        ? roundTo(Math.max(...measured.map(record => record.dxPx)) - Math.min(...measured.map(record => record.dxPx)), 4)
        : null,
      maxGapWidthDeltaPx: deltas.length ? roundTo(Math.max(...deltas.map(value => Math.abs(value))), 4) : null
    });
  }
  const usable = series.filter(record => Number.isFinite(record.dxPx));
  const spreads = series.map(record => record.anchorSpreadPx).filter(value => Number.isFinite(value));
  const gapDeltas = series.map(record => record.maxGapWidthDeltaPx).filter(value => Number.isFinite(value));
  const widths = usable.map(record => record.peakWidthPx).filter(value => Number.isFinite(value));
  const margins = usable.map(record => record.marginPx).filter(value => Number.isFinite(value));
  return {
    id: band.id,
    axis: settings.axis,
    origin: roundTo(band.origin, 3),
    band: { start: band.start, end: band.end },
    domain: { start: band.origin, end: band.domainEnd },
    anchorFrame: frameNumbers[referenceIndex],
    rangePx,
    quantumPx: roundTo(1 / factor, 6),
    gapCount: gapList.length,
    gaps: gapList.map(gap => ({
      id: gap.id,
      x: roundTo(gap.center + band.origin, 3),
      leftX: roundTo(gap.left + band.origin, 3),
      rightX: roundTo(gap.right + band.origin, 3),
      widthPx: gap.width
    })),
    framesMeasured: usable.length,
    framesRequested: frameNumbers.length,
    displacementPx: usable.length ? roundTo(usable[usable.length - 1].dxPx - usable[0].dxPx, 4) : null,
    firstDxPx: usable.length ? usable[0].dxPx : null,
    lastDxPx: usable.length ? usable[usable.length - 1].dxPx : null,
    minDxPx: usable.length ? roundTo(Math.min(...usable.map(record => record.dxPx)), 4) : null,
    maxDxPx: usable.length ? roundTo(Math.max(...usable.map(record => record.dxPx)), 4) : null,
    meanScore: usable.length ? roundTo(usable.reduce((total, record) => total + (record.score ?? 0), 0) / usable.length, 5) : null,
    minMarginPx: margins.length ? roundTo(Math.min(...margins), 5) : null,
    widestPeakWidthPx: widths.length ? roundTo(Math.max(...widths), 4) : null,
    maxAnchorSpreadPx: spreads.length ? roundTo(Math.max(...spreads), 4) : null,
    maxGapWidthDeltaPx: gapDeltas.length ? roundTo(Math.max(...gapDeltas), 4) : null,
    unresolvedFrames: series.filter(record => !Number.isFinite(record.dxPx)).map(record => record.frame),
    series
  };
}

/**
 * Decode frames, build one profile per band and measure every band.
 *
 * Bands come from `options.bands` when supplied, otherwise from the row-ink profile
 * of the first frame, so the tool is usable on an unseen video before anyone has
 * decided where its text lines are.
 */
export async function trackBands(frameFiles, options = {}) {
  const settings = { ...DEFAULT_BAND_OPTIONS, ...options };
  if (!Array.isArray(frameFiles) || frameFiles.length < 2) {
    throw new Error('At least two frames are needed to measure motion.');
  }
  if (!['x', 'y'].includes(settings.axis)) throw new Error(`axis must be "x" or "y", got "${settings.axis}".`);
  if (settings.axis === 'y' && !settings.bands?.length) {
    throw new Error('axis "y" measures vertical motion, so it needs explicit column bands; auto-bands find text rows.');
  }
  const entries = [];
  for (const file of frameFiles) entries.push({ file, png: PNG.sync.read(await readFile(file)) });
  const { width, height } = entries[0].png;
  for (const { file, png } of entries) {
    if (png.width !== width || png.height !== height) {
      throw new Error(`${path.basename(file)} is ${png.width}x${png.height}, but the anchor frame is ${width}x${height}.`);
    }
  }
  const fields = entries.map(({ png }) => inkField(png, settings));
  const frameNumbers = entries.map((entry, index) => options.frames?.[index] ?? frameOf(entry.file) ?? index);
  const extent = settings.axis === 'x' ? height : width;
  const domainExtent = settings.axis === 'x' ? width : height;
  const domainStart = settings.domainStart ?? 0;
  const domainEnd = settings.domainEnd ?? domainExtent;
  if (domainStart < 0 || domainEnd > domainExtent || domainEnd <= domainStart) {
    throw new Error(`Domain ${domainStart}..${domainEnd} is outside 0..${domainExtent} on axis "${settings.axis}".`);
  }
  let bands;
  let resolvedMinRowInk = null;
  if (settings.bands?.length) {
    bands = settings.bands.map((band, index) => {
      const start = band.start ?? (settings.axis === 'x' ? band.y0 : band.x0);
      const end = band.end ?? (settings.axis === 'x' ? band.y1 : band.x1);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > extent || end <= start) {
        throw new Error(`Band "${band.id ?? index}" needs integer [start, end) inside 0..${extent}, got ${start}..${end}.`);
      }
      const origin = band.origin ?? (settings.axis === 'x' ? band.x0 ?? 0 : band.y0 ?? 0);
      const last = band.domainEnd ?? (settings.axis === 'x' ? band.x1 ?? domainExtent : band.y1 ?? domainExtent);
      if (!Number.isInteger(origin) || !Number.isInteger(last) || origin < 0 || last > domainExtent || last <= origin) {
        throw new Error(`Band "${band.id ?? index}" needs an integer domain inside 0..${domainExtent}, got ${origin}..${last}.`);
      }
      return { id: band.id ?? `band-${start}-${end}`, start, end, origin, domainEnd: last };
    });
  } else {
    const minRowInk = settings.minRowInk ?? Math.max(1, Math.round(settings.minRowInkRatio * (domainEnd - domainStart)));
    const rows = rowInk(fields[0], { width, height, from: domainStart, to: domainEnd });
    bands = findRowBands(rows, { minInk: minRowInk, minGap: settings.minRowGap })
      .map(band => ({ id: band.id, start: band.start, end: band.end, origin: domainStart, domainEnd, ink: band.ink }));
    if (bands.length > settings.maxBands) {
      throw new Error(`${bands.length} ink bands were found, over the ${settings.maxBands}-band limit; raise --max-bands or restrict the frame with --domain.`);
    }
    resolvedMinRowInk = minRowInk;
  }
  if (bands.length === 0) throw new Error('No ink band was found; check --background, --min-ink and --domain.');
  const measured = bands.map(band => measureBand(
    frameNumbers,
    fields.map(field => lineProfile(field, {
      width,
      height,
      axis: settings.axis,
      bandStart: band.start,
      bandEnd: band.end,
      domainStart: band.origin,
      domainEnd: band.domainEnd
    }).profile),
    band,
    settings
  ));
  const anyMeasured = measured.filter(band => band.framesMeasured > 0);
  return {
    schema: BAND_TRACKING_SCHEMA,
    frameDirectory: settings.frameDirectory ? path.resolve(settings.frameDirectory) : undefined,
    anchorFrame: frameNumbers[settings.referenceIndex ?? 0] ?? frameNumbers[0],
    frameCount: frameNumbers.length,
    raster: { width, height },
    parameters: {
      background: settings.background,
      axis: settings.axis,
      rangePx: settings.rangePx,
      upsample: settings.upsample,
      anchorWindowPx: settings.anchorWindowPx,
      minGapPx: settings.minGapPx,
      gapWeight: settings.gapWeight,
      minRowInk: settings.minRowInk ?? null,
      // Recorded as the number that was actually used, so a band list is reproducible
      // from the artifact alone rather than from the frame width it happened to have.
      resolvedMinRowInk,
      minRowGap: settings.minRowGap,
      anchors: settings.anchors,
      bandSource: options.bands?.length ? 'explicit' : 'auto-rows'
    },
    resolutionNote: `dxPx is displacement relative to frame ${frameNumbers[settings.referenceIndex ?? 0] ?? frameNumbers[0]}, quantised to ${roundTo(1 / settings.upsample, 6)} px by ${settings.upsample}x profile interpolation. Alignment is not claimed finer than that quantum, and a band whose minMarginPx is near zero is ambiguous at any precision.`,
    summary: {
      bands: measured.length,
      bandsWithMotion: anyMeasured.length,
      maxDisplacementPx: anyMeasured.length
        ? roundTo(Math.max(...anyMeasured.map(band => Math.abs(band.displacementPx ?? 0))), 4)
        : null,
      meanScore: anyMeasured.length
        ? roundTo(anyMeasured.reduce((total, band) => total + (band.meanScore ?? 0), 0) / anyMeasured.length, 5)
        : null,
      quantumPx: roundTo(1 / settings.upsample, 6),
      rigidBands: measured.filter(band => band.maxAnchorSpreadPx !== null
        && band.maxAnchorSpreadPx <= 1 / settings.upsample).length,
      nonRigidBands: measured.filter(band => band.maxAnchorSpreadPx !== null
        && band.maxAnchorSpreadPx > 1 / settings.upsample).length,
      // A band whose gap widths change cannot be reproduced by translating one layer;
      // the spacing itself animated, and that has to be said rather than fitted away.
      reflowingBands: measured.filter(band => band.maxGapWidthDeltaPx !== null
        && band.maxGapWidthDeltaPx > 1 / settings.upsample).map(band => band.id),
      unmeasuredBands: measured.filter(band => band.framesMeasured === 0).map(band => band.id)
    },
    bands: measured
  };
}

/**
 * The frame number a filename carries: its last digit run.
 *
 * `frame-028.png`, `input-000.png` and `shot1-frame-012.png` all name the frame by
 * their final number, and the zero padding depends on how many frames the sequence
 * has, so a fixed digit count cannot work. The CLI that selects frames uses this same
 * rule and additionally passes the numbers it resolved, so the two can never label a
 * frame differently.
 */
export function frameOf(file) {
  const runs = String(path.basename(file)).match(/\d+/g);
  return runs ? Number(runs[runs.length - 1]) : null;
}
