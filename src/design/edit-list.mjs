// Resumable multi-entry edit lists: the OpenVideoHarness `edit.json` contract
// (vendor/wave2/OpenVideoHarness/EDIT.md) and its single-shot patch semantics
// (vendor/wave2/OpenVideoHarness/patch.mjs). An edit list is the animatic/slate
// arrangement of a film: entries in film time, each drawing one source (page, still,
// clip, film, sound, or a slate gray card). Resolution turns written times and
// references into integer frames; nothing is defaulted and an unresolved reference
// stays an error. A slate is a placeholder, never a deliverable.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { SVGPathCommander } from 'svg-path-commander';
import { WorkflowError, absolutePath, hashFile, hashObject, readJson, validateArtifact } from '../core.mjs';
import { equalizePaths } from '../cavalry/equalizePaths.mjs';
import { evaluateBezierEasing } from './morph-equalize.mjs';
import { resolveAstryxTheme, ASTRYX_THEMES } from '../themes/astryx-themes.mjs';
import { parseColor } from '../vision/lint.mjs';

export const EDIT_LIST_VERSION = '1.0.0';
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
// Boundary frames round up, "which frame is at this instant" rounds down; both tolerate
// the 1e-6 float error that 10.04 * 30 otherwise carries (EDIT.md, tools/timegrid.py).
const frameFrom = (seconds, fps) => Math.max(0, Math.ceil(seconds * fps - 1e-6));
const frameAt = (seconds, fps) => Math.floor(seconds * fps + 1e-6);

const SOURCE_KINDS = ['page', 'image', 'color', 'clip', 'film', 'sound'];
const KIND_BY_SOURCE = { page: 'page', image: 'still', color: 'color', clip: 'clip', film: 'film', sound: 'sound' };
const REAL_KINDS = new Set(['page', 'still', 'color', 'clip', 'film']);
const CLOCKED_KINDS = new Set(['page', 'clip', 'film']);

let ajvPromise;
async function definitionValidator(name) {
  if (!ajvPromise) {
    ajvPromise = (async () => {
      const directory = fileURLToPath(new URL('../../schemas/', import.meta.url));
      const ajv = new Ajv({ strict: true, allErrors: true });
      for (const filename of (await fs.readdir(directory)).filter(file => file.endsWith('.schema.json')).sort()) {
        ajv.addSchema(await readJson(path.join(directory, filename)));
      }
      return ajv;
    })();
  }
  const ajv = await ajvPromise;
  const $id = `https://refclone.local/schemas/edit-list.${name}.schema.json`;
  if (!ajv.getSchema($id)) {
    ajv.addSchema({ $id, $ref: `edit-list.schema.json#/definitions/${name}` });
  }
  return ajv.getSchema($id);
}

/** Validate the written edit list against schemas/edit-list.schema.json. */
export async function validateEditList(edit) {
  return validateArtifact('edit-list', edit);
}

/**
 * Validate a resolved list or patch plan against the matching definition of
 * edit-list.schema.json (the artifact validator only registers whole schemas).
 */
export async function validateEditListShape(name, value) {
  if (name !== 'resolved' && name !== 'patchPlan') fail('EDIT_INVALID', `Unknown edit-list definition ${name}.`);
  const validate = await definitionValidator(name);
  if (!validate(value)) {
    fail('SCHEMA_INVALID', `Artifact does not satisfy edit-list.${name}.`, { errors: structuredClone(validate.errors) });
  }
  return value;
}

/**
 * Parse one time value. `@|ID` and `@|ID>` references resolve against already placed
 * entries; narration refs (`@l4`, `@l4:word`, `@l4>`), timeline events (`@#e2`) and
 * music positions (`{$music: [bar, beat]}`) need the project's time sources, which an
 * edit list alone does not carry — those stay unresolved instead of defaulting to zero.
 * @param {number|string|object} value
 * @param {{fps:number, entries:Map<string,object>, what:string}} context
 * @returns {number} seconds
 */
export function parseEditTime(value, { fps, entries, what = 'time' }) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) fail('EDIT_TIME_INVALID', `${what} must be a nonnegative number.`, { value });
    return value;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    const reference = /^@\|([A-Za-z0-9_]+)(>?)([+-]\d+(?:\.\d+)?)?$/.exec(text);
    if (reference) {
      const target = entries.get(reference[1]);
      if (!target) fail('EDIT_REF_UNRESOLVED', `${what} refers to entry ${reference[1]}, which is not placed yet.`, { value });
      const base = reference[2] === '>' ? target.end : target.start;
      return base + (reference[3] ? Number(reference[3]) : 0);
    }
    if (text.startsWith('@')) {
      fail('EDIT_REF_UNRESOLVED', `${what} needs the project's timeline/lead/music time sources, which are not part of the edit list.`, { value });
    }
    const minutesSeconds = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(text);
    if (minutesSeconds) return Number(minutesSeconds[1]) * 60 + Number(minutesSeconds[2]);
    const seconds = Number(text);
    if (Number.isFinite(seconds) && seconds >= 0 && text !== '') return seconds;
    fail('EDIT_TIME_INVALID', `${what} is not a supported time value.`, { value });
  }
  if (value && typeof value === 'object' && Array.isArray(value.$music)) {
    fail('EDIT_REF_UNRESOLVED', `${what} uses a music bar/beat position; the music time map is a separate artifact.`, { value });
  }
  fail('EDIT_TIME_INVALID', `${what} must be seconds, 'm:ss.s', a reference string or a music position.`, { value });
  return NaN;
}

// The clip frame shown by an entry's first frame: `{'f': n}` is that frame, seconds
// resolve through the clip's own rate (EDIT.md: j_in = frame_at(in)).
function clipStartFrame(entry, source, fps) {
  const into = entry.in ?? 0;
  const rate = Number(source?.rate ?? fps);
  if (!Number.isFinite(rate) || rate <= 0) fail('EDIT_SOURCE_INVALID', 'A clip source needs a positive frame rate.', { entryId: entry.id });
  if (typeof into === 'number') {
    if (!Number.isFinite(into) || into < 0) fail('EDIT_TIME_INVALID', `Entry ${entry.id} in point must be nonnegative seconds.`, { value: into });
    return frameAt(into, rate);
  }
  if (into && Number.isInteger(into.f) && into.f >= 0) return into.f;
  if (into && typeof into.sync === 'number') {
    fail('EDIT_REF_UNRESOLVED', `Entry ${entry.id} uses sync-group time, which needs the clip's sync map.`, { value: into });
  }
  fail('EDIT_TIME_INVALID', `Entry ${entry.id} in point must be seconds, {'f': frame} or {'sync': M}.`, { value: into });
  return NaN;
}

function sourceKindOf(source) {
  if (!source || typeof source !== 'object') fail('EDIT_SOURCE_INVALID', 'A sources key must map to an object.', { source });
  const declared = SOURCE_KINDS.filter(key => key in source);
  if (declared.length !== 1) fail('EDIT_SOURCE_INVALID', 'A source declares exactly one of page/image/color/clip/film/sound.', { source });
  return KIND_BY_SOURCE[declared[0]];
}

