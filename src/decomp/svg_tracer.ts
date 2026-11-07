/**
 * Clean vector & matte extraction for the deconstructor.
 *
 * Given a segmented foreground crop on a rest frame, this module produces the
 * exact asset Cavalry should animate instead of a primitive approximation:
 *
 *   - a traced SVG path string (via `svgExtractor`'s marching-squares tracer)
 *     for non-primitive icons/logos, written to disk as a clean `.svg`;
 *   - or a cropped transparent PNG when the caller prefers a matte;
 *   - registered into a local asset manifest with provenance (source frame,
 *     crop box, foreground color, path count), and turned into the ready
 *     Stallion import payload (scene-URI file references + the atomic
 *     `api.convertSVGToLayers` script `stallionAssetBinder` already ships).
 *
 * No pixel becomes a guessed primitive: anything that cannot be traced
 * cleanly (no foreground pixels, opaque noise) is reported as `failed` with
 * the reason rather than approximated.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { extractSvg, type CropBox, type Raster } from '../assets/svgExtractor.ts';
import { buildAssetImportScript, toSceneUri, type BindableAsset } from '../assets/stallionAssetBinder.ts';

export const SVG_TRACER_VERSION = '1.0.0';

export interface TracedAsset {
	assetId: string;
	kind: 'svg' | 'png';
	/** Absolute file path of the traced artifact. */
	file: string;
	/** Scene URI form (forward slashes) for the Cavalry import payload. */
	sceneUri: string;
	/** The crop box on the rest frame, so the comp placement is reconstructable. */
	box: CropBox;
	/**
	 * The measured bounding box of the actual foreground pixels inside the
	 * crop — tighter than `box` whenever the crop padding includes background,
	 * and the geometry a rebuild should use for the layer.
	 */
	foregroundBox: CropBox;
	sourceFrame: number;
	pathCount: number;
	foreground: string;
	tracer: string;
}

export interface TraceFailure {
	assetId: string;
	reason: string;
}

export interface DecompAssetManifest {
	version: string;
	restFrame: number;
	assets: TracedAsset[];
	failures: TraceFailure[];
}

export interface TraceOptions {
	/** Output directory for traced artifacts (created on demand). */
	outDir: string;
	/** Background color of the rest frame, for the alpha matte (default: read from the frame edge). */
	backgroundColor?: [number, number, number];
	/** Color-distance tolerance for the background match (default 48). */
	backgroundTolerance?: number;
	/** Emit a transparent PNG matte instead of (or next to) the SVG. */
	alsoPng?: boolean;
	/** Color-distance threshold that splits a solid glyph into its own layer. */
	colorLayers?: boolean;
}

/**
 * Trace ONE segmented foreground crop into a clean SVG (and optionally a
 * transparent PNG matte), register it in the manifest shape, and return the
 * failure reason instead of a guess when the crop has no usable foreground.
 */
