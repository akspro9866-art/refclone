/**
 * Stage 3 semantic trajectory fitter — the zero-raw-frames gate.
 *
 * The Stage 2 LLM prompt must NEVER carry raw per-frame
 * `[frame, x, y, scale, rotation]` arrays: they are the token furnace that
 * made the old pipeline expensive and the "AI slop" baked-keyframe path
 * attractive. This module converts tracked trajectories into compact semantic
 * primitives instead:
 *
 *   - `LinearSpan`         — constant velocity between two keyframes
 *   - `CubicBezierSpan`    — CSS-style easing (x1, y1, x2, y2) between two
 *                            keyframes, fitted by `promotion.mjs`'s weighted
 *                            solver under the RMSE/pixel gates
 *   - `DampedSpringSpan`   — (stiffness, damping, mass, overshoot) for
 *                            oscillating arrivals, via `fitDampedSpring`
 *   - `StaticValue`        — the trajectory does not move; no keys at all
 *
 * plus group detection for multi-element entrances (`StaggerGroup`: count,
 * frameDelay, indexOrder) via `detectDuplicatorPattern`'s cross-correlation.
 *
 * Output: one `SemanticBeatDescriptor` per beat — bounded, token-counted
 * (< 400), mapping 1:1 onto `cavalry-mcp` preset queries and native `_mg`
 * behaviors (`stagger`, `duplicator`, `value2` spring, `magicEasing`). The
 * descriptor's `promptLine` is the ONLY thing from a track that may enter an
 * LLM prompt.
 *
 * This module is deterministic: same trajectories in, byte-identical
 * descriptor out.
 */

import {
	analyzeTrajectory,
	detectDuplicatorPattern,
	PROMOTION_VERSION,
	BEZIER_RMSE_MAX_PX,
} from '../cavalry/promotion.mjs';

export const TRAJECTORY_FITTER_VERSION = '1.0.0';

/** Hard bound: a descriptor that cannot say more than this is not a summary. */
export const BEAT_DESCRIPTOR_TOKEN_BUDGET = 400;

/** Max tracks serialized into one beat descriptor (worst offenders first). */
export const BEAT_DESCRIPTOR_MAX_TRACKS = 12;

// ---------------------------------------------------------------------------
// Span types
// ---------------------------------------------------------------------------

export interface FrameValue {
	frame: number;
	value: number;
}

export interface LinearSpan {
	kind: 'linear';
	start: FrameValue;
	end: FrameValue;
	rmse: number;
}

export interface CubicBezierSpan {
	kind: 'cubic_bezier';
	/** CSS cubic-bezier control points: P1=(x1,y1), P2=(x2,y2). */
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	start: FrameValue;
	end: FrameValue;
	rmse: number;
}

export interface DampedSpringSpan {
	kind: 'damped_spring';
	/** Natural frequency (rad/s) and damping ratio from the normalized fit. */
	omega0: number;
	zeta: number;
	/** Derived rig parameters: stiffness k = ω0²·m and damping c = 2ζω0·m. */
	stiffness: number;
	damping: number;
	mass: number;
	/** Peak overshoot fraction beyond the target (0 = no overshoot). */
	overshoot: number;
	start: FrameValue;
	end: FrameValue;
	rmse: number;
}

export interface StaticSpan {
	kind: 'static';
	value: number;
}

export interface UnfittedSpan {
	/** The trajectory did not meet any procedural gate; measured keys stay. */
	kind: 'measured';
	reason: string;
}

export type SemanticSpan = LinearSpan | CubicBezierSpan | DampedSpringSpan | StaticSpan | UnfittedSpan;

export interface SemanticTrack {
	elementId: string;
	property: string;
	attributePath: string | null;
	span: SemanticSpan;
	confidence: number;
	sampleCount: number;
}

export interface StaggerGroupInfo {
	count: number;
	elementIds: string[];
	/** Frame delay between successive group members. */
	frameDelay: number;
	/** 'asc' = later members start later (the usual entrance); 'desc' reversed. */
	indexOrder: 'asc' | 'desc';
	correlation: number;
}

