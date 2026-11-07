/**
 * Turnkey real-video clone runner — one command from `.mp4` (or a frames
 * directory) to a verified procedural Cavalry clone.
 *
 *   npm run clone:live -- <input_video_or_frames_dir> [flags]
 *
 * What it does, in order:
 *
 *   1. PROBE  — GET {bridge}/get for a live Cavalry 2.8.0 Stallion heartbeat;
 *      a stale result envelope is followed by one `batch_inspect` capability
 *      probe, because the heartbeat slot carries the LAST payload, not a
 *      status. Requires v{minVersion} + the v0.11 capability set
 *      (batch_inspect, checkpoint, rollback, render_frame_fast). Without a
 *      live bridge, `--mock-fallback` (or headless CI) spins up
 *      MockStallionServer automatically.
 *   2. DECOMP — token fingerprinting (palette roles / radius / shadow),
 *      SVG + transparent-matte asset extraction for every --crop region, and
 *      the audio ⊕ optical-flow beat grid snapped to integer frames.
 *   3. CLONE  — the 5-stage zero-slop pipeline against the chosen bridge:
 *      Stage 3 compiles the deterministic `_mg` manifest (background +
 *      imported assets + one preset-library entrance rig), Stage 4 aligns,
 *      Stage 4.5 refines the anchors through /batch_inspect (0 LLM tokens),
 *      Stage 5 verifies SSIM/IoU at the beat frames.
 *   4. SCORE  — one telemetry scorecard: probe verdict, decomp counts,
 *      bbox L2 before/after the solver, LLM tokens consumed (always 0 on the
 *      deterministic lane), SSIM/IoU, and total wall-clock.
 *
 * Honest scope, printed on every run: the deterministic lane reconstructs the
 * reference's rest state exactly (layout, tokens, vector assets, beat
 * timings) and drives entrances through preset rigs. Per-element motion
 * cloning of arbitrary footage needs tracks — pass `--plan` with
 * `tracks`/`manifest` from a `procedural`/`autoanalyze` run, or accept the
 * below-gate score the pipeline reports instead of a baked-keyframe fake.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockStallionServer } from '../tests/fixtures/MockStallionServer.ts';
import { createStallionClient } from '../src/cavalry/stallion-batch.mjs';
import { deconstruct, loadAudioPcm } from '../src/decomp/decomp.ts';
import { runZeroSlopPipeline } from '../src/pipeline/zero-slop-pipeline.mjs';
import { loadCavalryLib } from '../src/cavalry/cavalry-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `clone:live — one-command reference clone against live Cavalry or the mock bridge

  npm run clone:live -- <video_or_frames_dir> [--out <dir>] [--fps <n>] [--plan <json>]
                                       [--crop "x,y,w,h[:name];..."] [--audio <file>]
                                       [--mock-fallback] [--bridge <url>] [--quiet]

Probe → decomp → 5-stage zero-slop pipeline → telemetry scorecard.`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const args = { flags: {}, positional: [] };
	const known = new Set(['--out', '--fps', '--plan', '--crop', '--audio', '--sample-rate', '--mock-fallback', '--bridge', '--quiet', '--help']);
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index];
		if (token === '--mock-fallback') {
			args.flags['--mock-fallback'] = '1';
			continue;
		}
		if (token === '--quiet') {
			args.flags['--quiet'] = '1';
			continue;
		}
		if (token === '--help' || token === '-h') {
			args.flags['--help'] = '1';
			continue;
		}
		if (token.startsWith('--')) {
			const value = argv[index + 1];
			if (!known.has(token) || value === undefined) throw new Error(`unknown or incomplete flag: ${token}`);
			args.flags[token] = value;
			index++;
			continue;
		}
		args.positional.push(token);
	}
	return args;
}

async function readJson(file) {
	return JSON.parse(await fs.readFile(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// Live probe
// ---------------------------------------------------------------------------

/**
 * Probe the bridge at `baseUrl`. Returns
 * `{ live, url, version, capabilities, verdict }`.
 *
 * `GET /get` serves the LAST payload — a heartbeat only before the first
 * result. When the payload is not a status heartbeat (or not reachable), one
 * `batch_inspect` capability probe decides: a `kind: "batch_inspect"`
 * envelope means a v0.11+ bridge is live; anything else is not.
 */
