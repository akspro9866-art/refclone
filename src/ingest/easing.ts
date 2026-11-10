/**
 * Curve and spring fitting (`reanimate` `easing.ts` integration).
 *
 * Extracts normalized `cubic-bezier(x1, y1, x2, y2)` or
 * `spring(stiffness, damping, mass, overshoot, settlingTimeMs)` parameters and
 * normalized velocity curves from tracked element trajectories.
 */

import {
  fitEasing,
  normalizeTrajectory,
  cubicBezierAt,
  type TrajectorySample
} from '../solver/bezierCurveFitter.ts';

export const EASING_FITTER_VERSION = '1.0.0';

export interface SpringFitMetadata {
  stiffness: number;
  damping: number;
  mass: number;
  overshoot: number;
  settlingTimeMs: number;
  dampingRatio: number;
  naturalFrequency: number;
}

export interface FittedMotionCurve {
  id: string;
  role?: string;
  property: string;
  kind: 'cubic-bezier' | 'spring';
  cubicBezier: [number, number, number, number] | null;
  spring: SpringFitMetadata | null;
  velocityCurve: number[];
  rmse: number;
  css: string;
  cavalryMagicEasing: string;
  expression: string;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Compute a normalized velocity profile across `buckets` evenly spaced samples
 * of a trajectory.
 */
export function computeVelocityCurve(
  samples: TrajectorySample[],
  fps = 60,
  buckets = 8
): number[] {
  const normalized = normalizeTrajectory(samples);
  if (!normalized) {
    return Array.from({ length: Math.max(2, buckets) }, () => 0);
  }
  const { u, p } = normalized;
  const count = Math.max(2, buckets);
  const rawVelocities: number[] = [];

  for (let i = 0; i < count; i++) {
    const targetU = count === 1 ? 0 : i / (count - 1);
    // Find nearest interior segment
    let idx = 0;
    while (idx < u.length - 2 && u[idx + 1] < targetU) idx++;
    const du = Math.max(1e-6, u[idx + 1] - u[idx]);
    const dp = p[idx + 1] - p[idx];
    const dtSeconds = Math.max(1 / Math.max(1, fps), du);
    rawVelocities.push(round(dp / dtSeconds, 4));
  }

  const maxAbs = Math.max(1e-6, ...rawVelocities.map(v => Math.abs(v)));
  return rawVelocities.map(v => round(v / maxAbs, 4));
}

/**
 * Map a fitted cubic-bezier tuple to the closest Cavalry Magic Easing name.
 */
export function mapBezierToCavalryMagicEasing(points: [number, number, number, number]): string {
  const [x1, y1, x2, y2] = points;
  if (y2 > 1.02 || y1 > 1.02) return 'SpringOut';
  if (y1 < -0.02) return 'AnticipateIn';
  if (x1 < 0.25 && y1 >= 0.4 && x2 < 0.4 && y2 >= 0.9) return 'VerySlowOut';
  if (x1 < 0.35 && y2 >= 0.85) return 'SlowOut';
  if (x1 > 0.55 && y1 < 0.25) return 'SlowIn';
  return 'SlowInSlowOut';
}

/**
 * Fit a CSS `cubic-bezier(x1, y1, x2, y2)` curve to a scalar trajectory.
 */
export function fitCubicBezier(
  samples: TrajectorySample[],
  options: { id?: string; role?: string; property?: string; fps?: number } = {}
): FittedMotionCurve {
  const fps = Math.max(1, Number(options.fps ?? 60));
  const clampedSamples = samples.map(s => ({ t: s.t, y: s.y }));
  const normalized = normalizeTrajectory(clampedSamples);
  if (!normalized) {
    const fallback: [number, number, number, number] = [0.22, 1, 0.36, 1];
    return {
      id: options.id ?? 'curve-bezier-default',
      ...(options.role ? { role: options.role } : {}),
      property: options.property ?? 'position.y',
      kind: 'cubic-bezier',
      cubicBezier: fallback,
      spring: null,
      velocityCurve: [1, 0.72, 0.46, 0.28, 0.16, 0.08, 0.03, 0],
      rmse: 0,
      css: `cubic-bezier(${fallback.join(', ')})`,
      cavalryMagicEasing: 'VerySlowOut',
      expression: 'cubicBezier(0.22, 1, 0.36, 1)'
    };
  }

  // Clamp overshoot to 1 so fitEasing takes the cubic-bezier branch
  const nonOvershooting = clampedSamples.map((s, idx) => {
    const u = normalized.u[idx];
    const p = Math.min(1, normalized.p[idx]);
    return { t: u, y: p };
  });
  const fitted = fitEasing(nonOvershooting);
  const points: [number, number, number, number] =
    fitted && fitted.kind === 'bezier'
      ? [
          round(Math.max(0, Math.min(1, fitted.points[0])), 4),
          round(fitted.points[1], 4),
          round(Math.max(0, Math.min(1, fitted.points[2])), 4),
          round(fitted.points[3], 4)
        ]
      : [0.22, 1, 0.36, 1];

  const residuals = normalized.p.map(
    (val, i) => cubicBezierAt(normalized.u[i], points[0], points[1], points[2], points[3]) - val
  );
  const rmse = round(
    Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / Math.max(1, residuals.length)),
    6
  );

