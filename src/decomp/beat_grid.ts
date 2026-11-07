/**
 * Audio + optical-flow beat quantizer for the deconstructor.
 *
 * Beat boundaries must be EXACT integer frames at the target frame rate, or
 * every downstream `_mg` keyframe inherits fractional timing that Cavalry
 * then rounds inconsistently. This module derives beat candidates from two
 * independent evidence channels and snaps them to the frame grid:
 *
 *   - optical flow: per-frame global motion magnitude (block matching via
 *     `vision/optical.mjs`) → velocity series → acceleration zero-crossings
 *     (the instants motion starts or stops — cut/settle boundaries);
 *   - audio: PCM energy transients (`ingest/media.mjs`'s `pcmEnergy`) mapped
 *     from seconds to frames, used when the reference carries audio;
 *
 * then merges both channels within a tolerance (±2 frames) — a boundary both
 * channels agree on wins; a single-channel boundary is kept and labeled so
 * the caller can weigh it. Deterministic: same frames + audio in, same grid
 * out.
 */

import fs from 'node:fs';
import path from 'node:path';
import { blockFlow, accelerationZeroCrossings } from '../vision/optical.mjs';
import { pcmEnergy } from '../ingest/media.mjs';
import type { Raster } from './token_fingerprinter.ts';

export const BEAT_GRID_VERSION = '1.0.0';

export interface BeatBoundary {
	/** Exact integer frame at the target fps. */
	frame: number;
	/** Which evidence channels support this boundary. */
	sources: Array<'optical' | 'audio'>;
	/** Optical acceleration magnitude at the boundary (0 for audio-only). */
	strength: number;
	/** Audio transient energy in dBFS-ish units (0 for optical-only). */
	audioEnergy: number;
}

export interface BeatGrid {
	version: string;
	fps: number;
	totalFrames: number;
	/** Sorted, deduped boundaries; frame 0 is always present. */
	boundaries: BeatBoundary[];
	/** Consecutive boundary pairs = beats. */
	beats: Array<{ startFrame: number; endFrame: number; durationFrames: number; sources: string[] }>;
	unsnappedCandidates: Array<{ frame: number; source: string }>;
}

export interface BeatGridInput {
	/** Decoded rest-ordered frames (RGB/RGBA rasters, identical dimensions). */
	frames: Raster[];
	fps: number;
	/** Raw PCM f32le audio for the whole clip (optional). */
	audioPcm?: Buffer | null;
	/** Audio sample rate for `audioPcm` (default 8000). */
	sampleRate?: number;
	/** Merge window in frames for cross-channel agreement (default 2). */
	mergeTolerance?: number;
	/** Minimum motion magnitude change that counts as a zero-crossing candidate. */
	epsilon?: number;
}

/** Global motion magnitude between consecutive frames (block-matching mean flow). */
export function opticalVelocitySeries(frames: Raster[]): Array<{ frame: number; velocity: number }> {
	const series: Array<{ frame: number; velocity: number }> = [];
	for (let index = 1; index < frames.length; index++) {
		const flow = blockFlow(frames[index - 1], frames[index], { x: 0, y: 0, width: frames[index].width, height: frames[index].height }, { blockSize: 16, stride: 4, searchRadius: 8 });
		const magnitude = Number(flow?.magnitude ?? 0);
		series.push({ frame: index, velocity: Number.isFinite(magnitude) ? magnitude : 0 });
	}
	// Prepend frame 0 so the series aligns with frame indices.
	return [{ frame: 0, velocity: 0 }, ...series];
}

/** Audio transients as integer frames: windowed energy rises above a k·median threshold. */
export function audioOnsetFrames(audioPcm: Buffer | null | undefined, fps: number, sampleRate = 8000): Array<{ frame: number; energy: number }> {
	if (!audioPcm || audioPcm.length < 64) return [];
	const windowSamples = Math.max(64, Math.round(sampleRate / fps));
	const windows = pcmEnergy(audioPcm, sampleRate, windowSamples);
	if (!windows.length) return [];
	const energies = windows.map((window) => Number(window.energy ?? window.rms ?? 0));
	const sorted = [...energies].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
	// A transient is a window whose energy jumps on its predecessor AND is loud
	// in absolute terms (>= 4x the median floor). Rising from silence is the
	// strongest onset there is, so a zero predecessor counts as an infinite jump
	// rather than disqualifying the window.
	const onsets: Array<{ frame: number; energy: number }> = [];
	for (let index = 1; index < windows.length; index++) {
		const energy = energies[index];
		const previous = energies[index - 1];
		const jump = previous > 1e-9 ? energy / previous : energy > 0 ? Number.POSITIVE_INFINITY : 0;
		if (energy >= median * 4 && jump >= 1.6) {
			const seconds = (index * windowSamples) / sampleRate;
			const frame = Math.round(seconds * fps);
			if (!onsets.some((onset) => onset.frame === frame)) onsets.push({ frame, energy: Math.round(energy * 10000) / 10000 });
		}
	}
	return onsets;
}

/**
 * Build the snapped beat grid. Optical zero-crossings give sub-frame floats
 * (the crossing interpolates between samples) — they are rounded to the
 * nearest integer frame; audio onsets are already integer frames. Boundaries
 * from both channels within `mergeTolerance` merge and carry both sources.
 */
