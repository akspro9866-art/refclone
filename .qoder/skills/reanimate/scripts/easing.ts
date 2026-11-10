/**
 * Cubic-Bezier & Damped Harmonic Oscillator Spring Curve Fitter (`reanimate/scripts/easing.ts`).
 *
 * Fits normalized 1D motion trajectories (0..1 time, 0..1 progress with optional
 * overshoot) to either:
 *   1. `cubic-bezier(x1, y1, x2, y2)` with Cavalry `magicEasing` classification
 *   2. `spring(stiffness, damping, mass)` closed-form underdamped/critical response
 */

export interface TrajectoryPoint {
  /** Normalized time in [0, 1] (or raw ms/frame before normalization). */
  t: number;
  /** Value at time t. */
  v: number;
}

export interface CubicBezierFit {
  type: "cubic-bezier";
  controlPoints: [number, number, number, number];
  css: string;
  cavalryMagicEase: string;
  rmse: number;
  rSquared: number;
}

export interface SpringFit {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
  dampingRatio: number;
  overshoot: number;
  settlingTimeMs: number;
  rmse: number;
  rSquared: number;
}

export type FittedCurve = CubicBezierFit | SpringFit;

function bezierCoord(p1: number, p2: number, s: number): number {
  const u = 1 - s;
  return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
}

export function evaluateCubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2;
    if (bezierCoord(x1, x2, s) < t) lo = s;
    else hi = s;
  }
  return bezierCoord(y1, y2, s);
}

export function evaluateSpringNormalized(
  stiffness: number,
  damping: number,
  mass: number,
  tSeconds: number,
): number {
  if (tSeconds <= 0) return 0;
  const wn = Math.sqrt(Math.max(1e-6, stiffness) / Math.max(1e-6, mass));
  const zeta = damping / (2 * Math.sqrt(Math.max(1e-6, stiffness * mass)));
  if (zeta < 1) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * wn * tSeconds);
    return 1 - env * (Math.cos(wd * tSeconds) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * tSeconds));
  }
  if (Math.abs(zeta - 1) < 1e-4) {
    return 1 - (1 + wn * tSeconds) * Math.exp(-wn * tSeconds);
  }
  const r1 = -wn * (zeta - Math.sqrt(zeta * zeta - 1));
  const r2 = -wn * (zeta + Math.sqrt(zeta * zeta - 1));
  return 1 - (r2 * Math.exp(r1 * tSeconds) - r1 * Math.exp(r2 * tSeconds)) / (r2 - r1);
}

/** Normalize raw (time, value) samples into t in [0, 1] and v where start=0, end=1. */
export function normalizeTrajectory(samples: TrajectoryPoint[]): {
  normalized: TrajectoryPoint[];
  durationSpan: number;
  valueSpan: number;
  peakOvershoot: number;
} {
  if (samples.length < 2) {
    return { normalized: [{ t: 0, v: 0 }, { t: 1, v: 1 }], durationSpan: 1, valueSpan: 1, peakOvershoot: 0 };
  }
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const durationSpan = Math.max(1e-6, t1 - t0);
  const v0 = samples[0].v;
  const v1 = samples[samples.length - 1].v;
  const valueSpan = Math.abs(v1 - v0) > 1e-6 ? v1 - v0 : 1;
  let peakOvershoot = 0;
  const normalized = samples.map((pt) => {
    const t = Math.max(0, Math.min(1, (pt.t - t0) / durationSpan));
    const v = (pt.v - v0) / valueSpan;
    if (v - 1 > peakOvershoot) peakOvershoot = v - 1;
    return { t, v };
  });
  return { normalized, durationSpan, valueSpan, peakOvershoot };
}

