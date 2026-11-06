/**
 * Deterministic easing extraction — zero LLM tokens.
 *
 * Given a tracked scalar trajectory y(t) across frames [t0, t1] this module
 * fits, in pure math:
 *
 *   1. a cubic-bezier easing (x1, y1, x2, y2) with x1, x2 clamped to [0, 1] —
 *      the CSS-grammar curve Cavalry's Custom easing accepts as an expression;
 *   2. when the trajectory overshoots (progress > 1), the parameters of a
 *      damped spring (stiffness, damping, mass) that Cavalry can express.
 *
 * The fit is Levenberg–Marquardt with central-difference Jacobians, started
 * from a deterministic grid of seeds; the best seed wins, so the result is a
 * function of the samples only. Output is a ready-to-apply `_mg` keyframe
 * easing descriptor: an `api.magicEasing(id, attr, frame, "Custom",
 * expression)` write whose expression reproduces the fitted curve inside
 * Cavalry (the easing expression language exposes progress as `t`).
 */

export interface TrajectorySample {
	/** Frame number (or time in frames). */
	t: number;
	/** Tracked attribute value at that frame. */
	y: number;
}

export type EasingDescriptor =
	| {
			kind: "bezier";
			points: [number, number, number, number];
			easing: "Custom";
			/** Cavalry easing expression reproducing the curve. */
			expression: string;
			rmse: number;
			overshoot: number;
	  }
	| {
			kind: "spring";
			stiffness: number;
			damping: number;
			mass: number;
			/** Cavalry's spring behavior reads stiffness/damping; the expression form. */
			easing: "Custom";
			expression: string;
			dampingRatio: number;
			naturalFrequency: number;
			/** Endpoint-normalization scale (≈1 settled; >1 when the track ends mid-ring). */
			amplitude: number;
			rmse: number;
			overshoot: number;
	  };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Normalize a raw trajectory: time → u ∈ [0, 1], value → progress p(u) with
 * p(0)=0 and p(1)=1. A flat trajectory (y1 === y0) returns null — there is no
 * easing to extract from no motion.
 */
export function normalizeTrajectory(samples: TrajectorySample[]): { u: number[]; p: number[] } | null {
	if (samples.length < 4) return null;
	const t0 = samples[0].t;
	const t1 = samples[samples.length - 1].t;
	if (!(t1 > t0)) return null;
	const y0 = samples[0].y;
	const y1 = samples[samples.length - 1].y;
	if (y1 === y0) return null;
	const u: number[] = [];
	const p: number[] = [];
	for (const sample of samples) {
		u.push((sample.t - t0) / (t1 - t0));
		p.push((sample.y - y0) / (y1 - y0));
	}
	return { u, p };
}

/** Cubic-bezier y for time fraction s, given control points (x1,y1,x2,y2). */
export function cubicBezierAt(s: number, x1: number, y1: number, x2: number, y2: number): number {
	const solveU = (target: number): number => {
		let u = target;
		for (let iteration = 0; iteration < 8; iteration++) {
			const xu =
				3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
			const dxdu =
				3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
			if (Math.abs(xu - target) < 1e-6) break;
			if (Math.abs(dxdu) < 1e-9) break;
			u -= (xu - target) / dxdu;
			u = Math.max(0, Math.min(1, u));
		}
		return u;
	};
	const u = solveU(clamp01(s));
	return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
}

/** Under-damped unit-mass spring response to a unit step at u=0. */
function springAt(u: number, zeta: number, omega: number): number {
	if (zeta < 1) {
		const damped = omega * Math.sqrt(1 - zeta * zeta);
		const decay = Math.exp(-zeta * omega * u);
		return 1 - decay * (Math.cos(damped * u) + (zeta * omega / damped) * Math.sin(damped * u));
	}
	// Critically/over-damped fallback (kept for robustness; the fitter steers
	// zeta below 1 when overshoot exists).
	const decay = Math.exp(-omega * u);
	return 1 - decay * (1 + omega * u);
}

interface FitProblem {
	dimension: number;
	residuals(params: number[]): number[];
	clamp?: (params: number[]) => number[];
}

