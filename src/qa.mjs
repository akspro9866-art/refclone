import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, fileRecord, hashFile, hashObject, readJson, runProcess,
  validateArtifact, verifyFiles, withJobLock, writeJsonState
} from './core.mjs';
import { deriveJobDirectory } from './assets.mjs';
import { inkField, inkRects, modalBackground, rectDisplacement } from './stages/bandTracking.mjs';

export const QA_VERSION = '1.1.0';

// Provisional comparator thresholds. They are deliberately conservative and are
// reported as uncalibrated: config.qa.thresholdsCalibrated is false, so the
// report cannot claim a calibrated pass. A human must recalibrate them against
// accepted references before the numbers become an acceptance gate.
const DEFAULT_THRESHOLDS = {
  shotPassMae: 5,        // 0-255 mean absolute RGB error
  shotPassSsim: 0.8,     // 8x8 block SSIM, luminance
  shotReviewMae: 24,
  shotReviewSsim: 0.3,
  frameAttentionMae: 12,
  frameAttentionSsim: 0.6,
  changedPixelDelta: 24,
  shiftSearchRadius: 6,
  shiftImprovement: 0.35,
  // Region scoring (see compareRegions). A region is a reference row-ink band, so
  // these limits are per text line rather than per frame.
  regions: true,         // config.qa.regions.enabled overrides this
  regionMaxCount: 24,
  regionMinRowInkRatio: 0.02,
  regionUpSample: 8,     // profile interpolation: the measurement quantum is 1/8 px
  regionSearchRadiusPx: 8,
  regionNoiseFloorPx: 0.125,
  regionPassMae: 3,
  regionGeometryGain: 0.6,
  regionTextureGain: 0.25
};

const DIFF_CELL = 32;

function paddedWidth(totalFrames) {
  return Math.max(3, String(totalFrames - 1).length);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function luminance(data, index) {
  return 0.299 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
}

/**
 * Mean SSIM over non-overlapping 8x8 luminance blocks. `lumA`/`lumB` are contiguous
 * `width` x `height` buffers, so one implementation serves the whole-frame score and
 * a cropped region score alike. Blocks at the right and bottom edge are clamped
 * rather than dropped, exactly as the original frame-level loop did.
 */
function blockSsim(lumA, lumB, width, height) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ssimSum = 0, blocks = 0;
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      const bw = Math.min(8, width - bx), bh = Math.min(8, height - by), count = bw * bh;
      let ma = 0, mb = 0;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const index = (by + y) * width + bx + x;
          ma += lumA[index]; mb += lumB[index];
        }
      }
      ma /= count; mb /= count;
      let va = 0, vb = 0, cov = 0;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const index = (by + y) * width + bx + x;
          const da = lumA[index] - ma, db = lumB[index] - mb;
          va += da * da; vb += db * db; cov += da * db;
        }
      }
      va /= count; vb /= count; cov /= count;
      ssimSum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks += 1;
    }
  }
  return { ssim: ssimSum / Math.max(1, blocks), blocks };
}

/**
 * Accumulate the pixel statistics of one rectangle of an aligned pair.
 *
 * `lumA`/`lumB` are contiguous buffers of the *cropped* rect, which is what lets the
 * same SSIM block loop score a frame and a line of type. Every other output — the
 * difference bbox, the centroid, the optional energy cells — is reported in full-frame
 * coordinates, so a region's numbers can be read against the picture a human sees.
 * The ink mask thresholds on the rect's own modal luminance: a text line and a logo
 * plate can sit on different backgrounds inside one frame.
 */
function pixelStatistics(reference, render, rect, changedPixelDelta, { cells = false } = {}) {
  const width = rect.width, height = rect.height, pixels = width * height;
  const lumA = new Float32Array(pixels), lumB = new Float32Array(pixels);
  const histogram = new Uint32Array(256);
  let absSum = 0, squaredSum = 0, changed = 0;
  let minX = reference.width, minY = reference.height, maxX = -1, maxY = -1, centroidX = 0, centroidY = 0, weight = 0;
  const columns = cells ? Math.ceil(reference.width / DIFF_CELL) : 0;
  const rows = cells ? Math.ceil(reference.height / DIFF_CELL) : 0;
  const grid = cells ? new Float64Array(columns * rows) : null;
  for (let y = 0, i = 0; y < height; y++, i += width) {
    const sourceY = rect.y + y;
    for (let x = 0; x < width; x++) {
      const index = i + x;
      const sourceX = rect.x + x;
      const at = (sourceY * reference.width + sourceX) * 4;
      const other = (sourceY * render.width + sourceX) * 4;
      const la = luminance(reference.data, at), lb = luminance(render.data, other);
      lumA[index] = la; lumB[index] = lb;
      histogram[Math.min(255, Math.round(la))] += 1;
      const dr = Math.abs(reference.data[at] - render.data[other]);
      const dg = Math.abs(reference.data[at + 1] - render.data[other + 1]);
      const db = Math.abs(reference.data[at + 2] - render.data[other + 2]);
      absSum += dr + dg + db;
      const dl = la - lb;
      squaredSum += dl * dl;
      const delta = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
      if (delta > changedPixelDelta) {
        changed += 1;
        if (sourceX < minX) minX = sourceX;
        if (sourceY < minY) minY = sourceY;
        if (sourceX > maxX) maxX = sourceX;
        if (sourceY > maxY) maxY = sourceY;
        centroidX += sourceX * delta; centroidY += sourceY * delta; weight += delta;
      }
      if (cells) grid[Math.min(rows - 1, Math.floor(sourceY / DIFF_CELL)) * columns + Math.min(columns - 1, Math.floor(sourceX / DIFF_CELL))] += Math.abs(dl);
    }
  }
  let background = 0;
  for (let value = 1; value < 256; value++) if (histogram[value] > histogram[background]) background = value;
  const inkThreshold = background - 24;
  let intersect = 0, union = 0;
  for (let index = 0; index < pixels; index++) {
    const a = lumA[index] < inkThreshold, b = lumB[index] < inkThreshold;
    if (a && b) intersect += 1;
    if (a || b) union += 1;
  }
  return {
    lumA, lumB, pixels, width, height,
    mae: absSum / (pixels * 3),
    rmse: Math.sqrt(squaredSum / pixels),
    changed,
    inkIou: union / pixels < 0.005 ? null : intersect / union,
    backgroundLuminance: background,
    diffBbox: maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    diffCentroid: weight > 0 ? { x: round(centroidX / weight, 1), y: round(centroidY / weight, 1) } : null,
    centroidWeight: weight,
    cells: grid, columns, rows
  };
}

/**
 * Compare one aligned reference/render pair. SSIM uses non-overlapping 8x8
 * luminance blocks (a documented approximation of the published SSIM variant),
 * and the ink mask uses the dominant luminance as the flat-background estimate,
 * so text layout agreement is measured independently of anti-aliasing color.
 */
export function compareFrames(reference, render, { changedPixelDelta }) {
  if (reference.width !== render.width || reference.height !== render.height) {
    throw new WorkflowError('QA_FRAME_DIMENSIONS', 'Reference and render frame dimensions differ.', {
      reference: { width: reference.width, height: reference.height },
      render: { width: render.width, height: render.height }
    });
  }
  const width = reference.width, height = reference.height;
  const stats = pixelStatistics(reference, render, { x: 0, y: 0, width, height }, changedPixelDelta, { cells: true });
  const { lumA, lumB, pixels, mae, rmse, changed, inkIou, diffBbox, diffCentroid, cells, columns, rows } = stats;
  const ssimValue = blockSsim(lumA, lumB, width, height).ssim;

  const ranked = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) ranked.push({ cx, cy, energy: cells[cy * columns + cx] });
  }
  ranked.sort((a, b) => b.energy - a.energy);

  return {
    mae: round(mae, 3), rmse: round(rmse, 3), ssim: round(ssimValue, 4),
    changedFraction: round(changed / pixels, 4), inkIou: inkIou === null ? null : round(inkIou, 4),
    diffBbox, diffCentroid,
    topCells: ranked.slice(0, 3).map(cell => ({
      x: cell.cx * DIFF_CELL, y: cell.cy * DIFF_CELL, energy: round(cell.energy, 1)
    }))
  };
}

