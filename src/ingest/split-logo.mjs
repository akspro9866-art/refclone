// Thin wrapper around the vendored xiaoma-studio split-logo.py: crop one logo out of a
// whole-page SVG (pdftocairo output) by a measured rectangle. Pure stdlib python. The
// wrapper never invents geometry: the rectangle must be supplied from measurement, and a
// missing python/input/script yields a blocked report instead of a fabricated logo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkflowError, absolutePath, hashObject, fileRecord, writeJsonNew, validateArtifact,
} from '../core.mjs';
import { probePython, runPythonScript, withToolCache, missingFileHash } from './python-tool.mjs';

export const SPLIT_LOGO_VERSION = '1.0.0';
export const DEFAULT_SPLIT_LOGO = Object.freeze({ keepBg: false, twoStop: false, processTimeoutMs: 120000 });
const SCRIPT_PATH = absolutePath(fileURLToPath(new URL('../../vendor/wave2/xiaoma-studio/split-logo.py', import.meta.url)));
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

function settingsFor(overrides = {}) {
  const settings = { ...DEFAULT_SPLIT_LOGO, ...overrides };
  for (const key of Object.keys(settings)) {
    if (!(key in DEFAULT_SPLIT_LOGO)) fail('CONFIG_INVALID', `Unknown split-logo setting: ${key}`);
  }
  for (const key of ['keepBg', 'twoStop']) {
    if (typeof settings[key] !== 'boolean') fail('CONFIG_INVALID', `${key} must be a boolean`);
  }
  if (!Number.isSafeInteger(settings.processTimeoutMs) || settings.processTimeoutMs <= 0) fail('CONFIG_INVALID', 'processTimeoutMs must be a positive integer');
  return settings;
}

function rectFor(rect) {
  if (!rect || typeof rect !== 'object') fail('RECT_INVALID', 'splitLogo requires a measured rect {x,y,width,height}.');
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite)) fail('RECT_INVALID', 'rect values must be finite numbers.');
  if (width <= 0 || height <= 0) fail('RECT_INVALID', 'rect width and height must be positive.');
  return { x, y, width, height };
}

/**
 * Split one logo out of a page SVG.
 * @param {string} pageSvg input whole-page SVG (pdftocairo -svg output)
 * @param {string} outputSvg destination for the cropped logo; never overwritten
 * @param {{x:number,y:number,width:number,height:number}} rect measured crop rectangle in pt
 * @param {{python?:string, jobsDirectory?:string, settings?:object}} [options]
 * @returns {Promise<object>} cache envelope with data = split-logo-report (complete or blocked)
 */
export async function splitLogo(pageSvg, outputSvg, rect, options = {}) {
  const settings = settingsFor(options.settings);
  const box = rectFor(rect);
  const python = options.python ?? 'python';
  if (typeof python !== 'string' || !python.trim()) fail('CONFIG_INVALID', 'python must be a nonempty string');
  const sourcePath = absolutePath(pageSvg);
  const outputPath = absolutePath(outputSvg);
  let script;
  try { script = await fileRecord(SCRIPT_PATH); }
  catch { fail('VENDOR_SCRIPT_MISSING', 'Vendored split-logo.py is missing; cannot split logos.', { path: SCRIPT_PATH }); }
  let source = null;
  let sourceHash;
  try {
    await fs.access(sourcePath, fs.constants.R_OK);
    source = await fileRecord(sourcePath);
    sourceHash = source.sha256;
  } catch { sourceHash = missingFileHash(sourcePath); }
  const key = hashObject({ version: SPLIT_LOGO_VERSION, sourceHash, sourcePath, outputPath, rect: box, settings, python, scriptSha256: script.sha256 });
  return withToolCache({ stage: 'split-logo', version: SPLIT_LOGO_VERSION, sourceHash, key, jobsDirectory: options.jobsDirectory }, async ({ runDirectory }) => {
    const tool = { name: 'split-logo.py', python: null, scriptPath: script.path, scriptSha256: script.sha256 };
    const base = {
      schemaVersion: 1, sourceHash, status: 'blocked', tool, source, rect: box,
      options: { keepBg: settings.keepBg, twoStop: settings.twoStop }, output: null, reason: null, notes: [],
    };
    if (!source) base.notes.push('Input SVG is absent; sourceHash identifies the canonical path, not file bytes.');
    const blocked = async (reason, notes = []) => {
      const data = { ...base, reason, notes: [...base.notes, ...notes] };
      await validateArtifact('split-logo-report', data);
      const record = await writeJsonNew(path.join(runDirectory, 'report.json'), data);
      return { data, outputs: [record], complete: false, schema: 'split-logo-report', reportPath: record.path };
    };
    if (!source) return blocked('INPUT_MISSING', ['Input SVG does not exist or is unreadable; nothing was split.']);
    const probe = await probePython(python, { timeoutMs: settings.processTimeoutMs });
    if (!probe.available) return blocked(probe.reason ?? 'PYTHON_MISSING', ['Python is unavailable; split-logo.py was not run.']);
    tool.python = python;
    base.notes.push(`python ${probe.version}`);
    try { await fs.access(outputPath); return blocked('OUTPUT_EXISTS', ['Destination already exists; finals are never overwritten.']); } catch { /* absent: good */ }
    const scriptOutput = path.join(runDirectory, 'logo.svg');
    const args = [sourcePath, scriptOutput, String(box.x), String(box.y), String(box.width), String(box.height)];
    if (settings.keepBg) args.push('--keep-bg');
    if (settings.twoStop) args.push('--two-stop');
    const result = await runPythonScript(python, SCRIPT_PATH, args, { timeoutMs: settings.processTimeoutMs });
    if (!result.ok) {
      const reason = result.error.code === 'TOOL_MISSING' ? 'PYTHON_MISSING' : 'PROCESS_FAILED';
      return blocked(reason, [`split-logo.py failed (${result.error.code}): ${result.error.message}`]);
    }
    let published;
    try {
      await fs.copyFile(scriptOutput, outputPath, fs.constants.COPYFILE_EXCL);
      published = await fileRecord(outputPath);
    } catch (error) {
      if (error.code === 'EEXIST') return blocked('OUTPUT_EXISTS', ['Destination appeared during the run; finals are never overwritten.']);
      return blocked('OUTPUT_INVALID', ['split-logo.py exited 0 but produced no readable output SVG.']);
    }
    const text = await fs.readFile(outputPath, 'utf8');
    const viewBox = /viewBox="([^"]+)"/.exec(text);
    const data = {
      ...base, status: 'complete', output: published,
      notes: [...base.notes, `split-logo.py: ${result.stdout.trim()}`, viewBox ? `output viewBox: ${viewBox[1]}` : 'output viewBox: not found'],
    };
    await validateArtifact('split-logo-report', data);
    const record = await writeJsonNew(path.join(runDirectory, 'report.json'), data);
    return { data, outputs: [record, published], complete: true, schema: 'split-logo-report', reportPath: record.path };
  });
}