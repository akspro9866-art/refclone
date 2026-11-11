// spring-scene — one shape that never cuts: a pill grows into a card and the card into a panel on a timetable, the content
// on it swaps in and out, the camera eases with it, a cursor clicks. The state is lib/motion.js's scene(); this file paints
// it into the DOM (HyperFrames: real text in CSS layout) or into a 2D canvas. The DOM painter follows the scene wiring of
// Barty-Bart/motion-graphics' engine/motion.js (MIT, components/NOTICE.md).
import { scene, SPRINGS } from "../lib/motion.js";
import { clamp } from "../lib/core.js";

/** The parameters (slots.json describes each): a 1920×1080 frame, a pill that becomes a card. */
export const defaults = {
  center: [960, 540],
  SH: {
    pill: { w: 320, h: 96, r: 48, bg: "#1f6feb", cam: 1 },
    card: { w: 760, h: 420, r: 36, bg: "#161b22", cam: 1.08 },
  },
  start: "pill",
  SEQ: [[1.4, "card"]],
  spring: "morph",
  camSpring: "cam",
  intro: 0.1,
  shapePress: [1.2],
  layers: [],
  cursor: null,
  domBlur: false,
};
const springOf = (s, fallback) => (Array.isArray(s) ? s : SPRINGS[s] || fallback);
const _made = new WeakMap();
/** The scene's state at t: { w, h, r, bg, s, cx, cy, fx, fy, sc, op, cursor, layers: [{ id, o, blur, s }] } (lib/motion.js scene). */
export function state(params, t) {
  let f = _made.get(params);   // the tracks are built once a params object (they depend on nothing else)
  if (!f) {
    const p = { ...defaults, ...params };
    f = scene({ ...p, spring: springOf(p.spring, SPRINGS.morph), camSpring: springOf(p.camSpring, SPRINGS.cam) });
    _made.set(params, f);
  }
  return f(t);
}

/**
 * DOM painter: els = { world, shape, layers: { id: element }, cursor }. world holds the shape and is moved and scaled
 * as the camera; each layer is centred on the shape (anchor "l"/"t" in its params puts it at the left or top edge);
 * an element is hidden while its layer is out. params.center: the camera's centre on screen.
 */
export function dom(els, g, params = defaults) {
  const [CX, CY] = params.center || defaults.center;
  if (els.world) els.world.style.transform = `translate(${(CX - g.s * g.fx).toFixed(3)}px,${(CY - g.s * g.fy).toFixed(3)}px) scale(${g.s.toFixed(5)})`;
  if (els.shape) {
    const st = els.shape.style;
    st.left = (g.cx - g.w / 2).toFixed(3) + "px"; st.top = (g.cy - g.h / 2).toFixed(3) + "px";
    st.width = g.w.toFixed(3) + "px"; st.height = g.h.toFixed(3) + "px"; st.borderRadius = g.r.toFixed(3) + "px";
    st.background = g.bg; st.transform = `scale(${g.sc.toFixed(5)})`; st.opacity = g.op.toFixed(4);
  }
  const anchors = Object.fromEntries((params.layers || []).map((L) => [L.id, L.anchor || "c"]));
  for (const L of g.layers) {
    const el = els.layers && els.layers[L.id];
    if (!el) continue;
    if (L.o < 0.002) { el.style.display = "none"; continue; }
    el.style.display = "";
    el.style.opacity = L.o.toFixed(4);
    // the swap's blur only when the page asks (params.domBlur): playbook/03 §4 animates transform, opacity and clip-path
    // in the DOM and nothing else, so by default a DOM layer swaps by opacity and scale alone
    el.style.filter = params.domBlur && L.blur > 0.05 ? `blur(${L.blur.toFixed(2)}px)` : "none";
    const an = anchors[L.id];
    el.style.left = (g.cx + (an === "l" ? -g.w / 2 : 0)).toFixed(3) + "px";
    el.style.top = (g.cy + (an === "t" ? -g.h / 2 : 0)).toFixed(3) + "px";
    el.style.transform = `${an === "c" ? "translate(-50%,-50%) " : an === "l" ? "translate(0,-50%) " : "translate(-50%,0) "}scale(${L.s.toFixed(4)})`;
  }
  if (els.cursor) {
    if (!g.cursor) els.cursor.style.display = "none";
    else {
      const sx = CX + g.s * (g.cursor.x - g.fx), sy = CY + g.s * (g.cursor.y - g.fy);
      els.cursor.style.display = "";
      els.cursor.style.transform = `translate(${(sx - 3).toFixed(2)}px,${(sy - 3).toFixed(2)}px) scale(${(1 - 0.13 * g.cursor.press).toFixed(4)})`;
    }
  }
}

/**
 * Canvas painter: the shape (a rounded rectangle) under the camera, then each layer through drawLayer(ctx, id, layer,
 * g) at the shape's centre with the layer's opacity and scale applied (its blur, in a canvas: ctx.filter), then the
 * cursor (an arrow) on top.
 */
export function canvas(ctx, g, params = defaults, drawLayer = null) {
  const [CX, CY] = params.center || defaults.center;
  ctx.save();
  ctx.translate(CX - g.s * g.fx, CY - g.s * g.fy); ctx.scale(g.s, g.s);
  ctx.save();
  ctx.translate(g.cx, g.cy); ctx.scale(g.sc, g.sc);
  ctx.globalAlpha *= clamp(g.op);
  ctx.fillStyle = g.bg; ctx.beginPath(); ctx.roundRect(-g.w / 2, -g.h / 2, g.w, g.h, g.r); ctx.fill();
  ctx.restore();
  if (drawLayer) for (const L of g.layers) {
    if (L.o < 0.002) continue;
    ctx.save();
    ctx.translate(g.cx, g.cy); ctx.scale(L.s, L.s);
    ctx.globalAlpha *= L.o;
    if (L.blur > 0.05) ctx.filter = `blur(${L.blur.toFixed(2)}px)`;
    drawLayer(ctx, L.id, L, g);
    ctx.restore();
  }
  ctx.restore();
  if (g.cursor) {
    const sx = CX + g.s * (g.cursor.x - g.fx), sy = CY + g.s * (g.cursor.y - g.fy), k = 1 - 0.13 * g.cursor.press;
    ctx.save(); ctx.translate(sx, sy); ctx.scale(k * 1.6, k * 1.6);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.lineTo(6, 17); ctx.lineTo(10, 26); ctx.lineTo(14, 24); ctx.lineTo(10, 15); ctx.lineTo(17, 15); ctx.closePath();
    ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#111"; ctx.stroke();
    ctx.restore();
  }
}