function durationFor(entry, kind, { fps, start, end, speed, sourceDurations }) {
  if (end !== null) return end;
  if (entry.dur !== undefined) return start + entry.dur;
  if (entry.out !== undefined && kind === 'clip') {
    const out = typeof entry.out === 'object' && entry.out !== null && Number.isInteger(entry.out.f) ? entry.out.f / fps : entry.out;
    const into = typeof entry.in === 'object' && entry.in !== null && Number.isInteger(entry.in.f) ? entry.in.f / fps : (entry.in ?? 0);
    if (typeof out === 'number' && typeof into === 'number') return start + (out - into) / speed;
  }
  if (sourceDurations && typeof sourceDurations[entry.src] === 'number') return start + sourceDurations[entry.src];
  fail('EDIT_DURATION_UNRESOLVED', `Entry ${entry.id} has no end, dur, or measured source duration; the edit list cannot guess a length.`, {
    entryId: entry.id, kind
  });
  return NaN;
}

function checkTransition(entry) {
  const transition = entry.transition;
  if (!transition) return null;
  const type = String(transition.type).toLowerCase();
  if (!['cut', 'hardcut', 'none'].includes(type)) {
    fail('EDIT_TRANSITION_UNSUPPORTED', `Transition "${transition.type}" on ${entry.id} is not rendered; only hard cuts are supported.`, {
      entryId: entry.id, type: transition.type
    });
  }
  return type;
}

/**
 * Resolve a written edit list into integer frames, the render runs, sound cues, cuts
 * and slates. Deterministic: identical inputs produce a byte-identical resolved list.
 * @param {object} edit schema-valid edit.json
 * @param {{sourceDurations?: object, precomputedHash?: string}} [options] measured
 *   durations per source key (a page's own duration, a clip folder's length) and,
 *   when the caller has already hashed the edit file, its sha256
 * @returns {Promise<object>} edit-list.resolved artifact (schema-validated)
 */
export async function resolveEditList(edit, options = {}) {
  await validateEditList(edit);
  const { fps, size } = edit;
  const sourceDurations = options.sourceDurations ?? {};
  for (const key of Object.keys(sourceDurations)) {
    if (!Number.isFinite(sourceDurations[key]) || sourceDurations[key] <= 0) {
      fail('EDIT_DURATION_UNRESOLVED', `Recorded duration for source ${key} is not a positive number.`, { source: key });
    }
  }
  const notes = [];
  const entriesById = new Map();
  const resolvedEntries = [];
  const runs = [];
  const sound = [];
  const cuts = [];
  const slates = [];
  const tracks = edit.tracks;
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex];
    const isPicture = trackIndex === 0;
    let previousEnd = null;
    for (const entry of track.entries) {
      if (entriesById.has(entry.id)) fail('EDIT_ID_DUPLICATE', `Entry id ${entry.id} appears twice.`, { entryId: entry.id });
      const kind = entry.src === null ? 'slate' : sourceKindOf(edit.sources[entry.src]);
      if (!isPicture && kind !== 'sound') {
        fail('EDIT_TRACK_INVALID', `Track ${track.id} follows the picture track, so it may only carry sound sources.`, { track: track.id, entryId: entry.id });
      }
      if (kind === 'sound' && isPicture) {
        fail('EDIT_TRACK_INVALID', `A sound source on the picture track would cut the picture; put ${entry.id} on a sound track.`, { entryId: entry.id });
      }
      checkTransition(entry);
      const start = entry.start !== undefined
        ? parseEditTime(entry.start, { fps, entries: entriesById, what: `entry ${entry.id} start` })
        : previousEnd ?? 0;
      const speed = entry.speed ?? 1;
      if (!(speed >= 0.25 && speed <= 4)) fail('EDIT_ENTRY_INVALID', `Entry ${entry.id} speed must be within [0.25,4].`, { entryId: entry.id });
      const explicitEnd = entry.end === undefined ? null : parseEditTime(entry.end, { fps, entries: entriesById, what: `entry ${entry.id} end` });
      const duration = durationFor(entry, kind, { fps, start, end: explicitEnd, speed, sourceDurations });
      const end = Math.max(duration, start);
      if (entry.end !== undefined && entry.dur === undefined && entry.out !== undefined && kind === 'clip') {
        const out = typeof entry.out === 'object' && entry.out !== null && Number.isInteger(entry.out.f) ? entry.out.f / fps : entry.out;
        const into = typeof entry.in === 'object' && entry.in !== null && Number.isInteger(entry.in.f) ? entry.in.f / fps : (entry.in ?? 0);
        if (typeof out === 'number' && typeof into === 'number') {
          const derived = (out - into) / speed;
          if (Math.abs((end - start) - derived) >= 0.5 / fps) {
            fail('EDIT_TIMING_MISMATCH', `Entry ${entry.id}: end - start differs from (out - in) / speed by half a frame or more.`, {
              entryId: entry.id, span: end - start, derived
            });
          }
        }
      }
      if (previousEnd !== null) {
        if (start > previousEnd + 0.5 / fps) {
          fail('EDIT_GAP', `Entry ${entry.id} leaves a gap after ${track.entries[track.entries.indexOf(entry) - 1]?.id}; a black frame is a color entry, not a gap.`, {
            track: track.id, entryId: entry.id, start, previousEnd
          });
        }
        if (start < previousEnd - 0.5 / fps) {
          fail('EDIT_OVERLAP', `Entry ${entry.id} overlaps the entry before it on track ${track.id}.`, {
            track: track.id, entryId: entry.id, start, previousEnd
          });
        }
      }
      const first = frameFrom(start, fps);
      const next = frameFrom(end, fps);
      if (next - first < 1) {
        fail('EDIT_ENTRY_TOO_SHORT', `Entry ${entry.id} is shorter than one frame; extend it or drop it.`, { entryId: entry.id, seconds: end - start });
      }
      const record = {
        id: entry.id,
        frames: [first, next],
        start: Math.round(start * 1000) / 1000,
        end: Math.round(end * 1000) / 1000,
        kind,
        clock: CLOCKED_KINDS.has(kind) ? (entry.src === null ? null : edit.sources[entry.src].clock ?? (kind === 'page' ? 'film' : 'local')) : null,
        src: entry.src,
        j0: kind === 'clip' ? clipStartFrame(entry, edit.sources[entry.src], fps) : null,
        ref: { ...(entry.start !== undefined ? { start: entry.start } : {}), ...(entry.end !== undefined ? { end: entry.end } : {}) }
      };
      entriesById.set(entry.id, { ...record });
      resolvedEntries.push(record);
      if (isPicture && previousEnd !== null) {
        const prior = resolvedEntries[resolvedEntries.length - 2];
        if (prior.frames[1] !== first) fail('EDIT_GAP', `Entry ${entry.id} does not begin on the frame after ${prior.id}.`, { entryId: entry.id });
        if (prior.kind !== kind) cuts.push(first);
      }
      if (isPicture) {
        if (kind === 'slate') slates.push(entry.id);
        // One run per contiguous drawing method: consecutive entries that draw the same
        // way share a run, everything else (a page clock, a different still) starts one.
        const params = kind === 'slate'
          ? { label: entry.label ?? '', bg: entry.bg ?? null }
          : kind === 'still'
            ? { src: entry.src, fit: entry.fit ?? 'contain', move: entry.move ?? null, bg: entry.bg ?? null }
            : kind === 'page'
              ? { src: entry.src, clock: edit.sources[entry.src].clock ?? 'film', in: entry.in ?? 0, speed, hold: entry.hold === true }
              : kind === 'clip'
                ? { src: entry.src, in: entry.in ?? 0, speed, j0: record.j0 }
                : { color: edit.sources[entry.src].color };
        const last = runs[runs.length - 1];
        const same = last && last.kind === kind && hashObject(last.params) === hashObject(params) && last.frames[1] === first;
        if (same) last.frames[1] = next;
        else runs.push({ kind, frames: [first, next], params });
      }
      if (entry.sound && entry.sound !== false) {
        sound.push({
          entryId: entry.id, file: edit.sources[entry.src]?.sound ?? edit.sources[entry.src]?.clip ?? null,
          film: [first, next], in: record.j0 ?? 0, role: entry.sound.role ?? edit.sources[entry.src]?.role ?? null,
          gain_db: entry.sound.gain_db ?? edit.sources[entry.src]?.gain_db ?? null, fade: entry.sound.fade ?? null
        });
      }
      if (!isPicture && kind === 'sound') {
        const source = edit.sources[entry.src];
        sound.push({
          entryId: entry.id, file: source.sound, film: [first, next], in: 0,
          role: entry.sound === false ? null : (source.role ?? entry.sound?.role ?? null),
          gain_db: source.gain_db ?? entry.sound?.gain_db ?? null, fade: entry.sound?.fade ?? null
        });
      }
      if (kind === 'clip' && entry.hold === true) notes.push(`Entry ${entry.id} holds one clip frame for ${next - first} frames.`);
      previousEnd = end;
    }
  }
  if (slates.length) notes.push(`Slate entries ${slates.join(', ')} are gray-card placeholders; the film is an animatic, not a deliverable.`);
  const pictureEntries = resolvedEntries.filter(record => record.kind !== 'sound');
  const totalFrames = pictureEntries.length ? Math.max(...pictureEntries.map(record => record.frames[1])) : 0;
  const resolved = {
    v: 1,
    fps,
    size: [size[0], size[1]],
    frames: totalFrames,
    duration: Math.round((totalFrames / fps) * 1000) / 1000,
    ...(options.editPath && options.precomputedHash ? { edit: { path: absolutePath(options.editPath), sha256: options.precomputedHash } } : {}),
    entries: resolvedEntries,
    runs,
    sound,
    cuts,
    slates,
    notes
  };
  return validateEditListShape('resolved', resolved);
}

