/**
 * Deterministic SVG extraction from reference keyframes — zero LLM tokens.
 *
 * Given a decoded raster (pngjs shape: `{ data, width, height }`) and a
 * foreground region, this module isolates the foreground mask and produces a
 * normalized `.svg` document. Two backends, same output contract:
 *
 *   - `vtracer` when the CLI is installed on PATH (best curve quality);
 *   - otherwise a pure-TypeScript marching-squares contour tracer with
 *     Ramer–Douglas–Peucker simplification (always available, fully
 *     deterministic: no randomness, no environment-dependent output).
 *
 * The output SVG uses a viewBox matching the crop box, `fill="currentColor"`
 * (retintable from the style spec extractor's palette) and one `<path>` per
 * traced contour. Coordinate space: the SVG's (0,0) is the crop box's top-left
 * corner, so Cavalry placement only needs the box origin — the same raster→
 * comp mapping `_mg.fromRaster` performs.
 *
 * This module is TypeScript with erasable syntax only — Node 24 runs it
 * directly under `node --test`, no build step.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Decoded raster accepted from pngjs (`PNG.sync.read`). */
export interface Raster {
	data: Uint8Array;
	width: number;
	height: number;
}

/** Axis-aligned crop region in raster pixels (top-left origin, y grows down). */
export interface CropBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SvgExtraction {
	/** Normalized SVG document text. */
	svg: string;
	/** Number of traced paths (1 for a solid glyph, more for rings/holes). */
	pathCount: number;
	/** Which backend produced the output. */
	method: "vtracer" | "marching-squares";
	/** The crop box used, so callers can map the SVG back into the comp. */
	box: CropBox;
	/** Mean color of the foreground mask, as #rrggbb. */
	foreground: string;
}

export interface SvgExtractOptions {
	/** Foreground test: alpha threshold (default 128). */
	alphaThreshold?: number;
	/** Treat pixels within this distance of `backgroundColor` as background. */
	backgroundColor?: [number, number, number];
	/** Color-distance tolerance for the background match (default 48). */
	backgroundTolerance?: number;
	/** RDP simplification epsilon in pixels (default 1). */
	epsilon?: number;
	/** Try the vtracer CLI before the marching-squares fallback (default true). */
	tryVtracer?: boolean;
}

const DEFAULT_ALPHA_THRESHOLD = 128;
const DEFAULT_BACKGROUND_TOLERANCE = 48;
const DEFAULT_EPSILON = 1;

function luma(rgb: [number, number, number]): number {
	return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
	const dr = a[0] - b[0];
	const dg = a[1] - b[1];
	const db = a[2] - b[2];
	return Math.sqrt(dr * dr + dg * dg + db * db);
}

function pixel(raster: Raster, x: number, y: number): [number, number, number, number] {
	const at = (y * raster.width + x) * 4;
	return [raster.data[at], raster.data[at + 1], raster.data[at + 2], raster.data[at + 3]];
}

