/**
 * Design-token fingerprinting for the deconstructor.
 *
 * Reads the REST frame of a segmented layer (sharpest frame, minimum optical
 * flow blur — chosen by the caller) and extracts the exact design tokens a
 * procedural rebuild needs: the dominant hex palette classified into
 * background / primary-surface / accent / text roles, the border-radius ratio,
 * and the drop-shadow estimate (offsetX, offsetY, blurRadius, opacity).
 *
 * The heavy lifting is `styleSpecExtractor`'s measured palette/radius/shadow
 * estimators; this module adds role classification (which cluster is the
 * accent?) and the comp-wide background read (the ring of pixels outside the
 * region), so the output maps 1:1 onto `_mg` set-op attributes and preset
 * parameters.
 */

import { extractStyleSpec } from '../assets/styleSpecExtractor.ts';

export const TOKEN_FINGERPRINTER_VERSION = '1.0.0';

export interface Raster {
	data: Uint8Array;
	width: number;
	height: number;
}

export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PaletteEntry {
	hex: string;
	/** Fraction of region pixels in this cluster, 0..1. */
	weight: number;
	role: 'background' | 'primarySurface' | 'accent' | 'text' | 'support';
}

export interface DropShadowEstimate {
	offsetX: number;
	offsetY: number;
	blurRadius: number;
	/** 0..1. */
	opacity: number;
	detected: boolean;
}

export interface TokenFingerprint {
	version: string;
	region: Region;
	/** Role-classified dominant palette, sorted by weight (max 6 entries). */
	palette: PaletteEntry[];
	background: string | null;
	primarySurface: string | null;
	accent: string | null;
	text: string | null;
	/** Corner radius in px plus its ratio to min(width, height). */
	borderRadius: { px: number; ratio: number; isPill: boolean };
	dropShadow: DropShadowEstimate;
	/** Typography facts when a text-like region was measured. */
	typography: { capHeightPx: number | null; weightClass: number | null; trackingPx: number | null } | null;
}

const hex2 = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
const toHex = (rgb: [number, number, number] | { r: number; g: number; b: number }): string =>
	Array.isArray(rgb) ? `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}` : `#${hex2((rgb as { r: number }).r)}${hex2((rgb as { g: number }).g)}${hex2((rgb as { b: number }).b)}`;