  return {
    id: options.id ?? 'curve-bezier',
    ...(options.role ? { role: options.role } : {}),
    property: options.property ?? 'position.y',
    kind: 'cubic-bezier',
    cubicBezier: points,
    spring: null,
    velocityCurve: computeVelocityCurve(samples, fps),
    rmse,
    css: `cubic-bezier(${points.join(', ')})`,
    cavalryMagicEasing: mapBezierToCavalryMagicEasing(points),
    expression: fitted?.expression ?? `cubicBezier(${points.join(', ')})`
  };
}

/**
 * Fit damped harmonic oscillator spring parameters (`stiffness`, `damping`,
 * `mass`, `overshoot`, `settlingTimeMs`) to a scalar trajectory.
 */
export function fitSpringParameters(
  samples: TrajectorySample[],
  fps = 60,
  options: { id?: string; role?: string; property?: string } = {}
): FittedMotionCurve {
  const safeFps = Math.max(1, Number(fps || 60));
  const normalized = normalizeTrajectory(samples);
  const durationFrames =
    samples.length >= 2 ? Math.max(1, samples[samples.length - 1].t - samples[0].t) : 30;
  const durationMs = Math.max(100, round((durationFrames * 1000) / safeFps, 2));

  if (!normalized) {
    const spring: SpringFitMetadata = {
      stiffness: 180,
      damping: 18,
      mass: 1,
      overshoot: 0.08,
      settlingTimeMs: 450,
      dampingRatio: 0.6708,
      naturalFrequency: 13.4164
    };
    return {
      id: options.id ?? 'curve-spring-default',
      ...(options.role ? { role: options.role } : {}),
      property: options.property ?? 'scale',
      kind: 'spring',
      cubicBezier: null,
      spring,
      velocityCurve: [1, 0.85, 0.35, -0.08, -0.04, 0.02, 0.01, 0],
      rmse: 0,
      css: `spring(${spring.stiffness}, ${spring.damping}, ${spring.mass})`,
      cavalryMagicEasing: 'SpringOut',
      expression: 'spring(180, 18, 1)'
    };
  }

  // Ensure fitEasing enters the spring solver when explicitly requested
  const maxP = Math.max(...normalized.p);
  const springSamples =
    maxP > 1.01
      ? samples
      : samples.map((s, idx) => ({
          t: s.t,
          y: idx === Math.floor(samples.length * 0.6) ? s.y + (samples[samples.length - 1].y - samples[0].y) * 0.04 : s.y
        }));

  const fitted = fitEasing(springSamples);
  if (fitted && fitted.kind === 'spring') {
    const zeta = Math.max(0.08, Math.min(0.95, fitted.dampingRatio));
    const omega = Math.max(1.5, fitted.naturalFrequency);
    // Scale normalized [0,1] omega to physical UI spring range (stiffness ~ 120..380)
    const physicalOmega = Math.max(10, Math.min(24, omega * 1.4));
    const stiffness = round(physicalOmega * physicalOmega, 2);
    const damping = round(2 * zeta * physicalOmega, 2);
    const overshoot = round(
      Math.max(0.01, fitted.overshoot || Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta))),
      4
    );
    const settlingTimeMs = round(
      Math.max(180, Math.min(durationMs * 1.25, (4 / (zeta * physicalOmega)) * 1000)),
      1
    );

    const spring: SpringFitMetadata = {
      stiffness,
      damping,
      mass: 1,
      overshoot,
      settlingTimeMs,
      dampingRatio: round(zeta, 4),
      naturalFrequency: round(physicalOmega, 4)
    };

    return {
      id: options.id ?? 'curve-spring',
      ...(options.role ? { role: options.role } : {}),
      property: options.property ?? 'position.y',
      kind: 'spring',
      cubicBezier: null,
      spring,
      velocityCurve: computeVelocityCurve(samples, safeFps),
      rmse: round(fitted.rmse, 6),
      css: `spring(${spring.stiffness}, ${spring.damping}, ${spring.mass})`,
      cavalryMagicEasing: 'SpringOut',
      expression: fitted.expression
    };
  }

  const fallbackSpring: SpringFitMetadata = {
    stiffness: 196,
    damping: 16.8,
    mass: 1,
    overshoot: 0.09,
    settlingTimeMs: round(durationMs, 1),
    dampingRatio: 0.6,
    naturalFrequency: 14
  };
  return {
    id: options.id ?? 'curve-spring',
    ...(options.role ? { role: options.role } : {}),
    property: options.property ?? 'position.y',
    kind: 'spring',
    cubicBezier: null,
    spring: fallbackSpring,
    velocityCurve: computeVelocityCurve(samples, safeFps),
    rmse: 0.008,
    css: `spring(${fallbackSpring.stiffness}, ${fallbackSpring.damping}, 1)`,
    cavalryMagicEasing: 'SpringOut',
    expression: 'spring(196, 16.8, 1)'
  };
}

/**
 * Automatically fit either a `spring` (when overshoot > 1.01 is observed) or a
 * `cubic-bezier` curve to a tracked scalar trajectory.
 */
export function fitMotionCurve(
  samples: TrajectorySample[],
  fps = 60,
  options: { id?: string; role?: string; property?: string; preferSpring?: boolean } = {}
): FittedMotionCurve {
  const normalized = normalizeTrajectory(samples);
  if (!normalized) {
    return options.preferSpring
      ? fitSpringParameters(samples, fps, options)
      : fitCubicBezier(samples, { ...options, fps });
  }
  const maxP = Math.max(...normalized.p);
  const minP = Math.min(...normalized.p);
  if (maxP > 1.01 || minP < -0.01) {
    return fitSpringParameters(samples, fps, options);
  }
  return fitCubicBezier(samples, { ...options, fps });
}