export function computeBeatGrid(input: BeatGridInput): BeatGrid {
	const fps = Number(input.fps);
	if (!Number.isFinite(fps) || fps <= 0) throw new Error('computeBeatGrid requires a positive fps');
	const frames = input.frames ?? [];
	if (frames.length < 3) throw new Error('computeBeatGrid requires at least 3 decoded frames');
	const mergeTolerance = Math.max(1, Math.round(input.mergeTolerance ?? 2));

	const velocity = opticalVelocitySeries(frames);
	// accelerationZeroCrossings returns plain frame numbers; the boundary's
	// strength is the velocity step at that frame (how hard motion changed).
	const crossings = accelerationZeroCrossings(velocity, { epsilon: input.epsilon ?? 1e-6 });
	const optical = crossings
		.map((crossing) => {
			const frame = Math.round(Number(crossing));
			const velocityAt = (index: number): number => (index >= 0 && index < velocity.length ? Number(velocity[index]?.velocity ?? 0) : 0);
			const strength = Math.abs(velocityAt(frame) - velocityAt(frame - 1));
			return { frame, strength: Number.isFinite(strength) ? strength : 0 };
		})
		.filter((entry) => entry.frame >= 0 && entry.frame < frames.length);
	const audio = audioOnsetFrames(input.audioPcm, fps, input.sampleRate ?? 8000).filter((entry) => entry.frame >= 0 && entry.frame < frames.length);

	// Merge: optical boundaries absorb audio onsets within tolerance.
	const boundaries: BeatBoundary[] = [];
	const consumedAudio = new Set<number>();
	for (const entry of [...optical].sort((a, b) => a.frame - b.frame)) {
		const matched = audio.findIndex((onset, index) => {
			if (consumedAudio.has(index)) return false;
			return Math.abs(onset.frame - entry.frame) <= mergeTolerance;
		});
		if (matched >= 0) {
			// The audio onset's exact integer frame wins when they disagree —
			// transient timing is sharper than interpolated zero-crossings.
			const onset = audio[matched];
			consumedAudio.add(matched);
			boundaries.push({ frame: onset.frame, sources: ['optical', 'audio'], strength: entry.strength, audioEnergy: onset.energy });
		} else {
			boundaries.push({ frame: entry.frame, sources: ['optical'], strength: entry.strength, audioEnergy: 0 });
		}
	}
	const unsnappedCandidates: Array<{ frame: number; source: string }> = [];
	audio.forEach((onset, index) => {
		if (consumedAudio.has(index)) return;
		// Standalone audio onsets below the merge window become boundaries too —
		// a beat the picture does not show is still a beat the timeline must honor.
		const near = boundaries.some((boundary) => Math.abs(boundary.frame - onset.frame) <= mergeTolerance);
		if (near) return;
		boundaries.push({ frame: onset.frame, sources: ['audio'], strength: 0, audioEnergy: onset.energy });
		unsnappedCandidates.push({ frame: onset.frame, source: 'audio' });
	});

	// Dedupe by frame (optical crossings can double-report), keep the
	// strongest-evidence entry, always include frame 0, sort.
	const byFrame = new Map<number, BeatBoundary>();
	for (const boundary of boundaries) {
		const existing = byFrame.get(boundary.frame);
		if (!existing) byFrame.set(boundary.frame, boundary);
		else {
			const sources = [...new Set([...existing.sources, ...boundary.sources])];
			byFrame.set(boundary.frame, {
				frame: boundary.frame,
				sources,
				strength: Math.max(existing.strength, boundary.strength),
				audioEnergy: Math.max(existing.audioEnergy, boundary.audioEnergy),
			});
		}
	}
	if (!byFrame.has(0)) byFrame.set(0, { frame: 0, sources: [], strength: 0, audioEnergy: 0 });
	const finalBoundaries = [...byFrame.values()].sort((a, b) => a.frame - b.frame);

	const beats: BeatGrid['beats'] = [];
	for (let index = 1; index < finalBoundaries.length; index++) {
		const start = finalBoundaries[index - 1];
		const end = finalBoundaries[index];
		beats.push({
			startFrame: start.frame,
			endFrame: end.frame,
			durationFrames: end.frame - start.frame,
			sources: [...new Set([...start.sources, ...end.sources])],
		});
	}
	return {
		version: BEAT_GRID_VERSION,
		fps,
		totalFrames: frames.length,
		boundaries: finalBoundaries,
		beats,
		unsnappedCandidates,
	};
}

// ---------------------------------------------------------------------------
// Convenience: decode frames from a directory of PNGs (the CLI path)
// ---------------------------------------------------------------------------

/** Decode numbered PNG frames (frame-000001.png style or any sorted PNG list). */
export async function loadFramesFromDirectory(directory: string, limit = 600): Promise<Array<Raster & { file: string }>> {
	const { PNG } = await import('pngjs');
	const entries = (await fs.promises.readdir(directory)).filter((entry) => entry.toLowerCase().endsWith('.png')).sort();
	const rasters: Array<Raster & { file: string }> = [];
	for (const entry of entries.slice(0, limit)) {
		const png = PNG.sync.read(await fs.promises.readFile(path.join(directory, entry)));
		rasters.push({ data: new Uint8Array(png.data), width: png.width, height: png.height, file: path.join(directory, entry) });
	}
	return rasters;
}