/**
 * Coarse whole-frame translation estimate on downsampled luminance. It only
 * quantifies a rigid offset; it cannot explain scaling, font or color changes.
 */
export function estimateShift(reference, render, { radius }) {
  const width = reference.width, height = reference.height;
  const halfW = Math.floor(width / 2), halfH = Math.floor(height / 2);
  const a = new Float32Array(halfW * halfH), b = new Float32Array(halfW * halfH);
  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < halfW; x++) {
      const p = (y * 2 * width + x * 2) * 4;
      a[y * halfW + x] = luminance(reference.data, p);
      b[y * halfW + x] = luminance(render.data, p);
    }
  }
  const margin = 6;
  let best = { dx: 0, dy: 0, error: Infinity }, zero = null;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      let sum = 0, count = 0;
      for (let y = margin; y < halfH - margin; y++) {
        const sy = y + dy;
        if (sy < 0 || sy >= halfH) continue;
        for (let x = margin; x < halfW - margin; x++) {
          const sx = x + dx;
          if (sx < 0 || sx >= halfW) continue;
          sum += Math.abs(a[y * halfW + x] - b[sy * halfW + sx]);
          count += 1;
        }
      }
      const error = count === 0 ? Infinity : sum / count;
      if (dx === 0 && dy === 0) zero = error;
      if (error < best.error) best = { dx, dy, error };
    }
  }
  const improvement = zero > 0 ? 1 - best.error / zero : 0;
  return { dx: best.dx, dy: best.dy, residual: round(best.error, 2), zeroResidual: round(zero, 2), improvement: round(improvement, 3) };
}

// ---------------------------------------------------------------------------
// Region-aware scoring.
//
// One whole-frame MAE cannot say *where* a render is wrong, and one whole-frame
// shift cannot say *why*. A region here is a row of reference ink — the same band
// discovery the motion measurement uses — so the score belongs to a line of type
// rather than to an arbitrary grid. For each region the stage measures three
// separable things: the pixel error, the sub-pixel displacement of the render's ink
// against the reference's, and how much of the pixel error a rigid slide removes.
// The last pair is the texture-versus-geometry test: an error that a translation
// explains is a placement error and is patchable; an error that survives every
// translation is an appearance error — glyph shapes, anti-aliasing, colours — and
// no position patch fixes it.
// ---------------------------------------------------------------------------

/** Modal RGB of a decoded frame, the flat-background estimate the ink field needs. */
export function modalColor(png, options = {}) {
  return modalBackground(png, options);
}

/**
 * Find the ink bands of one frame, in full-frame pixel coordinates.
 *
 * The bands come from the reference only: a region the reference does not show is
 * not something the render can be scored against, and extra ink in the render is
 * reported by that region's own error rather than by inventing a region for it.
 */
export function deriveRegions(png, options = {}) {
  const settings = { ...DEFAULT_THRESHOLDS, ...options };
  const domainX = settings.domain?.x ?? 0;
  const discovered = inkRects(png, {
    background: settings.background,
    minRowInkRatio: settings.regionMinRowInkRatio,
    maxBands: settings.regionMaxCount,
    domainStart: domainX,
    domainEnd: settings.domain?.width != null ? domainX + settings.domain.width : png.width,
    rowStart: settings.domain?.y ?? 0,
    rowEnd: settings.domain?.height != null ? (settings.domain.y ?? 0) + settings.domain.height : png.height
  });
  return {
    background: discovered.background,
    basis: `${discovered.bands.length} of ${discovered.found} reference ink band(s); a row counts as ink once ${discovered.minInk} weighted pixel(s) of it differ from ${discovered.background}.`,
    found: discovered.found,
    truncated: discovered.truncated,
    minInk: discovered.minInk,
    regions: discovered.bands.map(band => ({ id: band.id, rect: band.rect, ink: band.ink }))
  };
}

/**
 * Sub-pixel displacement of the render's ink against the reference's, on both axes.
 *
 * Thin wrapper over bandTracking's `rectDisplacement`, which is the same measurement
 * Stage 2D tracks motion with and the same one Stage 5 patches from: a drift in a QA
 * report and a drift in a patch cannot be different numbers about the same pixels.
 * Positive dxPx/dyPx means the render sits right of or below the reference;
 * `correctionPx` is what a layer needs, already negated.
 */
export function regionDrift(reference, render, rect, options = {}) {
  const settings = { ...DEFAULT_THRESHOLDS, ...options };
  return rectDisplacement(reference, render, rect, {
    background: settings.background ?? settings.fields?.background,
    fields: settings.fields,
    upsample: settings.regionUpSample,
    rangePx: settings.regionSearchRadiusPx,
    noiseFloorPx: settings.regionNoiseFloorPx
  });
}

/**
 * How much of a region's error a rigid slide removes.
 *
 * The candidates are the measured drift and its +-1 px neighbourhood (plus zero, which
 * is the control), never a wide blind search: a search free to move far would find a
 * low error by aligning a different word entirely. Only offsets that keep most of the
 * region inside the frame are eligible, so a slide cannot win by discarding half of the
 * pixels it was asked to explain.
 */
export function rigidAlignment(reference, render, rect, drift, options = {}) {
  const settings = { ...DEFAULT_THRESHOLDS, ...options };
  if (!drift?.measured) return { gain: null, reason: drift?.reason ?? 'no-sub-pixel-measurement' };
  // The slide is probed at the drift the profile measured, never at the frame-level
  // search radius: a 10 px displacement is a placement error too, and capping the probe
  // at 6 would report it as "partly appearance" because the rest of it was never tested.
  const clip = value => Math.max(-settings.regionSearchRadiusPx, Math.min(settings.regionSearchRadiusPx, value));
  const base = { x: clip(Math.round(drift.dxPx)), y: clip(Math.round(drift.dyPx)) };
  const candidates = [{ x: 0, y: 0 }];
  for (const ox of [-1, 0, 1]) {
    for (const oy of [-1, 0, 1]) {
      const offset = { x: base.x + ox, y: base.y + oy };
      if (offset.x === 0 && offset.y === 0) continue;
      candidates.push(offset);
    }
  }
  const errorAt = offset => {
    let sum = 0, count = 0;
    for (let y = 0; y < rect.height; y++) {
      const targetY = rect.y + y + offset.y;
      if (targetY < 0 || targetY >= render.height) continue;
      for (let x = 0; x < rect.width; x++) {
        const targetX = rect.x + x + offset.x;
        if (targetX < 0 || targetX >= render.width) continue;
        const from = ((rect.y + y) * reference.width + rect.x + x) * 4;
        const to = (targetY * render.width + targetX) * 4;
        sum += Math.abs(reference.data[from] - render.data[to])
          + Math.abs(reference.data[from + 1] - render.data[to + 1])
          + Math.abs(reference.data[from + 2] - render.data[to + 2]);
        count += 1;
      }
    }
    return { mae: count ? sum / (count * 3) : Infinity, coverage: count / (rect.width * rect.height) };
  };
  const zero = errorAt({ x: 0, y: 0 });
  let best = zero, bestOffset = { x: 0, y: 0 };
  for (const offset of candidates) {
    if (offset.x === 0 && offset.y === 0) continue;
    const error = errorAt(offset);
    if (error.coverage < 0.5) continue;
    if (error.mae < best.mae) { best = error; bestOffset = offset; }
  }
  const gain = zero.mae > 1e-9 ? Math.max(0, 1 - best.mae / zero.mae) : 0;
  return {
    gain: round(gain, 4),
    offsetPx: bestOffset,
    maeAtZero: round(zero.mae, 3),
    maeAfterShift: round(best.mae, 3),
    coverage: round(best.coverage, 4),
    integerDriftPx: base,
    reason: null
  };
}

