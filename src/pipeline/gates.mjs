// Vision-free pre-render gates: everything that can be measured from the plan and
// from recorded verdicts before any reference/render frame is decoded.
//
// Gate order is deliberate: plan lint (pure computation) -> HTML static lint ->
// measured screen-space geometry -> loop seam -> edit-list slates. Each gate is
// optional and reports `blocked` when it could not run; only a measured pass is a
// pass. The 20-point contact-sheet checklist and the 8-point reviewer stay a
// human/agent review and are recorded as such.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, absolutePath, readJson, writeJsonState } from '../core.mjs';
import { resolveEditListFile } from '../design/edit-list.mjs';
import { inspectGeometryFile } from '../vision/geometry-inspect.mjs';
import { formatStaticMotionLint, runStaticMotionLint, staticMotionGateFindings } from '../vision/lint.mjs';
import { runStaticLint } from '../vision/static-lint.mjs';

export const CHECKLIST = Object.freeze({
  path: fileURLToPath(new URL('../../vendor/wave2/OpenVideoHarness/CHECKLIST.md', import.meta.url)),
  points: 20,
  reviewerDimensions: 8,
  authoritative: 'vendor/wave2/OpenVideoHarness/TASTE_CHECKLIST.md (machine-readable copy: taste-checklist.json)'
});

export const GATE_STATUS = Object.freeze({
  pass: 'pass', fail: 'fail', partial: 'blocked', blocked: 'blocked', skipped: 'skipped', not_run: 'not_run'
});
export const LOOPCHECK_STATUSES = new Set(['pass', 'fail']);

/** `inspect-motion.mjs --geometry` behind the refclone wrapper (motion-craft). */
export function inspectMotionGeometry(geometryPath, options = {}) {
  return inspectGeometryFile(geometryPath, options);
}

function lintGateStatus(lint) {
  return lint.status === 'pass' ? 'pass' : lint.status === 'fail' ? 'fail' : 'blocked';
}

/**
 * Run the vision-free gates for one QA pass.
 *
 * @param {{
 *   scenePlan?: object, scenePlanPath?: string, sceneLint?: object,
 *   htmlPath?: string, python?: string, cssPath?: string, chars?: number, samples?: number, processTimeoutMs?: number,
 *   geometryPath?: string, sourceDirectory?: string, timeoutMs?: number,
 *   loopcheck?: object, editListPath?: string, sourceDurations?: object
 * }} [staticGates]
 * @param {{runDirectory?: string|null}} [options]
 * @returns {Promise<object>} `{status, checklist, gates, limitations}` persisted next to the QA run
 */
