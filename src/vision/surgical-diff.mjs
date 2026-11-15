/**
 * Surgical Stage 5 → Stage 4 delta patching (`src/vision/surgical-diff.mjs`).
 *
 * When the Stage 5 perceptual diff gate fails, the failing pixel regions are
 * segmented into spatial bounding boxes and mapped against the projected
 * Stage 4 layer bounding boxes to identify the SPECIFIC failing layer ids and
 * time ranges. Instead of recompiling and re-executing the entire Stage 4 DSL
 * scene script, the caller emits a minimal single-shot `_mg.patch()` IIFE that
 * targets only the divergent layers and attributes.
 *
 * Segmentation: the frame difference is gridded into `cellSize` cells, hot
 * cells (luminance delta energy above threshold) are flood-clustered into
 * 4-connected components, and each component becomes one region bbox. All
 * recorded paths stay POSIX-normalised per the repo contract.
 */

export const DEFAULT_DIFF_CELL = 32;

/**
 * Segment the failing pixel regions of one frame pair into spatial bboxes.
 *
 * @param {object} reference  { width, height, data: Uint8Array|Buffer RGBA }
 * @param {object} render     { width, height, data: Uint8Array|Buffer RGBA }
 * @param {object} [options]  { changedPixelDelta=24, cellSize=32, minCellEnergy=6 }
 * @returns {Array<{x:number,y:number,width:number,height:number,energy:number,cells:number}>}
 */
export function segmentDiffRegions(reference, render, options = {}) {
	if (!reference || !render || !reference.data || !render.data) throw new Error('segmentDiffRegions: reference and render RGBA buffers are required');
	if (reference.width !== render.width || reference.height !== render.height) {
		throw new Error('segmentDiffRegions: reference and render dimensions differ');
	}
	const changedPixelDelta = Number.isFinite(options.changedPixelDelta) ? options.changedPixelDelta : 24;
	const cellSize = Math.max(4, Math.round(options.cellSize ?? DEFAULT_DIFF_CELL));
	const minCellEnergy = Number.isFinite(options.minCellEnergy) ? options.minCellEnergy : 6;

	const width = reference.width;
	const height = reference.height;
	const columns = Math.ceil(width / cellSize);
	const rows = Math.ceil(height / cellSize);
	const energy = new Float64Array(columns * rows);
	const hot = new Uint8Array(columns * rows);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const p = (y * width + x) * 4;
			const dr = Math.abs(reference.data[p] - render.data[p]);
			const dg = Math.abs(reference.data[p + 1] - render.data[p + 1]);
			const db = Math.abs(reference.data[p + 2] - render.data[p + 2]);
			const delta = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
			if (delta > changedPixelDelta) {
				const cx = Math.min(columns - 1, Math.floor(x / cellSize));
				const cy = Math.min(rows - 1, Math.floor(y / cellSize));
				energy[cy * columns + cx] += delta;
			}
		}
	}
	for (let c = 0; c < energy.length; c++) {
		if (energy[c] >= minCellEnergy) hot[c] = 1;
	}

	// Flood-cluster 4-connected hot cells into region bounding boxes.
	const visited = new Uint8Array(columns * rows);
	const regions = [];
	for (let start = 0; start < hot.length; start++) {
		if (!hot[start] || visited[start]) continue;
		const stack = [start];
		visited[start] = 1;
		let minCol = columns, minRow = rows, maxCol = -1, maxRow = -1, total = 0;
		while (stack.length) {
			const cell = stack.pop();
			const col = cell % columns;
			const row = Math.floor(cell / columns);
			if (col < minCol) minCol = col;
			if (col > maxCol) maxCol = col;
			if (row < minRow) minRow = row;
			if (row > maxRow) maxRow = row;
			total += 1;
			const neighbours = [
				col > 0 ? cell - 1 : -1,
				col < columns - 1 ? cell + 1 : -1,
				row > 0 ? cell - columns : -1,
				row < rows - 1 ? cell + columns : -1,
			];
			for (const neighbour of neighbours) {
				if (neighbour >= 0 && hot[neighbour] && !visited[neighbour]) {
					visited[neighbour] = 1;
					stack.push(neighbour);
				}
			}
		}
		regions.push({
			x: minCol * cellSize,
			y: minRow * cellSize,
			width: Math.min(width, (maxCol + 1) * cellSize) - minCol * cellSize,
			height: Math.min(height, (maxRow + 1) * cellSize) - minRow * cellSize,
			energy: Math.round(total * 1000) / 1000,
			cells: total,
		});
	}
	return regions.sort((a, b) => b.cells - a.cells || a.x - b.x);
}

