/**
 * MockStallionServer — the deterministic, headless stand-in for Cavalry 2.8.0
 * + the Stallion bridge, for CI and any environment where the GUI is not
 * running.
 *
 * Contract (mirrors stallion v0.11, see that repo's modules):
 *
 *   - POST /post + GET /get   seq-matched envelopes for every kind:
 *     `batch-step` (creates layers from a `_mg` manifest through a minimal
 *     in-sandbox `_mg` shim), `batch_inspect` (geometry-only timeline matrix,
 *     linear keyframe interpolation), `snapshot`, `render_frame_fast`
 *     (synthetic PNG bytes from the mathematical layer transforms),
 *     `checkpoint` / `rollback` (deep scene-state restore).
 *   - Literal paths            /batch-step, /batch_inspect, /checkpoint,
 *     /rollback, /snapshot, /render_frame_fast answer the identical envelopes
 *     directly (the mock is real Node and may route; the live bridge cannot).
 *   - Bearer token auth when a token is configured — same as the live bridge.
 *
 * Rendering: every layer contributes an axis-aligned box raster composited
 * over the comp background with alpha blending; the RGBA buffer is encoded to
 * a real PNG (pngjs). Because the geometry is the same one `batch_inspect`
 * reports, a solver can be tested against exact agreement between pixels and
 * boxes.
 *
 * Resolution order for tests and tools:
 *
 *   - `MOCK_STALLION=1`          → always mock, bound to port 8080 (or 0).
 *   - live Cavalry on :8080      → not the mock's business; use
 *     `isLiveStallionReachable()` first and pick accordingly.
 *   - `startMockStallionServer()` → ephemeral port by default (port 0), so
 *     parallel test files never collide.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

export const MOCK_STALLION_VERSION = '0.11.0';

// ---------------------------------------------------------------------------
// Scene model
// ---------------------------------------------------------------------------

interface MockKeyframe {
	frame: number;
	value: number;
}

interface MockLayer {
	id: string;
	type: string;
	name: string;
	compId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	opacity: number;
	visible: boolean;
	inFrame: number | null;
	outFrame: number | null;
	keyframes: Map<string, MockKeyframe[]>;
	color: [number, number, number];
}

interface MockComp {
	id: string;
	fps: number;
	width: number;
	height: number;
	endFrame: number;
	bg: [number, number, number];
	layerIds: string[];
}

export class MockScene {
	comps = new Map<string, MockComp>();
	layers = new Map<string, MockLayer>();
	activeCompId: string | null = null;
	frame = 0;
	private counters = new Map<string, number>();
	private aliases = new Map<string, string>();

	private nextId(type: string): string {
		const count = (this.counters.get(type) ?? 0) + 1;
		this.counters.set(type, count);
		return `${type}#${count}`;
	}

	createComp(options: { width?: number; height?: number; fps?: number; endFrame?: number; bg?: string } = {}): MockComp {
		const comp: MockComp = {
			id: this.nextId('compNode'),
			fps: options.fps ?? 60,
			width: options.width ?? 1920,
			height: options.height ?? 1080,
			endFrame: options.endFrame ?? 180,
			bg: parseColor(options.bg ?? '#000000'),
			layerIds: [],
		};
		this.comps.set(comp.id, comp);
		if (!this.activeCompId) this.activeCompId = comp.id;
		return comp;
	}

	ensureComp(): MockComp {
		return this.activeCompId ? this.comps.get(this.activeCompId)! : this.createComp();
	}

	activeComp(): MockComp | null {
		return this.activeCompId ? this.comps.get(this.activeCompId) ?? null : null;
	}

	createLayer(type: string, name: string, attrs: Record<string, unknown> = {}): MockLayer {
		const comp = this.ensureComp();
		const layer: MockLayer = {
			id: this.nextId(type),
			type,
			name: name || type,
			compId: comp.id,
			x: 0,
			y: 0,
			w: 100,
			h: 100,
			scaleX: 100,
			scaleY: 100,
			rotation: 0,
			opacity: 100,
			visible: true,
			inFrame: null,
			outFrame: null,
			keyframes: new Map(),
			color: [type === 'textShape' ? 240 : 60, 120, 200],
		};
		this.layers.set(layer.id, layer);
		comp.layerIds.push(layer.id);
		this.applyAttrs(layer, attrs);
		return layer;
	}

	applyAttrs(layer: MockLayer, attrs: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(attrs ?? {})) {
			this.setAttr(layer, key, value);
		}
	}

	setAttr(layer: MockLayer, key: string, value: unknown): void {
		switch (key) {
			case 'position.x': this.x(layer, Number(value)); return;
			case 'position.y': this.y(layer, Number(value)); return;
			case 'position': {
				if (Array.isArray(value)) { this.x(layer, Number(value[0])); this.y(layer, Number(value[1])); }
				return;
			}
			case 'scale.x': layer.scaleX = Number(value); return;
			case 'scale.y': layer.scaleY = Number(value); return;
			case 'rotation': layer.rotation = Number(value); return;
			case 'opacity': layer.opacity = Number(value); return;
			case 'hidden': layer.visible = !(value === true || value === 1 || value === 'true'); return;
			case 'generator.dimensions': {
				if (Array.isArray(value)) { layer.w = Number(value[0]) || layer.w; layer.h = Number(value[1]) || layer.h; }
				return;
			}
			case 'inFrame': layer.inFrame = Number(value); return;
			case 'outFrame': layer.outFrame = Number(value); return;
			case 'material.fillColor':
			case 'material.materialColor': {
				if (typeof value === 'string') layer.color = parseColor(value);
				return;
			}
			default: {
				// Unknown static attrs are stored inertly on the layer record.
				(layer as unknown as Record<string, unknown>)[`attr:${key}`] = value;
			}
		}
	}

	private x(layer: MockLayer, value: number): void {
		if (Number.isFinite(value)) layer.x = value;
	}

	private y(layer: MockLayer, value: number): void {
		if (Number.isFinite(value)) layer.y = value;
	}

	setAttrAt(layer: MockLayer, key: string, value: unknown): void {
		this.setAttr(layer, key, value);
	}

	keyframe(layer: MockLayer, frame: number, attrs: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(attrs ?? {})) {
			const numeric = Number(value);
			if (!Number.isFinite(numeric)) continue;
			const list = layer.keyframes.get(key) ?? [];
			const existing = list.findIndex((entry) => entry.frame === frame);
			if (existing >= 0) list[existing] = { frame, value: numeric };
			else list.push({ frame, value: numeric });
			list.sort((a, b) => a.frame - b.frame);
			layer.keyframes.set(key, list);
		}
	}

	/** Evaluated attribute value at a frame (linear between keyframes, hold outside). */
	evaluate(layer: MockLayer, key: string, frame: number): number | null {
		const list = layer.keyframes.get(key);
		if (list && list.length) {
			if (frame <= list[0].frame) return list[0].value;
			if (frame >= list[list.length - 1].frame) return list[list.length - 1].value;
			for (let index = 1; index < list.length; index++) {
				const a = list[index - 1];
				const b = list[index];
				if (frame >= a.frame && frame <= b.frame) {
					const t = b.frame === a.frame ? 0 : (frame - a.frame) / (b.frame - a.frame);
					return a.value + (b.value - a.value) * t;
				}
			}
		}
		return null;
	}

	alias(layerId: string, alias: string): void {
		if (typeof alias === 'string' && alias) this.aliases.set(alias.replace(/^\$/, ''), layerId);
	}

	/** The alias → id map, for `_mg.aliases()`. */
	aliasEntries(): Array<[string, string]> {
		return [...this.aliases.entries()];
	}

	/** The first alias that points at `layerId`, or null. */
	aliasOf(layerId: string): string | null {
		for (const [alias, id] of this.aliases) {
			if (id === layerId) return alias;
		}
		return null;
	}

	resolveId(idOrAlias: string): string | null {
		if (this.layers.has(idOrAlias)) return idOrAlias;
		const stripped = String(idOrAlias ?? '').replace(/^\$/, '');
		return this.aliases.get(stripped) ?? this.aliases.get(String(idOrAlias ?? '')) ?? null;
	}

	/** World box of one layer at one frame — the single source of geometry truth. */
	boxAt(layer: MockLayer, frame: number): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
		const px = this.evaluate(layer, 'position.x', frame) ?? layer.x;
		const py = this.evaluate(layer, 'position.y', frame) ?? layer.y;
		const sx = (this.evaluate(layer, 'scale.x', frame) ?? layer.scaleX) / 100;
		const sy = (this.evaluate(layer, 'scale.y', frame) ?? layer.scaleY) / 100;
		const w = layer.w * sx;
		const h = layer.h * sy;
		return { x: px - w / 2, y: py - h / 2, w, h, cx: px, cy: py };
	}

	visibleAt(layer: MockLayer, frame: number): boolean {
		if (!layer.visible) return false;
		if (layer.inFrame !== null && frame < layer.inFrame) return false;
		if (layer.outFrame !== null && frame > layer.outFrame) return false;
		return true;
	}

	/** Deep-copy everything a checkpoint must restore. */
	serialize(): string {
		return JSON.stringify({
			comps: [...this.comps.values()],
			activeCompId: this.activeCompId,
			frame: this.frame,
			layers: [...this.layers.values()].map((layer) => ({
				...layer,
				keyframes: [...layer.keyframes.entries()].map(([key, list]) => ({ key, list })),
			})),
			counters: [...this.counters.entries()],
			aliases: [...this.aliases.entries()],
		});
	}

	restore(serialized: string): void {
		const doc = JSON.parse(serialized) as {
			comps: MockComp[];
			activeCompId: string | null;
			frame: number;
			layers: Array<MockLayer & { keyframes: Array<{ key: string; list: MockKeyframe[] }> }>;
			counters: Array<[string, number]>;
			aliases: Array<[string, string]>;
		};
		this.comps = new Map(doc.comps.map((comp) => [comp.id, comp]));
		this.activeCompId = doc.activeCompId;
		this.frame = doc.frame;
		this.layers = new Map(doc.layers.map((layer) => [layer.id, { ...layer, keyframes: new Map(layer.keyframes.map((entry) => [entry.key, entry.list])) }]));
		this.counters = new Map(doc.counters);
		this.aliases = new Map(doc.aliases);
	}

	/** Rasterize the active comp at a frame into RGBA bytes. */
	rasterize(frame: number, width: number, height: number): Buffer {
		const comp = this.ensureComp();
		const rgba = Buffer.alloc(width * height * 4);
		const scaleX = width / comp.width;
		const scaleY = height / comp.height;
		// Background first.
		for (let pixel = 0; pixel < width * height; pixel++) {
			rgba[pixel * 4] = comp.bg[0];
			rgba[pixel * 4 + 1] = comp.bg[1];
			rgba[pixel * 4 + 2] = comp.bg[2];
			rgba[pixel * 4 + 3] = 255;
		}
		for (const layerId of comp.layerIds) {
			const layer = this.layers.get(layerId);
			if (!layer || !this.visibleAt(layer, frame)) continue;
			const box = this.boxAt(layer, frame);
			const alpha = Math.max(0, Math.min(1, layer.opacity / 100));
			if (alpha <= 0) continue;
			const x0 = Math.max(0, Math.round(box.x * scaleX));
			const y0 = Math.max(0, Math.round(box.y * scaleY));
			const x1 = Math.min(width - 1, Math.round((box.x + box.w) * scaleX));
			const y1 = Math.min(height - 1, Math.round((box.y + box.h) * scaleY));
			for (let y = y0; y <= y1; y++) {
				for (let x = x0; x <= x1; x++) {
					const offset = (y * width + x) * 4;
					rgba[offset] = Math.round(rgba[offset] * (1 - alpha) + layer.color[0] * alpha);
					rgba[offset + 1] = Math.round(rgba[offset + 1] * (1 - alpha) + layer.color[1] * alpha);
					rgba[offset + 2] = Math.round(rgba[offset + 2] * (1 - alpha) + layer.color[2] * alpha);
					rgba[offset + 3] = 255;
				}
			}
		}
		return rgba;
	}
}

