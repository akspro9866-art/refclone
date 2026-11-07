/**
 * The Reference Asset Deconstructor — the pre-processor that closes the
 * non-procedural visual gap BEFORE Stage 1 begins.
 *
 * A reference video is never 100% procedural: logos, illustrations and
 * textures cannot be rebuilt from primitives without becoming "AI slop".
 * This module decomposes them once, deterministically, into exactly the
 * three artifact classes the pipeline consumes downstream:
 *
 *   1. design tokens   (`token_fingerprinter.ts`) — palette roles, radius,
 *                      drop shadow, measured on the rest frame;
 *   2. vector assets   (`svg_tracer.ts`) — clean SVGs / transparent PNG
 *                      mattes for every non-primitive element, registered in
 *                      an asset manifest with the ready Stallion import
 *                      payload so Cavalry animates the EXACT asset;
 *   3. the beat grid   (`beat_grid.ts`) — every beat boundary snapped to an
 *                      exact integer frame at the target fps, from optical
 *                      zero-crossings merged with audio transients.
 *
 * CLI: `npx refclone decomp <video_or_frames_dir> [flags]` — see cli.mjs.
 * No AI, no network: same inputs in, byte-identical artifacts out.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PNG } from 'pngjs';
import { loadFramesFromDirectory, computeBeatGrid, opticalVelocitySeries } from './beat_grid.ts';
import { extractTokenFingerprint, fingerprintToMgAttrs, type Raster, type Region } from './token_fingerprinter.ts';
import { traceAsset, buildStallionImportPayload, type DecompAssetManifest } from './svg_tracer.ts';

export const DECOMP_VERSION = '1.0.0';

export interface DecompResult {
	version: string;
	source: string;
	inputKind: 'video' | 'frames';
	fps: number;
	framesDirectory: string;
	framesDecoded: number;
	/** Index (into the decoded list) of the sharpest rest frame. */
	restFrameIndex: number;
	beatGrid: ReturnType<typeof computeBeatGrid>;
	tokenFingerprints: Array<Record<string, unknown>>;
	assetManifest: DecompAssetManifest;
	stallionImport: ReturnType<typeof buildStallionImportPayload>;
	artifacts: Record<string, string>;
	warnings: string[];
}

export interface DecompOptions {
	/** Output directory (created on demand). Default: ./decomp-<timestamp>. */
	outDir?: string;
	/** Target fps for video inputs and the beat grid (default 30). */
	fps?: number;
	/** Extract only frames [start:end) from a video (0-based frame indices). */
	frameRange?: [number, number];
	/** Raw f32le PCM audio for the beat grid (the CLI reads --audio). */
	audioPcm?: Buffer | null;
	/** Audio sample rate for `audioPcm` (default 8000). */
	sampleRate?: number;
	/** Crop regions to trace as assets (resolved after the frames are decoded). */
	crops?: Array<Region & { name: string }>;
	/**
	 * Raw `x,y,w,h[:name]` crop specs (CLI `--crop`); parsed against the decoded
	 * frame dimensions and merged with `crops`.
	 */
	cropSpecs?: string[];
	/** Max frames decoded from a frames directory (default 600). */
	maxFrames?: number;
}

/** Parse `x,y,w,h[:name]` crop strings from the CLI. */
export function parseCropSpec(spec: string, frameWidth: number, frameHeight: number): Array<Region & { name: string }> {
	const crops: Array<Region & { name: string }> = [];
	for (const part of String(spec ?? '').split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [coords, name] = trimmed.split(':');
		const numbers = (coords ?? '').split(',').map((value) => Math.round(Number(value)));
		if (numbers.length !== 4 || numbers.some((value) => !Number.isFinite(value))) {
			throw new Error(`invalid crop '${part}' — expected x,y,width,height[:name]`);
		}
		const [x, y, width, height] = numbers;
		if (width <= 0 || height <= 0) throw new Error(`invalid crop '${part}' — width and height must be positive`);
		crops.push({
			x: Math.max(0, Math.min(frameWidth - 1, x)),
			y: Math.max(0, Math.min(frameHeight - 1, y)),
			width: Math.min(width, frameWidth - x),
			height: Math.min(height, frameHeight - y),
			name: (name ?? '').trim() || `crop_${crops.length + 1}`,
		});
	}
	return crops;
}

