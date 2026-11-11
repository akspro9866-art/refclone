// Thin wrapper around the vendored chaojifeng-video-design product_ledger.py. `check`
// proves a product source ledger closes (facts/evidence/chapters/claims) and reports the
// upstream verdict verbatim; `init` surveys a source tree into a ledger skeleton. The
// wrapper never upgrades a blocked or failing check into a pass: ok/errors/warnings stay
// null when nothing was measured, and the report validates against product-ledger.schema.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkflowError, absolutePath, hashObject, fileRecord, writeJsonNew, validateArtifact,
} from '../core.mjs';
import { probePython, runPythonScript, withToolCache, missingFileHash } from './python-tool.mjs';

export const PRODUCT_LEDGER_VERSION = '1.0.0';
export const DEFAULT_PRODUCT_LEDGER = Object.freeze({ processTimeoutMs: 120000 });
const SCRIPT_PATH = absolutePath(fileURLToPath(new URL('../../vendor/wave2/chaojifeng-video-design/product_ledger.py', import.meta.url)));
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

function settingsFor(overrides = {}) {
  const settings = { ...DEFAULT_PRODUCT_LEDGER, ...overrides };
  for (const key of Object.keys(settings)) {
    if (!(key in DEFAULT_PRODUCT_LEDGER)) fail('CONFIG_INVALID', `Unknown product-ledger setting: ${key}`);
  }
  if (!Number.isSafeInteger(settings.processTimeoutMs) || settings.processTimeoutMs <= 0) fail('CONFIG_INVALID', 'processTimeoutMs must be a positive integer');
  return settings;
}

function checkOptionsFor(options) {
  const python = options.python ?? 'python';
  if (typeof python !== 'string' || !python.trim()) fail('CONFIG_INVALID', 'python must be a nonempty string');
  for (const key of ['sourceRoot', 'evidenceRoot']) {
    if (options[key] !== undefined && options[key] !== null && (typeof options[key] !== 'string' || !options[key].trim())) fail('CONFIG_INVALID', `${key} must be a nonempty string or null`);
  }
  const scripts = options.scripts ?? [];
  if (!Array.isArray(scripts) || scripts.some(s => typeof s !== 'string' || !s.trim())) fail('CONFIG_INVALID', 'scripts must be an array of nonempty strings');
  return { python, sourceRoot: options.sourceRoot ?? null, evidenceRoot: options.evidenceRoot ?? null, scripts: [...scripts] };
}

// Upstream `check --json` prints {ok, errors, warnings, issues:[{level,code,where,message}]}.
// Accept only that exact measured shape; anything else is not a verdict.
function parseCheckJson(text) {
  let payload;
  try { payload = JSON.parse(text); } catch { return null; }
  if (!payload || typeof payload.ok !== 'boolean' || !Number.isInteger(payload.errors) || payload.errors < 0 ||
      !Number.isInteger(payload.warnings) || payload.warnings < 0 || !Array.isArray(payload.issues)) return null;
  const issues = [];
  for (const issue of payload.issues) {
    if (!issue || !['error', 'warn'].includes(issue.level) || typeof issue.code !== 'string' || !issue.code ||
        typeof issue.where !== 'string' || typeof issue.message !== 'string') return null;
    issues.push({ level: issue.level, code: issue.code, where: issue.where, message: issue.message });
  }
  return { ok: payload.ok, errors: payload.errors, warnings: payload.warnings, issues };
}

/**
 * Check that a product source ledger closes.
 * @param {string} ledgerPath ledger JSON written by `init` and filled in by hand
 * @param {{python?:string, jobsDirectory?:string, sourceRoot?:string|null, evidenceRoot?:string|null, scripts?:string[], settings?:object}} [options]
 * @returns {Promise<object>} cache envelope with data = product-ledger report (complete or blocked)
 */
