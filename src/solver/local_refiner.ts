/**
 * Stage 4.5 — deterministic local parameter refiner. ZERO LLM tokens.
 *
 * Sits between Stage 4 (`_mg` compilation, whose sampled geometry is the
 * starting point) and Stage 5 (perceptual diffing, which is expensive and
 * therefore runs ONLY after this solver converges). The LLM is removed from
 * the numeric loop entirely: the refiner reads actual Cavalry bounding boxes
 * through stallion's `/batch_inspect` (geometry-only, one round trip per
 * candidate batch), computes the L2 kinematic loss
 *
 *     L_bbox = Σ_f ( ||c_ref(f) − c_cav(f)||² + λ·||s_ref(f) − s_cav(f)||² )
 *
 * (c = box centroid, s = box size, λ weights scale against position) and
 * drives the rig's numeric parameters — anchor offsets, position.x/y,
 * scale.x/y, keyframe timing offsets Δt, spring stiffness/damping — with two
 * deterministic local searches:
 *
 *   1. bounded coordinate descent (pattern search: ±step probes, accepted
 *      moves double the step, refused sweeps halve it), then
 *   2. a Nelder-Mead simplex pass when descent stalls on ≤ 8 dimensions —
 *      it escapes shallow valleys coordinate descent cannot.
 *
 * Convergence is the SPEC gate, not a heuristic: every measured frame must
 * sit within `epsPos` (default 1.5 px) and the box sizes within `epsScale`
 * (default 2%) of the reference tracks. Every candidate evaluation is a real
 * bridge measurement — nothing here extrapolates, renders pixels, or calls a
 * model. `llmTokens` is reported (and asserted by tests) as 0.
 */

import { WorkflowError } from '../core.mjs';

export const LOCAL_REFINER_VERSION = '1.0.0';

export const LOCAL_REFINER_DEFAULTS = Object.freeze({
	/** Positional tolerance, px (centroid per axis, per frame). */
	epsPos: 1.5,
	/** Scale tolerance, fraction of the reference size per axis, per frame. */
	epsScale: 0.02,
	/** Scale-term weight in the L2 loss. */
	lambda: 1,
	/** Maximum full coordinate-descent sweeps. */
	maxSweeps: 24,
	/** Maximum Nelder-Mead iterations after a descent stall. */
	maxSimplexIterations: 120,
	/** Step shrink per refused sweep. */
	shrink: 0.5,
	/** Minimum step (parameter units) below which a parameter stops moving. */
	minStep: 0.01,
});

const fail = (code, message, details = {}) => {
	throw new WorkflowError(code, message, details);
};

const round4 = (value) => Math.round(value * 10000) / 10000;

// ---------------------------------------------------------------------------
// Loss geometry
// ---------------------------------------------------------------------------

export interface RefinedBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BboxMeasurement {
	cx: number;
	cy: number;
	w: number;
	h: number;
}

/** Extract the {cx, cy, w, h} measurement from an inspect bbox (short form) or a tracked reference box. */
export function toMeasurement(box: { cx?: number; cy?: number; w?: number; h?: number; x?: number; y?: number; width?: number; height?: number } | null | undefined): BboxMeasurement | null {
	if (!box || typeof box !== 'object') return null;
	const cx = Number(box.cx ?? (box.x !== undefined ? Number(box.x) + Number(box.width ?? box.w ?? 0) / 2 : NaN));
	const cy = Number(box.cy ?? (box.y !== undefined ? Number(box.y) + Number(box.height ?? box.h ?? 0) / 2 : NaN));
	const w = Number(box.w ?? box.width);
	const h = Number(box.h ?? box.height);
	if (![cx, cy, w, h].every((value) => Number.isFinite(value))) return null;
	return { cx, cy, w, h };
}

/**
 * The L2 kinematic loss between reference and actual boxes over matched
 * frames. Missing measurements on either side skip the frame (reported, not
 * guessed); the loss stays comparable across evaluations because the matched
 * frame set is fixed per refinement run.
 */
