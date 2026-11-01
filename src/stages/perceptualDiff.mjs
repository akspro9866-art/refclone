// Stage 5: sparse, local perceptual convergence.
//
// Renders are requested only at beat inflection frames. Each PNG is compared with
// the matching reference frame by odiff-bin (SIMD, native) or a deterministic PNG
// buffer fallback; no frame is uploaded to a vision model. A difference maps to a
// compact _mg.patch delta, one cavalry_exec call per pass, never a scene re-emit.
//
// A beat may contain several simultaneous moving elements. The gate asks a target
// selector for every layer active in that beat (ranked and capped), then partitions
// the beat's drift across them: by mismatch-region overlap when per-layer boxes are
// known, otherwise by displacement share. When every target is expected at the same
// position (fully overlapping tracks) it degrades to the primary layer, because no
// honest partition exists.
//
// Band drift (opt-in) replaces that one shared centroid number. The failing frame is
// measured band by band — the reference's ink rows, or the caller's own — so each
// layer receives the displacement actually observed in the rows it draws, and a drift
// at or under the noise floor is reported rather than patched. A texture difference
// then produces no patch at all instead of a thrashing loop.
import fs from 'node:fs/promises';
import { readFileSync as fsSyncRead, writeFileSync as fsSyncWrite } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { WorkflowError } from '../core.mjs';
import { inkField, inkRects, modalBackground, rectDisplacement } from './bandTracking.mjs';

export const PERCEPTUAL_VERSION = '1.1.0';
const DEFAULT_THRESHOLD = 1.5;
const DEFAULT_MAX_PASSES = 3;
// Band measurement defaults for the drift gate. The quantum is 1/upsample px, and the
// noise floor defaults to that quantum: a correction smaller than the measurement step
// is not a placement error anyone can act on.
const DEFAULT_BAND_DRIFT_OPTIONS = {
  upsample: 8,
  rangePx: 12,
  background: null,
  maxBands: 24,
  minScore: 0.5,
  noiseFloorPx: null,
  contestedSpreadPx: 2
};

function round(value, places = 3) {
  const factor = 10 ** places;
  const rounded = Math.round(Number(value) * factor) / factor;
  // A negated zero is -0: it reads as a direction in a report and in a patch payload.
  return rounded === 0 ? 0 : rounded;
}

/** Only the three inflection frames of each beat, clipped and deduplicated. */
export function sparseBeatFrames(beats) {
  const frames = new Set();
  for (const beat of beats ?? []) {
    const inFrame = Math.round(Number(beat.inFrame));
    const outFrame = Math.round(Number(beat.outFrame));
    if (!Number.isFinite(inFrame) || !Number.isFinite(outFrame)) continue;
    for (const requested of [inFrame + 1, Math.round(Number(beat.peakFrame)), outFrame - 1]) {
      const frame = Math.max(inFrame, Math.min(outFrame, requested));
      if (Number.isFinite(frame) && frame >= 0) frames.add(frame);
    }
  }
  return [...frames].sort((a, b) => a - b);
}

function padFrame(frame, width = 6) {
  return String(frame).padStart(width, '0');
}

function resolveReferenceFrame(reference, frame) {
  if (reference == null) return null;
  if (typeof reference === 'string' && /%0?\d*d/.test(reference)) {
    return path.resolve(reference.replace(/%0?(\d*)d/, (_, digits) => padFrame(frame, Number(digits) || 6)));
  }
  if (typeof reference === 'string') {
    const directory = path.resolve(reference);
    return path.join(directory, `frame-${padFrame(frame)}.png`);
  }
  if (reference instanceof Map) return reference.get(frame) ?? reference.get(String(frame)) ?? null;
  const direct = reference[frame] ?? reference[String(frame)];
  if (direct) return path.resolve(direct);
  if (typeof reference.pattern === 'string') return path.resolve(reference.pattern.replace(/%0?(\d*)d/, (_, digits) => padFrame(frame, Number(digits) || 6)));
  if (typeof reference.directory === 'string') return path.join(path.resolve(reference.directory), `frame-${padFrame(frame)}.png`);
  return null;
}

/** Ink bounds and centre, ignoring the corner colour as background. */
export function inkBounds(pngOrPath) {
  const png = Buffer.isBuffer(pngOrPath) ? PNG.sync.read(pngOrPath) : pngOrPath;
  const background = [0, 1, 2].map(channel => png.data[channel]);
  let left = png.width; let top = png.height; let right = -1; let bottom = -1;
  let count = 0; let sumX = 0; let sumY = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const at = (y * png.width + x) * 4;
      const distance = Math.max(
        Math.abs(png.data[at] - background[0]),
        Math.abs(png.data[at + 1] - background[1]),
        Math.abs(png.data[at + 2] - background[2])
      );
      if (distance <= 20) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
      count += 1; sumX += x; sumY += y;
    }
  }
  if (right < 0) return { empty: true, count: 0, bbox: null, centre: null };
  return {
    empty: false, count,
    bbox: { x1: left, y1: top, x2: right, y2: bottom, width: right - left + 1, height: bottom - top + 1 },
    centre: { x: round(sumX / count, 2), y: round(sumY / count, 2) }
  };
}

