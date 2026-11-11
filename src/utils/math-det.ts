/**
 * Deterministic Floating-Point Math (`src/utils/math-det.ts`).
 * Ensures bit-identical coordinates, trajectories, and parameters across
 * Windows and Ubuntu runners.
 */

export function roundDet(n: number, decimals = 4): number {
  if (!Number.isFinite(n)) return 0;
  const [mantissa, expStr] = n.toExponential().split("e");
  const shifted = Number(`${mantissa}e${Number(expStr) + decimals}`);
  const rounded = Math.round(shifted);
  const res = Number(`${rounded}e-${decimals}`);
  return Object.is(res, -0) ? 0 : res;
}

export function roundDetPoint(pt: { x: number; y: number }, decimals = 4): { x: number; y: number } {
  return {
    x: roundDet(pt.x, decimals),
    y: roundDet(pt.y, decimals),
  };
}

export function roundDetBbox(
  box: { x: number; y: number; width: number; height: number },
  decimals = 4,
): { x: number; y: number; width: number; height: number } {
  return {
    x: roundDet(box.x, decimals),
    y: roundDet(box.y, decimals),
    width: roundDet(box.width, decimals),
    height: roundDet(box.height, decimals),
  };
}
