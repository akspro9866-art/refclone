// patch: draw some frames of a film again and put them back, without rendering the rest. For a film made by bin/vh
// render: its <film>.render.json says how (the page, fps, device pixel ratio, capture, x264 settings) and its keyframes
// fall every --gop frames, so the video can be cut on them. For each span named, the frames from the keyframe at or
// before it up to the next keyframe after it are rendered again with the same settings (tools/film/render.mjs --frames),
// the film's packets between those windows are copied as they are, all of it is joined, and the film's other tracks
// (sound, subtitles) go back on.
//
// usage: node tools/film/patch.mjs <film.mp4> --browser <chrome> (--frames a-b | --seconds s-e | --shot S04 | --chapter c2)…
//          [--sidecar f.render.json] [--page film.html] [--out f.mp4] [--in-place] [--workers 4] [--frame-timeout 120]
//          [--verify seams|full] [--min-psnr 40] [--note text] [--keep]
//        (bin/vh patch finds the browser as bin/vh render does)
//
//   --frames a-b     the film's frames a to b, both in (numbered from 0, as bin/vh check and ffmpeg count them)
//   --seconds s-e    the frames shown from s up to e seconds (frame k when s ≤ k / fps < e)
//   --shot S04,S05   the frames of these shots, from shots.json in the film's project when it has one, else the page's
//                    window.film.shots (its ids, S04a too); a shot runs from its start to its end, and on through the
//                    transition into the next shot when it has one (the old shot is drawn under it there)
//   --chapter c2     the frames of these chapters (window.film.chapters): by the page's id, the title, or the number
//                    (2 or c2, from 1); from the chapter's time to the next one's, and on through that cut's transition
//                    Each of these takes a comma list, and they can be mixed: the frames are the union of all named.
//                    Spans whose keyframe windows meet are drawn as one
//   --sidecar f      how the film was rendered: default <film>.render.json. A film that bin/vh mux put sound on keeps the
//                    render's video as it is, so the render's sidecar (out/film.mp4.render.json) describes it too
//   --page f         the page to draw: default the sidecar's
//   --out f          default <film>.patched.mp4 beside the film; --in-place replaces the film (and its sidecar) once every
//                    check has passed. Inside a project the result is a version of its film (bin/vh versions): with
//                    --in-place the film it replaces is kept in out/versions/ first (while the disk can hold it, else it
//                    goes to the Trash, said), and the record names the frames, seconds and shots changed. --in-place
//                    puts the new film in only over the film it cut: one changed meanwhile (another render, patch or
//                    bin/vh versions use) is left as it is and the new one goes beside it (exit 1). An --out inside
//                    out/versions is refused (exit 2)
//   --verify         seams (default): decode one GOP either side of the new frames in both films and compare; full: also
//                    decode the whole new film for errors (minutes for a long 4K film)
//   --min-psnr 40    the frames rendered again but outside the spans named (to the keyframes) must come back like the
//                    film's, at least this many dB: less means the page now draws them differently (an edit that reaches
//                    further than the spans, another browser), and the joins at the keyframes would show
//   --frame-timeout  seconds a frame may take to draw (default render's 120): a page whose frames are slower needs more
//   --note text      a line for this version in the project's record
//   --keep           keep the work folder (.<out>.patch/) to look at
//
// A film rendered with --motion-blur (its sidecar's motion_blur): its frames are drawn again with the same sub-frames.
// A film of an edit list (its sidecar says "kind": "edit", engines/EDIT.md): the edit list is built again first, and
// compared with the one the film was rendered from, frame by frame: the film's frame count must be the same, and every
// frame the edit list now draws otherwise (another source, an entry that moved or changed its length) must fall inside
// the frames drawn again, or the patch is refused (exit 2): a film made from two edit lists would pass every check below.
// --shot takes the entries (S03) and the shots inside a page entry (S02.S05); --chapter the edit list's chapters, else
// the pages'. The frames are drawn with the edit list as it is now; the sidecar takes its runs.
// Room: about twice the film's size free beside the output (the film is cut, joined and its tracks put back before the
// parts go). One patch of an output at a time (<out>.patch.lock), and none while bin/vh render is writing the film.
// Checks, every run: the new film has as many frames as the old one; every packet outside the frames rendered again is
// the same bytes (and decoded, the frames next to the joins are the same pixels: PSNR infinite); the joined parts decode
// without an error; the new frames' encoder setup (SPS/PPS) is the film's. Exit: 0 patched and checked · 1 a check failed
// (the new film is kept for a look as <film>.failed.mp4, or the next free .failed-2.mp4 …: an earlier one is never
// overwritten; never put in place) · 2 could not start (no sidecar, the film does not match it,
// frames outside the film, a shot or chapter the page does not have, the page does not draw). Ctrl-C stops the render
// and deletes the work folder.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { error as activityError, note as activityNote, throttled } from "./activity.mjs";   // the project's activity log (bin/vh activity)
import { commit, moveBeside, there } from "./versions.mjs";   // the project's versions (bin/vh versions)
import { findTable, readTable, tidyShots } from "./shot_source.mjs";   // the project's shot table (tools/shot_source.py's mirror)
import { frameFrom } from "./timegrid.mjs";                           // seconds to frames (tools/timegrid.py)
import { concatChunks } from "./join.mjs";                            // the pieces joined, one DTS step a frame
import { allFacts, build as buildEdit, chaptersOf, differences, editProject, shotsOf } from "./edit.mjs";   // edit lists (engines/EDIT.md)

