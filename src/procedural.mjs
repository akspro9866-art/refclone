// Procedural route orchestrator: beats -> tracks -> promotion -> one _mg script -> gate.
//
// Stage 5 runs only when a live render transport is supplied. Without one the route stops
// after compilation and says so; it never fabricates a render or a convergence result.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, WorkflowError } from './core.mjs';
import { segmentBeats } from './stages/beatSegmentation.mjs';
import { normalizeTracks, smoothTracks } from './stages/kinematicTracking.mjs';
import { evaluateLayerAt, promoteTracks } from './stages/proceduralPromotion.mjs';
import { extractVectors } from './stages/vectorExtract.mjs';
import { compilePromotion } from './dsl/_mg.mjs';
import { boxOverlapArea, runPerceptualGate } from './stages/perceptualDiff.mjs';
import { extractReferenceFrames, isVideoInput } from './stages/referenceExtract.mjs';

export const PROCEDURAL_VERSION = '1.0.0';
export const TOKEN_BUDGET = 800;
export const DEFAULT_THRESHOLD = 1.5;
export const DEFAULT_MAX_PASSES = 3;
export const DEFAULT_MAX_ERROR = 2.0;
export const DEFAULT_MAX_LAYERS_PER_BEAT = 4;

/** The shipped ten-layer fixture is the dry-run input, so the route works with no setup. */
export function defaultFixturePath() {
  return fileURLToPath(new URL('../examples/procedural/synthetic-ten-layer.json', import.meta.url));
}

function positiveNumber(value, label, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new WorkflowError('PROCEDURAL_OPTIONS_INVALID', `${label} must be a finite percentage from 0 to 100.`, { [label]: value });
  }
  return parsed;
}

function passCount(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new WorkflowError('PROCEDURAL_OPTIONS_INVALID', 'maxPasses must be an integer from 1 to 10.', { maxPasses: value });
  }
  return parsed;
}

