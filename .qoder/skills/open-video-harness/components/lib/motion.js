// motion.js — springs that retarget without state, and a scene written as data: one shape whose size, corners and
// colour follow a timetable, layers that swap in and out, a camera and a cursor, all functions of t. After the engine of
// Barty-Bart/motion-graphics (skills/motion-broll/engine/motion.js, MIT; components/NOTICE.md): the closed-form spring,
// one spring per change of target, the loop's residue, the content swap, the cursor's arc and the scene as a state
// table and a timetable. Its DOM wiring is a painter here (components/spring-scene), not part of the state.
import { clamp } from "./core.js";

/** The presets: [w (rad/s), zeta]. morph for shapes, fast for UI, slow and soft for big moves, cam for the camera. */
export const SPRINGS = { morph: [15, 0.84], fast: [27, 0.86], slow: [12.5, 0.9], soft: [10, 0.95], cam: [7.5, 1], instant: [Infinity, 1] };
const easeOut3 = (x) => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
const easeInOut5 = (x) => { x = clamp(x); return x * x * x * (x * (6 * x - 15) + 10); };

/** Step response 0 → 1, tau s after the step, of a spring of natural frequency w (rad/s) and damping zeta: closed form. */
export function springStep(tau, w, z) {
  if (tau <= 0) return 0;
  if (!isFinite(w)) return 1;
  if (z < 1) { const wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + z * w / wd * Math.sin(wd * tau)); }
  if (z > 1 + 1e-6) { const q = w * Math.sqrt(z * z - 1), r1 = -z * w + q, r2 = -z * w - q; return 1 - (r2 * Math.exp(r1 * tau) - r1 * Math.exp(r2 * tau)) / (r2 - r1); }
  return 1 - Math.exp(-w * tau) * (1 + w * tau);
}
/**
 * A value that changes target many times, as the sum of one spring per change: track(v0, [[t, v, spring?], …],
 * spring = SPRINGS.morph, period = 0) → (t) => value. A key's own [w, zeta] overrides the default. With period > 0 and
 * a track that ends where it started, the previous cycle's residue is added, so t = period draws as t = 0 (a loop).
 */
export function track(v0, keys, spring = SPRINGS.morph, period = 0) {
  let prev = v0; const ks = [];
  for (const k of keys) { const d = k[1] - prev; prev = k[1]; const sp = k[2] || spring; if (d !== 0) ks.push([k[0], d, sp[0], sp[1]]); }
  const loop = period > 0 && Math.abs(prev - v0) < 1e-9;
  return (t) => {
    let v = v0;
    for (const k of ks) { v += k[1] * springStep(t - k[0], k[2], k[3]); if (loop) v += k[1] * (springStep(t + period - k[0], k[2], k[3]) - 1); }
    return v;
  };
}
const hex3 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** A colour track over "#rrggbb" keys: one track a channel → (t) => "rgb(r,g,b)". */
export function colorTrack(hex0, keys, spring = [20, 1], period = 0) {
  const c0 = hex3(hex0), tr = [0, 1, 2].map((i) => track(c0[i], keys.map((k) => [k[0], hex3(k[1])[i], k[2]]), spring, period));
  return (t) => `rgb(${tr.map((f) => Math.round(clamp(f(t), 0, 255))).join(",")})`;
}
/** The value of the latest key whose time has passed: hold(v0, [[t, v], …]) → (t) => value. */
export const hold = (v0, keys) => (t) => { let v = v0; for (const k of keys) if (t >= k[0]) v = k[1]; return v; };
/**
 * A content swap: out fast, in after a beat, so the two never overlap. swap(t, tin, tout, { din, lin, lout, blur }) →
 * { o (opacity), blur (px), s (scale), a (in, 0→1), b (out, 0→1) }. tin or tout null: always in, never out.
 */