process.stdout.on("error", (e) => { if (e.code !== "EPIPE") throw e; });
const HERE = path.dirname(new URL(import.meta.url).pathname);
const HELP = fs.readFileSync(new URL(import.meta.url), "utf8").split("\nimport ")[0].replace(/^\/\/ ?/gm, "");
const argv = process.argv.slice(2);
if (!argv.length || argv.includes("-h") || argv.includes("--help")) { process.stdout.write(HELP.trimEnd() + "\n"); process.exit(argv.length ? 0 : 2); }
const die = (msg, code = 2) => { console.error("patch: " + msg); activityError(msg); cleanUp(); process.exit(code); };
const o = { workers: 4, verify: "seams", minPsnr: 40 };
let film = null, sidecarFile = null, pageArg = null, out = null, inPlace = false, keep = false, browser = null, note = null;
const frameLists = [], secondLists = [], shotIds = [], chapterIds = [];
let work = null;
function cleanUp() { if (work && !keep) fs.rmSync(work, { recursive: true, force: true }); }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], [k, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
  const val = () => { const v = inline !== undefined ? inline : argv[++i]; if (v === undefined) die(`${k} needs a value`); return v; };
  const pair = (v, what, whole) => {
    const m = v.match(/^\s*([\d.]+)\s*[-:–]\s*([\d.]+)\s*$/);
    if (!m) die(`${what}: write it as a-b`);
    const x = [+m[1], +m[2]];
    if (!x.every(Number.isFinite) || (whole && !x.every(Number.isInteger))) die(`${what}: ${v}: ${whole ? "whole frame numbers" : "seconds"}`);
    return x;
  };
  const list = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
  if (k === "--frames") for (const v of list(val())) { const f = pair(v, k, true); if (f[1] < f[0]) die("--frames a-b with b ≥ a (both frames are in)"); frameLists.push(f); }
  else if (k === "--seconds") for (const v of list(val())) { const s = pair(v, k, false); if (!(s[1] > s[0])) die("--seconds s-e with e > s"); secondLists.push(s); }
  else if (k === "--shot") { const ids = list(val()); if (!ids.length) die(`${k} needs shot ids (S04 or S04,S05)`); shotIds.push(...ids); }
  else if (k === "--chapter") { const ids = list(val()); if (!ids.length) die(`${k} needs chapters (an id, a title, 2 or c2)`); chapterIds.push(...ids); }
  else if (k === "--sidecar") sidecarFile = val();
  else if (k === "--page") pageArg = val();
  else if (k === "--out") out = val();
  else if (k === "--in-place") inPlace = true;
  else if (k === "--keep") keep = true;
  else if (k === "--note") note = val();
  else if (k === "--workers") { o.workers = Math.floor(Number(val())); if (!(o.workers >= 1)) die("--workers: a whole number ≥ 1"); }
  else if (k === "--frame-timeout") { const v = val(); o.frameTimeout = Number(v); if (v === "" || !(o.frameTimeout >= 1)) die(`--frame-timeout: ${JSON.stringify(v)} is not a number of seconds ≥ 1`); }
  else if (k === "--verify") { o.verify = val(); if (!["seams", "full"].includes(o.verify)) die("--verify seams or full"); }
  else if (k === "--min-psnr") { o.minPsnr = Number(val()); if (!Number.isFinite(o.minPsnr)) die("--min-psnr: a number of dB"); }
  else if (k === "--browser") browser = val();
  else if (k.startsWith("-")) die(`unknown option ${k} (-h for the options)`);
  else if (film) die(`one film, got ${film} and ${a}`);
  else film = a;
}
if (!film) die("which film? (-h for the usage)");
if (!frameLists.length && !secondLists.length && !shotIds.length && !chapterIds.length) die("say which frames: --frames a-b, --seconds s-e, --shot S04 or --chapter c2");
if (!browser) die("no browser: pass --browser <chrome>, or run it as bin/vh patch");
if (inPlace && out) die("--out or --in-place, not both");
for (const tool of ["ffmpeg", "ffprobe"]) if (spawnSync(tool, ["-version"]).status !== 0) die(`${tool} is not installed`);
film = path.resolve(film);
if (!fs.existsSync(film) || !fs.statSync(film).isFile()) die(`no such film: ${film}`);
const rel = (f) => { const r = path.relative(process.cwd(), f); return r && !r.startsWith("..") ? r : f; };
const projectOf = (f) => { for (let d = path.dirname(fs.realpathSync(f)); ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, "BRIEF.md"))) return d; if (path.dirname(d) === d) return null; } };
const project = projectOf(film);
if (inPlace && project && (fs.realpathSync(film) + path.sep).startsWith(path.join(project, "out", "versions") + path.sep))
  die(`${rel(film)} is a kept version: bin/vh versions use makes it the current film first, then patch that`);

// ---- how the film was made, and does the film match it ----
sidecarFile = path.resolve(sidecarFile || film + ".render.json");
if (!fs.existsSync(sidecarFile)) die(`no ${rel(sidecarFile)}: a patch needs to know how the film was rendered, which bin/vh render writes beside it. A film bin/vh mux made from a render: --sidecar <the render>.render.json`);
let side;
try { side = JSON.parse(fs.readFileSync(sidecarFile, "utf8")); } catch (e) { die(`${rel(sidecarFile)}: ${e.message}`); }
const enc = side.encoder || {};
// a film rendered with --motion-blur: its frames drawn again with the same sub-frames (tools/film/blur.mjs)
const mb = side.motion_blur;
if (mb !== undefined && !(mb && Number.isInteger(mb.samples) && mb.samples >= 2 && mb.shutter > 0 && mb.shutter <= 1 && (mb.version === undefined || typeof mb.version === "string")))
  die(`${rel(sidecarFile)}: its motion_blur (${JSON.stringify(mb)}) is not { samples: 2 or more, shutter: more than 0, at most 1, version } as bin/vh render writes it`);
// another blur.mjs found its sub-frames' times: the frames drawn again may not be the film's (the PSNR check below says)
const blurNow = mb && mb.version ? crypto.createHash("sha256").update(fs.readFileSync(path.join(HERE, "blur.mjs"))).digest("hex") : null;
if (side.alpha) die(`${rel(film)} is a transparent film (bin/vh render --alpha, ProRes 4444): patch puts back x264 GOPs only. Render the span again with --alpha --range, or the whole film`);
for (const [k, v] of [["fps", side.fps], ["frames", side.frames], ["first_frame", side.first_frame], ["page", side.page], ["encoder.gop", enc.gop], ["encoder.crf", enc.crf], ["encoder.preset", enc.preset]])
  if (v === undefined || v === null) die(`${rel(sidecarFile)} has no ${k}: not a bin/vh render sidecar`);
