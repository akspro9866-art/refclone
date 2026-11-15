/**
 * Stage 2 → Stage 3 R² promotion regularisation tests — run with `npm test`.
 *
 * Trajectories clearing the R² threshold (default 0.92) promote into native
 * Cavalry behaviour nodes; trajectories with residual error above the
 * threshold fall back to sparse Bézier keyframes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	evaluateTrajectoryFit,
	evaluateTrackPromotion,
	linearFit,
	rSquared,
	dampedOscillationFit,
	DEFAULT_R2_THRESHOLD,
} from '../../src/promotion/r2-evaluator.mjs';

/** Analytic damped cosine: rest + e^(−ζω0 t)·A·cos(ωd t). */
function dampedSeries({ frames = 60, rest = 500, amplitude = 200, zeta = 0.25, omega0 = 0.25 } = {}) {
	const samples = [];
	for (let t = 0; t < frames; t++) {
		const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
		samples.push({ frame: t, value: rest + amplitude * Math.exp(-zeta * omega0 * t) * Math.cos(omegaD * t) });
	}
	return samples;
}

/** A smooth monotonic drift with easing (fast then slow). */
function smoothApproach({ frames = 40, from = 0, to = 600 } = {}) {
	const samples = [];
	for (let t = 0; t < frames; t++) {
		const u = t / (frames - 1);
		const eased = 1 - Math.pow(1 - u, 2.4); // power-2.4 ease-out
		samples.push({ frame: t, value: from + (to - from) * eased });
	}
	return samples;
}

test('the default promotion threshold is 0.92', () => {
	assert.equal(DEFAULT_R2_THRESHOLD, 0.92);
});

test('a constant trajectory promotes to a native Value behaviour', () => {
	const samples = Array.from({ length: 20 }, (_, frame) => ({ frame, value: 320 }));
	const fit = evaluateTrajectoryFit(samples);
	assert.equal(fit.promoted, true);
	assert.equal(fit.behaviour, 'value');
	assert.equal(fit.r2, 1);
	assert.equal(fit.params.value, 320);
});

test('a damped oscillation promotes to a Spring behaviour with stiffness and damping', () => {
	const truth = { zeta: 0.25, omega0: 0.25 };
	const fit = evaluateTrajectoryFit(dampedSeries(truth));
	assert.equal(fit.promoted, true, `expected promotion, got: ${fit.reason}`);
	assert.equal(fit.behaviour, 'spring');
	assert.ok(fit.r2 >= 0.92, `R² ${fit.r2} must clear 0.92`);
	// Recovered parameters are close to the analytic truth (mass = 1).
	const expectedStiffness = truth.omega0 ** 2;
	const expectedDamping = 2 * truth.zeta * truth.omega0;
	assert.ok(Math.abs(fit.params.stiffness - expectedStiffness) / expectedStiffness < 0.15, `stiffness ${fit.params.stiffness} vs ${expectedStiffness}`);
	assert.ok(Math.abs(fit.params.damping - expectedDamping) / expectedDamping < 0.2, `damping ${fit.params.damping} vs ${expectedDamping}`);
	assert.ok(Math.abs(fit.params.dampingRatio - truth.zeta) < 0.06);
});

test('a critically damped smooth approach promotes to a Spring behaviour', () => {
	const fit = evaluateTrajectoryFit(smoothApproach());
	assert.equal(fit.promoted, true, `expected promotion, got: ${fit.reason}`);
	assert.equal(fit.behaviour, 'spring');
	assert.ok(fit.r2 >= 0.92, `R² ${fit.r2} must clear 0.92`);
	assert.ok(Number.isFinite(fit.params.stiffness));
});