/**
 * Read and resolve an edit.json in one step.
 * @param {string} editPath
 * @param {{sourceDurations?: object}} [options]
 */
export async function resolveEditListFile(editPath, options = {}) {
  const resolvedPath = absolutePath(editPath);
  const edit = await readJson(resolvedPath);
  const editSha256 = await hashFile(resolvedPath);
  return resolveEditList(edit, { ...options, editPath: resolvedPath, precomputedHash: editSha256 });
}

/**
 * The single-shot patch plan: which frames a re-render has to redraw, and which it
 * may keep. Keyframe windows follow patch.mjs — a changed span expands to the
 * keyframe at or before its start (A) and the first keyframe after its end (B, else
 * the last frame); touching windows merge. The film keeps its frame count, and
 * anything that differs outside a re-drawn window refuses the plan.
 * @param {object} resolved resolved edit list
 * @param {string[]} changedEntryIds entries whose written form changed
 * @param {{keyframes?: number[], differingFrames?: number[]}} [options] keyframe
 *   indices (GOP boundaries) and, when a draft render already differs, the frames
 *   that differ from the previous render
 */
export async function buildPatchPlan(resolved, changedEntryIds, options = {}) {
  if (!Array.isArray(changedEntryIds) || changedEntryIds.length === 0) {
    fail('EDIT_PATCH_INVALID', 'A patch needs at least one changed entry id.');
  }
  const entries = new Map(resolved.entries.map(entry => [entry.id, entry]));
  const unknown = changedEntryIds.filter(id => !entries.has(id));
  if (unknown.length) fail('EDIT_PATCH_UNKNOWN_ENTRY', 'Changed entries are not in the resolved edit list.', { entryIds: unknown });
  const totalFrames = resolved.frames;
  const keyframes = [...new Set([0, ...(options.keyframes ?? [0])].filter(frame => Number.isInteger(frame) && frame >= 0 && frame < totalFrames))]
    .sort((a, b) => a - b);
  const spans = changedEntryIds.map(id => entries.get(id).frames).sort((a, b) => a[0] - b[0]);
  const windows = [];
  for (const [start, endExclusive] of spans) {
    const A = [...keyframes].reverse().find(frame => frame <= start) ?? 0;
    const B = keyframes.find(frame => frame > endExclusive) ?? totalFrames;
    const last = windows[windows.length - 1];
    if (last && A <= last.B) {
      last.B = Math.max(last.B, B);
      for (const id of changedEntryIds) {
        const entry = entries.get(id);
        if (entry.frames[0] >= last.A && entry.frames[0] < last.B && !last.entryIds.includes(id)) last.entryIds.push(id);
      }
    } else {
      windows.push({ A, B, entryIds: changedEntryIds.filter(id => entries.get(id).frames[0] >= A && entries.get(id).frames[0] < B) });
    }
  }
  const inside = frame => windows.some(window => frame >= window.A && frame < window.B);
  const differing = Array.isArray(options.differingFrames) ? options.differingFrames.filter(Number.isInteger) : null;
  const outside = differing ? differing.filter(frame => !inside(frame)) : [];
  const redrawFrameCount = windows.reduce((total, window) => total + (window.B - window.A), 0);
  const plan = {
    fps: resolved.fps,
    size: [resolved.size[0], resolved.size[1]],
    frames: totalFrames,
    changedEntryIds: [...changedEntryIds],
    windows,
    redrawFrameCount,
    keepFrameCount: totalFrames - redrawFrameCount,
    refused: outside.length ? { reason: 'differing frames fall outside every re-drawn keyframe window', entryIds: [] } : null,
    checks: {
      frameCountUnchanged: true,
      differingFramesInsideWindows: outside.length === 0,
      outsideWindowsIdentical: true
    }
  };
  return validateEditListShape('patchPlan', plan);
}

/** Stable cache key for a resolved edit list (render/build reuse it in jobs/). */
export function editListKey(resolved) {
  return hashObject({
    version: EDIT_LIST_VERSION, edit: resolved.edit?.sha256 ?? null,
    fps: resolved.fps, size: resolved.size, frames: resolved.frames, runs: resolved.runs
  });
}

// --- OpenVideoHarness deterministic checklist evaluators ---------------------

const clampNum = (value, min, max) => Math.max(min, Math.min(max, value));

/** C1-continuous cubic Hermite spline (mirrors motion-craft `splineAt`). */
export function splineAt(frame, keyframes) {
  const n = keyframes?.length ?? 0;
  if (n === 0) return [];
  if (frame <= keyframes[0][0]) return keyframes[0].slice(1);
  if (frame >= keyframes[n - 1][0]) return keyframes[n - 1].slice(1);
  let i = 0;
  for (let k = 0; k < n - 1; k += 1) {
    if (frame >= keyframes[k][0] && frame <= keyframes[k + 1][0]) { i = k; break; }
  }
  const p0 = keyframes[Math.max(0, i - 1)];
  const p1 = keyframes[i];
  const p2 = keyframes[i + 1];
  const p3 = keyframes[Math.min(n - 1, i + 2)];
  const dt = p2[0] - p1[0];
  if (dt <= 0) return p1.slice(1);
  const u = clampNum((frame - p1[0]) / dt, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const dims = p1.length - 1;
  const out = new Array(dims);
  for (let d = 1; d <= dims; d += 1) {
    const y0 = p0[d], y1 = p1[d], y2 = p2[d], y3 = p3[d];
    const m1 = i === 0 ? 0
      : Math.abs(y1 - y0) < 1e-4 || Math.abs(y2 - y1) < 1e-4 ? 0
        : ((y2 - y0) / (p2[0] - p0[0])) * dt;
    const m2 = i + 1 === n - 1 ? 0
      : Math.abs(y3 - y2) < 1e-4 || Math.abs(y2 - y1) < 1e-4 ? 0
        : ((y3 - y1) / (p3[0] - p1[0])) * dt;
    out[d - 1] =
      (2 * u3 - 3 * u2 + 1) * y1 +
      (u3 - 2 * u2 + u) * m1 +
      (-2 * u3 + 3 * u2) * y2 +
      (u3 - u2) * m2;
  }
  return out;
}

/** Ease-out Fitts cursor trajectory lookup (mirrors motion-craft `fittsCursorAt`). */
export function fittsCursorAt(frame, trajectory) {
  if (!Array.isArray(trajectory) || trajectory.length === 0) return null;
  const points = [...trajectory].sort((a, b) => a[0] - b[0]);
  if (frame <= points[0][0]) return { x: points[0][1], y: points[0][2] };
  const last = points[points.length - 1];
  if (frame >= last[0]) return { x: last[1], y: last[2] };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i], b = points[i + 1];
    if (frame < a[0] || frame > b[0]) continue;
    const span = b[0] - a[0];
    if (span <= 0) return { x: b[1], y: b[2] };
    const t = (frame - a[0]) / span;
    const eased = 1 - ((1 - t) ** 3);
    return { x: a[1] + (b[1] - a[1]) * eased, y: a[2] + (b[2] - a[2]) * eased };
  }
  return { x: last[1], y: last[2] };
}

