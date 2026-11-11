import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, fileRecord, hashFile, hashObject, readJson, removeTree, runProcess,
  validateArtifact, verifyFiles, withJobLock, writeJsonState
} from '../core.mjs';
import { deriveJobDirectory } from '../design/assets.mjs';
import { evaluateStaticGates } from './gates.mjs';
import { runVisionFreePreRenderGates } from './stages.mjs';
import {
  FILMSTRIP_QA_VERSION,
  buildBeatFilmstrip,
  evaluateReviewLoopChecks,
  runMotionTransferFilmstripQa
} from '../vision/filmstrip-qa.mjs';

export { evaluateStaticGates };
export { FILMSTRIP_QA_VERSION, buildBeatFilmstrip, evaluateReviewLoopChecks, runMotionTransferFilmstripQa };

export const QA_VERSION = '1.0.0';

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
  shiftImprovement: 0.35
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
  const width = reference.width, height = reference.height, pixels = width * height;
  const lumA = new Float32Array(pixels), lumB = new Float32Array(pixels);
  const histogram = new Uint32Array(256);
  let absSum = 0, squaredSum = 0, changed = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1, centroidX = 0, centroidY = 0, weight = 0;
  const columns = Math.ceil(width / DIFF_CELL), rows = Math.ceil(height / DIFF_CELL);
  const cells = new Float64Array(columns * rows);
  for (let y = 0, i = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++, p += 4) {
      const la = luminance(reference.data, p), lb = luminance(render.data, p);
      lumA[i] = la; lumB[i] = lb;
      histogram[Math.min(255, Math.round(la))] += 1;
      const dr = Math.abs(reference.data[p] - render.data[p]);
      const dg = Math.abs(reference.data[p + 1] - render.data[p + 1]);
      const db = Math.abs(reference.data[p + 2] - render.data[p + 2]);
      absSum += dr + dg + db;
      const dl = la - lb;
      squaredSum += dl * dl;
      const delta = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
      if (delta > changedPixelDelta) {
        changed += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        centroidX += x * delta; centroidY += y * delta; weight += delta;
      }
      cells[Math.min(rows - 1, Math.floor(y / DIFF_CELL)) * columns + Math.min(columns - 1, Math.floor(x / DIFF_CELL))] += Math.abs(dl);
    }
  }
  const mae = absSum / (pixels * 3);
  const rmse = Math.sqrt(squaredSum / pixels);

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

  // Dominant (background) luminance: the mode of the reference histogram.
  let background = 0;
  for (let value = 1; value < 256; value++) if (histogram[value] > histogram[background]) background = value;
  const inkThreshold = background - 24;
  let intersect = 0, union = 0;
  for (let i = 0; i < pixels; i++) {
    const a = lumA[i] < inkThreshold, b = lumB[i] < inkThreshold;
    if (a && b) intersect += 1;
    if (a || b) union += 1;
  }
  const inkIou = union / pixels < 0.005 ? null : intersect / union;

  const ranked = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) ranked.push({ cx, cy, energy: cells[cy * columns + cx] });
  }
  ranked.sort((a, b) => b.energy - a.energy);
  const topCell = ranked[0] ?? null;

  return {
    mae: round(mae, 3), rmse: round(rmse, 3), ssim: round(ssimSum / Math.max(1, blocks), 4),
    changedFraction: round(changed / pixels, 4), inkIou: inkIou === null ? null : round(inkIou, 4),
    diffBbox: maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    diffCentroid: weight > 0 ? { x: round(centroidX / weight, 1), y: round(centroidY / weight, 1) } : null,
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

function composeComparison(reference, render, { changedPixelDelta = 24 } = {}) {
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
  return PNG.sync.write(sheet);
}

async function referenceFrames(jobDirectory, referencePath, referenceSha256, plan, config) {
  const cacheDirectory = path.join(jobDirectory, 'qa', 'reference-frames', referenceSha256);
  const framesDirectory = path.join(cacheDirectory, 'frames');
  const metaPath = path.join(cacheDirectory, 'meta.json');
  const total = plan.project.totalFrames;
  const padding = paddedWidth(total);
  const expected = Array.from({ length: total }, (_, frame) => path.join(framesDirectory, `frame-${String(frame).padStart(padding, '0')}.png`));
  const cacheKeyFps = formatFps(plan.project.fps);
  try {
    const meta = await readJson(metaPath);
    // `alignedTo` is part of the cache identity: a tree decoded under a different
    // composition rate, or under the old passthrough policy, indexes its frames
    // differently and must be rebuilt rather than silently reused.
    if (meta.referenceSha256 === referenceSha256 && meta.frames === total && meta.width === plan.project.width &&
        meta.height === plan.project.height && meta.alignedTo === cacheKeyFps &&
        await verifyFiles(expected.map(filePath => ({ path: absolutePath(filePath), sha256: meta.hashes?.[path.basename(filePath)] })))) {
      return { directory: framesDirectory, padding, count: total, cached: true, paths: expected };
    }
  } catch { /* First extraction or a stale cache: rebuild it below. */ }
  // The reference video's own frame rate is not the composition's. A screen capture is
  // typically variable-frame-rate: `avg_frame_rate` differs from `r_frame_rate`, and the
  // stream carries duplicate and dropped frames. Decoding it with `-fps_mode passthrough`
  // preserves that timeline, so the number of PNGs written is the *source* frame count —
  // which then fails the `files.length !== total` assertion below, or worse, succeeds with
  // frames that no longer line up with the rendered sequence's indices. Frame k on disk has
  // to be frame k of the composition, so the decode is resampled to the composition's own
  // constant rate. `round=near` picks the source nearest each output slot, which is the
  // `round=near` picks the source frame nearest each output slot, which is the
  // least-distorting choice when the two rates are close.
  await removeTree(cacheDirectory);
  await fs.mkdir(framesDirectory, { recursive: true });
  const ffmpeg = config.ffmpeg ?? 'ffmpeg';
  const result = await runProcess(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-n',
    '-i', referencePath, '-map', '0:v:0',
    '-vf', `fps=${cacheKeyFps}:round=near`, '-fps_mode', 'cfr', '-start_number', '0',
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
      expected: total, actual: files.length, alignedTo: cacheKeyFps,
      hint: 'Frames were resampled to the composition rate; a residual mismatch means the plan\'s fps and totalFrames disagree with the reference duration.'
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
    height: plan.project.height, padding, hashes, alignedTo: cacheKeyFps,
    updatedAt: new Date().toISOString()
  });
  return { directory: framesDirectory, padding, count: total, cached: false, paths: expected };
}

