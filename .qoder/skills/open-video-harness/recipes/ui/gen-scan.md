---
id: gen-scan
name: 扫描带扫出生成的图
one_liner: 一条扫描带从上往下扫过画框，带上方是完成的图、下方还是粗像素格，进度数字跟着扫描带走、到底才说"完成"
family: ui
role: [feature]
intent: [generate, process]
energy: 3
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [photo]
sound: optional
pitfalls: [copy-drift, glow-spill]
qa: {peak: 51, settle: 102}
status: tuned
pairs_with: [answer-stream]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/image-generation-scan/README.md, license: MIT, note: 时序和禁止项（显示的完成率要和真实进度一致；完成后停住）}
sketch_sha: "47e4c4fd81b3"
---

# 扫描带扫出生成的图 · gen-scan

## 意图

讲"图正在生成、生成到哪了"：扫描带过处就是完成的部分，下面还是粗糙的像素格，进度数字和扫描带的位置是同一个数。到底了才说完成，然后停住给人看图。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–15 | 画框里是粗像素格，标题"Generating… 0%" |
| 扫 | 15–90 | 扫描带从上往下扫（入出略缓），带上方换成完成的图；百分比跟着扫描带的位置 |
| 完成 | 90–99 | 扫描带收掉，标题换成"Done" |
| 停留 | 99– | 图停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 进度数字 | 就是扫描带的位置 | 数字和扫描带对不上，观众会觉得是假的 | ★ |
| 下方 | 粗像素格（约 30 格宽）、压暗 | | |
| 扫描带 | 强调色的柔光，30–40 px | 光太亮会溢出，盖住图 | |
| 完成后 | 停住给人看图 | | |

## 声音

可以不配；配的话一个很轻的持续嗡声，到底时停。

## 风格适配

- 结构参数：扫描带分开完成和未完成、数字跟着扫描带。
- 皮肤参数：扫描带颜色、像素格大小、方向（可以从左往右）。
- 量化风格：扫描带按一拍二跳，像一行行刷新。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const IW = 900, IH = 620, IX = (W - IW) / 2, IY = 200;
  const art = lib.offscreen("gen-art", (c) => {   // a stand-in picture: swap in the real output
    const g = c.createLinearGradient(0, 0, 0, IH); g.addColorStop(0, lib.mixColor(ac, bg, 0.6)); g.addColorStop(1, lib.mixColor(ac, "#ffd9a0", 0.5)); c.fillStyle = g; c.fillRect(0, 0, IW, IH);
    c.fillStyle = "#fff3c4"; c.beginPath(); c.arc(IW * 0.68, IH * 0.4, 90, 0, lib.TAU); c.fill();
    for (let j = 0; j < 3; j++) { c.fillStyle = lib.mixColor(fg, ac, 0.25 + 0.2 * j); c.beginPath(); c.moveTo(0, IH);
      for (let x = 0; x <= IW; x += 30) c.lineTo(x, IH * (0.6 + 0.12 * j) - 50 * Math.sin(x / 160 + j * 2)); c.lineTo(IW, IH); c.fill(); }
  }, IW, IH);
  const small = lib.offscreen("gen-small", (c) => { c.drawImage(art, 0, 0, 30, 21); }, 30, 21);   // the coarse grid
  const p = lib.ease.inOutSine(lib.seg(t, 0.5, 3.0)), sy = IY + IH * p;   // the number below is this same p
  ctx.save(); ctx.beginPath(); ctx.rect(IX, sy, IW, IY + IH - sy); ctx.clip(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.6; ctx.drawImage(small, IX, IY, IW, IH); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(IX, IY, IW, sy - IY); ctx.clip(); ctx.drawImage(art, IX, IY); ctx.restore();
  const band = 1 - lib.seg(t, 3.0, 3.3);
  if (p > 0 && band > 0) { const g = ctx.createLinearGradient(0, sy - 36, 0, sy + 4); g.addColorStop(0, lib.rgba(ac, 0)); g.addColorStop(1, lib.rgba(ac, 0.55 * band));
    ctx.fillStyle = g; ctx.fillRect(IX, sy - 36, IW, 40); ctx.fillStyle = lib.rgba("#ffffff", 0.8 * band); ctx.fillRect(IX, sy - 2, IW, 3); }
  ctx.strokeStyle = lib.mixColor(bg, fg, 0.2); ctx.lineWidth = 2; ctx.strokeRect(IX, IY, IW, IH);
  lib.setFont(ctx, tokens, "display", 44, { weight: 600 }); ctx.fillStyle = fg;
  ctx.fillText(t < 3.0 ? `Generating… ${Math.round(p * 100)}%` : "Done", IX, IY - 40);
}
```

## 已知坑

- 百分比是另外编的、和扫描带不同步 → 两者用同一个进度值；接真实产品时用真实进度。
- 扫描带的光太亮，溢到图上 → 柔光只在带上方 30–40 px。
- 完成后马上切走 → 停住给人看图。

## 验收帧

- `peak`（第 51 帧）：扫描带在画框中段，上半是完成的图、下半是像素格，数字约 50%。
- `settle`（第 102 帧）：图完整，标题是"Done"。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 image-generation-scan。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；草图是本仓库写的，图是程序画的占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/image-generation-scan/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