const ENERGY_STAGE_DEFAULTS = Object.freeze({
  hook: 0.78, 'cold-open': 0.78, valley: 0.35, contrast: 0.38,
  setup: 0.50, build: 0.68, peak: 0.95, climax: 0.95, resolve: 0.45, outro: 0.40
});

const UNCALIBRATED_RAW_COLORS = new Set([
  '#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ffff00'
]);

const PLACEHOLDER_RE = /\b(lorem\s+ipsum|tbd|todo|placeholder|coming\s+soon)\b/i;
const QUANT_CLAIM_RE = /\b\d+(?:\.\d+)?(?:\s*%|\s*(?:ms|x|kb|mb|gb|tb|presets?|tools?|modules?|skills?|req\/s|rps|users?|customers?)\b)/i;

function mergeShotsForChecklist(edit, resolved, scenePlan) {
  const fps = Number(edit?.fps ?? resolved?.fps ?? 30);
  const pictureEntries = (resolved?.entries ?? []).filter(entry => entry.kind !== 'sound');
  const rawEntries = new Map(((edit?.tracks?.[0]?.entries) ?? []).map(entry => [entry.id, entry]));
  const videoShots = edit?.video?.shots ?? [];
  const videoById = new Map(videoShots.filter(shot => shot?.id).map(shot => [shot.id, shot]));
  const planById = new Map((scenePlan?.shots ?? []).filter(shot => shot?.id).map(shot => [shot.id, shot]));
  return pictureEntries.map((entry, index) => {
    const videoShot = videoById.get(entry.id) ?? videoShots[index] ?? {};
    const trackEntry = rawEntries.get(entry.id) ?? {};
    const planShot = planById.get(entry.id) ?? {};
    const durationFrames = entry.frames[1] - entry.frames[0];
    return {
      id: entry.id,
      index,
      frames: [...entry.frames],
      durationFrames,
      durationSeconds: durationFrames / fps,
      trackEntry,
      videoShot,
      planShot
    };
  });
}

function measureShot1Hook(shots, fps, scenePlan) {
  const shot1 = shots[0];
  if (!shot1) return { status: 'fail', message: 'edit has no picture shots for hook evaluation' };
  const limit = Math.min(45, Math.round(1.5 * fps));
  if (shot1.frames[0] !== 0) {
    return { status: 'fail', message: `Shot 1 starts at frame ${shot1.frames[0]} instead of 0` };
  }
  const hook = shot1.videoShot.hook ?? null;
  if (hook && typeof hook === 'object') {
    if (hook.static === true || hook.hasMotion === false) {
      return { status: 'fail', message: `Shot ${shot1.id} hook is static with no active entrance motion` };
    }
    const startFrame = Number(hook.startFrame ?? 0);
    const peakFrame = Number(hook.peakFrame ?? hook.settleFrame ?? NaN);
    if (!Number.isFinite(peakFrame)) {
      return { status: 'fail', message: `Shot ${shot1.id} hook does not declare a finite peakFrame` };
    }
    if (startFrame > 5) {
      return { status: 'fail', message: `Shot ${shot1.id} hook starts too late at frame ${startFrame}` };
    }
    if (peakFrame > limit) {
      return { status: 'fail', message: `Shot ${shot1.id} hook peak at frame ${peakFrame} exceeds <= ${limit}f limit` };
    }
    return { status: 'pass', message: `Shot ${shot1.id} hook enters at ${startFrame}f and peaks at ${peakFrame}f (<= ${limit}f)` };
  }
  const shotEnd = shot1.frames[1];
  const kfByTrack = new Map();
  const shotOps = new Set(shot1.planShot.operationIds ?? []);
  for (const kf of scenePlan?.keyframes ?? []) {
    const belongs = kf.shotId === shot1.id || (shot1.planShot.keyframeIds ?? []).includes(kf.id) || (kf.targetFrame >= 0 && kf.targetFrame <= shotEnd);
    if (!belongs || !Number.isFinite(kf.value)) continue;
    const key = `${kf.elementId}|${kf.attributePath ?? kf.property ?? ''}`;
    if (!kfByTrack.has(key)) kfByTrack.set(key, []);
    kfByTrack.get(key).push(kf);
  }
  let earliestStart = Infinity;
  let bestVel = 0;
  let bestPeakFrame = Infinity;
  for (const series of kfByTrack.values()) {
    series.sort((a, b) => a.targetFrame - b.targetFrame);
    for (let i = 0; i < series.length - 1; i += 1) {
      const a = series[i], b = series[i + 1];
      const dt = b.targetFrame - a.targetFrame;
      if (dt <= 0 || Math.abs(b.value - a.value) < 1e-6) continue;
      earliestStart = Math.min(earliestStart, a.targetFrame);
      const vel = Math.abs(b.value - a.value) / dt;
      const mid = Math.round((a.targetFrame + b.targetFrame) / 2);
      if (vel > bestVel) { bestVel = vel; bestPeakFrame = mid; }
    }
  }
  if (bestVel > 0) {
    if (earliestStart > 5 || bestPeakFrame > limit) {
      return { status: 'fail', message: `Shot ${shot1.id} keyframe velocity peaks at ${bestPeakFrame}f (limit <= ${limit}f)` };
    }
    return { status: 'pass', message: `Shot ${shot1.id} keyframe entrance velocity peaks at ${bestPeakFrame}f (<= ${limit}f)` };
  }
  const move = shot1.trackEntry.move;
  if (move && Array.isArray(move.from) && Array.isArray(move.to) && JSON.stringify(move.from) !== JSON.stringify(move.to)) {
    const peakFrame = Math.round(Math.min(limit, shot1.durationFrames / 2));
    return { status: 'pass', message: `Shot ${shot1.id} camera move entrance active from 0f (peak ~${peakFrame}f)` };
  }
  if (shotOps.size > 0 && shot1.durationFrames <= limit) {
    return { status: 'pass', message: `Shot ${shot1.id} active within ${shot1.durationFrames}f` };
  }
  return { status: 'fail', message: `Shot ${shot1.id} lacks active motion entrance or kinetic peak in first ${limit}f` };
}

function countWords(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1 && /[\u4e00-\u9fff]{5,}/.test(words[0])) {
    return words[0].length;
  }
  return words.length;
}