/** Intersection area of two boxes. */
function overlapArea(a, b) {
	const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Map diff regions against projected Stage 4 layer bounding boxes.
 *
 * @param {Array<{x,y,width,height,cells?}>} regions     segmentDiffRegions output
 * @param {Array<{layerId:string, frame:number, box:{x,y,width,height}}>} layerBoxes
 * @param {object} [options]  { minOverlapPct=0.25 }
 * @returns {Array<{layerId:string, frames:number[], regions:object[], coveragePct:number}>}
 */
export function mapRegionsToLayers(regions, layerBoxes, options = {}) {
	const minOverlapPct = Number.isFinite(options.minOverlapPct) ? options.minOverlapPct : 0.25;
	const failures = new Map();
	for (const region of regions) {
		const regionArea = region.width * region.height;
		if (regionArea <= 0) continue;
		for (const entry of Array.isArray(layerBoxes) ? layerBoxes : []) {
			const box = entry.box;
			if (!box || !entry.layerId) continue;
			const area = overlapArea(region, box);
			if (area <= 0) continue;
			const overlapPct = area / Math.min(regionArea, box.width * box.height);
			if (overlapPct < minOverlapPct) continue;
			const key = String(entry.layerId);
			const record = failures.get(key) ?? { layerId: key, frames: [], regions: [], coveragePct: 0 };
			if (!record.frames.includes(Math.round(Number(entry.frame)))) record.frames.push(Math.round(Number(entry.frame)));
			const already = record.regions.some((r) => r.x === region.x && r.y === region.y && r.width === region.width && r.height === region.height);
			if (!already) record.regions.push(region);
			record.coveragePct = Math.max(record.coveragePct, Math.round(overlapPct * 10000) / 10000);
			failures.set(key, record);
		}
	}
	return [...failures.values()]
		.map((record) => ({ ...record, frames: record.frames.sort((a, b) => a - b) }))
		.sort((a, b) => b.regions.length - a.regions.length || a.layerId.localeCompare(b.layerId));
}

/**
 * Derive the minimal attribute corrections for one failing layer from its
 * regions vs the projected layer box: position shifts toward the dominant
 * region centroid, scale ratios toward the dominant region size.
 */
export function deriveCorrections(failure) {
	const dominant = failure.regions[0];
	if (!dominant) return null;
	return {
		target: failure.layerId,
		frames: failure.frames,
		delta: { 'position.x': dominant.x, 'position.y': dominant.y },
		multiply: { 'scale.x': Math.max(0.01, dominant.width / 100), 'scale.y': Math.max(0.01, dominant.height / 100) },
		region: { x: dominant.x, y: dominant.y, width: dominant.width, height: dominant.height },
	};
}

/**
 * Emit the minimal single-shot `_mg.patch()` IIFE for the divergent layers.
 *
 * The script targets ONLY the failing layer ids and attributes — no layer
 * creation, no full scene recompile. Frame ranges become frame-targeted patch
 * entries so the correction lands where the render diverged.
 */
export function buildSurgicalPatchScript(failures, { iteration = 0, shotId = '', corrections } = {}) {
	const list = (Array.isArray(failures) ? failures : []).map((failure, index) => {
		const derived = (Array.isArray(corrections) ? corrections[index] : null) ?? deriveCorrections(failure);
		return {
			target: failure.layerId,
			frames: failure.frames,
			...(derived?.delta ? { delta: derived.delta } : {}),
			...(derived?.multiply ? { multiply: derived.multiply } : {}),
			...(derived?.attrs ? { attrs: derived.attrs } : {}),
			__surgical: {
				regions: failure.regions.map((region) => ({ x: region.x, y: region.y, width: region.width, height: region.height })),
				coveragePct: failure.coveragePct,
			},
		};
	});
	if (!list.length) return '';
	return [
		`// refclone surgical stage-5 diff -> stage-4 delta patch (shot ${shotId || 'n/a'}, iteration ${iteration})`,
		`// Targets ${list.length} divergent layer(s): ${list.map((entry) => entry.target).join(', ')}`,
		`// Geometry-only corrections — no layer creation, no scene recompile.`,
		`_mg.patch(${JSON.stringify(list.map(({ __surgical, ...entry }) => ({
			target: entry.target,
			...(entry.frames && entry.frames.length ? { frame: entry.frames[0] } : {}),
			...(entry.delta ? { delta: entry.delta } : {}),
			...(entry.multiply ? { multiply: entry.multiply } : {}),
			...(entry.attrs ? { attrs: entry.attrs } : {}),
		})))});`,
	].join('\n');
}

/**
 * One-call surgical path for a diff gate failure: segment → map → corrections
 * → script. Returns null when nothing maps to a known Stage 4 layer (the
 * caller then falls back to the full Stage 4 recompile).
 */
export function buildSurgicalPatchFromFrame(reference, render, layerBoxes, options = {}) {
	const regions = segmentDiffRegions(reference, render, options);
	const failures = mapRegionsToLayers(regions, layerBoxes, options);
	if (!failures.length) return null;
	return {
		regions,
		failures,
		script: buildSurgicalPatchScript(failures, options),
	};
}