/**
 * One region's score: pixel error, sub-pixel drift, and the texture-versus-geometry
 * verdict. `diagnostic` is one of match | position | aligned | texture | mixed |
 * unmeasurable, and `reason` always states the numbers the verdict was read from.
 */
export function measureRegion(reference, render, region, options = {}) {
  const settings = { ...DEFAULT_THRESHOLDS, ...options };
  const rect = region?.rect ?? region;
  if (!rect || !Number.isInteger(rect.x) || !Number.isInteger(rect.y)) {
    throw new WorkflowError('QA_REGION_INVALID', 'A region needs an integer top-left in frame pixels.', { region });
  }
  const clipped = {
    x: Math.max(0, rect.x), y: Math.max(0, rect.y),
    width: Math.min(reference.width - Math.max(0, rect.x), rect.width),
    height: Math.min(reference.height - Math.max(0, rect.y), rect.height)
  };
  const base = {
    id: region?.id ?? `region-${clipped.x}-${clipped.y}-${clipped.width}-${clipped.height}`,
    rect: clipped,
    elementId: settings.elementId ?? null
  };
  if (clipped.width < 8 || clipped.height < 8 || reference.width !== render.width || reference.height !== render.height) {
    return { ...base, diagnostic: 'unmeasurable', reason: clipped.width < 8 || clipped.height < 8 ? 'region-too-small' : 'dimension-mismatch', mae: null };
  }
  const stats = pixelStatistics(reference, render, clipped, settings.changedPixelDelta);
  const ssimValue = blockSsim(stats.lumA, stats.lumB, clipped.width, clipped.height).ssim;
  const drift = regionDrift(reference, render, clipped, settings);
  const alignment = rigidAlignment(reference, render, clipped, drift, settings);
  const mae = round(stats.mae, 3);
  let diagnostic, reason;
  if (mae <= settings.regionPassMae) {
    diagnostic = 'match';
    reason = `region MAE ${mae} is at or below the provisional region limit ${settings.regionPassMae}`;
  } else if (alignment.gain === null) {
    diagnostic = 'unmeasurable';
    reason = `the ink profile gave no sub-pixel alignment (${alignment.reason})`;
  } else if (alignment.gain >= settings.regionGeometryGain) {
    // The slide explains the error; the only question is whether it is big enough to
    // act on. A drift at or under the patch floor says "this line is placed as
    // accurately as a position key can be", and patching it would be noise.
    diagnostic = drift.aboveNoiseFloor ? 'position' : 'aligned';
    reason = diagnostic === 'position'
      ? `a rigid slide of ${alignment.offsetPx.x}, ${alignment.offsetPx.y} px removes ${round(alignment.gain * 100, 1)}% of the region error`
      : `a slide of ${round(Math.abs(drift.dxPx), 3)}, ${round(Math.abs(drift.dyPx), 3)} px removes ${round(alignment.gain * 100, 1)}% of the error, at or under the ${settings.regionNoiseFloorPx} px patch floor`;
  } else if (alignment.gain <= settings.regionTextureGain) {
    diagnostic = 'texture';
    reason = `no slide removes more than ${round(alignment.gain * 100, 1)}% of the region error, so the difference is in the pixels themselves`;
  } else {
    diagnostic = 'mixed';
    reason = `a slide removes ${round(alignment.gain * 100, 1)}% of the error and ${alignment.maeAfterShift} MAE survives it`;
  }
  return {
    ...base,
    pixels: stats.pixels,
    mae,
    rmse: round(stats.rmse, 3),
    ssim: round(ssimValue, 4),
    changedFraction: round(stats.changed / stats.pixels, 4),
    inkIou: stats.inkIou === null ? null : round(stats.inkIou, 4),
    diffBbox: stats.diffBbox,
    diffCentroid: stats.diffCentroid,
    ink: region?.ink ?? null,
    drift: {
      dxPx: drift.dxPx, dyPx: drift.dyPx, correctionPx: drift.correctionPx,
      score: drift.score, marginPx: drift.marginPx, quantumPx: drift.quantumPx,
      noiseFloorPx: drift.noiseFloorPx, aboveNoiseFloor: drift.aboveNoiseFloor, reason: drift.reason
    },
    geometry: alignment,
    diagnostic,
    // A position verdict that still leaves a large residual is both: the layer is in the
    // wrong place *and* its rendering differs. Saying so beats picking one.
    alsoAppearance: diagnostic === 'position' && Number.isFinite(alignment.maeAfterShift) && alignment.maeAfterShift > settings.regionPassMae,
    reason
  };
}

/**
 * Score every reference ink band of one frame pair.
 *
 * Cost is bounded by design: the bands come from the reference, the ink field is
 * decoded once per frame, and the rigid alignment only probes the neighbourhood of the
 * measured drift. `summary` is the roll-up a report line needs; the per-region records
 * carry the evidence.
 */
export function compareRegions(reference, render, options = {}) {
  const settings = { ...DEFAULT_THRESHOLDS, ...options };
  let derived;
  if (options.regions) {
    derived = {
      regions: options.regions,
      basis: 'supplied region list',
      background: settings.background ?? modalBackground(reference).hex
    };
  } else {
    try {
      derived = deriveRegions(reference, settings);
    } catch (error) {
      throw new WorkflowError('QA_REGION_DISCOVERY', 'No reference ink band could be found, so the frame cannot be scored region by region.', {
        reason: error.message, background: settings.background ?? null
      });
    }
  }
  const background = derived.background;
  if (!background) {
    throw new WorkflowError('QA_REGION_BACKGROUND', 'The reference frame carries no pixels, so no background can be measured and no region scored.', {});
  }
  const fields = {
    background,
    reference: inkField(reference, { background }),
    render: inkField(render, { background })
  };
  const elements = options.elementRects ?? [];
  const records = derived.regions.map(region => {
    const match = elements.find(element => overlapFraction(element.rect, region.rect) >= 0.2);
    return measureRegion(reference, render, region, { ...settings, background, fields, elementId: match?.id ?? null });
  });
  const scored = records.filter(record => Number.isFinite(record.mae));
  const worst = scored.reduce((max, record) => (!max || record.mae > max.mae ? record : max), null);
  const offDiagonal = scored.filter(record => record.diagnostic !== 'match');
  return {
    background,
    basis: derived.basis,
    regions: records,
    summary: {
      regions: records.length,
      scored: scored.length,
      unmeasurable: records.length - scored.length,
      worstMae: worst?.mae ?? null,
      worstRegionId: worst?.id ?? null,
      position: offDiagonal.filter(record => record.diagnostic === 'position').length,
      texture: offDiagonal.filter(record => record.diagnostic === 'texture').length,
      mixed: offDiagonal.filter(record => record.diagnostic === 'mixed').length,
      // An 'aligned' region has an error a slide would explain, but the slide is at or
      // under the patch floor: reported so a reviewer can see the render is that close,
      // and never patched.
      aligned: offDiagonal.filter(record => record.diagnostic === 'aligned').length,
      attributed: records.filter(record => record.elementId).length
    },
    limitations: []
  };
}