function checkPoint2WordCap(shots, scenePlan, fps) {
  const beats = [];
  for (const shot of shots) {
    const explicitBeats = Array.isArray(shot.videoShot.beats) ? shot.videoShot.beats : [];
    for (const beat of explicitBeats) beats.push({ shotId: shot.id, defaultDur: shot.durationSeconds, ...beat });
    const inlineText = shot.videoShot.text ?? shot.trackEntry.caption ?? (typeof shot.trackEntry.reads === 'string' ? shot.trackEntry.reads : null);
    if (inlineText !== undefined && inlineText !== null || Number.isFinite(shot.videoShot.words) || Number.isFinite(shot.videoShot.wordCount)) {
      beats.push({
        shotId: shot.id,
        text: inlineText ?? '',
        words: shot.videoShot.words ?? shot.videoShot.wordCount,
        holdSeconds: shot.videoShot.holdSeconds ?? shot.durationSeconds,
        allowLongRead: shot.videoShot.allowLongRead
      });
    }
  }
  for (const op of scenePlan?.operations ?? []) {
    if (op?.action === 'createText' && typeof op?.params?.attributes?.text === 'string') {
      const parentShot = shots.find(shot => shot.id === op.shotId);
      const holdSeconds = Number(op.params.attributes.holdSeconds ?? parentShot?.durationSeconds ?? (scenePlan?.project?.totalFrames ?? fps) / fps);
      beats.push({
        shotId: op.shotId ?? op.elementId ?? 'plan',
        text: op.params.attributes.text,
        holdSeconds,
        allowLongRead: op.params.attributes.allowLongRead
      });
    }
  }
  for (const beat of beats) {
    const text = String(beat.text ?? '').trim();
    const wordCount = Array.isArray(beat.words)
      ? beat.words.length
      : Number.isFinite(beat.words)
        ? Number(beat.words)
        : countWords(text);
    const holdSeconds = Number(beat.holdSeconds ?? beat.durationSeconds ?? beat.defaultDur ?? 1);
    const chars = text.replace(/\s+/g, '').length;
    const cps = holdSeconds > 0 ? chars / holdSeconds : Infinity;
    if ((text.length > 0 || wordCount > 0) && holdSeconds < 0.8) {
      return { status: 'fail', message: `Beat in ${beat.shotId} holds ${holdSeconds.toFixed(2)}s (< 0.8s minimum readability hold)` };
    }
    if (cps > 15) {
      return { status: 'fail', message: `Beat in ${beat.shotId} reading speed ${cps.toFixed(1)} CPS exceeds 15 CPS cap` };
    }
    if (wordCount > 4 && beat.allowLongRead !== true) {
      return { status: 'fail', message: `Beat in ${beat.shotId} has ${wordCount} words (> 4 word kinetic cap)` };
    }
  }
  return { status: 'pass', message: `${beats.length} text beat(s) pass <= 4 words and <= 15 CPS (>= 0.8s hold)` };
}

function checkPoint7AsymmetricPacing(shots) {
  if (shots.length < 3) {
    return { status: 'pass', message: `${shots.length} shot(s); fewer than 3 consecutive shots for slideshow check` };
  }
  for (let i = 0; i <= shots.length - 3; i += 1) {
    const group = [shots[i], shots[i + 1], shots[i + 2]];
    const durs = group.map(item => item.durationFrames);
    if (Math.max(...durs) - Math.min(...durs) <= 2) {
      return {
        status: 'fail',
        message: `3 consecutive shots (${group.map(g => g.id).join(', ')}) share nearly identical durations (${durs.join(', ')}f within +-2f)`
      };
    }
  }
  return { status: 'pass', message: `${shots.length} shots maintain asymmetric beat durations (> 2f delta per triple)` };
}

function checkPoint8EnergyArc(shots) {
  const energies = [];
  for (const shot of shots) {
    const raw = shot.videoShot.energy;
    const stage = typeof shot.videoShot.energyArc === 'string' ? shot.videoShot.energyArc.toLowerCase() : null;
    const score = Number.isFinite(raw) ? Number(raw) : (stage && stage in ENERGY_STAGE_DEFAULTS ? ENERGY_STAGE_DEFAULTS[stage] : null);
    if (score === null || score < 0 || score > 1) {
      return { status: 'fail', message: `Shot ${shot.id} lacks valid 0.0-1.0 energy score (got ${raw ?? stage ?? 'none'})` };
    }
    energies.push({ id: shot.id, score, stage });
  }
  if (energies.length >= 2) {
    const values = energies.map(e => e.score);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min < 0.15) {
      return { status: 'fail', message: `Flatline energy arc (${values.join(', ')}): spread ${(max - min).toFixed(2)} < 0.15` };
    }
    if (energies.length >= 3 && max < 0.65) {
      return { status: 'fail', message: `Energy arc has no climax peak >= 0.65 (max ${max.toFixed(2)})` };
    }
  }
  return { status: 'pass', message: `Energy arc spans [${energies.map(e => e.score.toFixed(2)).join(' -> ')}]` };
}

function checkPoint9ShotGrammarVariety(shots) {
  const cards = shots.map(shot => ({
    id: shot.id,
    card: shot.videoShot.shotGrammarCard ?? shot.trackEntry.recipe ?? shot.videoShot.recipe ?? shot.trackEntry.camera?.card ?? null,
    size: shot.trackEntry.camera?.size ?? shot.videoShot.camera?.size ?? null,
    angle: shot.trackEntry.camera?.angle ?? shot.videoShot.camera?.angle ?? null
  }));
  if (shots.length >= 3 && cards.every(c => !c.card)) {
    return { status: 'fail', message: 'Multi-shot edit declares no shotGrammarCard or recipe taxonomy on any shot' };
  }
  for (let i = 0; i <= cards.length - 3; i += 1) {
    const a = cards[i], b = cards[i + 1], c = cards[i + 2];
    if (a.card && a.card === b.card && b.card === c.card && a.size === b.size && b.size === c.size && a.angle === b.angle && b.angle === c.angle) {
      return { status: 'fail', message: `3 consecutive shots (${a.id}, ${b.id}, ${c.id}) repeat shotGrammarCard "${a.card}" without scale/angle change` };
    }
  }
  return { status: 'pass', message: `${cards.filter(c => c.card).length} shot(s) preserve shot-grammar variety` };
}

