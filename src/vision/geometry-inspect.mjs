// Screen-space geometry inspection: wrap motion-craft's
// `inspect-motion.mjs --geometry <file>` (vendored byte-for-byte at
// vendor/wave2/motion-craft/inspect-motion.mjs, with its qa-geometry.mjs sibling).
// The vendor CLI scans the supplied source root for emoji / Remotion determinism
// violations and then checks measured screen-space rectangles: required objects must
// stay inside the viewport and off the subtitle band. Rectangles must be measured after
// camera transforms; this module never infers a box from source code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, absolutePath, hashFile, hashObject, runProcess } from '../core.mjs';

export const GEOMETRY_INSPECT_VERSION = '1.0.0';
export const DEFAULT_GEOMETRY_TIMEOUT_MS = 120_000;
const SCRIPT_PATH = absolutePath(fileURLToPath(new URL('../../vendor/wave2/motion-craft/inspect-motion.mjs', import.meta.url)));
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

/**
 * Map the vendor CLI verdict (status + issue/pass strings + exit code) onto findings.
 * Every issue the vendor prints is an error: they are measured violations, not style
 * opinions. Skipped checks stay skipped.
 */
export function summarizeInspectMotion(verdict) {
  const findings = (verdict?.issues ?? []).map(message => {
    const code = /DETERMINISM VIOLATION/.test(message) ? 'DETERMINISM_VIOLATION'
      : /EMOJI VIOLATION/.test(message) ? 'EMOJI_VIOLATION'
        : /outside viewport/.test(message) ? 'GEOMETRY_OUTSIDE_VIEWPORT'
          : /overlaps subtitle/.test(message) ? 'GEOMETRY_SUBTITLE_OVERLAP'
            : /subtitle outside viewport/.test(message) ? 'GEOMETRY_SUBTITLE_OUTSIDE'
              : 'GEOMETRY_ISSUE';
    return { code, severity: 'error', message };
  });
  return {
    findings,
    passes: verdict?.passes ?? [],
    skipped: verdict?.skipped ?? [],
    warnings: verdict?.warnings ?? [],
    scannedFiles: verdict?.scannedFiles ?? null,
    measuredObjects: verdict?.measuredObjects ?? null
  };
}

/**
 * Inspect one measured geometry file through the vendor CLI.
 * @param {string} geometryPath JSON `{width, height, samples:[{frame, subtitleRect?, objects:[{id,x,y,width,height}]}]}`
 * @param {{sourceDirectory?:string, timeoutMs?:number, node?:string}} [options]
 *   sourceDirectory is the compiled scene source root the determinism scan reads; it
 *   defaults to the geometry file's directory and the report says so.
 * @returns {Promise<object>} `{version, status:'pass'|'fail'|'blocked', ...}` report
 */
export async function inspectGeometryFile(geometryPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GEOMETRY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail('CONFIG_INVALID', 'timeoutMs must be a positive integer.');
  const geometry = absolutePath(geometryPath);
  let data;
  try { data = JSON.parse(await fs.readFile(geometry, 'utf8')); }
  catch (error) {
    fail('GEOMETRY_INVALID', 'Geometry input must be a readable JSON file.', { path: geometry, reason: error.code ?? 'JSON_INVALID' });
  }
  if (!data || !Array.isArray(data.samples) || !data.samples.length) {
    fail('GEOMETRY_INVALID', 'Geometry input needs a non-empty samples array of measured rectangles.', { path: geometry });
  }
  const sourceDirectory = absolutePath(options.sourceDirectory ?? path.dirname(geometry));
  let scriptPresent = true;
  try { await fs.access(SCRIPT_PATH); } catch { scriptPresent = false; }
  const base = {
    version: GEOMETRY_INSPECT_VERSION,
    geometryHash: await hashFile(geometry),
    geometryPath: geometry,
    sourceDirectory,
    notes: []
  };
  if (!scriptPresent) {
    return { ...base, status: 'blocked', reason: 'VENDOR_SCRIPT_MISSING', findings: [], passes: [], skipped: [], warnings: [], scannedFiles: null, measuredObjects: null };
  }
  if (!options.sourceDirectory) base.notes.push('No source directory supplied; the determinism scan read the geometry file itself.');
  const node = options.node ?? process.execPath;
  const run = async () => runProcess(node, [SCRIPT_PATH, '--src', sourceDirectory, '--geometry', geometry], { timeoutMs });
  let stdout;
  let exitCode = 0;
  try {
    const result = await run();
    stdout = result.stdout;
  } catch (error) {
    stdout = error.details?.stdout ?? '';
    exitCode = error.details?.exitCode ?? null;
    if (error.code === 'TOOL_MISSING') {
      return { ...base, status: 'blocked', reason: 'NODE_MISSING', findings: [], passes: [], skipped: [], warnings: [], scannedFiles: null, measuredObjects: null };
    }
    if (exitCode === null) {
      base.notes.push(`inspect-motion.mjs failed (${error.code}): ${error.message}`);
      return { ...base, status: 'blocked', reason: 'PROCESS_FAILED', findings: [], passes: [], skipped: [], warnings: [], scannedFiles: null, measuredObjects: null };
    }
  }
  let verdict;
  try { verdict = JSON.parse(stdout); }
  catch {
    base.notes.push('inspect-motion.mjs printed no parsable JSON verdict (output may be truncated).');
    return { ...base, status: 'blocked', reason: 'OUTPUT_INVALID', findings: [], passes: [], skipped: [], warnings: [], scannedFiles: null, measuredObjects: null };
  }
  const summary = summarizeInspectMotion(verdict);
  const status = summary.findings.length ? 'fail' : 'pass';
  if (verdict.status === 'PARTIAL') base.notes.push('The vendor verdict is PARTIAL: still rendering and media QA were not requested (geometry and source scan only).');
  return {
    ...base,
    status,
    reason: null,
    exitCode,
    vendorStatus: verdict.status ?? null,
    scope: verdict.scope ?? null,
    ...summary,
    findings: summary.findings,
    key: hashObject({ version: GEOMETRY_INSPECT_VERSION, geometry: base.geometryHash, sourceDirectory, timeoutMs })
  };
}