export interface SemanticBeatDescriptor {
	version: string;
	fitterVersion: string;
	promotionVersion: string;
	beatId: string;
	fps: number;
	startFrame: number;
	endFrame: number;
	tracks: SemanticTrack[];
	stagger: StaggerGroupInfo | null;
	/** Native behaviors this beat maps onto (stagger, duplicator, value2, magicEasing). */
	suggestedBehaviors: string[];
	/** Keyword set for the preset-library search (cavalry-mcp searchPresets). */
	motionKeywords: string[];
	/** The compact, token-counted serialization — the ONLY LLM-visible form. */
	promptLine: string;
	estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

export interface TrackInput {
	elementId: string;
	property: string;
	attributePath?: string | null;
	/** Measured samples — NEVER serialized anywhere downstream. */
	points: FrameValue[];
}

export interface FitSemanticBeatInput {
	beatId: string;
	fps: number;
	/** One entry per element; each carries its per-property trajectories. */
	tracks: TrackInput[];
	/** Source pixels per normalized unit, enables the per-frame pixel gate. */
	pixelScale?: number;
	/** Per-frame pixel RMSE ceiling for the bezier preset gate. */
	bezierRmseMaxPx?: number;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Linear RMSE of the samples against the straight line between endpoints. */
function linearRmse(points: FrameValue[]): number {
	const first = points[0];
	const last = points[points.length - 1];
	const frameSpan = last.frame - first.frame;
	if (frameSpan <= 0) return 0;
	const slope = (last.value - first.value) / frameSpan;
	let sum = 0;
	for (const point of points) {
		const predicted = first.value + slope * (point.frame - first.frame);
		sum += (predicted - point.value) ** 2;
	}
	return Math.sqrt(sum / points.length);
}

/** Peak overshoot fraction of a normalized trajectory beyond its final value. */
function overshootOf(normalizedValues: number[]): number {
	const target = normalizedValues[normalizedValues.length - 1];
	let peak = target;
	for (const value of normalizedValues) peak = Math.max(peak, value);
	if (target <= 0) return 0;
	return Math.max(0, round3((peak - target) / Math.abs(target)));
}

/**
 * Fit ONE track to its most compact semantic span. Order of preference:
 * static (no motion) → linear (constant velocity) → cubic_bezier (monotonic
 * ease, gated by promotion.mjs) → damped_spring (oscillation) → measured.
 */
export function fitTrackSpan(input: TrackInput, options: { pixelScale?: number; bezierRmseMaxPx?: number } = {}): SemanticTrack {
	const points = [...(input.points ?? [])]
		.filter((point) => Number.isFinite(Number(point?.frame)) && Number.isFinite(Number(point?.value)))
		.map((point) => ({ frame: Number(point.frame), value: Number(point.value) }))
		.sort((a, b) => a.frame - b.frame);
	if (points.length < 2) {
		return { elementId: input.elementId, property: input.property, attributePath: input.attributePath ?? null, span: { kind: 'measured', reason: 'insufficient_points' }, confidence: 0, sampleCount: points.length };
	}

	const values = points.map((point) => round3(point.value));
	if (new Set(values).size === 1) {
		return { elementId: input.elementId, property: input.property, attributePath: input.attributePath ?? null, span: { kind: 'static', value: values[0] }, confidence: 1, sampleCount: points.length };
	}

	const first = points[0];
	const last = points[points.length - 1];
	const linear = linearRmse(points);
	// A straight line within half a percent of the value range is a LinearSpan —
	// cheaper to express than a bezier and visually identical.
	const valueRange = Math.max(...values) - Math.min(...values);
	if (valueRange > 0 && linear / valueRange <= 0.005) {
		return {
			elementId: input.elementId,
			property: input.property,
			attributePath: input.attributePath ?? null,
			span: { kind: 'linear', start: { frame: first.frame, value: first.value }, end: { frame: last.frame, value: last.value }, rmse: round3(linear) },
			confidence: 1 - Math.min(1, linear / Math.max(valueRange, 1e-9)),
			sampleCount: points.length,
		};
	}

	// The promotion engine owns the bezier/spring gates (RMSE <= 0.015 on the
	// normalized curve, R² >= 0.92 for springs, optional per-frame pixel gate).
	let promotion: ReturnType<typeof analyzeTrajectory>;
	try {
		promotion = analyzeTrajectory({
			elementId: input.elementId,
			property: input.property,
			attributePath: input.attributePath ?? undefined,
			points,
			pixelScale: options.pixelScale,
			bezierRmseMaxPx: options.bezierRmseMaxPx ?? BEZIER_RMSE_MAX_PX,
		});
	} catch {
		promotion = { promotion: 'none', reason: 'analyzer_error' } as ReturnType<typeof analyzeTrajectory>;
	}

	if (promotion.promotion === 'cubic_bezier') {
		const parameters = promotion.parameters as { y1: number; y2: number; startFrame: number; endFrame: number; startValue: number; endValue: number };
		const metrics = promotion.metrics as { rmse: number };
		return {
			elementId: input.elementId,
			property: input.property,
			attributePath: input.attributePath ?? null,
			span: {
				kind: 'cubic_bezier',
				x1: 0.3,
				y1: round3(parameters.y1),
				x2: 0.7,
				y2: round3(parameters.y2),
				start: { frame: parameters.startFrame, value: parameters.startValue },
				end: { frame: parameters.endFrame, value: parameters.endValue },
				rmse: round3(metrics.rmse),
			},
			confidence: Number(promotion.confidence ?? 0),
			sampleCount: points.length,
		};
	}
	if (promotion.promotion === 'damped_spring') {
		const parameters = promotion.parameters as { zeta: number; omega0: number; startFrame: number; endFrame: number; startValue: number; targetValue: number };
		const metrics = promotion.metrics as { r2: number };
		const mass = 1;
		const stiffness = round3(parameters.omega0 ** 2 * mass);
		const damping = round3(2 * parameters.zeta * parameters.omega0 * mass);
		// Normalized values again, only for the overshoot scalar.
		const valueRange = Math.max(...values) - Math.min(...values);
		const normalizedValues = valueRange > 0 ? values.map((value) => (value - Math.min(...values)) / valueRange) : values.map(() => 0.5);
		return {
			elementId: input.elementId,
			property: input.property,
			attributePath: input.attributePath ?? null,
			span: {
				kind: 'damped_spring',
				omega0: round3(parameters.omega0),
				zeta: round3(parameters.zeta),
				stiffness,
				damping,
				mass,
				overshoot: overshootOf(normalizedValues),
				start: { frame: parameters.startFrame, value: parameters.startValue },
				end: { frame: parameters.endFrame, value: parameters.targetValue },
				// The spring gate reports R²; the equivalent normalized RMS residual.
				rmse: round3(Math.sqrt(Math.max(0, 1 - (metrics.r2 ?? 0)))),
			},
			confidence: Number(promotion.confidence ?? 0),
			sampleCount: points.length,
		};
	}
	return {
		elementId: input.elementId,
		property: input.property,
		attributePath: input.attributePath ?? null,
		span: { kind: 'measured', reason: String(promotion.reason ?? promotion.promotion ?? 'no_gate_met') },
		confidence: 0,
		sampleCount: points.length,
	};
}

/**
 * Group detection for multi-element staggered entrances: reuses the promotion
 * engine's cross-correlation (correlation >= 0.85, lag <= 2 samples by
 * default) and maps the winner group onto a StaggerGroup.
 */
export function detectStaggerGroup(elements: Array<{ id: string; trajectory: Array<{ frame: number; x: number; y: number }> }>): StaggerGroupInfo | null {
	const detection = detectDuplicatorPattern(elements);
	if (!detection.detected || !detection.groups.length) return null;
	const group = detection.groups[0];
	const elementIds = group.elementIds as string[];
	const lagFrames = Number(group.lagFrames ?? 0);
	return {
		count: elementIds.length,
		elementIds,
		frameDelay: lagFrames,
		indexOrder: 'asc',
		correlation: round3(Number(group.correlation ?? 0)),
	};
}

// ---------------------------------------------------------------------------
// Token estimation + prompt serialization (the no-raw-frames boundary)
// ---------------------------------------------------------------------------

/**
 * Bounded token estimate: ~4 characters per token for the JSON-ish prose this
 * module emits (empirically between 3.5 and 4.5 for GPT-family tokenizers;
 * the 4.0 divisor under-estimates nothing).
 */
export function estimateTokenCount(text: string): number {
	return Math.ceil(String(text ?? '').length / 4);
}

/** Serialize one span to its compact semantic form. Raw sample arrays never appear. */
function spanToSummary(track: SemanticTrack): string {
	const span = track.span;
	const attribute = track.attributePath ?? track.property;
	switch (span.kind) {
		case 'static':
			return `${attribute}=static(${span.value})`;
		case 'linear':
			return `${attribute}=linear[${span.start.frame}:${span.start.value} -> ${span.end.frame}:${span.end.value}] rmse=${span.rmse}`;
		case 'cubic_bezier':
			return `${attribute}=bezier(${span.x1},${span.y1},${span.x2},${span.y2})[${span.start.frame}:${span.start.value} -> ${span.end.frame}:${span.end.value}] rmse=${span.rmse}`;
		case 'damped_spring':
			return `${attribute}=spring(k=${span.stiffness},c=${span.damping},m=${span.mass},overshoot=${span.overshoot})[${span.start.frame} -> ${span.end.frame}] rmse=${span.rmse}`;
		case 'measured':
			return `${attribute}=measured(${span.reason})`;
	}
}

function behaviorsFor(tracks: SemanticTrack[], stagger: StaggerGroupInfo | null): string[] {
	const behaviors = new Set<string>();
	for (const track of tracks) {
		if (track.span.kind === 'damped_spring') behaviors.add('value2');
		if (track.span.kind === 'cubic_bezier') behaviors.add('magicEasing');
	}
	if (stagger) {
		behaviors.add('stagger');
		behaviors.add('duplicator');
	}
	return [...behaviors];
}

function keywordsFor(tracks: SemanticTrack[], stagger: StaggerGroupInfo | null): string[] {
	const keywords = new Set<string>();
	for (const track of tracks) {
		if (track.span.kind === 'damped_spring') keywords.add('spring');
		if (track.span.kind === 'cubic_bezier') keywords.add('easing');
		if (/scale|dimension/i.test(track.property)) keywords.add('pop');
		if (/opacity|alpha/i.test(track.property)) keywords.add('fade');
	}
	if (stagger) keywords.add('stagger');
	return [...keywords];
}

/**
 * Fit a whole beat. Deterministic: tracks are sorted by elementId/property
 * before fitting, so the descriptor never depends on caller ordering.
 */
export function fitSemanticBeat(input: FitSemanticBeatInput): SemanticBeatDescriptor {
	if (!input?.beatId) throw new Error('fitSemanticBeat requires a beatId');
	if (!Number.isFinite(Number(input?.fps)) || Number(input.fps) <= 0) throw new Error('fitSemanticBeat requires a positive fps');
	const options = { pixelScale: input.pixelScale, bezierRmseMaxPx: input.bezierRmseMaxPx };
	const ordered = [...(input.tracks ?? [])].sort((a, b) => `${a.elementId}:${a.property}`.localeCompare(`${b.elementId}:${b.property}`));
	const tracks = ordered.map((track) => fitTrackSpan(track, options)).slice(0, BEAT_DESCRIPTOR_MAX_TRACKS);

	// Stagger detection needs x/y trajectories per element; build them from the
	// position tracks when they exist.
	const positionTracks = new Map<string, Array<{ frame: number; x: number; y: number }>>();
	for (const track of ordered) {
		if (!/position/i.test(track.property)) continue;
		const list = positionTracks.get(track.elementId) ?? [];
		for (const point of track.points) {
			const existing = list.find((entry) => entry.frame === point.frame);
			if (!existing) list.push({ frame: point.frame, x: /x$/i.test(track.property) ? point.value : 0, y: /y$/i.test(track.property) ? point.value : 0 });
			else if (/x$/i.test(track.property)) existing.x = point.value;
			else existing.y = point.value;
		}
	}
	const stagger = detectStaggerGroup([...positionTracks.entries()].map(([id, trajectory]) => ({ id, trajectory: trajectory.sort((a, b) => a.frame - b.frame) })));

	const frames = ordered.flatMap((track) => track.points.map((point) => point.frame));
	const startFrame = frames.length ? Math.min(...frames) : 0;
	const endFrame = frames.length ? Math.max(...frames) : 0;
	const behaviors = behaviorsFor(tracks, stagger);
	const keywords = keywordsFor(tracks, stagger);

	const trackSummaries = tracks.map((track) => `${track.elementId}:${spanToSummary(track)}`);
	const parts = [
		`beat=${input.beatId}`,
		`frames=${startFrame}-${endFrame}@${input.fps}fps`,
		`tracks(${tracks.length}): ${trackSummaries.join('; ')}`,
	];
	if (stagger) {
		parts.push(`stagger: count=${stagger.count} delay=${stagger.frameDelay}f order=${stagger.indexOrder} corr=${stagger.correlation}`);
	}
	if (behaviors.length) parts.push(`behaviors: ${behaviors.join(',')}`);
	if (keywords.length) parts.push(`preset-keywords: ${keywords.join(',')}`);
	const promptLine = parts.join(' | ');

	const descriptor: SemanticBeatDescriptor = {
		version: '1.0.0',
		fitterVersion: TRAJECTORY_FITTER_VERSION,
		promotionVersion: PROMOTION_VERSION,
		beatId: input.beatId,
		fps: Number(input.fps),
		startFrame,
		endFrame,
		tracks,
		stagger,
		suggestedBehaviors: behaviors,
		motionKeywords: keywords,
		promptLine,
		estimatedTokens: estimateTokenCount(promptLine),
	};
	if (descriptor.estimatedTokens > BEAT_DESCRIPTOR_TOKEN_BUDGET) {
		throw new Error(
			`semantic beat descriptor exceeds the ${BEAT_DESCRIPTOR_TOKEN_BUDGET}-token budget (${descriptor.estimatedTokens}); ` +
				'reduce the track count or split the beat — raw frame arrays are never the answer.',
		);
	}
	return descriptor;
}

/**
 * The Stage 2 prompt block for a set of beats. This replaces any per-frame
 * track dump: an LLM sees spans, not samples.
 */
export function beatsToPromptBlock(descriptors: SemanticBeatDescriptor[]): string {
	const lines = ['Pre-fitted semantic beat descriptors (spans only — never raw frame arrays):'];
	for (const descriptor of descriptors) lines.push(`- ${descriptor.promptLine}`);
	return lines.join('\n');
}
