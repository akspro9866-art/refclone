---
id: glass-focus
name: 玻璃透镜扫过模糊的报表
one_liner: 一块玻璃透镜在一张整体模糊的报表上一行行移动，只有透镜里的那一行清晰、放大 1.1 倍，字的两侧各一道极淡的色散，透镜顶上一道高光、两圈边
family: ui
role: [proof, feature]
intent: [refocus, detail]
energy: 2
duration_f: [60, 150]
types: [promo, data, short]
engines: [canvas, hyperframes]
aspect: [landscape, square, portrait]
needs: [text, number]
sound: optional
pitfalls: [text-blur, sub-threshold, copy-drift]
qa: {peak: 27, read: 105}
status: tuned
pairs_with: [kpi-lift]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 14 Glass focus 的结构和时序}
sketch_sha: "519bb25a14b4"
---

# 玻璃透镜扫过模糊的报表 · glass-focus

## 意图

让人读报表或价目表里你在意的那一行：其余全部虚掉，只有透镜底下是清楚的。透镜像真玻璃：里面的字略大、两侧有极淡的色散、顶上一道高光，所以读起来是"放了一块镜片上去"，而不是"这一行变清楚了"。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 报表卡：标题清楚，五行标签和数值整体模糊；透镜停在第一行 |
| 移一格 | 9–30 | 透镜移到第二行（入出都缓），停下 |
| 扫读 | 48–90 | 透镜往下扫到最后一行 |
| 回来 | 102–138 | 再回到第二行，停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 只有透镜里清楚 | 其余模糊 6–8 px | 模糊太轻，透镜没有意义；太重，看不出是一张报表 | ★ |
| 放大 | 1.1 倍，围着透镜中心 | 再大像放大镜道具 | |
| 色散 | 两道彩色副本，各偏 0.5–1 px、35% 不透明 | 偏太多字就花了 | |
| 停在要讲的那一行 | 最后停的那一行就是要说的数 | 扫来扫去不停，观众不知道该读哪行 | ★ |

## 声音

可以不配；透镜停下时一声很轻的玻璃 tick。

## 风格适配

- 结构参数：整体模糊、透镜里清楚放大、停在要讲的那一行。
- 皮肤参数：透镜的圆角、边和高光、报表的样子。
- 量化风格：透镜按一拍二移动，模糊不变。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg");
  const muted = lib.mixColor(fg, bg, 0.45), io = lib.ease.inOutCubic;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const CX = 560, CY = 120, CW = 800, rows = [["Reach", "1.42M"], ["Clicks", "38,910"], ["Signups", "12,480"], ["Cost per signup", "$2.18"], ["Return", "4.6×"]];
  const RY = (i) => CY + 250 + i * 140;
  ctx.fillStyle = lib.mixColor(bg, fg, 0.05); ctx.beginPath(); ctx.roundRect(CX, CY, CW, 900, 28); ctx.fill();
  lib.setFont(ctx, tokens, "display", 54, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText("Campaign report", CX + 56, CY + 104);
  const drawRows = (c, col) => rows.forEach(([l, v], i) => {
    lib.setFont(c, tokens, "display", 44, { weight: 500 }); c.fillStyle = col || muted; c.fillText(l, CX + 56, RY(i) + 16);
    lib.setFont(c, tokens, "display", 48, { weight: 700 }); c.fillStyle = col || fg; c.textAlign = "right"; c.fillText(v, CX + CW - 56, RY(i) + 16); c.textAlign = "left";
  });
  const sharp = lib.offscreen("glass-rows", (c) => drawRows(c));
  ctx.filter = "blur(7px)"; ctx.drawImage(sharp, 0, 0); ctx.filter = "none";
  const r = io(lib.seg(t, 0.3, 1.0)) + 3 * io(lib.seg(t, 1.6, 3.0)) - 3 * io(lib.seg(t, 3.4, 4.6));   // row 0 → 1, then down to 4 and back to 1
  const ly = RY(0) + r * 140, lx = CX + 20, lw = CW - 40, lh = 120, top = ly - lh / 2, lcx = CX + CW / 2;
  ctx.save(); ctx.beginPath(); ctx.roundRect(lx, top, lw, lh, 24); ctx.clip();
  ctx.fillStyle = lib.mixColor(bg, fg, 0.02); ctx.fillRect(lx, top, lw, lh);
  ctx.translate(lcx, ly); ctx.scale(1.1, 1.1); ctx.translate(-lcx, -ly);   // only the text under the glass is sharp, a little larger
  ctx.globalAlpha = 0.35; ctx.translate(-0.8, 0); drawRows(ctx, "#00a6c8"); ctx.translate(1.6, 0); drawRows(ctx, "#ff4d6d"); ctx.translate(-0.8, 0);
  ctx.globalAlpha = 1; drawRows(ctx); ctx.restore();
  const hi = ctx.createLinearGradient(0, top, 0, top + 44); hi.addColorStop(0, "rgba(255,255,255,0.55)"); hi.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hi; ctx.beginPath(); ctx.roundRect(lx + 8, top + 5, lw - 16, 40, 18); ctx.fill();
  ctx.strokeStyle = lib.rgba(fg, 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(lx, top, lw, lh, 24); ctx.stroke();   // a double rim
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); ctx.roundRect(lx + 4, top + 4, lw - 8, lh - 8, 20); ctx.stroke();
}
```

HyperFrames 里报表是一层 DOM，加 `filter: blur(7px)`；透镜里放同一份报表的副本，用 `clip-path` 裁成透镜的形状、`transform: scale(1.1)`，位置由 t 算。

## 已知坑

- 透镜里的字和外面的字对不齐（放大没围着透镜中心）→ 围着透镜中心缩放。
- 色散偏太多，字反而花 → 每侧不超过 1 px、不透明度 35% 以内。
- 模糊的部分里有要读的东西 → 要读的只放在透镜停的地方。

## 验收帧

- `peak`（第 27 帧）：透镜在第一行到第二行之间，两行各露一半清楚的。
- `read`（第 105 帧）：透镜在回程途中，经过的那一行清楚、略大，其余模糊。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 14 "Glass focus"。文字重写；时序从 8 s 循环改成移一格、扫一个来回、停住，按 30 fps 换算；HyperFrames 的写法是本仓库加的；草图是本仓库写的灰盒，数是样例。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
