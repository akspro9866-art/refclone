/**
 * Stage 2 → Stage 3 procedural promotion regularisation
 * (`src/promotion/r2-evaluator.mjs`).
 *
 * An R-squared curve-fitting evaluator sits BETWEEN the Stage 2 kinematic
 * tracking trajectories and Stage 3 Procedural Promotion: every tracked
 * trajectory is fitted against the candidate procedural models (constant
 * value, damped spring/oscillator, noise) and only trajectories whose fit
 * clears the R² threshold are promoted into NATIVE Cavalry behaviour nodes.
 * Trajectories whose residual error exceeds the threshold fall back to sparse
 * Bézier keyframes instead of a behaviour — a badly-fitted spring reproduces
 * the motion worse than the measured points do.
 *
 * Deterministic: pure math, no random search, stable tie-breaking.
 */

export const DEFAULT_R2_THRESHOLD = 0.92;

/** Ordinary least squares for y = a·x + b; returns {a, b, r2}. */
export function linearFit(samples) {
	const n = samples.length;
	if (n < 2) return { a: 0, b: n ? samples[0].y : 0, r2: n ? 1 : 0 };
	let sx = 0, sy = 0, sxx = 0, sxy = 0;
	for (const { x, y } of samples) {
		sx += x; sy += y; sxx += x * x; sxy += x * y;
	}
	const denominator = n * sxx - sx * sx;
	if (Math.abs(denominator) < 1e-12) {
		const mean = sy / n;
		return { a: 0, b: mean, r2: 1 };
	}
	const a = (n * sxy - sx * sy) / denominator;
	const b = (sy - a * sx) / n;
	return { a, b, r2: rSquared(samples, (x) => a * x + b) };
}

/** R² = 1 − SS_res / SS_tot over fitted predictions. */
export function rSquared(samples, predict) {
	const n = samples.length;
	if (!n) return 0;
	let mean = 0;
	for (const { y } of samples) mean += y;
	mean /= n;
	let ssRes = 0, ssTot = 0;
	for (const { x, y } of samples) {
		const predicted = predict(x);
		ssRes += (y - predicted) ** 2;
		ssTot += (y - mean) ** 2;
	}
	if (ssTot < 1e-12) return 1; // constant signal: any exact model fits perfectly
	return Math.max(0, Math.min(1, 1 - ssRes / ssTot));
}

/** Root-mean-square residual of the fit, in the trajectory's own units. */
export function residualRmse(samples, predict) {
	if (!samples.length) return 0;
	let sum = 0;
	for (const { x, y } of samples) sum += (y - predict(x)) ** 2;
	return Math.sqrt(sum / samples.length);
}

/**
 * Damped-oscillation fit: y(t) = rest + e^(−ζω0 t)·(A·cos(ωd t) + B·sin(ωd t))
 * with ωd = ω0·sqrt(1−ζ²). For each (ζ, ω0) on a fixed grid the remaining
 * unknowns (A, B, rest) are solved in closed form by linear least squares on
 * the basis [e^(−ζω0 t)·cos, e^(−ζω0 t)·sin, 1]. Best (ζ, ω0) by R² wins.
 */
export function dampedOscillationFit(samples, { zetaSteps = 24, omegaSteps = 40 } = {}) {
	if (samples.length < 5) return { r2: 0, predict: () => NaN, zeta: 0, omega0: NaN };
	const tMax = samples[samples.length - 1].x - samples[0].x;
	if (!(tMax > 0)) return { r2: 0, predict: () => NaN, zeta: 0, omega0: NaN };
	const omegaMax = Math.PI; // rad per frame — the Nyquist-safe ceiling
	let best = null;
	for (let zi = 1; zi <= zetaSteps; zi++) {
		const zeta = (zi / zetaSteps) * 1.2; // 0.1 .. 1.2
		for (let oi = 1; oi <= omegaSteps; oi++) {
			const omega0 = (oi / omegaSteps) * omegaMax;
			const omegaD = omega0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
			const fit = solveLinearBasis(samples, (t) => {
				const decay = Math.exp(-zeta * omega0 * t);
				return [decay * Math.cos(omegaD * t), decay * Math.sin(omegaD * t), 1];
			});
			if (!fit) continue;
			const predict = (t) => {
				const decay = Math.exp(-zeta * omega0 * t);
				return decay * (fit.coeffs[0] * Math.cos(omegaD * t) + fit.coeffs[1] * Math.sin(omegaD * t)) + fit.coeffs[2];
			};
			const r2 = rSquared(samples, predict);
			if (!best || r2 > best.r2 + 1e-12 || (Math.abs(r2 - best.r2) <= 1e-12 && omega0 < best.omega0)) {
				best = { r2, predict, zeta, omega0, amplitude: Math.hypot(fit.coeffs[0], fit.coeffs[1]), rest: fit.coeffs[2] };
			}
		}
	}
	return best ?? { r2: 0, predict: () => NaN, zeta: 0, omega0: NaN };
}

