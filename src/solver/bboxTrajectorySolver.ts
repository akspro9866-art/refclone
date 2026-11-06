/**
 * Geometry-first bbox alignment — 0 pixels rendered, 0 LLM tokens.
 *
 * Input: the reference track's bounding boxes across sampled frames and the
 * Cavalry layer's bounding boxes for the same frames (both from stallion's
 * `/batch-step` geometry). Output: analytical affine corrections (deltaX,
 * deltaY, scaleX, scaleY) that align centroids and dimensions, the IoU before
 * and after, and ready-to-apply `_mg` set-ops. Everything is closed-form
 * least squares — no rendering, no search, no model call.
 */

export interface BoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BboxPatch {
	layerId: string;
	/** Absolute attribute writes for a `_mg` set-op, when base values were given. */
	attributes: Record<string, number> | null;
	/** Delta form when no base values were supplied. */
	deltas: { dx: number; dy: number; sx: number; sy: number };
}

export interface BboxAlignment {
	layerId: string;
	deltaX: number;
	deltaY: number;
	scaleX: number;
	scaleY: number;
	iouBefore: number;
	iouAfter: number;
	frames: number;
	patch: BboxPatch;
}

/** Axis-aligned IoU of two boxes; 0 for degenerate inputs. */
export function boxIoU(a: BoundingBox, b: BoundingBox): number {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.width, b.x + b.width);
	const y2 = Math.min(a.y + a.height, b.y + b.height);
	const interWidth = x2 - x1;
	const interHeight = y2 - y1;
	if (interWidth <= 0 || interHeight <= 0) return 0;
	const intersection = interWidth * interHeight;
	const union = a.width * a.height + b.width * b.height - intersection;
	return union > 0 ? intersection / union : 0;
}

const centroid = (box: BoundingBox): [number, number] => [box.x + box.width / 2, box.y + box.height / 2];

/** Least-squares ratio Σ(a·b)/Σ(b²) — the closed-form scale of a vs b. */
function lsqScale(reference: number[], cavalry: number[]): number {
	let numerator = 0;
	let denominator = 0;
	for (let index = 0; index < reference.length; index++) {
		numerator += reference[index] * cavalry[index];
		denominator += cavalry[index] * cavalry[index];
	}
	return denominator > 1e-9 ? numerator / denominator : 1;
}

function applyCorrection(box: BoundingBox, dx: number, dy: number, sx: number, sy: number): BoundingBox {
	const [cx, cy] = centroid(box);
	const width = box.width * sx;
	const height = box.height * sy;
	return { x: cx + dx - width / 2, y: cy + dy - height / 2, width, height };
}

export interface BboxSolveInput {
	layerId: string;
	/** Reference boxes indexed/ordered exactly like `cavalry`. */
	reference: BoundingBox[];
	/** Cavalry boxes for the same frames, same order. */
	cavalry: BoundingBox[];
	/**
	 * Current rig values, when known: patch attributes come back absolute and
	 * directly applicable via a `_mg` set-op. Without them only deltas are
	 * reported.
	 */
	current?: { positionX?: number; positionY?: number; scaleX?: number; scaleY?: number };
	/**
	 * Cavalry's box grows around its pivot, not its center; when the pivot is
	 * the default top-left-ish origin a pure centroid shift still lands because
	 * the measured box already reflects where the shape is. Kept as a hook for
	 * pivot-aware callers.
	 */
	pivot?: { x: number; y: number };
}

/**
 * Solve the affine correction aligning a Cavalry layer's bbox trajectory to
 * the reference. Both lists must be equal length with ≥ 1 pair; quality is
 * reported honestly via `iouAfter` — the caller decides whether it is good
 * enough (the pipeline gate wants ≥ 0.98 from this solver in a single pass).
 */