const probe = (f, args) => {
  const r = spawnSync("ffprobe", ["-v", "error", ...args, "-of", "json", f], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) die(`ffprobe ${rel(f)}: ${(r.stderr || "").trim()}`);
  return JSON.parse(r.stdout || "{}");
};
const streams = (f) => probe(f, ["-show_streams", "-show_data_hash", "sha256"]).streams || [];
const filmStreams = streams(film), v = filmStreams.find((s) => s.codec_type === "video");
if (!v) die(`${rel(film)} has no video`);
const fps = side.fps, rate = v.r_frame_rate.split("/").map(Number), vfps = rate[0] / rate[1];
if (v.codec_name !== "h264") die(`${rel(film)} is ${v.codec_name}, not the H.264 bin/vh render writes`);
if (Math.abs(vfps - fps) > 1e-3) die(`${rel(film)} runs at ${vfps.toFixed(3)} fps, the sidecar says ${fps}: it is not that render's video`);
if (side.pixels && (v.width !== side.pixels[0] || v.height !== side.pixels[1])) die(`${rel(film)} is ${v.width}x${v.height}, the sidecar says ${side.pixels.join("x")}: it is not that render's video`);
// the frames in display order and which of them are keyframes (decode order differs where there are B-frames)
const pk = (f) => (probe(f, ["-select_streams", "v:0", "-show_entries", "packet=pts,flags"]).packets || []).map((p) => ({ pts: +p.pts, key: String(p.flags).includes("K") }));
const packets = pk(film), N = packets.length;
if (N !== side.frames) die(`${rel(film)} has ${N} frames, the sidecar ${side.frames}: it is not that render's video (or it was cut since)`);
const order = packets.map((p, i) => [p.pts, i]).sort((x, y) => x[0] - y[0]);
const display = new Array(N); order.forEach(([, i], d) => { display[i] = d; });
const keys = packets.map((p, i) => (p.key ? display[i] : -1)).filter((d) => d >= 0).sort((x, y) => x - y);
if (keys[0] !== 0) die(`${rel(film)} does not start on a keyframe`);
const gop = enc.gop, ff0 = side.first_frame;
// the sidecar's page is relative to the sidecar's own folder (the render's video was beside it)
const page = path.resolve(pageArg || (path.isAbsolute(side.page) ? side.page : path.join(path.dirname(sidecarFile), side.page)));
if (!fs.existsSync(page)) die(`no page at ${rel(page)} (the sidecar's; --page names another)`);
// an edit list's film: the edit list as it is now, the same length as the one the film was made from
const editRoot = side.kind === "edit" ? editProject(page) : null;
if (side.kind === "edit" && !editRoot) die(`${rel(sidecarFile)} is an edit list's film, and ${rel(page)} is not its edit.json`);
let doc = null;
if (editRoot) {
  if (!Array.isArray(side.runs) || !side.runs.length) die(`${rel(sidecarFile)} has no runs: not the sidecar of an edit list's render`);
  try { doc = buildEdit(editRoot); } catch (e) { die(`the edit list: ${e.message.replace(/^edit: /, "")}`); }
  const was = side.runs[side.runs.length - 1].frames[1];
  if (doc.fps !== fps) die(`the edit list runs at ${doc.fps} fps now, the film at ${fps}: render it again`);
  if (doc.frames !== was) die(`the edit list is ${doc.frames} frames long now, the film was made from one of ${was}: a patch keeps the film's length, so render it again (bin/vh render)`);
}