function toHex([r, g, b]: [number, number, number]): string {
	const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Binary foreground mask for the crop: a pixel is foreground when its alpha
 * clears the threshold and (when a background color is given) its color sits
 * further than `backgroundTolerance` from that background.
 */
export function foregroundMask(
	raster: Raster,
	box: CropBox,
	options: SvgExtractOptions = {},
): { mask: Uint8Array; width: number; height: number; foreground: [number, number, number] } {
	const alphaThreshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
	const tolerance = options.backgroundTolerance ?? DEFAULT_BACKGROUND_TOLERANCE;
	const width = Math.max(1, Math.round(box.width));
	const height = Math.max(1, Math.round(box.height));
	const mask = new Uint8Array(width * height);
	let red = 0;
	let green = 0;
	let blue = 0;
	let count = 0;
	for (let row = 0; row < height; row++) {
		const sy = Math.round(box.y) + row;
		if (sy < 0 || sy >= raster.height) continue;
		for (let column = 0; column < width; column++) {
			const sx = Math.round(box.x) + column;
			if (sx < 0 || sx >= raster.width) continue;
			const [r, g, b, a] = pixel(raster, sx, sy);
			if (a < alphaThreshold) continue;
			if (options.backgroundColor && colorDistance([r, g, b], options.backgroundColor) <= tolerance) continue;
			mask[row * width + column] = 1;
			red += r;
			green += g;
			blue += b;
			count++;
		}
	}
	return {
		mask,
		width,
		height,
		foreground: count ? [red / count, green / count, blue / count] : [255, 255, 255],
	};
}

/**
 * Closed-contour extraction on a binary mask by boundary-edge chaining.
 *
 * Every unit edge separating an ON pixel from an OFF (or out-of-bounds) pixel
 * is emitted as a directed segment oriented so the ON side is on the right;
 * each segment then belongs to exactly one closed loop, so chaining segments
 * head-to-tail — with each segment consumed once — decomposes the mask into
 * closed contours, holes included, with no saddle ambiguity and no walker
 * that can oscillate. Deterministic: edges are generated in row-major order
 * and consumed first-in.
 */
export function traceContours(mask: Uint8Array, width: number, height: number): Array<Array<[number, number]>> {
	const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]);
	// key "x,y" → list of segment endpoints leaving that point.
	const outgoing = new Map<string, Array<[number, number]>>();
	const used = new Set<string>();
	const key = (x: number, y: number): string => `${x},${y}`;
	const pushEdge = (from: [number, number], to: [number, number]): void => {
		const k = key(from[0], from[1]);
		const list = outgoing.get(k) ?? [];
		list.push(to);
		outgoing.set(k, list);
	};
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!at(x, y)) continue;
			if (!at(x, y - 1)) pushEdge([x, y], [x + 1, y]); // top edge, ON below
			if (!at(x + 1, y)) pushEdge([x + 1, y], [x + 1, y + 1]); // right edge, ON left
			if (!at(x, y + 1)) pushEdge([x + 1, y + 1], [x, y + 1]); // bottom edge, ON above
			if (!at(x - 1, y)) pushEdge([x, y + 1], [x, y]); // left edge, ON right
		}
	}
	const contours: Array<Array<[number, number]>> = [];
	for (const [startKey, starts] of outgoing) {
		for (const firstTo of starts) {
			const [sx, sy] = startKey.split(",").map(Number);
			const startId = `${sx},${sy}>${firstTo[0]},${firstTo[1]}`;
			if (used.has(startId)) continue;
			const contour: Array<[number, number]> = [[sx, sy]];
			let current: [number, number] = firstTo;
			used.add(startId);
			let guard = width * height * 4 + 8;
			while (guard-- > 0) {
				contour.push([current[0], current[1]]);
				if (current[0] === sx && current[1] === sy) break;
				const candidates = outgoing.get(key(current[0], current[1])) ?? [];
				let advanced = false;
				for (const next of candidates) {
					const id = `${current[0]},${current[1]}>${next[0]},${next[1]}`;
					if (used.has(id)) continue;
					used.add(id);
					current = next;
					advanced = true;
					break;
				}
				if (!advanced) break;
			}
			if (contour.length >= 4) contours.push(contour);
		}
	}
	return contours;
}

