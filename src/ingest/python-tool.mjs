// Shared scaffolding for the thin Wave-2 python ingest wrappers (split-logo, photo-trace,
// product-ledger). The wrappers stay thin: this module owns the python availability probe,
// the hash-keyed job cache and the graceful blocked-status contract. A blocked result is
// never cached as a final: the environment (python, dependencies, input files) can change,
// so only complete runs publish an index. Unresolved values stay null, never invented.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  WorkflowError, absolutePath, hashObject, readJson, validateArtifact,
  writeJsonState, verifyFiles, withJobLock, runProcess,
} from '../core.mjs';

const PROBE_CODE = [
  'import sys, json, importlib',
  'missing = []',
  'for name in sys.argv[1:]:',
  '    try:',
  '        importlib.import_module(name)',
  '    except Exception:',
  '        missing.append(name)',
  'print(json.dumps({"version": sys.version.split()[0], "missing": missing}))',
].join('\n');

/**
 * Probe a python executable and, optionally, the importability of dependency modules.
 * Never throws for a missing tool: availability is evidence, not an assumption.
 * @returns {Promise<{available: boolean, version: string|null, missingImports: string[], reason: string|null}>}
 */
export async function probePython(python, { imports = [], timeoutMs = 30000 } = {}) {
  try {
    const { stdout } = await runProcess(python, ['-c', PROBE_CODE, ...imports], { timeoutMs });
    const probe = JSON.parse(stdout.trim());
    if (typeof probe.version !== 'string' || !Array.isArray(probe.missing)) {
      return { available: false, version: null, missingImports: [], reason: 'PYTHON_PROBE_INVALID' };
    }
    return {
      available: true,
      version: probe.version,
      missingImports: probe.missing.filter(name => typeof name === 'string'),
      reason: null,
    };
  } catch (error) {
    const reason = error instanceof WorkflowError && error.code === 'TOOL_MISSING' ? 'PYTHON_MISSING' : 'PYTHON_PROBE_FAILED';
    return { available: false, version: null, missingImports: [], reason };
  }
}

/**
 * Run a vendored python script, returning the WorkflowError instead of throwing so the
 * caller can map exit codes onto its own blocked/complete contract.
 * @returns {Promise<{ok: true, stdout: string, stderr: string, exitCode: number} | {ok: false, error: WorkflowError}>}
 */
export async function runPythonScript(python, scriptPath, args, { timeoutMs = 120000, cwd, maxOutputBytes } = {}) {
  try {
    const result = await runProcess(python, [scriptPath, ...args], { timeoutMs, cwd, maxOutputBytes });
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error };
    throw error;
  }
}

/**
 * Hash-keyed cache + job lock shared by the python wrappers.
 * `run` receives the fresh run directory and returns { data, outputs, complete, schema }.
 * Only complete runs publish index.json; cached reuse re-verifies every recorded file and
 * re-validates the report against its schema when one is named.
 */
export async function withToolCache({ stage, version, sourceHash, key, jobsDirectory }, run) {
  const jobDirectory = absolutePath(path.join(jobsDirectory ?? path.join(process.cwd(), 'jobs'), sourceHash.slice(0, 16)));
  await fs.mkdir(jobDirectory, { recursive: true });
  return withJobLock(jobDirectory, async () => {
    const cacheDirectory = path.join(jobDirectory, stage, key);
    await fs.mkdir(cacheDirectory, { recursive: true });
    const indexPath = path.join(cacheDirectory, 'index.json');
    try {
      const index = await readJson(indexPath);
      if (index.key === key && index.version === version && typeof index.reportPath === 'string' &&
          Array.isArray(index.outputs) && await verifyFiles(index.outputs)) {
        const data = await readJson(index.reportPath);
        if (index.schema) await validateArtifact(index.schema, data);
        if (data.status === 'complete') return { ...index, complete: true, cached: true, data };
      }
    } catch { /* a damaged or absent cache is a miss, never a failure */ }
    const runDirectory = absolutePath(path.join(cacheDirectory, randomUUID()));
    await fs.mkdir(runDirectory);
    const result = await run({ runDirectory, jobDirectory, cacheDirectory });
    const base = { version, key, sourceHash, jobDirectory, runDirectory, schema: result.schema ?? null };
    if (!result.complete) return { ...base, complete: false, reportPath: null, outputs: result.outputs ?? [], cached: false, data: result.data };
    const index = { ...base, reportPath: absolutePath(result.reportPath), outputs: result.outputs, indexPath: absolutePath(indexPath) };
    await writeJsonState(indexPath, index);
    return { ...index, complete: true, cached: false, data: result.data };
  });
}

/** Stable job identity for an input file that does not exist (no bytes to hash). */
export function missingFileHash(filePath) {
  return hashObject({ missingFile: absolutePath(filePath) });
}