/**
 * Zero-slop cloning pipeline: the 5-stage orchestration where everything that
 * CAN be deterministic IS deterministic, and the LLM is a single-shot rigger
 * only. There is no LLM escalation/refinement loop.
 *
 *   Stage 1 — Deconstruction & assets (0 tokens)
 *       SVG extraction (`svgExtractor`), style specs (`styleSpecExtractor`),
 *       Cavalry import (`stallionAssetBinder`).
 *   Stage 2 — Single-shot semantic rig synthesis (~1,200 tokens)
 *       One compact prompt (asset manifest + hex/typography specs + pre-fitted
 *       easing descriptors + bounded preset search) → the LLM answers with a
 *       declarative `_mg` manifest ONLY. No raw Cavalry JS, no keyframe math.
 *   Stage 3 — Direct compilation & atomic execution (0 tokens)
 *       `cavalry-mcp/lib`'s `compileMgDsl` → stallion `/batch-step`.
 *   Stage 4 — Mathematical bbox & curve alignment (0 tokens)
 *       `bboxTrajectorySolver` + `bezierCurveFitter` patches → `/batch-step`.
 *   Stage 4.5 — Deterministic local parameter refinement (0 tokens)
 *       `local_refiner.ts` polls `/batch_inspect` at the beat frames, computes
 *       the L2 bbox loss against the reference tracks and drives the numeric
 *       rig parameters with coordinate descent + Nelder-Mead until every frame
 *       is within 1.5 px position / 2% scale. Stage 5's SSIM only runs after.
 *   Stage 5 — Perceptual diffing & strict gate (0 tokens)
 *       `coordinateDescentOptimizer` over the rig's tunables; COMPLETE when
 *       SSIM >= 0.96 AND bbox IoU >= 0.95. A below-gate result is reported
 *       honestly and never retried through an LLM (local-only pipeline).
 *
 * The LLM is injectable (`options.llm.complete(prompt) → manifest`) so the
 * orchestrator is testable end-to-end without a model; with no `llm` and
 * no pre-supplied `manifest`, Stage 2 records `blocked` — an honest outcome,
 * never a fabricated rig. Stage 5 never calls the LLM.
 *
 * Bridge contract: every scene touch is a stallion `/batch-step` round trip
 * (`type: "batch-step"` on POST /post; the mock bridge also serves the literal
 * path). No MCP stdio JSON-RPC is involved anywhere in this file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { extractSvg } from '../assets/svgExtractor.ts';
import { extractStyleSpec } from '../assets/styleSpecExtractor.ts';
import { bindAssets } from '../assets/stallionAssetBinder.ts';
import { fitEasing } from '../solver/bezierCurveFitter.ts';
import { solveBboxTrajectories, alignmentToMgOp, boxIoU } from '../solver/bboxTrajectorySolver.ts';
import { optimizeCoordinateDescent, compositeLoss } from '../solver/coordinateDescentOptimizer.ts';
import { refineLocally, LOCAL_REFINER_DEFAULTS } from '../solver/local_refiner.ts';
import { fitSemanticBeat, beatsToPromptBlock } from '../promotion/trajectory_fitter.ts';
import { loadCavalryLib } from '../cavalry/cavalry-lib.mjs';
import { computeSSIM } from '../vision/perceptual.mjs';

export const ZERO_SLOP_PIPELINE_VERSION = '1.0.0';

export const ZERO_SLOP_DEFAULTS = Object.freeze({
  ssimThreshold: 0.96,
  iouThreshold: 0.95,
  optimizer: { threshold: 0.96, maxIterations: 12 },
  sampleStride: 6,
  localRefiner: { ...LOCAL_REFINER_DEFAULTS },
});

/**
 * Structural quality reference threshold (0.92). Retained as a measurement
 * landmark for parity tests; it no longer triggers any LLM escalation, which
 * was removed from this local-only pipeline.
 */
export const ESCALATION_SSIM_GATE = 0.92;

const fail = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

const round2 = (value) => Math.round(value * 100) / 100;