/** IoU-style overlap of two {x, y, width, height} rectangles. */
function overlapFraction(a, b) {
  if (!a || !b) return 0;
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

/**
 * Best-effort mapping from plan elements to frame rectangles.
 *
 * A scene plan is not required to carry geometry, and where it does the shape differs
 * by planner (normalized bbox, pixel bounds, or a size plus an origin). This reads all
 * three and reports nothing it cannot resolve; an unattributed region is a known gap in
 * the plan, not a measurement failure.
 */
export function elementRects(plan, frame) {
  const rects = [];
  for (const element of plan?.elements ?? []) {
    const parameters = element?.parameters ?? {};
    const direct = parameters.bbox ?? parameters.bounds ?? parameters.rect ?? parameters.pixelBounds ?? null;
    let rect = null;
    if (direct && (Number.isFinite(direct.x) || Number.isFinite(direct.left))) {
      const left = direct.left ?? direct.x, top = direct.top ?? direct.y;
      // `rightExclusive`/`bottomExclusive` are how Stage 2B stores pixel bounds; `right`
      // is already treated as an exclusive end, so both spellings give the same width.
      const right = direct.right ?? direct.rightExclusive ?? (Number.isFinite(direct.width) ? left + direct.width : null);
      const bottom = direct.bottom ?? direct.bottomExclusive ?? (Number.isFinite(direct.height) ? top + direct.height : null);
      if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom)) {
        // A bbox whose extents are <= 1 is normalized, which is how auto-analysis states
        // are stored; anything else is already in pixels.
        const normalized = Math.max(right, bottom) <= 1.5;
        rect = normalized
          ? { x: Math.round(left * frame.width), y: Math.round(top * frame.height), width: Math.round((right - left) * frame.width), height: Math.round((bottom - top) * frame.height) }
          : { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
      }
    }
    if (!rect && Number.isFinite(parameters.widthPx) && Number.isFinite(parameters.heightPx)) {
      const width = Math.round(parameters.widthPx), height = Math.round(parameters.heightPx);
      // Cavalry positions layers by their origin, which the generic planner derives from
      // a bbox centre; `center`/`position` name the centre itself. Both are read as the
      // anchor they are called, because a rect built on the wrong assumption is worse
      // than no attribution at all.
      const centered = parameters.origin === undefined;
      const anchor = centered ? (parameters.center ?? parameters.position ?? null) : parameters.origin;
      if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
        rect = centered
          ? { x: Math.round(anchor.x - width / 2), y: Math.round(anchor.y - height / 2), width, height }
          : { x: Math.round(anchor.x), y: Math.round(anchor.y), width, height };
      }
    }
    if (!rect && Number.isFinite(parameters.widthPx) && Number.isFinite(parameters.heightPx)
        && Number.isFinite(parameters.centerXPx) && Number.isFinite(parameters.centerYPx)) {
      // `centerXPx`/`centerYPx` are the planner's frame-pixel ink centre plus measured
      // size, which is the shape a real scene-plan carries for text and image layers.
      // Full-frame backgrounds reuse the same keys with the comp centre as (0, 0), and
      // that is not a frame-pixel centre: the rect is only claimed when it lands inside
      // the frame, so a background stays unattributed instead of overlapping every band.
      const width = Math.round(parameters.widthPx), height = Math.round(parameters.heightPx);
      const candidate = {
        x: Math.round(parameters.centerXPx - width / 2),
        y: Math.round(parameters.centerYPx - height / 2),
        width, height
      };
      if (candidate.x >= 0 && candidate.y >= 0
          && candidate.x + width <= frame.width && candidate.y + height <= frame.height) rect = candidate;
    }
    if (rect && rect.width > 0 && rect.height > 0) rects.push({ id: element.id, rect });
  }
  return rects;
}

function composeComparison(reference, render, { changedPixelDelta = 24, regions = null } = {}) {
  const width = reference.width, height = reference.height, gap = 6;
  const sheet = new PNG({ width: width * 3 + gap * 2, height });
  sheet.data.fill(18);
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
  const blit = (source, offset) => {
    for (let y = 0; y < height; y++) {
      source.data.copy(sheet.data, (y * sheet.width + offset) * 4, y * width * 4, (y + 1) * width * 4);
    }
  };
  blit(reference, 0);
  blit(render, width + gap);
  const diffOffset = (width + gap) * 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4, to = (y * sheet.width + diffOffset + x) * 4;
      const delta = Math.max(
        Math.abs(reference.data[from] - render.data[from]),
        Math.abs(reference.data[from + 1] - render.data[from + 1]),
        Math.abs(reference.data[from + 2] - render.data[from + 2])
      );
      const value = Math.min(255, delta * 4);
      sheet.data[to] = value; sheet.data[to + 1] = value; sheet.data[to + 2] = value; sheet.data[to + 3] = 255;
    }
  }
  // Region outlines on the diff panel: a reviewer sees which line of the measurement
  // each score belongs to, instead of guessing from a coordinate in the report.
  for (const region of regions ?? []) {
    if (!region?.rect || region.rect.width <= 0 || region.rect.height <= 0) continue;
    const left = diffOffset + region.rect.x, top = region.rect.y;
    const right = left + region.rect.width - 1, bottom = top + region.rect.height - 1;
    const mark = (x, y) => {
      if (x < diffOffset || x >= sheet.width || y < 0 || y >= height) return;
      const at = (y * sheet.width + x) * 4;
      sheet.data[at] = 0; sheet.data[at + 1] = 255; sheet.data[at + 2] = 0; sheet.data[at + 3] = 255;
    };
    for (let x = left; x <= right; x++) { mark(x, top); mark(x, bottom); }
    for (let y = top; y <= bottom; y++) { mark(left, y); mark(right, y); }
  }
  return PNG.sync.write(sheet);
}

async function referenceFrames(jobDirectory, referencePath, referenceSha256, plan, config) {
  const cacheDirectory = path.join(jobDirectory, 'qa', 'reference-frames', referenceSha256);
  const framesDirectory = path.join(cacheDirectory, 'frames');
  const metaPath = path.join(cacheDirectory, 'meta.json');
  const total = plan.project.totalFrames;
  const padding = paddedWidth(total);
  const expected = Array.from({ length: total }, (_, frame) => path.join(framesDirectory, `frame-${String(frame).padStart(padding, '0')}.png`));
  try {
    const meta = await readJson(metaPath);
    if (meta.referenceSha256 === referenceSha256 && meta.frames === total && meta.width === plan.project.width &&
        meta.height === plan.project.height && await verifyFiles(expected.map(filePath => ({ path: absolutePath(filePath), sha256: meta.hashes?.[path.basename(filePath)] })))) {
      return { directory: framesDirectory, padding, count: total, cached: true, paths: expected };
    }
  } catch { /* First extraction or a stale cache: rebuild it below. */ }
  await fs.rm(cacheDirectory, { recursive: true, force: true });
  await fs.mkdir(framesDirectory, { recursive: true });
  const ffmpeg = config.ffmpeg ?? 'ffmpeg';
  const result = await runProcess(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-n',
    '-i', referencePath, '-map', '0:v:0', '-fps_mode', 'passthrough', '-start_number', '0',
    path.join(framesDirectory, `frame-%0${padding}d.png`)
  ], { timeoutMs: config.ingestion?.processTimeoutMs ?? 300_000 });
  if (result.exitCode !== 0) {
    throw new WorkflowError('QA_REFERENCE_EXTRACTION_FAILED', 'FFmpeg failed to decode reference frames.', {
      exitCode: result.exitCode, stderr: String(result.stderr ?? '').slice(-800)
    });
  }
  const files = (await fs.readdir(framesDirectory)).filter(name => name.endsWith('.png')).sort();
  if (files.length !== total) {
    throw new WorkflowError('QA_REFERENCE_FRAME_COUNT', 'Decoded reference frame count differs from the plan.', {
      expected: total, actual: files.length
    });
  }
  const hashes = {};
  for (const name of files) {
    const record = await fileRecord(path.join(framesDirectory, name));
    hashes[name] = record.sha256;
    const png = PNG.sync.read(await fs.readFile(record.path));
    if (png.width !== plan.project.width || png.height !== plan.project.height) {
      throw new WorkflowError('QA_REFERENCE_DIMENSIONS', 'Decoded reference frame dimensions differ from the plan.', {
        file: name, actual: { width: png.width, height: png.height }
      });
    }
  }
  await writeJsonState(metaPath, {
    schemaVersion: 1, referencePath, referenceSha256, frames: total, width: plan.project.width,
    height: plan.project.height, padding, hashes, updatedAt: new Date().toISOString()
  });
  return { directory: framesDirectory, padding, count: total, cached: false, paths: expected };
}

