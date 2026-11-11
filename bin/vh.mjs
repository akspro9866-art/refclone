#!/usr/bin/env node
// vh — the OpenVideoHarness review/rework CLI for refclone.
//
// edit  builds/updates the edit-list manifest from a measured scene plan, recording
//       a content hash per shot so a later patch can tell which shots changed.
// patch re-compiles one shot: it resolves the edit list, expands that entry to a
//       single-shot keyframe window (frame renderers are per-shot, so shot
//       boundaries are the default keyframes), writes a schema-valid patch plan and
//       the exact build/render commands. Executing those commands still needs the
//       live Cavalry + Stallion bridge; this CLI never pretends to render.
// desk  writes a self-contained HTML review desk (lint findings, loop status,
//       per-shot filmstrips, approve/rework toggles).
// gate  runs the vision-free static gates and writes the desk beside the report.
// check runs the 20-point contact-sheet checklist's automatic release checks and
//       appends failures to LESSONS.md.
//
// The 20-point checklist and the 8-dimension fresh-context reviewer remain a
// human/agent review; vh check never scores taste and never calls a review a pass.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, absolutePath, hashObject, readJson, writeJsonState } from '../src/core.mjs';
import { resolveEditList, resolveEditListFile, buildPatchPlan, validateEditList, validateEditListShape } from '../src/design/edit-list.mjs';
import { evaluateStaticGates } from '../src/pipeline/gates.mjs';

export const VH_VERSION = '1.0.0';
const ROOT = absolutePath(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_EDIT_PATH = absolutePath(path.join(ROOT, 'src/design/edit.json'));
export const DEFAULT_DESK_PATH = absolutePath(path.join(ROOT, 'artifacts/review-desk.html'));
export const DEFAULT_GATES_PATH = absolutePath(path.join(ROOT, 'artifacts/gates.json'));
export const DEFAULT_CHECK_PATH = absolutePath(path.join(ROOT, 'artifacts/vh-check.json'));
export const DEFAULT_LESSONS_PATH = absolutePath(path.join(ROOT, 'LESSONS.md'));
const TASTE_CHECKLIST_PATH = absolutePath(path.join(ROOT, 'vendor/wave2/OpenVideoHarness/taste-checklist.json'));
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

const HELP = `vh - OpenVideoHarness review/rework CLI

  node bin/vh.mjs edit --scene-plan <scene-plan.json> [--out <edit.json>] [--shots <shots.json>] [--note <text>]
  node bin/vh.mjs patch <shotId> [--edit <edit.json>] [--scene-plan <scene-plan.json>] [--stem video|audio|both]
                            [--keyframes <json-array>] [--gop <frames>] [--project <saved-scene>] [--out <directory>]
  node bin/vh.mjs desk [--edit <edit.json>] [--gates <static-gates.json>] [--filmstrip <directory>] [--out <review-desk.html>]
  node bin/vh.mjs gate --scene-plan <scene-plan.json> [--loopcheck <checkloop.json>] [--geometry <geometry.json>]
                       [--edit <edit.json>] [--out <gates.json>] [--desk <review-desk.html>]
  node bin/vh.mjs check [--edit <edit.json>] [--scene-plan <scene-plan.json>] [--gates <gates.json>]
                        [--out <vh-check.json>] [--lessons <LESSONS.md>]

A shots.json manifest may carry { "energyArc": "...", "shots": [{ "id", "recipe", "energyArc",
"camera", "audioStems": [] }] }. Missing metadata stays null; vh edit never invents a recipe ID.
patch only writes a rework order unless --scene-plan is given; the actual build/render needs
Cavalry 2.8.0 with the Stallion bridge (Scripts > Stallion) running.`;

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function isIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]+$/.test(value);
}

function shotContentHash(plan, shot) {
  const inShot = id => Array.isArray(shot[`${id}Ids`]) ? new Set(shot[`${id}Ids`]) : new Set();
  const operationIds = inShot('operation');
  const keyframeIds = inShot('keyframe');
  const elementIds = inShot('element');
  const assetIds = inShot('requiredAsset');
  return hashObject({
    shot: {
      id: shot.id, startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive,
      // Plans in the wild omit these; hashObject accepts JSON only, so unknowns become null.
      durationSeconds: shot.durationSeconds ?? null, status: shot.status ?? null
    },
    elements: (plan.elements ?? []).filter(element => elementIds.has(element.id)),
    operations: (plan.operations ?? []).filter(operation => operationIds.has(operation.id)),
    keyframes: (plan.keyframes ?? []).filter(keyframe => keyframeIds.has(keyframe.id)),
    assets: (plan.assets ?? []).filter(asset => assetIds.has(asset.id))
  });
}

