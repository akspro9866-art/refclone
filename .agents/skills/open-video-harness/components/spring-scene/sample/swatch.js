// spring-scene's sample: a play button is clicked, grows into an upload card, the card settles into a done pill. The big
// one is drawn by the DOM painter (its words are real DOM text, as in a HyperFrames composition); the inset bottom right
// is the same state drawn by the canvas painter. Render: bin/vh components sample spring-scene.
import { state, dom, canvas } from "../../components/spring-scene/component.js";

const P = {
  center: [960, 520],
  SH: {
    pill: { w: 300, h: 96, r: 48, bg: "#1f6feb", cam: 1 },
    card: { w: 780, h: 380, r: 32, bg: "#161b22", cam: 1.08 },
    done: { w: 520, h: 120, r: 60, bg: "#238636", cam: 1 },
  },
  start: "pill",
  SEQ: [[1.45, "card"], [3.3, "done"]],
  intro: 0.1,
  shapePress: [1.25],
  layers: [
    { id: "play", tin: 0.1, tout: 1.38 },
    { id: "upload", tin: 1.55, tout: 3.2 },
    { id: "done", tin: 3.4 },
  ],
  cursor: { keys: [[0, 520, 330], [0.35, 520, 330], [1.15, 70, 18], [1.6, 70, 18], [2.4, 360, 260]], clicks: [1.25] },
};
const WORDS = { play: "▶  Play", upload: "Uploading the draft …", done: "✓  Uploaded" };
let els = null;

export function setup(ctx, tokens, lib) {
  const root = document.getElementById("root");
  const font = lib.fontStack(tokens, "display");
  const box = (css) => { const d = document.createElement("div"); d.style.cssText = css; return d; };
  const world = box("position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;");
  const shape = box("position:absolute;");
  world.append(shape);
  const layers = {};
  for (const L of P.layers) {
    const d = box(`position:absolute;white-space:nowrap;color:#f0f6fc;font:600 52px ${font};letter-spacing:0;`);
    d.textContent = WORDS[L.id];
    if (L.id === "upload") {
      d.style.font = `600 48px ${font}`;
      const bar = box("width:640px;height:14px;margin-top:36px;border-radius:7px;background:#30363d;overflow:hidden;");
      const fill = box("height:100%;width:62%;background:#1f6feb;border-radius:7px;");
      bar.append(fill); d.append(bar); d.dataset.fill = "";
      layers.fill = fill;
    }
    world.append(d); layers[L.id] = d;
  }
  const cursor = box("position:absolute;left:0;top:0;width:44px;height:44px;transform-origin:3px 3px;");
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M3 2 L3 20 L8 15.5 L11.5 23 L15 21.5 L11.5 14 L18 14 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  root.append(world, cursor);
  els = { world, shape, layers, cursor };
}

export function renderAt(t, ctx, tokens, lib) {
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, lib.W, lib.H);
  const g = state(P, t);
  // the upload bar fills with the card's own clock: 0 → 100 % over 1.4 s once the words are in
  els.layers.fill.style.width = `${(100 * lib.ease.outCubic(lib.seg(t, 1.7, 3.1))).toFixed(2)}%`;
  dom(els, g, P);
  // the same state through the canvas painter, at a third of the size, bottom right
  ctx.save();
  ctx.translate(1440, 830); ctx.scale(0.3, 0.3); ctx.translate(-960, -520);
  ctx.fillStyle = "#010409"; ctx.beginPath(); ctx.roundRect(160, 120, 1600, 800, 40); ctx.fill();
  canvas(ctx, g, P, (c, id) => {
    lib.setFont(c, tokens, "display", 52, { weight: 600 }); c.fillStyle = "#f0f6fc"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(WORDS[id], 0, id === "upload" ? -24 : 0);
  });
  ctx.restore();
  lib.setFont(ctx, tokens, "mono", 26); ctx.fillStyle = lib.color(tokens, "extra.2");
  ctx.fillText("DOM painter", 96, 1020); ctx.fillText("canvas painter, same state", 1350, 1020);
}