function fallbackCompare(referencePath, renderPath, diffPath, options) {
  const reference = PNG.sync.read(fsSyncRead(referencePath));
  const render = PNG.sync.read(fsSyncRead(renderPath));
  const diff = new PNG({ width: render.width, height: render.height });
  diff.data.fill(0);
  if (reference.width !== render.width || reference.height !== render.height) {
    return {
      engine: 'pngjs', match: false, reason: 'layout-diff',
      mismatchPct: 100, diffCount: null, bbox: null, diffPath: null,
      layout: { reference: [reference.width, reference.height], render: [render.width, render.height] }
    };
  }
  const threshold = (options.threshold ?? 0.05) * Math.sqrt(3 * 255 * 255);
  const antialias = options.antialiasing !== false;
  const width = render.width;
  const height = render.height;
  const differs = (x1, y1, x2, y2) => {
    const left = (y1 * width + x1) * 4;
    const right = (y2 * width + x2) * 4;
    const distance = Math.hypot(
      reference.data[left] - render.data[right],
      reference.data[left + 1] - render.data[right + 1],
      reference.data[left + 2] - render.data[right + 2]
    );
    return distance > threshold;
  };
  const neighbourMatches = (x, y) => {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!differs(x, y, nx, ny) || !differs(nx, ny, x, y)) return true;
    }
    return false;
  };
  let diffCount = 0;
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!differs(x, y, x, y)) continue;
      if (antialias && neighbourMatches(x, y)) continue;
      diffCount += 1;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
      const at = (y * width + x) * 4;
      diff.data[at] = 255; diff.data[at + 1] = 0; diff.data[at + 2] = 0; diff.data[at + 3] = 255;
    }
  }
  if (diffPath && diffCount > 0) {
    fsSyncWrite(diffPath, PNG.sync.write(diff));
  }
  return {
    engine: 'pngjs', match: diffCount === 0, reason: diffCount === 0 ? 'match' : 'pixel-diff',
    mismatchPct: round((diffCount / (width * height)) * 100, 5),
    diffCount,
    bbox: diffCount ? { x1: left, y1: top, x2: right, y2: bottom } : null,
    diffPath: diffCount ? diffPath : null
  };
}

/**
 * Compare a reference and a render. odiff is attempted first; a spawn failure in a
 * restricted runner falls through to the pure-JS path with the same result shape.
 */
export async function compareImages(referencePath, renderPath, diffPath, options = {}) {
  const settings = {
    antialiasing: true,
    threshold: 0.05,
    outputDiffMask: true,
    captureDiffLines: true,
    captureDiffCols: true,
    ...options
  };
  let odiffError = null;
  try {
    const { compare } = await import('odiff-bin');
    const result = await compare(referencePath, renderPath, diffPath, settings);
    if (result?.match) {
      return { engine: 'odiff', match: true, reason: 'match', mismatchPct: 0, diffCount: 0, bbox: null, diffPath: null };
    }
    if (result?.reason === 'pixel-diff') {
      const lines = Array.isArray(result.diffLines) ? result.diffLines : [];
      const cols = Array.isArray(result.diffCols) ? result.diffCols : [];
      return {
        engine: 'odiff', match: false, reason: 'pixel-diff',
        mismatchPct: round(Number(result.diffPercentage) || 0, 5),
        diffCount: Number(result.diffCount) || 0,
        bbox: lines.length && cols.length
          ? { x1: Math.min(...cols), y1: Math.min(...lines), x2: Math.max(...cols), y2: Math.max(...lines) }
          : null,
        diffPath
      };
    }
    return {
      engine: 'odiff', match: false, reason: result?.reason ?? 'unknown',
      mismatchPct: result?.reason === 'layout-diff' ? 100 : 100,
      diffCount: null, bbox: null, diffPath: null
    };
  } catch (error) {
    odiffError = error;
  }
  try {
    const fallback = fallbackCompare(referencePath, renderPath, diffPath, settings);
    return { ...fallback, odiffError: odiffError.message };
  } catch (error) {
    throw new WorkflowError('PERCEPTUAL_COMPARE_FAILED', 'Neither odiff nor the PNG fallback could compare the frames.', {
      referencePath, renderPath, odiffError: odiffError?.message ?? null, fallbackError: error.message
    });
  }
}

/**
 * A compact delta patch. With a known current pose the script carries two absolute
 * values (about 40 tokens); without one, the runtime reads and adds the delta.
 */