function mergeContentHash(note, hash) {
  const text = typeof note === 'string' ? note : '';
  if (/contentHash=[0-9a-f]{64}/.test(text)) return text.replace(/contentHash=[0-9a-f]{64}/, `contentHash=${hash}`);
  return text ? `${text}; contentHash=${hash}` : `contentHash=${hash}`;
}

function cameraFor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const camera = {};
  for (const key of ['size', 'angle', 'move', 'axis']) {
    if (typeof value[key] === 'string' && value[key]) camera[key] = value[key];
  }
  return Object.keys(camera).length ? camera : null;
}

function frameRate(plan) {
  const fps = plan?.project?.fps;
  const numerator = Number(fps?.num);
  const denominator = Number(fps?.den ?? 1);
  if (!Number.isInteger(numerator) || numerator < 1 || denominator !== 1) {
    fail('VH_EDIT_FPS_UNSUPPORTED', 'edit.json requires an integer frame rate; this plan uses a fractional rate.', { fps });
  }
  return numerator;
}

/**
 * Build (or update) the edit-list manifest from a measured scene plan.
 * @param {{scenePlan?: object, scenePlanPath?: string, shots?: object, outPath?: string, note?: string}} [options]
 * @returns {Promise<{edit: object, resolved: object, path: string, report: object}>}
 */
export async function buildEditManifest(options = {}) {
  const plan = options.scenePlan ?? (options.scenePlanPath ? await readJson(absolutePath(options.scenePlanPath)) : null);
  if (!plan) fail('VH_USAGE', 'vh edit needs --scene-plan <scene-plan.json> or a scenePlan object.');
  const width = Number(plan?.project?.width);
  const height = Number(plan?.project?.height);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    fail('VH_PLAN_INVALID', 'The scene plan has no measured project width/height.');
  }
  const fps = frameRate(plan);
  const totalFrames = Number(plan?.project?.totalFrames);
  const shotManifest = options.shots ?? null;
  const metaById = new Map((shotManifest?.shots ?? []).filter(item => item?.id).map(item => [item.id, item]));
  const sources = {};
  const entries = [];
  const manifestShots = [];
  const shots = [...(plan.shots ?? [])].sort((a, b) => a.startFrame - b.startFrame);
  if (!shots.length) fail('VH_PLAN_INVALID', 'The scene plan declares no shots.');
  for (const shot of shots) {
    if (!isIdentifier(shot.id)) {
      fail('VH_EDIT_SHOT_ID', 'A shot id must match ^[A-Za-z0-9_]+$ to be an edit-list entry id.', { shotId: shot.id });
    }
    const start = Number(shot.startFrame);
    const end = Number(shot.endFrameExclusive);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
      fail('VH_EDIT_SHOT_EMPTY', `Shot ${shot.id} has no measurable frame span.`, { startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive });
    }
    const meta = metaById.get(shot.id) ?? {};
    const contentHash = shotContentHash(plan, shot);
    const energyArc = typeof meta.energyArc === 'string' && meta.energyArc ? meta.energyArc : null;
    const recipe = typeof meta.recipe === 'string' && meta.recipe ? meta.recipe : null;
    const audioStems = Array.isArray(meta.audioStems) ? meta.audioStems.filter(item => typeof item === 'string') : [];
    sources[shot.id] = { clip: shot.id };
    entries.push({
      id: shot.id,
      src: shot.id,
      start: start / fps,
      dur: (end - start) / fps,
      ...(recipe ? { recipe } : {}),
      ...(cameraFor(meta.camera) ? { camera: cameraFor(meta.camera) } : {}),
      label: shot.id,
      note: [energyArc ? `energyArc=${energyArc}` : null, `contentHash=${contentHash}`].filter(Boolean).join('; ')
    });
    manifestShots.push({
      id: shot.id, frames: [start, end], durationSeconds: round3((end - start) / fps),
      contentHash, recipe, energyArc, audioStems, camera: cameraFor(meta.camera)
    });
  }
  const edit = {
    v: 1,
    note: options.note ?? 'Generated by vh edit from a measured scene plan. Entries are per-shot review chunks; executing a patch needs the live Cavalry bridge.',
    fps,
    size: [width, height],
    sources,
    tracks: [{ id: 'picture', entries }],
    video: {
      kind: 'refclone-vh-edit-manifest',
      version: VH_VERSION,
      energyArc: shotManifest?.energyArc ?? null,
      shots: manifestShots,
      totals: { shots: manifestShots.length, frames: totalFrames, durationSeconds: round3(totalFrames / fps) }
    }
  };
  await validateEditList(edit);
  const resolved = await resolveEditList(edit);
  const outPath = absolutePath(options.outPath ?? DEFAULT_EDIT_PATH);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await writeJsonState(outPath, edit);
  const report = {
    version: VH_VERSION, action: 'edit', path: outPath, fps, size: edit.size,
    shots: manifestShots.length, frames: resolved.frames,
    contentHashes: Object.fromEntries(manifestShots.map(shot => [shot.id, shot.contentHash]))
  };
  return { edit, resolved, path: outPath, report };
}

