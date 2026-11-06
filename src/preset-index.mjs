/**
 * Deterministic preset index for Stage 3.
 *
 * The 120-preset catalog in cavalry-mcp is executable scene material, but its
 * full scripts are far too large to send to a model on every beat. The compact
 * manifest (id|category|motionSignature|requiredParams|defaultDuration) is the
 * only catalog representation this module needs. Matching is a pure function of
 * the manifest entry and the measured promotion request:
 *
 *   - a signature split into motion + easing tokens,
 *   - an optional hard category constraint,
 *   - duration proximity (frames), and
 *   - content parameters the clone can actually bind.
 *
 * Equal scores break by id, so two runs over the same manifest and request set
 * always select the same preset. Nothing here calls a model, renders a frame or
 * executes a preset; it produces the binding Stage 4 may carry forward.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, hashObject } from './core.mjs';

export const PRESET_INDEX_VERSION = '1.0.0';

export const PRESET_MANIFEST_FORMAT = 'id|category|motionSignature|requiredParams|defaultDuration';

/** Motion tokens the compact signatures are built from. */
export const PRESET_MOTION_TOKENS = Object.freeze([
  'build', 'count', 'dup', 'ease', 'fade', 'meter', 'pop', 'pulse', 'stagger'
]);

/** Easing tokens; the shipped catalog uses `spring` for every preset today. */
export const PRESET_EASING_TOKENS = Object.freeze(['spring', 'ease', 'linear', 'overshoot']);

/**
 * Score weights, declared once so tests and callers can reason about a rank.
 * Category is the only hard filter; the other dimensions are additive.
 */
export const PRESET_SCORE_WEIGHTS = Object.freeze({
  exactSignature: 80,
  motion: 40,
  easing: 20,
  category: 30,
  duration: 20,
  requiredParam: 5,
  missingParamPenalty: 12
});

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const refcloneRoot = path.resolve(moduleDir, '..');

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

/**
 * Candidate manifest locations for the sibling cavalry-mcp checkout.
 * Environment variables win so a separately installed server can point here.
 */
export function presetManifestCandidates() {
  return [
    process.env.REFCLONE_PRESET_MANIFEST,
    process.env.CAVALRY_MCP_PRESET_MANIFEST,
    path.resolve(refcloneRoot, '..', 'cavalry-mcp', 'dist', 'presets', 'preset_manifest.json'),
    path.resolve(refcloneRoot, 'cavalry-mcp', 'dist', 'presets', 'preset_manifest.json'),
    path.resolve(refcloneRoot, '..', 'cavalry-mcp', 'dist', 'presets', 'preset_manifest.json')
  ].filter((candidate, index, list) => Boolean(candidate) && list.indexOf(candidate) === index);
}

/** Split `pop+spring` into its two tokens without inventing a default. */
export function tokenizeSignature(signature) {
  const text = String(signature ?? '').trim().toLowerCase();
  if (!text) return { motion: null, easing: null, signature: null };
  const [motion, easing, ...rest] = text.split('+');
  if (rest.length > 0) fail('PRESET_INDEX_INVALID', `Motion signature '${signature}' has too many segments.`);
  return {
    motion: motion && PRESET_MOTION_TOKENS.includes(motion) ? motion : null,
    easing: easing && PRESET_EASING_TOKENS.includes(easing) ? easing : null,
    signature: text
  };
}

function normalizeEntry(raw, index) {
  if (!raw || typeof raw !== 'object') {
    fail('PRESET_INDEX_INVALID', `Manifest entry ${index} is not an object.`);
  }
  const id = String(raw.id ?? '').trim();
  if (!id) fail('PRESET_INDEX_INVALID', `Manifest entry ${index} has no id.`);
  const category = String(raw.category ?? '').trim();
  if (!category) fail('PRESET_INDEX_INVALID', `Manifest entry ${index} (${id}) has no category.`);
  const tokens = tokenizeSignature(raw.motionSignature);
  if (!tokens.motion || !tokens.easing) {
    fail('PRESET_INDEX_INVALID', `Manifest entry ${index} (${id}) has an unknown signature '${raw.motionSignature}'.`);
  }
  const requiredParams = Array.isArray(raw.requiredParams)
    ? raw.requiredParams.map(param => String(param).trim()).filter(Boolean)
    : [];
  const defaultDuration = finite(raw.defaultDuration);
  if (defaultDuration === null || defaultDuration <= 0) {
    fail('PRESET_INDEX_INVALID', `Manifest entry ${index} (${id}) has an invalid duration.`);
  }
  return {
    id,
    category,
    categoryCode: raw.categoryCode ? String(raw.categoryCode) : null,
    motionSignature: tokens.signature,
    motion: tokens.motion,
    easing: tokens.easing,
    requiredParams,
    defaultDuration: Math.round(defaultDuration)
  };
}

