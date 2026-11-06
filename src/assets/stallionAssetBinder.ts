/**
 * Asset binding: push extracted `.svg` / image files into the live Cavalry
 * comp through stallion's `/batch-step` and hand back an `AssetManifest`
 * mapping the run's semantic asset ids to live layer ids.
 *
 * One HTTP round trip per manifest: the generated script imports every SVG
 * with `api.convertSVGToLayers` (verified 2.8 API), every raster with the
 * `image` layer + `assetPath`, aliases each result with `_mg.alias` under the
 * semantic id (`asset_logo_1` → `@asset_logo_1`), measures the import's
 * bounding box at the current frame and reports per-asset ok/error. The
 * post goes out as `type: "batch-step"` (the live bridge multiplexes it on
 * POST /post; the mock also serves the literal path).
 *
 * This module MUTATES the scene, so it deliberately does not use
 * `stallion-batch.mjs`'s read-only client — it speaks the same wire shape
 * with its own tiny poster instead.
 */

import { pathToFileURL } from "node:url";

export const ASSET_BINDER_VERSION = "1.0.0";

export interface BindableAsset {
	/** Semantic id the rest of the pipeline addresses ("asset_logo_1"). */
	id: string;
	/** Absolute disk path of the .svg or image file. */
	file: string;
	/** "svg" imports through convertSVGToLayers; anything else via image+assetPath. */
	kind: "svg" | "image";
}

export interface BoundAsset {
	id: string;
	/** Primary imported layer id. */
	layerId: string | null;
	/** Extra layers an SVG expanded into (convertSVGToLayers may return many). */
	extraLayerIds: string[];
	/** Alias registered in the scene, when the import succeeded. */
	alias: string | null;
	bbox: { x: number; y: number; width: number; height: number } | null;
	ok: boolean;
	error?: string;
}

export interface AssetManifest {
	version: string;
	compId: string | null;
	assets: BoundAsset[];
	ok: boolean;
	executionTimeMs: number;
	compactDomTsv: string | null;
}