export function solveBboxTrajectory(input: BboxSolveInput): BboxAlignment | null {
	const { layerId, reference, cavalry } = input;
	if (!Array.isArray(reference) || !Array.isArray(cavalry)) return null;
	const pairs = Math.min(reference.length, cavalry.length);
	if (pairs < 1) return null;

	const refCx: number[] = [];
	const refCy: number[] = [];
	const refW: number[] = [];
	const refH: number[] = [];
	const cavCx: number[] = [];
	const cavCy: number[] = [];
	const cavW: number[] = [];
	const cavH: number[] = [];
	for (let index = 0; index < pairs; index++) {
		const [rx, ry] = centroid(reference[index]);
		const [cx, cy] = centroid(cavalry[index]);
		refCx.push(rx);
		refCy.push(ry);
		refW.push(reference[index].width);
		refH.push(reference[index].height);
		cavCx.push(cx);
		cavCy.push(cy);
		cavW.push(cavalry[index].width);
		cavH.push(cavalry[index].height);
	}

	const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
	const deltaX = mean(refCx) - mean(cavCx);
	const deltaY = mean(refCy) - mean(cavCy);
	// Uniform-scale trajectories (grow/shrink) need the ratio per axis; a
	// degenerate zero-size box falls back to scale 1 for that axis.
	const scaleX = cavW.some((value) => value <= 1e-6) ? 1 : lsqScale(refW, cavW);
	const scaleY = cavH.some((value) => value <= 1e-6) ? 1 : lsqScale(refH, cavH);

	let iouBefore = 0;
	let iouAfter = 0;
	for (let index = 0; index < pairs; index++) {
		iouBefore += boxIoU(reference[index], cavalry[index]);
		iouAfter += boxIoU(reference[index], applyCorrection(cavalry[index], deltaX, deltaY, scaleX, scaleY));
	}
	iouBefore /= pairs;
	iouAfter /= pairs;

	const deltas = {
		dx: Number(deltaX.toFixed(3)),
		dy: Number(deltaY.toFixed(3)),
		sx: Number(scaleX.toFixed(5)),
		sy: Number(scaleY.toFixed(5)),
	};

	let attributes: Record<string, number> | null = null;
	if (input.current) {
		const baseX = input.current.positionX ?? 0;
		const baseY = input.current.positionY ?? 0;
		const baseSx = input.current.scaleX ?? 100;
		const baseSy = input.current.scaleY ?? 100;
		attributes = {
			"position.x": Number((baseX + deltaX).toFixed(2)),
			"position.y": Number((baseY + deltaY).toFixed(2)),
			"scale.x": Number((baseSx * scaleX).toFixed(2)),
			"scale.y": Number((baseSy * scaleY).toFixed(2)),
		};
	}

	return {
		layerId,
		deltaX: deltas.dx,
		deltaY: deltas.dy,
		scaleX: deltas.sx,
		scaleY: deltas.sy,
		iouBefore: Number(iouBefore.toFixed(4)),
		iouAfter: Number(iouAfter.toFixed(4)),
		frames: pairs,
		patch: { layerId, attributes, deltas },
	};
}

/**
 * Solve every tracked layer at once. Unsolvable layers (missing sides,
 * length mismatch) are reported instead of dropped, so the caller sees why.
 */
export function solveBboxTrajectories(
	inputs: BboxSolveInput[],
): { alignments: BboxAlignment[]; unsolved: Array<{ layerId: string; reason: string }> } {
	const alignments: BboxAlignment[] = [];
	const unsolved: Array<{ layerId: string; reason: string }> = [];
	for (const input of inputs) {
		const alignment = solveBboxTrajectory(input);
		if (alignment) alignments.push(alignment);
		else unsolved.push({ layerId: input.layerId, reason: "no comparable reference/cavalry frame pairs" });
	}
	return { alignments, unsolved };
}

/**
 * The alignment's patch as a `_mg` manifest set-op. Only absolute patches are
 * emitted: a delta-form `set` would silently replace position/scale instead
 * of nudging them. Callers without rig base values should apply
 * `alignment.patch.deltas` themselves.
 */
export function alignmentToMgOp(alignment: BboxAlignment): { op: "set"; target: string; attrs: Record<string, number> } | null {
	if (!alignment.patch.attributes) return null;
	return { op: "set", target: alignment.patch.layerId, attrs: alignment.patch.attributes };
}