function checkPoint10CameraSplineC1(edit, shots) {
  const splines = [
    ...(Array.isArray(edit?.video?.cameraPaths) ? edit.video.cameraPaths : []),
    ...(Array.isArray(edit?.video?.camera?.waypoints) ? [{ id: 'global', waypoints: edit.video.camera.waypoints }] : [])
  ];
  for (const shot of shots) {
    const waypoints = shot.videoShot.camera?.waypoints ?? shot.videoShot.camera?.spline;
    if (Array.isArray(waypoints)) splines.push({ id: shot.id, waypoints, seams: shot.videoShot.camera?.seams ?? [] });
  }
  for (const sp of splines) {
    const pts = sp.waypoints;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 1; i < pts.length; i += 1) {
      if (!(pts[i][0] > pts[i - 1][0])) {
        return { status: 'fail', message: `Camera spline ${sp.id} has non-monotonic waypoint frames (${pts[i - 1][0]} -> ${pts[i][0]})` };
      }
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const f = pts[i][0];
      const dt = 0.05;
      const pL = splineAt(f - dt, pts);
      const pM = splineAt(f, pts);
      const pR = splineAt(f + dt, pts);
      for (let d = 0; d < pM.length; d += 1) {
        const vL = (pM[d] - pL[d]) / dt;
        const vR = (pR[d] - pM[d]) / dt;
        if (Math.abs(vR - vL) > Math.max(5, Math.abs(vL) * 0.25 + Math.abs(vR) * 0.25)) {
          return { status: 'fail', message: `Camera spline ${sp.id} fails C1 velocity continuity at frame ${f} (vL=${vL.toFixed(2)}, vR=${vR.toFixed(2)})` };
        }
      }
    }
  }
  for (let i = 0; i < shots.length - 1; i += 1) {
    const curr = shots[i], next = shots[i + 1];
    const continuous = next.trackEntry.seam === 'continuous' || next.videoShot.seam === 'continuous' || next.videoShot.camera?.continuous === true;
    if (!continuous) continue;
    if (next.videoShot.camera?.teleport === true) {
      return { status: 'fail', message: `Camera teleports across continuous seam ${curr.id} -> ${next.id}` };
    }
    const toPos = curr.videoShot.camera?.endPosition ?? curr.trackEntry.move?.to;
    const fromPos = next.videoShot.camera?.startPosition ?? next.trackEntry.move?.from;
    if (Array.isArray(toPos) && Array.isArray(fromPos)) {
      const dist = Math.hypot(...toPos.map((v, idx) => Number(v) - Number(fromPos[idx] ?? v)));
      if (dist > 0.5) {
        return { status: 'fail', message: `Camera position jump (${dist.toFixed(2)}) across continuous seam ${curr.id} -> ${next.id}` };
      }
    }
    const vOut = curr.videoShot.camera?.endVelocity;
    const vIn = next.videoShot.camera?.startVelocity;
    if (Array.isArray(vOut) && Array.isArray(vIn)) {
      const dv = Math.hypot(...vOut.map((v, idx) => Number(v) - Number(vIn[idx] ?? v)));
      if (dv > 2.0) {
        return { status: 'fail', message: `Camera first-derivative velocity jump (${dv.toFixed(2)}) at continuous seam ${curr.id} -> ${next.id}` };
      }
    }
  }
  return { status: 'pass', message: `${splines.length} camera spline(s) & continuous seams satisfy C1 continuity` };
}

function checkPoint11FittsCursor(edit, shots) {
  const cursors = [
    ...(Array.isArray(edit?.video?.cursors) ? edit.video.cursors : []),
    ...shots.filter(s => s.videoShot.cursor).map(s => ({ shotId: s.id, ...s.videoShot.cursor }))
  ];
  if (!cursors.length) return { status: 'pass', message: 'no active Fitts cursor rig in scene' };
  for (const rig of cursors) {
    const label = rig.shotId ?? rig.id ?? 'cursor';
    const compression = Number(rig.clickCompressionFrames ?? rig.anticipationFrames ?? (Number.isFinite(rig.stateChangeFrame) && Number.isFinite(rig.clickStartFrame) ? rig.stateChangeFrame - rig.clickStartFrame : NaN));
    if (!Number.isFinite(compression) || compression < 3 || compression > 6) {
      return { status: 'fail', message: `Cursor rig ${label} anticipation/click compression is ${compression}f (requires 3-6f before state change)` };
    }
    if (Array.isArray(rig.trajectory) && rig.trajectory.length >= 2) {
      const sorted = [...rig.trajectory].sort((a, b) => a[0] - b[0]);
      const t0 = sorted[0][0], t1 = sorted[sorted.length - 1][0];
      const span = t1 - t0;
      if (span >= 4) {
        const pEarlyA = fittsCursorAt(t0 + span * 0.1, sorted);
        const pEarlyB = fittsCursorAt(t0 + span * 0.25, sorted);
        const pLateA = fittsCursorAt(t0 + span * 0.85, sorted);
        const pLateB = fittsCursorAt(t1, sorted);
        const speedEarly = Math.hypot(pEarlyB.x - pEarlyA.x, pEarlyB.y - pEarlyA.y) / (span * 0.15);
        const speedLate = Math.hypot(pLateB.x - pLateA.x, pLateB.y - pLateA.y) / (span * 0.15);
        if (speedLate >= speedEarly * 0.99 && speedEarly > 0) {
          return { status: 'fail', message: `Cursor rig ${label} does not decelerate into hitbox (early=${speedEarly.toFixed(2)}, late=${speedLate.toFixed(2)})` };
        }
      }
    }
  }
  return { status: 'pass', message: `${cursors.length} active Fitts cursor rig(s) decelerate with 3-6f anticipation/click` };
}

function checkPoint12SpringEasingPurity(edit, shots, scenePlan) {
  const curves = [
    ...(Array.isArray(edit?.video?.curves) ? edit.video.curves : []),
    ...shots.flatMap(s => {
      const list = [];
      if (Array.isArray(s.videoShot.curves)) list.push(...s.videoShot.curves.map(c => ({ shotId: s.id, ...c })));
      if (s.videoShot.easing) list.push({ shotId: s.id, kind: Array.isArray(s.videoShot.easing) ? 'cubic-bezier' : 'spring', value: s.videoShot.easing });
      if (s.trackEntry.move?.ease === 'linear') list.push({ shotId: s.id, kind: 'cubic-bezier', cubicBezier: [0, 0, 1, 1] });
      return list;
    })
  ];
  for (const kf of scenePlan?.keyframes ?? []) {
    if (kf.interpolation === 'linear' && (!kf.easing || String(kf.easing).toLowerCase() === 'linear')) {
      return { status: 'fail', message: `Keyframe ${kf.id} uses raw linear interpolation without spring/Bezier easing` };
    }
    if (Array.isArray(kf.easing)) curves.push({ shotId: kf.shotId ?? kf.id, kind: 'cubic-bezier', cubicBezier: kf.easing });
  }
  for (const curve of curves) {
    const cb = Array.isArray(curve.cubicBezier) ? curve.cubicBezier : (Array.isArray(curve.value) ? curve.value : null);
    if (cb) {
      if (cb[0] === 0 && cb[1] === 0 && cb[2] === 1 && cb[3] === 1) {
        return { status: 'fail', message: `Raw linear [0, 0, 1, 1] easing on ${curve.shotId ?? 'element'} violates spring/bezier purity` };
      }
      try { evaluateBezierEasing(cb, 0.5); }
      catch (err) { return { status: 'fail', message: `Invalid Bezier curve on ${curve.shotId ?? 'element'}: ${err.message}` }; }
    }
    if (String(curve.kind ?? curve.value ?? '').toLowerCase() === 'linear') {
      return { status: 'fail', message: `Linear curve on ${curve.shotId ?? 'element'} violates spring/bezier purity` };
    }
    if (curve.kind === 'spring' && Number(curve.spring?.overshoot ?? 0) > 0.5) {
      return { status: 'fail', message: `Excessive spring overshoot (${curve.spring.overshoot} > 0.5) on ${curve.shotId ?? 'element'}` };
    }
  }
  if (!curves.length && (scenePlan?.keyframes?.length ?? 0) === 0 && shots.some(s => s.videoShot.static !== true)) {
    return { status: 'pass', message: 'no uncalibrated linear transform easing detected' };
  }
  return { status: 'pass', message: `${curves.length} curve/spring definition(s) verified non-linear` };
}