/**
 * Levenberg–Marquardt with central-difference Jacobians. Small problems only
 * (≤ 6 params), deterministic damping schedule.
 */
function levenbergMarquardt(problem: FitProblem, seed: number[]): number[] {
	let params = seed.slice();
	if (problem.clamp) problem.clamp(params);
	let lambda = 1e-3;
	let cost = problem.residuals(params).reduce((sum, r) => sum + r * r, 0);
	for (let iteration = 0; iteration < 60; iteration++) {
		const base = problem.residuals(params);
		const dimension = params.length;
		const jacobian: number[][] = base.map(() => new Array(dimension).fill(0));
		const step = 1e-5;
		for (let j = 0; j < dimension; j++) {
			const plus = params.slice();
			const minus = params.slice();
			plus[j] += step;
			minus[j] -= step;
			if (problem.clamp) {
				problem.clamp(plus);
				problem.clamp(minus);
			}
			const rp = problem.residuals(plus);
			const rm = problem.residuals(minus);
			for (let i = 0; i < base.length; i++) {
				jacobian[i][j] = (rp[i] - rm[i]) / (2 * step);
			}
		}
		// Normal equations: (JᵀJ + λ·diag(JᵀJ))·δ = Jᵀr — solved by Gaussian elimination.
		const jtj: number[][] = [];
		for (let a = 0; a < dimension; a++) {
			jtj.push([]);
			for (let b = 0; b < dimension; b++) {
				let sum = 0;
				for (let i = 0; i < jacobian.length; i++) sum += jacobian[i][a] * jacobian[i][b];
				jtj[a].push(sum + (a === b ? lambda * (sum + 1e-9) : 0));
			}
		}
		const jtr: number[] = [];
		for (let a = 0; a < dimension; a++) {
			let sum = 0;
			for (let i = 0; i < base.length; i++) sum += jacobian[i][a] * base[i];
			jtr.push(-sum);
		}
		const delta = solveLinear(jtj, jtr);
		if (!delta) break;
		const candidate = params.map((value, index) => value + delta[index]);
		if (problem.clamp) problem.clamp(candidate);
		const candidateCost = problem.residuals(candidate).reduce((sum, r) => sum + r * r, 0);
		if (Number.isFinite(candidateCost) && candidateCost < cost) {
			params = candidate;
			cost = candidateCost;
			lambda = Math.max(lambda / 3, 1e-9);
			if (cost < 1e-14) break;
		} else {
			lambda = Math.min(lambda * 5, 1e6);
			if (lambda >= 1e6) break;
		}
	}
	return params;
}

/** Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(matrix: number[][], vector: number[]): number[] | null {
	const n = vector.length;
	const a = matrix.map((row, index) => [...row, vector[index]]);
	for (let column = 0; column < n; column++) {
		let pivot = column;
		for (let row = column + 1; row < n; row++) {
			if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
		}
		if (Math.abs(a[pivot][column]) < 1e-12) return null;
		[a[column], a[pivot]] = [a[pivot], a[column]];
		for (let row = 0; row < n; row++) {
			if (row === column) continue;
			const factor = a[row][column] / a[column][column];
			for (let k = column; k <= n; k++) a[row][k] -= factor * a[column][k];
		}
	}
	return a.map((row, index) => row[n] / row[index]);
}

function rmseOf(residuals: number[]): number {
	return Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length);
}

/** Number → Cavalry expression literal with fixed precision. */
const lit = (value: number): string => Number(value.toFixed(6)).toString();

export interface BezierFitResult extends EasingDescriptor {
	rmse: number;
}

/**
 * Fit an easing to a tracked trajectory.
 *
 * Overshoot (any p(u) > 1.01) routes to the spring fit; everything else to
 * the bezier fit. Both start from a fixed seed grid and return the best.
 */
export function fitEasing(samples: TrajectorySample[]): EasingDescriptor | null {
	const normalized = normalizeTrajectory(samples);
	if (!normalized) return null;
	const { u, p } = normalized;
	const overshoot = Math.max(...p);
	if (overshoot > 1.01) return fitSpring(u, p, overshoot);
	return fitBezier(u, p, overshoot);
}

