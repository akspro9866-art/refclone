// build-up's sample: two builds side by side with the canvas painter. Left, a tower of six floors, by height a floor at
// a time (bucket = a floor), each brick rising with a little jitter; right, a stepped block by distance from its near
// corner, each piece dropping in. Render: bin/vh components sample build-up.
import { state, canvas, duration } from "../../components/build-up/component.js";

const tower = [], steps = [];
for (let f = 0; f < 6; f++) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++)
  tower.push({ x: i - 1, y: f + 0.45, z: k - 1, w: 0.94, h: 0.9, d: 0.94, color: f % 2 ? "#c8643c" : "#d77a4e" });
for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) for (let h = 0; h < 5 - Math.max(i, k); h++)
  steps.push({ x: i - 2, y: h + 0.5, z: k - 2, w: 0.96, h: 0.96, d: 0.96, color: (i + k + h) % 2 ? "#4f8fb0" : "#62a3c2" });
const T = { pieces: tower, order: "height", bucket: 1, start: 0.25, stagger: 0.55, jitter: 0.18, dur: 0.6, appear: "rise", lift: 1.4, seed: 7 };
const S = { pieces: steps, order: "distance", from: [-2, 0, -2], bucket: 1, start: 0.4, stagger: 0.45, dur: 0.5, appear: "drop", lift: 2.2, ease: "outBack" };
const VT = { origin: [600, 790], scale: 82 }, VS = { origin: [1350, 760], scale: 76 };

export function renderAt(t, ctx, tokens, lib) {
  const bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), soft = lib.color(tokens, "extra.0");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, lib.W, lib.H);
  ctx.strokeStyle = lib.rgba(fg, 0.12); ctx.lineWidth = 2;   // the ground lines under each build
  for (const v of [VT, VS]) { ctx.beginPath(); ctx.moveTo(v.origin[0] - 380, v.origin[1] + 170); ctx.lineTo(v.origin[0] + 380, v.origin[1] + 170); ctx.stroke(); }
  canvas(ctx, state(T, t), T, VT);
  canvas(ctx, state(S, t), S, VS);
  lib.setFont(ctx, tokens, "display", 46, { weight: 600 }); ctx.fillStyle = soft; ctx.textAlign = "center";
  ctx.fillText(`height · rise · ${duration(T).toFixed(1)} s`, VT.origin[0], 1010);
  ctx.fillText(`distance · drop · ${duration(S).toFixed(1)} s`, VS.origin[0], 1010);
  ctx.textAlign = "left";
}
