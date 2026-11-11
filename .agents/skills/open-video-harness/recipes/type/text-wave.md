---
id: text-wave
name: 一道波扫过句子
one_liner: 一道只有三四个字宽的波从句首扫到句尾，只托起它经过的字（高度不超过字号的 30%），扫完歇一下再来，像句子在呼吸
family: type
role: [breath]
intent: [breath, carry]
energy: 2
duration_f: [36, 150]
types: [short, mv, promo]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [overuse, uniform-timing]
qa: {peak: 24, read: 66}
status: tuned
pairs_with: [char-stagger]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/text-wave/README.md, license: MIT, note: 参数（振幅、波宽、周期、缓动）和禁止项}
sketch_sha: "de855712ae1b"
---

# 一道波扫过句子 · text-wave

## 意图

让一行停着的字有一点生命：等待中的一行提示、音乐片里跟着拍子跳的标题。波从左往右走，眼睛顺着读的方向被带一遍。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 扫 | 每 48 帧一轮：0–36 | 波心从句首前三个字的位置走到句尾后三个字，经过的字被托起再落下 |
| 歇 | 36–48 | 整句平静 |
| 重复 | | 一轮接一轮；音乐片里一轮对一小节 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 振幅 | 字号的 20%（不超过 30%） | 太高就是跳舞，不是呼吸 | ★ |
| 波宽 | 3 个字（2–5） | 整句一起动就不是波了 | ★ |
| 周期 | 1.2 s 扫一遍（0.8–2.0），歇 0.4 s | 音乐片对着小节 | |
| 形状 | 钟形（高斯） | 三角形的尖峰看着硬 | |

## 声音

不另配；音乐片里对着拍子。

## 风格适配

- 结构参数：窄波、单向扫、只托起经过的字。
- 皮肤参数：振幅、要不要顺带变色或放大。
- 量化风格：按一拍二取波心位置。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const str = "Breathe in, breathe out", size = 110, y = 580, gs = lib.graphemes(str), n = gs.length;
  lib.setFont(ctx, tokens, "display", size, { weight: 700 });
  const ph = lib.fract(t / 1.6), c = lib.lerp(-3, n + 3, lib.ease.inOutSine(lib.seg(ph, 0, 0.75)));   // sweep 1.2 s, rest 0.4 s
  let x = (W - ctx.measureText(str).width) / 2;
  gs.forEach((ch, i) => {
    const lift = Math.exp(-(((i - c) / 1.4) ** 2));   // a narrow bell: three or four glyphs at a time
    ctx.fillStyle = lib.mixColor(fg, ac, lift); ctx.fillText(ch, x, y - size * 0.2 * lift); x += ctx.measureText(ch).width;
  });
}
```

## 已知坑

- 振幅太大，句子读不出来 → 不超过字号的 30%。
- 波太宽，整句一起起伏 → 一次只托三四个字。
- 一直扫个不停 → 两轮之间歇一下；镜头长了就停。

## 验收帧

- `peak`（第 24 帧）：波心在句子中段，三四个字被托起。
- `read`（第 66 帧）：第二轮的开头，句子大部分平静、可读。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 text-wave。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；"扫完歇一下"和顺带变色是本仓库加的；草图是本仓库写的。卡片注明的概念来源（reelforge、motion.dev 的示例）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/text-wave/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
