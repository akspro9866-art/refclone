/**
 * Perceptual SSIM & Bounding-Box IoU Comparator (`reanimate/scripts/compare.ts`).
 *
 * Compares RGBA frame buffers and DOM/Cavalry bounding boxes between a reference
 * and a rendered scene.
 */

export interface Box2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameComparisonResult {
  ssim: number;
  maeNormalized: number;
  bboxIoU: number;
  passed: boolean;
}

/** Compute Intersection-over-Union (IoU) for two axis-aligned 2D bounding boxes. */
export function computeBoxIoU(a: Box2D, b: Box2D): number {
  const xLeft = Math.max(a.x, b.x);
  const yTop = Math.max(a.y, b.y);
  const xRight = Math.min(a.x + a.width, b.x + b.width);
  const yBottom = Math.min(a.y + a.height, b.y + b.height);
  if (xRight <= xLeft || yBottom <= yTop) return 0;
  const intersection = (xRight - xLeft) * (yBottom - yTop);
  const union = Math.max(0, a.width * a.height) + Math.max(0, b.width * b.height) - intersection;
  return union > 0 ? Number((intersection / union).toFixed(5)) : 0;
}

/** Compute global luminance SSIM and normalized MAE over two equal-sized RGBA buffers. */
export function compareRgbaBuffers(
  rgbaA: Uint8Array,
  rgbaB: Uint8Array,
  options: { ssimThreshold?: number; boxA?: Box2D; boxB?: Box2D } = {},
): FrameComparisonResult {
  const len = Math.min(rgbaA.length, rgbaB.length);
  const pixelCount = Math.floor(len / 4);
  if (pixelCount === 0) {
    return { ssim: 0, maeNormalized: 1, bboxIoU: 0, passed: false };
  }
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  let absDiff = 0;

  for (let i = 0; i < pixelCount * 4; i += 4) {
    const lumaX = 0.2126 * rgbaA[i] + 0.7152 * rgbaA[i + 1] + 0.0722 * rgbaA[i + 2];
    const lumaY = 0.2126 * rgbaB[i] + 0.7152 * rgbaB[i + 1] + 0.0722 * rgbaB[i + 2];
    sumX += lumaX;
    sumY += lumaY;
    sumXX += lumaX * lumaX;
    sumYY += lumaY * lumaY;
    sumXY += lumaX * lumaY;
    absDiff += Math.abs(lumaX - lumaY) / 255;
  }

  const meanX = sumX / pixelCount;
  const meanY = sumY / pixelCount;
  const varX = Math.max(0, sumXX / pixelCount - meanX * meanX);
  const varY = Math.max(0, sumYY / pixelCount - meanY * meanY);
  const covXY = sumXY / pixelCount - meanX * meanY;

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const ssim = ((2 * meanX * meanY + c1) * (2 * covXY + c2)) / ((meanX ** 2 + meanY ** 2 + c1) * (varX + varY + c2));
  const maeNormalized = absDiff / pixelCount;
  const bboxIoU = options.boxA && options.boxB ? computeBoxIoU(options.boxA, options.boxB) : 1;
  const threshold = options.ssimThreshold ?? 0.96;

  return {
    ssim: Number(Math.max(0, Math.min(1, ssim)).toFixed(5)),
    maeNormalized: Number(maeNormalized.toFixed(5)),
    bboxIoU,
    passed: ssim >= threshold,
  };
}
