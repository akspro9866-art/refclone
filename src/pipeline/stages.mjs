// Pipeline stages around the vision pass. `runQa` executes the vision-free gates
// through `runVisionFreePreRenderGates` immediately before it decodes a reference
// frame or computes SSIM/MAE; the optical pass itself is unchanged.
//
// Keeping the gate stage in its own module makes the ordering explicit: a caller can
// run the same gates without importing the comparator, and the QA report records the
// gate section even when the comparator refuses to run.
import { evaluateStaticGates } from './gates.mjs';

export const PRE_VISION_GATE_STAGE = Object.freeze({
  id: 'vision-free-pre-render-gates',
  before: 'optical-flow-ssim',
  order: Object.freeze(['motion-lint', 'static-lint', 'geometry', 'loopcheck', 'edit-list'])
});

export const VISION_COMPARISON_STAGE = Object.freeze({
  id: 'optical-ssim',
  after: PRE_VISION_GATE_STAGE.id,
  metrics: Object.freeze(['mae', 'rmse', 'ssim', 'changedFraction', 'inkIou'])
});

/**
 * Run every vision-free gate. This is the exact call `runQa` makes before it probes
 * the reference or decodes a frame; gate semantics live in `gates.mjs`.
 * @param {object} staticGates gate inputs (see evaluateStaticGates)
 * @param {{runDirectory?: string|null}} [options]
 * @returns {Promise<object>} static-gate section
 */
export async function runVisionFreePreRenderGates(staticGates, options = {}) {
  return evaluateStaticGates(staticGates ?? {}, options);
}

/** Compact stage record for a run report: which gates ran and how they ended. */
export function summarizePreVisionGates(section) {
  if (!section) return { stage: PRE_VISION_GATE_STAGE.id, status: 'not_run', gates: [] };
  return {
    stage: PRE_VISION_GATE_STAGE.id,
    before: PRE_VISION_GATE_STAGE.before,
    status: section.status,
    gates: (section.gates ?? []).map(gate => ({
      name: gate.name,
      status: gate.status,
      findings: gate.findings?.length ?? 0
    }))
  };
}