function keyframesFor(options, resolved) {
  if (Array.isArray(options.keyframes)) {
    const frames = [...new Set(options.keyframes.filter(frame => Number.isInteger(frame) && frame >= 0 && frame < resolved.frames))].sort((a, b) => a - b);
    if (!frames.length) fail('VH_PATCH_INVALID', 'The keyframe list has no frame inside the film.');
    return frames;
  }
  if (options.gop !== undefined) {
    const gop = Number(options.gop);
    if (!Number.isInteger(gop) || gop < 1) fail('VH_PATCH_INVALID', '--gop must be a positive integer frame count.');
    const frames = [];
    for (let frame = 0; frame < resolved.frames; frame += gop) frames.push(frame);
    return frames;
  }
  return null;
}

// The default patch window is the shot itself: refclone renders per-shot PNG
// frames, so no other shot's frames depend on it. Explicit --keyframes/--gop
// keeps the encoded-GOP semantics from vendor OpenVideoHarness patch.mjs.
async function singleShotPlan(resolved, shotId, options) {
  const target = resolved.entries.find(entry => entry.id === shotId);
  const keyframes = keyframesFor(options, resolved);
  if (keyframes) return buildPatchPlan(resolved, [shotId], { keyframes });
  const plan = {
    fps: resolved.fps,
    size: [resolved.size[0], resolved.size[1]],
    frames: resolved.frames,
    changedEntryIds: [shotId],
    windows: [{ A: target.frames[0], B: target.frames[1], entryIds: [shotId] }],
    redrawFrameCount: target.frames[1] - target.frames[0],
    keepFrameCount: resolved.frames - (target.frames[1] - target.frames[0]),
    refused: null,
    checks: { frameCountUnchanged: true, differingFramesInsideWindows: true, outsideWindowsIdentical: true }
  };
  return validateEditListShape('patchPlan', plan);
}

/**
 * Prepare a single-shot rework order. Never edits other shots and never renders.
 * @param {string} shotId edit-list entry id
 * @param {{editPath?: string, scenePlanPath?: string, stem?: 'video'|'audio'|'both', keyframes?: number[],
 *   gop?: number, projectPath?: string, outDirectory?: string}} [options]
 */
export async function patchShot(shotId, options = {}) {
  if (!isIdentifier(shotId)) fail('VH_PATCH_INVALID', 'patch needs a shot id matching ^[A-Za-z0-9_]+$.', { shotId });
  const stem = options.stem ?? 'video';
  if (!['video', 'audio', 'both'].includes(stem)) fail('VH_PATCH_INVALID', `--stem must be video, audio or both (got ${stem}).`);
  const editPath = absolutePath(options.editPath ?? DEFAULT_EDIT_PATH);
  const resolved = await resolveEditListFile(editPath);
  const target = resolved.entries.find(entry => entry.id === shotId);
  if (!target) fail('VH_PATCH_UNKNOWN_SHOT', `Shot ${shotId} is not in ${path.basename(editPath)}.`, { shotId, editPath });
  if (target.kind === 'sound') fail('VH_PATCH_INVALID', `Shot ${shotId} is a sound entry; patch picture entries instead.`, { shotId });
  const plan = await singleShotPlan(resolved, shotId, options);
  const picture = stem !== 'audio';
  const audio = stem !== 'video';
  const redrawFrameCount = picture ? plan.redrawFrameCount : 0;
  const rework = {
    version: VH_VERSION,
    shotId,
    stem,
    editPath,
    target: { entryId: shotId, frames: target.frames, start: target.start, end: target.end, kind: target.kind },
    patchPlan: plan,
    redrawFrameCount,
    keepFrameCount: resolved.frames - redrawFrameCount,
    picture,
    audio,
    unchangedEntryIds: resolved.entries.filter(entry => entry.kind !== 'sound' && entry.id !== shotId).map(entry => entry.id),
    commands: [],
    notes: [
      picture
        ? `Re-draw frames [${plan.windows.map(window => `${window.A},${window.B}`).join(')(') || 'none'}); every other shot is kept.`
        : 'Audio-only rework: no picture frame is re-drawn; re-mux the targeted stem.',
      audio ? 'Re-render or re-mux the audio stem for this shot.' : 'Picture-only: audio stems are untouched.',
      'Execution needs Cavalry 2.8.0 with the Stallion bridge enabled; vh patch itself does not open a scene or render.'
    ]
  };
  if (options.scenePlanPath) {
    const planPath = absolutePath(options.scenePlanPath);
    rework.commands.push(`node src/cli.mjs build ${planPath} --shot ${shotId}${options.projectPath ? ` --project ${absolutePath(options.projectPath)}` : ''}`);
    if (picture) {
      rework.commands.push(`node src/cli.mjs render ${planPath} --shot ${shotId}${options.projectPath ? ` --project ${absolutePath(options.projectPath)}` : ' --project <saved-scene>'}`);
    }
    // A recompiled shot gets a new content hash; update only that entry in place.
    const plan = await readJson(planPath);
    const shot = (plan.shots ?? []).find(item => item.id === shotId);
    if (!shot) fail('VH_PATCH_UNKNOWN_SHOT', `Shot ${shotId} is not in the supplied scene plan.`, { shotId, scenePlanPath: planPath });
    const hash = shotContentHash(plan, shot);
    const edit = await readJson(editPath);
    const entry = edit.tracks.flatMap(track => track.entries).find(item => item.id === shotId);
    if (entry) entry.note = mergeContentHash(entry.note, hash);
    const manifestShot = edit.video?.shots?.find(item => item.id === shotId);
    if (manifestShot) manifestShot.contentHash = hash;
    await validateEditList(edit);
    await writeJsonState(editPath, edit);
    rework.editUpdated = true;
    rework.contentHash = hash;
  } else {
    rework.editUpdated = false;
    rework.note = 'No --scene-plan supplied: the targeted entry content hash is unchanged (no new content was measured).';
  }
  const directory = absolutePath(options.outDirectory ?? path.join(ROOT, 'artifacts'));
  await fs.mkdir(directory, { recursive: true });
  const patchPath = absolutePath(path.join(directory, `patch-${shotId}.json`));
  await writeJsonState(patchPath, rework);
  return { ...rework, patchPath };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function embedImage(filmstripDirectory, shotId) {
  if (!filmstripDirectory) return null;
  let names;
  try { names = await fs.readdir(filmstripDirectory); } catch { return null; }
  const match = names.find(name => {
    const extension = path.extname(name).toLowerCase();
    return path.basename(name, extension) === shotId && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension);
  });
  if (!match) return null;
  const filePath = path.join(filmstripDirectory, match);
  const stat = await fs.stat(filePath);
  if (stat.size > 3 * 1024 * 1024) return { link: absolutePath(filePath), dataUri: null, note: 'image exceeds the 3 MB embed limit' };
  const extension = path.extname(match).toLowerCase().replace('.', '').replace('jpg', 'jpeg');
  const data = await fs.readFile(filePath);
  return { link: absolutePath(filePath), dataUri: `data:image/${extension};base64,${data.toString('base64')}`, note: null };
}

