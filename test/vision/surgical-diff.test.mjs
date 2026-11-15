/**
 * Surgical Stage 5 → Stage 4 delta patching tests — run with `npm test`.
 *
 * Failing pixel regions are segmented into spatial bounding boxes, mapped
 * against projected Stage 4 layer boxes to identify failing layer ids and
 * time ranges, and converted into a minimal single-shot `_mg.patch()` IIFE
 * that targets only the divergent layers — no full scene recompile.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	segmentDiffRegions,
	mapRegionsToLayers,
	deriveCorrections,
	buildSurgicalPatchScript,
	buildSurgicalPatchFromFrame,
} from '../../src/vision/surgical-diff.mjs';

const WIDTH = 320;
const HEIGHT = 240;

function frame(fill) {
	return { width: WIDTH, height: HEIGHT, data: Buffer.alloc(WIDTH * HEIGHT * 4, 0).fill(0) };
}

function fillRect(image, box, rgb) {
	for (let y = box.y; y < box.y + box.height; y++) {
		for (let x = box.x; x < box.x + box.width; x++) {
			if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) continue;
			const p = (y * WIDTH + x) * 4;
			image.data[p] = rgb[0];
			image.data[p + 1] = rgb[1];
			image.data[p + 2] = rgb[2];
			image.data[p + 3] = 255;
		}
	}
}

test('segmentDiffRegions clusters divergent pixels into tight bounding boxes', () => {
	const reference = frame(0);
	const render = frame(0);
	// Two separate divergent blobs.
	fillRect(render, { x: 20, y: 30, width: 40, height: 24 }, [255, 0, 0]);
	fillRect(render, { x: 220, y: 150, width: 60, height: 40 }, [0, 255, 0]);

	const regions = segmentDiffRegions(reference, render, { changedPixelDelta: 24, cellSize: 32, minCellEnergy: 6 });
	assert.equal(regions.length, 2, `expected two regions, got ${regions.length}: ${JSON.stringify(regions)}`);
	for (const region of regions) {
		assert.ok(region.width > 0 && region.height > 0);
		assert.ok(region.cells >= 1);
	}
	// The regions must cover the two blobs without spanning the whole frame.
	const totalArea = regions.reduce((sum, r) => sum + r.width * r.height, 0);
	assert.ok(totalArea < WIDTH * HEIGHT / 3, `regions stay local (area ${totalArea} of ${WIDTH * HEIGHT})`);
});

test('identical frames produce no regions', () => {
	const reference = frame(0);
	fillRect(reference, { x: 5, y: 5, width: 100, height: 80 }, [30, 30, 30]);
	const regions = segmentDiffRegions(reference, { ...reference, data: Buffer.from(reference.data) });
	assert.deepEqual(regions, []);
});

test('dimension mismatches are rejected', () => {
	assert.throws(() => segmentDiffRegions(frame(0), { width: 10, height: 10, data: Buffer.alloc(400) }), /dimensions differ/);
});

test('mapRegionsToLayers identifies failing layer ids and time ranges', () => {
	const reference = frame(0);
	const render = frame(0);
	fillRect(render, { x: 40, y: 40, width: 50, height: 50 }, [255, 255, 255]);
	const regions = segmentDiffRegions(reference, render, { cellSize: 32, minCellEnergy: 6 });

	const layerBoxes = [
		{ layerId: 'card_a', frame: 12, box: { x: 30, y: 30, width: 80, height: 80 } },
		{ layerId: 'card_b', frame: 12, box: { x: 250, y: 200, width: 60, height: 30 } },
		{ layerId: 'card_a', frame: 24, box: { x: 30, y: 30, width: 80, height: 80 } },
	];
	const failures = mapRegionsToLayers(regions, layerBoxes, { minOverlapPct: 0.25 });
	assert.equal(failures.length, 1, 'only the overlapping layer is implicated');
	assert.equal(failures[0].layerId, 'card_a');
	assert.deepEqual(failures[0].frames, [12, 24], 'both time ranges carrying the failing layer are reported');
	assert.ok(failures[0].regions.length >= 1);
	assert.ok(failures[0].coveragePct >= 0.25);
});

test('buildSurgicalPatchScript emits a minimal single-shot _mg.patch IIFE', () => {
	const script = buildSurgicalPatchScript(
		[
			{
				layerId: 'card_a',
				frames: [12, 24],
				regions: [{ x: 32, y: 32, width: 64, height: 64, energy: 9, cells: 4 }],
				coveragePct: 0.5,
			},
			{
				layerId: 'card_c',
				frames: [30],
				regions: [{ x: 200, y: 150, width: 96, height: 32, energy: 5, cells: 3 }],
				coveragePct: 0.4,
			},
		],
		{ iteration: 3, shotId: 'shot-002' },
	);
	assert.ok(script.includes('_mg.patch('), 'the emitted script is a single-shot _mg.patch call');
	assert.ok(script.includes('iteration 3'));
	assert.ok(script.includes('card_a') && script.includes('card_c'), 'only the failing layers are targeted');
	assert.ok(script.includes('"frame":12'), 'the patch is frame-targeted at the divergent frame');
	assert.ok(!script.includes('_mg.keyframe'), 'no keyframe baking');
	assert.ok(!script.includes('_mg.behavior') && !script.includes('_mg.duplicator'), 'no node creation');
	// The script is syntactically valid JS with _mg defined.
	const mgCalls = [];
	const mg = { patch: (spec) => mgCalls.push(spec) };
	new Function('_mg', script)(mg);
	assert.equal(mgCalls.length, 1);
	assert.equal(mgCalls[0].length, 2);
	assert.equal(mgCalls[0][0].target, 'card_a');
});

test('deriveCorrections proposes position deltas and scale ratios from the dominant region', () => {
	const corrections = deriveCorrections({
		layerId: 'card_a',
		frames: [12],
		regions: [{ x: 48, y: 64, width: 200, height: 100, cells: 9 }],
		coveragePct: 0.6,
	});
	assert.equal(corrections.target, 'card_a');
	assert.deepEqual(corrections.delta, { 'position.x': 48, 'position.y': 64 });
	assert.deepEqual(corrections.multiply, { 'scale.x': 2, 'scale.y': 1 });
});

test('buildSurgicalPatchFromFrame returns null when nothing maps to a Stage 4 layer', () => {
	const reference = frame(0);
	const render = frame(0);
	fillRect(render, { x: 0, y: 0, width: 50, height: 50 }, [255, 0, 0]);
	const result = buildSurgicalPatchFromFrame(reference, render, [
		{ layerId: 'elsewhere', frame: 0, box: { x: 260, y: 200, width: 40, height: 30 } },
	]);
	assert.equal(result, null, 'no mapped layer -> caller falls back to the full Stage 4 recompile');
});
