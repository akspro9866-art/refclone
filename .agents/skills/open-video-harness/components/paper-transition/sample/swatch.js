// paper-transition's sample: a sheet folds away like a panel onto the next one, then ink spreads over that one and opens
// onto a third. Render: bin/vh components sample paper-transition.
import { state, canvas } from "../../components/paper-transition/component.js";

const SHEETS = [
  { title: "折页", sub: "fold", tone: "#efe8da" },
  { title: "墨晕", sub: "blot", tone: "#e6ddca" },
  { title: "下一页", sub: "next", tone: "#dde3e5" },
];
const SEAMS = [{ a: 0.8, b: 1.65, variant: "fold" }, { a: 2.7, b: 3.9, variant: "blot" }];

function drawSheet(x, i, tokens, lib) {
  const S = SHEETS[i], ink = lib.color(tokens, "fg");
  lib.paper(x, { tone: S.tone, seed: 40 + i });
  lib.setFont(x, tokens, "zh", 200, { weight: 600 }); x.fillStyle = ink; x.textAlign = "center"; x.fillText(S.title, 960, 560);
  lib.setFont(x, tokens, "display", 64, { weight: 500 }); x.fillStyle = lib.color(tokens, "extra.1"); x.fillText(S.sub, 960, 680);
  x.strokeStyle = lib.rgba(ink, 0.35); x.lineWidth = 3; x.strokeRect(160, 120, 1600, 840);
  x.textAlign = "left";
}

export function renderAt(t, ctx, tokens, lib) {
  let i = 0, seam = null;
  for (const [k, s] of SEAMS.entries()) { if (t >= s.b) i = k + 1; else if (t >= s.a) { seam = { k, s, u: lib.seg(t, s.a, s.b) }; break; } }
  if (!seam) { drawSheet(ctx, i, tokens, lib); return; }
  const A = lib.offscreen("ptr_a", (x) => drawSheet(x, seam.k, tokens, lib)), B = lib.offscreen("ptr_b", (x) => drawSheet(x, seam.k + 1, tokens, lib));
  const P = { variant: seam.s.variant };
  canvas(ctx, state(P, seam.u), A, B, P);
}