function gateByName(section, name) {
  return (section?.gates ?? []).find(gate => gate.name === name) ?? null;
}

/**
 * Build a self-contained review desk from a resolved edit list and gate report.
 * @param {{editPath?: string, gates?: object, gatesPath?: string, filmstripDirectory?: string, outPath?: string}} [options]
 */
export async function buildReviewDesk(options = {}) {
  const editPath = absolutePath(options.editPath ?? DEFAULT_EDIT_PATH);
  let edit;
  let resolved;
  try {
    edit = await readJson(editPath);
    resolved = await resolveEditListFile(editPath);
  } catch (error) {
    fail('VH_DESK_EDIT_INVALID', 'The review desk needs a resolvable edit list.', { editPath, reason: error.message });
  }
  const section = options.gates ?? (options.gatesPath ? await readJson(absolutePath(options.gatesPath)) : null);
  const metaById = new Map((edit.video?.shots ?? []).filter(item => item?.id).map(item => [item.id, item]));
  const lint = gateByName(section, 'motion-lint');
  const loopcheck = gateByName(section, 'loopcheck');
  const geometry = gateByName(section, 'geometry');
  const decisionsKey = `vh-desk:${hashObject({ edit: resolved.edit?.sha256 ?? null, frames: resolved.frames, entries: resolved.entries.map(entry => entry.id) }).slice(0, 16)}`;
  const pictureEntries = resolved.entries.filter(entry => entry.kind !== 'sound');
  const cards = [];
  for (const entry of pictureEntries) {
    const meta = metaById.get(entry.id) ?? {};
    const image = await embedImage(options.filmstripDirectory, entry.id);
    const findings = (lint?.findings ?? []).filter(finding => finding.message?.includes(entry.id));
    cards.push({ entry, meta, image, findings });
  }
  const statusClass = status => `status-${escapeHtml(String(status ?? 'not_run'))}`;
  const cardsHtml = cards.map(({ entry, meta, image, findings }) => `
    <article class="shot" data-shot="${escapeHtml(entry.id)}">
      <header>
        <h2>${escapeHtml(entry.id)}</h2>
        <span class="badge ${statusClass(lint?.status ?? 'not_run')}">lint: ${escapeHtml(lint?.status ?? 'not run')}</span>
        <span class="badge ${statusClass(loopcheck?.status ?? 'not_run')}">loop: ${escapeHtml(loopcheck?.status ?? 'not run')}</span>
      </header>
      <p class="meta">frames ${entry.frames[0]}–${entry.frames[1] - 1} · ${entry.end - entry.start}s · ${escapeHtml(entry.kind)}</p>
      <p class="meta">recipe ${escapeHtml(meta.recipe ?? 'unmeasured')} · energy arc ${escapeHtml(meta.energyArc ?? edit.video?.energyArc ?? 'unmeasured')}</p>
      <p class="meta hash">content ${escapeHtml(meta.contentHash ?? 'unmeasured')}</p>
      ${image?.dataUri ? `<img src="${image.dataUri}" alt="filmstrip for ${escapeHtml(entry.id)}">` : `<p class="meta">filmstrip ${image?.link ? escapeHtml(image.link) : 'not found'}${image?.note ? ` (${escapeHtml(image.note)})` : ''}</p>`}
      ${findings.length ? `<ul class="findings">${findings.map(finding => `<li class="${escapeHtml(finding.severity)}">${escapeHtml(finding.code)}: ${escapeHtml(finding.message)}</li>`).join('')}</ul>` : ''}
      <div class="controls" data-shot="${escapeHtml(entry.id)}">
        <button type="button" data-decision="approved">Approve</button>
        <button type="button" data-decision="rework">Rework</button>
        <output>undecided</output>
      </div>
    </article>`).join('');
  const lintRows = (lint?.findings ?? []).map(finding => `<tr><td>${escapeHtml(finding.code)}</td><td class="${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</td><td>${escapeHtml(finding.message)}</td></tr>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review desk — ${escapeHtml(path.basename(editPath))}</title>
<style>
:root { color-scheme: dark light; --bg:#101418; --panel:#182027; --ink:#e8eef5; --muted:#8fa0b3; --pass:#3ddc97; --fail:#ff6b6b; --blocked:#f0b429; --not_run:#8fa0b3; --accent:#6ea8fe; }
* { box-sizing:border-box; }
body { margin:0; padding:24px; background:var(--bg); color:var(--ink); font:15px/1.45 ui-sans-serif,system-ui,sans-serif; }
h1 { margin:0 0 4px; font-size:24px; }
.sub { color:var(--muted); margin:0 0 20px; }
.summary { display:flex; gap:12px; flex-wrap:wrap; margin:0 0 20px; }
.summary div { background:var(--panel); padding:10px 14px; border-radius:8px; }
.summary strong { display:block; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
.grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); }
.shot { background:var(--panel); border-radius:10px; padding:14px; }
.shot header { display:flex; gap:8px; align-items:center; }
.shot h2 { margin:0 auto 0 0; font-size:18px; }
.badge { font-size:12px; padding:2px 8px; border-radius:999px; background:#25313d; }
.status-pass { color:var(--pass); } .status-fail { color:var(--fail); } .status-blocked,.status-not_run { color:var(--blocked); }
.meta { color:var(--muted); font-size:13px; margin:6px 0; }
.hash { font-family:ui-monospace,monospace; font-size:11px; word-break:break-all; }
img { width:100%; border-radius:6px; margin:8px 0; background:#000; }
.findings { padding-left:18px; font-size:13px; } .findings .error { color:var(--fail); } .findings .warning { color:var(--blocked); }
.controls { display:flex; gap:8px; align-items:center; margin-top:10px; }
button { background:#24303c; color:var(--ink); border:1px solid #33414f; border-radius:6px; padding:5px 10px; cursor:pointer; }
button[data-decision="approved"].active { border-color:var(--pass); color:var(--pass); }
button[data-decision="rework"].active { border-color:var(--fail); color:var(--fail); }
output { color:var(--muted); font-size:13px; }
table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
td,th { border-bottom:1px solid #2a3540; padding:6px 8px; text-align:left; vertical-align:top; }
th { color:var(--muted); font-weight:600; }
.note { color:var(--muted); font-size:12px; margin-top:18px; }
</style>
</head>
<body>
<h1>Review desk</h1>
<p class="sub">${escapeHtml(path.basename(editPath))} · ${resolved.frames} frames @ ${resolved.fps} fps · ${resolved.entries.filter(entry => entry.kind !== 'sound').length} picture entries</p>
<div class="summary">
  <div><strong>gates</strong>${escapeHtml(section?.status ?? 'not run')}</div>
  <div><strong>lint findings</strong>${(lint?.findings ?? []).length}</div>
  <div><strong>loopcheck</strong>${escapeHtml(loopcheck?.status ?? 'not run')}</div>
  <div><strong>geometry</strong>${escapeHtml(geometry?.status ?? 'not run')}</div>
  <div><strong>slates</strong>${resolved.slates.length}</div>
</div>
<section class="grid">${cardsHtml}</section>
${lintRows ? `<h2>Static motion lint</h2><table><thead><tr><th>code</th><th>severity</th><th>message</th></tr></thead><tbody>${lintRows}</tbody></table>` : ''}
<p class="note">Approve/rework decisions stay in this browser's localStorage. This desk is generated evidence; it does not render, re-render, or approve fidelity on its own. The 20-point contact-sheet checklist and 8-dimension reviewer remain a human/agent review.</p>
<script>
const key = ${JSON.stringify(decisionsKey)};
const state = JSON.parse(localStorage.getItem(key) || '{}');
for (const controls of document.querySelectorAll('.controls')) {
  const shot = controls.dataset.shot;
  const output = controls.querySelector('output');
  const render = () => {
    const decision = state[shot] || null;
    output.textContent = decision || 'undecided';
    for (const button of controls.querySelectorAll('button')) button.classList.toggle('active', button.dataset.decision === decision);
  };
  for (const button of controls.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state[shot] = state[shot] === button.dataset.decision ? null : button.dataset.decision;
      localStorage.setItem(key, JSON.stringify(state));
      render();
    });
  }
  render();
}
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
  event.preventDefault();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'review-decisions.json';
  link.click();
  URL.revokeObjectURL(link.href);
});
</script>
</body>
</html>`;
  const outPath = absolutePath(options.outPath ?? DEFAULT_DESK_PATH);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, html, 'utf8');
  return { action: 'desk', path: outPath, shots: cards.length, gatesStatus: section?.status ?? 'not_run', decisionsKey, bytes: Buffer.byteLength(html) };
}