/**
 * Parse a manifest from JSON text, a compact manifest object, an array of
 * expanded entries, or an already-parsed `{ entries }` object.
 *
 * @param {string|Object|Array} source
 * @returns {Object} Parsed manifest with normalized entries
 */
export function parsePresetManifest(source) {
  if (source == null) fail('PRESET_INDEX_INVALID', 'A preset manifest source is required.');

  if (typeof source === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      fail('PRESET_INDEX_INVALID', 'Preset manifest is not valid JSON.', { cause: String(error?.message ?? error) });
    }
    return parsePresetManifest(parsed);
  }

  if (Array.isArray(source)) {
    const entries = source.map(normalizeEntry).sort((a, b) => a.id.localeCompare(b.id));
    return summarizeManifest({ entries, version: null, signatures: [...new Set(entries.map(e => e.motionSignature))].sort() });
  }

  if (Array.isArray(source.entries)) {
    const entries = source.entries.map(normalizeEntry).sort((a, b) => a.id.localeCompare(b.id));
    return summarizeManifest({
      entries,
      version: source.version ?? null,
      signatures: [...new Set(entries.map(e => e.motionSignature))].sort()
    });
  }

  if (!Array.isArray(source.presets) || !Array.isArray(source.signatures)) {
    fail('PRESET_INDEX_INVALID', 'Preset manifest must declare signatures and presets.');
  }

  const categories = source.categories && typeof source.categories === 'object' ? source.categories : {};
  const categoryCodes = new Map();
  for (const [code, full] of Object.entries(categories)) categoryCodes.set(String(full), code);

  const entries = source.presets.map((row, index) => {
    const parts = String(row).split('|');
    if (parts.length !== 5) {
      fail('PRESET_INDEX_INVALID', `Manifest row ${index} has ${parts.length} fields, expected 5.`);
    }
    const [id, code, signatureIndex, params, duration] = parts;
    const category = categories[code];
    if (!category) fail('PRESET_INDEX_INVALID', `Manifest row ${index} uses unknown category code '${code}'.`);
    const signature = source.signatures[Number(signatureIndex)];
    if (signature == null) fail('PRESET_INDEX_INVALID', `Manifest row ${index} uses unknown signature index '${signatureIndex}'.`);
    return normalizeEntry({
      id,
      category,
      categoryCode: code,
      motionSignature: signature,
      requiredParams: params ? params.split(',') : [],
      defaultDuration: Number(duration)
    }, index);
  });

  return summarizeManifest({
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : null,
    signatures: source.signatures.map(String)
  });
}

function summarizeManifest({ entries, version, signatures }) {
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.id)) fail('PRESET_INDEX_INVALID', `Duplicate preset id '${entry.id}'.`);
    byId.set(entry.id, entry);
  }
  const categories = [...new Set(entries.map(entry => entry.category))].sort();
  return {
    version: PRESET_INDEX_VERSION,
    manifestVersion: version,
    format: PRESET_MANIFEST_FORMAT,
    signatures,
    categories,
    entries,
    byId,
    size: entries.length,
    digest: hashObject(entries)
  };
}

const manifestCache = new Map();

/**
 * Load a manifest from an explicit value or discover the sibling build.
 *
 * @param {Object} [options]
 * @param {string|Object|Array} [options.manifest] - Inline manifest source.
 * @param {string} [options.manifestPath] - Explicit file path.
 * @returns {Object} Parsed manifest (throws when nothing can be read)
 */