export function bboxL2Loss(
	reference: Map<number, BboxMeasurement>,
	actual: Map<number, BboxMeasurement>,
	lambda: number,
): { loss: number; frames: number; maxPosError: number; maxScaleError: number; perFrame: Array<{ frame: number; posError: number; scaleError: number }> } {
	let loss = 0;
	let frames = 0;
	let maxPosError = 0;
	let maxScaleError = 0;
	const perFrame: Array<{ frame: number; posError: number; scaleError: number }> = [];
	for (const [frame, ref] of reference) {
		const cav = actual.get(frame);
		if (!cav) continue;
		const dx = ref.cx - cav.cx;
		const dy = ref.cy - cav.cy;
		const dw = ref.w - cav.w;
		const dh = ref.h - cav.h;
		const posError = Math.sqrt(dx * dx + dy * dy);
		const refSize = Math.hypot(ref.w, ref.h) || 1;
		const scaleError = Math.sqrt(dw * dw + dh * dh) / refSize;
		loss += dx * dx + dy * dy + lambda * (dw * dw + dh * dh);
		frames++;
		if (posError > maxPosError) maxPosError = posError;
		if (scaleError > maxScaleError) maxScaleError = scaleError;
		perFrame.push({ frame, posError: round4(posError), scaleError: round4(scaleError) });
	}
	return { loss, frames, maxPosError: round4(maxPosError), maxScaleError: round4(maxScaleError), perFrame };
}

/** The spec's convergence gate: every frame within epsPos and epsScale. */
export function withinTolerance(perFrame: Array<{ posError: number; scaleError: number }>, epsPos: number, epsScale: number): boolean {
	return perFrame.length > 0 && perFrame.every((entry) => entry.posError <= epsPos && entry.scaleError <= epsScale);
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export interface RefinerParam {
	/** Rig knob name, e.g. "card.position.x" or "title.spring.stiffness". */
	name: string;
	value: number;
	/** Probe step in parameter units (default |value|·0.25 or 1). */
	step?: number;
	min?: number;
	max?: number;
	/** Decimals kept on accepted values (default 2). */
	precision?: number;
}

interface ParamState {
	value: number;
	step: number;
	min: number;
	max: number;
	precision: number;
}

function initialState(parameters: RefinerParam[]): Map<string, ParamState> {
	const map = new Map<string, ParamState>();
	for (const parameter of parameters) {
		const value = Number(parameter.value);
		if (!Number.isFinite(value)) fail('REFINER_PARAM_INVALID', `parameter ${parameter.name} is not finite.`, { name: parameter.name });
		const magnitude = Math.abs(value) > 0 ? Math.abs(value) : 1;
		map.set(parameter.name, {
			value,
			step: Number.isFinite(Number(parameter.step)) && Number(parameter.step) > 0 ? Number(parameter.step) : magnitude * 0.25,
			min: Number.isFinite(Number(parameter.min)) ? Number(parameter.min) : -Infinity,
			max: Number.isFinite(Number(parameter.max)) ? Number(parameter.max) : Infinity,
			precision: Number.isInteger(parameter.precision) && parameter.precision! >= 0 ? parameter.precision! : 2,
		});
	}
	return map;
}

function snapshot(state: Map<string, ParamState>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [name, entry] of state) {
		const factor = 10 ** entry.precision;
		out[name] = Math.round(entry.value * factor) / factor;
	}
	return out;
}

function clampParam(entry: ParamState, value: number): number {
	return Math.max(entry.min, Math.min(entry.max, value));
}

// ---------------------------------------------------------------------------
// The refiner
// ---------------------------------------------------------------------------

