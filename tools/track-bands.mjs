#!/usr/bin/env node
// Measure per-band sub-pixel motion between reference frames.
//
// One call answers three questions a whole-frame number cannot: how far each text
// line moved between frames, to what precision that is really known (quantum, peak
// width, competitor margin), and whether the line moved as one piece or word by word
// (gap anchors and their spread).
//
// Evidence only: it reads PNGs, writes numbers, and edits no plan, scene or job.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_BAND_OPTIONS, trackBands } from '../src/stages/bandTracking.mjs';

const args = process.argv.slice(2);
function take(flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  args.splice(index, 2);
  return value;
}
function takeAll(flag) {
  const values = [];
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.unshift(value);
    args.splice(index, 2);
  }
  return values;
}
function switchOn(name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}
function number(value, fallback, label) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} expects a number, got "${value}".`);
  return parsed;
}
const frameKey = name => {
  const runs = String(name).match(/\d+/g);
  return runs ? Number(runs[runs.length - 1]) : null;
};

const USAGE = `usage: track-bands.mjs --frames <dir> --out <json> [options]
  --band label:y0:y1      band to measure, repeatable (with --axis y the range is columns)
  --bands-json <file>     JSON array of {id, y0, y1} (or {id, x0, x1} with --axis y)
  --background #rrggbb    modal background the ink weight is measured from (${DEFAULT_BAND_OPTIONS.background})
  --axis x|y              direction of the motion being measured (default ${DEFAULT_BAND_OPTIONS.axis})
  --range <px>            maximum |shift| searched (default ${DEFAULT_BAND_OPTIONS.rangePx})
  --upsample <n>          profile interpolation factor; 8 resolves 1/8 px (default ${DEFAULT_BAND_OPTIONS.upsample})
  --ref <frame>           frame every dx is measured from (default: the first selected frame)
  --start/--end <frame>   restrict the frame range, inclusive
  --step <n>              sample every n-th frame of the range
  --list 28,29,33         exact frame list, overriding --start/--end/--step
  --domain x0:x1          columns the profile sums over (default: the full width)
  --min-ink <n>           row ink sum that makes a row part of a band; by default it is
                          ${DEFAULT_BAND_OPTIONS.minRowInkRatio * 100}% of the domain width, because an
                          absolute threshold cannot fit both a 64 px clip and a 736 px frame
  --min-gap <px>          minimum width of a tracked word gap (default ${DEFAULT_BAND_OPTIONS.minGapPx})
  --gap-weight <w>        profile value below which a column counts as empty (default ${DEFAULT_BAND_OPTIONS.gapWeight})
  --window <px>           half-width of an anchor correlation window (default ${DEFAULT_BAND_OPTIONS.anchorWindowPx})
  --max-bands <n>         refuse more auto-detected bands than this (default ${DEFAULT_BAND_OPTIONS.maxBands})
  --max-anchors <n>       gap anchors kept per band, widest first (default ${DEFAULT_BAND_OPTIONS.maxAnchors})
  --no-anchors            skip gap-anchor measurement
  --stdout                print the whole report instead of a summary