/** Run the vision-free gates and write the gate report (and optionally the desk). */
export async function runGate(options = {}) {
  if (!options.scenePlanPath && !options.scenePlan) fail('VH_USAGE', 'vh gate needs --scene-plan <scene-plan.json>.');
  const loopcheck = options.loopcheck ?? (options.loopcheckPath ? await readJson(absolutePath(options.loopcheckPath)) : null);
  const section = await evaluateStaticGates({
    ...(options.scenePlan ? { scenePlan: options.scenePlan } : { scenePlanPath: absolutePath(options.scenePlanPath) }),
    ...(options.geometryPath ? { geometryPath: absolutePath(options.geometryPath) } : {}),
    ...(loopcheck ? { loopcheck } : {}),
    ...(options.editPath ? { editListPath: absolutePath(options.editPath) } : {})
  });
  const outPath = absolutePath(options.outPath ?? DEFAULT_GATES_PATH);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await writeJsonState(outPath, section);
  const deskPath = options.deskPath === null ? null : absolutePath(options.deskPath ?? DEFAULT_DESK_PATH);
  const desk = deskPath && options.editPath ? await buildReviewDesk({ editPath: options.editPath, gates: section, filmstripDirectory: options.filmstripDirectory, outPath: deskPath }) : null;
  return { action: 'gate', path: outPath, status: section.status, gates: section.gates.map(gate => ({ name: gate.name, status: gate.status, findings: gate.findings.length })), desk };
}

