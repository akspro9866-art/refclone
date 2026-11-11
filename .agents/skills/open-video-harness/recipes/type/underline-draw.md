---
id: underline-draw
name: 一笔画出下划线
one_liner: 关键词下面一笔画出一条略带弧度的下划线，从左到右一次画完，像有人拿笔指着它；线在字下面，不压笔画
family: type
role: [proof]
intent: [punctuate, refocus]
energy: 2
duration_f: [30, 75]
types: [short, paper, promo, handdrawn]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [overuse, sub-threshold]
qa: {peak: 21, settle: 45}
status: tuned
pairs_with: [highlight-sweep]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/underline-draw/README.md, license: MIT, note: 参数（时长、线宽、起点）和禁止项}
sketch_sha: "98f3443e7429"
---

# 一笔画出下划线 · underline-draw

## 意图

像讲的人拿笔在纸上一指：一条手写感的线从关键词下面划过去。比荧光笔轻，适合"这个词就是答案"的时刻。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 读 | 0–9 | 句子在那里 |
| 画 | 9–33 | 下划线从左往右一笔画完，起笔和收笔略慢 |
| 停留 | 33– | 线停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 时长 | 0.8 s（0.7–1.5） | 太快像闪了一下 | |
| 线宽 | 字号的 6–7%（3–8 px 对 84 px 字） | | |
| 位置 | 基线下方约字号的 18%，不碰下伸笔画 | 压在 g、p、y 上就花了 | ★ |
| 形状 | 略带弧度、收尾微微上扬 | 笔直的线像表格边框 | |

## 声音

可以不配；配的话一声笔划纸的"唰"。

## 风格适配

- 结构参数：一笔、从左往右、在字下面。
- 皮肤参数：线的颜色、粗细、手抖的程度。
- 量化风格：按一拍二画，线可以每拍抖一下（`wobblePath` 的种子跟着拍子换）。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const pre = "The answer is ", key = "fewer, longer shots", size = 92, y = 560;
  lib.setFont(ctx, tokens, "display", size, { weight: 700 });
  const w0 = ctx.measureText(pre).width, wk = ctx.measureText(key).width, x = (W - w0 - wk) / 2;
  ctx.fillStyle = fg; ctx.fillText(pre + key, x, y);
  const pts = Array.from({ length: 41 }, (_, k) => { const s = k / 40; return [x + w0 - 6 + (wk + 12) * s, y + size * 0.2 + 7 * Math.sin(s * Math.PI) - 10 * s * s]; });
  ctx.strokeStyle = ac; ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.lineJoin = "round";
  lib.strokePartial(ctx, pts, lib.ease.inOutSine(lib.seg(t, 0.3, 1.1)));   // one stroke, left to right
}
```

HyperFrames 里用一条 SVG `path`，`pathLength="1"`、`stroke-dasharray: 1`，`stroke-dashoffset` 由 t 算（不要取整，取整会一跳一跳）。

## 已知坑

- 线压在下伸笔画上 → 放到基线下方、避开 g、p、y。
- `dashoffset` 取整，线一格一格跳 → 用小数。
- 每个要点都画下划线 → 一屏一处。

## 验收帧

- `peak`（第 21 帧）：线画到关键词一半多。
- `settle`（第 45 帧）：线完整，收尾微微上扬。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 underline-draw。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；"略带弧度、收尾上扬"的线形和草图是本仓库写的。卡片注明的概念来源（MDN 的 `pathLength`、Motion、Hover、Manim 等）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/underline-draw/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