export function loadPresetManifest(options = {}) {
  if (options.manifest != null) return parsePresetManifest(options.manifest);

  const explicit = options.manifestPath ? path.resolve(options.manifestPath) : null;
  const candidates = explicit ? [explicit] : presetManifestCandidates();

  for (const candidate of candidates) {
    let stat;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const cached = manifestCache.get(candidate);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.manifest;
    let json;
    try {
      json = fs.readFileSync(candidate, 'utf8');
    } catch (error) {
      fail('PRESET_INDEX_UNREADABLE', `Cannot read preset manifest at ${candidate}.`, { cause: String(error?.message ?? error) });
    }
    const manifest = parsePresetManifest(json);
    manifest.sourcePath = candidate;
    manifestCache.set(candidate, { mtimeMs: stat.mtimeMs, size: stat.size, manifest });
    return manifest;
  }

  fail('PRESET_MANIFEST_MISSING', 'No preset manifest found.', { candidates });
}

/** Discovery helper for optional stages: null instead of a throw when absent. */
export function tryLoadPresetManifest(options = {}) {
  try {
    return loadPresetManifest(options);
  } catch (error) {
    if (error?.code === 'PRESET_MANIFEST_MISSING') return null;
    throw error;
  }
}

export function clearPresetManifestCache() {
  manifestCache.clear();
}

/** Resolve a category given either the wire code or the full pack id. */
function resolveCategory(category, manifest) {
  if (category == null || category === '') return null;
  const text = String(category).trim();
  if (!text) return null;
  const full = manifest.entries.find(entry => entry.categoryCode === text)?.category
    ?? manifest.entries.find(entry => entry.category === text)?.category;
  if (!full) fail('PRESET_INDEX_INVALID', `Unknown preset category '${category}'.`);
  return full;
}

function normalizeParams(params, label) {
  if (params == null) return null;
  if (!Array.isArray(params)) fail('PRESET_INDEX_INVALID', `${label} must be an array of strings.`);
  return params.map(param => String(param).trim()).filter(Boolean);
}

/** Normalize a match request, resolving a category code to its full pack id. */
export function normalizePresetRequest(request, manifest) {
  if (!request || typeof request !== 'object') fail('PRESET_INDEX_INVALID', 'A preset request object is required.');
  const signature = request.signature ? tokenizeSignature(request.signature) : { motion: null, easing: null, signature: null };
  const motion = request.motion != null ? String(request.motion).trim().toLowerCase() : signature.motion;
  const easing = request.easing != null ? String(request.easing).trim().toLowerCase() : signature.easing;
  if (motion && !PRESET_MOTION_TOKENS.includes(motion)) {
    fail('PRESET_INDEX_INVALID', `Unknown motion token '${motion}'.`);
  }
  if (easing && !PRESET_EASING_TOKENS.includes(easing)) {
    fail('PRESET_INDEX_INVALID', `Unknown easing token '${easing}'.`);
  }
  const duration = finite(request.durationFrames);
  if (request.durationFrames != null && (duration === null || duration <= 0)) {
    fail('PRESET_INDEX_INVALID', 'durationFrames must be a positive number.');
  }
  return {
    signature: signature.signature ?? (motion && easing ? `${motion}+${easing}` : null),
    motion: motion || null,
    easing: easing || null,
    category: resolveCategory(request.category, manifest),
    durationFrames: duration,
    params: normalizeParams(request.params, 'params'),
    strictParams: request.strictParams === true
  };
}

/**
 * Score one manifest entry against a normalized request.
 *
 * @returns {{rejected: boolean, score: number, reasons: string[],
 *   missingParams: string[], durationDelta: number|null}}
 */