export function swap(t, tin, tout, o = {}) {
  const din = o.din ?? 0.07, lin = o.lin ?? 0.26, lout = o.lout ?? 0.12, bl = o.blur ?? 12;
  const a = tin == null ? 1 : easeOut3((t - tin - din) / lin);
  const b = tout == null ? 0 : easeOut3((t - tout) / lout);
  return { o: a * (1 - b), blur: (1 - a) * bl + b * bl * 0.8, s: (0.94 + 0.06 * a) * (1 - 0.03 * b), a, b };
}
/** A cursor's path through keys [[t, x, y], …], eased between them on a slight arc, as a hand moves → (t) => { x, y }. */
export function cursorPath(keys) {
  return (t) => {
    if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
    const L = keys[keys.length - 1]; if (t >= L[0]) return { x: L[1], y: L[2] };
    let i = 0; while (t >= keys[i + 1][0]) i++;
    const [t0, x0, y0] = keys[i], [t1, x1, y1] = keys[i + 1];
    const u = easeInOut5((t - t0) / (t1 - t0)), dx = x1 - x0, dy = y1 - y0, arc = Math.sin(Math.PI * u) * 0.06;
    return { x: x0 + dx * u - dy * arc, y: y0 + dy * u + dx * arc };
  };
}
/** A press for each click [t] and drag [[t0, t1]]: 0 up, 1 down, sprung down fast and back with a little give → (t) => 0..1. */
export function presses(clicks = [], drags = []) {
  const k = [];
  for (const c of clicks) k.push([c - 0.07, 1, [45, 1]], [c + 0.035, 0, [22, 0.72]]);
  for (const [a, b] of drags) k.push([a - 0.04, 1, [45, 1]], [b, 0, [22, 0.72]]);
  k.sort((a, b) => a[0] - b[0]);
  return track(0, k);
}
/** When a rising f first reaches each threshold, searched every millisecond from t0 to t1 (do it once, in setup). */
export function crossTimes(f, t0, t1, ths) {
  return ths.map((th) => { for (let t = t0; t <= t1; t += 0.001) if (f(t) >= th) return t; return Infinity; });
}
/**
 * The scene's state: one shape whose size, corners, colour and camera scale follow a timetable, layers that swap in
 * and out, an optional cursor. scene({ SH: { name: { w, h, r, bg, cam } }, start, SEQ: [[t, name], …], spring,
 * camSpring, intro (s, or null for none), shapePress: [t], layers: [{ id, tin, tout, o }], cursor: { keys, clicks,
 * drags }, geom(t, g) }) → (t) => g = { t, w, h, r, bg, s (camera scale), cx, cy (the shape's centre in the world),
 * fx, fy (the camera's focus), sc (the press), op, cursor: { x, y, press } | null, layers: [{ id, o, blur, s }] }.
 * geom(t, g) may move the shape or the focus (return a changed g); the corner radius is capped at half the shape.
 */
export function scene(cfg) {
  const P0 = cfg.SH[cfg.start], SEQ = cfg.SEQ || [], sp = cfg.spring || SPRINGS.morph;
  const tr = (k) => track(P0[k], SEQ.map(([t, n]) => [t, cfg.SH[n][k]]), sp);
  const shW = tr("w"), shH = tr("h"), shR = tr("r");
  const shBG = colorTrack(P0.bg, SEQ.map(([t, n]) => [t, cfg.SH[n].bg]), [20, 1]);
  const cam = track(P0.cam ?? 1, SEQ.map(([t, n]) => [t, cfg.SH[n].cam ?? 1]), cfg.camSpring || SPRINGS.cam);
  const press = track(0, (cfg.shapePress || []).flatMap((c) => [[c - 0.07, 1, [45, 1]], [c + 0.035, 0, [22, 0.72]]]));
  const intro = cfg.intro === undefined ? 0.02 : cfg.intro;
  const cpath = cfg.cursor ? cursorPath(cfg.cursor.keys) : null, cpress = cfg.cursor ? presses(cfg.cursor.clicks, cfg.cursor.drags) : null;
  return (t) => {
    let g = { t, w: shW(t), h: shH(t), r: shR(t), bg: shBG(t), s: cam(t), cx: 0, cy: 0, fx: 0, fy: 0, sc: 1 - 0.035 * press(t), op: 1 };
    if (intro != null) { const a = springStep(t - intro, 13, 0.78); g.sc *= 0.55 + 0.45 * a; g.op = clamp((t - intro) / 0.12); }
    g.cursor = cpath ? { ...cpath(t), press: cpress(t) } : null;
    if (cfg.geom) g = cfg.geom(t, g) || g;
    g.r = Math.min(g.r, g.h / 2, g.w / 2);
    g.layers = (cfg.layers || []).map((L) => ({ id: L.id, ...swap(t, L.tin, L.tout, L.o || {}) }));
    return g;
  };
}
