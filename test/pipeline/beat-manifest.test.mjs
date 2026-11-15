/**
 * Stage 1 beat-manifest locking tests — run with `npm test`.
 *
 * Stage 1 writes an immutable beat manifest (frame indices, timestamps, cut
 * confidence scores) locked by a content digest; Stage 4/5 refinement loops
 * verify the lock before using any temporal anchor and fail loudly on drift.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	buildBeatManifest,
	writeBeatManifest,
	loadLockedBeatManifest,
	assertBeatManifestUnchanged,
	beatManifestHash,
	BEAT_MANIFEST_FILE,
} from '../../src/pipeline/beat-manifest.mjs';

const BOUNDARIES = [
	{ frame: 0, sources: ['optical'], strength: 0, audioEnergy: 0 },
	{ frame: 24, sources: ['optical', 'audio'], strength: 18, audioEnergy: 32 },
	{ frame: 60, sources: ['audio'], strength: 0, audioEnergy: 12 },
	{ frame: 96, sources: ['optical'], strength: 9, audioEnergy: 0 },
];

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'beat-manifest-'));
}

test('buildBeatManifest derives frame indices, timestamps and confidence scores', () => {
	const manifest = buildBeatManifest({ sourceHash: 'abc123', fps: 24, totalFrames: 120, boundaries: BOUNDARIES });
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.fps, 24);
	assert.equal(manifest.totalFrames, 120);
	assert.equal(manifest.beatCount, 4);
	assert.equal(manifest.locked, true);
	for (const beat of manifest.beats) {
		assert.equal(beat.seconds, Math.round((beat.frame / 24) * 100000) / 100000, 'timestamp derives from frame at fps');
		assert.ok(beat.confidence >= 0 && beat.confidence <= 1, 'confidence score is normalised');
	}
	const dual = manifest.beats.find((beat) => beat.frame === 24);
	assert.ok(dual.sources.includes('optical') && dual.sources.includes('audio'));
	assert.ok(dual.confidence > manifest.beats.find((beat) => beat.frame === 60).confidence, 'dual-channel cuts score higher than single-channel');
	assert.equal(manifest.intervals.length, 3, 'consecutive boundary pairs become beat intervals');
	assert.equal(manifest.intervals[0].durationFrames, 24);
});

test('the digest is stable and covers the beats — any change drifts', () => {
	const manifest = buildBeatManifest({ sourceHash: 'abc123', fps: 24, totalFrames: 120, boundaries: BOUNDARIES });
	const again = buildBeatManifest({ sourceHash: 'abc123', fps: 24, totalFrames: 120, boundaries: BOUNDARIES });
	assert.equal(manifest.manifestHash, again.manifestHash, 'deterministic build');
	assert.match(manifest.manifestHash, /^[0-9a-f]{16}$/);

	const drifted = { ...manifest, beats: manifest.beats.map((beat, index) => (index === 1 ? { ...beat, frame: beat.frame + 1 } : beat)) };
	const recomputed = beatManifestHash({ ...drifted, manifestHash: undefined });
	assert.notEqual(recomputed, manifest.manifestHash, 'a changed beat changes the digest');
});

test('write + load round-trips a valid lock; tampered beats fail verification', () => {
	const dir = tempDir();
	try {
		const manifest = buildBeatManifest({ sourceHash: 'abc123', fps: 24, totalFrames: 120, boundaries: BOUNDARIES });
		const written = writeBeatManifest(dir, manifest);
		assert.equal(written.replaceAll('\\', '/'), path.join(dir, BEAT_MANIFEST_FILE).replaceAll('\\', '/'));

		const loaded = loadLockedBeatManifest(dir);
		assert.equal(loaded.valid, true);
		assert.equal(loaded.drift, false);
		assert.deepEqual(loaded.manifest.beats, manifest.beats);

		// Tamper with the beats after locking — the lock must catch it.
		const tampered = JSON.parse(fs.readFileSync(path.join(dir, BEAT_MANIFEST_FILE), 'utf8'));
		tampered.beats[2].frame = 61;
		fs.writeFileSync(path.join(dir, BEAT_MANIFEST_FILE), JSON.stringify(tampered));
		const drifted = loadLockedBeatManifest(dir);
		assert.equal(drifted.valid, false, 'tampered beats fail the digest');
		assert.equal(drifted.drift, true);

		assert.throws(() => assertBeatManifestUnchanged(dir), /BEAT_MANIFEST_DRIFT/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('missing manifests and source mismatches fail with diagnosable codes', () => {
	const dir = tempDir();
	try {
		assert.throws(() => assertBeatManifestUnchanged(dir), /BEAT_MANIFEST_MISSING/);
		const manifest = buildBeatManifest({ sourceHash: 'abc123', fps: 24, totalFrames: 120, boundaries: BOUNDARIES });
		writeBeatManifest(dir, manifest);
		assert.throws(() => assertBeatManifestUnchanged(dir, { expectedSourceHash: 'other' }), /BEAT_MANIFEST_SOURCE_MISMATCH/);
		const unlocked = assertBeatManifestUnchanged(dir, { expectedSourceHash: 'abc123' });
		assert.equal(unlocked.beatCount, 4);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('downstream Stage 5 gate verifies the lock instead of re-anchoring', async () => {
	const { evaluateDiffGate } = await import('../../src/pipeline/stage5-diff.ts');
	const dir = tempDir();
	try {
		const manifest = buildBeatManifest({ sourceHash: 'abc123', fps: 24, totalFrames: 120, boundaries: BOUNDARIES });
		writeBeatManifest(dir, manifest);
		const gated = await evaluateDiffGate(0.98, 0.97, { beatManifestDir: dir });
		assert.equal(gated.beatLock.locked, true);
		assert.equal(gated.beatLock.valid, true);
		assert.equal(gated.beatLock.drift, false);

		// Drift the on-disk manifest — the gate reports the drift.
		const tampered = JSON.parse(fs.readFileSync(path.join(dir, BEAT_MANIFEST_FILE), 'utf8'));
		tampered.beats[0].frame = 1;
		fs.writeFileSync(path.join(dir, BEAT_MANIFEST_FILE), JSON.stringify(tampered));
		const driftedGate = await evaluateDiffGate(0.98, 0.97, { beatManifestDir: dir });
		assert.equal(driftedGate.beatLock.valid, false);
		assert.equal(driftedGate.beatLock.drift, true);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
