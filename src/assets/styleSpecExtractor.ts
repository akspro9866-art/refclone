/**
 * Deterministic style-spec extraction from reference crops — zero LLM tokens.
 *
 * From a decoded raster plus a UI region this module measures what a clone
 * must reproduce before any model call:
 *
 *   - `dominantPalette`   — k-means over the region's pixels, seeded from a
 *     fixed LCG so the same crop always yields the same palette;
 *   - `estimateCornerRadius` — alpha-coverage analysis of the four corners;
 *   - `estimateDropShadow`   — ring scans around the box for a low-contrast
 *     halo, reported only when one is actually measurable;
 *   - `estimateTypography`   — ink profiles of a text crop: cap height, font
 *     weight class, tracking and the text's own bounding box.
 *
 * Every value is measured in reference pixels; nothing is invented. Where the
 * crop cannot support a measurement (flat color, no halo, no text) the field
 * is `null` — an unresolved value is a record, not an invitation to guess.
 */

import type { Raster } from "./svgExtractor.ts";

export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PaletteColor {
	hex: string;
	/** Share of the region's pixels in this cluster, 0..1. */
	share: number;
	rgb: [number, number, number];
}

export interface StyleSpec {
	palette: PaletteColor[];
	cornerRadius: number | null;
	cornerIsPill: boolean;
	dropShadow: { offsetX: number; offsetY: number; blurRadius: number; opacity: number } | null;
	typography: {
		capHeightPx: number | null;
		/** capHeight / 0.72 — the usual cap-height ratio for UI faces. */
		fontSizePx: number | null;
		weightClass: number | null;
		trackingPx: number | null;
		bounds: Region | null;
	} | null;
}

const round = (value: number, digits = 1): number => {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
};

const toHex = ([r, g, b]: [number, number, number]): string => {
	const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
	return `#${hex(r)}${hex(g)}${hex(b)}`;
};

/** Deterministic 32-bit LCG — the only "randomness" allowed in this module. */
function lcg(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function pixelAt(raster: Raster, x: number, y: number): [number, number, number, number] {
	const at = (y * raster.width + x) * 4;
	return [raster.data[at], raster.data[at + 1], raster.data[at + 2], raster.data[at + 3]];
}

function forEachPixel(raster: Raster, region: Region, visit: (r: number, g: number, b: number, a: number) => void): void {
	const x0 = Math.max(0, Math.round(region.x));
	const y0 = Math.max(0, Math.round(region.y));
	const x1 = Math.min(raster.width, Math.round(region.x + region.width));
	const y1 = Math.min(raster.height, Math.round(region.y + region.height));
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const [r, g, b, a] = pixelAt(raster, x, y);
			visit(r, g, b, a);
		}
	}
}

/**
 * k-means dominant colors. Seeds are k-means++ over a deterministic LCG, the
 * update loop runs to a fixed iteration cap (16) and clusters are reported
 * sorted by pixel share. `k` is clamped to the region's distinct-sample count.
 */