function probeReference(ffprobe, referencePath, { timeoutMs }) {
  return runProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:format=duration',
    '-of', 'json', referencePath], { timeoutMs }).then(result => {
    if (result.exitCode !== 0) {
      throw new WorkflowError('QA_REFERENCE_PROBE_FAILED', 'FFprobe could not read the reference video.', {
        exitCode: result.exitCode, stderr: String(result.stderr ?? '').slice(-800)
      });
    }
    try {
      return JSON.parse(result.stdout).streams?.[0] ?? null;
    } catch {
      throw new WorkflowError('QA_REFERENCE_PROBE_INVALID', 'FFprobe returned non-JSON output.', {});
    }
  });
}

export function shotStatus(metrics, thresholds) {
  if (metrics.maeMean > thresholds.shotReviewMae || metrics.ssimMean < thresholds.shotReviewSsim) return 'fail';
  if (metrics.maeMean > thresholds.shotPassMae || metrics.ssimMean < thresholds.shotPassSsim) return 'needs_review';
  return 'pass';
}

export function aggregateShot(shotId, frames, thresholds) {
  const values = frames.map(frame => frame.metrics);
  const mae = values.map(value => value.mae).sort((a, b) => a - b);
  const ssim = values.map(value => value.ssim);
  const median = mae.length % 2 ? mae[(mae.length - 1) / 2] : (mae[mae.length / 2 - 1] + mae[mae.length / 2]) / 2;
  const p95 = mae[Math.min(mae.length - 1, Math.floor(mae.length * 0.95))];
  const metrics = {
    maeMean: round(mae.reduce((a, b) => a + b, 0) / Math.max(1, mae.length), 3),
    maeMedian: round(median, 3),
    maeP95: round(p95, 3),
    maeMax: round(mae[mae.length - 1] ?? 0, 3),
    ssimMean: round(ssim.reduce((a, b) => a + b, 0) / Math.max(1, ssim.length), 4),
    ssimMin: round(Math.min(...ssim), 4),
    changedFractionMean: round(values.reduce((a, v) => a + v.changedFraction, 0) / Math.max(1, values.length), 4),
    inkIouMean: (() => {
      const inks = values.map(value => value.inkIou).filter(value => typeof value === 'number');
      return inks.length ? round(inks.reduce((a, b) => a + b, 0) / inks.length, 4) : null;
    })(),
    frameCount: values.length
  };
  const worst = frames.reduce((best, frame) => (!best || frame.metrics.mae > best.metrics.mae ? frame : best), null);
  return { shotId, metrics, worst, status: shotStatus(metrics, thresholds) };
}

function describe(frame, details) {
  return `frame ${frame}${details ? `: ${details}` : ''}`;
}

function qaMarkdown(report, context) {
  const lines = [];
  lines.push('# Visual QA report', '');
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Reference: \`${context.referencePath}\` (sha256 \`${report.referenceHash}\`)`);
  lines.push(`- Render: \`${context.renderVideoPath}\` (sha256 \`${report.renderHash}\`)`);
  lines.push(`- Alignment: ${report.alignment.method}; ${report.alignment.mapping.length} shot mappings; VFR: ${report.alignment.vfr}`);
  lines.push(`- Thresholds: provisional, calibrated=${report.thresholds.calibrated}`);
  lines.push('', '## Shots', '');
  lines.push('| Shot | Status | MAE mean | MAE p95 | SSIM mean | Changed px | Ink IoU | Worst frame |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const shot of report.shots) {
    const m = shot.metrics;
    lines.push(`| ${shot.shotId} | ${shot.status} | ${m.maeMean} | ${m.maeP95} | ${m.ssimMean} | ${(m.changedFractionMean * 100).toFixed(1)}% | ${m.inkIouMean ?? '—'} | ${context.worstFrames[shot.shotId] ?? '—'} |`);
  }
  if (report.shots.some(shot => Array.isArray(shot.regions) && shot.regions.length)) {
    lines.push('', '## Regions', '');
    lines.push('Per reference ink band on the sampled frame. `gain` is the share of the region error a rigid slide removes;', '');
    lines.push('`drift` is render-minus-reference in px, and `patch` is the correction that slide would apply.', '');
    for (const shot of report.shots) {
      if (!Array.isArray(shot.regions) || shot.regions.length === 0) continue;
      lines.push('', `### ${shot.shotId} (frame ${shot.regionsSampledFrame})`, '');
      lines.push('| Region | Element | Diagnostic | MAE | SSIM | Ink IoU | Drift x,y | Gain | Patch dx,dy |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const region of shot.regions) {
        const drift = region.drift ?? {};
        lines.push(`| ${region.id} (rows ${region.rect?.y}–${(region.rect?.y ?? 0) + (region.rect?.height ?? 0)}) | ${region.elementId ?? '—'} | ${region.diagnostic} | ${region.mae ?? '—'} | ${region.ssim ?? '—'} | ${region.inkIou ?? '—'} | ${drift.dxPx ?? '—'}, ${drift.dyPx ?? '—'} | ${region.geometry?.gain ?? '—'} | ${drift.correctionPx ? `${drift.correctionPx.dx}, ${drift.correctionPx.dy}` : '—'} |`);
      }
      for (const region of shot.regions.filter(item => item.diagnostic !== 'match')) {
        lines.push('', `- ${region.id}: ${region.diagnostic} — ${region.reason}`);
      }
    }
  }
  if (report.discrepancies.length) {
    lines.push('', '## Discrepancies', '');
    for (const item of report.discrepancies) {
      lines.push(`### ${item.id} — ${item.category} (${item.shotId})`, '');
      lines.push(`- Frame ${item.frame} (${item.timeSeconds.toFixed(3)} s); element: ${item.elementId ?? 'not localized'}; confidence ${item.confidence}; actionable: ${item.actionable}`);
      lines.push(`- Evidence: ${JSON.stringify(item.evidence)}`);
      lines.push(`- Suggestion: ${item.suggestion}`, '');
    }
  } else {
    lines.push('', 'No discrepancy exceeded the provisional attention thresholds.', '');
  }
  lines.push('## Limitations', '');
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  return lines.join('\n');
}

function reportLimitations(plan, config, referenceProbe) {
  const limitations = [
    'Comparator thresholds are provisional and uncalibrated (config qa.thresholdsCalibrated=false); this report cannot claim a calibrated pass.',
    'SSIM is computed on 8x8 non-overlapping luminance blocks, an approximation of the published Gaussian-window SSIM.',
    'MAE is measured on decoded RGB; H.264 compression noise contributes a small nonzero floor even on flat backgrounds.',
    'Automatic correction is disabled by config.correction.automatic=false; discrepancies are evidence for a gated correction pass.'
  ];
  if (referenceProbe && referenceProbe.avg_frame_rate !== referenceProbe.r_frame_rate) {
    limitations.push(`Reference average rate ${referenceProbe.avg_frame_rate} differs from nominal ${referenceProbe.r_frame_rate}; frame-index alignment was reviewed.`);
  }
  const assets = plan.assets ?? [];
  for (const asset of assets) {
    if (asset.type === 'font' && /approximation|unverified/i.test(String(asset.notes ?? ''))) {
      limitations.push(`Font ${asset.id} (${asset.fontFamily ?? asset.id} ${asset.fontStyle ?? ''}) is an approved approximation; glyph widths may differ from the reference.`.trim());
    }
    if (asset.type === 'logo' && /extract/i.test(String(asset.notes ?? ''))) {
      limitations.push(`Logo asset ${asset.id} is a raster extraction from the reference, not the original vector artwork.`);
    }
  }
  for (const item of plan.unresolved ?? []) {
    const text = typeof item === 'string' ? item : item?.description ?? item?.reason ?? null;
    if (text) limitations.push(`Unresolved in plan: ${text}`);
  }
  return [...new Set(limitations)];
}

