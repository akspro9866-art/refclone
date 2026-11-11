---
id: strike-replace
name: 划掉旧说法，换上新说法
one_liner: 一条删除线从左往右划过旧说法，停一拍，新说法才从下方 12 px 升到它下面；旧的留在 45% 浓度，看得出改了什么
family: type
role: [proof]
intent: [compare, transform]
energy: 2
duration_f: [30, 90]
types: [promo, short, paper, data]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text, number]
sound: optional
pitfalls: [copy-drift, too-fast]
qa: {peak: 24, settle: 51}
status: tuned
pairs_with: [word-emphasis]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/strikethrough-replace/README.md, license: MIT, note: 参数（划线时长、停顿、新文出场、旧文浓度）和顺序规则}
sketch_sha: "9f374d973203"
---

# 划掉旧说法，换上新说法 · strike-replace

## 意图

价格改了、政策变了、一个流行的误解被纠正：先当众划掉旧的，再给出新的。顺序本身就是论证：划完、停一拍、再出新的，观众不会搞混哪一个才对。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 读 | 0–12 | 旧说法完整在那里 |
| 划 | 12–23 | 删除线从左往右划过 |
| 停 | 23–26 | 停一拍，旧的开始变淡 |
| 换 | 26–34 | 新说法从下方 12 px 升起、淡入 |
| 停留 | 34– | 新旧都在，旧的 45% 浓度 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 划线时长 | 0.35 s（0.25–0.5） | | |
| 划完到出新 | 0.1 s（0.05–0.2） | 不停，读起来是同时发生的 | ★ |
| 新文出场 | 0.25 s，从下方 12 px | | |
| 旧文浓度 | 0.45（0.35–0.6），不删 | 删掉旧的，就看不出改了什么 | ★ |

## 声音

划线时一声干脆的"唰"；新说法出来不配。

## 风格适配

- 结构参数：先划、停、再出新；旧的留着。
- 皮肤参数：删除线颜色（强调色）、新文的位置（旁边或下面）。
- 量化风格：划线按一拍二伸长。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const old = "$49 / month", neu = "$29 / month", size = 130;
  lib.setFont(ctx, tokens, "display", size, { weight: 700 });
  const w = ctx.measureText(old).width, x = (W - w) / 2, y = 470;
  const strike = lib.ease.outCubic(lib.seg(t, 0.4, 0.75)), dim = lib.seg(t, 0.75, 1.0);
  ctx.globalAlpha = lib.lerp(1, 0.45, dim); ctx.fillStyle = fg; ctx.fillText(old, x, y); ctx.globalAlpha = 1;
  if (strike > 0) { ctx.strokeStyle = ac; ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x - 10, y - size * 0.32); ctx.lineTo(x - 10 + (w + 20) * strike, y - size * 0.32); ctx.stroke(); }
  const n = lib.ease.outCubic(lib.seg(t, 0.85, 1.1));   // the new line only after the strike has finished
  if (n > 0) { ctx.globalAlpha = n; ctx.fillStyle = fg; lib.setFont(ctx, tokens, "display", size, { weight: 800 }); ctx.fillText(neu, x, y + 190 + 12 * (1 - n)); ctx.globalAlpha = 1;
    lib.setFont(ctx, tokens, "mono", 30); ctx.fillStyle = ac; ctx.globalAlpha = n; ctx.fillText("from 1 November", x, y + 260); ctx.globalAlpha = 1; }
}
```

## 已知坑

- 删除线还没划完新文就出来了 → 先划完、停一拍。
- 旧文划完就删掉 → 留在 45% 左右。
- 新旧数字不是同一口径（含税和不含税）→ 文案先对一遍，这是事实问题。

## 验收帧

- `peak`（第 24 帧）：删除线划完，新说法还没出来。
- `settle`（第 51 帧）：新说法在下面，旧的淡着、被划掉。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 strikethrough-replace。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；草图是本仓库写的，价格是样例。卡片注明的概念来源是 HyperFrames。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/strikethrough-replace/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
