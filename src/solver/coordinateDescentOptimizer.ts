/**
 * Headless numerical refinement — zero LLM tokens.
 *
 * Coordinate descent over the active rig's tunable numbers
 * (staggerOffset, springStiffness, blurAmount, fontSize, cornerRadius, …).
 * The composite loss is
 *
 *     L = 0.6·(1 − IoU_bbox) + 0.4·(1 − SSIM_keyframes)
 *
 * evaluated by a caller-supplied `evaluate` callback (the pipeline wires it
 * to stallion's `/batch-step` plus the pixel metrics; tests wire it to a
 * synthetic function, which keeps this module deterministic and fast).
 *
 * Termination: the composite score reaches `threshold` (default 0.96, i.e.
 * loss ≤ 0.04) or `maxIterations` (default 12) full sweeps are done. Every
 * candidate is a real evaluation — nothing here extrapolates or guesses.
 */

export interface TunableParam {
	name: string;
	value: number;
	/** Initial probe step in parameter units (default |value|·0.1 or 1). */
	step?: number;
	/** Search bounds. */
	min?: number;
	max?: number;
	/** Round accepted values to this many decimals (default 2). */
	precision?: number;
}

export interface Evaluation {
	iou: number;
	ssim: number;
}

export interface OptimizationStep {
	sweep: number;
	param: string;
	from: number;
	to: number;
	lossBefore: number;
	lossAfter: number;
	accepted: boolean;
}

export interface OptimizationResult {
	params: Record<string, number>;
	bestLoss: number;
	bestScore: number;
	steps: OptimizationStep[];
	sweeps: number;
	stopReason: "converged" | "max-iterations" | "no-improvement";
	evaluations: number;
}

export const LOSS_WEIGHTS = { iou: 0.6, ssim: 0.4 } as const;

/** Composite loss from the two perceptual/geometry scores. */
export function compositeLoss(evaluation: Evaluation): number {
	const iou = Math.max(0, Math.min(1, evaluation.iou));
	const ssim = Math.max(0, Math.min(1, evaluation.ssim));
	return LOSS_WEIGHTS.iou * (1 - iou) + LOSS_WEIGHTS.ssim * (1 - ssim);
}

export interface CoordinateDescentOptions {
	/** Convergence threshold on the composite score (1 − loss). Default 0.96. */
	threshold?: number;
	/** Maximum full sweeps. Default 12. */
	maxIterations?: number;
	/** Step shrink factor when a sweep accepts nothing. Default 0.5. */
	shrink?: number;
	/** Minimum step below which a parameter stops being probed. Default 1e-3·|v|. */
	minStep?: number;
}

/**
 * Bounded coordinate descent. Each sweep probes every parameter once with
 * +step and −step (two evaluations each), keeps the best accepted move, and
 * the step halves after any sweep that accepted nothing. Deterministic:
 * parameters are probed in declaration order with identical probe offsets.
 */
export function optimizeCoordinateDescent(
	parameters: TunableParam[],
	evaluate: (params: Record<string, number>) => Promise<Evaluation> | Evaluation,
	options: CoordinateDescentOptions = {},
): Promise<OptimizationResult> {
	const threshold = options.threshold ?? 0.96;
	const maxIterations = options.maxIterations ?? 12;
	const shrink = options.shrink ?? 0.5;
	const minStep = options.minStep ?? 1e-3;

	const values = new Map<string, { value: number; step: number; min: number; max: number; precision: number }>();
	for (const parameter of parameters) {
		const value = Number(parameter.value);
		const magnitude = Math.abs(value) > 0 ? Math.abs(value) : 1;
		values.set(parameter.name, {
			value,
			step: parameter.step ?? magnitude * 0.1,
			min: parameter.min ?? -Infinity,
			max: parameter.max ?? Infinity,
			precision: parameter.precision ?? 2,
		});
	}

	const snapshot = (): Record<string, number> => {
		const out: Record<string, number> = {};
		for (const [name, entry] of values) {
			const factor = 10 ** entry.precision;
			out[name] = Math.round(entry.value * factor) / factor;
		}
		return out;
	};

	const clamp = (name: string, value: number): number => {
		const entry = values.get(name)!;
		return Math.max(entry.min, Math.min(entry.max, value));
	};

	return (async () => {
		const steps: OptimizationStep[] = [];
		let evaluations = 0;
		const current = snapshot();
		let bestLoss = compositeLoss(await evaluate(current));
		evaluations += 1;
		let bestParams = current;
		let stopReason: OptimizationResult["stopReason"] = "max-iterations";
		let sweeps = 0;

		for (let sweep = 1; sweep <= maxIterations; sweep++) {
			sweeps = sweep;
			if (1 - bestLoss >= threshold) {
				stopReason = "converged";
				break;
			}
			let acceptedThisSweep = 0;
			for (const [name, entry] of values) {
				if (entry.step < Math.max(minStep, Math.abs(entry.value) * minStep)) continue;
				const lossBefore = bestLoss;
				let bestCandidate: number | null = null;
				let bestCandidateLoss = bestLoss;
				for (const direction of [1, -1] as const) {
					const trialValue = clamp(name, entry.value + direction * entry.step);
					if (trialValue === entry.value) continue;
					const trial = snapshot();
					trial[name] = Number(trialValue.toFixed(entry.precision));
					const loss = compositeLoss(await evaluate(trial));
					evaluations += 1;
					if (loss < bestCandidateLoss) {
						bestCandidateLoss = loss;
						bestCandidate = trial[name];
					}
				}
				if (bestCandidate !== null) {
					const from = entry.value;
					entry.value = bestCandidate;
					bestLoss = bestCandidateLoss;
					bestParams = snapshot();
					acceptedThisSweep += 1;
					// Adaptive step: accepted moves double the probe (pattern-search
					// acceleration), so a parameter far from its optimum crosses the
					// basin within the bounded sweep budget instead of creeping.
					entry.step = Math.min(entry.step * 2, Math.max((entry.max - entry.min) / 4 || Infinity, entry.step));
					steps.push({ sweep, param: name, from: Number(from.toFixed(4)), to: bestCandidate, lossBefore, lossAfter: bestLoss, accepted: true });
				} else {
					steps.push({ sweep, param: name, from: entry.value, to: entry.value, lossBefore, lossAfter: bestLoss, accepted: false });
					entry.step *= shrink;
				}
			}
			if (acceptedThisSweep === 0) {
				// Every parameter refused both directions twice in a row means the
				// basin is flat at this resolution — stop rather than burn sweeps.
				const flat = steps.filter((step) => step.sweep >= sweep - 1 && !step.accepted).length;
				if (flat === values.size) {
					stopReason = "no-improvement";
					break;
				}
			}
		}
		if (1 - bestLoss >= threshold) stopReason = "converged";
		return {
			params: bestParams,
			bestLoss: Number(bestLoss.toFixed(6)),
			bestScore: Number((1 - bestLoss).toFixed(6)),
			steps,
			sweeps,
			stopReason,
			evaluations,
		};
	})();
}