export async function traceAsset(input: { assetId: string; raster: Raster; box: CropBox; sourceFrame: number; options: TraceOptions }): Promise<TracedAsset | TraceFailure> {
	const { assetId, raster, box, sourceFrame, options } = input;
	if (!assetId || /[\\/:*?"<>|]/.test(assetId)) {
		return { assetId, reason: 'assetId is empty or not filesystem-safe' };
	}
	await fs.mkdir(options.outDir, { recursive: true });
	const background = options.backgroundColor ?? edgeBackground(raster);
	const crop = cropRaster(raster, box);
	if (!hasForeground(crop, background, options.backgroundTolerance ?? 48)) {
		return { assetId, reason: 'no foreground pixels in crop' };
	}
	const safeId = assetId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
	let svgFile: string | null = null;
	let pathCount = 0;
	let foreground = '#000000';
	const foregroundBox = measureForegroundBox(crop, background, options.backgroundTolerance ?? 48);
	try {
		const extraction = await extractSvg(raster, box, {
			outFile: path.join(options.outDir, `${safeId}.svg`),
			backgroundColor: background,
			backgroundTolerance: options.backgroundTolerance ?? 48,
		});
		if (!extraction) return { assetId, reason: 'tracer produced no paths' };
		svgFile = path.join(options.outDir, `${safeId}.svg`);
		pathCount = extraction.pathCount;
		foreground = extraction.foreground;
	} catch (error) {
		return { assetId, reason: `trace failed: ${String((error as Error)?.message ?? error)}` };
	}
	if (options.alsoPng) {
		await writeTransparentPng(path.join(options.outDir, `${safeId}.png`), crop, background, options.backgroundTolerance ?? 48);
	}
	return {
		assetId: safeId,
		kind: 'svg',
		file: svgFile,
		sceneUri: toSceneUri(svgFile),
		box,
		foregroundBox: {
			x: box.x + foregroundBox.x,
			y: box.y + foregroundBox.y,
			width: foregroundBox.width,
			height: foregroundBox.height,
		},
		sourceFrame,
		pathCount,
		foreground,
		tracer: SVG_TRACER_VERSION,
	};
}

/** Bounding box of foreground pixels inside a crop, in crop-local coordinates. */
function measureForegroundBox(crop: ReturnType<typeof cropRaster>, background: [number, number, number], tolerance: number): CropBox {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < crop.height; y++) {
		for (let x = 0; x < crop.width; x++) {
			const offset = ((crop.offsetY + y) * crop.stride + (crop.offsetX + x)) * 4;
			const distance = Math.hypot(
				crop.data[offset] - background[0],
				crop.data[offset + 1] - background[1],
				crop.data[offset + 2] - background[2],
			);
			if (distance <= tolerance) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (maxX < 0) return { x: 0, y: 0, width: crop.width, height: crop.height };
	return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export interface StallionImportPayload {
	/** Ready-to-execute atomic script body (api.convertSVGToLayers per asset). */
	script: string;
	/** The same assets in `_mg` layer form, for a manifest that references files. */
	layers: Array<{ as: string; kind: 'svg'; file: string; name: string }>;
	count: number;
}

/** The Stallion import payload: Cavalry animates the exact asset, not an approximation. */
export function buildStallionImportPayload(manifest: DecompAssetManifest): StallionImportPayload {
	const bindable: BindableAsset[] = manifest.assets.map((asset) => ({
		id: asset.assetId,
		file: asset.file,
		kind: 'svg',
		bbox: { x: asset.box.x, y: asset.box.y, width: asset.box.width, height: asset.box.height },
	}));
	return {
		script: buildAssetImportScript(bindable, `decomp-${manifest.restFrame}`),
		layers: manifest.assets.map((asset) => ({ as: `$${asset.assetId}`, kind: 'svg' as const, file: asset.sceneUri, name: asset.assetId })),
		count: manifest.assets.length,
	};
}

// ---------------------------------------------------------------------------
// Raster helpers (transparent matte + background estimation)
// ---------------------------------------------------------------------------

function cropRaster(raster: Raster, box: CropBox): Raster & { stride: number; offsetX: number; offsetY: number } {
	const x0 = Math.max(0, Math.floor(box.x));
	const y0 = Math.max(0, Math.floor(box.y));
	const x1 = Math.min(raster.width, Math.ceil(box.x + box.width));
	const y1 = Math.min(raster.height, Math.ceil(box.y + box.height));
	return {
		data: raster.data,
		width: Math.max(0, x1 - x0),
		height: Math.max(0, y1 - y0),
		stride: raster.width,
		offsetX: x0,
		offsetY: y0,
	};
}

/** Median color of the frame's 4-px edge ring — the rest frame's background. */
function edgeBackground(raster: Raster): [number, number, number] {
	const band = 4;
	const rs: number[] = [];
	const gs: number[] = [];
	const bs: number[] = [];
	const push = (x: number, y: number) => {
		const offset = (y * raster.width + x) * 4;
		rs.push(raster.data[offset]);
		gs.push(raster.data[offset + 1]);
		bs.push(raster.data[offset + 2]);
	};
	for (let x = 0; x < raster.width; x += 2) {
		for (const y of [0, 1, 2, 3, raster.height - 4, raster.height - 3, raster.height - 2, raster.height - 1]) push(x, y);
	}
	for (let y = 0; y < raster.height; y += 2) {
		for (const x of [0, 1, 2, 3, raster.width - 4, raster.width - 3, raster.width - 2, raster.width - 1]) push(x, y);
	}
	rs.sort((a, b) => a - b);
	gs.sort((a, b) => a - b);
	bs.sort((a, b) => a - b);
	const median = (values: number[]): number => (values.length ? values[Math.floor(values.length / 2)] : 0);
	return [median(rs), median(gs), median(bs)];
}

function hasForeground(crop: ReturnType<typeof cropRaster>, background: [number, number, number], tolerance: number): boolean {
	let foregroundPixels = 0;
	for (let y = 0; y < crop.height; y++) {
		for (let x = 0; x < crop.width; x++) {
			const offset = ((crop.offsetY + y) * crop.stride + (crop.offsetX + x)) * 4;
			const distance = Math.hypot(
				crop.data[offset] - background[0],
				crop.data[offset + 1] - background[1],
				crop.data[offset + 2] - background[2],
			);
			if (distance > tolerance) foregroundPixels++;
		}
	}
	return foregroundPixels >= Math.max(16, Math.floor(crop.width * crop.height * 0.005));
}

/** Write a transparent PNG matte: background pixels get alpha 0, foreground keeps its color. */
async function writeTransparentPng(file: string, crop: ReturnType<typeof cropRaster>, background: [number, number, number], tolerance: number): Promise<void> {
	const image = new PNG({ width: Math.max(1, crop.width), height: Math.max(1, crop.height) });
	for (let y = 0; y < crop.height; y++) {
		for (let x = 0; x < crop.width; x++) {
			const source = ((crop.offsetY + y) * crop.stride + (crop.offsetX + x)) * 4;
			const target = (y * image.width + x) * 4;
			const distance = Math.hypot(
				crop.data[source] - background[0],
				crop.data[source + 1] - background[1],
				crop.data[source + 2] - background[2],
			);
			const alpha = distance > tolerance ? 255 : 0;
			image.data[target] = crop.data[source];
			image.data[target + 1] = crop.data[source + 1];
			image.data[target + 2] = crop.data[source + 2];
			image.data[target + 3] = alpha;
		}
	}
	await fs.writeFile(file, PNG.sync.write(image));
}