function computeStats(samples: TrajectoryPoint[], predict: (t: number) => number): { rmse: number; rSquared: number } {
  const n = samples.length;
  if (n === 0) return { rmse: 0, rSquared: 1 };
  const mean = samples.reduce((acc, s) => acc + s.v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (const s of samples) {
    const err = s.v - predict(s.t);
    ssRes += err * err;
    const dev = s.v - mean;
    ssTot += dev * dev;
  }
  const rmse = Math.sqrt(ssRes / n);
  const rSquared = ssTot > 1e-9 ? Math.max(0, 1 - ssRes / ssTot) : 1;
  return { rmse, rSquared };
}

const CANONICAL_BEZIERS: Array<{ name: string; cp: [number, number, number, number] }> = [
  { name: "None", cp: [0, 0, 1, 1] },
  { name: "SlowOut", cp: [0, 0, 0.58, 1] },
  { name: "VerySlowOut", cp: [0.16, 1, 0.3, 1] },
  { name: "SlowIn", cp: [0.42, 0, 1, 1] },
  { name: "SlowInSlowOut", cp: [0.42, 0, 0.58, 1] },
  { name: "VerySlowInVerySlowOut", cp: [0.76, 0, 0.24, 1] },
  { name: "SpringOut", cp: [0.22, 1.4, 0.36, 1] },
  { name: "OvershootOut", cp: [0.34, 1.56, 0.64, 1] },
  { name: "AnticipateIn", cp: [0.36, 0, 0.66, -0.56] },
];

export function fitCubicBezier(rawSamples: TrajectoryPoint[]): CubicBezierFit {
  const { normalized } = normalizeTrajectory(rawSamples);
  let bestCp: [number, number, number, number] = [0.16, 1, 0.3, 1];
  let bestMagic = "VerySlowOut";
  let bestRmse = Number.POSITIVE_INFINITY;
  let bestR2 = 0;

  for (const preset of CANONICAL_BEZIERS) {
    const [x1, y1, x2, y2] = preset.cp;
    const stats = computeStats(normalized, (t) => evaluateCubicBezier(x1, y1, x2, y2, t));
    if (stats.rmse < bestRmse) {
      bestRmse = stats.rmse;
      bestR2 = stats.rSquared;
      bestCp = [x1, y1, x2, y2];
      bestMagic = preset.name;
    }
  }

  // Coordinate refinement around the best canonical seed
  const stepSizes = [0.08, 0.03, 0.01];
  for (const step of stepSizes) {
    for (let idx = 0; idx < 4; idx++) {
      for (const dir of [-1, 1]) {
        const candidate: [number, number, number, number] = [...bestCp] as [number, number, number, number];
        candidate[idx] = Number((candidate[idx] + dir * step).toFixed(3));
        if ((idx === 0 || idx === 2) && (candidate[idx] < 0 || candidate[idx] > 1)) continue;
        const stats = computeStats(normalized, (t) =>
          evaluateCubicBezier(candidate[0], candidate[1], candidate[2], candidate[3], t),
        );
        if (stats.rmse + 1e-6 < bestRmse) {
          bestRmse = stats.rmse;
          bestR2 = stats.rSquared;
          bestCp = candidate;
        }
      }
    }
  }

  return {
    type: "cubic-bezier",
    controlPoints: bestCp,
    css: `cubic-bezier(${bestCp.join(", ")})`,
    cavalryMagicEase: bestMagic,
    rmse: Number(bestRmse.toFixed(5)),
    rSquared: Number(bestR2.toFixed(5)),
  };
}

export function fitSpring(rawSamples: TrajectoryPoint[], durationSeconds = 0.5): SpringFit {
  const { normalized, peakOvershoot } = normalizeTrajectory(rawSamples);
  const safeDuration = Math.max(0.05, durationSeconds);
  let bestStiffness = 280;
  let bestDamping = 22;
  const mass = 1.0;
  let bestRmse = Number.POSITIVE_INFINITY;
  let bestR2 = 0;

  for (const k of [140, 180, 220, 260, 300, 340, 380, 440]) {
    for (const c of [12, 16, 20, 24, 28, 32, 38]) {
      const stats = computeStats(normalized, (t) => evaluateSpringNormalized(k, c, mass, t * safeDuration));
      if (stats.rmse < bestRmse) {
        bestRmse = stats.rmse;
        bestR2 = stats.rSquared;
        bestStiffness = k;
        bestDamping = c;
      }
    }
  }

  const zeta = bestDamping / (2 * Math.sqrt(bestStiffness * mass));
  const wn = Math.sqrt(bestStiffness / mass);
  const settlingTimeMs = Math.round((4 / Math.max(1e-3, zeta * wn)) * 1000);

  return {
    type: "spring",
    stiffness: bestStiffness,
    damping: bestDamping,
    mass,
    dampingRatio: Number(zeta.toFixed(4)),
    overshoot: Number(peakOvershoot.toFixed(4)),
    settlingTimeMs,
    rmse: Number(bestRmse.toFixed(5)),
    rSquared: Number(bestR2.toFixed(5)),
  };
}

/** Fit both models and return the higher-fidelity representation. */
export function fitBestMotionCurve(rawSamples: TrajectoryPoint[], durationSeconds = 0.5): FittedCurve {
  const bezier = fitCubicBezier(rawSamples);
  const spring = fitSpring(rawSamples, durationSeconds);
  const { peakOvershoot } = normalizeTrajectory(rawSamples);
  if (peakOvershoot > 0.02 && spring.rSquared >= bezier.rSquared - 0.01) {
    return spring;
  }
  return spring.rmse < bezier.rmse ? spring : bezier;
}
