---
id: hold-confirm
name: 按住确认
one_liner: 按住按钮时一层填充从左往右涨，第一次中途松手，填充退回去；第二次按满，按钮才换成完成的勾；"刻意的等待"就这样被看见
family: ui
role: [feature]
intent: [interact, promise]
energy: 2
duration_f: [60, 120]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element]
sound: optional
pitfalls: [fake-ui, too-fast]
qa: {peak: 66, settle: 99}
status: tuned
pairs_with: [error-shake]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/hold-to-confirm/README.md, license: MIT, note: 时序和禁止项（中途松手不能显示完成；完成后停住）}
sketch_sha: "00e544009e0b"
---

# 按住确认 · hold-confirm

## 意图

讲一个"要想清楚再做"的操作：删除、发布、付款前的确认。按住的时间就是犹豫的时间，填充把它画出来。中途松手要退回去，否则观众会以为按一下就完成了。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 第一次按 | 9–27 | 按住，填充从左往右涨到约 40% |
| 松手 | 27–36 | 松开，填充退回 0 |
| 第二次按 | 45–81 | 再按住，填充匀速涨满（1.2 s） |
| 完成 | 81–93 | 文字和图标换成完成的勾，按钮颜色换成完成色 |
| 停留 | 93– | |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 填满时长 | 1.2 s（0.8–1.5），匀速 | 太快就不是"按住"了 | |
| 中途松手 | 填充退回，不显示完成 | 松手也完成，就是在演一个不存在的功能 | ★ |
| 完成 | 填满那一刻换勾 | 提前换勾 | ★ |
| 按下反馈 | 按住时按钮缩到 0.98 | | |

## 声音

按住期间一个缓慢上升的音，满了一声"叮"；中途松手音停。

## 风格适配

- 结构参数：按住涨、松手退、满了才完成。
- 皮肤参数：按钮形状、填充颜色、勾的样子。
- 量化风格：填充按一拍二涨。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const press1 = lib.seg(t, 0.3, 0.9) * 0.4 * (1 - lib.ease.outCubic(lib.seg(t, 0.9, 1.2)));   // let go early: it drains back
  const press2 = lib.seg(t, 1.5, 2.7), fill = Math.max(press1, press2), done = lib.ease.outCubic(lib.seg(t, 2.7, 3.1));
  const held = (t > 0.3 && t < 0.9) || (t > 1.5 && t < 2.7), k = held ? 0.98 : 1;
  const BW = 640, BH = 130, X = (W - BW) / 2, Y = (H - BH) / 2;
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2);
  ctx.beginPath(); ctx.roundRect(X, Y, BW, BH, BH / 2); ctx.clip();
  ctx.fillStyle = lib.mixColor(bg, fg, 0.1); ctx.fillRect(X, Y, BW, BH);
  ctx.fillStyle = lib.mixColor(ac, fg, 0.15 * done); ctx.fillRect(X, Y, BW * Math.max(fill, done), BH);   // the fill is the waiting, drawn
  lib.setFont(ctx, tokens, "display", 46, { weight: 700 }); ctx.textAlign = "center";
  const fx = X + BW * Math.max(fill, done);   // the label is light over the fill and dark beyond it, glyph by glyph
  for (const [c, a, b] of [[bg, X, fx], [fg, fx, X + BW]]) { ctx.save(); ctx.beginPath(); ctx.rect(a, Y, b - a, BH); ctx.clip(); ctx.globalAlpha = 1 - done; ctx.fillStyle = c; ctx.fillText("Hold to publish", W / 2, Y + 82); ctx.restore(); }
  ctx.globalAlpha = done; ctx.fillStyle = bg; ctx.fillText("Published", W / 2 + 30, Y + 82); ctx.globalAlpha = 1; ctx.textAlign = "left";
  if (done > 0) { ctx.strokeStyle = bg; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.lineJoin = "round";
    lib.strokePartial(ctx, [[X + 150, Y + 66], [X + 172, Y + 88], [X + 210, Y + 46]], done); }
  ctx.restore();
  if (held) { ctx.fillStyle = lib.rgba(fg, 0.22); ctx.beginPath(); ctx.arc(X + BW - 120, Y + BH / 2, 44, 0, lib.TAU); ctx.fill(); }   // the finger
}
```

## 已知坑

- 中途松手也显示完成 → 退回去，满了才完成。
- 填充加速、减速 → 按住的时间是匀速走的。
- 完成后立刻切走 → 停住给读的时间。
- 填充过半时字一下整体反白，一半字落在浅底上读不清 → 按填充的边界裁开，填充上的字是浅色、外面的是深色。

## 验收帧

- `peak`（第 66 帧）：第二次按住，填充过半，字已经反白。
- `settle`（第 99 帧）：按钮是"Published"和勾。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 hold-to-confirm。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；"第一次中途松手"的演示和草图是本仓库写的，按钮文案是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/hold-to-confirm/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
