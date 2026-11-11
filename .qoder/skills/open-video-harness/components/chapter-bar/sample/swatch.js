// chapter-bar's sample: four chapters in five seconds over a sheet of paper. The bar at the top is the DOM painter (its
// titles are DOM text, as in a HyperFrames composition); the one in the middle is the same state through the canvas
// painter. Render: bin/vh components sample chapter-bar.
import { layout, state, canvas, build, dom } from "../../components/chapter-bar/component.js";

const CH = [{ t: 0, title: "开场" }, { t: 1.25, title: "问题" }, { t: 2.5, title: "做法" }, { t: 3.75, title: "结果" }];
let P, PC, lay, layC, els;

export function setup(ctx, tokens, lib) {
  const font = lib.fontStack(tokens, "zh");
  P = { chapters: CH, end: 5, font, colors: { accent: lib.color(tokens, "accent"), dark: "27,26,23" } };
  PC = { ...P, y: 520, band: false, colors: { ...P.colors, track: "#1b1a17", fill: "#1b1a17", text: "#1b1a17", dark: "239,232,218" } };
  const m = (s, size) => { ctx.font = `600 ${size}px ${font}`; return ctx.measureText(s).width; };
  lay = layout(P, m); layC = layout(PC, m);
  els = build(document.getElementById("root"), P, lay);
}

export function renderAt(t, ctx, tokens, lib) {
  lib.paper(ctx, { tone: lib.color(tokens, "bg"), seed: 11 });
  const st = state(P, t, lay);
  // the chapter's numeral, big and quiet, so the bar has a picture under it
  lib.setFont(ctx, tokens, "display", 420, { weight: 700 }); ctx.fillStyle = lib.rgba(lib.color(tokens, "fg"), 0.07);
  ctx.textAlign = "center"; ctx.fillText(String(st.ci + 1).padStart(2, "0"), 960, 930);
  ctx.textAlign = "left";
  dom(els, st);
  canvas(ctx, state(PC, t, layC), PC);
  lib.setFont(ctx, tokens, "mono", 26); ctx.fillStyle = lib.color(tokens, "extra.1");
  ctx.fillText("DOM painter ↑", 96, 300); ctx.fillText("canvas painter, same layout ↓", 96, 470);
}