export function dominantPalette(raster: Raster, region: Region, k = 5): PaletteColor[] {
	const samples: Array<[number, number, number]> = [];
	forEachPixel(raster, region, (r, g, b) => samples.push([r, g, b]));
	if (!samples.length) return [];
	const clusterCount = Math.max(1, Math.min(k, 8, samples.length));
	const next = lcg(0x5eed1234);

	// k-means++ seeding on the fixed PRNG.
	const centers: Array<[number, number, number]> = [samples[Math.floor(next() * samples.length)]];
	while (centers.length < clusterCount) {
		const distances = samples.map(([r, g, b]) => {
			let best = Infinity;
			for (const [cr, cg, cb] of centers) {
				const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
				if (d < best) best = d;
			}
			return best;
		});
		const total = distances.reduce((sum, d) => sum + d, 0);
		if (total === 0) {
			centers.push(samples[Math.floor(next() * samples.length)]);
			continue;
		}
		let target = next() * total;
		let chosen = 0;
		for (let index = 0; index < distances.length; index++) {
			target -= distances[index];
			if (target <= 0) {
				chosen = index;
				break;
			}
		}
		centers.push(samples[chosen]);
	}

	const assignments = new Int32Array(samples.length);
	for (let iteration = 0; iteration < 16; iteration++) {
		let moved = false;
		for (let index = 0; index < samples.length; index++) {
			const [r, g, b] = samples[index];
			let best = 0;
			let bestDistance = Infinity;
			for (let c = 0; c < centers.length; c++) {
				const d = (r - centers[c][0]) ** 2 + (g - centers[c][1]) ** 2 + (b - centers[c][2]) ** 2;
				if (d < bestDistance) {
					bestDistance = d;
					best = c;
				}
			}
			if (assignments[index] !== best) {
				assignments[index] = best;
				moved = true;
			}
		}
		const sums = centers.map(() => [0, 0, 0, 0]);
		for (let index = 0; index < samples.length; index++) {
			const bucket = sums[assignments[index]];
			bucket[0] += samples[index][0];
			bucket[1] += samples[index][1];
			bucket[2] += samples[index][2];
			bucket[3] += 1;
		}
		for (let c = 0; c < centers.length; c++) {
			if (sums[c][3] > 0) {
				centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
			}
		}
		if (!moved && iteration > 0) break;
	}

	const counts = centers.map(() => 0);
	for (let index = 0; index < samples.length; index++) counts[assignments[index]] += 1;
	return centers
		.map((center, c) => ({
			hex: toHex(center),
			share: round(counts[c] / samples.length, 4),
			rgb: [Math.round(center[0]), Math.round(center[1]), Math.round(center[2])] as [number, number, number],
		}))
		.filter((entry) => entry.share > 0)
		.sort((a, b) => b.share - a.share);
}

/**
 * Corner radius from alpha coverage: for each corner, walk inward along the
 * region's edge rows/columns and find how far the shape's first fully-covered
 * pixel sits from the corner. A true rounded rect of radius r reports r
 * (±1 px); a sharp corner reports ~0; a pill (radius >= height/2) is flagged.
 * Requires alpha (or uniform-background) shapes; without any measurable
 * corner coverage the result is null.
 */
export function estimateCornerRadius(raster: Raster, region: Region, alphaThreshold = 128): { radius: number | null; pill: boolean } {
	const x0 = Math.max(0, Math.round(region.x));
	const y0 = Math.max(0, Math.round(region.y));
	const x1 = Math.min(raster.width - 1, Math.round(region.x + region.width) - 1);
	const y1 = Math.min(raster.height - 1, Math.round(region.y + region.height) - 1);
	const width = x1 - x0 + 1;
	const height = y1 - y0 + 1;
	if (width < 2 || height < 2) return { radius: null, pill: false };
	const solid = (x: number, y: number): boolean => pixelAt(raster, x, y)[3] >= alphaThreshold;

	const cornerInset = (cx: number, cy: number, dx: number, dy: number): number | null => {
		// Walk along the top/bottom edge from the corner; the inset is where the
		// shape first becomes solid, i.e. where the rounding ends.
		let inset: number | null = null;
		for (let step = 0; step < width; step++) {
			const x = cx + dx * step;
			if (solid(x, cy)) {
				inset = step;
				break;
			}
		}
		return inset;
	};
	const insets = [
		cornerInset(x0, y0, 1, 0),
		cornerInset(x1, y0, -1, 0),
		cornerInset(x0, y1, 1, 0),
		cornerInset(x1, y1, -1, 0),
	].filter((value): value is number => value !== null);
	if (!insets.length) return { radius: null, pill: false };
	const radius = round(insets.reduce((sum, value) => sum + value, 0) / insets.length, 1);
	return { radius, pill: radius >= height / 2 };
}