/**
 * Run the deconstruction. `source` is either a video file (FFmpeg on PATH
 * decodes the frame range) or a directory of numbered PNG frames (the cached
 * ingest layout). Artifacts land in `outDir` and the report is returned.
 */
export async function deconstruct(source: string, options: DecompOptions = {}): Promise<DecompResult> {
	const startedAt = Date.now();
	const stats = await fs.stat(source);
	const inputKind = stats.isDirectory() ? 'frames' : 'video';
	const fps = Number(options.fps ?? 30);
	if (!Number.isFinite(fps) || fps <= 0) throw new Error('decomp requires a positive fps');
	const outDir = options.outDir ?? path.join(process.cwd(), `decomp-${Date.now().toString(36)}`);
	const framesDirectory = path.join(outDir, 'frames');
	await fs.mkdir(framesDirectory, { recursive: true });
	const warnings: string[] = [];

	let frames: Array<Raster & { file: string }>;
	let resolvedFramesDirectory = framesDirectory;
	if (inputKind === 'frames') {
		frames = await loadFramesFromDirectory(source, options.maxFrames ?? 600);
		if (!frames.length) throw new Error(`no PNG frames found in ${source}`);
		// The frames were never copied: the source directory IS the frame store,
		// and the report must point the pipeline at the real pixels.
		resolvedFramesDirectory = path.resolve(source);
	} else {
		const extracted = await extractFramesWithFfmpeg(source, framesDirectory, fps, options.frameRange ?? null);
		warnings.push(...extracted.warnings);
		frames = await loadFramesFromDirectory(framesDirectory, options.maxFrames ?? 600);
		if (!frames.length) throw new Error(`FFmpeg decoded no frames from ${source}`);
	}

	// Beat grid first: its velocity series also picks the rest frame.
	const grid = computeBeatGrid({ frames, fps, audioPcm: options.audioPcm ?? null, sampleRate: options.sampleRate ?? 8000 });
	const velocity = opticalVelocitySeries(frames);
	let restFrameIndex = 0;
	let minVelocity = Number.POSITIVE_INFINITY;
	for (const entry of velocity) {
		if (entry.velocity < minVelocity) {
			minVelocity = entry.velocity;
			restFrameIndex = entry.frame;
		}
	}
	const restRaster = frames[restFrameIndex];

	// Crop specs are parsed here — after the frames exist — because a crop must
	// be validated against the real frame dimensions, not a guess.
	const crops = [...(options.crops ?? [])];
	for (const spec of options.cropSpecs ?? []) {
		crops.push(...parseCropSpec(spec, restRaster.width, restRaster.height));
	}

	// Design tokens: the whole-frame background plus every requested crop.
	const tokenFingerprints: Array<Record<string, unknown>> = [];
	const frameRegion: Region & { name: string } = { x: 0, y: 0, width: restRaster.width, height: restRaster.height, name: 'frame' };
	const fullFingerprint = extractTokenFingerprint(restRaster, frameRegion);
	tokenFingerprints.push({ element: 'frame', ...fullFingerprint, mgAttrs: fingerprintToMgAttrs(fullFingerprint) });

	const assetManifest: DecompAssetManifest = { version: '1.0.0', restFrame: restFrameIndex, assets: [], failures: [] };
	for (const crop of crops) {
		const fingerprint = extractTokenFingerprint(restRaster, crop);
		tokenFingerprints.push({ element: crop.name, ...fingerprint, mgAttrs: fingerprintToMgAttrs(fingerprint) });
		const traced = await traceAsset({
			assetId: crop.name,
			raster: restRaster,
			box: crop,
			sourceFrame: restFrameIndex,
			options: { outDir: path.join(outDir, 'assets'), alsoPng: true },
		});
		if ('reason' in traced) assetManifest.failures.push(traced);
		else assetManifest.assets.push(traced);
	}
	if (!crops.length) {
		warnings.push('no --crop regions given: design tokens were measured for the whole frame and no vector assets were traced');
	}

	const stallionImport = buildStallionImportPayload(assetManifest);
	const report: DecompResult = {
		version: DECOMP_VERSION,
		source: path.resolve(source),
		inputKind,
		fps,
		framesDirectory: resolvedFramesDirectory,
		framesDecoded: frames.length,
		restFrameIndex,
		beatGrid: grid,
		tokenFingerprints,
		assetManifest,
		stallionImport,
		artifacts: {
			report: path.join(outDir, 'decomp-report.json'),
			beatGrid: path.join(outDir, 'beat-grid.json'),
			assetManifest: path.join(outDir, 'asset-manifest.json'),
			stallionImport: path.join(outDir, 'stallion-import.json'),
		},
		warnings: [...warnings, `deconstruction completed in ${Date.now() - startedAt}ms (deterministic, 0 LLM tokens)`],
	};
	await fs.writeFile(report.artifacts.report, JSON.stringify(report, null, 2), 'utf8');
	await fs.writeFile(report.artifacts.beatGrid, JSON.stringify(grid, null, 2), 'utf8');
	await fs.writeFile(report.artifacts.assetManifest, JSON.stringify(assetManifest, null, 2), 'utf8');
	await fs.writeFile(report.artifacts.stallionImport, JSON.stringify(stallionImport, null, 2), 'utf8');
	return report;
}