function parseColor(hex: string): [number, number, number] {
	const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
	if (!match) return [0, 0, 0];
	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

// ---------------------------------------------------------------------------
// The minimal `_mg` shim available inside batch-step scripts
// ---------------------------------------------------------------------------

/**
 * The minimal `_mg` shim available inside batch-step scripts. Signatures
 * mirror the vendored `MG_MANIFEST_RUNTIME` exactly: `_mg.comp(width, height,
 * fps, endFrame, bg)`, `_mg.shape(shapeType, name, attrs)`, `_mg.layer(...)`,
 * `_mg.text(text, size, color, attrs)`, `_mg.set(id, attrs)`,
 * `_mg.alias(id, alias)`, `_mg.aliases()` (getter → `{$name, @name}` map) and
 * `_mg.fitToBounds(id, box, opts)`.
 */
function mgShim(scene: MockScene): Record<string, unknown> {
	const currentLayer = (): MockLayer => {
		const comp = scene.ensureComp();
		const lastId = comp.layerIds[comp.layerIds.length - 1];
		return scene.layers.get(lastId)!;
	};
	const shim: Record<string, unknown> = {
		comp(width?: number, height?: number, fps?: number, endFrame?: number, bg?: string): string {
			const active = scene.ensureComp();
			if (Number.isFinite(Number(width)) && Number(width) > 0) active.width = Math.round(Number(width));
			if (Number.isFinite(Number(height)) && Number(height) > 0) active.height = Math.round(Number(height));
			if (Number.isFinite(Number(fps)) && Number(fps) > 0) active.fps = Number(fps);
			if (Number.isFinite(Number(endFrame)) && Number(endFrame) > 0) active.endFrame = Math.round(Number(endFrame));
			if (typeof bg === 'string' && bg) active.bg = parseColor(bg);
			return active.id;
		},
		shape(shapeType: string, name?: string, attrs: Record<string, unknown> = {}): string {
			return scene.createLayer(String(shapeType ?? 'rectangle'), String(name ?? ''), attrs ?? {}).id;
		},
		layer(layerType: string, name?: string, attrs: Record<string, unknown> = {}): string {
			return scene.createLayer(String(layerType ?? 'group'), String(name ?? ''), attrs ?? {}).id;
		},
		text(text: string, size?: number, color?: string, attrs: Record<string, unknown> = {}): string {
			const merged = { ...attrs };
			if (size != null) merged.fontSize = Number(size);
			if (typeof color === 'string') merged['material.fillColor'] = color;
			return scene.createLayer('textShape', String((attrs as { name?: string })?.name ?? String(text ?? '')), { text: String(text ?? ''), ...merged }).id;
		},
		set(target: string, attrs: Record<string, unknown>): string | null {
			const layer = scene.layers.get(scene.resolveId(target) ?? '');
			if (!layer) return null;
			scene.applyAttrs(layer, attrs ?? {});
			return layer.id;
		},
		keyframe(target: string, frame: number, attrs: Record<string, unknown>): string | null {
			const layer = scene.layers.get(scene.resolveId(target) ?? '');
			if (!layer) return null;
			scene.keyframe(layer, Number(frame), attrs ?? {});
			return layer.id;
		},
		alias(layerId: string, alias: string): string {
			scene.alias(String(layerId), String(alias));
			return alias;
		},
		aliases(): Record<string, string> {
			const map: Record<string, string> = {};
			for (const [alias, id] of scene.aliasEntries()) {
				map[`$${alias}`] = id;
				map[`@${alias}`] = id;
				map[alias] = id;
			}
			return map;
		},
		fitToBounds(target: string, box: { x: number; y: number; width: number; height: number }, opts: { preserveAspect?: boolean } = {}): string | null {
			const layer = scene.layers.get(scene.resolveId(target) ?? '');
			if (!layer) return null;
			if (opts.preserveAspect === true) {
				const factor = Math.min(box.width / Math.max(1, layer.w), box.height / Math.max(1, layer.h));
				layer.w = Math.max(1, layer.w * factor);
				layer.h = Math.max(1, layer.h * factor);
			} else {
				layer.w = Math.max(1, box.width);
				layer.h = Math.max(1, box.height);
			}
			layer.x = box.x + box.width / 2;
			layer.y = box.y + box.height / 2;
			return layer.id;
		},
		delete(target: string): boolean {
			const id = scene.resolveId(target);
			if (!id) return false;
			scene.layers.delete(id);
			for (const comp of scene.comps.values()) {
				comp.layerIds = comp.layerIds.filter((entry) => entry !== id);
			}
			return true;
		},
		last(): MockLayer {
			return currentLayer();
		},
	};
	return shim;
}

/** Interpret the declarative manifest against the mock scene. */
function applyDslManifest(scene: MockScene, manifest: Record<string, unknown>): { created: Record<string, string>; ops: Array<Record<string, unknown>>; errors: string[] } {
	const created: Record<string, string> = {};
	const opResults: Array<Record<string, unknown>> = [];
	const errors: string[] = [];
	const comp = manifest?.comp as Record<string, unknown> | undefined;
	if (comp && typeof comp === 'object') {
		const active = scene.ensureComp();
		if (comp.width != null) active.width = Number(comp.width) || active.width;
		if (comp.height != null) active.height = Number(comp.height) || active.height;
		if (comp.fps != null) active.fps = Number(comp.fps) || active.fps;
		if (comp.endFrame != null) active.endFrame = Number(comp.endFrame) || active.endFrame;
		if (typeof comp.bg === 'string') active.bg = parseColor(comp.bg);
	}
	for (const layer of (Array.isArray(manifest?.layers) ? manifest.layers : []) as Array<Record<string, unknown>>) {
		const as = String(layer?.as ?? '').replace(/^\$/, '');
		if (!as) {
			errors.push('layer entry without an `as` alias');
			continue;
		}
		let id: string;
		if (layer.kind === 'text') id = scene.createLayer('textShape', as, { text: String(layer.text ?? ''), ...(layer.attrs as Record<string, unknown> ?? {}) }).id;
		else if (layer.kind === 'svg' || layer.kind === 'image') id = scene.createLayer(String(layer.kind === 'svg' ? 'svg' : 'imageAsset'), as, (layer.attrs as Record<string, unknown>) ?? {}).id;
		else if (layer.kind === 'layer') id = scene.createLayer(String(layer.layerType ?? 'group'), as, (layer.attrs as Record<string, unknown>) ?? {}).id;
		else id = scene.createLayer(String(layer.shape ?? 'rectangle'), as, (layer.attrs as Record<string, unknown>) ?? {}).id;
		scene.alias(id, as);
		created[as] = id;
	}
	for (const op of (Array.isArray(manifest?.ops) ? manifest.ops : []) as Array<Record<string, unknown>>) {
		const kind = String(op?.op ?? '');
		const result: Record<string, unknown> = { index: opResults.length, op: kind, ok: false };
		try {
			if (kind === 'set') {
				const id = scene.resolveId(String(op.target ?? ''));
				if (!id) throw new Error(`unknown target ${String(op.target)}`);
				scene.applyAttrs(scene.layers.get(id)!, (op.attrs as Record<string, unknown>) ?? {});
				result.ok = true;
				result.target = id;
			} else if (kind === 'keyframe') {
				const id = scene.resolveId(String(op.target ?? ''));
				if (!id) throw new Error(`unknown target ${String(op.target)}`);
				const layer = scene.layers.get(id)!;
				for (const entry of (op.frames as Array<Record<string, unknown>>) ?? []) {
					scene.keyframe(layer, Number(entry.frame), (entry.attrs as Record<string, unknown>) ?? {});
				}
				result.ok = true;
				result.target = id;
			} else if (kind === 'delete') {
				for (const target of (op.targets as string[]) ?? []) result.ok = scene.resolveId(target) ? scene.layers.delete(scene.resolveId(target)!) || true : false;
			} else {
				// connect/expression/easing/order/fit are accepted no-ops: the mock
				// has no behaviour graph, and the solver never depends on them.
				result.ok = true;
				result.note = 'accepted as a no-op by the mock';
			}
		} catch (error) {
			result.error = String((error as Error)?.message ?? error);
			errors.push(result.error as string);
		}
		opResults.push(result);
	}
	return { created, ops: opResults, errors };
}

// ---------------------------------------------------------------------------
// Envelope synthesis
// ---------------------------------------------------------------------------

function batchInspectEnvelope(scene: MockScene, payload: Record<string, unknown>): Record<string, unknown> {
	const frames = (Array.isArray(payload.frames) ? payload.frames : [])
		.map((value) => Math.round(Number(value)))
		.filter((value) => Number.isFinite(value))
		.slice(0, 64)
		.sort((a, b) => a - b);
	if (!frames.length) {
		return { ok: false, kind: 'batch_inspect', seq: payload.seq ?? null, code: 'STALLION_BAD_REQUEST', error: 'batch_inspect requires a non-empty numeric `frames` array (1..64).' };
	}
	const comp = scene.activeComp();
	// The timeline is keyed by the CALLER's ids — aliases included — exactly
	// like the live bridge, which echoes the requested layer list. Resolution
	// happens for the lookup only.
	const requested = Array.isArray(payload.layerIds) ? payload.layerIds.map((id) => String(id)) : [];
	const ids = (requested.length ? requested : (comp?.layerIds ?? [])).slice(0, 200);
	const attributes = (Array.isArray(payload.attributes) && payload.attributes.length ? payload.attributes : ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation', 'opacity']).slice(0, 16);
	const timeline: Record<string, Record<string, unknown>> = {};
	for (const frame of frames) {
		const frameEntry: Record<string, unknown> = {};
		for (const requestedId of ids) {
			const resolvedId = scene.resolveId(requestedId) ?? requestedId;
			const layer = scene.layers.get(resolvedId);
			if (!layer) continue;
			if (!scene.visibleAt(layer, frame)) continue;
			const box = scene.boxAt(layer, frame);
			const attrs: Record<string, unknown> = {};
			for (const attrPath of attributes) {
				const evaluated = scene.evaluate(layer, attrPath, frame);
				if (evaluated !== null) attrs[attrPath] = Math.round(evaluated * 1000) / 1000;
				else if (attrPath === 'position.x') attrs[attrPath] = layer.x;
				else if (attrPath === 'position.y') attrs[attrPath] = layer.y;
				else if (attrPath === 'scale.x') attrs[attrPath] = layer.scaleX;
				else if (attrPath === 'scale.y') attrs[attrPath] = layer.scaleY;
				else if (attrPath === 'rotation') attrs[attrPath] = layer.rotation;
				else if (attrPath === 'opacity') attrs[attrPath] = layer.opacity;
			}
			frameEntry[requestedId] = { bbox: box, attrs, visible: true };
		}
		timeline[String(frame)] = frameEntry;
	}
	const unknown = requested.filter((id) => !scene.resolveId(id));
	return {
		ok: true,
		kind: 'batch_inspect',
		seq: payload.seq ?? null,
		compId: comp?.id ?? null,
		compFrameRate: comp?.fps ?? null,
		compResolution: comp ? [comp.width, comp.height] : null,
		frames,
		timeline,
		...(unknown.length ? { unknownLayerIds: unknown.map(String) } : {}),
		restoredFrame: 0,
	};
}

function batchStepEnvelope(scene: MockScene, payload: Record<string, unknown>): Record<string, unknown> {
	const mg = mgShim(scene);
	const created: Record<string, string> = {};
	let scriptResult: unknown = null;
	let scriptError: string | null = null;
	const manifest = payload.dslManifest;
	if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
		Object.assign(created, applyDslManifest(scene, manifest as Record<string, unknown>).created);
	}
	const script = typeof payload.script === 'string' ? payload.script : '';
	if (script.trim()) {
		try {
			const sandbox: Record<string, unknown> = { api: mockCavalryApi(scene, mg), _mg: mg, _rb: {}, console: { log: () => {}, warn: () => {}, error: () => {} } };
			const context = vm.createContext(sandbox);
			scriptResult = vm.runInContext(`var __result; var __returned = (function () { ${script} })(); if (typeof __result === 'undefined') __result = __returned; __result;`, context, { timeout: 10_000 });
		} catch (error) {
			scriptError = String((error as Error)?.message ?? error);
		}
	}
	const rows = (scene.activeComp()?.layerIds ?? []).map((id) => {
		const layer = scene.layers.get(id)!;
		const box = scene.boxAt(layer, scene.frame);
		return [id, layer.type, '', layer.name, `${box.x},${box.y},${box.w},${box.h}`, '', ''].join('\t');
	});
	// Optional per-frame renders: the same mathematical rasterizer the
	// snapshot path uses, written as real PNGs so Stage 5's perceptual diff
	// has true pixels to compare (renderedPngPath per sampled frame).
	const frames: Record<string, Record<string, unknown>> = {};
	let rendered = 0;
	const renderErrors: Array<{ frame: number; error: string }> = [];
	const sampleFrames = (Array.isArray(payload.sampleFrames) ? payload.sampleFrames : [])
		.map((value) => Math.round(Number(value)))
		.filter((value) => Number.isFinite(value))
		.slice(0, 64);
	const wantsRender = payload.renderFrames === true;
	const outputDir = typeof payload.renderOutputDir === 'string' && payload.renderOutputDir ? payload.renderOutputDir : null;
	if (wantsRender && outputDir && sampleFrames.length) {
		try {
			fs.mkdirSync(outputDir.replace(/^file:\/\//, ''), { recursive: true });
		} catch {
			/* the per-frame write reports its own error */
		}
		const comp = scene.activeComp();
		const scale = Math.min(1, Math.max(0.1, Number(payload.scale ?? 100) / 100));
		const queryLayers = Array.isArray(payload.queryLayers) ? payload.queryLayers.map((id) => scene.resolveId(String(id)) ?? String(id)) : [];
		for (const frame of sampleFrames) {
			try {
				const width = Math.max(1, Math.round((comp?.width ?? 320) * scale));
				const height = Math.max(1, Math.round((comp?.height ?? 200) * scale));
				const rgba = scene.rasterize(frame, width, height);
				const image = new PNG({ width, height });
				rgba.copy(image.data);
				const file = path.join(outputDir.replace(/^file:\/\//, ''), `frame-${String(Math.max(0, frame)).padStart(6, '0')}.png`);
				fs.writeFileSync(file, PNG.sync.write(image));
				// Sampled geometry, the shape the live bridge reports: one entry per
				// queried layer with its world box at that frame (alias AND live id
				// both resolve — callers key tracks by either).
				const layerIds = queryLayers.length ? queryLayers : (comp?.layerIds ?? []);
				const geometries = layerIds.slice(0, 200).map((id) => {
					const layer = scene.layers.get(id);
					const alias = layer ? (scene.aliasOf(id) ?? layer.name) : id;
					const box = layer ? scene.boxAt(layer, frame) : null;
					return {
						layerId: id,
						alias,
						name: layer?.name ?? id,
						...(box ? { bbox: { x: box.x, y: box.y, width: box.w, height: box.h } } : {}),
					};
				});
				frames[String(frame)] = { renderedPngPath: file, width, height, geometries };
				rendered++;
			} catch (error) {
				renderErrors.push({ frame, error: String((error as Error)?.message ?? error) });
			}
		}
	}
	return {
		ok: scriptError === null,
		kind: 'batch-step',
		seq: payload.seq ?? null,
		compId: scene.activeComp()?.id ?? null,
		executionTimeMs: 1,
		...(scriptError ? { error: scriptError } : {}),
		scriptResult,
		manifestResult: { ok: true, created, ops: [], errors: [] },
		frames,
		compactDomTsv: rows.length ? `id\ttype\tparent\tname\tx,y,w,h\tanimAttrs\tconnections\n${rows.join('\n')}` : '',
		sampledFrames: sampleFrames.length,
		rendered,
		renderErrors,
		restoredFrame: 0,
	};
}

/** A tiny api surface for batch-step scripts (what the `_mg` shim needs). */
function mockCavalryApi(scene: MockScene, mg: Record<string, unknown>): Record<string, unknown> {
	return {
		create: (type: string, name?: string) => scene.createLayer(String(type), String(name ?? ''), {}).id,
		getActiveComp: () => scene.activeComp()?.id ?? null,
		setFrame: (frame: number) => {
			scene.frame = Number(frame);
		},
		getFrame: () => scene.frame,
		set: (id: string, attrs: Record<string, unknown>) => {
			const layer = scene.layers.get(scene.resolveId(id) ?? '');
			if (layer) scene.applyAttrs(layer, attrs);
		},
		rename: (id: string, name: string) => {
			const layer = scene.layers.get(scene.resolveId(id) ?? '');
			if (layer) layer.name = String(name ?? layer.name);
		},
		// The `_mg` manifest interpreter imports SVG layers through this api —
		// the real signature returns ID STRINGS (`convertSVGToLayers(filename):
		// string[]`); the fixture answers with one placeholder layer whose
		// measured box and foreground color ride the layer attrs the manifest
		// supplies.
		convertSVGToLayers: (file: string) => [scene.createLayer('svg', String(file ?? 'svg'), {}).id],
		keyframe: (id: string, frame: number, attrs: Record<string, unknown>) => {
			const layer = scene.layers.get(scene.resolveId(id) ?? '');
			if (layer) scene.keyframe(layer, Number(frame), attrs);
		},
		_mg: mg,
	};
}

function snapshotEnvelope(scene: MockScene, payload: Record<string, unknown>, kind: string, diskOnly = false): Record<string, unknown> {
	const frame = Math.round(Number(payload.frame ?? payload.t));
	if (!Number.isFinite(frame)) {
		return { ok: false, kind, seq: payload.seq ?? null, code: 'STALLION_NO_FRAME', error: `${kind} requires a numeric \`frame\` (or \`t\`).` };
	}
	const comp = scene.ensureComp();
	const rawScale = Number(payload.scaleFactor ?? payload.scale ?? payload.resolutionScale ?? 50);
	const scaleFactor = rawScale > 0 && rawScale <= 1 ? rawScale : Math.min(1, Math.max(0.1, rawScale / 100));
	const width = Math.max(1, Math.round(comp.width * scaleFactor));
	const height = Math.max(1, Math.round(comp.height * scaleFactor));
	const rgba = scene.rasterize(frame, width, height);
	const image = new PNG({ width, height });
	rgba.copy(image.data);
	const png = PNG.sync.write(image);
	const fileBase64 = png.toString('base64');
	if (diskOnly && kind === 'render_frame_fast') {
		// Live-parity mode: the script host has no binary read, so the PNG lands
		// on disk and the envelope names it — no inline buffer of any spelling.
		const outDir = typeof payload.outDir === 'string' && payload.outDir ? payload.outDir : path.join(os.tmpdir(), 'stallion-mock-fast');
		const safeDir = outDir.replace(/^file:\/\//, '');
		fs.mkdirSync(safeDir, { recursive: true });
		const outPath = path.join(safeDir, `fast-${String(Math.max(0, frame)).padStart(6, '0')}.png`);
		fs.writeFileSync(outPath, png);
		return {
			ok: true,
			kind,
			seq: payload.seq ?? null,
			compId: comp.id,
			frame,
			scaleFactor,
			scale: Math.round(scaleFactor * 100),
			file: outPath,
			outPath,
			inline: false,
			width,
			height,
			sizeBytes: png.length,
			exists: true,
			contentHash: createHash('sha256').update(png).digest('hex'),
			restoredFrame: scene.frame,
		};
	}
	return {
		ok: true,
		kind,
		seq: payload.seq ?? null,
		compId: comp.id,
		frame,
		scaleFactor,
		scale: Math.round(scaleFactor * 100),
		file: `mock://${kind}-${frame}.png`,
		inline: payload.inline !== false,
		pngBase64: payload.inline === false ? undefined : fileBase64,
		width,
		height,
		sizeBytes: png.length,
		exists: true,
		contentHash: createHash('sha256').update(png).digest('hex'),
		restoredFrame: scene.frame,
	};
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface MockStallionServerHandle {
	port: number;
	url: string;
	scene: MockScene;
	close: () => Promise<void>;
	requestCount: () => number;
}

export interface StartMockStallionServerOptions {
	port?: number;
	token?: string;
	/**
	 * Serve `/render_frame_fast` the way a LIVE script host must: PNG written
	 * to disk, envelope names `outPath`/`file`, no inline buffer of any
	 * spelling. Client disk readback is exercised against this mode.
	 */
	renderFrameFastDiskOnly?: boolean;
}

export async function startMockStallionServer(options: StartMockStallionServerOptions = {}): Promise<MockStallionServerHandle> {
	const scene = new MockScene();
	scene.createComp();
	const checkpoints = new Map<string, string>();
	const token = options.token ?? '';
	const renderFastDiskOnly = options.renderFrameFastDiskOnly === true;
	let requests = 0;

	const authorized = (request: http.IncomingMessage): boolean => {
		if (!token) return true;
		const header = String(request.headers.authorization ?? '');
		return header === `Bearer ${token}`;
	};

	const server = http.createServer((request, response) => {
		void (async () => {
			requests++;
			const url = new URL(request.url ?? '/', 'http://localhost');
			if (!authorized(request)) {
				respondJson(response, { ok: false, error: 'unauthorized' }, 401);
				return;
			}
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(chunk as Buffer);
			const raw = Buffer.concat(chunks).toString('utf8');
			let payload: Record<string, unknown> = {};
			if (raw.trim()) {
				try {
					payload = JSON.parse(raw) as Record<string, unknown>;
				} catch (error) {
					respondJson(response, { ok: false, error: `bad JSON: ${String((error as Error)?.message ?? error)}` }, 400);
					return;
				}
			}
			// Merge query-string forms so GET /batch_inspect?frames=0,10 works.
			for (const key of ['frames', 'layerIds', 'attributes']) {
				const value = url.searchParams.get(key);
				if (value !== null && payload[key] === undefined) payload[key] = value.split(',').map((entry) => entry.trim()).filter(Boolean);
			}
			for (const key of ['frame', 'snapshotId', 'scaleFactor', 'compId']) {
				const value = url.searchParams.get(key);
				if (value !== null && payload[key] === undefined) payload[key] = value;
			}

			const kind = pathKind(url.pathname, String(payload.type ?? ''));
			if (request.method === 'GET' && url.pathname === '/get') {
				// The live bridge's result channel: the latest seq-matched payload.
				respondJson(response, lastPayload ?? { kind: 'status', stallion: `${MOCK_STALLION_VERSION}-mock`, cavalry: '2.8.0-mock', frame: scene.frame });
				return;
			}
			if (request.method === 'GET' && url.pathname === '/') {
				respondJson(response, { kind: 'status', stallion: `${MOCK_STALLION_VERSION}-mock`, cavalry: '2.8.0-mock', mock: true });
				return;
			}
			if (!kind) {
				respondJson(response, { ok: false, error: `no route for ${request.method} ${url.pathname}` }, 404);
				return;
			}
			const envelope = handleKind(scene, checkpoints, kind, payload, renderFastDiskOnly);
			respondJson(response, envelope);
		})().catch((error) => {
			respondJson(response, { ok: false, error: String((error as Error)?.message ?? error) }, 500);
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
	return {
		port,
		url: `http://127.0.0.1:${port}`,
		scene,
		requestCount: () => requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}

function pathKind(pathname: string, type: string): string | null {
	const byPath: Record<string, string> = {
		'/batch-step': 'batch-step',
		'/batch_inspect': 'batch_inspect',
		'/checkpoint': 'checkpoint',
		'/rollback': 'rollback',
		'/snapshot': 'snapshot',
		'/render_frame_fast': 'render_frame_fast',
	};
	return byPath[pathname] ?? (type ? byPath[`/${type}`] ?? (isKnownType(type) ? type : null) : null);
}

function isKnownType(type: string): boolean {
	return ['batch-step', 'batch_inspect', 'checkpoint', 'rollback', 'snapshot', 'render_frame_fast'].includes(type);
}

function handleKind(scene: MockScene, checkpoints: Map<string, string>, kind: string, payload: Record<string, unknown>, renderFastDiskOnly = false): Record<string, unknown> {
	switch (kind) {
		case 'batch-step': {
			const envelope = batchStepEnvelope(scene, payload);
			// Record the seq so the GET /get contract also works for clients that
			// poll instead of reading the direct reply.
			lastPayload = envelope;
			return envelope;
		}
		case 'batch_inspect': {
			const envelope = batchInspectEnvelope(scene, payload);
			lastPayload = envelope;
			return envelope;
		}
		case 'snapshot':
		case 'render_frame_fast': {
			const envelope = snapshotEnvelope(scene, payload, kind, renderFastDiskOnly);
			lastPayload = envelope;
			return envelope;
		}
		case 'checkpoint': {
			const snapshotId = String(payload.snapshotId ?? `mock-${Date.now().toString(36)}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
			const state = scene.serialize();
			checkpoints.set(snapshotId, state);
			lastPayload = {
				ok: true,
				kind: 'checkpoint',
				seq: payload.seq ?? null,
				snapshotId,
				compId: scene.activeComp()?.id ?? null,
				frame: scene.frame,
				layerCount: scene.layers.size,
				state: JSON.parse(state),
				tmpFile: null,
			};
			return lastPayload;
		}
		case 'rollback': {
			const snapshotId = String(payload.snapshotId ?? '');
			const state = payload.state && typeof payload.state === 'object' ? JSON.stringify(payload.state) : checkpoints.get(snapshotId);
			if (!state) {
				lastPayload = { ok: false, kind: 'rollback', seq: payload.seq ?? null, code: 'STALLION_UNKNOWN_SNAPSHOT', error: `rollback cannot resolve snapshotId '${snapshotId}': no in-memory checkpoint and no inline state.` };
				return lastPayload;
			}
			scene.restore(state);
			lastPayload = {
				ok: true,
				kind: 'rollback',
				seq: payload.seq ?? null,
				snapshotId,
				compId: scene.activeComp()?.id ?? null,
				restoredFrame: scene.frame,
				layerCount: scene.layers.size,
				deleted: [],
				recreated: [],
				reappliedCount: scene.layers.size,
				keyframesRestored: 0,
				connectionsRestored: 0,
				connectionsSkipped: 0,
			};
			return lastPayload;
		}
		default:
			return { ok: false, error: `unsupported kind ${kind}` };
	}
}

let lastPayload: Record<string, unknown> | null = null;

function respondJson(response: http.ServerResponse, payload: unknown, status = 200): void {
	const body = JSON.stringify(payload);
	response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
	response.end(body);
}

// ---------------------------------------------------------------------------
// Live-bridge detection / base-URL resolution
// ---------------------------------------------------------------------------

/** True when a bridge answers at `baseUrl` (default 127.0.0.1:8080) within the budget. */
export async function isLiveStallionReachable(baseUrl = process.env.STALLION_URL ?? 'http://127.0.0.1:8080', timeoutMs = 750): Promise<boolean> {
	try {
		const response = await fetch(baseUrl.replace(/\/+$/, ''), { signal: AbortSignal.timeout(timeoutMs) });
		return response.ok || response.status === 401;
	} catch {
		return false;
	}
}

/**
 * The CI-friendly bridge URL: `MOCK_STALLION=1` forces the mock (bound to 8080
 * when free, otherwise ephemeral); otherwise a live Cavalry on :8080 wins;
 * otherwise the mock on an ephemeral port answers so headless environments
 * still run 100% of the synthetic pipeline.
 */
export async function resolveStallionBaseUrl(options: { mockPort?: number; forceMock?: boolean } = {}): Promise<{ url: string; mock: MockStallionServerHandle | null; live: boolean }> {
	const forceMock = options.forceMock ?? process.env.MOCK_STALLION === '1';
	if (!forceMock && (await isLiveStallionReachable())) {
		return { url: (process.env.STALLION_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, ''), mock: null, live: true };
	}
	const mock = await startMockStallionServer({ port: forceMock ? (options.mockPort ?? 8080) : 0 });
	return { url: mock.url, mock, live: false };
}