/**
 * Drop-shadow estimate from ring scans: rings of `ringPx` thickness expand
 * outward from the region; a shadow is a dark, low-saturation halo whose mean
 * luma dips below the outermost ring's (assumed background) luma. The dip's
 * weighted centroid gives the offset; the ring index where the dip vanishes
 * gives the blur radius. Returns null when no ring dips measurably.
 */
export function estimateDropShadow(
	raster: Raster,
	region: Region,
	{ rings = 6, ringPx = 2, minLumaDrop = 8 } = {},
): StyleSpec["dropShadow"] {
	const x0 = Math.round(region.x);
	const y0 = Math.round(region.y);
	const x1 = x0 + Math.round(region.width);
	const y1 = y0 + Math.round(region.height);
	const lumaOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

	const ringLuma: number[] = [];
	for (let ring = 0; ring < rings; ring++) {
		const expand = (ring + 1) * ringPx;
		let sum = 0;
		let count = 0;
		for (let y = y0 - expand; y < y1 + expand; y++) {
			for (let x = x0 - expand; x < x1 + expand; x++) {
				const insideOuter = x >= x0 - expand && x < x1 + expand && y >= y0 - expand && y < y1 + expand;
				const insideInner =
					x >= x0 - expand + ringPx && x < x1 + expand - ringPx && y >= y0 - expand + ringPx && y < y1 + expand - ringPx;
				if (!insideOuter || insideInner) continue;
				if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
				const [r, g, b] = pixelAt(raster, x, y);
				sum += lumaOf(r, g, b);
				count++;
			}
		}
		ringLuma.push(count ? sum / count : 255);
	}
	const backgroundLuma = ringLuma[ringLuma.length - 1];
	let dipRing = -1;
	for (let ring = 0; ring < rings; ring++) {
		if (backgroundLuma - ringLuma[ring] >= minLumaDrop) {
			dipRing = ring;
			break;
		}
	}
	if (dipRing < 0) return null;

	// Luma-deficit-weighted centroid of the halo band around the shape.
	let bandWeight = 0;
	let bandX = 0;
	let bandY = 0;
	for (let y = y0 - rings * ringPx; y < y1 + rings * ringPx; y++) {
		for (let x = x0 - rings * ringPx; x < x1 + rings * ringPx; x++) {
			const insideOuter = x >= x0 - rings * ringPx && x < x1 + rings * ringPx && y >= y0 - rings * ringPx && y < y1 + rings * ringPx;
			const insideShape = x >= x0 && x < x1 && y >= y0 && y < y1;
			if (!insideOuter || insideShape) continue;
			if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
			const [r, g, b] = pixelAt(raster, x, y);
			const deficit = Math.max(0, backgroundLuma - lumaOf(r, g, b));
			if (deficit < minLumaDrop) continue;
			bandWeight += deficit;
			bandX += x * deficit;
			bandY += y * deficit;
		}
	}
	if (bandWeight <= 0) return null;
	const haloCx = bandX / bandWeight;
	const haloCy = bandY / bandWeight;
	const shadowCenterX = x0 + region.width / 2;
	const shadowCenterY = y0 + region.height / 2;
	return {
		offsetX: round(haloCx - shadowCenterX, 1),
		offsetY: round(haloCy - shadowCenterY, 1),
		blurRadius: round((dipRing + 1) * ringPx, 1),
		opacity: round(Math.min(1, (backgroundLuma - ringLuma[dipRing]) / 255), 2),
	};
}

/**
 * Typography estimate from a text crop's ink profile. The text mask is
 * everything darker (or less opaque) than the region's luma median by a
 * margin; from its row/column profiles:
 *
 *   - capHeightPx   — the modal glyph band height (10th-90th percentile of
 *     row runs), which for UI copy is dominated by caps and digits;
 *   - fontSizePx    — capHeight / 0.72 (typical UI face cap ratio);
 *   - weightClass   — ink density inside the band, bucketed to the nearest
 *     {100,200,…,900} class;
 *   - trackingPx    — median gap between column runs;
 *   - bounds        — the ink bounding box.
 */