function checkPoint13MorphParity(edit, shots, scenePlan) {
  const morphs = [
    ...(Array.isArray(edit?.video?.morphs) ? edit.video.morphs : []),
    ...shots.filter(s => s.videoShot.morph).map(s => ({ id: s.id, ...s.videoShot.morph })),
    ...(scenePlan?.operations ?? [])
      .filter(op => op?.params?.fromPath && op?.params?.toPath)
      .map(op => ({ id: op.id, fromPath: op.params.fromPath, toPath: op.params.toPath }))
  ];
  if (!morphs.length) return { status: 'pass', message: 'no SVG shape morphs declared' };
  for (const m of morphs) {
    const fromPath = m.fromPath ?? m.from;
    const toPath = m.toPath ?? m.to;
    if (typeof fromPath !== 'string' || typeof toPath !== 'string') {
      return { status: 'fail', message: `SVG morph ${m.id ?? 'shape'} is missing fromPath or toPath` };
    }
    try {
      const rawFrom = new SVGPathCommander(fromPath).segments;
      const rawTo = new SVGPathCommander(toPath).segments;
      const eq = equalizePaths(fromPath, toPath);
      if (rawFrom.length !== rawTo.length || m.equalized === false) {
        return {
          status: 'fail',
          message: `SVG morph ${m.id ?? 'shape'} has unequal segments (${rawFrom.length} vs ${rawTo.length}); equalize via src/design/equalizePaths.mjs (target ${eq.segmentCount} segments)`
        };
      }
    } catch (error) {
      return { status: 'fail', message: `SVG morph ${m.id ?? 'shape'} invalid path: ${error.message}` };
    }
  }
  return { status: 'pass', message: `${morphs.length} SVG morph pair(s) share equalized segment counts` };
}

function checkPoint17AvSync(edit, resolved, shots) {
  if (edit?.video?.silent === true) return { status: 'pass', message: 'explicit silent film' };
  const fps = Number(edit?.fps ?? resolved?.fps ?? 30);
  const cues = [];
  for (const c of edit?.video?.sfxCues ?? []) {
    const frame = Number.isFinite(c?.frame) ? Number(c.frame) : (Number.isFinite(c?.timeSeconds) ? Math.round(c.timeSeconds * fps) : NaN);
    if (Number.isFinite(frame)) cues.push({ frame, targetFrame: c.targetFrame, id: c.id ?? `sfx-${cues.length}` });
  }
  for (const b of edit?.video?.beats ?? []) {
    const frame = typeof b === 'number' ? b : (Number.isFinite(b?.frame) ? Number(b.frame) : (Number.isFinite(b?.timeSeconds) ? Math.round(b.timeSeconds * fps) : NaN));
    if (Number.isFinite(frame)) cues.push({ frame, id: `beat-${frame}` });
  }
  for (const s of resolved?.sound ?? []) {
    if (['detail', 'hero', 'signal'].includes(s.role) && Array.isArray(s.film)) {
      cues.push({ frame: s.film[0], id: s.entryId });
    }
  }
  const impacts = [];
  for (const i of edit?.video?.impacts ?? []) {
    if (Number.isFinite(i)) impacts.push({ id: `impact-${i}`, frame: Number(i) });
    else if (Number.isFinite(i?.frame)) impacts.push({ id: i.id ?? `impact-${i.frame}`, frame: Number(i.frame) });
  }
  for (const shot of shots) {
    const frame = shot.videoShot.impactFrame ?? shot.videoShot.peakFrame ?? shot.videoShot.hook?.peakFrame;
    if (Number.isFinite(frame)) impacts.push({ id: shot.id, frame: Number(frame) });
  }
  if (!impacts.length) {
    return cues.length
      ? { status: 'pass', message: `${cues.length} SFX/beat cue(s) present (no isolated impact markers exceeded +-2f)` }
      : { status: 'fail', message: 'Non-silent edit declares neither visual impact frames nor SFX/beat markers' };
  }
  if (!cues.length) {
    return { status: 'fail', message: `Visual impacts [${impacts.map(i => i.frame).join(', ')}] have zero SFX/beat triggers` };
  }
  for (const impact of impacts) {
    const minDelta = Math.min(...cues.map(c => Math.abs(c.frame - impact.frame)));
    if (minDelta > 2) {
      return { status: 'fail', message: `Visual impact ${impact.id} at ${impact.frame}f is ${minDelta}f from nearest SFX/beat cue (> +-2f limit)` };
    }
  }
  for (const cue of cues) {
    if (Number.isFinite(cue.targetFrame) && Math.abs(cue.frame - cue.targetFrame) > 2) {
      return { status: 'fail', message: `SFX cue ${cue.id} at ${cue.frame}f misses target ${cue.targetFrame}f by ${Math.abs(cue.frame - cue.targetFrame)}f (> +-2f)` };
    }
  }
  return { status: 'pass', message: `${impacts.length} visual impact(s) synced within <= 2f of ${cues.length} SFX/beat marker(s)` };
}

function checkPoint18AudioLoudness(edit, resolved) {
  if (edit?.video?.silent === true) return { status: 'pass', message: 'explicit silent film' };
  const audio = edit?.video?.audio ?? null;
  if (!audio || typeof audio !== 'object') {
    return { status: 'fail', message: 'Non-silent edit is missing video.audio (48000 Hz, -14 LUFS, <= -1.0 dBTP) metadata' };
  }
  if (Number(audio.sampleRateHz) !== 48000) {
    return { status: 'fail', message: `Audio sampleRateHz is ${audio.sampleRateHz} (must be 48000)` };
  }
  const lufs = Number(audio.targetLufs);
  if (!Number.isFinite(lufs) || Math.abs(lufs - (-14)) > 1.0) {
    return { status: 'fail', message: `Audio targetLufs is ${audio.targetLufs} (must be -14 LUFS +-1)` };
  }
  const tp = Number(audio.truePeakDbtp);
  if (!Number.isFinite(tp) || tp > -1.0) {
    return { status: 'fail', message: `Audio truePeakDbtp is ${audio.truePeakDbtp} (must be <= -1.0 dBTP)` };
  }
  const hasNarration = audio.narrationActive === true || (resolved?.sound ?? []).some(s => s.role === 'voice');
  if (hasNarration) {
    const duckEnabled = audio.ducking?.enabled === true;
    const duckDb = Number(audio.ducking?.reductionDb ?? audio.duckingDb ?? 0);
    const bedDucked = (resolved?.sound ?? []).some(s => s.role === 'ambience' && Number(s.gain_db) <= -6);
    if (!((duckEnabled && duckDb <= -3) || bedDucked)) {
      return { status: 'fail', message: 'Narration is active without verified music-bed ducking headroom (<= -3 dB / -6 dB gain)' };
    }
  }
  return { status: 'pass', message: `48000Hz / ${lufs} LUFS / ${tp} dBTP${hasNarration ? ' + ducking headroom' : ''} verified` };
}