/** Solve least squares for y ≈ Σ coeffs[i]·basis[i](t) + no intercept (basis provides it). */
function solveLinearBasis(samples, basis) {
	const dims = basis(samples[0].x).length;
	const normal = Array.from({ length: dims }, () => new Array(dims).fill(0));
	const rhs = new Array(dims).fill(0);
	for (const { x, y } of samples) {
		const row = basis(x);
		for (let i = 0; i < dims; i++) {
			rhs[i] += row[i] * y;
			for (let j = 0; j < dims; j++) normal[i][j] += row[i] * row[j];
		}
	}
	const coeffs = gaussianSolve(normal, rhs);
	if (!coeffs) return null;
	return { coeffs };
}

/** Gaussian elimination with partial pivoting; null when singular. */
function gaussianSolve(matrix, rhs) {
	const n = rhs.length;
	const a = matrix.map((row, i) => [...row, rhs[i]]);
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let row = col + 1; row < n; row++) {
			if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
		}
		if (Math.abs(a[pivot][col]) < 1e-10) return null;
		[a[col], a[pivot]] = [a[pivot], a[col]];
		for (let row = 0; row < n; row++) {
			if (row === col) continue;
			const factor = a[row][col] / a[col][col];
			for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
		}
	}
	return a.map((row, i) => row[n] / row[i]);
}

/** Sample standard deviation of the y values (noise-amplitude estimate). */
function stdDev(samples) {
	if (samples.length < 2) return 0;
	let mean = 0;
	for (const { y } of samples) mean += y;
	mean /= samples.length;
	let sum = 0;
	for (const { y } of samples) sum += (y - mean) ** 2;
	return Math.sqrt(sum / (samples.length - 1));
}

/** Count sign changes of the first difference (oscillation evidence). */
function signChanges(samples) {
	let changes = 0;
	let lastNonZero = 0;
	for (let i = 1; i < samples.length; i++) {
		const delta = samples[i].y - samples[i - 1].y;
		if (Math.abs(delta) < 1e-9) continue;
		const sign = Math.sign(delta);
		if (lastNonZero !== 0 && sign !== lastNonZero) changes += 1;
		lastNonZero = sign;
	}
	return changes;
}

/**
 * Evaluate one Stage 2 trajectory (a series of {frame, value} samples) and
 * decide the procedural promotion.
 *
 * @param {Array<{frame:number, value:number}>} samples
 * @param {object} [options]
 * @param {number} [options.threshold=0.92]  R² promotion threshold
 * @param {number} [options.fps=60]          only used for Hz reporting
 * @returns {{
 *   promoted: boolean, behaviour: 'spring'|'oscillator'|'noise'|'value'|'bezier-keyframes',
 *   r2: number, rmse: number, threshold: number, params: object, reason: string
 * }}
 */