export function estimateTypography(
	raster: Raster,
	region: Region,
	{ inkPercentile = 0.45, densityBuckets = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const } = {},
): NonNullable<StyleSpec["typography"]> | null {
	const x0 = Math.max(0, Math.round(region.x));
	const y0 = Math.max(0, Math.round(region.y));
	const x1 = Math.min(raster.width, Math.round(region.x + region.width));
	const y1 = Math.min(raster.height, Math.round(region.y + region.height));
	if (x1 - x0 < 2 || y1 - y0 < 2) return null;

	const lumas: number[] = [];
	forEachPixel(raster, region, (r, g, b) => lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b));
	const sorted = lumas.slice().sort((a, b) => a - b);
	const threshold = sorted[Math.floor(sorted.length * inkPercentile)] - 6;

	const rowInk: number[] = [];
	const columnInk: number[] = [];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let inkPixels = 0;
	for (let y = y0; y < y1; y++) {
		let rowCount = 0;
		for (let x = x0; x < x1; x++) {
			const [r, g, b] = pixelAt(raster, x, y);
			const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			const ink = l < threshold;
			if (ink) {
				rowCount++;
				inkPixels++;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
			columnInk[x - x0] = (columnInk[x - x0] ?? 0) + (ink ? 1 : 0);
		}
		rowInk.push(rowCount);
	}
	if (!inkPixels) return null;

	// Glyph band heights: contiguous runs of rows that contain ink.
	const bands: number[] = [];
	let run = 0;
	for (const count of rowInk) {
		if (count > 0) run++;
		else if (run > 0) {
			bands.push(run);
			run = 0;
		}
	}
	if (run > 0) bands.push(run);
	if (!bands.length) return null;
	bands.sort((a, b) => a - b);
	const bandAt = (q: number): number => bands[Math.min(bands.length - 1, Math.floor(q * bands.length))];
	const capHeight = Math.max(1, bandAt(0.9));

	// Ink density inside the dominant band → weight class.
	const bandArea = (maxX - minX + 1) * capHeight;
	const density = bandArea > 0 ? inkPixels / bandArea : 0;
	// ~0.05 → Thin(100) … ~0.35 → Black(900) on a log ramp.
	const classIndex = Math.min(8, Math.max(0, Math.round(Math.log(Math.max(density, 0.02) / 0.05) / Math.log(1.32))));
	const weightClass = densityBuckets[classIndex];

	// Column runs → glyph gaps (tracking).
	const runs: Array<[number, number]> = [];
	let start: number | null = null;
	for (let index = 0; index < columnInk.length; index++) {
		if (columnInk[index] > 0 && start === null) start = index;
		if (columnInk[index] === 0 && start !== null) {
			runs.push([start, index - 1]);
			start = null;
		}
	}
	if (start !== null) runs.push([start, columnInk.length - 1]);
	const gaps: number[] = [];
	for (let index = 1; index < runs.length; index++) gaps.push(runs[index][0] - runs[index - 1][1] - 1);
	const tracking = gaps.length
		? round(gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)], 1)
		: 0;

	return {
		capHeightPx: capHeight,
		fontSizePx: round(capHeight / 0.72, 1),
		weightClass,
		trackingPx: tracking,
		bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
	};
}

/** Full style spec for one region; every sub-measure degrades to null independently. */
export function extractStyleSpec(raster: Raster, region: Region, paletteK = 5): StyleSpec {
	const palette = dominantPalette(raster, region, paletteK);
	const corner = estimateCornerRadius(raster, region);
	const typography = estimateTypography(raster, region);
	return {
		palette,
		cornerRadius: corner.radius,
		cornerIsPill: corner.pill,
		dropShadow: estimateDropShadow(raster, region),
		typography,
	};
}