/**
 * What region scoring can and cannot claim, written from the records it produced
 * rather than from the settings, so a disabled or empty pass says so in its own words.
 */
function regionLimitations(thresholds, shots, { enabled, elementRectCount }) {
  if (!enabled) {
    return ['Region scoring is disabled (config.qa.regions.enabled=false): every score in this report is a whole-frame average, so no line-level cause is claimed.'];
  }
  const sampled = shots.filter(shot => Array.isArray(shot.regions));
  if (sampled.length === 0) {
    return ['Region scoring was enabled but no sampled frame produced a region list, so no line-level cause is claimed.'];
  }
  const regions = sampled.flatMap(shot => shot.regions ?? []);
  const scored = regions.filter(region => Number.isFinite(region.mae));
  const attributed = scored.filter(region => region.elementId).length;
  const aligned = scored.filter(region => region.diagnostic === 'aligned').length;
  const limitations = [
    `Regions are reference ink bands measured on one sampled frame per shot (${sampled.length} of ${shots.length} shots); they are not plan elements, and ink that enters or leaves the frame mid-shot is unmeasured here.`,
    'Geometry gain classifies an error as placement or appearance; it does not prove which layer is offset, and a region suggestion is a candidate for a gated correction pass, never an applied change.'
  ];
  if (elementRectCount === 0) {
    limitations.push('The plan carries no per-element geometry, so no region is attributed to an element id: region findings name pixel rows, not layers.');
  } else if (attributed < scored.length) {
    limitations.push(`${scored.length - attributed} of ${scored.length} region(s) could not be matched to a plan element rectangle and are reported unattributed.`);
  }
  if (aligned > 0) {
    limitations.push(`${aligned} region(s) differ only by a slide at or under the ${thresholds.regionNoiseFloorPx} px patch floor; they are reported and deliberately not patched.`);
  }
  if (scored.some(region => region.alsoAppearance)) {
    limitations.push('At least one region is placed wrongly and rendered differently; its position patch would not close the whole error.');
  }
  return limitations;
}

/**
 * Compare aligned frames of a verified render against the reference video.
 *
 * The stage extracts reference frames once per source hash, measures each frame
 * pair, writes comparison images for the worst frames, and emits a schema-valid
 * report. It never edits the scene, the plan or the render.
 */