// ---- the shots and chapters, when the spans name them: the project's shot table, else the page ----
// (an edit list's film: its entries, the shots inside its pages as <entry>.<shot>, its chapters or else its pages')
const shotsJson = editRoot ? null : findTable(project);
const readShotsJson = () => { try { return readTable(shotsJson); } catch (e) { die(`${rel(shotsJson)}: ${e.message}`); } };
let table = null, tableFrom = null, chapters = null;
if (editRoot && (shotIds.length || chapterIds.length)) {
  const pages = shotIds.some((id) => id.includes(".")) || (chapterIds.length && !(doc.chapters || []).length);
  let facts = {};
  if (pages) try { facts = await allFacts(editRoot, doc, { browser, frameTimeout: o.frameTimeout }); } catch (e) { die(`reading the edit list's pages: ${e.message}`); }
  table = shotsOf(doc, facts).map(({ id, start, end }) => ({ id, start, end }));
  tableFrom = `${rel(path.join(editRoot, "edit.json"))} (its entries${pages ? " and the shots inside its pages" : ""})`;
  const cs = chaptersOf(doc, facts);
  chapters = cs.length ? cs.map((c, i) => ({ n: i + 1, t: c.t, title: c.title, id: c.id ?? null, end: i + 1 < cs.length ? cs[i + 1].t : doc.frames / fps })) : null;
  if (chapterIds.length && !chapters) die(`the edit list has no chapters (edit.json's chapters, or its pages' window.film.chapters): name the frames or the entries instead`);
} else if (shotIds.length || chapterIds.length) {
  if (shotIds.length && shotsJson) { table = readShotsJson(); tableFrom = rel(shotsJson); }
  if (!table || chapterIds.length) {   // the page, as it draws now
    const { openFilm } = await import("./host.mjs");
    let f;
    try { f = await openFilm(page, { browser, runtime: "auto", frameTimeout: o.frameTimeout }); } catch (e) { die(`reading the page's shots: ${e.message}`); }
    try {
      if (!table) { const s = await f.field("shots"); if (Array.isArray(s)) { table = tidyShots(s); tableFrom = `${rel(page)} (window.film.shots)`; } }
      const c = await f.field("chapters");
      if (Array.isArray(c)) chapters = c.filter((x) => x && Number.isFinite(+x.t)).map((x, i) => ({ n: i + 1, t: +x.t, title: String(x.title ?? ""), id: x.id != null ? String(x.id) : null })).sort((p, q) => p.t - q.t);
      if (chapters) chapters.forEach((c2, i) => { c2.n = i + 1; c2.end = i + 1 < chapters.length ? chapters[i + 1].t : f.duration; });
    } catch (e) { await f.close(); die(`reading the page's shots: ${e.message}`); }
    await f.close();
  }
  if (shotIds.length && !table) die(`no shots to find ${shotIds.join(", ")} in: no shots.json in the project, and ${rel(page)} gives no window.film.shots`);
  if (chapterIds.length && !chapters) die(`${rel(page)} gives no window.film.chapters: name the frames or the shots instead`);
}
// a shot's span runs on through the transition into the next one, which draws it underneath
const nextAfter = (t) => (table || []).find((s) => Math.abs(s.start - t) < 1e-6);
const toFrames = (s, e) => [frameFrom(s, fps) - ff0, frameFrom(e, fps) - 1 - ff0];   // page seconds → film frames
const spans = [], sources = [];
for (const f of frameLists) spans.push(f);
for (const [s, e] of secondLists) spans.push([frameFrom(s, fps), Math.min(N, frameFrom(e, fps)) - 1]);   // seconds past the end: to the last frame
for (const id of shotIds) {
  const s = table.find((x) => x.id === id);
  if (!s) die(`no shot ${id}: ${tableFrom} has ${table.map((x) => x.id).slice(0, 30).join(", ")}${table.length > 30 ? " …" : ""}`);
  const nx = nextAfter(s.end), ext = nx && nx.transition ? nx.transition : 0;
  const [a, b] = toFrames(s.start, s.end + ext);
  if (b < 0 || a > N - 1) die(`shot ${id} (${s.start.toFixed(3)}–${s.end.toFixed(3)} s) is outside this film (frames 0–${N - 1} from ${(ff0 / fps).toFixed(3)} s)`);
  spans.push([Math.max(0, a), Math.min(N - 1, b)]);
  sources.push(`${id}: ${s.start.toFixed(3)}–${(s.end + ext).toFixed(3)} s${ext ? ` (+${ext} s: ${nx.id}'s transition draws it underneath)` : ""}`);
}
for (const id of chapterIds) {
  const m = id.match(/^c?(\d+)$/i);
  const c = chapters.find((x) => x.id === id) || chapters.find((x) => x.title === id) || (m ? chapters.find((x) => x.n === +m[1]) : null);
  if (!c) die(`no chapter ${id} on the page (it has ${chapters.map((x) => `${x.n} ${x.title}`).join(", ")}: an id, a title, 2 or c2)`);
  const nx = nextAfter(c.end), ext = nx && nx.transition ? nx.transition : 0;
  const [a, b] = toFrames(c.t, c.end + ext);
  if (b < 0 || a > N - 1) die(`chapter ${id} (${c.t.toFixed(3)}–${c.end.toFixed(3)} s) is outside this film`);
  spans.push([Math.max(0, a), Math.min(N - 1, b)]);
  sources.push(`chapter ${c.n} ${c.title}: ${c.t.toFixed(3)}–${(c.end + ext).toFixed(3)} s${ext ? ` (+${ext} s: ${nx.id}'s transition)` : ""}`);
}
for (const [a, b] of spans) if (a < 0 || b >= N || b < a) die(`frames ${a}–${b}: the film has frames 0–${N - 1}`);
// the union of the spans, then the keyframe windows around them: windows that meet are drawn as one
const asked = [];
for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) { const l = asked[asked.length - 1]; if (l && a <= l[1] + 1) l[1] = Math.max(l[1], b); else asked.push([a, b]); }
const wins = [];
for (const [a, b] of asked) {
  const A = keys.filter((k) => k <= a).pop(), B = keys.find((k) => k > b) ?? N, l = wins[wins.length - 1];
  if (l && A <= l.B) { l.B = Math.max(l.B, B); l.asked.push([a, b]); } else wins.push({ A, B, asked: [[a, b]] });
}
const span = (x, y) => `${x}–${y}`, list = (xs) => xs.map(([x, y]) => span(x, y)).join(", ");
const askedList = list(asked), winList = wins.map((w) => span(w.A, w.B - 1)).join(", "), nDrawn = wins.reduce((s, w) => s + w.B - w.A, 0);
// an edit list's film: every frame the edit list now draws otherwise than the film's was drawn falls inside the windows
const drawnAbs = (f) => wins.some((w) => f >= w.A + ff0 && f < w.B + ff0);
if (editRoot) {
  const out = [];
  for (const [a, b] of differences(side.runs, doc.runs)) {
    const miss = [];
    for (let f = Math.max(a, ff0); f < Math.min(b, ff0 + N); f++) if (!drawnAbs(f)) { const l = miss[miss.length - 1]; if (l && l[1] === f - 1) l[1] = f; else miss.push([f, f]); }
    out.push(...miss);
  }
  if (out.length) {
    const who = [...new Set([...side.runs, ...doc.runs].filter((r) => out.some(([a, b]) => r.frames[0] <= b && r.frames[1] > a)).map((r) => r.entry))];
    die(`the edit list changed in ${who.join(", ")} since the film was rendered, and frames ${out.map(([a, b]) => (a === b ? `${a - ff0}` : `${a - ff0}–${b - ff0}`)).join(", ")} ` +
      `of it are outside the frames drawn again (${winList}): the film would be made of two edit lists. Name those frames too (--shot ${who.join(",")}), or render it again (bin/vh render)`);
  }
}
const outFile = inPlace ? film : path.resolve(out || path.join(path.dirname(film), `${path.basename(film, path.extname(film))}.patched${path.extname(film)}`));
if (!inPlace && outFile === film) die("--out is the film itself: use --in-place");
{   // the earlier versions in a project's out/versions are never patched over (bin/vh versions)
  let dir = path.dirname(outFile);
  try { dir = fs.realpathSync(dir); } catch { /* made later: compared as written */ }
  const proj = (() => { for (let d = dir; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, "BRIEF.md"))) return d; if (path.dirname(d) === d) return null; } })();
  if (proj && (dir + path.sep).startsWith(path.join(proj, "out", "versions") + path.sep))
    die(`${rel(outFile)} is inside out/versions, where the earlier versions of the project's films are kept: --out somewhere else (or bin/vh versions use first)`);
}
// the film as the patch reads it: with --in-place, the new one goes in only over this same file (tools/versions.py)
const filmAt = (() => { const s = fs.statSync(film); return { size: s.size, mtime: s.mtimeMs / 1000 }; })();
console.log(`patch: ${rel(film)} · ${N} frames at ${fps} fps · frames ${askedList} (${asked.map(([a, b]) => `${(a / fps).toFixed(3)}–${((b + 1) / fps).toFixed(3)}`).join(", ")} s) asked; ` +
  `${winList} drawn again (keyframe to keyframe, ${nDrawn} frames) from ${rel(page)}`);
if (shotIds.length) console.log(`  shots from ${tableFrom}`);
for (const s of sources) console.log(`  ${s}`);
if (side.patches && side.patches.length) console.log(`  patched before: ${side.patches.map((p) => `${p.frames[0]}–${p.frames[1]}`).join(", ")}`);
if (mb) console.log(`  motion blur: ${mb.samples} sub-frames a frame over a shutter of ${mb.shutter}, as the film was drawn` +
  (blurNow && blurNow !== mb.version ? "; another tools/film/blur.mjs found its sub-frames' times, so the frames drawn again may differ near cuts (the PSNR check below says)" : ""));