function luminance(rgb: [number, number, number]): number {
	return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function saturation(rgb: [number, number, number]): number {
	const max = Math.max(rgb[0], rgb[1], rgb[2]);
	const min = Math.min(rgb[0], rgb[1], rgb[2]);
	return max === 0 ? 0 : (max - min) / max;
}

/** Median color of the pixel ring just OUTSIDE the region — the comp background behind the layer. */
export function measureSurroundingBackground(raster: Raster, region: Region, band = 6): string | null {
	const x0 = Math.max(0, region.x - band);
	const y0 = Math.max(0, region.y - band);
	const x1 = Math.min(raster.width, region.x + region.width + band);
	const y1 = Math.min(raster.height, region.y + region.height + band);
	const counts = new Map<string, number>();
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const inside = x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
			if (inside) continue;
			const offset = (y * raster.width + x) * 4;
			const key = `${raster.data[offset] >> 3},${raster.data[offset + 1] >> 3},${raster.data[offset + 2] >> 3}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	let bestKey: string | null = null;
	let bestCount = 0;
	for (const [key, count] of counts) {
		if (count > bestCount) {
			bestCount = count;
			bestKey = key;
		}
	}
	if (!bestKey) return null;
	const [r, g, b] = bestKey.split(',').map((part) => Number(part) * 8 + 4);
	return toHex([r, g, b]);
}

/**
 * Extract the full token fingerprint for one layer region on a rest frame.
 * Deterministic: same raster + region in, byte-identical fingerprint out.
 */
export function extractTokenFingerprint(raster: Raster, region: Region, options: { paletteK?: number } = {}): TokenFingerprint {
	const spec = extractStyleSpec(raster, region, options.paletteK ?? 5);
	// styleSpecExtractor's palette entries: { hex, share, rgb } (sorted by share).
	const clusters = (spec.palette ?? []).map((entry) => ({
		hex: String(entry.hex),
		weight: Number((entry as { share?: number }).share ?? (entry as { weight?: number }).weight ?? 0),
		rgb: parseHex(String(entry.hex)),
	}));

	const roles = classifyRoles(clusters);
	const radiusPx = Number(spec.cornerRadius ?? 0);
	const minSide = Math.max(1, Math.min(region.width, region.height));
	const shadow = spec.dropShadow ?? {};

	return {
		version: TOKEN_FINGERPRINTER_VERSION,
		region,
		palette: clusters.slice(0, 6).map((cluster) => ({ hex: cluster.hex, weight: Math.round(cluster.weight * 10000) / 10000, role: roles.get(cluster.hex) ?? 'support' })),
		background: measureSurroundingBackground(raster, region),
		primarySurface: roles.primarySurface ?? null,
		accent: roles.accent ?? null,
		text: roles.text ?? null,
		borderRadius: {
			px: Math.round(radiusPx * 100) / 100,
			ratio: Math.round((radiusPx / minSide) * 10000) / 10000,
			isPill: spec.cornerIsPill === true,
		},
		dropShadow: {
			offsetX: Math.round(Number(shadow.offsetX ?? 0) * 100) / 100,
			offsetY: Math.round(Number(shadow.offsetY ?? 0) * 100) / 100,
			blurRadius: Math.round(Number(shadow.blurRadius ?? 0) * 100) / 100,
			opacity: Math.round(Number(shadow.opacity ?? 0) * 10000) / 10000,
			detected: Boolean(shadow.detected) || Number(shadow.opacity ?? 0) > 0.02,
		},
		typography: spec.typography
			? {
					capHeightPx: spec.typography.capHeightPx ?? null,
					weightClass: spec.typography.weightClass ?? null,
					trackingPx: spec.typography.trackingPx ?? null,
				}
			: null,
	};
}

function parseHex(hex: string): [number, number, number] {
	const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
	if (!match) return [128, 128, 128];
	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Role classification over the measured clusters. Deterministic rules, in
 * order: the lightest-and-smallest cluster with high saturation is the text
 * ink if the surface is dark (or the darkest small cluster when the surface
 * is light); the most saturated non-surface cluster is the accent; the
 * highest-weight cluster is the primary surface; everything else supports.
 */
function classifyRoles(clusters: Array<{ hex: string; weight: number; rgb: [number, number, number] }>): { primarySurface?: string; accent?: string; text?: string } & Map<string, PaletteEntry['role']> {
	const roles = new Map<string, PaletteEntry['role']>();
	if (!clusters.length) return Object.assign(roles, {});
	const sorted = [...clusters].sort((a, b) => b.weight - a.weight);
	const surface = sorted[0];
	roles.set(surface.hex, 'primarySurface');

	const surfaceLum = luminance(surface.rgb);
	// Accent: the most saturated cluster that is not the surface, with a real
	// weight so an anti-aliasing sliver cannot claim the role.
	const accentCandidates = sorted
		.slice(1)
		.filter((cluster) => cluster.weight >= 0.03)
		.sort((a, b) => saturation(b.rgb) - saturation(a.rgb) || b.weight - a.weight);
	const accent = accentCandidates[0];
	if (accent) roles.set(accent.hex, 'accent');

	// Text ink: extreme luminance against the surface, small weight.
	const textCandidates = sorted
		.slice(1)
		.filter((cluster) => cluster !== accent)
		.filter((cluster) => (surfaceLum < 0.5 ? luminance(cluster.rgb) > 0.7 : luminance(cluster.rgb) < 0.3))
		.sort((a, b) => a.weight - b.weight);
	if (textCandidates[0]) roles.set(textCandidates[0].hex, 'text');

	return Object.assign(roles, { primarySurface: surface.hex, accent: accent?.hex, text: textCandidates[0]?.hex });
}

/** The `_mg` set-op attrs a fingerprint maps onto (the deconstructor's output contract). */
export function fingerprintToMgAttrs(fingerprint: TokenFingerprint): Record<string, unknown> {
	const attrs: Record<string, unknown> = {};
	if (fingerprint.primarySurface) attrs['material.fillColor'] = fingerprint.primarySurface;
	if (fingerprint.borderRadius.px > 0) attrs['generator.rounding'] = fingerprint.borderRadius.px;
	if (fingerprint.dropShadow.detected) {
		attrs['dropShadow.offsetX'] = fingerprint.dropShadow.offsetX;
		attrs['dropShadow.offsetY'] = fingerprint.dropShadow.offsetY;
		attrs['dropShadow.blurRadius'] = fingerprint.dropShadow.blurRadius;
		attrs['dropShadow.opacity'] = Math.round(fingerprint.dropShadow.opacity * 100);
	}
	return attrs;
}