export function evaluateTrajectoryFit(samples, options = {}) {
	const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_R2_THRESHOLD;
	const fps = Number.isFinite(options.fps) && options.fps > 0 ? options.fps : 60;
	const points = (Array.isArray(samples) ? samples : [])
		.map((entry) => ({ x: Math.round(Number(entry.frame)), y: Number(entry.value) }))
		.filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))
		.sort((a, b) => a.x - b.x || a.y - b.y);
	const clean = points.filter((p, i, all) => i === 0 || p.x !== all[i - 1].x);
	if (clean.length < 3) {
		return {
			promoted: false, behaviour: 'bezier-keyframes', r2: clean.length ? 1 : 0, rmse: 0,
			threshold, params: {}, reason: 'too few samples for a stable fit — sparse keyframes',
		};
	}

	const mean = clean.reduce((sum, p) => sum + p.y, 0) / clean.length;
	const variance = clean.reduce((sum, p) => sum + (p.y - mean) ** 2, 0) / clean.length;
	const oscillations = signChanges(clean);

	// Constant trajectory: promote to a Value behaviour holding the mean.
	if (variance < 1e-9) {
		return {
			promoted: true, behaviour: 'value', r2: 1, rmse: 0, threshold,
			params: { value: Math.round(mean * 10000) / 10000 },
			reason: 'constant trajectory — native Value behaviour',
		};
	}

	// Oscillating trajectory: fit the damped model; promote when the fit clears
	// the threshold. zeta < 1 (under-damped) is a spring; the critically/over-
	// damped boundary still promotes but as a slower oscillator at the same
	// natural frequency.
	if (oscillations >= 2) {
		const fit = dampedOscillationFit(clean);
		const predict = fit.predict;
		const r2 = fit.r2;
		const rmse = residualRmse(clean, predict);
		if (r2 >= threshold) {
			const omega0 = fit.omega0;
			const stiffness = Math.round(omega0 * omega0 * 10000) / 10000; // mass = 1
			const damping = Math.round(2 * fit.zeta * omega0 * 10000) / 10000;
			const behaviour = fit.zeta < 0.75 ? 'spring' : 'oscillator';
			const params = behaviour === 'spring'
				? {
					stiffness,
					damping,
					dampingRatio: Math.round(fit.zeta * 10000) / 10000,
					naturalFrequency: Math.round((omega0 / (2 * Math.PI)) * fps * 10000) / 10000,
					restValue: Math.round(fit.rest * 10000) / 10000,
				}
				: {
					frequencyHz: Math.round((omega0 / (2 * Math.PI)) * fps * 10000) / 10000,
					amplitude: Math.round(fit.amplitude * 10000) / 10000,
					decay: Math.round(fit.zeta * omega0 * 10000) / 10000,
					restValue: Math.round(fit.rest * 10000) / 10000,
				};
			return { promoted: true, behaviour, r2: Math.round(r2 * 10000) / 10000, rmse: Math.round(rmse * 10000) / 10000, threshold, params, reason: `damped-oscillation fit R²=${Math.round(r2 * 10000) / 10000} ≥ ${threshold}` };
		}
		// Oscillating but badly fitted: noise behaviour only when the residual
		// spread looks noise-like; otherwise sparse Bézier keyframes.
		const spread = stdDev(clean);
		if (r2 < threshold * 0.7 && spread > 1e-9) {
			return {
				promoted: true, behaviour: 'noise', r2: Math.round(r2 * 10000) / 10000, rmse: Math.round(rmse * 10000) / 10000, threshold,
				params: { amplitude: Math.round(spread * 10000) / 10000, frequencyHz: 2, seed: 1 },
				reason: 'irregular oscillation — Noise behaviour reproduces the spread',
			};
		}
		return {
			promoted: false, behaviour: 'bezier-keyframes', r2: Math.round(r2 * 10000) / 10000, rmse: Math.round(rmse * 10000) / 10000, threshold,
			params: {}, reason: `oscillation fit below threshold (${Math.round(r2 * 10000) / 10000} < ${threshold}) — sparse Bézier keyframes`,
		};
	}

	// Smooth non-oscillating motion: a linear fit is the cheap candidate; the
	// damped model with a near-critical ζ covers eased moves.
	const linear = linearFit(clean);
	const eased = dampedOscillationFit(clean, { zetaSteps: 24, omegaSteps: 40 });
	const bestFit = eased.r2 >= linear.r2 ? eased : linear;
	const r2 = bestFit.r2;
	const rmse = residualRmse(clean, bestFit.predict ?? (() => NaN));
	if (r2 >= threshold) {
		if (bestFit === linear) {
			return {
				promoted: true, behaviour: 'value', r2: Math.round(r2 * 10000) / 10000, rmse: Math.round(rmse * 10000) / 10000, threshold,
				params: { slope: Math.round(linear.a * 10000) / 10000, intercept: Math.round(linear.b * 10000) / 10000 },
				reason: `linear trajectory — Value behaviour with per-frame drift`,
			};
		}
		return {
			promoted: true, behaviour: 'spring', r2: Math.round(r2 * 10000) / 10000, rmse: Math.round(rmse * 10000) / 10000, threshold,
			params: {
				stiffness: Math.round(bestFit.omega0 * bestFit.omega0 * 10000) / 10000,
				damping: Math.round(2 * bestFit.zeta * bestFit.omega0 * 10000) / 10000,
				dampingRatio: Math.round(bestFit.zeta * 10000) / 10000,
				restValue: Math.round(bestFit.rest * 10000) / 10000,
			},
			reason: `critically damped approach fit R²=${Math.round(r2 * 10000) / 10000} ≥ ${threshold}`,
		};
	}
	return {
		promoted: false, behaviour: 'bezier-keyframes', r2: Math.round(r2 * 10000) / 10000, rmse: Math.round(rmse * 10000) / 10000, threshold,
		params: {}, reason: `smooth fit below threshold (${Math.round(r2 * 10000) / 10000} < ${threshold}) — sparse Bézier keyframes`,
	};
}

/**
 * Convenience wrapper for Stage 2 `ElementTrack`s: evaluates the centre-x and
 * centre-y trajectories independently and promotes each axis.
 */
export function evaluateTrackPromotion(track, options = {}) {
	const axes = {};
	for (const axis of ['x', 'y']) {
		const samples = (track.points ?? [])
			.map((point) => {
				const bbox = point.bbox ?? {};
				const width = Number(bbox.width ?? 0);
				const height = Number(bbox.height ?? 0);
				const value = axis === 'x'
					? Number(bbox.x ?? 0) + width / 2
					: Number(bbox.y ?? 0) + height / 2;
				return { frame: Number(point.frame), value };
			});
		axes[axis] = evaluateTrajectoryFit(samples, options);
	}
	return {
		elementId: track.elementId,
		axes,
		promoted: axes.x.promoted && axes.y.promoted,
		behaviours: { x: axes.x.behaviour, y: axes.y.behaviour },
	};
}