export async function evaluateStaticGates(staticGates = {}, { runDirectory = null } = {}) {
  const gates = [];
  const limitations = [];
  if (staticGates.scenePlan || staticGates.scenePlanPath) {
    const plan = staticGates.scenePlan ?? await readJson(absolutePath(staticGates.scenePlanPath));
    const lint = runStaticMotionLint(plan, staticGates.sceneLint ?? {});
    gates.push({
      name: 'motion-lint',
      status: lintGateStatus(lint),
      findings: staticMotionGateFindings(lint),
      notes: [...lint.notes, formatStaticMotionLint(lint)],
      evidence: {
        version: lint.version, lintStatus: lint.status, reason: lint.reason, hash: lint.hash,
        frames: lint.frames, checked: lint.checked, counts: lint.counts,
        reportDirectory: runDirectory
      }
    });
  }
  if (staticGates.htmlPath) {
    const lint = await runStaticLint(staticGates.htmlPath, {
      python: staticGates.python, cssPath: staticGates.cssPath, chars: staticGates.chars,
      samples: staticGates.samples, processTimeoutMs: staticGates.processTimeoutMs
    });
    gates.push({
      name: 'static-lint',
      status: GATE_STATUS[lint.status] ?? 'blocked',
      findings: lint.findings,
      notes: lint.notes,
      evidence: {
        version: lint.version, sourceHash: lint.sourceHash, lint: lint.lint, fonts: lint.fonts,
        reportDirectory: runDirectory
      }
    });
  }
  if (staticGates.geometryPath) {
    const geometry = await inspectMotionGeometry(staticGates.geometryPath, {
      sourceDirectory: staticGates.sourceDirectory, timeoutMs: staticGates.timeoutMs
    });
    gates.push({
      name: 'geometry',
      status: GATE_STATUS[geometry.status] ?? 'blocked',
      findings: geometry.findings,
      notes: geometry.notes,
      evidence: {
        version: geometry.version, geometryHash: geometry.geometryHash, vendorStatus: geometry.vendorStatus ?? null,
        measuredObjects: geometry.measuredObjects, scannedFiles: geometry.scannedFiles, skipped: geometry.skipped,
        passes: geometry.passes, warnings: geometry.warnings, reason: geometry.reason
      }
    });
  }
  if (staticGates.loopcheck) {
    const loopcheck = staticGates.loopcheck;
    if (!LOOPCHECK_STATUSES.has(loopcheck?.status) || typeof loopcheck.loop !== 'string') {
      throw new WorkflowError('QA_STATIC_GATE_INVALID', 'The loopcheck gate needs a checkLoop() result ({status, loop, frames, checks}).');
    }
    gates.push({
      name: 'loopcheck',
      status: GATE_STATUS[loopcheck.status],
      findings: loopcheck.status === 'pass' ? [] : [{
        code: 'LOOP_SEAM_BROKEN', severity: 'error',
        message: loopcheck.notes?.at(-1) ?? `Loop check failed for the ${loopcheck.loop} loop.`
      }],
      notes: loopcheck.notes ?? [],
      evidence: {
        version: loopcheck.version ?? null, loop: loopcheck.loop, frames: loopcheck.frames ?? null,
        maxDiff: loopcheck.maxDiff ?? null, hold: loopcheck.hold ?? null, seam: loopcheck.seam ?? null, fstep: loopcheck.fstep ?? null
      }
    });
  }
  if (staticGates.editListPath) {
    const resolved = await resolveEditListFile(staticGates.editListPath, { sourceDurations: staticGates.sourceDurations });
    const slates = resolved.slates ?? [];
    gates.push({
      name: 'edit-list',
      status: slates.length ? 'fail' : 'pass',
      findings: slates.length ? [{
        code: 'EDIT_SLATE_PRESENT', severity: 'error',
        message: `The edit list still carries slate entries (${slates.join(', ')}); this render is an animatic, not a deliverable.`
      }] : [],
      notes: resolved.notes ?? [],
      evidence: {
        frames: resolved.frames, duration: resolved.duration, cuts: resolved.cuts, slates,
        runs: resolved.runs.length, edit: resolved.edit ?? null
      }
    });
  }
  if (!gates.length) {
    return {
      status: 'not_run',
      checklist: { ...CHECKLIST },
      gates,
      limitations: ['No static gate was requested; the pre-vision checks did not run for this QA pass.']
    };
  }
  const anyFail = gates.some(gate => gate.status === 'fail');
  const anyBlocked = gates.some(gate => gate.status === 'blocked' || gate.status === 'skipped' || gate.status === 'not_run');
  const status = anyFail ? 'fail' : anyBlocked ? 'needs_review' : 'pass';
  for (const gate of gates) {
    if (gate.status === 'blocked') limitations.push(`Static gate ${gate.name} did not run; an unrun gate is not evidence.`);
  }
  limitations.push('Static gates are vision-free measurements; the 20-point contact-sheet checklist and the 8-point fresh-context reviewer remain a human/agent review.');
  const section = { status, checklist: { ...CHECKLIST }, gates, limitations };
  if (runDirectory) {
    const directory = absolutePath(path.join(runDirectory, 'static-gates'));
    await fs.mkdir(directory, { recursive: true });
    await writeJsonState(path.join(directory, 'static-gates.json'), section);
  }
  return section;
}