export function buildDeltaPatch({ layerId, layerRef = null, current = null, dx, dy, mismatchPct = null, frame = null }) {
  if (!layerId && !layerRef) throw new WorkflowError('PATCH_TARGET_REQUIRED', 'A delta patch needs a layer id or compiled layer reference.');
  const values = {};
  if (Number.isFinite(dx) && Math.abs(dx) >= 0.05) {
    values['position.x'] = current?.position ? round(current.position.x + dx, 2) : round(dx, 2);
  }
  if (Number.isFinite(dy) && Math.abs(dy) >= 0.05) {
    values['position.y'] = current?.position ? round(current.position.y + dy, 2) : round(dy, 2);
  }
  const usesAbsolute = Boolean(current?.position);
  return {
    ...(layerRef ? { targetRef: layerRef } : { target: layerId }),
    ...(usesAbsolute ? { attrs: values } : { delta: values }),
    // The failing beat frame, so the runtime writes at that frame instead of
    // whatever frame the playhead happens to hold after the last render.
    ...(Number.isInteger(frame) ? { frame } : {}),
    ...(mismatchPct == null ? {} : { mismatchPct: round(mismatchPct, 4) })
  };
}

/** Area of two {x1,y1,x2,y2} boxes that intersects, in square pixels. */
export function boxOverlapArea(a, b) {
  if (!a || !b) return 0;
  const width = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const height = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return width > 0 && height > 0 ? width * height : 0;
}

function samePlace(a, b, tolerance = 0.5) {
  return a && b && Math.abs(Number(a.x) - Number(b.x)) <= tolerance && Math.abs(Number(a.y) - Number(b.y)) <= tolerance;
}

/**
 * Partition one beat's whole-frame drift across its active layers.
 *
 * targets: [{ expected?: { position }, amplitude, box? }] — already ranked, primary first.
 * Priority: known per-layer boxes overlapping the odiff mismatch box → mismatch-overlap
 * area; otherwise the normalized displacement share. Fully overlapping tracks (every
 * expected position identical) fall back to the primary layer with the full delta,
 * because splitting an indistinguishable drift would be a guess. Returns one share per
 * target whose weighted delta is at least 0.05px; the shares sum to the measured drift.
 */
