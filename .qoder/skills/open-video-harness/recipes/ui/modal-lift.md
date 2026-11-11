---
id: modal-lift
name: 对话框浮起
one_liner: 背景压暗（不糊），一个对话框从下方 24 px、0.96 倍浮到正中落定，焦点只剩它；随后光标点下确认键，键按下去再弹回
family: ui
role: [feature]
intent: [refocus, interact]
energy: 2
duration_f: [30, 90]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-page, ui-element]
sound: optional
pitfalls: [fake-ui, glow-spill]
qa: {peak: 15, settle: 45}
status: tuned
pairs_with: [oversized-cursor]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/modal-lift/README.md, license: MIT, note: 时序和"不要同时重度模糊背景"的禁止项}
sketch_sha: "89bf7968c663"
---

# 对话框浮起 · modal-lift

## 意图

"现在只看这一件事"：一个要确认的决定、一项要补的信息。背景压暗退后，对话框从下面浮上来落定，当前的工作区和优先级一下就清楚了。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 页面 | 0–9 | 正常的页面 |
| 浮起 | 9–24 | 背景压暗到约 45%；对话框从下方 24 px、0.96 倍浮到正中，透明度升满（outCubic） |
| 点击 | 54–78 | 光标移到确认键（15 帧），按下（键缩到 0.96）再弹回 |
| 停留 | 78– | |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 背景 | 压暗 40–50%，不模糊或只轻模糊 | 重模糊加压暗，整屏糊成一片 | ★ |
| 浮起 | 24 px、0.96 → 1，0.5 s，outCubic | 从屏幕外飞进来太戏剧 | |
| 落定 | 不过冲 | 对话框弹跳显得轻浮 | |
| 主次 | 确认键用强调色，取消键是描边 | | |

## 声音

浮起不配；点击一声短 click。

## 风格适配

- 结构参数：背景退后、从下浮起、落定不弹。
- 皮肤参数：对话框的圆角、阴影、按钮样式。
- 量化风格：浮起按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lib.mixColor(bg, fg, 0.08);   // the page underneath
  ctx.fillRect(120, 90, W - 240, 90); for (let i = 0; i < 6; i++) ctx.fillRect(120 + (i % 3) * 570, 240 + Math.floor(i / 3) * 380, 540, 340);
  const u = lib.ease.outCubic(lib.seg(t, 0.3, 0.8));
  ctx.fillStyle = lib.rgba(fg, 0.45 * u); ctx.fillRect(0, 0, W, H);   // dimmed, not blurred
  const MW = 820, MH = 440, x = (W - MW) / 2, y = (H - MH) / 2 + 24 * (1 - u), k = lib.lerp(0.96, 1, u);
  ctx.save(); ctx.globalAlpha = u; ctx.translate(W / 2, y + MH / 2); ctx.scale(k, k); ctx.translate(-W / 2, -(y + MH / 2));
  ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20; ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, MW, MH, 28); ctx.fill(); ctx.shadowColor = "transparent";
  lib.setFont(ctx, tokens, "display", 52, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText("Publish to all channels?", x + 60, y + 110);
  lib.setFont(ctx, tokens, "display", 36, { weight: 400 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.4); ctx.fillText("Three platforms, one upload each.", x + 60, y + 175);
  const press = 1 - 0.04 * Math.sin(Math.PI * lib.seg(t, 2.3, 2.6)), bx = x + MW - 300, by = y + MH - 130;
  ctx.strokeStyle = lib.mixColor(bg, fg, 0.3); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x + MW - 560, by, 220, 80, 40); ctx.stroke();
  lib.setFont(ctx, tokens, "display", 36, { weight: 600 }); ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.fillText("Cancel", x + MW - 450, by + 52);
  ctx.save(); ctx.translate(bx + 120, by + 40); ctx.scale(press, press); ctx.fillStyle = ac; ctx.beginPath(); ctx.roundRect(-120, -40, 240, 80, 40); ctx.fill();
  ctx.fillStyle = bg; ctx.fillText("Publish", 0, 12); ctx.restore(); ctx.textAlign = "left"; ctx.restore();
  const c = lib.ease.inOutCubic(lib.seg(t, 1.8, 2.3)), cx = lib.lerp(W * 0.8, bx + 150, c), cy = lib.lerp(H * 0.9, by + 50, c);   // the cursor
  if (t > 1.6) { ctx.fillStyle = fg; ctx.strokeStyle = bg; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 52); ctx.lineTo(cx + 14, cy + 40); ctx.lineTo(cx + 24, cy + 60); ctx.lineTo(cx + 32, cy + 55); ctx.lineTo(cx + 22, cy + 36); ctx.lineTo(cx + 38, cy + 36); ctx.closePath(); ctx.fill(); ctx.stroke(); }
}
```

## 已知坑

- 背景重模糊加压暗 → 只压暗，或很轻的模糊。
- 对话框弹跳着落定 → outCubic，不过冲。
- 对话框里是假的灰条 → 写真问题、真按钮名。

## 验收帧

- `peak`（第 15 帧）：对话框浮到半路，背景正在变暗。
- `settle`（第 45 帧）：对话框停在正中，背景压暗，字读得清。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 modal-lift。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；点确认键的那一段和草图是本仓库写的，文案是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/modal-lift/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
