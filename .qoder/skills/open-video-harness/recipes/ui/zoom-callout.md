---
id: zoom-callout
name: 小数值放进圆形放大框
one_liner: 界面上一个很小的数先被圈出来，一条线从圈引到旁边，一个圆形放大框弹出来，里面是同一个数的 4.5 倍字号和它的标签
family: ui
role: [proof]
intent: [refocus, detail, locate]
energy: 2
duration_f: [45, 120]
types: [promo, data, short, paper]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [ui-page, number]
sound: optional
pitfalls: [copy-drift, off-axis-read]
qa: {peak: 27, settle: 45}
status: tuned
pairs_with: [kpi-lift, glass-focus]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/zoom-callout/README.md, license: MIT, note: 参数（放大倍数）和禁止项（放大的数和原处一致；连线指对地方）}
sketch_sha: "5a1eba8b014f"
---

# 小数值放进圆形放大框 · zoom-callout

## 意图

一个小细节既要看清它是多少，又要看清它在整个界面的哪里：原处圈出来，放大框放在旁边，一条线连着两头。观众同时读到"位置"和"数值"。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 界面 | 0–7 | 一张候选列表，每项一个小百分比 |
| 圈 | 7–14 | 目标数值外画出一个小圈 |
| 引线 | 12–24 | 一条线从小圈画到旁边 |
| 放大框 | 18–33 | 圆形放大框从线的端点弹出来（outBack），里面是同一个数的 4.5 倍字号和它的标签 |
| 停留 | 33– | 停到读完，至少 0.5 s |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 放大倍数 | 4.5 倍字号 | | |
| 同一个数 | 放大框里的数和原处一字不差 | 原处是 62%，框里写 0.62 或 62.0%，就对不上了 | ★ |
| 连线 | 从原处的小圈连到放大框的边 | 线指错了一行，比没线还糟 | ★ |
| 放大框位置 | 原处旁边，不挡住原处 | | |

## 声音

可以不配；放大框弹出时一声很轻的"啵"。

## 风格适配

- 结构参数：小圈 → 引线 → 放大框，同一个数。
- 皮肤参数：圈和框的颜色、线的样式（实线、虚线）、框的形状。
- 量化风格：按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const rows = [["Option A", "18%"], ["Option B", "62%"], ["Option C", "20%"]], X = 260, Y = 360, RW = 600, RH = 90;
  ctx.fillStyle = lib.mixColor(bg, fg, 0.05); ctx.beginPath(); ctx.roundRect(X - 30, Y - 110, RW + 60, 3 * RH + 160, 24); ctx.fill();
  lib.setFont(ctx, tokens, "display", 36, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText("Which cut do viewers finish?", X, Y - 50);
  rows.forEach(([a, v], i) => {
    const y = Y + i * RH; lib.setFont(ctx, tokens, "display", 30, { weight: 500 }); ctx.fillStyle = fg; ctx.fillText(a, X, y + 50);
    ctx.fillStyle = lib.mixColor(bg, fg, 0.15); ctx.fillRect(X + 200, y + 34, 280, 16); ctx.fillStyle = i === 1 ? ac : lib.mixColor(fg, bg, 0.4); ctx.fillRect(X + 200, y + 34, 280 * parseInt(v) / 100, 16);
    ctx.fillStyle = fg; ctx.textAlign = "right"; ctx.fillText(v, X + RW, y + 50); ctx.textAlign = "left";
  });
  const sx = X + RW - 28, sy = Y + RH + 40, CX = 1380, CY = 480, R = 210;   // the small value's place, and the callout's
  const ring = lib.ease.outCubic(lib.seg(t, 0.25, 0.45)), line = lib.ease.inOutCubic(lib.seg(t, 0.4, 0.8)), pop = lib.ease.outBack(lib.seg(t, 0.6, 1.1));
  if (ring > 0) { ctx.strokeStyle = ac; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(sx, sy, 46 * ring, 0, lib.TAU); ctx.stroke(); }
  const a = Math.atan2(CY - sy, CX - sx), x0 = sx + 46 * Math.cos(a), y0 = sy + 46 * Math.sin(a), x1 = CX - R * Math.cos(a), y1 = CY - R * Math.sin(a);
  if (line > 0) { ctx.strokeStyle = ac; ctx.lineWidth = 4; lib.strokePartial(ctx, [[x0, y0], [x1, y1]], line); }
  if (pop > 0) {
    ctx.save(); ctx.translate(CX, CY); ctx.scale(pop, pop);
    ctx.fillStyle = bg; ctx.strokeStyle = ac; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, R, 0, lib.TAU); ctx.fill(); ctx.stroke();
    lib.setFont(ctx, tokens, "display", 30 * 4.5, { weight: 800 }); ctx.fillStyle = ac; ctx.textAlign = "center"; ctx.fillText("62%", 0, 30);   // the same number, 4.5 times the size
    lib.setFont(ctx, tokens, "display", 36, { weight: 500 }); ctx.fillStyle = fg; ctx.fillText("Option B", 0, 100); ctx.textAlign = "left"; ctx.restore();
  }
}
```

## 已知坑

- 放大框里的数和原处不一样（换了格式、换了精度）→ 一字不差。
- 连线指到别的行 → 线从原处的小圈出发。
- 放大框挡住了原处 → 放在旁边留白处。

## 验收帧

- `peak`（第 27 帧）：小圈和引线都在，放大框正在弹出。
- `settle`（第 45 帧）：放大框停住，62% 和标签读得清，连线两头都对。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 zoom-callout。文字重写；参数和禁止项沿用卡片，按 30 fps 换算；草图是本仓库写的，数字是样例。卡片注明的概念来源（Heer 和 Robertson 2007 年关于动画转场的论文、GSAP）只是手法出处。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/zoom-callout/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
