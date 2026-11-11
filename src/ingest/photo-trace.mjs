// Thin wrapper around the vendored framewright trace.py: posterize a photo into closed
// polygons (brightness levels -> coordinate loops, no pixels in the output). Needs python
// with numpy/scipy/Pillow; when any of those is absent the wrapper returns a blocked
// report naming the missing pieces instead of inventing a trace.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkflowError, absolutePath, hashObject, fileRecord, writeJsonNew, validateArtifact,
} from '../core.mjs';
import { probePython, runPythonScript, withToolCache, missingFileHash } from './python-tool.mjs';

export const PHOTO_TRACE_VERSION = '1.0.0';
export const DEFAULT_PHOTO_TRACE = Object.freeze({
  height: 800, blur: 1.4, levels: Object.freeze([0.16, 0.30, 0.46, 0.62, 0.80]),
  tol: 0.9, minarea: 24, bgthr: 0.86, crop: null,
  removeBackground: true, autocontrast: true, preview: false,
  processTimeoutMs: 120000,
});
const SCRIPT_PATH = absolutePath(fileURLToPath(new URL('../../vendor/wave2/framewright/trace.py', import.meta.url)));
const REQUIRED_IMPORTS = ['numpy', 'scipy', 'PIL'];
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

function settingsFor(overrides = {}) {
  const settings = { ...DEFAULT_PHOTO_TRACE, ...overrides };
  for (const key of Object.keys(settings)) {
    if (!(key in DEFAULT_PHOTO_TRACE)) fail('CONFIG_INVALID', `Unknown photo-trace setting: ${key}`);
  }
  if (!Number.isSafeInteger(settings.height) || settings.height < 1 || settings.height > 4096) fail('CONFIG_INVALID', 'height must be an integer in [1,4096]');
  if (!Number.isFinite(settings.blur) || settings.blur < 0 || settings.blur > 20) fail('CONFIG_INVALID', 'blur must be in [0,20]');
  if (!Array.isArray(settings.levels) || !settings.levels.length || settings.levels.some(v => !Number.isFinite(v) || v <= 0 || v >= 1)) fail('CONFIG_INVALID', 'levels must be a nonempty array of numbers in (0,1)');
  if (!Number.isFinite(settings.tol) || settings.tol <= 0) fail('CONFIG_INVALID', 'tol must be positive');
  if (!Number.isFinite(settings.minarea) || settings.minarea < 0) fail('CONFIG_INVALID', 'minarea must be nonnegative');
  if (!Number.isFinite(settings.bgthr) || settings.bgthr < 0 || settings.bgthr > 1) fail('CONFIG_INVALID', 'bgthr must be in [0,1]');
  if (settings.crop !== null) {
    const crop = settings.crop;
    if (!Array.isArray(crop) || crop.length !== 4 || crop.some(v => !Number.isSafeInteger(v) || v < 0) || crop[0] >= crop[2] || crop[1] >= crop[3]) fail('CONFIG_INVALID', 'crop must be null or [x0,y0,x1,y1] integers with x0<x1 and y0<y1');
  }
  for (const key of ['removeBackground', 'autocontrast', 'preview']) {
    if (typeof settings[key] !== 'boolean') fail('CONFIG_INVALID', `${key} must be a boolean`);
  }
  if (!Number.isSafeInteger(settings.processTimeoutMs) || settings.processTimeoutMs <= 0) fail('CONFIG_INVALID', 'processTimeoutMs must be a positive integer');
  return { ...settings, levels: [...settings.levels], crop: settings.crop === null ? null : [...settings.crop] };
}

// The upstream output is a JS snippet `const PORTRAIT={...};` — parse the JSON payload and
// summarize it. Anything that does not match the measured shape is rejected, not repaired.
export function parsePortrait(text) {
  const prefix = 'const PORTRAIT=';
  if (typeof text !== 'string' || !text.startsWith(prefix) || !text.trimEnd().endsWith(';')) return null;
  let payload;
  try { payload = JSON.parse(text.trimEnd().slice(prefix.length, -1)); } catch { return null; }
  if (!payload || !Number.isSafeInteger(payload.w) || payload.w < 1 || !Number.isSafeInteger(payload.h) || payload.h < 1 || !Array.isArray(payload.levels)) return null;
  const levels = [];
  let totalPoints = 0;
  for (const level of payload.levels) {
    if (!level || !Number.isFinite(level.t) || !Array.isArray(level.p)) return null;
    let points = 0;
    for (const polygon of level.p) {
      if (!Array.isArray(polygon) || polygon.length < 6 || polygon.length % 2 !== 0 || polygon.some(v => !Number.isFinite(v))) return null;
      points += polygon.length / 2;
    }
    levels.push({ t: level.t, polygons: level.p.length, points });
    totalPoints += points;
  }
  return { width: payload.w, height: payload.h, totalPoints, levels };
}

/**
 * Trace a photo into posterized closed polygons.
 * @param {string} photo input raster image (anything Pillow can open)
 * @param {{python?:string, jobsDirectory?:string, settings?:object}} [options]
 * @returns {Promise<object>} cache envelope with data = photo-trace-report (complete or blocked)
 */