export function distributeDrift(targets, { dx, dy, mismatchBox = null } = {}) {
  const active = (targets ?? []).filter(Boolean);
  if (active.length === 0) return [];
  const finiteDelta = { x: Number.isFinite(dx) ? dx : 0, y: Number.isFinite(dy) ? dy : 0 };
  if (active.length === 1) return [{ target: active[0], dx: finiteDelta.x, dy: finiteDelta.y, weight: 1, basis: 'single' }];
  const known = active.filter(target => target.expected?.position);
  if (known.length === active.length && known.every(target => samePlace(target.expected.position, known[0].expected.position))) {
    return [{ target: active[0], dx: finiteDelta.x, dy: finiteDelta.y, weight: 1, basis: 'overlapping-tracks', fallback: 'primary' }];
  }
  const overlaps = active.map(target => (target.box && mismatchBox ? boxOverlapArea(target.box, mismatchBox) : 0));
  const overlapTotal = overlaps.reduce((total, value) => total + value, 0);
  let weights;
  let basis;
  if (overlapTotal > 0) {
    weights = overlaps;
    basis = 'mismatch-overlap';
  } else {
    weights = active.map(target => Math.max(0, Number(target.amplitude) || 0));
    if (weights.every(weight => weight === 0)) weights = active.map(() => 1);
    basis = 'displacement';
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return [{ target: active[0], dx: finiteDelta.x, dy: finiteDelta.y, weight: 1, basis: 'primary' }];
  const shares = active.map((target, index) => ({
    target,
    dx: round(finiteDelta.x * (weights[index] / total), 2),
    dy: round(finiteDelta.y * (weights[index] / total), 2),
    weight: round(weights[index] / total, 4),
    basis
  }));
  const meaningful = shares.filter(share => Math.abs(share.dx) >= 0.05 || Math.abs(share.dy) >= 0.05);
  return meaningful.length ? meaningful : shares;
}

/** {x, y, width, height} in frame pixels to the {x1, y1, x2, y2} boxes the sharing code uses. */
function rectToBox(rect) {
  return { x1: rect.x, y1: rect.y, x2: rect.x + rect.width, y2: rect.y + rect.height };
}

/** A band descriptor of any of the shapes a caller plausibly holds, resolved to a rect. */
function bandRect(band, frame) {
  if (band?.rect) return band.rect;
  const y = band?.y ?? band?.top ?? band?.y0;
  const start = band?.start ?? y;
  const end = band?.end ?? band?.y1 ?? (Number.isInteger(y) && Number.isInteger(band?.height) ? y + band.height : null);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  const x = band?.x ?? band?.x0 ?? 0;
  const width = band?.width ?? (Number.isInteger(band?.x1) ? band.x1 - x : frame.width - x);
  return { x, y: start, width, height: end - start };
}

/**
 * The bands one beat is measured in.
 *
 * Explicit when the caller knows where its lines are; otherwise the reference frame's
 * own ink rows, discovered once per beat. Bands come from the *reference* on purpose:
 * the render may be missing a line or splitting one, and deriving the grid from the
 * picture being copied keeps a wrong render from defining its own measuring sticks.
 */
export function beatBands(referencePng, bands, options = {}) {
  const settings = { ...DEFAULT_BAND_DRIFT_OPTIONS, ...options };
  if (bands?.length) {
    const rects = bands.map((band, index) => {
      const rect = bandRect(band, referencePng);
      return rect ? { id: band?.id ?? `band-${index}`, rect } : null;
    }).filter(Boolean);
    if (rects.length === 0) throw new WorkflowError('PERCEPTUAL_BANDS_INVALID', 'No band list could be resolved to a rectangle in frame pixels.', { bands });
    return { bands: rects, basis: `${rects.length} supplied band(s)`, found: rects.length, truncated: 0 };
  }
  const found = inkRects(referencePng, { background: settings.background, maxBands: settings.maxBands });
  return {
    bands: found.bands.map(band => ({ id: band.id, rect: band.rect })),
    basis: `${found.bands.length} of ${found.found} reference ink band(s)`,
    background: found.background,
    found: found.found,
    truncated: found.truncated
  };
}

/**
 * Measure the render against the reference band by band.
 *
 * Every band gets its own two-axis displacement from the same sub-pixel profile
 * correlation the motion measurement uses, so a beat holding three lines that move three
 * different amounts produces three different numbers instead of one averaged centroid.
 * A band is `patchable` only when the correlation is confident on both axes *and* the
 * displacement clears the noise floor; the rest are returned as evidence with the reason
 * they were refused.
 */
export function measureBandDrift(referencePng, renderPng, bands, options = {}) {
  const settings = { ...DEFAULT_BAND_DRIFT_OPTIONS, ...options };
  const background = settings.background ?? modalBackground(referencePng).hex;
  if (!background) {
    return { bands: [], basis: 'no background could be measured', summary: { bands: 0, measured: 0, patchable: 0 } };
  }
  // The ink field is a whole-frame pass; sharing it across bands is what makes a dense
  // frame affordable.
  const fields = { reference: inkField(referencePng, { background }), render: inkField(renderPng, { background }) };
  const results = bands.map(band => {
    const drift = rectDisplacement(referencePng, renderPng, band.rect, {
      background, fields, upsample: settings.upsample, rangePx: settings.rangePx, noiseFloorPx: settings.noiseFloorPx
    });
    const confident = drift.measured && Math.min(drift.score.x ?? 0, drift.score.y ?? 0) >= settings.minScore;
    return {
      id: band.id,
      rect: band.rect,
      measured: drift.measured,
      confident,
      aboveNoiseFloor: drift.aboveNoiseFloor,
      patchable: confident && drift.aboveNoiseFloor,
      dxPx: drift.dxPx, dyPx: drift.dyPx,
      correctionPx: drift.correctionPx,
      score: drift.score, marginPx: drift.marginPx,
      quantumPx: drift.quantumPx, noiseFloorPx: drift.noiseFloorPx,
      reason: drift.measured ? (confident ? null : `correlation score ${Math.min(drift.score.x ?? 0, drift.score.y ?? 0)} is under ${settings.minScore}`) : drift.reason
    };
  });
  const patchable = results.filter(band => band.patchable);
  return {
    background,
    basis: `band displacement by ink-profile correlation at ${results[0]?.quantumPx ?? round(1 / settings.upsample, 6)} px, noise floor ${patchable[0]?.noiseFloorPx ?? settings.noiseFloorPx ?? round(1 / settings.upsample, 6)} px`,
    summary: {
      bands: results.length,
      measured: results.filter(band => band.measured).length,
      patchable: patchable.length,
      belowNoiseFloor: results.filter(band => band.measured && band.confident && !band.aboveNoiseFloor).map(band => band.id),
      unmeasured: results.filter(band => !band.measured).map(band => ({ id: band.id, reason: band.reason })),
      lowConfidence: results.filter(band => band.measured && !band.confident).map(band => band.id),
      maxCorrectionPx: patchable.length
        ? round(Math.max(...patchable.map(band => Math.max(Math.abs(band.correctionPx.dx), Math.abs(band.correctionPx.dy)))), 3)
        : null
    },
    bands: results
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}

/**
 * Say which layer each patchable band belongs to.
 *
 * A band of text belongs to the layer whose predicted position lands inside it — that is
 * real information the promoted scene already carries, and it is why two lines moving
 * two different amounts no longer have to share one centroid delta. Layers with known
 * boxes fall back to overlap with the band; a band no candidate claims is reported as
 * unattributed rather than dumped on the first layer.
 *
 * When several bands land on one layer, their corrections are combined by median, because
 * a rigid layer has one displacement and the bands are repeated measurements of it. If
 * they disagree by more than `contestedSpreadPx`, the median is a guess about a layer
 * that is not moving rigidly, so the layer is marked contested and not patched.
 */
export function attributeBandDrift(measurement, targets, { contestedSpreadPx = DEFAULT_BAND_DRIFT_OPTIONS.contestedSpreadPx } = {}) {
  const active = (targets ?? []).filter(Boolean);
  const claims = new Map();
  const unattributed = [];
  for (const band of measurement?.bands ?? []) {
    if (!band.patchable) continue;
    const box = rectToBox(band.rect);
    const inside = active.filter(target => target.expected?.position
      && Number(target.expected.position.y) >= band.rect.y - 0.5
      && Number(target.expected.position.y) < band.rect.y + band.rect.height + 0.5);
    const overlapping = inside.length ? inside : active.filter(target => target.box && boxOverlapArea(target.box, box) > 0);
    const basis = inside.length ? 'position-in-band' : overlapping.length ? 'box-overlap' : null;
    if (!basis) {
      unattributed.push({ id: band.id, dxPx: band.dxPx, dyPx: band.dyPx, reason: active.length ? 'no-active-layer-in-band' : 'no-targets-for-beat' });
      continue;
    }
    for (const share of distributeDrift(overlapping, { dx: band.correctionPx.dx, dy: band.correctionPx.dy, mismatchBox: box })) {
      const key = share.target.id ?? share.target.ref ?? share.target.layerId;
      const claim = claims.get(key) ?? { target: share.target, dx: [], dy: [], bands: [], bases: [] };
      claim.dx.push(share.dx);
      claim.dy.push(share.dy);
      claim.bands.push({ id: band.id, dx: share.dx, dy: share.dy, weight: share.weight, basis: share.basis });
      if (!claim.bases.includes(basis)) claim.bases.push(basis);
      claims.set(key, claim);
    }
  }
  const corrections = [];
  const contested = [];
  for (const claim of claims.values()) {
    const dx = round(median(claim.dx), 3);
    const dy = round(median(claim.dy), 3);
    const spread = {
      dx: round(Math.max(...claim.dx) - Math.min(...claim.dx), 3),
      dy: round(Math.max(...claim.dy) - Math.min(...claim.dy), 3)
    };
    const record = {
      target: claim.target,
      correctionPx: { dx, dy },
      bands: claim.bands,
      // The claim basis answers "why this layer for this band"; the per-band share basis
      // answers the different question of how one band's delta was split across layers.
      basis: claim.bases.join('+'),
      spreadPx: spread
    };
    if (Math.max(spread.dx, spread.dy) > contestedSpreadPx) {
      contested.push({ ...record, reason: `its ${claim.bands.length} band(s) disagree by ${Math.max(spread.dx, spread.dy)} px, which no single translation of one layer explains` });
      continue;
    }
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue;
    corrections.push(record);
  }
  return { corrections, contested, unattributed };
}

/**
 * Normalize one beat's selector answer into patch targets. The selector may return a
 * live id, a {id|layerId, ref, expected, expectedKnown, amplitude} descriptor, or an
 * array of either. A legacy single-target selector keeps working unchanged.
 */
function normalizeTargets(requested, { source, scene, layerRefs }) {
  const entries = Array.isArray(requested) ? requested : requested == null ? [] : [requested];
  const targets = [];
  for (const entry of entries) {
    const descriptor = entry !== null && typeof entry === 'object' ? entry : {};
    const layerId = (typeof entry === 'string' ? entry : descriptor.id ?? descriptor.layerId ?? descriptor.layer?.id) ?? null;
    const ref = descriptor.ref ?? null;
    const layer = descriptor.layer ?? scene?.layers?.find(candidate => candidate.id === layerId) ?? null;
    const resolvedRef = ref ?? (layerId ? layerRefs?.[layerId] ?? null : null);
    if (!layerId && !resolvedRef) continue;
    targets.push({
      id: layerId,
      ref: resolvedRef,
      layer,
      expected: descriptor.expected ?? null,
      expectedKnown: descriptor.expectedKnown !== false,
      amplitude: Number(descriptor.amplitude) || 0,
      box: descriptor.box ?? null,
      primary: descriptor.primary === true || targets.length === 0
    });
  }
  return targets;
}

function normalizeRendered(result) {
  const map = new Map();
  if (Array.isArray(result)) {
    for (const entry of result) {
      if (!entry) continue;
      if (entry.frame != null && entry.path) map.set(Number(entry.frame), path.resolve(entry.path));
      else if (entry.file) map.set(Number(entry.frame), path.resolve(entry.file));
    }
  } else if (result instanceof Map) {
    for (const [frame, value] of result) map.set(Number(frame), path.resolve(typeof value === 'string' ? value : value.path));
  } else if (result && typeof result === 'object') {
    for (const [frame, value] of Object.entries(result)) map.set(Number(frame), path.resolve(typeof value === 'string' ? value : value.path));
  }
  return map;
}

/**
 * Closed convergence loop.
 *
 * client: {
 *   available?: boolean,
 *   renderFrames({ frames, directory }) -> array|map,
 *   exec(script) -> { ... }
 * }
 */
/** Band drift stays off until a caller asks for it, so existing centroid runs are unchanged. */
export function bandDriftEnabled(bandDrift, bands) {
  if (bandDrift === undefined || bandDrift === null) return Boolean(bands?.length);
  return bandDrift !== false;
}

export async function runPerceptualGate({
  client, beats, referenceFrames, scene = null, outputDirectory, threshold = DEFAULT_THRESHOLD,
  maxPasses = DEFAULT_MAX_PASSES, layerForBeat = null, layersForBeat = null, layerRefs = null,
  onPatch = null, bandDrift = null, bands = null, noiseFloorPx = DEFAULT_BAND_DRIFT_OPTIONS.noiseFloorPx,
  bandUpsample = DEFAULT_BAND_DRIFT_OPTIONS.upsample, bandRangePx = DEFAULT_BAND_DRIFT_OPTIONS.rangePx,
  bandMaxCount = DEFAULT_BAND_DRIFT_OPTIONS.maxBands, minBandScore = DEFAULT_BAND_DRIFT_OPTIONS.minScore,
  contestedSpreadPx = DEFAULT_BAND_DRIFT_OPTIONS.contestedSpreadPx, background = DEFAULT_BAND_DRIFT_OPTIONS.background
}) {
  const numericThreshold = Number(threshold);
  const passes = Math.max(1, Math.round(Number(maxPasses)));
  if (!Number.isFinite(numericThreshold) || numericThreshold < 0) {
    throw new WorkflowError('PERCEPTUAL_OPTIONS_INVALID', 'threshold must be a nonnegative percentage.', { threshold });
  }
  const useBandDrift = bandDriftEnabled(bandDrift, bands);
  const bandOptions = {
    upsample: bandUpsample, rangePx: bandRangePx, background,
    maxBands: bandMaxCount, minScore: minBandScore, noiseFloorPx
  };
  if (!client || client.available === false || typeof client.renderFrames !== 'function') {
    return {
      version: PERCEPTUAL_VERSION, status: 'unavailable', converged: false,
      threshold: numericThreshold, maxPasses: passes,
      frames: sparseBeatFrames(beats), passes: [],
      bandDrift: { enabled: useBandDrift, noiseFloorPx: bandOptions.noiseFloorPx ?? round(1 / bandOptions.upsample, 4) },
      reason: 'No live Cavalry render transport; the gate cannot run without rendering.',
      limitations: ['Sparse rendering requires a live Stallion session; dry-run stops before this gate.']
    };
  }
  const directory = path.resolve(outputDirectory ?? path.join(process.cwd(), '.test-work', 'perceptual'));
  await fs.mkdir(directory, { recursive: true });
  const requestedFrames = sparseBeatFrames(beats);
  const history = [];
  const limitations = [];
  let latest = [];
  for (let pass = 1; pass <= passes; pass += 1) {
    const passDirectory = path.join(directory, `pass-${pass}`);
    await fs.mkdir(passDirectory, { recursive: true });
    const rendered = normalizeRendered(await client.renderFrames({ frames: requestedFrames, directory: passDirectory }));
    latest = [];
    for (const beat of beats) {
      const frames = [beat.inFrame + 1, beat.peakFrame, beat.outFrame - 1]
        .map(frame => Math.max(beat.inFrame, Math.min(beat.outFrame, Math.round(frame))))
        .filter((frame, index, list) => list.indexOf(frame) === index);
      let measured = null;
      let failingFrame = null;
      for (const frame of frames) {
        const referencePath = resolveReferenceFrame(referenceFrames, frame);
        const renderPath = rendered.get(frame);
        if (!referencePath || !renderPath) continue;
        const comparison = await compareImages(referencePath, renderPath, path.join(passDirectory, `diff-${padFrame(frame)}.png`));
        if (!measured || comparison.mismatchPct > measured.mismatchPct) {
          measured = comparison;
          failingFrame = { frame, referencePath, renderPath };
        }
      }
      const mismatchPct = measured?.mismatchPct ?? 100;
      const converged = mismatchPct <= numericThreshold;
      latest.push({
        beatIndex: beat.beatIndex, frames, mismatchPct, status: converged ? 'CONVERGED' : 'OPEN',
        engine: measured?.engine ?? null, diffPath: measured?.diffPath ?? null,
        frame: failingFrame?.frame ?? null, bbox: measured?.bbox ?? null
      });
    }
    const open = latest.filter(beat => beat.status !== 'CONVERGED');
    history.push({ pass, open: open.length, worst: latest.reduce((max, beat) => Math.max(max, beat.mismatchPct), 0) });
    if (open.length === 0) {
      return {
        version: PERCEPTUAL_VERSION, status: 'converged', converged: true,
        convergedAtPass: pass, threshold: numericThreshold, maxPasses: passes,
        frames: requestedFrames, beats: latest, passes: history,
        bandDrift: { enabled: useBandDrift, noiseFloorPx: bandOptions.noiseFloorPx ?? round(1 / bandOptions.upsample, 4) },
        patches: history.flatMap(entry => entry.patches ?? []),
        limitations
      };
    }
    if (pass === passes) break;
    const patches = [];
    const attribution = [];
    const bandReports = [];
    const { evaluateLayerAt } = await import('./proceduralPromotion.mjs');
    for (const beat of open) {
      const source = beats.find(candidate => candidate.beatIndex === beat.beatIndex);
      if (beat.frame == null) continue;
      const referencePath = resolveReferenceFrame(referenceFrames, beat.frame);
      const renderPath = rendered.get(beat.frame);
      if (!referencePath || !renderPath) continue;
      let referencePng;
      let renderPng;
      try {
        referencePng = PNG.sync.read(fsSyncRead(referencePath));
        renderPng = PNG.sync.read(fsSyncRead(renderPath));
      } catch {
        // A missing/corrupt frame is reported by the comparison above; never guess a drift.
        continue;
      }

      // A multi-layer selector receives the failing frame and the odiff mismatch box so
      // it can rank active layers; a legacy single-target selector is still accepted.
      let requested;
      if (typeof layersForBeat === 'function') {
        requested = layersForBeat(source, { frame: beat.frame, mismatchBox: beat.bbox ?? null, scene });
      } else if (typeof layerForBeat === 'function') {
        requested = layerForBeat(source);
      } else {
        requested = source?.layerId ?? scene?.layers?.[0]?.id ?? null;
      }
      let targets = normalizeTargets(requested, { source, scene, layerRefs });
      if (targets.length === 0 && typeof layersForBeat !== 'function' && typeof layerForBeat !== 'function' && !requested) {
        // Preserve the historical implicit fallback only when no selector was supplied;
        // an explicit selector that finds nothing is a deliberate no-op for this beat.
        targets = normalizeTargets(scene?.layers?.[0]?.id ?? null, { source, scene, layerRefs });
      }
      if (targets.length === 0) continue;

      if (useBandDrift) {
        // Each band carries its own number, so a texture-only beat yields no correction and
        // no patch — the gate stops instead of sliding a layer that is already placed.
        let measurement = null;
        let attribute = null;
        try {
          const discovered = beatBands(referencePng, bands, bandOptions);
          measurement = measureBandDrift(referencePng, renderPng, discovered.bands, bandOptions);
          attribute = attributeBandDrift(measurement, targets, { contestedSpreadPx });
        } catch (error) {
          bandReports.push({ beatIndex: beat.beatIndex, frame: beat.frame, error: error.message });
          continue;
        }
        bandReports.push({
          beatIndex: beat.beatIndex, frame: beat.frame, basis: measurement.basis,
          summary: measurement.summary,
          bands: measurement.bands.map(band => ({
            id: band.id, patchable: band.patchable, correctionPx: band.correctionPx,
            score: band.score, reason: band.reason
          })),
          contested: attribute.contested.map(entry => ({
            id: entry.target.id ?? entry.target.ref, correctionPx: entry.correctionPx,
            spreadPx: entry.spreadPx, reason: entry.reason
          })),
          unattributed: attribute.unattributed
        });
        let sent = 0;
        for (const correction of attribute.corrections) {
          const target = correction.target;
          let current = null;
          if (target.expectedKnown !== false) {
            if (target.expected?.position) current = target.expected;
            else if (target.layer) current = evaluateLayerAt(target.layer, beat.frame);
          }
          const patchSpec = buildDeltaPatch({
            layerId: target.id, layerRef: target.ref, current,
            dx: correction.correctionPx.dx, dy: correction.correctionPx.dy,
            mismatchPct: beat.mismatchPct, frame: beat.frame
          });
          if (Object.keys(patchSpec.attrs ?? patchSpec.delta ?? {}).length === 0) continue;
          patchSpec.bands = correction.bands.map(band => band.id);
          patches.push(patchSpec);
          sent += 1;
        }
        if (sent > 0) {
          // Band drift has no single beat-level delta to report: the honest aggregate is the
          // largest correction, and `targets[].bands` says which measurement produced it.
          attribution.push({
            beatIndex: beat.beatIndex, basis: 'band-drift',
            noiseFloorPx: measurement.bands[0]?.noiseFloorPx ?? bandOptions.noiseFloorPx ?? round(1 / bandOptions.upsample, 4),
            maxCorrectionPx: measurement.summary.maxCorrectionPx,
            targets: attribute.corrections.map(correction => ({
              id: correction.target.id ?? correction.target.ref,
              dx: correction.correctionPx.dx, dy: correction.correctionPx.dy,
              basis: correction.basis, spreadPx: correction.spreadPx,
              bands: correction.bands.map(band => band.id)
            })),
            bands: measurement.summary,
            contested: attribute.contested.map(entry => entry.target.id ?? entry.target.ref ?? null),
            unattributed: attribute.unattributed.map(entry => entry.id)
          });
        }
        continue;
      }

      const referenceInk = inkBounds(referencePng);
      const renderInk = inkBounds(renderPng);
      if (referenceInk.empty || renderInk.empty) continue;
      const dx = referenceInk.centre.x - renderInk.centre.x;
      const dy = referenceInk.centre.y - renderInk.centre.y;

      const shares = distributeDrift(targets, { dx, dy, mismatchBox: beat.bbox ?? null });
      let sent = 0;
      for (const share of shares) {
        const target = share.target;
        let current = null;
        if (target.expectedKnown !== false) {
          if (target.expected?.position) current = target.expected;
          else if (target.layer) current = evaluateLayerAt(target.layer, beat.frame);
        }
        const patchSpec = buildDeltaPatch({
          layerId: target.id, layerRef: target.ref, current,
          dx: share.dx, dy: share.dy, mismatchPct: beat.mismatchPct, frame: beat.frame
        });
        if (Object.keys(patchSpec.attrs ?? patchSpec.delta ?? {}).length === 0) continue;
        patches.push(patchSpec);
        sent += 1;
      }
      if (sent > 0) {
        attribution.push({
          beatIndex: beat.beatIndex, basis: shares[0].basis,
          drift: { dx: round(dx, 2), dy: round(dy, 2) },
          targets: shares.map(share => ({
            id: share.target.id ?? share.target.ref, weight: share.weight,
            dx: share.dx, dy: share.dy
          }))
        });
      }
    }
    if (bandReports.length) history[history.length - 1].bandDrift = { enabled: true, beats: bandReports };
    if (patches.length === 0) {
      if (useBandDrift && bandReports.length) {
        // A refusal is a finding, not a failure to try harder: naming it here is what stops
        // the next reader from re-running the gate hoping for a patch that was correctly withheld.
        const floor = bandOptions.noiseFloorPx ?? round(1 / bandOptions.upsample, 4);
        const counts = bandReports.reduce((total, report) => ({
          belowNoiseFloor: total.belowNoiseFloor + (report.summary?.belowNoiseFloor?.length ?? 0),
          unmeasured: total.unmeasured + (report.summary?.unmeasured?.length ?? 0),
          lowConfidence: total.lowConfidence + (report.summary?.lowConfidence?.length ?? 0),
          contested: total.contested + (report.contested?.length ?? 0),
          unattributed: total.unattributed + (report.unattributed?.length ?? 0)
        }), { belowNoiseFloor: 0, unmeasured: 0, lowConfidence: 0, contested: 0, unattributed: 0 });
        const reasons = [
          counts.belowNoiseFloor ? `${counts.belowNoiseFloor} band(s) displaced no more than the ${floor} px noise floor` : null,
          counts.lowConfidence ? `${counts.lowConfidence} band(s) scored under ${bandOptions.minScore}` : null,
          counts.unmeasured ? `${counts.unmeasured} band(s) refused measurement` : null,
          counts.contested ? `${counts.contested} layer(s) had bands that disagree beyond ${contestedSpreadPx} px` : null,
          counts.unattributed ? `${counts.unattributed} band(s) matched no active layer` : null
        ].filter(Boolean);
        limitations.push(`Band drift at pass ${pass} sent no patch (${reasons.join('; ')}). The remaining difference is not a placement error, so no layer was moved.`);
      }
      break;
    }
    const { compilePatch } = await import('../dsl/_mg.mjs');
    const script = compilePatch(patches);
    const applied = await client.exec(script);
    if (onPatch) onPatch({ pass, script, applied, patches });
    history[history.length - 1].patches = patches;
    history[history.length - 1].attribution = attribution;
    history[history.length - 1].script = script;
  }
  const worst = latest.reduce((max, beat) => Math.max(max, beat.mismatchPct), 0);
  if (worst > numericThreshold) {
    limitations.push('The delta patch loop exhausted --max-passes; the scene is not claimed converged.');
  }
  return {
    version: PERCEPTUAL_VERSION, status: worst <= numericThreshold ? 'converged' : 'unconverged',
    converged: worst <= numericThreshold, threshold: numericThreshold, maxPasses: passes,
    frames: requestedFrames, beats: latest, passes: history,
    bandDrift: { enabled: useBandDrift, noiseFloorPx: bandOptions.noiseFloorPx ?? round(1 / bandOptions.upsample, 4) },
    patches: history.flatMap(entry => entry.patches ?? []),
    limitations: worst > numericThreshold ? limitations : []
  };
}