export function scorePresetMatch(entry, request) {
  const reasons = [];
  let score = 0;

  if (request.category && entry.category !== request.category) {
    return { rejected: true, score: 0, reasons: ['category_mismatch'], missingParams: [], durationDelta: null };
  }
  if (request.category) {
    score += PRESET_SCORE_WEIGHTS.category;
    reasons.push('category');
  }

  const missingParams = request.params
    ? entry.requiredParams.filter(param => !request.params.includes(param))
    : [];
  if (request.strictParams && missingParams.length > 0) {
    return { rejected: true, score: 0, reasons: ['missing_required_params'], missingParams, durationDelta: null };
  }

  if (request.signature && entry.motionSignature === request.signature) {
    score += PRESET_SCORE_WEIGHTS.exactSignature;
    reasons.push('exact_signature');
  }
  if (request.motion && entry.motion === request.motion) {
    score += PRESET_SCORE_WEIGHTS.motion;
    reasons.push('motion');
  }
  if (request.easing && entry.easing === request.easing) {
    score += PRESET_SCORE_WEIGHTS.easing;
    reasons.push('easing');
  }

  let durationDelta = null;
  if (request.durationFrames) {
    durationDelta = Math.abs(entry.defaultDuration - request.durationFrames);
    const normalizer = Math.max(entry.defaultDuration, request.durationFrames, 1);
    score += PRESET_SCORE_WEIGHTS.duration * Math.max(0, 1 - durationDelta / normalizer);
    reasons.push('duration');
  }

  if (request.params) {
    const covered = entry.requiredParams.length - missingParams.length;
    score += covered * PRESET_SCORE_WEIGHTS.requiredParam;
    score -= missingParams.length * PRESET_SCORE_WEIGHTS.missingParamPenalty;
    if (entry.requiredParams.length === 0) reasons.push('no_params_required');
    if (missingParams.length > 0) reasons.push('missing_params');
    else if (entry.requiredParams.length > 0) reasons.push('params');
  }

  return {
    rejected: false,
    score: Math.round(score * 1e6) / 1e6,
    reasons,
    missingParams,
    durationDelta
  };
}

/**
 * Rank every entry for a request. Deterministic: score desc, then id asc.
 * `limit` truncates the ranked list; it never changes the winner.
 */
export function matchPresets(request, options = {}) {
  const manifest = options.manifest?.entries ? options.manifest : loadPresetManifest(options);
  const normalized = normalizePresetRequest(request, manifest);
  const analyzed = [];
  for (const entry of manifest.entries) {
    const scored = scorePresetMatch(entry, normalized);
    if (scored.rejected) continue;
    analyzed.push({
      entry,
      preset: {
        id: entry.id,
        category: entry.category,
        categoryCode: entry.categoryCode,
        motionSignature: entry.motionSignature,
        requiredParams: entry.requiredParams,
        defaultDuration: entry.defaultDuration
      },
      score: scored.score,
      reasons: scored.reasons,
      missingParams: scored.missingParams,
      durationDelta: scored.durationDelta
    });
  }
  analyzed.sort((a, b) => b.score - a.score
    || (a.durationDelta ?? Infinity) - (b.durationDelta ?? Infinity)
    || a.preset.id.localeCompare(b.preset.id));
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  return {
    request: normalized,
    manifest: { size: manifest.size, digest: manifest.digest, sourcePath: manifest.sourcePath ?? null },
    ranked: limit ? analyzed.slice(0, limit) : analyzed
  };
}

/** Convenience: the ranked winner, or null when the category filter empties the set. */
export function matchPreset(request, options = {}) {
  const result = matchPresets(request, options);
  return result.ranked.length > 0 ? result.ranked[0] : null;
}

/**
 * Turn a Stage 3 promotion into a preset request.
 *
 * Keyframes/static/none promotions have no procedural motion to bind and return
 * null rather than a fabricated match. Easing inference only reads values the
 * promotion actually carries; a weighted Bézier without y1/y2 gets the token
 * `ease`, and the matcher reports that the easing did not match if the closest
 * preset uses `spring`.
 */
export function presetRequestForPromotion(promotion, context = {}) {
  if (!promotion || typeof promotion !== 'object') return null;
  if (!['cubic_bezier', 'damped_spring'].includes(promotion.promotion)) return null;

  let motion = context.motion != null ? String(context.motion) : null;
  let easing = context.easing != null ? String(context.easing) : null;
  if (context.signature) {
    const tokens = tokenizeSignature(context.signature);
    motion = tokens.motion;
    easing = tokens.easing;
  }

  if (!motion) {
    if (context.duplicator === true) motion = context.stagger === true ? 'stagger' : 'dup';
    else if (promotion.promotion === 'damped_spring') motion = 'pop';
    else if (promotion.property === 'opacity') motion = 'fade';
    else if (promotion.promotion === 'cubic_bezier') motion = 'ease';
  }
  if (!easing) {
    if (promotion.promotion === 'damped_spring') easing = 'spring';
    else {
      const y1 = finite(promotion.parameters?.y1);
      const y2 = finite(promotion.parameters?.y2);
      if (y1 !== null && y2 !== null) {
        if (y1 > 1.001 || y2 > 1.001) easing = 'overshoot';
        else if (Math.abs(y1 - y2) < 0.05 && Math.abs(y1 - 0.5) < 0.05) easing = 'linear';
        else easing = 'ease';
      } else {
        easing = 'ease';
      }
    }
  }
  if (!motion || !easing) return null;

  const start = finite(promotion.parameters?.startFrame);
  const end = finite(promotion.parameters?.endFrame);
  const durationFrames = finite(context.durationFrames)
    ?? (start !== null && end !== null ? Math.max(1, Math.round(end - start + 1)) : null);

  return {
    motion,
    easing,
    signature: `${motion}+${easing}`,
    category: context.category ?? null,
    durationFrames,
    params: context.params,
    strictParams: context.strictParams === true
  };
}