export async function probeBridge(baseUrl, plan, { quiet = false } = {}) {
	const bridgePlan = plan.bridge ?? {};
	const minVersion = String(bridgePlan.minVersion ?? '0.11.0');
	const required = bridgePlan.requiredCapabilities ?? ['batch-step', 'batch_inspect', 'checkpoint', 'rollback', 'render_frame_fast'];
	const base = String(baseUrl ?? bridgePlan.baseUrl ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
	const client = createStallionClient({ baseUrl: base, timeoutMs: 4000 });

	const heartbeat = await client.getPayload().catch((error) => ({ unreachable: String(error?.message ?? error) }));
	let version = null;
	let capabilities = null;
	if (!heartbeat.unreachable && heartbeat.kind === 'status') {
		version = typeof heartbeat.stallion === 'string' ? heartbeat.stallion.replace(/-mock$/, '') : null;
		capabilities = Array.isArray(heartbeat.capabilities?.introspect) ? heartbeat.capabilities.introspect : null;
	}
	// Capability probe: never trust a stale envelope for the v0.11 kinds.
	let probedKind = null;
	try {
		const envelope = await client.batchInspect({ frames: [0], timeoutMs: 6000 });
		probedKind = envelope?.kind ?? null;
	} catch {
		probedKind = null;
	}
	const live = probedKind === 'batch_inspect';
	const versionOk = live && (!version || compareVersions(version, minVersion) >= 0);
	const capabilitiesOk = live && (!capabilities || required.every((kind) => capabilities.includes(kind)));
	const verdict = !live
		? `no v${minVersion}+ bridge answering at ${base} (capability probe returned ${probedKind ?? 'nothing'})`
		: !versionOk
			? `bridge at ${base} reports v${version ?? 'unknown'}; v${minVersion}+ required — re-run Scripts → Stallion in Cavalry`
			: !capabilitiesOk
				? `bridge at ${base} is v${version} but is missing capabilities: ${required.filter((kind) => !capabilities?.includes(kind)).join(', ')}`
				: `live Cavalry bridge v${version ?? minVersion}+ at ${base} with ${required.length}/${required.length} v0.11 capabilities`;
	if (!quiet) console.log(`[probe] ${verdict}`);
	return { live, url: base, version, capabilities, verdict, versionOk, capabilitiesOk };
}

function compareVersions(a, b) {
	const pa = String(a).split('.').map(Number);
	const pb = String(b).split('.').map(Number);
	for (let index = 0; index < 3; index++) {
		const left = pa[index] ?? 0;
		const right = pb[index] ?? 0;
		if (left !== right) return left - right;
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Plan synthesis (deterministic lane)
// ---------------------------------------------------------------------------

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Build the pipeline plan from the decomp report: background layer from the
 * frame fingerprint, one SVG layer per traced asset at its measured rest box,
 * an entrance preset from the 120-preset library when `presets.entrance` is
 * `auto`, and static-anchor tracks + position tunables for Stage 4.5.
 */
export async function synthesizePlanFromDecomp(decompReport, template, { fps, compOverride } = {}) {
	const lib = await loadCavalryLib();
	const frameFingerprint = decompReport.tokenFingerprints?.find((entry) => entry.element === 'frame') ?? null;
	const background = frameFingerprint?.background ?? template.comp?.bg ?? '#101418';
	const comp = {
		width: compOverride?.width ?? decompReport.tokenFingerprints?.[0]?.region?.width ?? template.comp?.width ?? 1920,
		height: compOverride?.height ?? decompReport.tokenFingerprints?.[0]?.region?.height ?? template.comp?.height ?? 1080,
		fps: fps ?? template.comp?.fps ?? 30,
		endFrame: Math.max(1, ...decompReport.beatGrid.boundaries.map((boundary) => boundary.frame), decompReport.beatGrid.totalFrames - 1),
		bg: background,
	};

	const layers = [];
	const ops = [];
	const tracks = [];
	const tunables = [];
	// Background plate: one full-frame rectangle in the measured background.
	layers.push({ as: '$background', kind: 'shape', shape: 'rectangle', attrs: { 'generator.dimensions': [comp.width, comp.height], position: [comp.width / 2, comp.height / 2], 'material.fillColor': background } });
	tracks.push({
		layerId: '$background',
		elementId: 'background',
		beatId: decompReport.beatGrid.version ? 'decomp' : 'beat_01',
		fps: comp.fps,
		boxesByFrame: {},
	});
	const presetScripts = [];
	const presetsApplied = [];

	// Imported vector assets at their measured rest boxes.
	for (const asset of decompReport.assetManifest.assets ?? []) {
		const alias = `$${asset.assetId}`;
		// The MEASURED foreground box (actual traced pixel extents), tighter than
		// the crop whenever the crop padding includes background — the geometry
		// a rebuild should use. The mock bridge renders an imported asset as its
		// measured box, so this keeps mock and live geometry identical; the real
		// SVG paths land on live Cavalry.
		const measured = asset.foregroundBox ?? asset.box;
		layers.push({
			as: alias,
			kind: 'svg',
			file: asset.sceneUri,
			name: asset.assetId,
			attrs: {
				'generator.dimensions': [measured.width, measured.height],
				'material.fillColor': asset.foreground,
			},
		});
		const center = { x: measured.x + measured.width / 2, y: measured.y + measured.height / 2 };
		ops.push({ op: 'set', target: alias, attrs: { position: [round2(center.x), round2(center.y)] } });
		const boxesByFrame = {};
		for (const frame of decompReport.beatGrid.boundaries.map((boundary) => boundary.frame)) {
			boxesByFrame[String(frame)] = { x: measured.x, y: measured.y, width: measured.width, height: measured.height };
		}
		tracks.push({ layerId: alias, elementId: asset.assetId, fps: comp.fps, boxesByFrame });
		tunables.push(
			{ name: `${asset.assetId}.position.x`, target: alias, attr: 'position.x', value: round2(center.x), min: 0, max: comp.width },
			{ name: `${asset.assetId}.position.y`, target: alias, attr: 'position.y', value: round2(center.y), min: 0, max: comp.height },
		);
	}
	// The background track's boxes: full frame at every beat boundary.
	for (const track of tracks) {
		if (track.elementId !== 'background') continue;
		for (const frame of decompReport.beatGrid.boundaries.map((boundary) => boundary.frame)) {
			track.boxesByFrame[String(frame)] = { x: 0, y: 0, width: comp.width, height: comp.height };
		}
	}

	// Entrance preset from the library, driven by the decomp motion keywords.
	const presetConfig = template.presets ?? {};
	if (presetConfig.entrance === 'auto' && lib && (decompReport.assetManifest.assets ?? []).length) {
		const keywords = [...(decompReport.beatGrid ? [] : []), 'entrance', ...(presetConfig.queryHints ?? [])].join(' ');
		const search = lib.searchPresets(keywords, presetConfig.category ?? undefined);
		const pick = search.presets?.[0];
		if (pick) {
			const resolved = lib.resolvePreset(pick.id, { duration: Math.min(90, Math.max(24, comp.fps)) });
			if (resolved?.ok) {
				presetScripts.push(resolved.script);
				presetsApplied.push(resolved.presetId);
			}
		}
	}

	return {
		version: template.version ?? '1.0.0',
		comp,
		manifest: { comp, layers, ops },
		presetScripts,
		presetsApplied,
		tracks,
		tunables,
		thresholds: {
			...(template.gate ?? {}),
			localRefiner: { ...(template.solver ?? {}) },
		},
	};
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

function printScorecard(sections) {
	const width = 74;
	const line = (text = '') => console.log(text ? `  ${text}`.padEnd(width) : '');
	console.log('┌' + '─'.repeat(width - 2) + '┐');
	line('CLONE TELEMETRY SCORECARD');
	console.log('├' + '─'.repeat(width - 2) + '┤');
	for (const section of sections) {
		line(`${section.title}`);
		for (const entry of section.rows) {
			line(`  ${entry.label}`.padEnd(46) + String(entry.value).padStart(Math.max(0, width - 50)));
		}
		console.log('├' + '─'.repeat(width - 2) + '┤');
	}
	line('zero LLM tokens on the deterministic lane — the numeric loop is');
	line('coordinate descent + Nelder-Mead over /batch_inspect measurements.');
	console.log('└' + '─'.repeat(width - 2) + '┘');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function cloneLive(argv = process.argv.slice(2)) {
	const startedAt = Date.now();
	const args = parseArgs(argv);
	if (args.flags['--help']) return { help: USAGE };
	const input = args.positional[0];
	if (!input) throw new Error('clone:live requires an input video or frames directory\n' + USAGE);

	const templatePath = args.flags['--plan'] ? path.resolve(args.flags['--plan']) : path.join(root, 'templates', 'live-pipeline-plan.json');
	const template = await readJson(templatePath);
	const fps = args.flags['--fps'] ? Number(args.flags['--fps']) : (template.comp?.fps ?? 30);
	const workRoot = args.flags['--out'] ? path.resolve(args.flags['--out']) : path.join(root, '.test-work', `clone-live-${Date.now().toString(36)}`);
	await fs.mkdir(workRoot, { recursive: true });
	const quiet = args.flags['--quiet'] === '1';

	// 1. Probe: live first, mock fallback when allowed (or forced headless).
	let probe = await probeBridge(args.flags['--bridge'] ?? template.bridge?.baseUrl, template, { quiet });
	let mock = null;
	if (!probe.live) {
		if (args.flags['--mock-fallback'] === '1' || template.bridge?.mockFallback === true) {
			mock = await startMockStallionServer({ port: 0 });
			probe = { live: false, url: mock.url, version: 'mock', capabilities: ['batch-step', 'batch_inspect', 'checkpoint', 'rollback', 'render_frame_fast'], verdict: `MOCK FALLBACK: MockStallionServer at ${mock.url} (live bridge unavailable)`, versionOk: true, capabilitiesOk: true };
			if (!quiet) console.log(`[probe] ${probe.verdict}`);
		} else {
			throw new Error(`${probe.verdict}. Start Cavalry and run Scripts → Stallion, or pass --mock-fallback.`);
		}
	}
	const baseUrl = probe.url;

	// 2. Decomp: tokens, vector assets, integer-frame beat grid.
	const audioPcm = args.flags['--audio'] ? await loadAudioPcm(path.resolve(args.flags['--audio']), Number(args.flags['--sample-rate'] ?? template.decomp?.sampleRate ?? 8000)) : null;
	const decompReport = await deconstruct(path.resolve(input), {
		outDir: path.join(workRoot, 'decomp'),
		fps,
		cropSpecs: args.flags['--crop'] ? [args.flags['--crop']] : (template.decomp?.cropSpecs ?? []),
		audioPcm,
		sampleRate: Number(args.flags['--sample-rate'] ?? template.decomp?.sampleRate ?? 8000),
		maxFrames: template.decomp?.maxFrames ?? 600,
		frameRange: template.decomp?.frameRange ?? null,
	});

	// 3. Deterministic plan synthesis + the 5-stage pipeline.
	const plan = await synthesizePlanFromDecomp(decompReport, template, { fps, compOverride: null });
	const beatFrames = decompReport.beatGrid.boundaries.map((boundary) => boundary.frame).filter((frame) => frame < decompReport.framesDecoded).slice(0, 8);
	const sampleFrames = beatFrames.length >= 2 ? beatFrames : [0, Math.max(1, decompReport.framesDecoded - 1)];
	// Reference evidence at the sampled frames: the decoded source frames.
	const frameFiles = (await fs.readdir(decompReport.framesDirectory)).filter((entry) => entry.toLowerCase().endsWith('.png')).sort();
	const framePngPaths = {};
	for (const frame of sampleFrames) {
		const file = frameFiles[Math.min(frame, frameFiles.length - 1)];
		if (file) framePngPaths[String(frame)] = path.join(decompReport.framesDirectory, file);
	}
	const result = await runZeroSlopPipeline({
		runDirectory: path.join(workRoot, 'pipeline'),
		baseUrl,
		manifest: plan.manifest,
		presetScripts: plan.presetScripts,
		tracks: plan.tracks,
		tunables: plan.tunables,
		sampleFrames,
		framePngPaths,
		renderFrames: true,
		renderOutputDir: path.join(workRoot, 'pipeline', 'frames'),
		thresholds: plan.thresholds,
	});

	const refinement = result.stages.localRefinement?.refinement ?? null;
	const scorecard = {
		probe: { label: 'bridge', value: probe.verdict },
		source: { label: 'input', value: `${path.resolve(input)} (${decompReport.inputKind}, ${decompReport.framesDecoded} frames @ ${fps}fps)` },
		decomp: {
			label: 'decomp',
			rows: [
				{ label: 'beat boundaries', value: decompReport.beatGrid.boundaries.map((boundary) => boundary.frame).join(',') },
				{ label: 'vector assets', value: `${(decompReport.assetManifest.assets ?? []).length} traced, ${(decompReport.assetManifest.failures ?? []).length} failed` },
				{ label: 'background / surface', value: `${decompReport.tokenFingerprints?.[0]?.background ?? '—'} / ${decompReport.tokenFingerprints?.[0]?.primarySurface ?? '—'}` },
			],
		},
		clone: {
			label: 'zero-slop pipeline',
			rows: [
				{ label: 'status', value: result.blocked ? `blocked: ${result.reason}` : result.complete ? 'complete' : 'below gate' },
				{ label: 'bbox L2 (initial → final)', value: refinement ? `${refinement.initial.loss} → ${refinement.final.loss}` : 'skipped' },
				{ label: 'max position error', value: refinement ? `${refinement.initial.maxPosError}px → ${refinement.final.maxPosError}px (gate ≤ ${plan.thresholds.localRefiner?.epsPos ?? 1.5}px)` : '—' },
				{ label: 'max scale error', value: refinement ? `${(refinement.initial.maxScaleError * 100).toFixed(2)}% → ${(refinement.final.maxScaleError * 100).toFixed(2)}% (gate ≤ ${(plan.thresholds.localRefiner?.epsScale ?? 0.02) * 100}%)` : '—' },
				{ label: 'SSIM / IoU', value: `${result.scores?.ssim ?? '—'} / ${result.scores?.iou ?? '—'} (gates ≥ ${plan.thresholds.ssimThreshold} / ${plan.thresholds.iouThreshold})` },
				{ label: 'LLM tokens', value: result.llmCalls.length },
				{ label: 'presets applied', value: plan.presetsApplied.join(', ') || 'none' },
				{ label: 'total wall-clock', value: `${Date.now() - startedAt} ms` },
			],
		},
	};
	if (!quiet) {
		printScorecard([
			{ title: 'PROBE', rows: [{ label: 'bridge', value: probe.verdict }] },
			{ title: 'SOURCE', rows: [{ label: 'input', value: `${path.resolve(input)} (${decompReport.inputKind}, ${decompReport.framesDecoded} frames @ ${fps}fps)` }] },
			{ title: 'DECOMP', rows: scorecard.decomp.rows },
			{ title: 'ZERO-SLOP PIPELINE', rows: scorecard.clone.rows },
		]);
	}
	if (mock) await mock.close();

	return {
		status: result.blocked ? 'blocked' : result.complete ? 'complete' : 'below-gate',
		probe,
		workRoot,
		decomp: {
			beatBoundaries: decompReport.beatGrid.boundaries.map((boundary) => boundary.frame),
			assets: (decompReport.assetManifest.assets ?? []).map((asset) => asset.assetId),
			background: decompReport.tokenFingerprints?.[0]?.background ?? null,
			primarySurface: decompReport.tokenFingerprints?.[0]?.primarySurface ?? null,
		},
		presetsApplied: plan.presetsApplied,
		refinement: refinement
			? {
					initialBboxL2: refinement.initial.loss,
					finalBboxL2: refinement.final.loss,
					initialMaxPosErrorPx: refinement.initial.maxPosErrorPx ?? refinement.initial.maxPosError,
					finalMaxPosErrorPx: refinement.final.maxPosErrorPx ?? refinement.final.maxPosError,
					converged: refinement.converged,
					llmTokens: refinement.llmTokens,
				}
			: null,
		scores: result.scores ?? null,
		llmCalls: result.llmCalls.length,
		durationMs: Date.now() - startedAt,
		report: path.join(workRoot, 'pipeline'),
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	cloneLive()
		.then((result) => {
			if (result.help) {
				console.log(result.help);
				return;
			}
			if (result.status !== 'complete') process.exitCode = 1;
		})
		.catch((error) => {
			console.error(`clone:live failed: ${String(error?.stack ?? error)}`);
			process.exitCode = 1;
		});
}