// ---- one patch at a time, never while a render writes the film, and room for the work ----
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const held = (f) => { try { const pid = +fs.readFileSync(f, "utf8"); return pid > 0 && alive(pid) ? pid : 0; } catch { return 0; } };
if (held(film + ".lock")) die(`bin/vh render (pid ${held(film + ".lock")}) is writing ${rel(film)}: wait for it`);
const lock = outFile + ".patch.lock";
for (let tries = 0; ; tries++) {   // taken by whoever writes it first (wx); one whose pid is gone is stale and taken over
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); break; } catch (e) { if (e.code !== "EEXIST") die(`cannot write ${rel(lock)}: ${e.message}`); }
  let pid = 0, age = 0;
  try { pid = +fs.readFileSync(lock, "utf8"); age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }   // gone meanwhile: try again
  if ((pid ? alive(pid) : age < 10000) || tries >= 4) die(`another patch${pid ? ` (pid ${pid})` : ""} is writing ${rel(outFile)}: wait for it, or delete ${rel(lock)} if it is gone`);
  try { fs.unlinkSync(lock); } catch { /* another took it over first: try again */ }
}
const unlock = () => { try { if (+fs.readFileSync(lock, "utf8") === process.pid) fs.unlinkSync(lock); } catch { /* gone */ } };
process.on("exit", unlock);
// the film's packets are written about twice over before the parts go (cut, joined, tracks put back): room for that
const filmBytes = fs.statSync(film).size;
const free = process.env.OVH_FREE_BYTES ? +process.env.OVH_FREE_BYTES : (() => { try { const st = fs.statfsSync(path.dirname(outFile)); return st.bavail * st.bsize; } catch { return Infinity; } })();
if (2.2 * filmBytes > free) die(`about ${(2.2 * filmBytes / 1e9).toFixed(1)} GB free is needed beside ${rel(outFile)} to cut and join a ${(filmBytes / 1e9).toFixed(1)} GB film; ${(free / 1e9).toFixed(1)} GB is`);

// ---- render the windows again, exactly as before ----
work = path.join(path.dirname(outFile), `.${path.basename(outFile)}.patch`);
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
let child = null, placing = false;
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(sig, () => {
  if (placing) return;   // it came during the last, synchronous step: patch's last lines have said where the new film is, and it ends as they say
  console.error(`patch: stopped (${sig}); the work folder is deleted, the film is as it was`);
  if (child) child.kill(sig);
  keep = false; cleanUp(); process.exit(code);
});
const capture = String(side.capture || "jpeg q95"), q = capture.match(/jpeg q(\d+)/);
const T0 = Date.now();
const framesToDraw = wins.reduce((n, w) => n + w.B - w.A, 0), tick = throttled(framesToDraw, "frames");
let framesDrawn = 0;
tick(framesDrawn);
// the pieces' renders: no activity lines of their own (the patch's run has its note), no versions (they are parts), and
// no "render: done" line (a piece is a step: this patch's last line is the one that says it is done)
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("OVH_ACTIVITY_"))), OVH_VERSIONS: "off", OVH_RENDER_PIECE: "1" };
const notes = [];
let pieceSide = null;
const pieceFiles = {}, pieceSides = [];
for (const [i, w] of wins.entries()) {
  w.piece = path.join(work, `piece${i}.mp4`);
  const rargs = [path.join(HERE, "render.mjs"), page, "--browser", browser, "--frames", `${ff0 + w.A}:${ff0 + w.B}`, "--fps", String(fps), "--dpr", String(side.dpr || 1),
    "--crf", String(enc.crf), "--preset", String(enc.preset), "--gop", String(gop), "--workers", String(o.workers), "--out", w.piece, "--no-estimate",
    ...(o.frameTimeout ? ["--frame-timeout", String(o.frameTimeout)] : []),
    ...(capture === "png" ? ["--png"] : ["--quality", q ? q[1] : "95"]), ...(side.real_clock ? ["--real-clock"] : []), ...(side.soft_gl ? ["--soft-gl"] : []), ...(side.kind === "hyperframes" ? ["--force"] : []),
    ...(mb ? ["--motion-blur", String(mb.samples), "--shutter", String(mb.shutter)] : [])];
  const code = await new Promise((ok) => {
    child = spawn(process.execPath, rargs, { stdio: ["ignore", "pipe", "pipe"], env });
    const show = (d) => { for (const l of String(d).split("\n").filter(Boolean)) console.log("  " + l); };
    child.stdout.on("data", show); child.stderr.on("data", show);
    child.on("close", (c, s) => ok(c ?? s));
  });
  child = null;
  if (code !== 0) die(`rendering frames ${w.A}–${w.B - 1} failed (render exit ${code}); the film is as it was`, code === 2 ? 2 : 1);
  tick(framesDrawn += w.B - w.A);
  const ps = JSON.parse(fs.readFileSync(w.piece + ".render.json", "utf8"));
  if (ps.frames !== w.B - w.A) die(`the page drew ${ps.frames} frames for ${w.A}–${w.B - 1}, not ${w.B - w.A}: it is shorter now than the film (${rel(page)}). Render the film again`, 1);
  if (side.browser && ps.browser !== side.browser && !notes.length) notes.push(`the film was rendered in ${side.browser}, these frames in ${ps.browser}: text and edges can differ a little (the PSNR below shows how much)`);
  pieceSide = pieceSide || ps;
  pieceSides.push(ps);
  Object.assign(pieceFiles, ps.files || {});   // what each piece's page loaded (bin/vh assets check reads the union)
  // the same encoder setup? Joined streams share one SPS/PPS
  const pv = streams(w.piece).find((s) => s.codec_type === "video");
  if (pv.extradata_hash !== v.extradata_hash || pv.width !== v.width || pv.height !== v.height || pv.pix_fmt !== v.pix_fmt || pv.profile !== v.profile || pv.level !== v.level)
    die(`the new frames' encoder setup is not the film's (SPS/PPS ${pv.extradata_hash === v.extradata_hash ? "same" : "differ"}, ${pv.profile}/${pv.level} vs ${v.profile}/${v.level}): ` +
      "another x264 or other settings; joining them would make a broken film. Render the film again instead", 1);
}
const failures = [];