export interface LocalRefinerOptions {
	/** Ready stallion client (createStallionClient). */
	client: { batchInspect: (request: Record<string, unknown>) => Promise<Record<string, unknown>>; batchStep?: (request: Record<string, unknown>) => Promise<Record<string, unknown>> };
	/** Layer ids measured on every evaluation. */
	layerIds: string[];
	/** The beat frames the loss is evaluated at: [f_start, f_mid1, f_mid2, f_end]. */
	beatFrames: number[];
	/** Reference tracked boxes keyed by layerId then frame. */
	referenceBoxes: Record<string, Record<number, { x: number; y: number; width: number; height: number } | { cx: number; cy: number; w: number; h: number }>>;
	/** Numeric rig knobs the solver may move. */
	parameters: RefinerParam[];
	/**
	 * Applies one parameter vector to the live rig (a `/batch-step` set-op, a
	 * timing patch, …) and returns true when the bridge accepted it. Omitting
	 * it is legal for pure solvers in tests — then the caller's evaluate hook
	 * must apply the parameters itself.
	 */
	applyParams?: (params: Record<string, number>) => Promise<boolean> | boolean;
	/** Overrides for the defaults above. */
	options?: Partial<typeof LOCAL_REFINER_DEFAULTS>;
	/** Wall-clock budget for the whole refinement. */
	timeoutMs?: number;
}

export interface LocalRefinerResult {
	version: string;
	converged: boolean;
	stopReason: 'tolerance-met' | 'max-sweeps' | 'no-improvement' | 'timeout' | 'no-frames';
	initial: { loss: number; maxPosError: number; maxScaleError: number; frames: number };
	final: { loss: number; maxPosError: number; maxScaleError: number; frames: number; perFrame: Array<{ frame: number; posError: number; scaleError: number }> };
	params: Record<string, number>;
	sweeps: number;
	evaluations: number;
	solver: 'coordinate-descent' | 'coordinate-descent+nelder-mead';
	steps: Array<{ sweep: number | 'simplex'; param: string; from: number; to: number; lossBefore: number; lossAfter: number; accepted: boolean }>;
	/** Always 0 — this stage never talks to a model. */
	llmTokens: 0;
	durationMs: number;
}

/**
 * Run Stage 4.5. Every `evaluate` is one `applyParams` + one `batch_inspect`
 * round trip; the loss is computed against the fixed reference measurement
 * set captured at the start (reference boxes come from the caller's tracks,
 * not from the bridge, so a Cavalry-side drift cannot flatter the solver).
 */