async function appendLessons(lessonsPath, lines) {
  const target = absolutePath(lessonsPath);
  let text = '';
  try { text = await fs.readFile(target, 'utf8'); } catch { text = '# LESSONS\n'; }
  const missing = [...new Set(lines)].filter(line => !text.includes(line));
  if (!missing.length) return { path: target, added: 0 };
  if (!text.includes('## Recorded gate failures')) text = `${text.trimEnd()}\n\n## Recorded gate failures\n\n`;
  const next = `${text.trimEnd()}\n${missing.map(line => `- ${line}`).join('\n')}\n`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, next, 'utf8');
  return { path: target, added: missing.length };
}

/**
 * Run the 20-point checklist's automatic release checks. Points that cannot be
 * measured stay `review`/`not_run`; none is reported as a pass.
 */
export async function runCheck(options = {}) {
  const editPath = absolutePath(options.editPath ?? DEFAULT_EDIT_PATH);
  let resolved = null;
  let editError = null;
  try { resolved = await resolveEditListFile(editPath); }
  catch (error) { editError = { code: error.code ?? 'EDIT_INVALID', message: error.message }; }
  let plan = options.scenePlan ?? null;
  if (!plan && options.scenePlanPath) plan = await readJson(absolutePath(options.scenePlanPath));
  let section = options.gates ?? null;
  if (!section && options.gatesPath) section = await readJson(absolutePath(options.gatesPath));
  if (!section && plan) {
    section = await evaluateStaticGates({ scenePlan: plan, ...(resolved ? { editListPath: editPath } : {}) });
  }
  const checks = [];
  const add = (id, label, status, message, evidence = {}) => checks.push({ id, label, status, message, evidence });
  add('edit-resolves', 'edit list resolves', resolved ? 'pass' : 'fail',
    resolved ? `${resolved.entries.length} entries, ${resolved.frames} frames` : `edit list does not resolve: ${editError?.message}`, editError ?? {});
  add('no-slates', 'no slate placeholders in the cut', resolved ? (resolved.slates.length ? 'fail' : 'pass') : 'not_run',
    resolved ? (resolved.slates.length ? `slates remain: ${resolved.slates.join(', ')}` : 'no slate remains') : 'edit list unreadable', resolved ? { slates: resolved.slates } : {});
  if (resolved && plan) {
    const planned = Number(plan?.project?.totalFrames);
    add('frame-count', 'frame count agrees with the scene plan', planned === resolved.frames ? 'pass' : 'fail',
      `plan ${planned} vs edit ${resolved.frames}`, { planned, edited: resolved.frames });
  } else {
    add('frame-count', 'frame count agrees with the scene plan', 'not_run', 'a scene plan was not supplied');
  }
  const lint = gateByName(section, 'motion-lint');
  const lintFindings = lint?.findings ?? [];
  const byCode = prefix => lintFindings.filter(finding => String(finding.code).startsWith(prefix));
  const safeZone = byCode('LINT_SAFE_ZONE');
  add('safe-zone', 'text and cards stay inside the safe zones', lint ? (safeZone.length ? 'fail' : 'pass') : 'not_run',
    lint ? (safeZone.length ? `${safeZone.length} safe-zone finding(s)` : 'no safe-zone finding') : 'motion lint did not run',
    { findings: safeZone.map(finding => finding.code) });
  const contrast = byCode('LINT_CONTRAST');
  add('contrast', 'WCAG contrast on measured text', lint ? (contrast.length ? 'fail' : 'pass') : 'not_run',
    lint ? (contrast.length ? `${contrast.length} contrast finding(s)` : 'no contrast finding') : 'motion lint did not run');
  const overlap = [...byCode('LINT_OVERLAP'), ...byCode('LINT_OCCLUSION')];
  add('overlap', 'no unintended text/badge collisions', lint ? (overlap.length ? 'fail' : 'pass') : 'not_run',
    lint ? (overlap.length ? `${overlap.length} collision finding(s)` : 'no collision finding') : 'motion lint did not run');
  const loopcheck = gateByName(section, 'loopcheck');
  add('loop-check', 'loop seam verified for loop deliverables', loopcheck ? loopcheck.status : 'not_run',
    loopcheck ? (loopcheck.findings?.[0]?.message ?? `loop check ${loopcheck.status}`) : 'no loop check was recorded');
  add('gate-recorded', 'gate ① is on record', section?.gates?.length ? 'pass' : 'fail',
    section?.gates?.length ? `${section.gates.length} gate(s) recorded, section ${section.status}` : 'no static gate report was recorded');
  const automaticStatus = checks.some(check => check.status === 'fail')
    ? 'fail'
    : checks.some(check => check.status === 'not_run') ? 'blocked' : 'pass';
  const checklist = await readJson(TASTE_CHECKLIST_PATH).catch(() => null);
  const automationByPoint = { 3: 'safe-zone', 14: 'loop-check' };
  const points = (checklist?.points ?? []).map(point => {
    const linked = automationByPoint[point.id] ? checks.find(check => check.id === automationByPoint[point.id]) : null;
    return {
      id: point.id, category: point.category, tier: point.tier,
      automatedBy: linked?.id ?? null,
      status: linked ? linked.status : 'review',
      note: linked ? linked.message : 'not automatable here; the contact sheet and reviewer decide'
    };
  });
  const baselineFailures = points.filter(point => ['baseline', 'mixed'].includes(point.tier) && point.status === 'fail').map(point => point.id);
  const report = {
    version: VH_VERSION, action: 'check', editPath, frames: resolved?.frames ?? null,
    automaticStatus, checks, points,
    release: {
      frameCountMatches: checks.find(check => check.id === 'frame-count')?.status === 'pass',
      noSlates: checks.find(check => check.id === 'no-slates')?.status === 'pass',
      safeZoneOk: checks.find(check => check.id === 'safe-zone')?.status === 'pass',
      gatesRecorded: checks.find(check => check.id === 'gate-recorded')?.status === 'pass',
      baselineFailures,
      readyForDelivery: automaticStatus === 'pass' && baselineFailures.length === 0
    },
    reviewer: { dimensions: 8, status: 'review', protocol: 'vendor/wave2/OpenVideoHarness/TASTE_CHECKLIST.md' },
    limitations: [
      'Only the mechanical checks listed in vendor/wave2/OpenVideoHarness/CHECKLIST.md run here; composition, taste and the 8 review scores remain human/agent work.',
      'A check that could not run is reported blocked/not_run, never pass.',
      'readyForDelivery means the automatic release checks passed; it does not certify fidelity or taste.'
    ]
  };
  const outPath = absolutePath(options.outPath ?? DEFAULT_CHECK_PATH);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await writeJsonState(outPath, report);
  const failures = checks.filter(check => check.status === 'fail');
  const lessons = failures.length
    ? await appendLessons(options.lessonsPath ?? DEFAULT_LESSONS_PATH, failures.map(check => `VH_CHECK ${check.id.toUpperCase().replaceAll('-', '_')}: ${check.message} (evidence: ${path.relative(ROOT, outPath) || outPath})`))
    : { path: absolutePath(options.lessonsPath ?? DEFAULT_LESSONS_PATH), added: 0 };
  return { ...report, path: outPath, lessons };
}