// ---- cut the film on its keyframes, join the pieces in, put the other tracks back ----
const ff = (args, what) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) die(`${what}: ${(r.stderr || r.error || "").toString().trim()}`, 1);
  return r;
};
const cuts = [...new Set(wins.flatMap((w) => [w.A, w.B]))].filter((k) => k > 0 && k < N).sort((x, y) => x - y);
const bounds = [0, ...cuts, N];   // segment i is frames bounds[i] up to bounds[i + 1]
const parts = [];
if (cuts.length) {
  ff(["-i", film, "-map", "0:v:0", "-c", "copy", "-f", "segment", "-segment_frames", cuts.join(","), "-reset_timestamps", "1", path.join(work, "seg%d.mp4")], "cutting the film");
  const segs = fs.readdirSync(work).filter((f) => /^seg\d+\.mp4$/.test(f)).sort((x, y) => parseInt(x.slice(3)) - parseInt(y.slice(3))).map((f) => path.join(work, f));
  if (segs.length !== bounds.length - 1) die("the film did not cut on its keyframes as expected", 1);
  for (let i = 0; i + 1 < bounds.length; i++) {
    const w = wins.find((x) => x.A === bounds[i]);
    if (w) { parts.push([w.piece, w.B - w.A]); continue; }
    if (pk(segs[i]).length !== bounds[i + 1] - bounds[i]) die("the film did not cut on its keyframes as expected", 1);
    parts.push([segs[i], bounds[i + 1] - bounds[i]]);
  }
} else parts.push([wins[0].piece, N]);
// each part's length in frames: an MP4's own duration is rounded to its movie timescale (1/1000 s), which would move the
// part after it by a few ticks when a GOP is not a whole number of milliseconds (--gop 20 at 30 fps)
fs.writeFileSync(path.join(work, "list.txt"), parts.map(([f, n]) => `file '${path.basename(f)}'\nduration ${(n / fps).toFixed(9)}`).join("\n") + "\n");
const video = path.join(work, "video.mp4");
const others = filmStreams.filter((s) => s.codec_type !== "video");
{
  const r = concatChunks(path.join(work, "list.txt"), video, fps, others.length ? [] : ["-movflags", "+faststart"]);
  if (r.status !== 0) die(`joining: ${(r.stderr || r.error || "").toString().trim()}`, 1);
}
for (const f of fs.readdirSync(work)) if (/^seg\d+\.mp4$/.test(f)) fs.rmSync(path.join(work, f));   // the cut film: its packets are in video.mp4 now
const joined = path.join(work, `joined${path.extname(outFile) || ".mp4"}`);
if (others.length) {
  // the film's own sound and subtitle tracks, as they were (their language and default flags too)
  const disp = others.flatMap((s, i) => ["-disposition:" + (i + 1), Object.entries(s.disposition || {}).filter(([, x]) => x).map(([d]) => d).join("+") || "0"]);
  ff(["-i", video, "-i", film, "-map", "0:v", ...others.map((s) => ["-map", `1:${s.index}`]).flat(), "-c", "copy", "-map_metadata", "1", ...disp, "-movflags", "+faststart", joined], "putting the other tracks back");
  // the MP4 muxer switches the first subtitle track on when none is on: a film made with bin/vh mux --subs-off had them
  // all off, so clear the enabled bit of its subtitle tracks again, as bin/vh mux does
  const subs = others.filter((s) => s.codec_type === "subtitle");
  if (subs.length && subs.every((s) => !(s.disposition || {}).default)) { try { subtitlesOff(joined); } catch (e) { die(`switching the subtitle tracks off again: ${e.message}`, 1); } }
  fs.rmSync(video);
} else fs.renameSync(video, joined);

function subtitlesOff(file) {   // every subtitle trak's tkhd: flags byte 3, bit 0 (enabled) cleared, in place; only moov is read
  const fd = fs.openSync(file, "r+");
  try {
    const total = fs.fstatSync(fd).size, head = Buffer.alloc(16);
    let at = 0, moov = null;
    while (at + 8 <= total) {   // the top-level boxes, by their headers alone (a film can be far over 2 GB)
      fs.readSync(fd, head, 0, 16, at);
      let n = head.readUInt32BE(0), h = 8; const t = head.toString("latin1", 4, 8);
      if (n === 1) { n = Number(head.readBigUInt64BE(8)); h = 16; } else if (n === 0) n = total - at;
      if (n < h) break;
      if (t === "moov") { moov = [at, n]; break; }
      at += n;
    }
    if (!moov) throw new Error("no moov box");
    const b = Buffer.alloc(moov[1]); fs.readSync(fd, b, 0, moov[1], moov[0]);
    const boxes = function* (a, e) {
      while (a + 8 <= e) {
        let n = b.readUInt32BE(a), h = 8; const t = b.toString("latin1", a + 4, a + 8);
        if (n === 1) { n = Number(b.readBigUInt64BE(a + 8)); h = 16; } else if (n === 0) n = e - a;
        if (n < h) break;
        yield [t, a + h, a + n]; a += n;
      }
    };
    const [, c, e] = [...boxes(0, b.length)][0];
    for (const [tt, tc, te] of boxes(c, e)) {
      if (tt !== "trak") continue;
      const kids = Object.fromEntries([...boxes(tc, te)].map(([k, kc, ke]) => [k, [kc, ke]]));
      const hdlr = kids.mdia ? [...boxes(...kids.mdia)].find(([k]) => k === "hdlr") : null;
      const kind = hdlr ? b.toString("latin1", hdlr[1] + 8, hdlr[1] + 12) : "";
      if (kids.tkhd && ["sbtl", "subt", "text"].includes(kind)) { const i = kids.tkhd[0] + 3; b[i] &= 0xfe; fs.writeSync(fd, b, i, 1, moov[0] + i); }
    }
  } finally { fs.closeSync(fd); }
}