/** Ramer–Douglas–Peucker on a closed polyline (first point re-appended). */
export function simplifyContour(points: Array<[number, number]>, epsilon = DEFAULT_EPSILON): Array<[number, number]> {
	if (points.length <= 4) return points;
	const closed = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
	const working = closed ? points.slice(0, -1) : points.slice();
	const keep = new Uint8Array(working.length);
	keep[0] = 1;
	keep[working.length - 1] = 1;
	const stack: Array<[number, number]> = [[0, working.length - 1]];
	while (stack.length) {
		const [first, last] = stack.pop()!;
		if (last - first < 2) continue;
		const ax = working[first][0];
		const ay = working[first][1];
		const bx = working[last][0];
		const by = working[last][1];
		const dx = bx - ax;
		const dy = by - ay;
		const lengthSquared = dx * dx + dy * dy;
		let maxDistance = -1;
		let maxIndex = -1;
		for (let index = first + 1; index < last; index++) {
			const px = working[index][0] - ax;
			const py = working[index][1] - ay;
			const t = lengthSquared > 0 ? (px * dx + py * dy) / lengthSquared : 0;
			const clamped = Math.max(0, Math.min(1, t));
			const cx = px - clamped * dx;
			const cy = py - clamped * dy;
			const distance = cx * cx + cy * cy;
			if (distance > maxDistance) {
				maxDistance = distance;
				maxIndex = index;
			}
		}
		if (maxDistance > epsilon * epsilon && maxIndex > 0) {
			keep[maxIndex] = 1;
			stack.push([first, maxIndex], [maxIndex, last]);
		}
	}
	const result: Array<[number, number]> = [];
	for (let index = 0; index < working.length; index++) {
		if (keep[index]) result.push(working[index]);
	}
	if (closed) result.push([working[0][0], working[0][1]]);
	return result;
}

/** One closed contour → `M … L … Z` path data (1-dp coordinates). */
export function contourToPathData(points: Array<[number, number]>): string {
	if (!points.length) return "";
	const parts: string[] = [`M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`];
	for (let index = 1; index < points.length; index++) {
		parts.push(`L ${points[index][0].toFixed(1)} ${points[index][1].toFixed(1)}`);
	}
	parts.push("Z");
	return parts.join(" ");
}

/**
 * Best-effort vtracer pass: returns the CLI's SVG text, or null when the
 * binary is missing/fails. Never throws — the fallback must always be tried.
 */
function tryVtracer(file: string, outDir: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("vtracer", ["--input", file, "--output", path.join(outDir, "vtracer.svg"), "--mode", "polygon"], (error) => {
			if (error) {
				resolve(null);
				return;
			}
			resolve(path.join(outDir, "vtracer.svg"));
		});
	});
}

/**
 * Extract a normalized SVG for one foreground region. Pure and deterministic
 * when vtracer is absent (which is the common Windows case), so test fixtures
 * produce byte-identical output across runs.
 */
export async function extractSvg(
	raster: Raster,
	box: CropBox,
	options: SvgExtractOptions & { outFile?: string; sourceFile?: string } = {},
): Promise<SvgExtraction | null> {
	const { mask, width, height, foreground } = foregroundMask(raster, box, options);
	let ink = 0;
	for (let index = 0; index < mask.length; index++) ink += mask[index];
	if (ink === 0) return null;

	if (options.tryVtracer !== false && options.sourceFile && options.outFile) {
		const vtracerOutput = await tryVtracer(options.sourceFile, path.dirname(options.outFile));
		if (vtracerOutput) {
			const { readFile } = await import("node:fs/promises");
			const svg = await readFile(vtracerOutput, "utf8");
			return { svg, pathCount: (svg.match(/<path/g) ?? []).length, method: "vtracer", box, foreground: toHex(foreground) };
		}
	}

	const contours = traceContours(mask, width, height);
	const epsilon = options.epsilon ?? DEFAULT_EPSILON;
	const pathData = contours
		.map((contour) => simplifyContour(contour, epsilon))
		.filter((points) => points.length >= 4)
		.map((points) => contourToPathData(points))
		.filter((data) => data.length > 0);
	if (!pathData.length) return null;
	const svg = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
		`  <g fill="${toHex(foreground)}">`,
		...pathData.map((data) => `    <path d="${data}"/>`),
		`  </g>`,
		`</svg>`,
		"",
	].join("\n");
	if (options.outFile) await writeFile(options.outFile, svg, "utf8");
	return { svg, pathCount: pathData.length, method: "marching-squares", box, foreground: toHex(foreground) };
}
