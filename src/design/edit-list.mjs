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
import { WorkflowError, absolutePath, hashFile, hashObject, readJson, validateArtifact } from '../core.mjs';

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