// ---- checks ----
const inWin = (f) => wins.some((w) => f >= w.A && f < w.B), inAsked = (f) => asked.some(([a, b]) => f >= a && f <= b);
const after = pk(joined);
if (after.length !== N) failures.push(`the new film has ${after.length} frames, not ${N}`);
const pmd5 = (f) => ff(["-i", f, "-map", "0:v:0", "-c", "copy", "-f", "framemd5", "-"], "hashing packets").stdout.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").map((x) => x.trim()));
const oldP = pmd5(film), newP = pmd5(joined);
// in decode order, the packets of each window are those of its GOPs (closed GOPs), the rest the film's
let same = 0, moved = 0;
for (let i = 0; i < N && i < newP.length; i++) {
  if (inWin(i)) continue;
  if (oldP[i][5] === newP[i][5] && oldP[i][1] === newP[i][1] && oldP[i][2] === newP[i][2]) same++; else moved++;
}
if (moved) failures.push(`${moved} packet(s) outside frames ${winList} are not the film's own (bytes or times)`);
// decoded, one GOP either side of each window: the same pixels outside them, no decode errors
const around = [];
for (const w of wins) { const w0 = Math.max(0, w.A - gop), w1 = Math.min(N, w.B + gop), l = around[around.length - 1]; if (l && w0 <= l[1]) l[1] = Math.max(l[1], w1); else around.push([w0, w1]); }
const dec = (f, w0, w1) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-ss", (w0 / fps).toFixed(6), "-i", f, "-map", "0:v:0", "-frames:v", String(w1 - w0), "-f", "framemd5", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  return { err: (r.stderr || "").trim(), md5: (r.stdout || "").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop().trim()) };
};
let pixDiff = 0, decErr = false;
for (const [w0, w1] of around) {
  const da = dec(film, w0, w1), db = dec(joined, w0, w1);
  if (db.err) { failures.push(`decoding frames ${w0}–${w1 - 1} of the new film: ${db.err.split("\n")[0]}`); decErr = true; }
  if (da.md5.length !== w1 - w0 || db.md5.length !== w1 - w0) failures.push(`decoding frames ${w0}–${w1 - 1}: got ${da.md5.length} and ${db.md5.length} frames`);
  for (let i = 0; i < Math.min(da.md5.length, db.md5.length); i++) { const f = w0 + i; if (!inWin(f) && da.md5[i] !== db.md5[i]) pixDiff++; }
}
if (pixDiff) failures.push(`${pixDiff} frame(s) next to the joins decode to other pixels than the film's`);
// PSNR per frame over each window, against the film: the frames outside the spans named must come back as they were
// (run in the work folder, so the stats file's name needs no escaping in the filter graph whatever the folders are called)
const psnr = new Map();   // film frame → dB
const psnrErr = [];
for (const w of wins) {
  const log = path.join(work, "psnr.log");
  fs.rmSync(log, { force: true });
  const r = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-ss", (w.A / fps).toFixed(6), "-i", film, "-ss", (w.A / fps).toFixed(6), "-i", joined,
    "-frames:v", String(w.B - w.A), "-lavfi", "[0:v][1:v]psnr=stats_file=psnr.log", "-f", "null", "-"], { encoding: "utf8", cwd: work });
  // the filter graph can run a frame past -frames:v, so the stats file may have one line more: lines are taken by their
  // frame number n (from 1), the first B - A of them, each once
  let got = 0;
  if (r.status === 0 && fs.existsSync(log))
    for (const l of fs.readFileSync(log, "utf8").split("\n")) {
      const n = +(l.match(/(?:^|\s)n:(\d+)/) || [])[1], m = l.match(/psnr_avg:(\S+)/);
      if (n >= 1 && n <= w.B - w.A && m && !psnr.has(w.A + n - 1)) { psnr.set(w.A + n - 1, m[1] === "inf" ? Infinity : +m[1]); got++; }
    }
  if (got < w.B - w.A) psnrErr.push(`frames ${w.A}–${w.B - 1} (ffmpeg: ${r.signal ? `stopped by ${r.signal}` : (r.stderr || "").toString().trim().split("\n")[0] || `exit ${r.status}, ${got} of ${w.B - w.A} frames`})`);
}
// the one check that sees an edit reaching past the spans: no PSNR is a failure, not a pass
if (psnrErr.length) failures.push(`the PSNR against the film could not be measured: ${psnrErr.join("; ")}`);
const kept = [...psnr].filter(([f]) => !inAsked(f)).map(([, x]) => x), askedP = [...psnr].filter(([f]) => inAsked(f)).map(([, x]) => x);
const fmt = (x) => (x === Infinity ? "∞" : x.toFixed(1));
const minKept = kept.length ? Math.min(...kept) : null;
if (minKept !== null && minKept < o.minPsnr) {
  const off = [...psnr].filter(([f, x]) => !inAsked(f) && x < o.minPsnr).map(([f]) => f).sort((x, y) => x - y);
  const runs = []; for (const f of off) { const r = runs[runs.length - 1]; if (r && f === r[1] + 1) r[1] = f; else runs.push([f, f]); }
  failures.push(`frames ${runs.map(([x, y]) => (x === y ? `${x}` : `${x}–${y}`)).join(", ")} are outside ${askedList} but come back under ${o.minPsnr} dB (lowest ${fmt(minKept)}): ` +
    "the page draws them differently now (the edit reaches beyond the frames named, a transition shows the shot, another browser), and the joins would show. Name the frames the edit really covers");
}
if (o.verify === "full") {
  const r = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-i", joined, "-map", "0:v", "-map", "0:a?", "-f", "null", "-"], { encoding: "utf8" });
  if ((r.stderr || "").trim() || r.status !== 0) failures.push(`decoding the whole new film: ${(r.stderr || "").trim().split("\n")[0] || `exit ${r.status}`}`);
}

// ---- report, sidecar, and the film in place ----
const secs2 = (Date.now() - T0) / 1000;
console.log(`  frames: ${after.length} (the film: ${N})${after.length === N ? " ✓" : " ✗"}`);
console.log(`  packets outside ${winList}: ${same} the film's own${moved ? `, ${moved} not ✗` : " ✓"}; decoded ${around.map(([x, y]) => span(x, y - 1)).join(", ")} around the joins: ${pixDiff ? `${pixDiff} frames differ ✗` : "the same pixels outside the new frames (PSNR ∞) ✓"}${decErr ? " · decode errors ✗" : ", no decode errors ✓"}`);
if (!psnrErr.length) console.log(`  against the film: frames ${askedList} ${askedP.length ? `${fmt(Math.min(...askedP))}–${fmt(Math.max(...askedP))} dB` : "—"} (what changed)` +
  (kept.length ? `; frames drawn again only to reach the keyframes at least ${fmt(minKept)} dB${minKept >= o.minPsnr ? " ✓" : " ✗"}` : ""));