/**
 * A composition frame rate as the exact rational ffmpeg's `fps` filter expects.
 *
 * `plan.project.fps` is `{ num, den }`, and ffmpeg accepts `30000/1001` verbatim. Keeping
 * it rational rather than converting to `29.97` matters: 29.97 is 2997/100, which is not
 * 30000/1001, and a 1001-frame sequence resampled against the wrong rational drifts by a
 * whole frame — precisely the rounding error this alignment step exists to remove.
 *
 * @param {{ num: number, den: number }} fps
 * @returns {string} e.g. `"30/1"` or `"30000/1001"`
 */
export function formatFps(fps) {
  const num = Number(fps?.num);
  const den = Number(fps?.den);
  if (!Number.isSafeInteger(num) || num < 1 || !Number.isSafeInteger(den) || den < 1) {
    throw new WorkflowError('QA_REFERENCE_FPS_INVALID', 'Composition frame rate is not a positive rational.', {
      fps: fps ?? null
    });
  }
  return `${num}/${den}`;
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
 * Compare aligned frames of a verified render against the reference video.
 *
 * The stage extracts reference frames once per source hash, measures each frame
 * pair, writes comparison images for the worst frames, and emits a schema-valid
 * report. It never edits the scene, the plan or the render.
 */

export async function runQa(planPath, options = {}) {
  if (typeof planPath === 'object' && planPath !== null) {
    if (options.mode === 'motion-transfer' || planPath.mode === 'motion-transfer') {
      return runMotionTransferFilmstripQa(planPath, options);
    }
  }
  const resolvedPlanPath = absolutePath(planPath);
  const plan = await readJson(resolvedPlanPath);
  if (options.mode === 'motion-transfer' || plan?.mode === 'motion-transfer') {
    return runMotionTransferFilmstripQa(plan, options);
  }
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
  const config = options.config ?? await readJson(absolutePath(options.configPath ?? fileURLToPath(new URL('../../config.json', import.meta.url))));
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
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(resolvedPlanPath);
  return withJobLock(jobDirectory, async () => {
    const key = hashObject({
      version: QA_VERSION, planSha256: await hashFile(resolvedPlanPath),
      renderManifestSha256: await hashFile(renderManifestPath), referenceSha256, thresholds
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
    // Vision-free gates run first — plan lint (contrast/overlap/safe zones/font
    // locks/determinism), optional HTML lint, measured geometry, the loop seam and
    // edit-list slates — before any reference frame is decoded or SSIM is computed.
    const staticGateSection = await runVisionFreePreRenderGates({
      scenePlan: plan, ...(options.staticGates ?? {})
    }, { runDirectory });
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
        const comparisonPath = path.join(comparisonsDirectory, `${shot.id}-frame-${String(record.frame).padStart(3, '0')}.png`);
        await fs.writeFile(comparisonPath, composeComparison(referenceImage, renderImage, { changedPixelDelta: thresholds.changedPixelDelta }), { flag: 'wx' })
          .catch(error => { if (error.code !== 'EEXIST') throw error; });
        comparisonPaths.push(comparisonPath);
        record.shift = shift;
        record.comparisonPath = comparisonPath;
      }
      const notes = [];
      if (summary.status !== 'pass') {
        const worst = summary.worst;
        notes.push(`Mean MAE ${summary.metrics.maeMean} (provisional pass limit ${thresholds.shotPassMae}); mean SSIM ${summary.metrics.ssimMean}.`);
        const positional = worst?.shift && worst.shift.improvement >= thresholds.shiftImprovement && Math.abs(worst.shift.dx) + Math.abs(worst.shift.dy) > 0;
        discrepancies.push({
          id: `qa-${shot.id}-appearance`,
          shotId: shot.id,
          elementId: null,
          category: positional ? 'position-offset' : 'appearance-reconstruction',
          timeSeconds: worst?.timeSeconds ?? shot.startSeconds ?? 0,
          frame: worst?.frame ?? shot.startFrame,
          evidence: {
            metrics: summary.metrics,
            worstFrame: worst?.frame ?? null,
            worstFrameMetrics: worst?.metrics ?? null,
            comparisonPath: worst?.comparisonPath ?? null,
            shift: worst?.shift ?? null,
            topCells: worst?.metrics?.topCells ?? []
          },
          confidence: 0.95,
          priority: summary.metrics.maeMean,
          suggestion: positional
            ? `Render content of ${shot.id} is rigidly offset by about (${worst.shift.dx}, ${worst.shift.dy}) px at frame ${worst.frame}; inspect the responsible layer before patching.`
            : `${shot.id} differs in glyph shapes, text texture or background detail; verify the documented font/asset substitutions before changing geometry.`,
          actionable: Boolean(positional)
        });
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
      shots.push({ shotId: shot.id, status: summary.status, metrics: summary.metrics, notes });
      await fs.writeFile(path.join(metadataDirectory, `${shot.id}.json`),
        JSON.stringify({ shotId: shot.id, status: summary.status, metrics: summary.metrics, frames }, null, 2), 'utf8');
    }
    discrepancies.sort((a, b) => b.priority - a.priority);
    const anyFail = shots.some(shot => shot.status === 'fail') || staticGateSection?.status === 'fail';
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
          inkIou: 'IoU of dark-ink masks using the dominant reference luminance as the background estimate; null when ink covers <0.5% of the frame.'
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
      ...(staticGateSection ? { staticGates: staticGateSection } : {}),
      limitations: reportLimitations(plan, config, referenceProbe)
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