test('an irregular oscillation below the fit threshold promotes to Noise, not Spring', () => {
	const samples = [];
	let seed = 7;
	const random = () => {
		// Deterministic LCG noise
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	for (let t = 0; t < 60; t++) {
		const jitter = (random() - 0.5) * 220;
		const wobble = Math.sin(t * 1.7) * 60 + Math.sin(t * 3.3 + 1) * 40;
		samples.push({ frame: t, value: 400 + jitter + wobble });
	}
	const fit = evaluateTrajectoryFit(samples);
	assert.ok(['noise', 'bezier-keyframes'].includes(fit.behaviour), `got ${fit.behaviour}: ${fit.reason}`);
	if (fit.behaviour === 'noise') {
		assert.equal(fit.promoted, true);
		assert.ok(fit.params.amplitude > 0);
	}
});

test('a trajectory with residual error above the threshold falls back to sparse Bézier keyframes', () => {
	// A monotone staircase: no smooth procedural model reproduces the abrupt
	// plateaus within a tight threshold, so the evaluator must fall back to
	// sparse Bézier keyframes instead of promoting a behaviour.
	const samples = [];
	for (let step = 0; step < 4; step++) {
		for (let t = 0; t < 10; t++) samples.push({ frame: step * 10 + t, value: step * 150 });
	}
	const fit = evaluateTrajectoryFit(samples, { threshold: 0.97 });
	assert.equal(fit.behaviour, 'bezier-keyframes', `got ${fit.behaviour}: ${fit.reason}`);
	assert.equal(fit.promoted, false);
	assert.ok(fit.reason.includes('threshold'), 'the reason names the threshold gate');
	assert.ok(fit.r2 < 0.97, `R² ${fit.r2} must sit below the 0.97 gate`);
});

test('too few samples never promote', () => {
	const fit = evaluateTrajectoryFit([{ frame: 0, value: 1 }, { frame: 5, value: 2 }]);
	assert.equal(fit.promoted, false);
	assert.equal(fit.behaviour, 'bezier-keyframes');
});

test('the R² helper is exact for a known fit', () => {
	const samples = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }];
	const fit = linearFit(samples);
	assert.equal(fit.a, 2);
	assert.equal(fit.b, 0);
	assert.equal(fit.r2, 1);
	const imperfect = samples.map((s) => (s.x === 2 ? { x: 2, y: 5 } : s));
	const r2 = rSquared(imperfect, (x) => 2 * x);
	assert.ok(r2 > 0.9 && r2 < 1, `r2 ${r2}`);
});

test('the damped fit solver recovers the analytic model', () => {
	const samples = dampedSeries({ frames: 48, zeta: 0.3, omega0: 0.3 }).map((s) => ({ x: s.frame, y: s.value }));
	const fit = dampedOscillationFit(samples);
	assert.ok(fit.r2 >= 0.98, `R² ${fit.r2}`);
	assert.ok(Math.abs(fit.zeta - 0.3) < 0.08, `zeta ${fit.zeta}`);
	assert.ok(Math.abs(fit.omega0 - 0.3) < 0.08, `omega0 ${fit.omega0}`);
});

test('evaluateTrackPromotion scores both axes of a Stage 2 element track', () => {
	const track = {
		elementId: 'hero_card',
		points: dampedSeries({ frames: 40 }).map((s) => ({
			frame: s.frame,
			bbox: { x: s.value - 50, y: 100 + Math.sin(s.frame / 6) * 5, width: 100, height: 60 },
		})),
		startFrame: 0,
		endFrame: 39,
		motionClass: 'rigid',
	};
	const promotion = evaluateTrackPromotion(track);
	assert.equal(promotion.elementId, 'hero_card');
	assert.equal(promotion.axes.x.promoted, true, `x: ${promotion.axes.x.reason}`);
	assert.equal(promotion.axes.x.behaviour, 'spring');
	assert.ok(promotion.axes.x.r2 >= 0.92);
	assert.ok(promotion.axes.y.promoted || promotion.axes.y.behaviour === 'bezier-keyframes');
});

test('promoteTracksToSceneSpecV2 wires R² promotion into native behaviour nodes (opt-in)', async () => {
	const { promoteTracksToSceneSpecV2 } = await import('../../src/pipeline/stage3-promote.ts');
	const track = {
		elementId: 'card',
		points: dampedSeries({ frames: 40 }).map((s) => ({
			frame: s.frame,
			bbox: { x: s.value, y: 120, width: 240, height: 120 },
		})),
		startFrame: 0,
		endFrame: 39,
		motionClass: 'rigid',
	};

	const promoted = promoteTracksToSceneSpecV2([track], { fps: 60, r2Promotion: true });
	const layer = promoted.layers[0];
	assert.ok(layer.attrs.promotion, 'the promotion decision is recorded on the layer');
	assert.equal(layer.attrs.promotion.behaviours.x, 'spring');
	assert.ok(layer.attrs.promotion.r2.x >= 0.92);
	assert.ok(layer.connections.some((c) => c.attrPath === 'position.x'), 'a behaviour connection is emitted for the promoted axis');
	// Only the anchor endpoints are baked once the behaviour reproduces the motion.
	assert.ok(layer.keyframes.position.length <= 2, `promoted layer bakes ${layer.keyframes.position.length} anchor keyframes`);

	// Without the opt-in the dense keyframe bake is unchanged.
	const dense = promoteTracksToSceneSpecV2([track], { fps: 60 });
	assert.equal(dense.layers[0].keyframes.position.length, 40, 'default behavior stays the per-point bake');
	assert.ok(!dense.layers[0].attrs.promotion);
	assert.ok(!dense.layers[0].connections);
});
