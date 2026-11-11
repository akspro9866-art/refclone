// Vision-free static lint: the xiaoma-studio pre-vision gate (vendor/wave2/xiaoma-studio/
// lint.mjs: determinism under shuffled seeks, WCAG contrast of visible text, overlapping
// text blocks) plus fontcheck.py (missing font files, frozen weights, missing glyphs).
// Both upstream tools are spawned byte-for-byte; this module only maps their exit codes
// and console lines onto findings. A missing playwright-core or fontTools is reported as
// a blocked gate, never as a pass: an unrun check is not evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, absolutePath, hashObject, runProcess } from '../core.mjs';
import { probePython, runPythonScript } from '../ingest/python-tool.mjs';

export const STATIC_LINT_VERSION = '1.0.0';
export const DEFAULT_STATIC_LINT = Object.freeze({ samples: 24, processTimeoutMs: 300_000 });
const LINT_PATH = absolutePath(fileURLToPath(new URL('../../vendor/wave2/xiaoma-studio/lint.mjs', import.meta.url)));
const FONTCHECK_PATH = absolutePath(fileURLToPath(new URL('../../vendor/wave2/xiaoma-studio/fontcheck.py', import.meta.url)));
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

const LINT_GATES = [
  { key: 'determinism', label: '确定性', code: 'LINT_DETERMINISM_VIOLATION', severity: 'error' },
  { key: 'contrast', label: '对比度', code: 'LINT_LOW_CONTRAST', severity: 'error' },
  { key: 'overlap', label: '重叠', code: 'LINT_TEXT_OVERLAP', severity: 'error' }
];

/**
 * Parse lint.mjs console output. Upstream prints one `✓`/`✗` line per gate in a fixed
 * order (determinism, contrast, overlap) followed by a scope note; the ✗ line carries
 * the offending times/texts. This parses those lines and nothing else — a gate line it
 * cannot find stays unmeasured instead of assumed passing.
 * @param {string} stdout
 * @returns {{gates: object, findings: object[], unparsed: string[]}}
 */
export function parseStaticLintOutput(stdout) {
  const gates = {};
  const findings = [];
  const unparsed = [];
  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const gate = LINT_GATES.find(candidate => line.includes(candidate.label) && (line.startsWith('✓') || line.startsWith('✗')));
    if (!gate) {
      if (line.startsWith('说明：') || line.startsWith('[页面错误]')) continue;
      unparsed.push(line);
      continue;
    }
    const passed = line.startsWith('✓');
    gates[gate.key] = { status: passed ? 'pass' : 'fail', line };
    if (!passed) findings.push({ code: gate.code, severity: gate.severity, message: line.replace(/^✗\s*/, '') });
  }
  return { gates, findings, unparsed };
}

const FONT_PROBLEM_CODES = [
  { prefix: '缺文件', code: 'FONT_FILE_MISSING' },
  { prefix: '字重被冻结', code: 'FONT_WEIGHT_FROZEN' },
  { prefix: '缺字', code: 'FONT_GLYPH_MISSING' }
];

/** Parse fontcheck.py stdout: one `  - problem` line per problem, plus its summary line. */
export function parseFontcheckOutput(stdout) {
  const findings = [];
  const lines = String(stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith('- ')) continue;
    const detail = line.slice(2);
    const known = FONT_PROBLEM_CODES.find(candidate => detail.startsWith(candidate.prefix));
    findings.push({ code: known?.code ?? 'FONT_CHECK_PROBLEM', severity: 'error', message: detail });
  }
  return { findings, summary: lines.filter(line => !line.startsWith('- ')).at(-1) ?? null };
}

function dependencyMissing(text) {
  return /Cannot find (package|module) '?(playwright-core|playwright)/.test(text) ||
    /ERR_MODULE_NOT_FOUND/.test(text) || /找不到 Chromium\/Chrome/.test(text);
}

/**
 * Run the static lint gates before any vision tokens are spent.
 * @param {string} htmlPath composition HTML with the `window.__ms` seek contract
 * @param {{python?:string, cssPath?:string, chars?:string, samples?:number,
 *          processTimeoutMs?:number, node?:string}} [options]
 * @returns {Promise<object>} findings report (status: pass | fail | partial | blocked)
 */