export async function checkProductLedger(ledgerPath, options = {}) {
  const settings = settingsFor(options.settings);
  const { python, sourceRoot, evidenceRoot, scripts } = checkOptionsFor(options);
  const resolvedLedger = absolutePath(ledgerPath);
  let script;
  try { script = await fileRecord(SCRIPT_PATH); }
  catch { fail('VENDOR_SCRIPT_MISSING', 'Vendored product_ledger.py is missing; cannot check ledgers.', { path: SCRIPT_PATH }); }
  let ledgerFile = null;
  let sourceHash;
  try {
    await fs.access(resolvedLedger, fs.constants.R_OK);
    ledgerFile = await fileRecord(resolvedLedger);
    sourceHash = ledgerFile.sha256;
  } catch { sourceHash = missingFileHash(resolvedLedger); }
  const key = hashObject({ version: PRODUCT_LEDGER_VERSION, sourceHash, ledgerPath: resolvedLedger, sourceRoot, evidenceRoot, scripts, settings, python, scriptSha256: script.sha256 });
  return withToolCache({ stage: 'product-ledger', version: PRODUCT_LEDGER_VERSION, sourceHash, key, jobsDirectory: options.jobsDirectory }, async ({ runDirectory }) => {
    const tool = { name: 'product_ledger.py', python: null, scriptPath: script.path, scriptSha256: script.sha256 };
    const base = {
      schemaVersion: 1, sourceHash, status: 'blocked', tool, ledger: null,
      ok: null, errors: null, warnings: null, issues: [], reason: null, notes: [],
    };
    if (!ledgerFile) base.notes.push('Ledger file is absent; sourceHash identifies the canonical path, not file bytes.');
    const blocked = async (reason, notes = []) => {
      const data = { ...base, reason, notes: [...base.notes, ...notes] };
      await validateArtifact('product-ledger', data);
      const record = await writeJsonNew(path.join(runDirectory, 'report.json'), data);
      return { data, outputs: [record], complete: false, schema: 'product-ledger', reportPath: record.path };
    };
    const complete = async (verdict, exitCode, notes = []) => {
      const data = { ...base, status: 'complete', ledger: ledgerFile, ...verdict, notes: [...base.notes, `check --json exit ${exitCode}`, ...notes] };
      await validateArtifact('product-ledger', data);
      const record = await writeJsonNew(path.join(runDirectory, 'report.json'), data);
      return { data, outputs: [record], complete: true, schema: 'product-ledger', reportPath: record.path };
    };
    if (!ledgerFile) return blocked('LEDGER_UNREADABLE', ['Ledger does not exist or is unreadable; nothing was checked.']);
    const probe = await probePython(python, { timeoutMs: settings.processTimeoutMs });
    if (!probe.available) return blocked(probe.reason ?? 'PYTHON_MISSING', ['Python is unavailable; product_ledger.py was not run.']);
    tool.python = python;
    base.notes.push(`python ${probe.version}`);
    const args = ['check', resolvedLedger, '--json'];
    if (sourceRoot) args.push('--source', absolutePath(sourceRoot));
    if (evidenceRoot) args.push('--evidence-root', absolutePath(evidenceRoot));
    for (const scriptPath of scripts) args.push('--script', absolutePath(scriptPath));
    const result = await runPythonScript(python, SCRIPT_PATH, args, { timeoutMs: settings.processTimeoutMs });
    if (result.ok) {
      const verdict = parseCheckJson(result.stdout);
      if (!verdict) return blocked('PROCESS_FAILED', ['check --json exited 0 but its JSON verdict is malformed.']);
      return complete(verdict, 0);
    }
    const error = result.error;
    if (error.code === 'TOOL_MISSING') return blocked('PYTHON_MISSING', ['Python disappeared before the check could run.']);
    if (error.code === 'PROCESS_FAILED' && error.details?.exitCode === 1) {
      // Exit 1 is the upstream "ledger does not close" verdict, delivered as JSON on stdout.
      const verdict = parseCheckJson(error.details.stdout ?? '');
      if (!verdict) return blocked('PROCESS_FAILED', ['check exited 1 but its JSON verdict could not be parsed (output may be truncated).']);
      return complete(verdict, 1);
    }
    if (error.code === 'PROCESS_FAILED' && error.details?.exitCode === 2) {
      return blocked('LEDGER_UNREADABLE', [`product_ledger.py could not read the ledger: ${(error.details.stderr ?? '').trim()}`]);
    }
    return blocked('PROCESS_FAILED', [`product_ledger.py failed (${error.code}): ${error.message}`]);
  });
}

/**
 * Survey a product source tree into a ledger skeleton (upstream `init`). The skeleton is a
 * starting point, not a closed ledger: run checkProductLedger after filling it in.
 * @param {string} sourceDirectory product source root (read-only survey)
 * @param {string} outputPath destination ledger JSON; never overwritten unless force
 * @param {{python?:string, force?:boolean, settings?:object}} [options]
 * @returns {Promise<{status:string, ledger:object|null, reason:string|null, notes:string[]}>}
 */
export async function initProductLedger(sourceDirectory, outputPath, options = {}) {
  const settings = settingsFor(options.settings);
  const python = options.python ?? 'python';
  if (typeof python !== 'string' || !python.trim()) fail('CONFIG_INVALID', 'python must be a nonempty string');
  if (typeof options.force !== 'boolean' && options.force !== undefined) fail('CONFIG_INVALID', 'force must be a boolean');
  const sourcePath = absolutePath(sourceDirectory);
  const destination = absolutePath(outputPath);
  let script;
  try { script = await fileRecord(SCRIPT_PATH); }
  catch { fail('VENDOR_SCRIPT_MISSING', 'Vendored product_ledger.py is missing; cannot init ledgers.', { path: SCRIPT_PATH }); }
  const notes = [];
  const blocked = (reason, extra = []) => ({ status: 'blocked', ledger: null, reason, notes: [...notes, ...extra] });
  let isDirectory = false;
  try { isDirectory = (await fs.stat(sourcePath)).isDirectory(); } catch { /* absent */ }
  if (!isDirectory) return blocked('INPUT_MISSING', ['Source root does not exist or is not a directory.']);
  if (!options.force) {
    try { await fs.access(destination); return blocked('OUTPUT_EXISTS', ['Destination ledger already exists; pass force to replace it.']); } catch { /* absent: good */ }
  }
  const probe = await probePython(python, { timeoutMs: settings.processTimeoutMs });
  if (!probe.available) return blocked(probe.reason ?? 'PYTHON_MISSING', ['Python is unavailable; product_ledger.py was not run.']);
  notes.push(`python ${probe.version}`);
  const args = ['init', sourcePath, '--out', destination];
  if (options.force) args.push('--force');
  const result = await runPythonScript(python, SCRIPT_PATH, args, { timeoutMs: settings.processTimeoutMs });
  if (!result.ok) {
    const reason = result.error.code === 'TOOL_MISSING' ? 'PYTHON_MISSING' : 'PROCESS_FAILED';
    return blocked(reason, [`product_ledger.py init failed (${result.error.code}): ${result.error.message}`]);
  }
  let ledger;
  try { ledger = await fileRecord(destination); }
  catch { return blocked('OUTPUT_INVALID', ['init exited 0 but wrote no readable ledger.']); }
  notes.push(...result.stdout.trim().split(/\r?\n/).filter(Boolean));
  return { status: 'complete', ledger, reason: null, notes };
}