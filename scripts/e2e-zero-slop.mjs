/**
 * End-to-end synthetic reference clone — Stage 1 → 2 → 3 (promotion) →
 * 4 (`_mg` compile) → 4.5 (local bbox solver) → 5 (SSIM gate), entirely
 * against the MockStallionServer fixture (no Cavalry, no network, no LLM).
 *
 * The scenario: a reference where a card sits at a KNOWN ground-truth anchor.
 * The `_mg` manifest seeds the card with a deliberate (+30, +15) px anchor
 * error. Stage 4.5 must recover the true anchor numerically — zero LLM
 * tokens — before Stage 5's SSIM confirms the pixels match.
 *
 * Run: node scripts/e2e-zero-slop.mjs   (exit 0 = converged)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { startMockStallionServer, MockScene } from '../tests/fixtures/MockStallionServer.ts';
import { runZeroSlopPipeline } from '../src/pipeline/zero-slop-pipeline.mjs';
import { computeSSIM } from '../src/vision/perceptual.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMP = { width: 320, height: 200, fps: 24, endFrame: 32, bg: '#101418' };
const TRUE_POSITION = { x: 120, y: 80 };
const SEEDED_ERROR = { x: 30, y: 15 };
const CARD = { width: 120, height: 60, color: '#204fe0' };
const BEAT_FRAMES = [0, 8, 16, 24];

const buildScene = (positionOffset) => {
	const scene = new MockScene();
	scene.createComp(COMP);
	scene.createLayer('rectangle', 'card', {
		'generator.dimensions': [CARD.width, CARD.height],
		position: [TRUE_POSITION.x + positionOffset.x, TRUE_POSITION.y + positionOffset.y],
		'material.fillColor': CARD.color,
	});
	return scene;
};

const renderPng = async (scene, frame, file) => {
	const rgba = scene.rasterize(frame, COMP.width, COMP.height);
	const image = new PNG({ width: COMP.width, height: COMP.height });
	rgba.copy(image.data);
	await fs.writeFile(file, PNG.sync.write(image));
};

const run = async () => {
	const startedAt = Date.now();
	const runDirectory = path.join(os.tmpdir(), `refclone-e2e-${Date.now().toString(36)}`);
	await fs.mkdir(runDirectory, { recursive: true });
	const mock = await startMockStallionServer();

	try {
		// ---- Ground truth: the reference frames the clone is scored against.
		const truthScene = buildScene({ x: 0, y: 0 });
		const framePngPaths = {};
		for (const frame of BEAT_FRAMES) {
			const file = path.join(runDirectory, `reference-${String(frame).padStart(6, '0')}.png`);
			await renderPng(truthScene, frame, file);
			framePngPaths[String(frame)] = file;
		}

		// ---- Stage 1 evidence: crops/elements measured on the rest frame. The
		// synthetic reference has no non-primitive asset, so deconstruction is
		// style-spec only (the decomp CLI covers asset tracing).
		const restPng = framePngPaths['0'];
		const restScene = buildScene({ x: 0, y: 0 });
		const box = restScene.boxAt(restScene.layers.get([...restScene.layers.keys()][0]), 0);
		const crops = [];
		const elements = [{
			elementId: 'card',
			frame: 0,
			pngPath: restPng,
			box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
			motionQuery: 'card pop spring',
		}];

		// ---- Stage 2: the manifest arrives pre-supplied (deterministic lane:
		// zero LLM turns by construction). The seeded anchor error is the point.
		const manifest = {
			comp: COMP,
			layers: [{
				as: '$card',
				kind: 'shape',
				shape: 'rectangle',
				attrs: {
					'generator.dimensions': [CARD.width, CARD.height],
					position: [TRUE_POSITION.x + SEEDED_ERROR.x, TRUE_POSITION.y + SEEDED_ERROR.y],
					'material.fillColor': CARD.color,
				},
			}],
		};

		// ---- Reference tracks for the solver (ground-truth boxes per beat frame).
		const tracks = [{
			layerId: '$card',
			elementId: 'card',
			beatId: 'beat_01',
			fps: COMP.fps,
			boxesByFrame: Object.fromEntries(BEAT_FRAMES.map((frame) => [
				String(frame),
				{ x: TRUE_POSITION.x - CARD.width / 2, y: TRUE_POSITION.y - CARD.height / 2, width: CARD.width, height: CARD.height },
			])),
		}];

		// ---- Numeric rig tunables Stage 4.5 may move.
		const tunables = [
			{ name: 'card.position.x', target: '$card', attr: 'position.x', value: TRUE_POSITION.x + SEEDED_ERROR.x, min: 0, max: COMP.width, step: 8 },
			{ name: 'card.position.y', target: '$card', attr: 'position.y', value: TRUE_POSITION.y + SEEDED_ERROR.y, min: 0, max: COMP.height, step: 8 },
		];

		const result = await runZeroSlopPipeline({
			runDirectory,
			baseUrl: mock.url,
			manifest,
			crops,
			elements,
			tracks,
			tunables,
			sampleFrames: BEAT_FRAMES,
			framePngPaths,
			renderFrames: true,
			thresholds: { ssimThreshold: 0.96, iouThreshold: 0.95 },
		});

		// ---- Independent verification: SSIM recomputed outside the pipeline.
		const verification = [];
		for (const frame of BEAT_FRAMES) {
			const reference = PNG.sync.read(await fs.readFile(framePngPaths[String(frame)]));
			const renderedPath = path.join(runDirectory, 'optimize', `frame-${String(frame).padStart(6, '0')}.png`);
			const rendered = PNG.sync.read(await fs.readFile(renderedPath));
			verification.push({
				frame,
				ssim: computeSSIM(
					{ data: reference.data, width: reference.width, height: reference.height },
					{ data: rendered.data, width: rendered.width, height: rendered.height },
				),
			});
		}
		const meanSsim = verification.reduce((sum, entry) => sum + entry.ssim, 0) / verification.length;

		const refinement = result.stages.localRefinement?.refinement ?? null;
		const telemetry = {
			complete: result.complete,
			blocked: result.blocked ?? false,
			llmTokens: result.llmCalls.length,
			initialBboxL2: refinement?.initial?.loss ?? null,
			finalBboxL2: refinement?.final?.loss ?? null,
			initialMaxPosErrorPx: refinement?.initial?.maxPosError ?? null,
			finalMaxPosErrorPx: refinement?.final?.maxPosError ?? null,
			initialMaxScaleError: refinement?.initial?.maxScaleError ?? null,
			finalMaxScaleError: refinement?.final?.maxScaleError ?? null,
			refiner: refinement ? { solver: refinement.solver, evaluations: refinement.evaluations, converged: refinement.converged, stopReason: refinement.stopReason } : null,
			gateSsim: result.scores?.ssim ?? null,
			gateIou: result.scores?.iou ?? null,
			verifiedSsim: Math.round(meanSsim * 10000) / 10000,
			totalDurationMs: Date.now() - startedAt,
			seededAnchorErrorPx: SEEDED_ERROR,
			runDirectory,
		};
		console.log(JSON.stringify(telemetry, null, 2));

		const failures = [];
		if (telemetry.llmTokens !== 0) failures.push(`llmTokens must be 0, got ${telemetry.llmTokens}`);
		if (!(telemetry.initialBboxL2 > 0)) failures.push('the seeded anchor error must produce a positive initial L2');
		if (!(telemetry.finalBboxL2 <= telemetry.initialBboxL2 * 0.01)) failures.push(`Stage 4.5 must reduce the L2 by 100x, got ${telemetry.initialBboxL2} -> ${telemetry.finalBboxL2}`);
		if (!(telemetry.finalMaxPosErrorPx <= 1.5)) failures.push(`positional tolerance 1.5px, got ${telemetry.finalMaxPosErrorPx}`);
		if (!(telemetry.finalMaxScaleError <= 0.02)) failures.push(`scale tolerance 2%, got ${telemetry.finalMaxScaleError}`);
		if (!(telemetry.verifiedSsim >= 0.96)) failures.push(`verified SSIM below 0.96: ${telemetry.verifiedSsim}`);
		if (!telemetry.complete) failures.push('pipeline did not reach complete');
		if (failures.length) {
			console.error(`E2E FAILED:\n- ${failures.join('\n- ')}`);
			process.exitCode = 1;
			return;
		}
		console.log('E2E PASSED: zero LLM tokens, anchor error recovered, SSIM gate met.');
	} finally {
		await mock.close();
	}
};

run().catch((error) => {
	console.error(String(error?.stack ?? error));
	process.exitCode = 1;
});