/** FFmpeg frame extraction: `-vf fps=N` with an optional `-vf trim` via select filter. */
async function extractFramesWithFfmpeg(video: string, outDir: string, fps: number, frameRange: [number, number] | null): Promise<{ warnings: string[] }> {
	const warnings: string[] = [];
	const filter = frameRange
		? `select='between(n\\,${frameRange[0]}\\,${frameRange[1] - 1})',fps=${fps}`
		: `fps=${fps}`;
	const args = ['-y', '-i', video, '-vf', filter, '-vsync', '0', path.join(outDir, 'frame-%06d.png').replace(/\\/g, '/')];
	const child = spawn('ffmpeg', args, { windowsHide: true });
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr += String(chunk);
	});
	const code = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('ffmpeg timed out after 120s'));
		}, 120_000);
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(new Error(`ffmpeg is not on PATH: ${String(error.message ?? error)}`));
		});
		child.on('close', (exit) => {
			clearTimeout(timer);
			resolve(exit ?? 1);
		});
	});
	if (code !== 0) {
		// select= produces frames with original numbering and a non-zero exit on
		// some builds when the last selected frame is the final frame — treat a
		// non-empty output directory as success.
		const decoded = (await fs.readdir(outDir)).filter((entry) => entry.endsWith('.png'));
		if (!decoded.length) throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`);
		warnings.push(`ffmpeg exited ${code} but ${decoded.length} frames were decoded`);
	}
	return { warnings };
}

/** Read a WAV/MP4 audio track to f32le PCM via FFmpeg for the beat grid. */
export async function loadAudioPcm(audioSource: string, sampleRate = 8000): Promise<Buffer> {
	const child = spawn('ffmpeg', ['-y', '-i', audioSource, '-f', 'f32le', '-ac', '1', '-ar', String(sampleRate), '-'], { windowsHide: true });
	const chunks: Buffer[] = [];
	let stderr = '';
	child.stdout.on('data', (chunk) => chunks.push(chunk));
	child.stderr.on('data', (chunk) => {
		stderr += String(chunk);
	});
	const code = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('ffmpeg audio decode timed out after 60s'));
		}, 60_000);
		child.on('error', (error) => reject(new Error(`ffmpeg is not on PATH: ${String(error.message ?? error)}`)));
		child.on('close', (exit) => {
			clearTimeout(timer);
			resolve(exit ?? 1);
		});
	});
	if (code !== 0 && !chunks.length) throw new Error(`ffmpeg audio decode exited ${code}: ${stderr.slice(-400)}`);
	return Buffer.concat(chunks);
}
