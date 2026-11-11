---
id: error-shake
name: 错了就摇，改对了打勾
one_liner: 输入框短促地左右摇三下标出错误，边框和下面一行说明变成错误色；改对以后边框换成成功色，一个勾一笔画出来
family: ui
role: [feature]
intent: [interact, compare]
energy: 3
duration_f: [45, 105]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element, text]
sound: optional
pitfalls: [too-fast, sound-dependent]
qa: {peak: 24, settle: 90}
status: tuned
pairs_with: [hold-confirm]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/error-shake/README.md, license: MIT, note: 时序和"只摇出错的那个框，配一行说明"的禁止项}
sketch_sha: "4ee7482b094f"
---

# 错了就摇，改对了打勾 · error-shake

## 意图

区分"输错了"和"改好了"：错的那一下用身体语言（摇头）和一行说明，对的那一下用一笔画出来的勾。两种状态的动作不一样，所以不只靠颜色区分。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 输入 | 0–15 | 框里打出一个写错的邮箱 |
| 摇 | 18–29 | 框左右摇三下（振幅递减），边框变成错误色，下面淡入一行说明 |
| 改 | 45–66 | 光标回去，补上漏掉的字 |
| 对 | 72–84 | 边框换成成功色，右侧一笔画出勾，说明换成"好了" |
| 停留 | 84– | |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 摇 | 三下、振幅 14 px 递减、共 0.36 s | 摇太久像系统崩了 | |
| 只摇出错的框 | 一屏只摇一个，配一行说明 | 整个表单一起摇，看不出哪错了 | ★ |
| 成功 | 勾一笔画出来，不摇 | 成功也摇，读成又错了 | ★ |
| 颜色 | 错误色和成功色之外，还有动作和文字 | 只靠颜色，色弱看不出 | |

## 声音

摇的那一下一声低的"嘟"，勾一声轻的"叮"；静音时动作本身要说清楚。

## 风格适配

- 结构参数：错 = 摇 + 说明，对 = 勾；两种动作不同。
- 皮肤参数：框的样式、两种状态色、字体。
- 量化风格：摇按一拍二会更"硬"，适合像素风。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const ok = "#2f9e62";   // a state colour, not a skin colour
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const bad = lib.seg(t, 0.6, 0.7) * (1 - lib.seg(t, 2.4, 2.5)), good = lib.seg(t, 2.4, 2.6);
  const sp = lib.seg(t, 0.6, 0.96), dx = sp > 0 && sp < 1 ? 14 * Math.sin(sp * 6 * Math.PI) * (1 - sp) : 0;   // three shakes, dying away
  const X = 560 + dx, Y = 420, BW = 800, BH = 110;
  lib.setFont(ctx, tokens, "display", 36, { weight: 600 }); ctx.fillStyle = fg; ctx.fillText("Email", 560, Y - 30);
  ctx.fillStyle = bg; ctx.strokeStyle = good > 0 ? lib.mixColor(lib.mixColor(bg, fg, 0.3), ok, good) : lib.mixColor(lib.mixColor(bg, fg, 0.3), ac, bad); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(X, Y, BW, BH, 18); ctx.fill(); ctx.stroke();
  const typed = lib.typewriter("anna@exmple.com", t, { start: 0.1, cps: 30 }), fixed = t >= 1.5 ? lib.typewriter("a", t, { start: 1.9, cps: 10 }) : "";
  const txt = fixed ? "anna@example.com" : typed;
  lib.setFont(ctx, tokens, "mono", 48); ctx.fillStyle = fg; ctx.fillText(txt, X + 36, Y + 72);
  if (bad > 0) { ctx.globalAlpha = bad; lib.setFont(ctx, tokens, "display", 32, { weight: 500 }); ctx.fillStyle = ac; ctx.fillText("Check the domain: exmple → example", 560, Y + BH + 56); ctx.globalAlpha = 1; }
  if (good > 0) {
    ctx.globalAlpha = good; lib.setFont(ctx, tokens, "display", 32, { weight: 500 }); ctx.fillStyle = ok; ctx.fillText("Looks right.", 560, Y + BH + 56); ctx.globalAlpha = 1;
    ctx.strokeStyle = ok; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.lineJoin = "round";   // the tick is drawn, in one stroke
    lib.strokePartial(ctx, [[X + BW - 90, Y + 56], [X + BW - 70, Y + 76], [X + BW - 36, Y + 36]], lib.ease.outCubic(lib.seg(t, 2.45, 2.8)));
  }
}
```

## 已知坑

- 摇得太久太大 → 三下、0.36 s。
- 整张表单一起摇 → 只摇出错的那个框，配一行说明。
- 成功也用摇 → 成功用勾，动作不同。

## 验收帧

- `peak`（第 24 帧）：框在摇（偏离原位），边框是错误色，说明正在出现。
- `settle`（第 90 帧）：邮箱改对，边框是成功色，勾画完，说明是"好了"。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 error-shake。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；草图是本仓库写的，输入内容是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/error-shake/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