if (o.verify === "full") console.log(`  the whole new film decodes${failures.some((f) => f.startsWith("decoding the whole")) ? " with errors ✗" : " without an error ✓"}`);
for (const n of notes) console.log(`  note: ${n}`);
await new Promise((r) => setImmediate(r));   // a Ctrl-C that came during the checks ends it here, the film as it was
// the shots the spans cross: shots.json when the project has one, else the page's as the pieces were drawn, else the film's
const crossTable = (() => {   // names only: a table that cannot be read names nothing
  try {
    if (!shotsJson) return tidyShots((pieceSide && pieceSide.shots) || side.shots || []);
    if (table && tableFrom === rel(shotsJson)) return table;
    return readTable(shotsJson);
  } catch { return []; }
})();
const crossed = crossTable.filter((s) => asked.some(([a, b]) => s.start < (b + 1 + ff0) / fps - 1e-9 && s.end > (a + ff0) / fps + 1e-9)).map((s) => s.id);
const at = new Date().toISOString().slice(0, 19) + "Z", browserNow = pieceSide.browser;
const records = asked.map(([a, b]) => { const w = wins.find((x) => a >= x.A && b < x.B);
  return { frames: [a, b], drawn: [w.A, w.B - 1], at, browser: browserNow, seconds: +secs2.toFixed(1), min_psnr_kept: minKept === Infinity ? "inf" : minKept }; });
const sideFor = (videoFile) => {   // as bin/vh render writes it: the page relative to the video's folder when that is inside the page's
  const dir = fs.realpathSync(path.dirname(videoFile)), real = fs.realpathSync(page), root = path.dirname(real);
  const s = { version: 1, ...side, page: (dir + path.sep).startsWith(root + path.sep) ? path.relative(dir, real) : real, patches: [...(side.patches || []), ...records] };
  for (const k of ["shots", "chapters"]) { if (pieceSide && pieceSide[k]) s[k] = pieceSide[k]; }   // the page's as it draws now
  // the film's files and the new frames' (a file drawn again: its bytes now); a film rendered before they were recorded
  // stays without (its few new frames are not the whole film's files: bin/vh assets check counts it as not known)
  if (side.files && typeof side.files === "object") s.files = { ...side.files, ...pieceFiles };
  if (editRoot && pieceSide) {   // the edit list now, and each run's chunks: the film's outside the windows, the pieces' inside
    for (const k of ["edit", "refs", "slates", "entries"]) if (pieceSide[k]) s[k] = pieceSide[k];
    const old = (side.runs || []).flatMap((r) => (r.chunks || []).filter((c) => !drawnAbs(c.frames[0])));
    const fresh = pieceSides.flatMap((ps) => (ps.runs || []).flatMap((r) => r.chunks || []));
    const filesOf = (id) => Object.assign({}, ...(side.runs || []).filter((r) => r.entry === id).map((r) => r.files || {}),
      ...pieceSides.flatMap((ps) => (ps.runs || []).filter((r) => r.entry === id).map((r) => r.files || {})));
    s.runs = pieceSide.runs.map((r) => {
      const inRun = (c) => c.frames[0] >= r.frames[0] && c.frames[1] <= r.frames[1];
      return { ...r, ...(r.draw === "page" ? { files: filesOf(r.entry) } : {}), chunks: [...old.filter(inRun), ...fresh.filter(inRun)].sort((p, q) => p.frames[0] - q.frames[0]) };
    });
  }
  return s;
};
const changed = { whole: false, frames: asked, seconds: asked.map(([a, b]) => [+(a / fps).toFixed(6), +((b + 1) / fps).toFixed(6)]),
  drawn: wins.map((w) => [w.A, w.B - 1]), shots: crossed, ...(shotIds.length || chapterIds.length ? { asked: { shots: shotIds, chapters: chapterIds } } : {}),
  ...(editRoot ? { entries: doc.runs.filter((r) => wins.some((w) => r.frames[0] < w.B + ff0 && r.frames[1] > w.A + ff0)).map((r) => r.entry) } : {}) };
const named = crossed.length ? ` (${crossed.slice(0, 6).join(", ")}${crossed.length > 6 ? " …" : ""})` : "";
if (failures.length) {
  // <film>.failed.mp4 beside the output, or the next free name (.failed-2.mp4 …): an earlier failed film is never overwritten
  const ext = path.extname(film), first = path.join(path.dirname(outFile), `${path.basename(film, ext)}.failed${ext}`);
  const kept2 = moveBeside(joined, path.join(path.dirname(outFile), path.basename(film)), "failed");
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`patch: a check failed; the film is as it was, and the new one is in ${rel(kept2)} to look at` +
    (kept2 !== first && there(first) ? ` (${rel(first)} was there already and is left as it is)` : ""));   // not when only its .render.json was
  activityNote(`frames ${askedList}${named} drawn again; a check failed, the film is as it was`, [kept2]);
  cleanUp(); process.exit(1);
}
const sideTmp = joined + ".render.json";
fs.writeFileSync(sideTmp, JSON.stringify(sideFor(outFile), null, 1) + "\n");
// the new film in place: with --in-place the film it replaces is kept as an earlier version first (tools/film/versions.mjs)
placing = true;
const ver = commit({ film: outFile, new: joined, new_sidecar: sideTmp, made_by: "patch", source: inPlace ? null : film, expect: filmAt, note, changed });
const placed = ver.placed;
const tail = (ver.id ? ` · version ${ver.id}` : "") + (ver.error ? ` · ${ver.lines[0]}` : "");
if (placed !== outFile) {   // refused, or the record step failed with the film still there: the new one is beside it
  console.log(`patch: the new film is not at ${rel(outFile)} but beside it, ${rel(placed)} (+ .render.json); ${rel(outFile)} is left as it is`);
  activityNote(`frames ${askedList}${named} drawn again; not put in place: ${ver.error}`, [placed, placed + ".render.json"]);
} else if (inPlace) {
  console.log(`patch: done in ${secs2.toFixed(0)} s · ${rel(film)} now has the new frames ${askedList}${named}; ${rel(film + ".render.json")} lists the patch`);
  activityNote(`frames ${askedList}${named} drawn again in place, in ${secs2.toFixed(0)} s${tail}`, [film, film + ".render.json"]);
} else {
  console.log(`patch: done in ${secs2.toFixed(0)} s · ${rel(placed)} (+ .render.json)${inPlace ? "" : "; the film is as it was"}`);
  activityNote(`frames ${askedList}${named} drawn again, in ${secs2.toFixed(0)} s${tail}`, [placed, placed + ".render.json"]);
}
for (const l of ver.lines) console.log(`  ${l}`);
cleanUp();
if (placed !== outFile) process.exit(1);
