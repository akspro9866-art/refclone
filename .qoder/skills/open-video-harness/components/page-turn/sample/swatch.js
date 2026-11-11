// page-turn's sample: three pages of a year book (a hand-drawn page, a halftone print, a photo with grain), turned
// forward twice. Render: bin/vh components sample page-turn.
import { state, canvas } from "../../components/page-turn/component.js";

const PAGES = [
  { year: "1926", zh: "手绘", tone: "#efe8da" },
  { year: "1966", zh: "版画", tone: "#e9dcc2" },
  { year: "2006", zh: "照片", tone: "#e3e6e8" },
];
const TURNS = [[0.9, 2.0], [3.0, 4.1]];

function drawPage(x, i, t, tokens, lib) {
  const P = PAGES[i], ink = lib.color(tokens, "fg"), accent = lib.color(tokens, "accent");
  lib.paper(x, { tone: P.tone, seed: 20 + i });
  x.strokeStyle = lib.rgba(ink, 0.25); x.lineWidth = 2; x.beginPath(); x.moveTo(960, 60); x.lineTo(960, 1020); x.stroke();   // the spine
  // the left page: the year; the right page: a picture in that page's medium
  lib.setFont(x, tokens, "display", 230, { weight: 700 }); x.fillStyle = ink; x.textAlign = "center"; x.fillText(P.year, 480, 600);
  lib.setFont(x, tokens, "zh", 72, { weight: 600 }); x.fillStyle = accent; x.fillText(P.zh, 480, 720);
  x.textAlign = "left";
  if (i === 0) {
    x.strokeStyle = ink; x.lineWidth = 5; x.lineJoin = "round";
    for (let k = 0; k < 5; k++) {
      lib.wobblePath(x, [[1130, 360 + k * 90], [1450, 300 + k * 95], [1760, 380 + k * 80]], { amp: 4, seed: k * 7 + lib.step(t, 8) * 13 });
      x.stroke();
    }
  } else if (i === 1) {
    lib.halftone(x, (px, py) => 1 - Math.hypot(px - 1440, py - 540) / 330, { cell: 18, color: ink, rect: { x: 1100, y: 200, w: 680, h: 680 } });
  } else {
    x.fillStyle = "#2b2a26"; x.fillRect(1120, 240, 640, 480);
    x.fillStyle = "#d9d4c7"; x.beginPath(); x.arc(1440, 470, 120, 0, Math.PI * 2); x.fill();
    lib.grain(x, t, { amount: 0.18 });
  }
}

export function renderAt(t, ctx, tokens, lib) {
  let i = 0, turn = null;
  for (const [k, [a, b]] of TURNS.entries()) { if (t >= b) i = k + 1; else if (t >= a) { turn = { k, u: lib.seg(t, a, b) }; break; } }
  if (!turn) { drawPage(ctx, i, t, tokens, lib); return; }
  const A = lib.offscreen("pt_a", (x) => drawPage(x, turn.k, t, tokens, lib)), B = lib.offscreen("pt_b", (x) => drawPage(x, turn.k + 1, t, tokens, lib));
  ctx.fillStyle = "#1b1a17"; ctx.fillRect(0, 0, lib.W, lib.H);
  canvas(ctx, state({}, turn.u), A, B);
}
