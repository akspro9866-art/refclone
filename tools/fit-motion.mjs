#!/usr/bin/env node
// Turn a track-bands measurement into the fewest keyframes that still reproduce it.
//
// One call answers the question Stage 3 leaves open: given a band that demonstrably moved
// this many pixels over these frames, how many keys does the move need, which curve shape
// gets it there, and what error was actually achieved? It answers with numbers, not with
// a curve it hopes fits, and it refuses to fit a band whose own trust fields say the
// alignment was guesswork.
//
// Evidence only: it reads a measurement report, writes numbers, and edits no plan, scene
// or job.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_FIT_OPTIONS, fitBands } from '../src/stages/motionFitting.mjs';

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

const USAGE = `usage: fit-motion.mjs --bands <track-bands.json> --out <json> [options]
  --bands <file>        a track-bands report, {bands: [...]}, or a [{frame, value}] series
  --out <json>          where to write the fit artifact
  --band <id>           fit only this band, repeatable (default: every band in the report)
  --tolerance <px>      largest permitted deviation of model from measurement (default ${DEFAULT_FIT_OPTIONS.tolerancePx})
  --max-keys <n>        key budget for the piecewise rung (default ${DEFAULT_FIT_OPTIONS.maxKeys})
  --min-score <x>       drop frames whose correlation score is below this (default ${DEFAULT_FIT_OPTIONS.minScore})
  --min-margin <px>     drop frames whose competitor margin is below this (default ${DEFAULT_FIT_OPTIONS.minMarginPx})
  --min-travel <px>     a smaller total displacement is reported static (default: the band quantum)
  --no-presets          skip the named-preset rung and fit only custom curves
  --expression          print the Custom easing expression text for every custom fit
  --stdout              print the whole artifact instead of a summary
Examples:
  node tools/fit-motion.mjs --bands work/bands.json --out work/fits.json
  node tools/fit-motion.mjs --bands work/bands.json --band rows-30-64 --tolerance 0.5 --out work/one.json
  node tools/fit-motion.mjs --bands work/series.json --out work/fit.json --expression`;

const bandsPath = take('--bands');
const out = take('--out');
const only = takeAll('--band');
const showExpressions = switchOn('--expression');
const writeStdout = switchOn('--stdout');
const options = {
  tolerancePx: number(take('--tolerance'), DEFAULT_FIT_OPTIONS.tolerancePx, '--tolerance'),
  maxKeys: number(take('--max-keys'), DEFAULT_FIT_OPTIONS.maxKeys, '--max-keys'),
  minScore: number(take('--min-score'), DEFAULT_FIT_OPTIONS.minScore, '--min-score'),
  minMarginPx: number(take('--min-margin'), DEFAULT_FIT_OPTIONS.minMarginPx, '--min-margin'),
  minTravelPx: number(take('--min-travel'), DEFAULT_FIT_OPTIONS.minTravelPx, '--min-travel'),
  presets: !switchOn('--no-presets')
};
if (!bandsPath || !out) {
  console.error('error: --bands <file> and --out <json> are both required.\n');
  console.error(USAGE);
  process.exit(2);
}
if (args.length > 0) {
  console.error(`error: unrecognised argument(s): ${args.join(' ')}\n`);
  console.error(USAGE);
  process.exit(2);
}
if (!Number.isInteger(options.maxKeys) || options.maxKeys < 2) {
  throw new Error(`--max-keys must be an integer >= 2, got "${options.maxKeys}".`);
}
if (options.tolerancePx <= 0) throw new Error(`--tolerance must be positive, got "${options.tolerancePx}".`);

const parsed = JSON.parse(await readFile(bandsPath, 'utf8'));
// Three accepted inputs, in the order a workflow produces them: the whole track-bands
// report, a hand-written {bands: [...]} subset of it, and a bare frame/value series for
// an ad-hoc "can one curve do this?" question.
let report;
if (Array.isArray(parsed)) {
  if (parsed.length === 0) throw new Error(`${bandsPath} is an empty array: there is nothing to fit.`);
  // A band list carries its own per-frame series; anything else is read as one bare
  // [{frame, value}] measurement, and fitSeries reports whatever it could not use.
  report = parsed.every(record => Array.isArray(record?.series))
    ? { bands: parsed }
    : { bands: [{ id: 'series', series: parsed }] };
} else if (Array.isArray(parsed?.bands)) {
  report = parsed;
} else if (Array.isArray(parsed?.series)) {
  report = { ...parsed, bands: [parsed] };
} else {
  throw new Error(`${bandsPath} holds neither a bands array nor a series array.`);
}
if (only.length) {
  const present = report.bands.map(band => band.id);
  for (const id of only) {
    if (!present.includes(id)) throw new Error(`--band "${id}" is not in ${bandsPath}; it holds ${present.join(', ')}.`);
  }
  report = { ...report, bands: report.bands.filter(band => only.includes(band.id)) };
}
if (report.bands.length === 0) throw new Error(`${bandsPath} holds no bands to fit.`);

const artifact = fitBands(report, options);

await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

if (writeStdout) {
  console.log(JSON.stringify(artifact, null, 2));
} else {
  console.log(JSON.stringify({
    out,
    schema: artifact.schema,
    anchorFrame: artifact.anchorFrame,
    parameters: artifact.parameters,
    summary: artifact.summary,
    unscoredBands: artifact.unscoredBands,
    fits: artifact.fits.map(fit => ({
      id: fit.id,
      status: fit.status,
      class: fit.class,
      representation: fit.representation ?? null,
      frames: `${fit.scoredFrames}/${fit.frames} scored`,
      keyCount: fit.keyCount,
      travelPx: fit.travelPx ?? null,
      maxErrorPx: fit.maxErrorPx ?? null,
      presetName: fit.curve?.presetName ?? null,
      handles: fit.curve?.handles ?? (fit.curve?.segments ?? []).map(segment => segment.handles).filter(Boolean),
      dropped: fit.droppedFrames.length,
      reason: fit.reason ?? null
    })),
    expressions: showExpressions
      ? artifact.fits
        .filter(fit => fit.curve?.expression)
        .map(fit => ({
          id: fit.id,
          text: fit.curve.expression.expression,
          maxVsMeasurementPx: fit.curve.expression.maxVsMeasurementPx,
          maxVsFittedCurve: fit.curve.expression.maxVsFittedCurve,
          endpointsExact: fit.curve.expression.endpointsExact
        }))
      : undefined
  }, null, 2));
}