/** Decode one PNG file into the raster shape the asset/solver modules accept. */
export async function decodeFrame(pngPath) {
  const buffer = await fs.readFile(pngPath);
  const png = PNG.sync.read(buffer);
  return { data: png.data, width: png.width, height: png.height };
}

/**
 * Stage 1 — deconstruction & assets. Crops are vectorized to `.svg`, element
 * regions measured to style specs, and every produced file imported into the
 * live comp through one batch-step.
 */
export async function runStage1Deconstruction({ runDirectory, frames, crops, elements, binder }) {
  const assetsDirectory = path.join(runDirectory, 'assets');
  await fs.mkdir(assetsDirectory, { recursive: true });
  const assets = [];
  const styleSpecs = [];
  const errors = [];
  const frameRasters = new Map();
  for (const crop of crops ?? []) {
    const raster = frameRasters.get(crop.frame) ?? (await decodeFrame(crop.pngPath));
    frameRasters.set(crop.frame, raster);
    try {
      const outFile = path.join(assetsDirectory, `${crop.assetId}.svg`);
      const extraction = await extractSvg(raster, crop.box, {
        outFile,
        backgroundColor: crop.backgroundColor,
        backgroundTolerance: crop.backgroundTolerance,
      });
      if (!extraction) {
        errors.push({ assetId: crop.assetId, reason: 'no foreground pixels in crop' });
        continue;
      }
      assets.push({ id: crop.assetId, file: outFile, kind: 'svg' });
    } catch (error) {
      errors.push({ assetId: crop.assetId, reason: String(error.message ?? error) });
    }
  }
  for (const element of elements ?? []) {
    const raster = frameRasters.get(element.frame) ?? (await decodeFrame(element.pngPath));
    frameRasters.set(element.frame, raster);
    try {
      styleSpecs.push({ elementId: element.elementId, spec: extractStyleSpec(raster, element.box) });
    } catch (error) {
      errors.push({ elementId: element.elementId, reason: `style spec: ${String(error.message ?? error)}` });
    }
  }
  const manifest = assets.length ? await bindAssets(assets, binder ?? {}) : {
    version: 'skipped', compId: null, assets: [], ok: true, executionTimeMs: 0, compactDomTsv: null,
  };
  return { stage: 'deconstruction', assetsDirectory, assetFiles: assets, assetManifest: manifest, styleSpecs, errors };
}

/** Bounded preset discovery from the direct library — no catalog in any prompt. */
export async function searchPresetsForMotion(motionQuery, category) {
  const lib = await loadCavalryLib();
  if (!lib) return { available: false, presets: [] };
  const result = lib.searchPresets(motionQuery, category);
  return { available: true, presets: result.presets };
}