export async function refineLocally(options: LocalRefinerOptions): Promise<LocalRefinerResult> {
	const startedAt = Date.now();
	const config = { ...LOCAL_REFINER_DEFAULTS, ...(options.options ?? {}) };
	const client = options.client;
	if (!client || typeof client.batchInspect !== 'function') {
		fail('REFINER_CLIENT_INVALID', 'refineLocally requires a stallion client with batchInspect().');
	}
	const layerIds = (options.layerIds ?? []).filter((id) => typeof id === 'string' && id);
	const beatFrames = [...new Set((options.beatFrames ?? []).map((frame) => Math.round(Number(frame))).filter((frame) => Number.isFinite(frame)))].sort((a, b) => a - b);
	if (!layerIds.length) fail('REFINER_INPUT_INVALID', 'refineLocally requires at least one layerId.');
	if (beatFrames.length < 2) fail('REFINER_INPUT_INVALID', 'refineLocally requires at least two beat frames (f_start, f_end).');

	// Fixed reference measurement set: {layerId: {frame: measurement}}.
	const reference = new Map<string, Map<number, BboxMeasurement>>();
	for (const [layerId, frameBoxes] of Object.entries(options.referenceBoxes ?? {})) {
		const perFrame = new Map<number, BboxMeasurement>();
		for (const [frameKey, box] of Object.entries(frameBoxes ?? {})) {
			const measurement = toMeasurement(box);
			if (measurement) perFrame.set(Math.round(Number(frameKey)), measurement);
		}
		if (perFrame.size) reference.set(layerId, perFrame);
	}
	if (!reference.size) fail('REFINER_INPUT_INVALID', 'refineLocally requires referenceBoxes for at least one layer.');

	const measure = async (): Promise<{ lossByLayer: Map<string, ReturnType<typeof bboxL2Loss>>; loss: number; maxPosError: number; maxScaleError: number; frames: number; perFrame: Array<{ frame: number; posError: number; scaleError: number }> }> => {
		const envelope = (await client.batchInspect({ frames: beatFrames, layerIds, attributes: ['position.x', 'position.y', 'scale.x', 'scale.y'] })) as {
			timeline?: Record<string, Record<string, { bbox?: Record<string, number> }>>;
		};
		const timeline = envelope?.timeline ?? {};
		const lossByLayer = new Map<string, ReturnType<typeof bboxL2Loss>>();
		let totalLoss = 0;
		let maxPosError = 0;
		let maxScaleError = 0;
		let frames = 0;
		const perFrame = new Map<number, { frame: number; posError: number; scaleError: number }>();
		for (const [layerId, refFrames] of reference) {
			const actual = new Map<number, BboxMeasurement>();
			for (const frame of beatFrames) {
				const measurement = toMeasurement(timeline[String(frame)]?.[layerId]?.bbox ?? null);
				if (measurement) actual.set(frame, measurement);
			}
			const layerLoss = bboxL2Loss(refFrames, actual, config.lambda);
			lossByLayer.set(layerId, layerLoss);
			totalLoss += layerLoss.loss;
			frames = Math.max(frames, layerLoss.frames);
			if (layerLoss.maxPosError > maxPosError) maxPosError = layerLoss.maxPosError;
			if (layerLoss.maxScaleError > maxScaleError) maxScaleError = layerLoss.maxScaleError;
			for (const entry of layerLoss.perFrame) {
				const existing = perFrame.get(entry.frame);
				if (!existing || entry.posError > existing.posError) perFrame.set(entry.frame, entry);
			}
		}
		return {
			lossByLayer,
			loss: totalLoss,
			maxPosError,
			maxScaleError,
			frames,
			perFrame: [...perFrame.values()].sort((a, b) => a.frame - b.frame),
		};
	};

	const evaluate = async (params: Record<string, number>): Promise<number> => {
		if (Date.now() - startedAt > (options.timeoutMs ?? 120_000)) {
			return Number.POSITIVE_INFINITY;
		}
		if (options.applyParams) {
			const accepted = await options.applyParams(params);
			if (!accepted) return Number.POSITIVE_INFINITY;
		}
		return (await measure()).loss;
	};

	const state = initialState(options.parameters ?? []);
	const initialMeasurement = await measure();
	if (initialMeasurement.frames === 0) {
		return {
			version: LOCAL_REFINER_VERSION,
			converged: false,
			stopReason: 'no-frames',
			initial: { loss: initialMeasurement.loss, maxPosError: initialMeasurement.maxPosError, maxScaleError: initialMeasurement.maxScaleError, frames: 0 },
			final: { loss: initialMeasurement.loss, maxPosError: initialMeasurement.maxPosError, maxScaleError: initialMeasurement.maxScaleError, frames: 0, perFrame: [] },
			params: snapshot(state),
			sweeps: 0,
			evaluations: 0,
			solver: 'coordinate-descent',
			steps: [],
			llmTokens: 0,
			durationMs: Date.now() - startedAt,
		};
	}

	let bestLoss = initialMeasurement.loss;
	let bestParams = snapshot(state);
	const steps: LocalRefinerResult['steps'] = [];
	let evaluations = 1;
	let sweeps = 0;
	let solver: LocalRefinerResult['solver'] = 'coordinate-descent';
	const timeoutMs = options.timeoutMs ?? 120_000;
	let outOfTime = false;

	// Already inside the gate? Say so and stop — no sweeps, no bridge churn.
	if (withinTolerance(initialMeasurement.perFrame, config.epsPos, config.epsScale)) {
		return {
			version: LOCAL_REFINER_VERSION,
			converged: true,
			stopReason: 'tolerance-met',
			initial: { loss: round4(initialMeasurement.loss), maxPosError: initialMeasurement.maxPosError, maxScaleError: initialMeasurement.maxScaleError, frames: initialMeasurement.frames },
			final: { loss: round4(initialMeasurement.loss), maxPosError: initialMeasurement.maxPosError, maxScaleError: initialMeasurement.maxScaleError, frames: initialMeasurement.frames, perFrame: initialMeasurement.perFrame },
			params: bestParams,
			sweeps: 0,
			evaluations,
			solver,
			steps: [],
			llmTokens: 0,
			durationMs: Date.now() - startedAt,
		};
	}

	// --- Phase 1: bounded coordinate descent (pattern search) -------------
	for (let sweep = 1; sweep <= config.maxSweeps; sweep++) {
		if (Date.now() - startedAt > timeoutMs) {
			outOfTime = true;
			break;
		}
		sweeps = sweep;
		let acceptedThisSweep = 0;
		for (const [name, entry] of state) {
			if (entry.step < config.minStep) continue;
			let bestCandidate: number | null = null;
			let bestCandidateLoss = bestLoss;
			for (const direction of [1, -1] as const) {
				const trialValue = clampParam(entry, entry.value + direction * entry.step);
				if (trialValue === entry.value) continue;
				const trial = snapshot(state);
				trial[name] = Number(trialValue.toFixed(entry.precision));
				const loss = await evaluate(trial);
				evaluations++;
				if (Number.isFinite(loss) && loss < bestCandidateLoss) {
					bestCandidateLoss = loss;
					bestCandidate = trial[name];
				}
			}
			if (bestCandidate !== null) {
				const from = entry.value;
				entry.value = bestCandidate;
				bestLoss = bestCandidateLoss;
				bestParams = snapshot(state);
				acceptedThisSweep++;
				entry.step = Math.min(entry.step * 2, Math.abs(entry.max - entry.min) / 4 || Infinity);
				steps.push({ sweep, param: name, from: round4(from), to: round4(bestCandidate), lossBefore: round4(bestCandidateLoss), lossAfter: round4(bestLoss), accepted: true });
			} else {
				entry.step *= config.shrink;
			}
		}
		if (acceptedThisSweep === 0) {
			const stuck = [...state.values()].every((entry) => entry.step < config.minStep);
			if (stuck) break;
		}
	}

	// --- Phase 2: Nelder-Mead on stall (≤ 8 dims keeps the simplex cheap) --
	let stalled = [...state.values()].every((entry) => entry.step < config.minStep);
	if (!outOfTime && stalled && state.size > 0 && state.size <= 8 && config.maxSimplexIterations > 0) {
		solver = 'coordinate-descent+nelder-mead';
		const names = [...state.keys()];
		const dimension = names.length;
		// Simplex vertices: the current best plus unit perturbations sized by
		// each parameter's last meaningful step (5% of span, min step).
		const spanOf = (name: string): number => {
			const entry = state.get(name)!;
			const span = Number.isFinite(entry.max) && Number.isFinite(entry.min) ? entry.max - entry.min : Math.abs(entry.value) || 1;
			return Math.max(span * 0.05, config.minStep);
		};
		const vertices: Array<{ params: Record<string, number>; loss: number }> = [{ params: { ...bestParams }, loss: bestLoss }];
		for (let vertex = 0; vertex < dimension; vertex++) {
			const params = { ...bestParams };
			params[names[vertex]] = Number((clampParam(state.get(names[vertex])!, params[names[vertex]] + spanOf(names[vertex]))).toFixed(state.get(names[vertex])!.precision));
			vertices.push({ params, loss: await evaluate(params) });
			evaluations++;
		}
		const reflect = (worst: Record<string, number>, centroid: Record<string, number>, factor: number): Record<string, number> => {
			const out: Record<string, number> = {};
			for (const name of names) {
				const entry = state.get(name)!;
				const value = centroid[name] + factor * (centroid[name] - worst[name]);
				out[name] = Number(clampParam(entry, value).toFixed(entry.precision));
			}
			return out;
		};
		for (let iteration = 0; iteration < config.maxSimplexIterations; iteration++) {
			if (Date.now() - startedAt > timeoutMs) {
				outOfTime = true;
				break;
			}
			vertices.sort((a, b) => a.loss - b.loss);
			if (vertices[0].loss < bestLoss) {
				bestLoss = vertices[0].loss;
				bestParams = { ...vertices[0].params };
				steps.push({ sweep: 'simplex', param: names.join('+'), from: round4(vertices[dimension].params[names[0]]), to: round4(vertices[0].params[names[0]]), lossBefore: round4(vertices[dimension].loss), lossAfter: round4(bestLoss), accepted: true });
			}
			// Convergence: the simplex has contracted onto one point.
			const spread = Math.max(...vertices.map((vertex) => vertex.loss)) - Math.min(...vertices.map((vertex) => vertex.loss));
			if (spread <= Math.max(1e-6, Math.abs(bestLoss) * 1e-6)) break;
			const centroid: Record<string, number> = {};
			for (const name of names) {
				centroid[name] = vertices.slice(0, dimension).reduce((sum, vertex) => sum + vertex.params[name], 0) / dimension;
			}
			const worst = vertices[dimension];
			const reflected = reflect(worst.params, centroid, 1);
			const reflectedLoss = await evaluate(reflected);
			evaluations++;
			if (reflectedLoss < vertices[0].loss) {
				const expanded = reflect(worst.params, centroid, 2);
				const expandedLoss = await evaluate(expanded);
				evaluations++;
				vertices[dimension] = expandedLoss < reflectedLoss ? { params: expanded, loss: expandedLoss } : { params: reflected, loss: reflectedLoss };
			} else if (reflectedLoss < worst.loss) {
				vertices[dimension] = { params: reflected, loss: reflectedLoss };
			} else {
				const contracted = reflect(worst.params, centroid, 0.5);
				const contractedLoss = await evaluate(contracted);
				evaluations++;
				if (contractedLoss < worst.loss) {
					vertices[dimension] = { params: contracted, loss: contractedLoss };
				} else {
					// Shrink toward the best vertex.
					for (let index = 1; index <= dimension; index++) {
						const shrunk: Record<string, number> = {};
						for (const name of names) {
							const entry = state.get(name)!;
							shrunk[name] = Number(clampParam(entry, vertices[0].params[name] + 0.5 * (vertices[index].params[name] - vertices[0].params[name])).toFixed(entry.precision));
						}
						vertices[index] = { params: shrunk, loss: await evaluate(shrunk) };
						evaluations++;
					}
				}
			}
		}
	}

	// Re-apply the best vector and take the final measurement through the same
	// path as every candidate, so the reported numbers are real bridge reads.
	if (options.applyParams) await options.applyParams(bestParams);
	const finalMeasurement = await measure();
	evaluations++;
	const converged = withinTolerance(finalMeasurement.perFrame, config.epsPos, config.epsScale);
	return {
		version: LOCAL_REFINER_VERSION,
		converged,
		stopReason: converged
			? 'tolerance-met'
			: outOfTime
				? 'timeout'
				: finalMeasurement.loss < initialMeasurement.loss
					? (stalled ? 'no-improvement' : 'max-sweeps')
					: 'no-improvement',
		initial: { loss: round4(initialMeasurement.loss), maxPosError: initialMeasurement.maxPosError, maxScaleError: initialMeasurement.maxScaleError, frames: initialMeasurement.frames },
		final: {
			loss: round4(finalMeasurement.loss),
			maxPosError: finalMeasurement.maxPosError,
			maxScaleError: finalMeasurement.maxScaleError,
			frames: finalMeasurement.frames,
			perFrame: finalMeasurement.perFrame,
		},
		params: bestParams,
		sweeps,
		evaluations,
		solver,
		steps,
		llmTokens: 0,
		durationMs: Date.now() - startedAt,
	};
}
