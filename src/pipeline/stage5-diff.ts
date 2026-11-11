/**
 * Stage 5 — Perceptual Diff Gating (`src/pipeline/stage5-diff.ts`).
 * Evaluates SSIM and IoU gates, ensuring clean child process termination and safe cleanup.
 */
import { safeRm } from "../utils/ffmpeg-safe.ts";
import { roundDet } from "../utils/math-det.ts";

export interface DiffGateOptions {
  ssimThreshold?: number;
  iouThreshold?: number;
  tempDir?: string;
}

export interface DiffGateResult {
  passed: boolean;
  ssim: number;
  iou: number;
  ssimThreshold: number;
  iouThreshold: number;
}

export function computeBoxIoU(
  boxA: { x: number; y: number; width: number; height: number },
  boxB: { x: number; y: number; width: number; height: number },
): number {
  const xA = Math.max(boxA.x, boxB.x);
  const yA = Math.max(boxA.y, boxB.y);
  const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
  const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

  const interWidth = Math.max(0, xB - xA);
  const interHeight = Math.max(0, yB - yA);
  const interArea = interWidth * interHeight;

  const areaA = boxA.width * boxA.height;
  const areaB = boxB.width * boxB.height;
  const unionArea = areaA + areaB - interArea;

  if (unionArea <= 0) return 0;
  return roundDet(interArea / unionArea, 4);
}

export async function evaluateDiffGate(
  measuredSsim: number,
  measuredIoU: number,
  options: DiffGateOptions = {},
): Promise<DiffGateResult> {
  const ssimThreshold = options.ssimThreshold ?? 0.96;
  const iouThreshold = options.iouThreshold ?? 0.95;

  const ssim = roundDet(measuredSsim, 4);
  const iou = roundDet(measuredIoU, 4);

  const passed = ssim >= ssimThreshold && iou >= iouThreshold;

  if (options.tempDir) {
    safeRm(options.tempDir);
  }

  return {
    passed,
    ssim,
    iou,
    ssimThreshold,
    iouThreshold,
  };
}