export async function runQa(planPath, options = {}) {
  const resolvedPlanPath = absolutePath(planPath);
  const plan = await readJson(resolvedPlanPath);
  await validateArtifact('scene-plan', plan);
  if (!options.renderManifestPath) throw new WorkflowError('QA_RENDER_REQUIRED', 'QA requires --render <render-manifest.json>.');
  const renderManifestPath = absolutePath(options.renderManifestPath);
  const manifest = await readJson(renderManifestPath);
  await validateArtifact('render-manifest', manifest);
  if (manifest.status !== 'verified' || !manifest.video || manifest.video.validated !== true) {
    throw new WorkflowError('QA_RENDER_NOT_VERIFIED', 'QA requires a verified, decoded render manifest.', {
      manifestPath: renderManifestPath, status: manifest.status, video: Boolean(manifest.video)
    });
  }
  const config = options.config ?? await readJson(absolutePath(options.configPath ?? fileURLToPath(new URL('../config.json', import.meta.url))));
  const referencePath = absolutePath(options.referencePath ?? config.reference);
  const referenceSha256 = await hashFile(referencePath);
  if (referenceSha256 !== plan.sourceHash) {
    throw new WorkflowError('QA_SOURCE_MISMATCH', 'The reference video is not the plan source.', {
      referencePath, referenceSha256, planSourceHash: plan.sourceHash
    });
  }
  if (manifest.sourceHash !== plan.sourceHash) {
    throw new WorkflowError('QA_RENDER_SOURCE_MISMATCH', 'The render manifest belongs to another source.', {
      manifestSourceHash: manifest.sourceHash, planSourceHash: plan.sourceHash
    });
  }
  const renderVideoRecord = await fileRecord(manifest.video.path);
  if (renderVideoRecord.sha256 !== manifest.video.sha256) {
    throw new WorkflowError('QA_RENDER_HASH_MISMATCH', 'The encoded render changed after its manifest was written.', {
      videoPath: manifest.video.path, expected: manifest.video.sha256, actual: renderVideoRecord.sha256
    });
  }
  const frameRecordsValid = await verifyFiles(manifest.frames.map(frame => ({ path: frame.path, sha256: frame.sha256 })));
  if (!frameRecordsValid) throw new WorkflowError('QA_FRAME_HASH_MISMATCH', 'Rendered frames no longer match the render manifest.', {});
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  // Region scoring is opt-out: a frame is broken into its reference ink bands and each
  // band is scored separately. The plan's element geometry, where it has any, is what
  // turns a band into "this element is wrong" rather than "rows 50-78 are wrong".
  const regionScoring = config.qa?.regions?.enabled !== false && thresholds.regions !== false;
  const regionMaxCount = config.qa?.regions?.maxRegions ?? thresholds.regionMaxCount;
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(resolvedPlanPath);
  return withJobLock(jobDirectory, async () => {
    // The enabled flag and the band cap change what the report claims, so they belong in
    // the cache key: a disabled run must not be served the cached result of an enabled one.
    const key = hashObject({
      version: QA_VERSION, planSha256: await hashFile(resolvedPlanPath),
      renderManifestSha256: await hashFile(renderManifestPath), referenceSha256, thresholds,
      regionScoring, regionMaxCount
    });
    const cacheDirectory = path.join(jobDirectory, 'qa', key);
    await fs.mkdir(cacheDirectory, { recursive: true });
    const cachePath = path.join(cacheDirectory, 'index.json');
    const runDirectory = absolutePath(path.join(cacheDirectory, randomUUID()));
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && cached.reportPath && await verifyFiles([
        { path: cached.reportPath, sha256: cached.reportSha256 },
        { path: cached.markdownPath, sha256: cached.markdownSha256 }
      ])) {
        return { ...cached, cached: true };
      }
    } catch { /* First QA run for this key. */ }
    await fs.mkdir(runDirectory, { recursive: true });
    const comparisonsDirectory = path.join(runDirectory, 'comparisons');
    const metadataDirectory = path.join(runDirectory, 'metrics');
    await fs.mkdir(comparisonsDirectory, { recursive: true });
    await fs.mkdir(metadataDirectory, { recursive: true });
    const ffprobe = config.ffprobe ?? 'ffprobe';
    const referenceProbe = await probeReference(ffprobe, referencePath, { timeoutMs: config.ingestion?.processTimeoutMs ?? 300_000 });
    if (!referenceProbe) throw new WorkflowError('QA_REFERENCE_STREAM', 'The reference video has no decodable video stream.', { referencePath });
    if (Number(referenceProbe.width) !== plan.project.width || Number(referenceProbe.height) !== plan.project.height ||
        referenceProbe.r_frame_rate !== `${plan.project.fps.num}/${plan.project.fps.den}`) {
      throw new WorkflowError('QA_REFERENCE_COMPOSITION', 'Reference composition differs from the plan.', {
        expected: plan.project, actual: referenceProbe
      });
    }
    const reference = await referenceFrames(jobDirectory, referencePath, referenceSha256, plan, config);
    const regionElements = regionScoring ? elementRects(plan, { width: plan.project.width, height: plan.project.height }) : [];
    // `regions` is the opt-out switch, not a region list: compareRegions reads a truthy
    // `regions` as "score exactly these", so the flag is taken out before the rest of the
    // thresholds are passed through.
    const regionThresholds = { ...thresholds };
    delete regionThresholds.regions;
    const regionOptions = {
      ...regionThresholds,
      elementRects: regionElements,
      regionMaxCount
    };

    const renderByFrame = new Map(manifest.frames.map(frame => [frame.frame, frame]));
    const shotForFrame = frame => plan.shots.find(shot => frame >= shot.startFrame && frame < shot.endFrameExclusive);
    const frameMetrics = [];
    const shotFrames = new Map(plan.shots.map(shot => [shot.id, []]));
    for (let frame = 0; frame < plan.project.totalFrames; frame++) {
      const renderFrame = renderByFrame.get(frame);
      if (!renderFrame) throw new WorkflowError('QA_FRAME_MISSING', `Render manifest has no frame ${frame}.`, { frame });
      const shot = shotForFrame(frame);
      if (!shot) throw new WorkflowError('QA_FRAME_UNMAPPED', `Frame ${frame} belongs to no planned shot.`, { frame });
      const referencePathForFrame = reference.paths[frame];
      const referenceImage = PNG.sync.read(await fs.readFile(referencePathForFrame));
      const renderImage = PNG.sync.read(await fs.readFile(renderFrame.path));
      const metrics = compareFrames(referenceImage, renderImage, { changedPixelDelta: thresholds.changedPixelDelta });
      const record = { frame, shotId: shot.id, timeSeconds: round(frame * plan.project.fps.den / plan.project.fps.num, 4), metrics };
      frameMetrics.push(record);
      shotFrames.get(shot.id).push(record);
      if (frame % 24 === 0) {
        await writeJsonState(cachePath, {
          key, version: QA_VERSION, runDirectory, status: 'partial', framesMeasured: frameMetrics.length,
          referenceSha256, renderHash: renderVideoRecord.sha256, updatedAt: new Date().toISOString()
        });
      }
    }

    const shots = [];
    const discrepancies = [];
    const worstFrames = {};
    const comparisonPaths = [];
    for (const shot of plan.shots) {
      const frames = shotFrames.get(shot.id);
      const summary = aggregateShot(shot.id, frames, thresholds);
      worstFrames[shot.id] = summary.worst?.frame ?? null;
      // A frame is only an outlier when it departs from its own shot: absolute
      // attention limits alone would flag every frame of a uniformly different
      // shot and bury the one-shot summary in duplicate noise.
      const frameMaeLimit = Math.max(thresholds.frameAttentionMae, summary.metrics.maeMean * 1.5);
      const frameSsimLimit = Math.min(thresholds.frameAttentionSsim, summary.metrics.ssimMean - 0.1);
      const outlierCandidates = frames
        .filter(record => record.metrics.mae > frameMaeLimit || record.metrics.ssim < frameSsimLimit)
        .sort((a, b) => b.metrics.mae - a.metrics.mae)
        .slice(0, 2);
      const interesting = [summary.worst, ...outlierCandidates].filter((record, index, list) =>
        record && list.findIndex(candidate => candidate?.frame === record.frame) === index).slice(0, 3);
      for (const record of interesting) {
        const referenceImage = PNG.sync.read(await fs.readFile(reference.paths[record.frame]));
        const renderImage = PNG.sync.read(await fs.readFile(renderByFrame.get(record.frame).path));
        let shift = null;
        try {
          shift = estimateShift(referenceImage, renderImage, { radius: thresholds.shiftSearchRadius });
        } catch { shift = null; }
        let regions = null;
        if (regionScoring) {
          try {
            regions = compareRegions(referenceImage, renderImage, regionOptions);
          } catch (error) {
            // A region pass that cannot run is a gap in the evidence, never a reason to
            // drop the frame's whole-frame numbers.
            record.regionError = error?.code ?? error?.message ?? 'region-scoring-failed';
          }
        }
        const comparisonPath = path.join(comparisonsDirectory, `${shot.id}-frame-${String(record.frame).padStart(3, '0')}.png`);
        await fs.writeFile(comparisonPath, composeComparison(referenceImage, renderImage, {
          changedPixelDelta: thresholds.changedPixelDelta,
          regions: regions?.regions?.filter(region => region.diagnostic !== 'match') ?? null
        }), { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        comparisonPaths.push(comparisonPath);
        record.shift = shift;
        record.comparisonPath = comparisonPath;
        record.regions = regions?.regions ?? null;
        record.regionSummary = regions?.summary ?? null;
        record.regionBasis = regions?.basis ?? null;
      }
      const notes = [];
      const worst = summary.worst;
      // Regions that carry an explanation, in descending error order. 'match' and
      // 'aligned' are excluded: the first agrees, the second is off by less than the
      // patch floor, and neither is a thing a correction pass should touch.
      const offending = (worst?.regions ?? [])
        .filter(region => region.diagnostic === 'position' || region.diagnostic === 'texture' || region.diagnostic === 'mixed')
        .sort((a, b) => b.mae - a.mae);
      const worstRegion = offending[0] ?? null;
      if (summary.status !== 'pass') {
        notes.push(`Mean MAE ${summary.metrics.maeMean} (provisional pass limit ${thresholds.shotPassMae}); mean SSIM ${summary.metrics.ssimMean}.`);
        // Region evidence outranks the whole-frame shift estimate: it names the line that
        // is wrong and says whether a slide fixes it. The frame-level estimate stays as
        // the fallback for shots scored before region scoring existed, or where every
        // region was unmeasurable.
        const positionalByRegion = worstRegion?.diagnostic === 'position';
        const positional = positionalByRegion || (worst?.shift && worst.shift.improvement >= thresholds.shiftImprovement
          && Math.abs(worst.shift.dx) + Math.abs(worst.shift.dy) > 0);
        const regionNote = worstRegion
          ? `Worst region ${worstRegion.id}${worstRegion.elementId ? ` (${worstRegion.elementId})` : ''}: ${worstRegion.diagnostic}, ${worstRegion.reason}.`
          : null;
        if (regionNote) notes.push(regionNote);
        discrepancies.push({
          id: `qa-${shot.id}-appearance`,
          shotId: shot.id,
          elementId: worstRegion?.elementId ?? null,
          category: positional ? 'position-offset' : 'appearance-reconstruction',
          timeSeconds: worst?.timeSeconds ?? shot.startSeconds ?? 0,
          frame: worst?.frame ?? shot.startFrame,
          evidence: {
            metrics: summary.metrics,
            worstFrame: worst?.frame ?? null,
            worstFrameMetrics: worst?.metrics ?? null,
            comparisonPath: worst?.comparisonPath ?? null,
            shift: worst?.shift ?? null,
            topCells: worst?.metrics?.topCells ?? [],
            regionSummary: worst?.regionSummary ?? null,
            regionBasis: worst?.regionBasis ?? null,
            worstRegion: worstRegion ?? null,
            regions: offending.slice(0, 8)
          },
          confidence: worstRegion ? 0.97 : 0.95,
          priority: summary.metrics.maeMean,
          suggestion: positionalByRegion
            ? `${shot.id} region ${worstRegion.id} is displaced by about (${worstRegion.drift.correctionPx.dx}, ${worstRegion.drift.correctionPx.dy}) px at frame ${worst.frame}; that slide removes ${Math.round(worstRegion.geometry.gain * 100)}% of the region error${worstRegion.alsoAppearance ? ', and the error that survives it is an appearance difference, not a position one' : ''}.`
            : positional
              ? `Render content of ${shot.id} is rigidly offset by about (${worst.shift.dx}, ${worst.shift.dy}) px at frame ${worst.frame}; inspect the responsible layer before patching.`
              : `${shot.id} differs in glyph shapes, text texture or background detail${worstRegion ? `; region ${worstRegion.id} keeps ${worstRegion.geometry?.maeAfterShift ?? worstRegion.mae} MAE after the best slide` : ''}; verify the documented font/asset substitutions before changing geometry.`,
          actionable: Boolean(positional)
        });
        // One discrepancy per offending region, so a correction pass has a target rather
        // than a frame average to guess from. Only the three worst are listed: beyond
        // that a shot with many small offenders is a systemic issue, reported by the
        // shot-level entry above.
        for (const region of offending.slice(0, 3)) {
          const patchable = region.diagnostic === 'position';
          discrepancies.push({
            id: `qa-${shot.id}-region-${region.id}`,
            shotId: shot.id,
            elementId: region.elementId ?? null,
            category: patchable ? 'region-position' : region.diagnostic === 'mixed' ? 'region-mixed' : 'region-appearance',
            timeSeconds: worst?.timeSeconds ?? shot.startSeconds ?? 0,
            frame: worst?.frame ?? shot.startFrame,
            evidence: {
              region,
              rect: region.rect,
              comparisonPath: worst?.comparisonPath ?? null,
              frameMetrics: worst?.metrics ?? null
            },
            confidence: region.diagnostic === 'position' ? 0.95 : 0.85,
            priority: region.mae,
            suggestion: patchable
              ? `Move the layer that draws ${region.id}${region.elementId ? ` (${region.elementId})` : ''} of ${shot.id} by (${region.drift.correctionPx.dx}, ${region.drift.correctionPx.dy}) px at frame ${worst?.frame ?? shot.startFrame}; measured drift ${region.drift.dxPx}, ${region.drift.dyPx} px at a ${region.drift.quantumPx} px quantum.`
              : region.diagnostic === 'mixed'
                ? `${region.id} of ${shot.id} is both displaced (${region.drift?.correctionPx?.dx}, ${region.drift?.correctionPx?.dy}) px and rendered differently; patch the position first, then compare the residue.`
                : `${region.id} of ${shot.id} is placed as far as a slide can tell and still differs: check the copy, the font substitution and the colour before touching geometry.`,
            actionable: patchable
          });
        }
      }
      if (outlierCandidates.length) {
        for (const record of outlierCandidates) {
          notes.push(`${describe(record.frame, `MAE ${record.metrics.mae}, SSIM ${record.metrics.ssim}`)} exceeds the frame attention threshold.`);
          discrepancies.push({
            id: `qa-${shot.id}-frame-${record.frame}`,
            shotId: shot.id,
            elementId: null,
            category: 'frame-outlier',
            timeSeconds: record.timeSeconds,
            frame: record.frame,
            evidence: {
              metrics: record.metrics,
              shift: record.shift ?? null,
              comparisonPath: record.comparisonPath ?? null
            },
            confidence: 0.9,
            priority: record.metrics.mae,
            suggestion: `Inspect frame ${record.frame} in ${shot.id}; it differs more than the sibling frames at the same shot state.`,
            actionable: false
          });
        }
      }
      // Region numbers are measured on the sampled worst frame, so they enter the shot
      // as counts and the worst value rather than as a mean over frames: averaging a
      // per-line drift across frames of an animated shot would describe nothing real.
      if (worst?.regionSummary) {
        const rs = worst.regionSummary;
        summary.metrics.regionCount = rs.regions;
        summary.metrics.regionWorstMae = rs.worstMae;
        summary.metrics.regionPosition = rs.position;
        summary.metrics.regionAppearance = rs.texture + rs.mixed;
        summary.metrics.regionAlignedSubFloor = rs.aligned;
      }
      shots.push({
        shotId: shot.id,
        status: summary.status,
        metrics: summary.metrics,
        notes,
        // The region detail lives on the sampled frame(s); null says region scoring was
        // off or could not run, which is a stated gap rather than a silent zero.
        regions: regionScoring ? (worst?.regions ?? null) : null,
        regionsSampledFrame: regionScoring ? (worst?.frame ?? null) : null
      });
      await fs.writeFile(path.join(metadataDirectory, `${shot.id}.json`),
        JSON.stringify({ shotId: shot.id, status: summary.status, metrics: summary.metrics, regionsSampledFrame: worst?.frame ?? null, frames }, null, 2), 'utf8');
    }
    discrepancies.sort((a, b) => b.priority - a.priority);
    const anyFail = shots.some(shot => shot.status === 'fail');
    const anyReview = shots.some(shot => shot.status === 'needs_review');
    const status = anyFail ? 'fail' : (anyReview || config.qa?.requireManualReview !== false || config.qa?.thresholdsCalibrated !== true) ? 'needs_review' : 'pass';
    const report = {
      schemaVersion: 1,
      sourceHash: plan.sourceHash,
      status,
      referenceHash: referenceSha256,
      renderHash: renderVideoRecord.sha256,
      thresholds: {
        calibrated: config.qa?.thresholdsCalibrated === true,
        status: config.qa?.thresholdsCalibrated === true ? 'calibrated' : 'provisional',
        values: thresholds,
        metricDefinitions: {
          mae: 'Mean absolute RGB channel error on a 0-255 scale.',
          rmse: 'Root mean squared luminance error on a 0-255 scale.',
          ssim: 'SSIM over 8x8 non-overlapping luminance blocks, averaged.',
          changedFraction: `Fraction of pixels whose maximum RGB channel delta exceeds ${thresholds.changedPixelDelta}.`,
          inkIou: 'IoU of dark-ink masks using the dominant reference luminance as the background estimate; null when ink covers <0.5% of the frame.',
          regionMae: `Per-region MAE on the sampled frame's reference ink bands; a region at or under ${thresholds.regionPassMae} is a match.`,
          regionDriftPx: 'Render-to-reference ink-profile displacement measured by normalized cross-correlation of an interpolated profile, quantised to 1/' + thresholds.regionUpSample + ' px. Positive means the render sits right of or below the reference; correctionPx is its negation.',
          regionGeometryGain: `Fraction of a region's error that a rigid slide near the measured drift removes. At or above ${thresholds.regionGeometryGain} the difference is placement; at or below ${thresholds.regionTextureGain} it is appearance.`
        }
      },
      alignment: {
        method: 'direct-frame-index',
        referenceFps: referenceProbe.r_frame_rate,
        referenceAverageFps: referenceProbe.avg_frame_rate,
        referenceFrames: Number(referenceProbe.nb_frames ?? NaN),
        renderFps: `${plan.project.fps.num}/${plan.project.fps.den}`,
        renderFrames: manifest.frames.length,
        resolution: { width: plan.project.width, height: plan.project.height },
        vfr: referenceProbe.avg_frame_rate !== referenceProbe.r_frame_rate,
        mapping: plan.shots.map(shot => ({
          shotId: shot.id,
          sourceStartFrame: shot.startFrame,
          renderStartFrame: shot.startFrame,
          frameCount: shot.endFrameExclusive - shot.startFrame,
          timeSeconds: round(shot.startFrame * plan.project.fps.den / plan.project.fps.num, 4)
        })),
        notes: 'Both media decode to the same constant-rate 24 fps frame count; frame N maps to time N/24 in both.'
      },
      shots,
      discrepancies,
      limitations: [
        ...reportLimitations(plan, config, referenceProbe),
        ...regionLimitations(thresholds, shots, { enabled: regionScoring, elementRectCount: regionElements.length })
      ]
    };
    await validateArtifact('qa-report', report);
    const reportPath = path.join(runDirectory, 'qa-report.json');
    const markdownPath = path.join(runDirectory, 'qa-report.md');
    await writeJsonState(reportPath, report);
    await fs.writeFile(markdownPath, qaMarkdown(report, { referencePath, renderVideoPath: manifest.video.path, worstFrames }), 'utf8');
    const reportSha256 = await hashFile(reportPath);
    const markdownSha256 = await hashFile(markdownPath);
    const state = {
      key, version: QA_VERSION, runDirectory, status, reportPath, reportSha256, markdownPath, markdownSha256,
      referenceSha256, renderHash: renderVideoRecord.sha256, renderManifestPath,
      framesMeasured: frameMetrics.length, shots: shots.map(shot => ({ shotId: shot.shotId, status: shot.status, metrics: shot.metrics })),
      discrepancies: discrepancies.map(item => ({ id: item.id, shotId: item.shotId, category: item.category, priority: item.priority, actionable: item.actionable })),
      comparisons: comparisonPaths, cached: false, updatedAt: new Date().toISOString()
    };
    await writeJsonState(cachePath, state);
    return { ...state, report };
  });
}