export async function photoTrace(photo, options = {}) {
  const settings = settingsFor(options.settings);
  const python = options.python ?? 'python';
  if (typeof python !== 'string' || !python.trim()) fail('CONFIG_INVALID', 'python must be a nonempty string');
  const sourcePath = absolutePath(photo);
  let script;
  try { script = await fileRecord(SCRIPT_PATH); }
  catch { fail('VENDOR_SCRIPT_MISSING', 'Vendored trace.py is missing; cannot trace photos.', { path: SCRIPT_PATH }); }
  let source = null;
  let sourceHash;
  try {
    await fs.access(sourcePath, fs.constants.R_OK);
    source = await fileRecord(sourcePath);
    sourceHash = source.sha256;
  } catch { sourceHash = missingFileHash(sourcePath); }
  const key = hashObject({ version: PHOTO_TRACE_VERSION, sourceHash, sourcePath, settings, python, scriptSha256: script.sha256 });
  return withToolCache({ stage: 'photo-trace', version: PHOTO_TRACE_VERSION, sourceHash, key, jobsDirectory: options.jobsDirectory }, async ({ runDirectory }) => {
    const tool = { name: 'trace.py', python: null, scriptPath: script.path, scriptSha256: script.sha256 };
    const { processTimeoutMs, ...reportedSettings } = settings;
    const base = { schemaVersion: 1, sourceHash, status: 'blocked', tool, source, settings: reportedSettings, trace: null, preview: null, reason: null, notes: [] };
    if (!source) base.notes.push('Input photo is absent; sourceHash identifies the canonical path, not file bytes.');
    const blocked = async (reason, notes = []) => {
      const data = { ...base, reason, notes: [...base.notes, ...notes] };
      await validateArtifact('photo-trace-report', data);
      const record = await writeJsonNew(path.join(runDirectory, 'report.json'), data);
      return { data, outputs: [record], complete: false, schema: 'photo-trace-report', reportPath: record.path };
    };
    if (!source) return blocked('INPUT_MISSING', ['Input photo does not exist or is unreadable; nothing was traced.']);
    const probe = await probePython(python, { imports: REQUIRED_IMPORTS, timeoutMs: settings.processTimeoutMs });
    if (!probe.available) return blocked(probe.reason ?? 'PYTHON_MISSING', ['Python is unavailable; trace.py was not run.']);
    if (probe.missingImports.length) return blocked('DEPENDENCY_MISSING', [`trace.py needs numpy, scipy and Pillow; missing imports: ${probe.missingImports.join(', ')}.`]);
    tool.python = python;
    base.notes.push(`python ${probe.version}`);
    const tracePath = path.join(runDirectory, 'portrait.js');
    const args = [sourcePath, '--out', tracePath, '--height', String(settings.height), '--blur', String(settings.blur),
      '--levels', settings.levels.join(','), '--tol', String(settings.tol), '--minarea', String(settings.minarea), '--bgthr', String(settings.bgthr)];
    if (settings.crop) args.push('--crop', settings.crop.join(','));
    if (!settings.removeBackground) args.push('--nobg');
    if (!settings.autocontrast) args.push('--nocontrast');
    const previewPath = settings.preview ? path.join(runDirectory, 'preview.png') : null;
    if (previewPath) args.push('--preview', previewPath);
    const result = await runPythonScript(python, SCRIPT_PATH, args, { timeoutMs: settings.processTimeoutMs });
    if (!result.ok) {
      const reason = result.error.code === 'TOOL_MISSING' ? 'PYTHON_MISSING' : 'PROCESS_FAILED';
      return blocked(reason, [`trace.py failed (${result.error.code}): ${result.error.message}`]);
    }
    await fs.writeFile(path.join(runDirectory, 'trace-stderr.txt'), result.stderr, { flag: 'wx' });
    let parsed;
    try { parsed = parsePortrait(await fs.readFile(tracePath, 'utf8')); } catch { parsed = null; }
    if (!parsed) return blocked('OUTPUT_INVALID', ['trace.py exited 0 but the PORTRAIT payload is missing or malformed.']);
    const trace = { ...await fileRecord(tracePath), ...parsed };
    const preview = previewPath ? await fileRecord(previewPath).catch(() => null) : null;
    const data = {
      ...base, status: 'complete', trace, preview,
      notes: [...base.notes, `trace.py: ${result.stderr.trim().split(/\r?\n/).at(-1)}`,
        `${parsed.width}x${parsed.height}, ${parsed.totalPoints} points across ${parsed.levels.length} levels`],
    };
    await validateArtifact('photo-trace-report', data);
    const record = await writeJsonNew(path.join(runDirectory, 'report.json'), data);
    const outputs = [record, { path: trace.path, sha256: trace.sha256 }];
    if (preview) outputs.push(preview);
    return { data, outputs, complete: true, schema: 'photo-trace-report', reportPath: record.path };
  });
}