function splitFlags(args, allowed, booleanFlags = new Set()) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) { positional.push(item); continue; }
    if (!allowed.includes(item) || item in flags) fail('VH_USAGE', `Invalid or repeated option: ${item}`);
    if (booleanFlags.has(item)) { flags[item] = true; continue; }
    if (!args[index + 1] || args[index + 1].startsWith('--')) fail('VH_USAGE', `Incomplete option: ${item}`);
    flags[item] = args[index + 1];
    index += 1;
  }
  return { flags, positional };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help' || args[0] === '-h') return { help: HELP, version: VH_VERSION };
  const [command, ...rest] = args;
  if (command === 'edit') {
    const { flags, positional } = splitFlags(rest, ['--scene-plan', '--out', '--shots', '--note']);
    if (positional.length) fail('VH_USAGE', `Unexpected argument: ${positional[0]}`);
    if (!flags['--scene-plan']) fail('VH_USAGE', 'vh edit needs --scene-plan <scene-plan.json>.');
    const shots = flags['--shots'] ? await readJson(absolutePath(flags['--shots'])) : null;
    const result = await buildEditManifest({
      scenePlanPath: flags['--scene-plan'], shots,
      outPath: flags['--out'] ?? DEFAULT_EDIT_PATH, note: flags['--note']
    });
    return result.report;
  }
  if (command === 'patch') {
    const { flags, positional } = splitFlags(rest, ['--edit', '--scene-plan', '--stem', '--keyframes', '--gop', '--project', '--out']);
    if (positional.length !== 1) fail('VH_USAGE', 'vh patch needs exactly one <shotId>.');
    const keyframes = flags['--keyframes'] ? JSON.parse(flags['--keyframes']) : undefined;
    return await patchShot(positional[0], {
      editPath: flags['--edit'] ?? DEFAULT_EDIT_PATH,
      scenePlanPath: flags['--scene-plan'],
      stem: flags['--stem'] ?? 'video',
      keyframes,
      gop: flags['--gop'] !== undefined ? Number(flags['--gop']) : undefined,
      projectPath: flags['--project'],
      outDirectory: flags['--out']
    });
  }
  if (command === 'desk') {
    const { flags, positional } = splitFlags(rest, ['--edit', '--gates', '--filmstrip', '--out']);
    if (positional.length) fail('VH_USAGE', `Unexpected argument: ${positional[0]}`);
    return await buildReviewDesk({
      editPath: flags['--edit'] ?? DEFAULT_EDIT_PATH,
      gatesPath: flags['--gates'],
      filmstripDirectory: flags['--filmstrip'],
      outPath: flags['--out'] ?? DEFAULT_DESK_PATH
    });
  }
  if (command === 'gate') {
    const { flags, positional } = splitFlags(rest, ['--scene-plan', '--loopcheck', '--geometry', '--edit', '--out', '--desk', '--filmstrip']);
    if (positional.length) fail('VH_USAGE', `Unexpected argument: ${positional[0]}`);
    if (!flags['--scene-plan']) fail('VH_USAGE', 'vh gate needs --scene-plan <scene-plan.json>.');
    return await runGate({
      scenePlanPath: flags['--scene-plan'], loopcheckPath: flags['--loopcheck'],
      geometryPath: flags['--geometry'], editPath: flags['--edit'], outPath: flags['--out'],
      deskPath: flags['--desk'], filmstripDirectory: flags['--filmstrip']
    });
  }
  if (command === 'check') {
    const { flags, positional } = splitFlags(rest, ['--edit', '--scene-plan', '--gates', '--out', '--lessons']);
    if (positional.length) fail('VH_USAGE', `Unexpected argument: ${positional[0]}`);
    return await runCheck({
      editPath: flags['--edit'] ?? DEFAULT_EDIT_PATH,
      scenePlanPath: flags['--scene-plan'],
      gatesPath: flags['--gates'],
      outPath: flags['--out'] ?? DEFAULT_CHECK_PATH,
      lessonsPath: flags['--lessons'] ?? DEFAULT_LESSONS_PATH
    });
  }
  fail('VH_USAGE', `Unknown command: ${command}`);
  return null;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    const payload = typeof error.toJSON === 'function' ? error.toJSON() : { code: 'VH_FAILED', message: error.message };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  });
}