export interface BinderOptions {
	/** Stallion base URL (STALLION_URL or 127.0.0.1:8080). */
	baseUrl?: string;
	/** Bearer token when stallion.json enables auth. */
	token?: string;
	/** Result deadline for the batch-step round trip. */
	timeoutMs?: number;
	/** Injected fetch for tests. */
	fetchImpl?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scene-URI form (forward slashes) — the bridge's path contract. */
export function toSceneUri(diskPath: string): string {
	return String(diskPath).replaceAll("\\", "/");
}

/**
 * Build the batch-step script that imports the assets. `_mg` is preloaded by
 * the bridge (v0.11+); the script only needs the public helpers.
 */
export function buildAssetImportScript(assets: BindableAsset[], seq: string): string {
	const payload = assets.map((asset) => ({
		id: asset.id,
		kind: asset.kind,
		file: toSceneUri(asset.file),
	}));
	return `/* refclone asset binder — one import per manifest entry */
var __assets = ${JSON.stringify(payload)};
var __read = function (fn) { try { return fn(); } catch (e) { return null; } };
var __results = [];
for (var i = 0; i < __assets.length; i++) {
  (function (entry) {
    var record = { id: entry.id, ok: false, layerId: null, extraLayerIds: [], alias: null, bbox: null };
    try {
      if (entry.kind === "svg") {
        var ids = api.convertSVGToLayers(entry.file);
        if (!ids || !ids.length) throw new Error("convertSVGToLayers returned no layers for " + entry.file);
        record.layerId = String(ids[0]);
        for (var k = 1; k < ids.length; k++) record.extraLayerIds.push(String(ids[k]));
      } else {
        var id = api.create("image", entry.id);
        api.set(id, { assetPath: entry.file });
        record.layerId = String(id);
      }
      if (typeof _mg !== "undefined" && _mg.alias) {
        record.alias = _mg.alias(record.layerId, entry.id);
      }
      var bb = __read(function () { return api.getBoundingBox(record.layerId, true); });
      if (bb) {
        record.bbox = {
          x: Number(bb.x) || 0,
          y: Number(bb.y) || 0,
          width: Number(bb.width) || 0,
          height: Number(bb.height) || 0
        };
      }
      record.ok = true;
    } catch (err) {
      record.error = String(err && err.message ? err.message : err);
    }
    __results.push(record);
  })(__assets[i]);
}
return { seq: ${JSON.stringify(seq)}, assets: __results };`;
}

/**
 * Import every asset in one batch-step call and return the manifest. Network
 * and protocol failures throw (the caller owns retry policy); per-asset
 * import failures come back inside the manifest as `ok: false`.
 */
export async function bindAssets(assets: BindableAsset[], options: BinderOptions = {}): Promise<AssetManifest> {
	if (!assets.length) {
		return { version: ASSET_BINDER_VERSION, compId: null, assets: [], ok: true, executionTimeMs: 0, compactDomTsv: null };
	}
	const baseUrl = String(options.baseUrl ?? process.env.STALLION_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
	const token = options.token ?? process.env.STALLION_TOKEN ?? "";
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 120_000;
	const seq = `asset-bind-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (token) headers.authorization = `Bearer ${token}`;

	const post = await fetchImpl(`${baseUrl}/post`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			type: "batch-step",
			seq,
			script: buildAssetImportScript(assets, seq),
			sampleFrames: [],
		}),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!post.ok) {
		throw new Error(`stallionAssetBinder: POST /post failed with HTTP ${post.status}`);
	}

	// The live bridge acks the enqueue and serves the result on GET /get; the
	// mock answers the path-shaped POST directly when the caller prefers it.
	let envelope: Record<string, unknown> | null = null;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const poll = await fetchImpl(`${baseUrl}/get`, { headers, signal: AbortSignal.timeout(timeoutMs) });
		if (poll.ok) {
			const text = await poll.text();
			try {
				const parsed = JSON.parse(text) as Record<string, unknown>;
				if (parsed.kind === "batch-step" && String(parsed.seq) === seq) {
					envelope = parsed;
					break;
				}
			} catch {
				// non-JSON ack or transient payload; keep polling until the deadline
			}
		}
		await sleep(20);
	}
	if (!envelope) {
		throw new Error(`stallionAssetBinder: no batch-step result for ${seq} within ${timeoutMs}ms — is Cavalry's Stallion bridge at v0.11+?`);
	}

	const started = Number(envelope.executionTimeMs) || 0;
	const scriptResult = (envelope.scriptResult ?? null) as { assets?: Array<Record<string, unknown>>; seq?: string } | null;
	const imported = scriptResult && Array.isArray(scriptResult.assets) ? scriptResult.assets : [];
	const bound: BoundAsset[] = assets.map((asset) => {
		const record = imported.find((entry) => String(entry.id) === asset.id);
		if (!record) {
			return { id: asset.id, layerId: null, extraLayerIds: [], alias: null, bbox: null, ok: false, error: "no import record returned" };
		}
		return {
			id: asset.id,
			layerId: record.layerId == null ? null : String(record.layerId),
			extraLayerIds: Array.isArray(record.extraLayerIds) ? record.extraLayerIds.map(String) : [],
			alias: record.alias == null ? null : String(record.alias),
			bbox: (record.bbox as BoundAsset["bbox"]) ?? null,
			ok: record.ok === true,
			...(record.error ? { error: String(record.error) } : {}),
		};
	});
	return {
		version: ASSET_BINDER_VERSION,
		compId: envelope.compId == null ? null : String(envelope.compId),
		assets: bound,
		ok: bound.every((asset) => asset.ok),
		executionTimeMs: started,
		compactDomTsv: typeof envelope.compactDomTsv === "string" ? envelope.compactDomTsv : null,
	};
}

/** File URL form for scripts that must hand Cavalry a readable path. */
export function assetFileUri(diskPath: string): string {
	return pathToFileURL(diskPath).href;
}