export async function runStaticLint(htmlPath, options = {}) {
  const samples = options.samples ?? DEFAULT_STATIC_LINT.samples;
  const timeoutMs = options.processTimeoutMs ?? DEFAULT_STATIC_LINT.processTimeoutMs;
  if (!Number.isInteger(samples) || samples < 1 || samples > 240) fail('CONFIG_INVALID', 'samples must be an integer in [1,240].');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail('CONFIG_INVALID', 'processTimeoutMs must be a positive integer.');
  const python = options.python ?? 'python';
  const node = options.node ?? process.execPath;
  const source = absolutePath(htmlPath);
  let html;
  try { html = await fs.readFile(source); }
  catch (error) { fail('INPUT_MISSING', 'Static lint needs a readable composition HTML.', { path: source, reason: error.code }); }
  const sourceHash = hashObject({ version: STATIC_LINT_VERSION, html: html.toString('base64'), samples });
  const findings = [];
  const notes = [];
  const lint = { status: 'blocked', reason: null, gates: {}, unparsed: [] };
  const fonts = { status: 'skipped', reason: null, summary: null };
  try {
    const result = await runProcess(node, [LINT_PATH, source, '--samples', String(samples)], { timeoutMs });
    const parsed = parseStaticLintOutput(result.stdout);
    lint.gates = parsed.gates;
    lint.unparsed = parsed.unparsed;
    findings.push(...parsed.findings);
    const unmeasured = LINT_GATES.filter(gate => !parsed.gates[gate.key]).map(gate => gate.label);
    lint.status = unmeasured.length ? 'fail' : parsed.findings.length ? 'fail' : 'pass';
    if (unmeasured.length) {
      findings.push({ code: 'LINT_GATE_UNMEASURED', severity: 'error', message: `lint.mjs printed no result for: ${unmeasured.join(', ')}.` });
    }
  } catch (error) {
    const stderr = error.details?.stderr ?? '';
    const stdout = error.details?.stdout ?? '';
    if (error.code === 'TOOL_MISSING') {
      lint.reason = 'NODE_MISSING';
    } else if (dependencyMissing(`${stderr}\n${stdout}`)) {
      lint.reason = 'DEPENDENCY_MISSING';
      notes.push('lint.mjs needs playwright-core and a Chromium/Chrome build; neither is vendored.');
    } else if (error.details?.exitCode === 2) {
      // Exit 2 is upstream's "lint found problems" verdict, already printed to stdout.
      const parsed = parseStaticLintOutput(stdout);
      lint.gates = parsed.gates;
      lint.unparsed = parsed.unparsed;
      lint.status = 'fail';
      findings.push(...parsed.findings);
      if (!parsed.findings.length) findings.push({ code: 'LINT_FAILED', severity: 'error', message: 'lint.mjs exited 2 without a parsable finding.' });
    } else {
      lint.reason = 'PROCESS_FAILED';
      notes.push(`lint.mjs failed (${error.code}): ${error.message}`);
    }
  }

  if (options.cssPath) {
    const cssPath = absolutePath(options.cssPath);
    const probe = await probePython(python, { imports: ['fontTools'], timeoutMs });
    if (!probe.available) {
      fonts.reason = probe.reason ?? 'PYTHON_MISSING';
      notes.push('Python is unavailable; fontcheck.py was not run.');
    } else {
      if (probe.missingImports.includes('fontTools')) {
        notes.push('fontTools is not installed; fontcheck.py only verifies that font files exist.');
      }
      const args = [cssPath];
      if (options.chars) args.push('--chars', options.chars);
      const result = await runPythonScript(python, FONTCHECK_PATH, args, { timeoutMs });
      if (result.ok) {
        const parsed = parseFontcheckOutput(result.stdout);
        fonts.status = 'pass';
        fonts.summary = parsed.summary;
      } else if (result.error.details?.exitCode === 2) {
        const parsed = parseFontcheckOutput(result.error.details?.stdout ?? '');
        fonts.status = 'fail';
        fonts.summary = parsed.summary;
        findings.push(...parsed.findings);
        if (!parsed.findings.length) findings.push({ code: 'FONT_CHECK_FAILED', severity: 'error', message: 'fontcheck.py exited 2 without a parsable problem.' });
      } else if (result.error.code === 'TOOL_MISSING') {
        fonts.reason = 'PYTHON_MISSING';
      } else {
        fonts.reason = 'PROCESS_FAILED';
        notes.push(`fontcheck.py failed (${result.error.code}): ${result.error.message}`);
      }
    }
  } else {
    notes.push('No fonts.css supplied; the font gate did not run.');
  }

  const ranLint = lint.status === 'pass' || lint.status === 'fail';
  const ranFonts = fonts.status === 'pass' || fonts.status === 'fail';
  const status = !ranLint && !ranFonts ? 'blocked'
    : findings.length ? 'fail'
      : (ranLint && (ranFonts || !options.cssPath)) ? 'pass' : 'partial';
  return {
    version: STATIC_LINT_VERSION,
    status,
    sourceHash,
    source: { path: source, bytes: html.length },
    lint,
    fonts,
    findings,
    notes
  };
}
