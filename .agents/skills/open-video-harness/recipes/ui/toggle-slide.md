---
id: toggle-slide
name: 开关滑过去
one_liner: 开关的圆钮滑到另一头、带一点回弹落定，轨道换色，圆钮上出现勾、旁边的"关"换成"开"；状态不只靠颜色表达
family: ui
role: [feature]
intent: [interact, transform]
energy: 2
duration_f: [20, 60]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element]
sound: optional
pitfalls: [mechanical-stop, fake-ui]
qa: {peak: 27, settle: 57}
status: tuned
pairs_with: [oversized-cursor]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/toggle-slide/README.md, license: MIT, note: 时序和"状态不只靠颜色"的禁止项}
sketch_sha: "cdee1adb1d20"
---

# 开关滑过去 · toggle-slide

## 意图

讲一个设置被打开：圆钮滑过去、落定时略微回弹，手感就出来了。状态要有颜色以外的线索（圆钮上的勾、"开/关"字样），色弱的观众也看得懂。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–15 | 三行设置，开关都是关的 |
| 拨动 | 15、30、45 起 | 三个开关依次拨开：圆钮按弹簧（略欠阻尼）滑到另一头，约 12 帧落定；轨道颜色跟着位置变；"Off"换成"On"，圆钮上出现勾 |
| 停留 | 57– | 三个都开着 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 圆钮运动 | 弹簧，ζ ≈ 0.6，过冲 2–3 px | 匀速滑到头，停得很死 | ★ |
| 轨道颜色 | 跟圆钮位置连续变 | 一下翻色会闪 | |
| 非颜色线索 | 勾、文字 | 只靠颜色，色弱看不出 | ★ |
| 依次 | 每个晚 0.5 s | 一起拨像截图 | |

## 声音

每个开关一声短促的 click。

## 风格适配

- 结构参数：弹簧落定、颜色跟位置、勾和文字。
- 皮肤参数：轨道和圆钮的尺寸、颜色、阴影。
- 量化风格：圆钮按一拍二，回弹保留。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lib.mixColor(bg, fg, 0.05); ctx.beginPath(); ctx.roundRect(560, 200, 800, 680, 28); ctx.fill();
  ["Auto captions", "Loudness check", "Safe-area guides"].forEach((name, i) => {
    const y = 300 + i * 200, on = lib.spring(t - (0.5 + i * 0.5), { w: 16, zeta: 0.6 });   // a spring: it overshoots a little and settles
    const TX = 1140, TW = 140, TH = 72, c = lib.clamp(on);
    lib.setFont(ctx, tokens, "display", 46, { weight: 600 }); ctx.fillStyle = fg; ctx.fillText(name, 640, y + 30);
    lib.setFont(ctx, tokens, "display", 32, { weight: 500 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.45);
    ctx.globalAlpha = 1 - c; ctx.fillText("Off", 640, y + 80); ctx.globalAlpha = c; ctx.fillStyle = ac; ctx.fillText("On", 640, y + 80); ctx.globalAlpha = 1;
    ctx.fillStyle = lib.mixColor(lib.mixColor(bg, fg, 0.25), ac, c); ctx.beginPath(); ctx.roundRect(TX, y, TW, TH, TH / 2); ctx.fill();
    const kx = TX + TH / 2 + (TW - TH) * on, ky = y + TH / 2;
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(kx, ky, TH / 2 - 7, 0, lib.TAU); ctx.fill();
    if (c > 0.5) { ctx.strokeStyle = ac; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.globalAlpha = (c - 0.5) * 2;
      ctx.beginPath(); ctx.moveTo(kx - 11, ky); ctx.lineTo(kx - 3, ky + 8); ctx.lineTo(kx + 12, ky - 9); ctx.stroke(); ctx.globalAlpha = 1; }
  });
}
```

## 已知坑

- 圆钮匀速滑到头、一下停死 → 弹簧，略欠阻尼。
- 只换颜色 → 加勾或文字。
- 过冲太大，圆钮冲出轨道 → ζ 不低于 0.5。

## 验收帧

- `peak`（第 27 帧）：第一个开关刚落定（还在回弹），第二个正在滑。
- `settle`（第 57 帧）：三个都开着，勾和"On"都在。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 toggle-slide。文字重写；时序沿用卡片，按 30 fps 换算；弹簧用本仓库 `lib.spring` 的闭式解，三个开关依次拨动的草图是本仓库写的。卡片注明的概念来源（react-bits）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/toggle-slide/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