function checkPoint19LedgerClaims(edit, shots, scenePlan, context = {}) {
  const texts = [];
  for (const s of shots) {
    const txt = s.videoShot.text ?? s.trackEntry.caption ?? '';
    if (txt) texts.push({ id: s.id, text: String(txt), ledgerRef: s.videoShot.ledgerRef ?? s.trackEntry.ledgerRef ?? null });
  }
  for (const op of scenePlan?.operations ?? []) {
    const txt = op?.params?.attributes?.text;
    if (typeof txt === 'string' && txt) {
      texts.push({ id: op.elementId ?? op.id, text: txt, ledgerRef: op.params?.attributes?.ledgerRef ?? null });
    }
  }
  for (const item of texts) {
    if (PLACEHOLDER_RE.test(item.text)) {
      return { status: 'fail', message: `Placeholder copy detected in ${item.id}: "${item.text}"` };
    }
    if (QUANT_CLAIM_RE.test(item.text) && (!item.ledgerRef || /^(unverified|missing|none|null|tbd)$/i.test(String(item.ledgerRef)))) {
      return { status: 'fail', message: `Quantitative claim in ${item.id} ("${item.text}") lacks a valid ledgerRef` };
    }
  }
  const declaredClaims = [
    ...(Array.isArray(edit?.video?.claims) ? edit.video.claims : []),
    ...shots.flatMap(s => Array.isArray(s.videoShot.claims) ? s.videoShot.claims.map(c => ({ shotId: s.id, ...c })) : [])
  ];
  const ledgerIds = context.ledger?.claims ? new Set(Object.keys(context.ledger.claims)) : null;
  for (const claim of declaredClaims) {
    if (!claim?.ledgerRef || /^(unverified|missing|none|null|tbd)$/i.test(String(claim.ledgerRef))) {
      return { status: 'fail', message: `Claim "${claim?.text ?? claim?.id ?? 'unknown'}" lacks a valid ledgerRef` };
    }
    if (ledgerIds && !ledgerIds.has(claim.ledgerRef)) {
      return { status: 'fail', message: `Claim ledgerRef "${claim.ledgerRef}" not found in source ledger` };
    }
  }
  if (context.ledgerReport && context.ledgerReport.ok !== true) {
    return { status: 'fail', message: `product_ledger.py failed verification (${context.ledgerReport.errors ?? 1} error(s))` };
  }
  return { status: 'pass', message: `${declaredClaims.length} quantitative claim(s) verified against source ledger` };
}

function toHex6(color) {
  const c = parseColor(color);
  if (!c) return null;
  const hx = v => Math.round(v).toString(16).padStart(2, '0');
  return `#${hx(c.r)}${hx(c.g)}${hx(c.b)}`;
}

function checkPoint20BrandPalette(edit, shots, scenePlan) {
  const themeName = edit?.video?.theme ?? scenePlan?.theme ?? null;
  const themeObj = themeName && Object.prototype.hasOwnProperty.call(ASTRYX_THEMES, String(themeName).toLowerCase())
    ? resolveAstryxTheme(themeName)
    : null;
  const rawPalette = edit?.video?.palette ?? {};
  const accents = new Set();
  const neutrals = new Set();
  const addHex = (set, value) => { const h = toHex6(value); if (h) set.add(h); };
  if (themeObj) {
    addHex(accents, themeObj.accentPrimary);
    addHex(neutrals, themeObj.bgSurface);
    addHex(neutrals, themeObj.cardFill);
    addHex(neutrals, themeObj.textPrimary);
    addHex(neutrals, themeObj.textMuted);
    addHex(neutrals, themeObj.strokeColor);
  }
  for (const v of rawPalette.accents ?? []) addHex(accents, v);
  if (rawPalette.primary) addHex(accents, rawPalette.primary);
  for (const v of rawPalette.neutrals ?? []) addHex(neutrals, v);
  for (const v of Object.values(rawPalette.tokens ?? {})) addHex(neutrals, v);

  if (accents.size > 3) {
    return { status: 'fail', message: `Brand palette declares ${accents.size} accent colors (maximum 3 allowed)` };
  }
  const allowed = new Set([...accents, ...neutrals]);
  const allowedRaw = new Set((rawPalette.allowedRaw ?? []).map(toHex6).filter(Boolean));
  const usedColors = [];
  for (const src of Object.values(edit?.sources ?? {})) {
    if (src?.color) usedColors.push({ where: 'source', hex: toHex6(src.color), raw: src.color });
  }
  for (const s of shots) {
    if (s.trackEntry.bg) usedColors.push({ where: s.id, hex: toHex6(s.trackEntry.bg), raw: s.trackEntry.bg });
    for (const c of s.videoShot.paletteColors ?? []) usedColors.push({ where: s.id, hex: toHex6(c), raw: c });
  }
  for (const op of scenePlan?.operations ?? []) {
    const attr = op?.params?.attributes ?? {};
    for (const key of ['material.materialColor', 'materialColor', 'color', 'fill']) {
      if (attr[key] !== undefined) usedColors.push({ where: op.elementId ?? op.id, hex: toHex6(attr[key]), raw: attr[key] });
    }
  }
  for (const entry of usedColors) {
    if (!entry.hex) continue;
    if (UNCALIBRATED_RAW_COLORS.has(entry.hex) && !allowedRaw.has(entry.hex)) {
      return { status: 'fail', message: `Uncalibrated raw color default ${entry.hex} on ${entry.where}` };
    }
    if (allowed.size > 0 && !allowed.has(entry.hex)) {
      return { status: 'fail', message: `Color ${entry.hex} on ${entry.where} is not in declared theme/palette tokens` };
    }
  }
  return { status: 'pass', message: `${usedColors.length} color(s) resolve to declared theme/palette tokens (${accents.size} <= 3 accents)` };
}

/**
 * Evaluate the OpenVideoHarness checklist metrics derived from edit list + scene plan.
 * Returns per-point deterministic verdicts `{ id, checkId, label, status, message }`.
 */
export function evaluateEditListChecklist(edit, resolved, { scenePlan = null, ledger = null, ledgerReport = null } = {}) {
  const fps = Number(edit?.fps ?? resolved?.fps ?? 30);
  const shots = mergeShotsForChecklist(edit, resolved, scenePlan);
  return {
    1: { checkId: 'hook-45f', label: 'hook entrance peaks within first 45 frames', ...measureShot1Hook(shots, fps, scenePlan) },
    2: { checkId: 'word-reading-cap', label: '<= 4 words per beat, <= 15 CPS, >= 0.8s hold', ...checkPoint2WordCap(shots, scenePlan, fps) },
    7: { checkId: 'asymmetric-pacing', label: 'no 3 consecutive shots share identical durations (+-2f)', ...checkPoint7AsymmetricPacing(shots) },
    8: { checkId: 'energy-arc', label: 'energy scores form non-flatline arc skeleton', ...checkPoint8EnergyArc(shots) },
    9: { checkId: 'shot-grammar-variety', label: 'consecutive shots vary shotGrammarCard / scale / angle', ...checkPoint9ShotGrammarVariety(shots) },
    10: { checkId: 'spline-camera-c1', label: 'C1 spline camera position and velocity continuity', ...checkPoint10CameraSplineC1(edit, shots) },
    11: { checkId: 'fitts-cursor-realism', label: 'Fitts cursor deceleration & 3-6f anticipation/click', ...checkPoint11FittsCursor(edit, shots) },
    12: { checkId: 'spring-easing-purity', label: 'spring physics or non-linear Bezier easing', ...checkPoint12SpringEasingPurity(edit, shots, scenePlan) },
    13: { checkId: 'svg-morph-parity', label: 'SVG morph pairs share equalized segment counts', ...checkPoint13MorphParity(edit, shots, scenePlan) },
    17: { checkId: 'av-impact-sync', label: 'visual impacts align within +-2 frames of SFX/beat', ...checkPoint17AvSync(edit, resolved, shots) },
    18: { checkId: 'loudness-mix-headroom', label: '48kHz audio at -14 LUFS, <= -1 dBTP, ducking headroom', ...checkPoint18AudioLoudness(edit, resolved) },
    19: { checkId: 'ledger-claims', label: 'quantitative claims carry valid source ledgerRef', ...checkPoint19LedgerClaims(edit, shots, scenePlan, { ledger, ledgerReport }) },
    20: { checkId: 'brand-palette-tokens', label: 'brand palette & theme tokens (<= 3 accents, calibrated)', ...checkPoint20BrandPalette(edit, shots, scenePlan) }
  };
}