/** Counts literal two-level numeric arrays, the shape a frame-baked keyframe table has. */
export function frameBakedArrays(script) {
  return (String(script).match(/\[\s*\[\s*-?\d/g) ?? []).length;
}

function layerBox(layer, options) {
  return options.layerBoxes?.[layer.id] ?? (options.layerBoxes instanceof Map ? options.layerBoxes.get(layer.id) : null) ?? layer.box ?? null;
}

function maxLayerCount(value) {
  if (value === undefined) return DEFAULT_MAX_LAYERS_PER_BEAT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new WorkflowError('PROCEDURAL_OPTIONS_INVALID', 'maxLayersPerBeat must be an integer from 1 to 8.', { maxLayersPerBeat: value });
  }
  return parsed;
}

/**
 * Stage 5 target selection: every layer actively moving (directly or through a stagger
 * group) inside the beat window, ranked by displacement magnitude — or by projected
 * bounding-box overlap with the odiff mismatch region when every candidate has a known
 * box. At most `maxLayersPerBeat` (default 4) targets are returned, primary first, so a
 * single batched _mg.patch can correct several moving elements per refinement pass.
 *
 * expected/expectedKnown describe the promoted pose at `options.frame` (default: the
 * beat peak). Stagger followers are expectedKnown: false: their on-screen pose also
 * depends on the group rule, so the gate must send a relative delta rather than an
 * absolute value it cannot prove.
 */
export function layersForBeat(beat, promotedTracks, options = {}) {
  if (!beat) return [];
  const limit = maxLayerCount(options.maxLayersPerBeat);
  const inFrame = Math.round(Number(beat.inFrame));
  const outFrame = Math.round(Number(beat.outFrame));
  if (!Number.isFinite(inFrame) || !Number.isFinite(outFrame)) return [];
  const requestedFrame = Number.isFinite(Number(options.frame)) ? Number(options.frame) : Number(beat.peakFrame);
  const frame = Math.round(Math.max(inFrame, Math.min(outFrame, Number.isFinite(requestedFrame) ? requestedFrame : (inFrame + outFrame) / 2)));
  const groups = new Map((promotedTracks?.groups ?? []).map(group => [group.id, group]));
  const candidates = [];
  for (const layer of promotedTracks?.layers ?? []) {
    const activeMoves = (layer.moves ?? []).filter(move => Number(move.outFrame) >= inFrame && Number(move.inFrame) <= outFrame);
    let amplitude = activeMoves.reduce((total, move) => total + Math.abs(Number(move.to) - Number(move.from)), 0);
    let groupId = null;
    let groupActive = false;
    if (layer.group) {
      const group = groups.get(layer.group);
      if (group) {
        const memberIndex = Math.max(0, group.memberIds?.indexOf(layer.id) ?? 0);
        const start = Number(group.inFrame) + memberIndex * Number(group.delayFrames ?? 0);
        const end = Number(group.outFrame) + memberIndex * Number(group.delayFrames ?? 0);
        groupActive = end >= inFrame && start <= outFrame && Number(group.to) !== Number(group.from);
        if (groupActive) {
          groupId = group.id;
          amplitude += Math.abs(Number(group.to) - Number(group.from));
        }
      }
    }
    if (activeMoves.length === 0 && !groupActive) continue;
    const box = layerBox(layer, options);
    const groupAttr = groupId ? groups.get(groupId)?.attr : null;
    // A positional stagger rule moves this layer at a frame the promoted layer alone
    // cannot evaluate, so only the in-place delta is provably safe for it.
    const expectedKnown = groupAttr !== 'position.x' && groupAttr !== 'position.y';
    candidates.push({
      layerId: layer.id,
      name: layer.name ?? layer.id,
      amplitude: Math.round(amplitude * 1000) / 1000,
      expected: expectedKnown ? evaluateLayerAt(layer, frame) : null,
      expectedKnown,
      groupId,
      box,
      overlap: box && options.mismatchBox ? boxOverlapArea(box, options.mismatchBox) : null,
      frame
    });
  }
  // If the odiff mismatch box and every candidate box are known, spatial evidence
  // outranks raw amplitude; otherwise amplitude alone decides and ties keep scene order.
  const useOverlap = Boolean(options.mismatchBox) && candidates.length > 0 && candidates.every(candidate => candidate.box);
  const scored = candidates.map((candidate, order) => ({
    candidate, order,
    score: useOverlap ? Number(candidate.overlap) || 0 : candidate.amplitude
  }));
  scored.sort((a, b) => (b.score - a.score) || (b.candidate.amplitude - a.candidate.amplitude) || (a.order - b.order));
  return scored.slice(0, limit).map((entry, rank) => ({
    ...entry.candidate,
    rank,
    primary: rank === 0,
    basis: useOverlap ? 'mismatch-overlap' : 'displacement'
  }));
}

/** Single-layer compatibility helper: the primary moving layer of a beat, or null. */
export function layerForBeat(beat, promotedTracks, options = {}) {
  return layersForBeat(beat, promotedTracks, { ...options, maxLayersPerBeat: 1 })[0] ?? null;
}

async function loadScene(inputPath) {
  let stat;
  try {
    stat = await fs.stat(inputPath);
  } catch (error) {
    throw new WorkflowError('FILE_READ_FAILED', 'Procedural input is not readable.', { input: inputPath, reason: error.code });
  }
  if (!stat.isFile()) throw new WorkflowError('FILE_READ_FAILED', 'Procedural input must be a file.', { input: inputPath });
  if (path.extname(inputPath).toLowerCase() !== '.json') return null;
  let scene;
  try {
    scene = await readJson(inputPath);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError('FILE_READ_FAILED', 'Procedural scene JSON is not readable.', { input: inputPath, reason: error.code });
  }
  if (!Array.isArray(scene.tracks) && !Array.isArray(scene.elements)) {
    throw new WorkflowError('PROCEDURAL_INPUT_INVALID', 'A procedural scene JSON needs a tracks or elements array.', { input: inputPath });
  }
  return scene;
}

/**
 * Stage 2A. A scene may list isolated raster crops; each is traced to geometry and
 * attached to the track with the same id. Crops are resolved relative to the scene
 * file, never the process working directory. A failed crop stays absent and is
 * reported, never replaced by a placeholder path.
 */
async function attachVectors(scene, scenePath, tracks, options = {}) {
  const crops = Array.isArray(options.crops) ? options.crops : scene?.crops;
  if (!Array.isArray(crops) || crops.length === 0) return { tracks, vectors: null, limitations: [] };
  const base = path.dirname(scenePath);
  const resolvedCrops = crops.map(crop => {
    if (typeof crop === 'string') return { id: path.basename(crop, path.extname(crop)), path: path.resolve(base, crop) };
    return crop?.path ? { ...crop, path: path.resolve(base, crop.path) } : crop;
  });
  const result = await extractVectors(resolvedCrops, options.vector);
  const byId = new Map(result.vectors.map(entry => [entry.id, entry]));
  const enriched = tracks.map(track => {
    const vector = byId.get(track.id);
    if (!vector?.available) return track;
    return { ...track, vector: { ...(track.vector ?? {}), d: vector.d, svg: vector.svg, viewBox: vector.viewBox ?? null } };
  });
  const limitations = [...result.limitations];
  for (const entry of result.vectors) {
    if (!enriched.some(track => track.id === entry.id)) limitations.push(`Vector ${entry.id} has no matching track; its geometry is not emitted.`);
  }
  return {
    tracks: enriched,
    vectors: {
      available: result.available,
      count: result.vectors.length,
      traced: result.vectors.filter(entry => entry.available).length,
      removedBytes: result.vectors.reduce((total, entry) => total + (entry.removedBytes ?? 0), 0),
      errors: result.vectors.filter(entry => !entry.available).map(entry => ({ id: entry.id, error: entry.error }))
    },
    limitations
  };
}

/**
 * Run the procedural route.
 *
 * options:
 *   dryRun           compile only; never touches Cavalry
 *   threshold        Stage 5 mismatch percentage (default 1.5)
 *   maxPasses        Stage 5 pass ceiling (default 3)
 *   tracksPath       Stage 2B tracker JSON when the input is a video
 *   referenceFrames  map/directory/pattern for Stage 5
 *   client           live transport: { exec(script), renderFrames({frames,directory}) }
 *   liveInfo         session facts (server, tools, checks, roots) recorded in the result
 *   outputDirectory  write the promotion, script and report with exclusive-create semantics
 *   smooth           apply Savitzky-Golay smoothing (default false; fixtures are pre-measured)
 */
export async function runProcedural(inputPath, options = {}) {
  const dryRun = options.dryRun === true;
  const threshold = positiveNumber(options.threshold, 'threshold', DEFAULT_THRESHOLD);
  const maxPasses = passCount(options.maxPasses, DEFAULT_MAX_PASSES);
  const maxLayersPerBeat = maxLayerCount(options.maxLayersPerBeat);
  const resolvedInput = path.resolve(inputPath ?? defaultFixturePath());
  if (options.autoReference === true && !isVideoInput(resolvedInput)) {
    throw new WorkflowError('REFERENCE_AUTO_REQUIRES_VIDEO',
      'Auto reference extraction reads a video input (.mp4, .mov, .webm, .mkv); this input is not a video.',
      { input: resolvedInput });
  }
  const scene = await loadScene(resolvedInput);
  const limitations = [];

  let trackInput = scene?.tracks ?? scene?.elements ?? null;
  if (!trackInput && options.tracksPath) {
    trackInput = await readJson(path.resolve(options.tracksPath));
  }
  if (!trackInput) {
    throw new WorkflowError('TRACKS_REQUIRED',
      'This input needs Stage 2B tracks: pass a scene JSON with tracks/elements, or --tracks <tracker.json>.',
      { input: resolvedInput });
  }
  // The one-beat fallback still needs the tracked range, otherwise a video without
  // PySceneDetect would promote zero frames.
  const tracks = normalizeTracks(trackInput);
  const lastTrackFrame = Math.max(0, ...tracks.flatMap(track => track.rows.map(row => row[0])));
  const segmentation = await segmentBeats(resolvedInput, {
    threshold: options.beatThreshold,
    minBeatFrames: options.minBeatFrames,
    frameCount: options.frameCount ?? lastTrackFrame + 1,
    sceneDetector: options.sceneDetector
  });
  limitations.push(...segmentation.limitations);

  const smoothedTracks = options.smooth === true
    ? smoothTracks(trackInput, { window: options.smoothingWindow, order: options.smoothingOrder })
    : tracks;
  const vectorized = await attachVectors(scene, resolvedInput, smoothedTracks, options);
  limitations.push(...vectorized.limitations);

  const promotion = promoteTracks({ tracks: vectorized.tracks }, {
    beats: segmentation.beats,
    maxError: options.maxError ?? DEFAULT_MAX_ERROR,
    tolerance: options.presetTolerance,
    stagger: options.stagger !== false
  });
  const compiled = compilePromotion(promotion, {
    width: options.width ?? scene?.width,
    height: options.height ?? scene?.height,
    fps: options.fps ?? scene?.fps,
    endFrame: options.endFrame ?? scene?.endFrame,
    background: options.background ?? scene?.background
  });
  const baked = frameBakedArrays(compiled.script);
  if (baked !== 0) {
    limitations.push(`The emitted script contains ${baked} two-level numeric array(s); inspect before sending.`);
  }
  const tokenBudgetOk = compiled.tokenEstimate < TOKEN_BUDGET;
  if (!tokenBudgetOk) {
    limitations.push(`The compiled script is ${compiled.tokenEstimate} tokens, above the ${TOKEN_BUDGET}-token ten-layer budget.`);
  }

  // Live execution runs Stage 4 exactly once through the transport. The script
  // returns its created ids in compiled-ref order, which is the only authoritative
  // L0 -> live-id map; Stage 5 patches must never guess ids from comp order.
  let live = options.liveInfo ? { ...options.liveInfo } : null;
  let beatTargets = options.layersForBeat ?? null;
  if (!dryRun && options.client) {
    const applied = await options.client.exec(compiled.script);
    const created = Array.isArray(applied?.value) ? applied.value : null;
    const refs = Object.values(compiled.layerRefs);
    if (refs.length > 0 && (!created || created.length !== refs.length)) {
      throw new WorkflowError('LIVE_LAYER_IDS_MISSING',
        'The live _mg script did not return one layer id per compiled reference; Stage 5 cannot target its patches.',
        { expected: refs.length, returned: Array.isArray(created) ? created.length : null });
    }
    const refToLive = new Map(refs.map((ref, index) => [ref, created?.[index] ?? null]));
    live = { ...(live ?? {}), executed: true, layers: refs.length };
    const liveIdFor = layerId => {
      const ref = compiled.layerRefs[layerId];
      return ref ? refToLive.get(ref) ?? null : null;
    };
    if (!beatTargets && typeof options.layerForBeat !== 'function') {
      // Multi-layer targeting: rank every promoted layer moving inside the beat,
      // cap the batch and map each promoted id to its authoritative live id. The
      // gate partitions the beat's bbox drift across the returned targets.
      beatTargets = (beat, context = {}) => layersForBeat(beat, promotion, { ...context, maxLayersPerBeat })
        .map(target => ({ ...target, id: liveIdFor(target.layerId), ref: null }))
        .filter(target => target.id);
    }
    limitations.push(`Live Stage 5 splits each beat's bbox drift across up to ${maxLayersPerBeat} actively moving layers in one batched _mg.patch per pass, using odiff bbox overlap when layer boxes are known and displacement share otherwise; stagger followers receive relative deltas.`);
  }

  // A video input with no supplied reference frames is extracted automatically at the
  // Stage 1 beat inflection frames, so --live needs no manual frame export step.
  let referenceFrames = options.referenceFrames ?? null;
  let referenceExtraction = null;
  if (!dryRun && options.client && !referenceFrames && (options.autoReference === true || isVideoInput(resolvedInput))) {
    const extraction = await extractReferenceFrames({
      video: resolvedInput,
      beats: promotion.beats,
      outputDirectory: options.outputDirectory ? path.join(path.resolve(options.outputDirectory), 'reference-frames') : null,
      ffmpeg: options.ffmpeg
    });
    referenceFrames = extraction.map;
    referenceExtraction = {
      version: extraction.version, source: extraction.source, directory: extraction.directory,
      temporary: extraction.temporary, frames: extraction.frameCount,
      map: extraction.map, limitations: extraction.limitations
    };
    limitations.push(...extraction.limitations);
  }

  let gate = null;
  if (!dryRun) {
    if (!options.client) {
      gate = await runPerceptualGate({
        client: null, beats: promotion.beats, referenceFrames,
        outputDirectory: options.outputDirectory, threshold, maxPasses
      });
    } else {
      gate = await runPerceptualGate({
        client: options.client,
        beats: promotion.beats,
        referenceFrames,
        scene: options.gateScene === false ? null : promotion,
        outputDirectory: options.outputDirectory ? path.join(options.outputDirectory, 'perceptual') : undefined,
        threshold,
        maxPasses,
        layerForBeat: options.layerForBeat ?? null,
        layersForBeat: beatTargets,
        layerRefs: compiled.layerRefs,
        onPatch: options.onPatch ?? null
      });
      limitations.push(...(gate.limitations ?? []));
    }
  } else {
    limitations.push('Dry-run: Stages 1-4 ran in-process; no Cavalry scene was opened and no frame was rendered.');
  }

  let artifacts = null;
  if (options.outputDirectory) {
    const directory = path.resolve(options.outputDirectory);
    await fs.mkdir(directory, { recursive: true });
    const write = async (name, value) => {
      const filePath = path.join(directory, name);
      try {
        await fs.writeFile(filePath, value, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (error.code === 'EEXIST') {
          throw new WorkflowError('OUTPUT_EXISTS', 'Refusing to overwrite procedural artifacts.', { path: filePath });
        }
        throw new WorkflowError('OUTPUT_WRITE_FAILED', 'Cannot write a procedural artifact.', { path: filePath, reason: error.code });
      }
      return filePath;
    };
    const promotionPath = await write('procedural-promotion.json', `${JSON.stringify(promotion, null, 2)}\n`);
    const scriptPath = await write('procedural-script.mg.js', `${compiled.script}\n`);
    const gatePath = gate ? await write('procedural-gate.json', `${JSON.stringify(gate, null, 2)}\n`) : null;
    const reportPath = await write('procedural-report.json', `${JSON.stringify({
      version: PROCEDURAL_VERSION, input: resolvedInput, dryRun, threshold, maxPasses,
      stats: promotion.stats, vectors: vectorized.vectors,
      tokenEstimate: compiled.tokenEstimate, tokenBudget: TOKEN_BUDGET,
      frameBakedArrays: baked, live, reference: referenceExtraction,
      gate: gate?.status ?? null, limitations
    }, null, 2)}\n`);
    artifacts = { directory, promotionPath, scriptPath, gatePath, reportPath };
  }

  return {
    version: PROCEDURAL_VERSION,
    status: dryRun ? 'dry-run' : (gate?.status === 'converged' ? 'converged' : gate?.status === 'unconverged' ? 'unconverged' : 'compiled'),
    input: resolvedInput,
    beatSource: segmentation.source,
    beats: promotion.beats,
    tracks: tracks.length,
    layers: promotion.layers.length,
    groups: promotion.groups,
    vectors: vectorized.vectors,
    stats: promotion.stats,
    script: compiled.script,
    scriptBytes: compiled.bytes,
    tokenEstimate: compiled.tokenEstimate,
    tokenBudget: { limit: TOKEN_BUDGET, ok: tokenBudgetOk },
    frameBakedArrays: baked,
    layerRefs: compiled.layerRefs,
    live,
    reference: referenceExtraction,
    gate,
    artifacts,
    limitations
  };
}