function fitBezier(u: number[], p: number[], overshoot: number): EasingDescriptor {
	const problem: FitProblem = {
		dimension: 4,
		clamp: (params) => {
			params[0] = Math.max(0, Math.min(1, params[0]));
			params[2] = Math.max(0, Math.min(1, params[2]));
		},
		residuals: (params) => p.map((value, index) => cubicBezierAt(u[index], params[0], params[1], params[2], params[3]) - value),
	};
	// Deterministic seed grid: fast/medium/slow × flat/overshooting handles.
	const seeds: Array<[number, number, number, number]> = [
		[0.25, 0.1, 0.25, 1],
		[0.42, 0, 0.58, 1],
		[0.22, 1, 0.36, 1],
		[0.33, 0, 0.66, 0.33],
	];
	let best: number[] | null = null;
	let bestCost = Infinity;
	for (const seed of seeds) {
		const fitted = levenbergMarquardt(problem, seed as unknown as number[]);
		const cost = problem.residuals(fitted).reduce((sum, r) => sum + r * r, 0);
		if (cost < bestCost) {
			bestCost = cost;
			best = fitted;
		}
	}
	const [x1, y1, x2, y2] = best!;
	const rmse = rmseOf(problem.residuals(best!));
	const expression =
		`(function(){var x1=${lit(x1)},y1=${lit(y1)},x2=${lit(x2)},y2=${lit(y2)};` +
		`var u=Math.max(0,Math.min(1,t));` +
		`for(var i=0;i<8;i++){var xu=3*(1-u)*(1-u)*u*x1+3*(1-u)*u*u*x2+u*u*u;` +
		`var dx=3*(1-u)*(1-u)*x1+6*(1-u)*u*(x2-x1)+3*u*u*(1-x2);` +
		`if(Math.abs(xu-t)<1e-5)break;if(Math.abs(dx)<1e-9)break;u=u-(xu-t)/dx;` +
		`u=Math.max(0,Math.min(1,u));}` +
		`return 3*(1-u)*(1-u)*u*y1+3*(1-u)*u*u*y2+u*u*u;})`;
	return {
		kind: "bezier",
		points: [
			Number(x1.toFixed(4)),
			Number(y1.toFixed(4)),
			Number(x2.toFixed(4)),
			Number(y2.toFixed(4)),
		],
		easing: "Custom",
		expression,
		rmse: Number(rmse.toFixed(6)),
		overshoot: Number(Math.max(0, overshoot - 1).toFixed(4)),
	};
}

/**
 * Deterministic spring seed from the trajectory's own peaks: the spacing of
 * successive overshoot peaks gives the damped frequency ωd, and their log
 * decrement gives ζ — the classic two-point estimate, refined by LM.
 */
function estimateSpringSeed(u: number[], p: number[]): [number, number] | null {
	const peaks: Array<{ u: number; p: number }> = [];
	for (let index = 1; index < p.length - 1; index++) {
		if (p[index] > 1.001 && p[index] >= p[index - 1] && p[index] >= p[index + 1]) {
			if (peaks.length && u[index] - peaks[peaks.length - 1].u < 1e-6) continue;
			peaks.push({ u: u[index], p: p[index] });
		}
	}
	if (!peaks.length) return null;
	let omegaD: number;
	if (peaks.length >= 2) {
		omegaD = (2 * Math.PI) / (peaks[1].u - peaks[0].u);
	} else {
		// First overshoot peak lands near the half period of the damped wave.
		omegaD = Math.PI / Math.max(peaks[0].u, 1e-3);
	}
	let zeta: number;
	if (peaks.length >= 2 && peaks[1].p > 1 && peaks[0].p > 1) {
		const decrement = Math.log((peaks[0].p - 1) / (peaks[1].p - 1));
		zeta = decrement / Math.sqrt(4 * Math.PI * Math.PI + decrement * decrement);
	} else {
		// Single peak: overshoot Os = exp(-ζπ/√(1-ζ²)) inverted numerically.
		const os = Math.max(1.005, peaks[0].p);
		zeta = Math.min(0.9, Math.max(0.05, Math.sqrt(Math.log(os) ** 2 / (Math.PI ** 2 + Math.log(os) ** 2))));
	}
	zeta = Math.max(0.05, Math.min(0.95, zeta));
	omegaD = Math.max(0.5, Math.min(40, omegaD));
	const omega = Math.max(0.5, Math.min(40, omegaD / Math.sqrt(1 - zeta * zeta)));
	return [zeta, omega];
}

