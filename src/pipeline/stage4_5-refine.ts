/**
 * Stage 4.5 — Local Numerical Coordinate Refinement (`src/pipeline/stage4_5-refine.ts`).
 * Uses deterministic float math (roundDet) to converge coordinates within tolerance.
 */
import { roundDet } from "../utils/math-det.ts";

export interface RefinementTarget {
  elementId: string;
  targetBbox: { x: number; y: number; width: number; height: number };
  currentBbox: { x: number; y: number; width: number; height: number };
}

export interface RefinementStep {
  iteration: number;
  dx: number;
  dy: number;
  l2Loss: number;
  converged: boolean;
}

export interface Stage45RefineResult {
  converged: boolean;
  iterations: number;
  finalBbox: { x: number; y: number; width: number; height: number };
  steps: RefinementStep[];
}

export function refineCoordinatesLocally(
  target: RefinementTarget,
  options: { maxIterations?: number; tolerancePx?: number } = {},
): Stage45RefineResult {
  const maxIterations = options.maxIterations ?? 10;
  const tolerancePx = options.tolerancePx ?? 1.5;

  let currentX = roundDet(target.currentBbox.x, 4);
  let currentY = roundDet(target.currentBbox.y, 4);
  const targetX = roundDet(target.targetBbox.x, 4);
  const targetY = roundDet(target.targetBbox.y, 4);

  const steps: RefinementStep[] = [];
  let converged = false;

  for (let i = 0; i < maxIterations; i++) {
    const dx = roundDet(targetX - currentX, 4);
    const dy = roundDet(targetY - currentY, 4);
    const l2Loss = roundDet(Math.sqrt(dx * dx + dy * dy), 4);

    if (l2Loss <= tolerancePx) {
      converged = true;
      steps.push({ iteration: i, dx, dy, l2Loss, converged: true });
      break;
    }

    // Coordinate descent step
    currentX = roundDet(currentX + dx * 0.5, 4);
    currentY = roundDet(currentY + dy * 0.5, 4);

    steps.push({ iteration: i, dx, dy, l2Loss, converged: false });
  }

  return {
    converged,
    iterations: steps.length,
    finalBbox: {
      x: currentX,
      y: currentY,
      width: roundDet(target.targetBbox.width, 4),
      height: roundDet(target.targetBbox.height, 4),
    },
    steps,
  };
}
