---
id: swipe-reveal
name: 横滑露出操作
one_liner: 列表里一行被手指往左推开，底下露出两个操作按钮（归档、删除），停住让人看清，然后行回弹盖上；手势的方向和藏着的操作一起讲清楚
family: ui
role: [feature]
intent: [interact, detail]
energy: 2
duration_f: [45, 105]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [portrait, landscape, square]
needs: [ui-element, text]
sound: optional
pitfalls: [fake-ui, too-fast]
qa: {peak: 21, settle: 105}
status: tuned
pairs_with: [drag-drop]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/swipe-action-reveal/README.md, license: MIT, note: 时序和禁止项（不用动画假装执行了删除；停住给读的时间）}
sketch_sha: "a8e88c64cec0"
---

# 横滑露出操作 · swipe-reveal

## 意图

讲手机界面里"藏着的操作"：一行往左滑开，底下的按钮露出来。观众同时学会两件事：手势往哪滑、滑出来能做什么。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 指 | 0–12 | 触点（一个圆）落在第二行右侧 |
| 滑开 | 12–27 | 行跟着触点往左移 260 px（outCubic），底下露出"归档""删除"两个按钮 |
| 停 | 27–75 | 停住，按钮读得清 |
| 回 | 75–93 | 触点离开，行按弹簧回弹盖上 |
| 停留 | 93– | |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 滑开距离 | 正好露出按钮的宽度 | 滑太远像要把行扔掉 | |
| 停住 | ≥ 1.2 s | 一滑就回，看不清按钮 | ★ |
| 删除 | 只露出按钮，不演"删掉了" | 用动画假装执行了删除，是在演产品没做的事 | ★ |
| 回弹 | 弹簧，略欠阻尼 | | |

## 声音

可以不配。

## 风格适配

- 结构参数：触点跟着行、露出按钮、停住、回弹。
- 皮肤参数：行和按钮的样式、触点的样子。
- 量化风格：滑动按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const X = 610, Wd = 700, RH = 130, rows = [["Weekly digest", "Draft · 2 min"], ["Launch teaser", "Rendered · 0:15"], ["Paper talk", "Storyboard"], ["Year in review", "Brief"]];
  ctx.fillStyle = lib.mixColor(bg, fg, 0.04); ctx.beginPath(); ctx.roundRect(X - 20, 160, Wd + 40, 4 * RH + 60, 36); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.roundRect(X - 20, 160, Wd + 40, 4 * RH + 60, 36); ctx.clip();   // the screen's edge clips the row
  const open = lib.ease.outCubic(lib.seg(t, 0.4, 0.9)), back = lib.spring(t - 2.5, { w: 14, zeta: 0.65 }), dx = -260 * open * (1 - back);
  rows.forEach(([a, b], i) => {
    const y = 190 + i * RH, sw = i === 1 ? dx : 0;
    if (i === 1) {   // the actions under the row
      ctx.fillStyle = lib.mixColor(bg, fg, 0.35); ctx.fillRect(X + Wd - 260, y, 130, RH - 10); ctx.fillStyle = ac; ctx.fillRect(X + Wd - 130, y, 130, RH - 10);
      lib.setFont(ctx, tokens, "display", 30, { weight: 600 }); ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
      ctx.fillText("Archive", X + Wd - 195, y + 70); ctx.fillText("Delete", X + Wd - 65, y + 70); ctx.textAlign = "left";
    }
    ctx.fillStyle = lib.mixColor(bg, fg, 0.04); ctx.fillRect(X + sw, y, Wd, RH - 10);
    ctx.fillStyle = lib.mixColor(ac, bg, 0.5 + 0.1 * i); ctx.beginPath(); ctx.roundRect(X + sw + 20, y + 22, 76, 76, 16); ctx.fill();
    lib.setFont(ctx, tokens, "display", 42, { weight: 600 }); ctx.fillStyle = fg; ctx.fillText(a, X + sw + 120, y + 58);
    lib.setFont(ctx, tokens, "display", 30, { weight: 400 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.45); ctx.fillText(b, X + sw + 120, y + 98);
  });
  ctx.restore();
  const touch = lib.seg(t, 0.25, 0.4) * (1 - lib.seg(t, 2.4, 2.55));   // the finger
  if (touch > 0) { ctx.fillStyle = lib.rgba(fg, 0.25 * touch); ctx.beginPath(); ctx.arc(X + Wd - 120 + dx, 190 + RH + 60, 46, 0, lib.TAU); ctx.fill(); }
}
```

## 已知坑

- 一滑就回 → 停住 1.2 s 以上。
- 演出"删掉了"的结果，而片子讲的是手势 → 只露出操作。
- 竖屏里行太窄，按钮字挤 → 按钮至少 120 px 宽。

## 验收帧

- `peak`（第 21 帧）：行滑开了一大半，两个按钮露出来。
- `settle`（第 105 帧）：行回弹盖好，列表恢复。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 swipe-action-reveal。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；草图是本仓库写的，列表文字是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/swipe-action-reveal/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