/**
 * Match every promotion in a Stage 3 artifact and return a standalone report.
 *
 * The report is deliberately outside the promotion artifact: the artifact is
 * validated with `additionalProperties: false`, and preset bindings are
 * advisory Stage 3 evidence, not a schema field.
 *
 * @param {Object} analysis - analyzeScenePromotion output
 * @param {Object} options - manifest source plus category/params/strictParams/top
 * @returns {Object} Preset match report
 */
export function matchPromotionPresets(analysis, options = {}) {
  if (!analysis || !Array.isArray(analysis.elements)) {
    fail('PRESET_INDEX_INVALID', 'A promotion analysis with elements is required.');
  }
  const manifest = options.manifest?.entries ? options.manifest : loadPresetManifest(options);
  const context = {
    category: options.category,
    params: options.params,
    strictParams: options.strictParams
  };

  const elements = analysis.elements.map(element => {
    const matches = [];
    for (const promotion of element.promotions ?? []) {
      const request = presetRequestForPromotion(promotion, context);
      if (!request) continue;
      const best = matchPreset(request, { manifest, limit: 1 });
      matches.push({
        elementId: element.elementId,
        property: promotion.property,
        promotion: promotion.promotion,
        request,
        preset: best?.preset ?? null,
        score: best?.score ?? 0,
        reasons: best?.reasons ?? [],
        missingParams: best?.missingParams ?? [],
        unmatchedReason: best ? null : 'no_catalog_entry'
      });
    }
    return { elementId: element.elementId, matches };
  });

  const duplicatorGroups = (analysis.duplicatorGroups ?? []).map(group => {
    const request = presetRequestForPromotion(
      { promotion: 'damped_spring', property: 'duplicator' },
      {
        ...context,
        motion: group.stagger === true ? 'stagger' : 'dup',
        easing: options.easing ?? 'spring',
        durationFrames: group.durationFrames ?? group.lagFrames
      }
    );
    const best = request ? matchPreset(request, { manifest, limit: 1 }) : null;
    return {
      elementIds: group.elementIds ?? [],
      baseElementId: group.baseElementId ?? null,
      preset: best?.preset ?? null,
      score: best?.score ?? 0,
      reasons: best?.reasons ?? [],
      unmatchedReason: best ? null : 'no_catalog_entry'
    };
  });

  const allMatches = [...elements.flatMap(element => element.matches), ...duplicatorGroups];
  const matched = allMatches.filter(entry => entry.preset);
  const byPreset = {};
  for (const entry of matched) byPreset[entry.preset.id] = (byPreset[entry.preset.id] ?? 0) + 1;

  return {
    version: PRESET_INDEX_VERSION,
    manifest: {
      version: manifest.manifestVersion,
      size: manifest.size,
      digest: manifest.digest,
      sourcePath: manifest.sourcePath ?? null
    },
    elements,
    duplicatorGroups,
    summary: {
      evaluated: allMatches.length,
      matched: matched.length,
      unmatched: allMatches.length - matched.length,
      byPreset
    }
  };
}

/** Optional-stage variant: null when no manifest is discoverable. */
export function matchPromotionPresetsIfAvailable(analysis, options = {}) {
  const manifest = options.manifest?.entries ? options.manifest : tryLoadPresetManifest(options);
  if (!manifest) return null;
  return matchPromotionPresets(analysis, { ...options, manifest });
}
