/**
 * Stage 1 beat-manifest locking (`src/pipeline/beat-manifest.mjs`).
 *
 * Stage 1 emits an IMMUTABLE beat manifest — integer frame indices, seconds
 * timestamps, source channels and cut-confidence scores — and locks it with a
 * content digest. Every downstream Stage 4/5 refinement round re-loads the
 * manifest and verifies the digest before using any temporal anchor, so an
 * iterative refinement loop can never drift off the anchors the cuts were
 * detected on: a mutated or stale manifest fails the verification instead of
 * silently re-anchoring the timeline.
 *
 * All recorded paths are POSIX-normalised (forward slashes) so Windows
 * development and Ubuntu CI runners produce identical manifests.
 */

import fs from 'node:fs';
import path from 'node:path';

export const BEAT_MANIFEST_SCHEMA_VERSION = 1;
export const BEAT_MANIFEST_FILE = 'beat-manifest.json';

/** FNV-1a 32-bit dual-lane digest over the canonical manifest body. */
export function beatManifestHash(manifest) {
	const body = {
		schemaVersion: manifest.schemaVersion,
		sourceHash: manifest.sourceHash,
		fps: manifest.fps,
		totalFrames: manifest.totalFrames,
		beats: manifest.beats,
	};
	const canonical = JSON.stringify(body);
	let hi = 0x811c9dc5 >>> 0;
	let lo = 0x1b873593 >>> 0;
	for (let i = 0; i < canonical.length; i++) {
		const ch = canonical.charCodeAt(i);
		hi = Math.imul((hi ^ (ch & 0xff)) >>> 0, 0x01000193) >>> 0;
		lo = Math.imul((lo ^ ((ch >>> 8) & 0xff)) >>> 0, 0x01000193) >>> 0;
	}
	const hex = (n) => {
		let out = '';
		for (let s = 28; s >= 0; s -= 4) out += ((n >>> s) & 0xf).toString(16);
		return out;
	};
	return hex(hi) + hex(lo);
}

/**
 * Build the immutable beat manifest from a Stage 1 beat grid.
 *
 * @param {object} input
 * @param {string} input.sourceHash     content hash of the reference media
 * @param {number} input.fps            detection frame rate
 * @param {number} input.totalFrames    decoded frame count
 * @param {Array<{frame:number, sources?:string[], strength?:number, audioEnergy?:number}>} input.boundaries
 *        Stage 1 boundaries (as produced by computeBeatGrid / detectBoundaries)
 * @param {Array<{startFrame:number, endFrame:number, durationFrames:number, sources?:string[]}>} [input.beats]
 *        Consecutive boundary pairs; derived from boundaries when omitted
 */
export function buildBeatManifest(input) {
	if (!input || typeof input !== 'object') throw new Error('buildBeatManifest: input object is required');
	const fps = Number(input.fps);
	if (!Number.isFinite(fps) || fps <= 0) throw new Error('buildBeatManifest: positive fps is required');
	const totalFrames = Math.round(Number(input.totalFrames ?? 0));
	const sourceHash = String(input.sourceHash ?? '');
	if (!sourceHash) throw new Error('buildBeatManifest: sourceHash is required');
	const boundaries = Array.isArray(input.boundaries) ? input.boundaries : [];

	const beats = boundaries
		.map((boundary, index) => {
			const frame = Math.round(Number(boundary.frame));
			if (!Number.isFinite(frame) || frame < 0) throw new Error(`buildBeatManifest: boundary ${index} has an invalid frame`);
			const strength = Number(boundary.strength ?? 0);
			const audioEnergy = Number(boundary.audioEnergy ?? 0);
			// Cut confidence: optical strength and audio transient energy are both
			// unbounded measurements, so each saturates onto [0,1] and the two
			// channels average (a boundary supported by both evidence channels
			// scores highest).
			const optical = Number.isFinite(strength) && strength > 0 ? Math.min(1, strength / 20) : 0;
			const audio = Number.isFinite(audioEnergy) && audioEnergy > 0 ? Math.min(1, audioEnergy / 40) : 0;
			const channels = (optical > 0 ? 1 : 0) + (audio > 0 ? 1 : 0);
			const confidence = channels === 0 ? 0 : Math.round(((optical + audio) / channels) * 10000) / 10000;
			return {
				index,
				frame,
				seconds: Math.round((frame / fps) * 100000) / 100000,
				sources: Array.isArray(boundary.sources) && boundary.sources.length ? boundary.sources.slice() : (audio > 0 ? ['audio'] : ['optical']),
				confidence,
			};
		})
		.sort((a, b) => a.frame - b.frame || a.index - b.index)
		.map((beat, index) => ({ ...beat, index }));

	const pairs = [];
	for (let i = 0; i + 1 < beats.length; i++) {
		const start = beats[i];
		const end = beats[i + 1];
		pairs.push({
			index: i,
			startFrame: start.frame,
			endFrame: end.frame,
			durationFrames: end.frame - start.frame,
			startSeconds: start.seconds,
			endSeconds: end.seconds,
			sources: start.sources,
		});
	}

	const manifest = {
		schemaVersion: BEAT_MANIFEST_SCHEMA_VERSION,
		sourceHash,
		fps,
		totalFrames,
		beatCount: beats.length,
		beats,
		intervals: pairs,
	};
	manifest.manifestHash = beatManifestHash({ ...manifest, manifestHash: undefined });
	manifest.locked = true;
	return manifest;
}

