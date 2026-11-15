/**
 * Stage 5 — Perceptual Diff Gating (`src/pipeline/stage5-diff.ts`).
 * Evaluates SSIM and IoU gates, ensuring clean child process termination and safe cleanup.
 *
 * When a Stage 1 beat manifest is supplied (`beatManifestDir` or
 * `beatManifest`), the gate re-verifies the lock digest before any temporal
 * anchor is consulted — an iterative Stage 4/5 refinement loop can never
 * drift off the locked cut anchors: a drifted manifest fails the gate with
 * `beatLock.valid: false` instead of silently re-anchoring.
 */
import { safeRm } from "../utils/ffmpeg-safe.ts";
import { roundDet } from "../utils/math-det.ts";
import { beatManifestHash as beatManifestDigest, loadLockedBeatManifest } from "./beat-manifest.mjs";

export interface DiffGateOptions {
  ssimThreshold?: number;
  iouThreshold?: number;
  tempDir?: string;
  /** Directory holding the locked `beat-manifest.json` written at Stage 1. */
  beatManifestDir?: string;
  /** Already-loaded manifest (skips the disk read; digest is still verified). */
  beatManifest?: Record<string, unknown> | null;
}

export interface BeatLockVerification {
  locked: boolean;
  valid: boolean;
  drift: boolean;
  recordedHash: string | null;
  computedHash: string | null;
}

export interface DiffGateResult {
  passed: boolean;
  ssim: number;
  iou: number;
  ssimThreshold: number;
  iouThreshold: number;
  beatLock?: BeatLockVerification;
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

/**
 * Verify the Stage 1 beat lock: the digest recorded at lock time must match a
 * recomputation over the manifest body. In-memory manifests are re-hashed
 * directly; directory manifests go through the disk loader.
 */
export function verifyBeatLock(options: { beatManifestDir?: string; beatManifest?: BeatManifest | null } = {}): BeatLockVerification {
  const notLocked = { locked: false, valid: false, drift: false, recordedHash: null, computedHash: null };
  if (options.beatManifest !== undefined) {
    const manifest = options.beatManifest;
    if (!manifest || typeof manifest !== "object") return notLocked;
    const recorded = typeof manifest.manifestHash === "string" ? manifest.manifestHash : null;
    const computed = beatManifestDigest(manifest);
    return { locked: true, valid: recorded === computed, drift: recorded !== computed, recordedHash: recorded, computedHash: computed };
  }
  if (options.beatManifestDir) {
    const { manifest, valid, computedHash, drift } = loadLockedBeatManifest(options.beatManifestDir);
    return {
      locked: Boolean(manifest),
      valid,
      drift,
      recordedHash: manifest && typeof manifest.manifestHash === "string" ? manifest.manifestHash : null,
      computedHash,
    };
  }
  return notLocked;
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

  const beatLockSupplied = options.beatManifest !== undefined || options.beatManifestDir !== undefined;
  const beatLock = beatLockSupplied ? verifyBeatLock(options) : undefined;

  return {
    passed,
    ssim,
    iou,
    ssimThreshold,
    iouThreshold,
    ...(beatLock ? { beatLock } : {}),
  };
}