function fitSpring(u: number[], p: number[], overshoot: number): EasingDescriptor {
	// The fit carries an amplitude term: a trajectory still ringing at its last
	// sample is endpoint-normalized (p(1) pinned to 1) which scales the whole
	// response by 1/|response(u=1)|, so the model needs that freedom to reach
	// RMSE < 0.01 instead of fighting a systematic tail error.
	const problem: FitProblem = {
		dimension: 3,
		clamp: (params) => {
			// zeta ∈ (0.05, 0.95) keeps the response under-damped; ω ∈ (0.5, 40)/s;
			// amplitude ∈ (0.7, 1.3) absorbs endpoint normalization.
			params[0] = Math.max(0.05, Math.min(0.95, params[0]));
			params[1] = Math.max(0.5, Math.min(40, params[1]));
			params[2] = Math.max(0.7, Math.min(1.3, params[2]));
		},
		residuals: (params) => p.map((value, index) => params[2] * springAt(u[index], params[0], params[1]) - value),
	};
	const measured = estimateSpringSeed(u, p);
	const seeds: Array<[number, number, number]> = [
		...(measured ? [[measured[0], measured[1], 1] as [number, number, number]] : []),
		[0.3, 6, 1],
		[0.5, 10, 1],
		[0.2, 14, 1],
		[0.7, 8, 1],
	];
	let best: number[] | null = null;
	let bestCost = Infinity;
	for (const seed of seeds) {
		const fitted = levenbergMarquardt(problem, seed as unknown as number[]);
		const cost = problem.residuals(fitted).reduce((sum, r) => sum + r * r, 0);
		if (cost < bestCost) {
			bestCost = cost;
			best = fitted;
		}
	}
	const [zeta, omega, amplitude] = best!;
	const rmse = rmseOf(problem.residuals(best!));
	// `amplitude` records the endpoint-normalization scale: ~1 for a settled
	// track, ~1/|response(u=1)| for one that ends mid-ring. Callers can use it
	// to tell "the clip cuts before rest" from "the data is not a pure spring".
	// Cavalry's spring behavior takes stiffness/damping/mass; with mass = 1,
	// k = ω² and c = 2ζω. The descriptor also carries ζ/ω so a refinement
	// pass can retune without re-fitting.
	const mass = 1;
	const stiffness = Number((omega * omega).toFixed(3));
	const damping = Number((2 * zeta * omega).toFixed(3));
	const expression =
		`(function(){var z=${lit(zeta)},w=${lit(omega)},wd=w*Math.sqrt(1-z*z);` +
		`var u=Math.max(0,Math.min(1,t));` +
		`return 1-Math.exp(-z*w*u)*(Math.cos(wd*u)+(z*w/wd)*Math.sin(wd*u));})`;
	return {
		kind: "spring",
		stiffness,
		damping,
		mass,
		easing: "Custom",
		expression,
		dampingRatio: Number(zeta.toFixed(4)),
		naturalFrequency: Number(omega.toFixed(4)),
		amplitude: Number(amplitude.toFixed(4)),
		rmse: Number(rmse.toFixed(6)),
		overshoot: Number(Math.max(0, overshoot - 1).toFixed(4)),
	};
}

/**
 * Fit one attribute trajectory to a descriptor, or null when the motion is
 * too short/flat to carry an easing.
 */
export function fitEasingFromTrack(
	track: { frames: number[]; values: number[] },
): EasingDescriptor | null {
	if (!track || !Array.isArray(track.frames) || track.frames.length !== (track.values?.length ?? 0)) return null;
	const samples = track.frames.map((t, index) => ({ t, y: track.values[index] }));
	return fitEasing(samples);
}