Examples:
  node tools/track-bands.mjs --frames jobs/<hash>/ingest/frames --out work/bands.json --band wall:52:96
  node tools/track-bands.mjs --frames work/frames --start 28 --end 126 --out work/wall.json
  node tools/track-bands.mjs --frames work/frames --step 4 --upsample 16 --range 40 --out work/sparse.json`;

const frameDir = take('--frames');
const out = take('--out');
const bandSpecs = takeAll('--band');
const bandsJsonPath = take('--bands-json');
const writeStdout = switchOn('--stdout');
const anchors = !switchOn('--no-anchors');
const options = {
  background: take('--background', DEFAULT_BAND_OPTIONS.background),
  axis: take('--axis', DEFAULT_BAND_OPTIONS.axis),
  rangePx: number(take('--range'), DEFAULT_BAND_OPTIONS.rangePx, '--range'),
  upsample: number(take('--upsample'), DEFAULT_BAND_OPTIONS.upsample, '--upsample'),
  anchorWindowPx: number(take('--window'), DEFAULT_BAND_OPTIONS.anchorWindowPx, '--window'),
  minGapPx: number(take('--min-gap'), DEFAULT_BAND_OPTIONS.minGapPx, '--min-gap'),
  gapWeight: number(take('--gap-weight'), DEFAULT_BAND_OPTIONS.gapWeight, '--gap-weight'),
  minRowInk: number(take('--min-ink'), DEFAULT_BAND_OPTIONS.minRowInk, '--min-ink'),
  maxBands: number(take('--max-bands'), DEFAULT_BAND_OPTIONS.maxBands, '--max-bands'),
  maxAnchors: number(take('--max-anchors'), DEFAULT_BAND_OPTIONS.maxAnchors, '--max-anchors'),
  ref: take('--ref'),
  start: number(take('--start'), null, '--start'),
  end: number(take('--end'), null, '--end'),
  step: number(take('--step'), 1, '--step'),
  list: take('--list'),
  domain: take('--domain')
};
if (!frameDir || !out) {
  console.error('error: --frames <dir> and --out <json> are both required.\n');
  console.error(USAGE);
  process.exit(2);
}
if (args.length > 0) {
  console.error(`error: unrecognised argument(s): ${args.join(' ')}\n`);
  console.error(USAGE);
  process.exit(2);
}
if (!Number.isInteger(options.upsample) || options.upsample < 1) {
  throw new Error(`--upsample must be an integer >= 1, got "${options.upsample}".`);
}
if (!Number.isInteger(options.step) || options.step < 1) {
  throw new Error(`--step must be a positive integer, got "${options.step}".`);
}
if ([options.start, options.end].some(value => value !== null && !Number.isInteger(value))) {
  throw new Error('--start and --end need integer frame numbers.');
}

const bands = bandSpecs.map(spec => {
  const parts = spec.split(':');
  if (parts.length !== 3 || !parts.slice(1).every(value => /^\d+$/.test(value))) {
    throw new Error(`--band expects label:y0:y1 with integers, got "${spec}".`);
  }
  return { id: parts[0], start: Number(parts[1]), end: Number(parts[2]) };
});
if (bandsJsonPath) {
  const parsed = JSON.parse(await readFile(bandsJsonPath, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed?.bands;
  if (!Array.isArray(list)) throw new Error(`${bandsJsonPath} must hold an array of bands or {bands: [...]}.`);
  bands.push(...list);
}
const domainParts = options.domain ? options.domain.split(':').map(Number) : null;
if (domainParts && (domainParts.length !== 2 || domainParts.some(value => !Number.isInteger(value)))) {
  throw new Error(`--domain expects x0:x1 integers, got "${options.domain}".`);
}

const frames = (await readdir(frameDir))
  .filter(file => /\.png$/i.test(file))
  .map(file => ({ file, frame: frameKey(file) }))
  .filter(entry => entry.frame !== null)
  .sort((a, b) => a.frame - b.frame || a.file.localeCompare(b.file));
if (frames.length === 0) throw new Error(`No numbered PNGs found in ${frameDir}.`);

const wantedList = options.list
  ? options.list.split(',').map(value => Number(value.trim())).filter(Number.isFinite)
  : null;
const selected = frames.filter(entry => {
  if (wantedList) return wantedList.includes(entry.frame);
  if (Number.isInteger(options.start) && entry.frame < options.start) return false;
  if (Number.isInteger(options.end) && entry.frame > options.end) return false;
  return true;
}).filter((entry, index) => index % options.step === 0);
if (selected.length < 2) {
  throw new Error(`Only ${selected.length} of ${frames.length} frame(s) in ${frameDir} are selected; motion needs at least two.`);
}
for (const frame of wantedList ?? []) {
  if (!selected.some(entry => entry.frame === frame)) throw new Error(`--list names frame ${frame}, which ${frameDir} does not contain.`);
}

const referenceIndex = options.ref === null ? 0 : selected.findIndex(entry => entry.frame === Number(options.ref));
if (referenceIndex === -1) {
  throw new Error(`--ref frame ${options.ref} is not inside the selection ${selected[0].frame}..${selected[selected.length - 1].frame}.`);
}

const report = await trackBands(selected.map(entry => path.join(frameDir, entry.file)), {
  // The selection is authoritative: the tool has already resolved frame numbers from the
  // filenames and applied --start/--end/--step, so the stage must not re-derive them.
  frames: selected.map(entry => entry.frame),
  frameDirectory: frameDir,
  bands,
  background: options.background,
  axis: options.axis,
  rangePx: options.rangePx,
  upsample: options.upsample,
  anchorWindowPx: options.anchorWindowPx,
  minGapPx: options.minGapPx,
  gapWeight: options.gapWeight,
  minRowInk: options.minRowInk,
  maxBands: options.maxBands,
  maxAnchors: options.maxAnchors,
  domainStart: domainParts ? domainParts[0] : undefined,
  domainEnd: domainParts ? domainParts[1] : undefined,
  referenceIndex,
  anchors
});

await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (writeStdout) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(JSON.stringify({
    out,
    schema: report.schema,
    anchorFrame: report.anchorFrame,
    frameCount: report.frameCount,
    raster: report.raster,
    summary: report.summary,
    bands: report.bands.map(band => ({
      id: band.id,
      band: band.band,
      anchorFrame: band.anchorFrame,
      framesMeasured: band.framesMeasured,
      displacementPx: band.displacementPx,
      dxRangePx: [band.minDxPx, band.maxDxPx],
      meanScore: band.meanScore,
      minMarginPx: band.minMarginPx,
      widestPeakWidthPx: band.widestPeakWidthPx,
      gapCount: band.gapCount,
      maxAnchorSpreadPx: band.maxAnchorSpreadPx,
      maxGapWidthDeltaPx: band.maxGapWidthDeltaPx,
      unresolvedFrames: band.unresolvedFrames.slice(0, 12),
      firstDx: band.series.slice(0, 4).map(record => record.dxPx),
      lastDx: band.series.slice(-4).map(record => record.dxPx)
    }))
  }, null, 2));
}