/** The Stage 2 prompt: compact, bounded, manifest-only answer enforced. */
export function buildRigPrompt({ assetManifest, styleSpecs, easingDescriptors, presetHits, comp, tracks }) {
  const lines = [];
  lines.push('You rig a Cavalry scene from measured evidence. Reply with ONLY a JSON `_mg` manifest:');
  lines.push('{"comp":{"width":1920,"height":1080,"fps":60,"endFrame":180},');
  lines.push(' "layers":[{"as":"$id","kind":"shape|layer|text|svg|image",...}],');
  lines.push(' "ops":[{"op":"set|keyframe|easing|connect|expression|fit|order|delete",...}]}');
  lines.push('No prose. No JavaScript. Reference imported assets as {"kind":"svg","file":"<the given file>"} and alias them exactly as given.');
  lines.push('');
  lines.push(`Comp: ${JSON.stringify(comp ?? {})}`);
  lines.push('Imported assets (use these files verbatim):');
  for (const asset of assetManifest.assets ?? []) {
    lines.push(`- ${asset.id} -> ${asset.file}${asset.bbox ? ` bbox ${JSON.stringify(round2(asset.bbox.x))},${JSON.stringify(round2(asset.bbox.y))},${JSON.stringify(round2(asset.bbox.width))}x${JSON.stringify(round2(asset.bbox.height))}` : ''}`);
  }
  lines.push('Measured style specs:');
  for (const entry of styleSpecs ?? []) {
    const spec = entry.spec ?? {};
    const palette = (spec.palette ?? []).slice(0, 3).map((color) => color.hex).join(' ');
    const type = spec.typography ? ` capHeight=${spec.typography.capHeightPx}px weight=${spec.typography.weightClass} tracking=${spec.typography.trackingPx}px` : '';
    lines.push(`- ${entry.elementId}: palette ${palette} radius=${spec.cornerRadius ?? 'null'}${type}`);
  }
  lines.push('Pre-fitted easing descriptors (use op "easing" with the given expression; do NOT invent curves):');
  for (const descriptor of easingDescriptors ?? []) {
    lines.push(`- ${descriptor.target} ${descriptor.attr}: ${JSON.stringify({ kind: descriptor.descriptor.kind, points: descriptor.descriptor.points, stiffness: descriptor.descriptor.stiffness, damping: descriptor.descriptor.damping, rmse: descriptor.descriptor.rmse })}`);
    lines.push(`  expression: ${descriptor.descriptor.expression}`);
  }
  lines.push('Motion vocabulary (preset library hits for these element classes; bind content params only):');
  for (const hit of presetHits ?? []) {
    lines.push(`- ${hit.elementId}: ${hit.presets.slice(0, 4).map((preset) => `${preset.id}(${preset.motionSignature})`).join(', ')}`);
  }
  // Reference evidence enters the prompt ONLY as fitted semantic spans — the
  // Stage 3 trajectory fitter's compact descriptors, never raw frame arrays.
  const beatDescriptors = fitBeatDescriptorsFromTracks(tracks);
  if (beatDescriptors.length) {
    lines.push(beatsToPromptBlock(beatDescriptors));
  } else {
    for (const track of tracks ?? []) {
      if (track.summary) lines.push(`- ${track.elementId}: ${track.summary}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build Stage 3 semantic beat descriptors from the tracked evidence. The raw
 * frames/values stay inside this function: only the fitter's token-counted
 * `promptLine` ever leaves it.
 */
export function fitBeatDescriptorsFromTracks(tracks) {
  const descriptors = [];
  const byElement = new Map();
  for (const track of tracks ?? []) {
    const inputs = byElement.get(track.elementId) ?? [];
    // Attribute tracks carry parallel frames/values arrays; box tracks become
    // centroid series (position) plus size series (scale) — still per-frame
    // measurements, consumed only by the fitter.
    for (const attributeTrack of track.attributeTracks ?? []) {
      if (!Array.isArray(attributeTrack.frames) || !Array.isArray(attributeTrack.values)) continue;
      inputs.push({
        elementId: track.elementId,
        property: attributeTrack.attr ?? attributeTrack.property ?? 'value',
        attributePath: attributeTrack.target ?? null,
        points: attributeTrack.frames.map((frame, index) => ({ frame: Number(frame), value: Number(attributeTrack.values[index]) })),
      });
    }
    const boxEntries = Object.entries(track.boxesByFrame ?? {});
    if (boxEntries.length >= 2) {
      inputs.push({ elementId: track.elementId, property: 'position.x', points: boxEntries.map(([frame, box]) => ({ frame: Number(frame), value: Number(box.x ?? box.cx ?? 0) + Number(box.width ?? box.w ?? 0) / 2 })) });
      inputs.push({ elementId: track.elementId, property: 'position.y', points: boxEntries.map(([frame, box]) => ({ frame: Number(frame), value: Number(box.y ?? box.cy ?? 0) + Number(box.height ?? box.h ?? 0) / 2 })) });
      inputs.push({ elementId: track.elementId, property: 'scale.width', points: boxEntries.map(([frame, box]) => ({ frame: Number(frame), value: Number(box.width ?? box.w ?? 0) })) });
    }
    if (inputs.length) byElement.set(track.elementId, inputs);
  }
  if (!byElement.size) return descriptors;
  const flat = [...byElement.values()].flat();
  const fps = Number(tracks?.find((track) => Number(track.fps) > 0)?.fps) || 30;
  try {
    descriptors.push(fitSemanticBeat({ beatId: tracks?.[0]?.beatId ?? 'beat_01', fps, tracks: flat }));
  } catch {
    // Over-budget descriptor: split per element so each stays bounded.
    for (const [elementId, trackInputs] of byElement) {
      try {
        descriptors.push(fitSemanticBeat({ beatId: `beat_${elementId}`.slice(0, 48), fps, tracks: trackInputs }));
      } catch {
        // Even a single element over budget stays out of the prompt; the
        // tracks' own `summary` (if any) is the honest fallback.
      }
    }
  }
  return descriptors;
}

/**
 * Stage 4.5 — deterministic local parameter refinement between compilation
 * and perceptual diffing (see solver/local_refiner.ts). Queries stallion's
 * /batch_inspect at the beat frames, computes the L2 bbox loss against the
 * reference tracks and drives the numeric rig parameters with coordinate
 * descent + Nelder-Mead until every frame is within epsPos/epsScale. Zero
 * LLM tokens by construction.
 */
export async function runStage45LocalRefinement({ stage3, tracks, tunables = [], client, options = {} }) {
  const layerIds = [];
  for (const track of tracks ?? []) {
    if (track.layerId && !layerIds.includes(track.layerId)) layerIds.push(track.layerId);
  }
  if (!layerIds.length || !tracks?.length) {
    return { stage: 'local-refinement', skipped: true, reason: 'no tracked layers to refine against', llmTokens: 0 };
  }
  if (!tunables.length) {
    return { stage: 'local-refinement', skipped: true, reason: 'no numeric tunables exposed by the rig', llmTokens: 0 };
  }
  const referenceBoxes = {};
  for (const track of tracks) {
    const perFrame = {};
    for (const [frame, box] of Object.entries(track.boxesByFrame ?? {})) {
      perFrame[Math.round(Number(frame))] = {
        x: Number(box.x ?? box.cx ?? 0),
        y: Number(box.y ?? box.cy ?? 0),
        width: Number(box.width ?? box.w ?? 0),
        height: Number(box.height ?? box.h ?? 0),
      };
    }
    if (Object.keys(perFrame).length) referenceBoxes[track.layerId] = perFrame;
  }
  // Beat frames: f_start, f_mid1, f_mid2, f_end across the sampled set.
  const sampled = Object.keys(stage3.frames ?? {}).map(Number).sort((a, b) => a - b);
  const beatFrames = sampled.length >= 4
    ? [sampled[0], sampled[Math.floor((sampled.length - 1) / 3)], sampled[Math.floor((2 * (sampled.length - 1)) / 3)], sampled[sampled.length - 1]]
    : sampled.slice();
  if (beatFrames.length < 2) {
    return { stage: 'local-refinement', skipped: true, reason: 'fewer than two sampled frames to measure', llmTokens: 0 };
  }
  const applyParams = async (params) => {
    const ops = [];
    for (const tunable of tunables) {
      if (!(tunable.name in params)) continue;
      ops.push({ op: 'set', target: tunable.target, attrs: { [tunable.attr]: params[tunable.name] } });
    }
    if (!ops.length) return true;
    const response = await postBatchStep({ dslManifest: { ops }, sampleFrames: beatFrames, ...client });
    return response.ok !== false;
  };
  const parameters = tunables.map((tunable) => ({
    name: tunable.name,
    value: Number(tunable.value ?? 0),
    ...(tunable.step != null ? { step: Number(tunable.step) } : {}),
    ...(tunable.min != null ? { min: Number(tunable.min) } : {}),
    ...(tunable.max != null ? { max: Number(tunable.max) } : {}),
  }));
  const refinement = await refineLocally({
    client: { batchInspect: async (request) => postBatchInspect({ ...request, ...client }) },
    layerIds,
    beatFrames,
    referenceBoxes,
    parameters,
    applyParams,
    options: options.refiner,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
  return { stage: 'local-refinement', skipped: false, beatFrames, refinement, llmTokens: 0 };
}

/** Parse the Stage 2 answer tolerantly: strip fences, find the outermost JSON object. */
export function parseManifestAnswer(text) {
  if (typeof text !== 'string') throw fail('LLM_ANSWER_INVALID', 'the rigger returned no text');
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  if (start < 0) throw fail('LLM_ANSWER_INVALID', 'no JSON object found in the rigger answer');
  const end = withoutFences.lastIndexOf('}');
  const candidate = end > start ? withoutFences.slice(start, end + 1) : withoutFences.slice(start);
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw fail('LLM_ANSWER_INVALID', `rigger answer is not valid JSON: ${String(error.message ?? error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) throw fail('LLM_ANSWER_INVALID', 'rigger answer is not an object');
  return parsed;
}

/**
 * Stage 3 — compile the manifest through the direct library and execute it in
 * ONE batch-step round trip together with the preset scripts.
 */
export async function runStage3Compile({ manifest, presetScripts, sampleFrames, renderFrames, renderOutputDir, client }) {
  const lib = await loadCavalryLib();
  if (!lib) throw fail('CAVALRY_LIB_UNAVAILABLE', 'cavalry-mcp/lib is not built; run npm install + npm run build in the sibling checkout');
  const compiled = lib.compileMgDsl(manifest);
  const script = presetScripts.length ? `${presetScripts.join('\n')}\n${compiled}` : compiled;
  return postBatchStep({
    script,
    sampleFrames,
    renderFrames,
    renderOutputDir,
    ...client,
  });
}

/** Raw batch-step POST — the single wire the whole pipeline speaks. */
export async function postBatchStep({ script, dslManifest, sampleFrames = [], queryLayers, renderFrames, renderOutputDir, baseUrl, token, fetchImpl, timeoutMs = 120_000 }) {
  return postKind('batch-step', { script, dslManifest, sampleFrames, queryLayers, renderFrames, renderOutputDir }, { baseUrl, token, fetchImpl, timeoutMs });
}

/** Raw batch_inspect POST — geometry-only multi-frame readback (no pixels). */
export async function postBatchInspect({ frames, layerIds, attributes, includeHidden, compId, baseUrl, token, fetchImpl, timeoutMs = 60_000 }) {
  return postKind('batch_inspect', { frames, layerIds, attributes, includeHidden, compId }, { baseUrl, token, fetchImpl, timeoutMs });
}

/** One POST /post + GET /get round trip for any v0.11 introspection kind. */
async function postKind(kind, fields, { baseUrl, token, fetchImpl, timeoutMs }) {
  const impl = fetchImpl ?? globalThis.fetch;
  const url = String(baseUrl ?? process.env.STALLION_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json' };
  const bearer = token ?? process.env.STALLION_TOKEN ?? '';
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const seq = `zs-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const body = { type: kind, seq };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body[key] = value;
  }
  const response = await impl(`${url}/post`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw fail('STALLION_HTTP_ERROR', `${kind} POST failed with HTTP ${response.status}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = await impl(`${url}/get`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (poll.ok) {
      const text = await poll.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed.kind === kind && String(parsed.seq) === seq) return parsed;
      } catch {
        // transient non-JSON payload; keep polling until the deadline
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw fail('STALLION_TIMEOUT', `no ${kind} result for ${seq} within ${timeoutMs}ms`);
}

/**
 * Geometry lookup: batch-step geometry is keyed by live layer id, but tracks
 * are authored against manifest aliases/names (the id→alias mapping lives
 * inside Cavalry). Resolve by id first, then by layer name, then by the
 * alias-with-$ prefix stripped.
 */
function resolveGeometryLists(geometryByLayer, track) {
  const direct = geometryByLayer.get(track.layerId);
  if (direct?.length) return direct;
  const bare = String(track.layerId ?? '').replace(/^\$+/, '');
  for (const [layerId, list] of geometryByLayer) {
    if (layerId === bare) return list;
    const names = list.map((point) => point.name);
    if (names.includes(bare) || names.includes(track.layerId)) return list;
  }
  return [];
}

/**
 * Stage 4 — geometry and curve alignment. Computes analytical patches from
 * the Stage 3 frame geometry vs the reference tracks and applies them in a
 * second batch-step.
 */
export async function runStage4Alignment({ stage3, tracks, sampleFrames, client }) {
  const alignments = [];
  const easingPatches = [];
  const skipped = [];
  const geometryByLayer = new Map();
  for (const [frameKey, entry] of Object.entries(stage3.frames ?? {})) {
    for (const geometry of entry.geometries ?? []) {
      const list = geometryByLayer.get(geometry.layerId) ?? [];
      list.push({ frame: Number(frameKey), box: geometry.bbox, name: geometry.name });
      geometryByLayer.set(geometry.layerId, list);
    }
  }
  for (const track of tracks ?? []) {
    const cavalryFrames = resolveGeometryLists(geometryByLayer, track);
    if (!cavalryFrames.length) {
      skipped.push({ layerId: track.layerId, reason: 'layer not present in batch-step geometry' });
      continue;
    }
    const cavalry = [];
    const reference = [];
    for (const point of cavalryFrames) {
      const referenceBox = track.boxesByFrame?.[point.frame];
      if (!referenceBox) continue;
      reference.push(referenceBox);
      cavalry.push(point.box);
    }
    if (!reference.length) {
      skipped.push({ layerId: track.layerId, reason: 'no overlapping sampled frames with the reference track' });
      continue;
    }
    const alignment = solveBboxTrajectories([{ layerId: track.layerId, reference, cavalry }]).alignments[0];
    if (alignment) alignments.push(alignment);
    else skipped.push({ layerId: track.layerId, reason: 'solver produced no alignment' });
  }
  for (const attributeTrack of tracks?.flatMap((track) => track.attributeTracks ?? []) ?? []) {
    const descriptor = fitEasingFromTrackSafe(attributeTrack);
    if (descriptor) easingPatches.push({ target: attributeTrack.target, attr: attributeTrack.attr, descriptor });
  }
  const ops = alignments.map((alignment) => alignmentToMgOp(alignment)).filter(Boolean);
  const easingOps = easingPatches.map((patch) => ({
    op: 'easing',
    target: patch.target,
    attr: patch.attr,
    frame: patch.descriptor.frame ?? 0,
    easing: patch.descriptor.easing,
    expression: patch.descriptor.expression,
  }));
  const allOps = [...ops, ...easingOps];
  let applyResult = null;
  if (allOps.length) {
    applyResult = await postBatchStep({
      dslManifest: { ops: allOps },
      sampleFrames,
      ...client,
    });
  }
  return { stage: 'alignment', alignments, easingPatches, skipped, applyResult };
}

function fitEasingFromTrackSafe(track) {
  try {
    if (!track?.frames?.length || !track.values?.length) return null;
    const descriptor = fitEasing(track.frames.map((frame, index) => ({ t: frame, y: track.values[index] })));
    if (!descriptor) return null;
    return { ...descriptor, frame: track.frames[track.frames.length - 1] ?? 0 };
  } catch {
    return null;
  }
}

/** Mean IoU between the reference boxes and the sampled geometry, per layer. */
export function meanGeometryIoU(stage, tracks) {
  const geometryByLayer = new Map();
  for (const [frameKey, entry] of Object.entries(stage.frames ?? {})) {
    for (const geometry of entry.geometries ?? []) {
      const list = geometryByLayer.get(geometry.layerId) ?? [];
      list.push({ frame: Number(frameKey), box: geometry.bbox, name: geometry.name });
      geometryByLayer.set(geometry.layerId, list);
    }
  }
  const ious = [];
  for (const track of tracks ?? []) {
    for (const point of resolveGeometryLists(geometryByLayer, track)) {
      const referenceBox = track.boxesByFrame?.[point.frame];
      if (!referenceBox) continue;
      ious.push(boxIoU(referenceBox, point.box));
    }
  }
  return ious.length ? ious.reduce((sum, value) => sum + value, 0) / ious.length : 0;
}

/** Mean SSIM between rendered frames and the reference PNGs. */
export async function meanRenderedSsim(stage, framePngPaths) {
  const pairs = [];
  for (const [frameKey, entry] of Object.entries(stage.frames ?? {})) {
    const referencePath = framePngPaths[String(frameKey)] ?? framePngPaths[Number(frameKey)];
    if (!referencePath || !entry.renderedPngPath) continue;
    pairs.push([referencePath, entry.renderedPngPath]);
  }
  if (!pairs.length) return 0;
  const scores = [];
  for (const [referencePath, renderedPath] of pairs) {
    const a = PNG.sync.read(await fs.readFile(referencePath));
    let b;
    try {
      b = PNG.sync.read(await fs.readFile(renderedPath));
    } catch {
      // The mock bridge writes a real RGBA sidecar next to its (fake) PNG —
      // the live bridge writes real PNGs. Decode whichever is present.
      b = decodeRgbaSidecar(await fs.readFile(`${renderedPath}.rgba`), a.width, a.height);
    }
    if (!b || a.width !== b.width || a.height !== b.height) {
      scores.push(0);
      continue;
    }
    scores.push(computeSSIM({ data: a.data, width: a.width, height: a.height }, { data: b.data, width: b.width, height: b.height }));
  }
  return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
}

function decodeRgbaSidecar(buffer, width, height) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== width * height * 4) return null;
  return { data: buffer, width, height };
}

/**
 * Stage 5 — optimization + gate. Runs bounded coordinate descent over the
 * rig's tunables (each candidate is a real batch-step evaluation), then the
 * strict gate. Local-only: a below-gate result is reported honestly and never
 * retried through an LLM. The `llm` parameter is accepted for backwards
 * signature compatibility and is deliberately ignored.
 */
export async function runStage5Gate({
  stage3,
  tracks,
  framePngPaths,
  tunables = [],
  client,
  runDirectory,
  thresholds = ZERO_SLOP_DEFAULTS,
  optimizerOptions = ZERO_SLOP_DEFAULTS.optimizer,
  llm = null, // ignored: no LLM escalation remains in this pipeline
}) {
  const sampleFrames = Object.keys(stage3.frames ?? {}).map(Number).sort((a, b) => a - b);
  const applyParams = async (params) => {
    // Each tunable names the rig knob it drives: {name, target, attr}.
    const ops = [];
    for (const tunable of tunables) {
      if (!(tunable.name in params)) continue;
      ops.push({ op: 'set', target: tunable.target, attrs: { [tunable.attr]: params[tunable.name] } });
    }
    if (!ops.length) return stage3;
    return postBatchStep({ dslManifest: { ops }, sampleFrames, renderFrames: true, renderOutputDir: runDirectory ? path.join(runDirectory, 'optimize') : undefined, ...client });
  };
  let bestStage = stage3;
  let optimization = null;
  if (tunables.length) {
    optimization = await optimizeCoordinateDescent(
      tunables,
      async (params) => {
        const stage = await applyParams(params);
        return {
          iou: meanGeometryIoU(stage, tracks),
          ssim: await meanRenderedSsim(stage, framePngPaths ?? {}),
        };
      },
      optimizerOptions,
    );
    bestStage = await applyParams(optimization.params);
  }
  const iou = meanGeometryIoU(bestStage, tracks);
  const ssim = await meanRenderedSsim(bestStage, framePngPaths ?? {});
  const complete = ssim >= thresholds.ssimThreshold && iou >= thresholds.iouThreshold;
  const result = {
    stage: 'gate',
    iou: round2(iou),
    ssim: round2(ssim),
    complete,
    optimization,
    // Local-only pipeline: LLM escalation was removed. A failing gate is
    // reported, never patched by a model turn, regardless of any llm hook.
    escalation: { attempted: false, reason: 'local-only pipeline: LLM escalation removed; below-gate fidelity is reported honestly, never retried' },
    escalationGate: ESCALATION_SSIM_GATE,
  };
  return result;
}

/**
 * Full pipeline. `options.manifest` bypasses Stage 2 (deterministic runs and
 * tests); otherwise `options.llm.complete(prompt)` must return the manifest.
 */
export async function runZeroSlopPipeline(options = {}) {
  const startedAt = Date.now();
  const runDirectory = options.runDirectory ?? path.join(process.cwd(), 'jobs', `zero-slop-${Date.now().toString(36)}`);
  await fs.mkdir(runDirectory, { recursive: true });
  const thresholds = { ...ZERO_SLOP_DEFAULTS, ...(options.thresholds ?? {}) };
  const client = { baseUrl: options.baseUrl, token: options.token, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs };
  const sampleFrames = options.sampleFrames ?? sampleFramesFromTracks(options.tracks);
  const stages = {};

  stages.deconstruction = await runStage1Deconstruction({
    runDirectory,
    frames: options.frames ?? [],
    crops: options.crops ?? [],
    elements: options.elements ?? [],
    binder: client,
  });

  let manifest = options.manifest ?? null;
  let prompt = null;
  const llmCalls = [];
  if (!manifest) {
    if (!options.llm || typeof options.llm.complete !== 'function') {
      return {
        version: ZERO_SLOP_PIPELINE_VERSION,
        runDirectory,
        blocked: true,
        reason: 'no manifest and no LLM hook: Stage 2 cannot synthesize a rig',
        stages,
        llmCalls,
        durationMs: Date.now() - startedAt,
      };
    }
    const presetHits = [];
    for (const element of options.elements ?? []) {
      if (!element.motionQuery) continue;
      presetHits.push({ elementId: element.elementId, ...(await searchPresetsForMotion(element.motionQuery, element.category)) });
    }
    prompt = buildRigPrompt({
      assetManifest: stages.deconstruction.assetManifest,
      styleSpecs: stages.deconstruction.styleSpecs,
      easingDescriptors: options.easingDescriptors ?? [],
      presetHits,
      comp: options.comp,
      tracks: options.tracks,
    });
    const answer = await options.llm.complete(prompt);
    llmCalls.push({ turn: 'rig', promptChars: prompt.length, answerChars: String(answer ?? '').length });
    manifest = parseManifestAnswer(answer);
  }
  stages.rig = { stage: 'rig', manifest, promptChars: prompt ? prompt.length : 0 };

  const presetScripts = options.presetScripts ?? [];
  stages.compilation = await runStage3Compile({
    manifest,
    presetScripts,
    sampleFrames,
    renderFrames: options.renderFrames !== false,
    renderOutputDir: path.join(runDirectory, 'frames'),
    client,
  });
  if (stages.compilation.ok === false) {
    return {
      version: ZERO_SLOP_PIPELINE_VERSION,
      runDirectory,
      blocked: true,
      reason: `batch-step failed: ${stages.compilation.error ?? 'unknown'}`,
      stages,
      llmCalls,
      durationMs: Date.now() - startedAt,
    };
  }

  stages.alignment = await runStage4Alignment({
    stage3: stages.compilation,
    tracks: options.tracks ?? [],
    sampleFrames,
    client,
  });

  // Stage 4.5 — deterministic numeric refinement against /batch_inspect.
  // Zero LLM tokens; SSIM (Stage 5) is only worth paying for once this
  // converges, so it runs strictly after.
  stages.localRefinement = await runStage45LocalRefinement({
    stage3: stages.compilation,
    tracks: options.tracks ?? [],
    tunables: options.tunables ?? [],
    client,
    options: { refiner: thresholds.localRefiner, timeoutMs: options.timeoutMs },
  });

  stages.gate = await runStage5Gate({
    stage3: stages.compilation,
    tracks: options.tracks ?? [],
    framePngPaths: options.framePngPaths ?? {},
    tunables: options.tunables ?? [],
    client,
    runDirectory,
    thresholds,
    optimizerOptions: thresholds.optimizer,
    llm: options.llm ?? null,
  });

  return {
    version: ZERO_SLOP_PIPELINE_VERSION,
    runDirectory,
    blocked: false,
    complete: stages.gate.complete === true,
    scores: { iou: stages.gate.iou, ssim: stages.gate.ssim },
    llmCalls,
    stages,
    durationMs: Date.now() - startedAt,
  };
}

/** Default sampling: the union of every track's frames, deduped and sorted. */
export function sampleFramesFromTracks(tracks) {
  const frames = new Set();
  for (const track of tracks ?? []) {
    for (const frame of Object.keys(track.boxesByFrame ?? {})) frames.add(Number(frame));
  }
  return [...frames].sort((a, b) => a - b);
}