/** Normalise a manifest path to forward slashes (the repo's path contract). */
function posixPath(p) {
	return String(p).replaceAll('\\', '/');
}

/**
 * Write the locked manifest. The write is atomic-enough for the pipeline: a
 * temp file in the same directory, fsynced, then renamed — a reader never
 * observes a half-written lock.
 */
export function writeBeatManifest(dir, manifest) {
	const target = path.join(dir, BEAT_MANIFEST_FILE);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const body = JSON.stringify(manifest, null, 2) + '\n';
	const temp = path.join(dir, `${BEAT_MANIFEST_FILE}.tmp-${process.pid}-${Date.now()}`);
	const fd = fs.openSync(temp, 'w');
	try {
		fs.writeFileSync(fd, body, 'utf8');
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(temp, target);
	return posixPath(target);
}

/**
 * Load a locked manifest and verify its digest.
 *
 * @returns {{ manifest: object, valid: boolean, computedHash: string|null, drift: boolean }}
 *   `valid` is false when the file is missing, unreadable, schema-incompatible
 *   or its beats no longer match the locked digest (drift).
 */
export function loadLockedBeatManifest(dir) {
	const target = path.join(dir, BEAT_MANIFEST_FILE);
	let raw;
	try {
		raw = fs.readFileSync(target, 'utf8');
	} catch {
		return { manifest: null, valid: false, computedHash: null, drift: false, missing: true };
	}
	let manifest;
	try {
		manifest = JSON.parse(raw);
	} catch {
		return { manifest: null, valid: false, computedHash: null, drift: false, corrupt: true };
	}
	const recorded = manifest && typeof manifest.manifestHash === 'string' ? manifest.manifestHash : null;
	if (!recorded || manifest.locked !== true || !Array.isArray(manifest.beats)) {
		return { manifest, valid: false, computedHash: null, drift: false, invalidSchema: true };
	}
	const computed = beatManifestHash({ ...manifest, manifestHash: undefined });
	return { manifest, valid: computed === recorded, computedHash: computed, drift: computed !== recorded };
}

/**
 * Assert the locked manifest is intact and — when `expectedSourceHash` is
 * given — that it belongs to the media currently being refined. Throws with a
 * diagnosable code so a Stage 4/5 loop fails loudly instead of drifting.
 */
export function assertBeatManifestUnchanged(dir, { expectedSourceHash } = {}) {
	const { manifest, valid, computedHash, drift, missing, corrupt, invalidSchema } = loadLockedBeatManifest(dir);
	if (missing) throw new Error(`BEAT_MANIFEST_MISSING: no locked beat manifest in ${posixPath(dir)} — Stage 1 must lock one before Stage 4/5 refinement runs.`);
	if (corrupt) throw new Error(`BEAT_MANIFEST_CORRUPT: ${posixPath(dir)} is not valid JSON.`);
	if (invalidSchema) throw new Error(`BEAT_MANIFEST_INVALID: ${posixPath(dir)} is not a locked beat manifest.`);
	if (expectedSourceHash && manifest.sourceHash !== expectedSourceHash) {
		throw new Error(`BEAT_MANIFEST_SOURCE_MISMATCH: manifest covers ${manifest.sourceHash}, refinement input is ${expectedSourceHash}.`);
	}
	if (drift || !valid) {
		throw new Error(`BEAT_MANIFEST_DRIFT: beats in ${posixPath(dir)} changed after locking (locked=${manifest.manifestHash}, computed=${computedHash}).`);
	}
	return manifest;
}
