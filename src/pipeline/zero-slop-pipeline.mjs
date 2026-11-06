/**
 * Zero-slop cloning pipeline: the 5-stage orchestration where everything that
 * CAN be deterministic IS deterministic, and the LLM is a single-shot rigger
 * plus at most one escalation turn.
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
 *   Stage 5 — Perceptual diffing & strict escalation gate (0 tokens on
 *       convergence)
 *       `coordinateDescentOptimizer` over the rig's tunables; COMPLETE when
 *       SSIM >= 0.96 AND bbox IoU >= 0.95. Below that after optimization, ONE
 *       escalation turn: residual crop + compactDomTsv → LLM structural patch
 *       → stages 3-5 once more. Never a second fallback.
 *
 * The LLM is injectable (`options.llm.complete(prompt) → manifest|patch`) so
 * the orchestrator is testable end-to-end without a model; with no `llm` and
 * no pre-supplied `manifest`, Stage 2 records `blocked` — an honest outcome,
 * never a fabricated rig.
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
import { loadCavalryLib } from '../cavalry/cavalry-lib.mjs';
import { computeSSIM } from '../vision/perceptual.mjs';

export const ZERO_SLOP_PIPELINE_VERSION = '1.0.0';

export const ZERO_SLOP_DEFAULTS = Object.freeze({
  ssimThreshold: 0.96,
  iouThreshold: 0.95,
  maxFallbackTurns: 1,
  optimizer: { threshold: 0.96, maxIterations: 12 },
  sampleStride: 6,
});

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
  lines.push('Reference tracks (frame -> value/box):');
  for (const track of tracks ?? []) {
    lines.push(`- ${track.elementId}: ${track.summary ?? ''}`);
  }
  return lines.join('\n');
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
  const impl = fetchImpl ?? globalThis.fetch;
  const url = String(baseUrl ?? process.env.STALLION_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json' };
  const bearer = token ?? process.env.STALLION_TOKEN ?? '';
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const seq = `zs-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const response = await impl(`${url}/post`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'batch-step', seq, script, dslManifest, sampleFrames, queryLayers, renderFrames, renderOutputDir }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw fail('STALLION_HTTP_ERROR', `batch-step POST failed with HTTP ${response.status}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = await impl(`${url}/get`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (poll.ok) {
      const text = await poll.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed.kind === 'batch-step' && String(parsed.seq) === seq) return parsed;
      } catch {
        // transient non-JSON payload; keep polling until the deadline
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw fail('STALLION_TIMEOUT', `no batch-step result for ${seq} within ${timeoutMs}ms`);
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
 * strict gate. On failure, ONE escalation turn is available.
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
  llm = null,
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
    escalation: null,
  };
  if (complete) return result;
  if (!llm || typeof llm.complete !== 'function') {
    result.escalation = { attempted: false, reason: 'no LLM hook provided; the clone stays below the gate' };
    return result;
  }
  // ONE escalation turn: residual evidence + compact DOM → structural patch.
  const residualBox = worstResidualBox(bestStage, tracks);
  const prompt = [
    'The clone is below the acceptance gate. Reply with ONLY a JSON patch manifest:',
    '{"ops":[{"op":"set|keyframe|easing|expression|fit","target":"$id",...}]}',
    `Measured scores: bboxIoU=${round2(iou)} ssim=${round2(ssim)} (need >= ${thresholds.iouThreshold} / ${thresholds.ssimThreshold}).`,
    `Worst-residual region: ${JSON.stringify(residualBox)}.`,
    'Current compact DOM (id\\ttype\\tparent\\tname\\tx,y,w,h\\tanimAttrs\\tconnections):',
    bestStage.compactDomTsv ?? '',
  ].join('\n');
  let answer;
  try {
    answer = await llm.complete(prompt);
  } catch (error) {
    result.escalation = { attempted: true, applied: false, error: String(error.message ?? error) };
    return result;
  }
  let patch;
  try {
    patch = parseManifestAnswer(answer);
  } catch (error) {
    result.escalation = { attempted: true, applied: false, error: String(error.message ?? error) };
    return result;
  }
  const patchedStage = await postBatchStep({
    dslManifest: patch,
    sampleFrames,
    renderFrames: true,
    renderOutputDir: runDirectory ? path.join(runDirectory, 'escalation') : undefined,
    ...client,
  });
  const patchedIou = meanGeometryIoU(patchedStage, tracks);
  const patchedSsim = await meanRenderedSsim(patchedStage, framePngPaths ?? {});
  result.escalation = {
    attempted: true,
    applied: true,
    iou: round2(patchedIou),
    ssim: round2(patchedSsim),
    complete: patchedSsim >= thresholds.ssimThreshold && patchedIou >= thresholds.iouThreshold,
  };
  if (result.escalation.complete) {
    result.iou = round2(patchedIou);
    result.ssim = round2(patchedSsim);
    result.complete = true;
    bestStage = patchedStage;
  }
  return result;
}

function worstResidualBox(stage, tracks) {
  let worst = null;
  let worstIou = 1;
  const geometryByLayer = new Map();
  for (const [frameKey, entry] of Object.entries(stage.frames ?? {})) {
    for (const geometry of entry.geometries ?? []) {
      const list = geometryByLayer.get(geometry.layerId) ?? [];
      list.push({ frame: Number(frameKey), box: geometry.bbox, name: geometry.name });
      geometryByLayer.set(geometry.layerId, list);
    }
  }
  for (const track of tracks ?? []) {
    for (const point of resolveGeometryLists(geometryByLayer, track)) {
      const referenceBox = track.boxesByFrame?.[point.frame];
      if (!referenceBox) continue;
      const iou = boxIoU(referenceBox, point.box);
      if (iou < worstIou) {
        worstIou = iou;
        worst = { layerId: track.layerId, frame: point.frame, iou: round2(iou), reference: referenceBox, measured: point.box };
      }
    }
  }
  return worst;
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
  if (stages.gate.escalation?.applied && stages.gate.complete) {
    llmCalls.push({ turn: 'escalation', applied: true });
  }

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
