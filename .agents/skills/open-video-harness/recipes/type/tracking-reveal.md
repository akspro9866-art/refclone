---
id: tracking-reveal
name: 字距收拢成一个整体
one_liner: 字距拉得很开的一行标题慢慢收拢成紧凑的整体，透明度在前 60% 里升满；插值的是每个字的位移，不是字距属性，所以行不会抖
family: type
role: [open, outro]
intent: [enter, brand-imprint, hush]
energy: 1
duration_f: [18, 45]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [too-fast, text-blur]
qa: {peak: 18, settle: 39}
status: tuned
pairs_with: [brand-imprint-open]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/tracking-reveal/README.md, license: MIT, note: 参数（时长、起始字距、透明度区间、缓动）和"不插值字距"的禁止项}
sketch_sha: "1c5230930275"
---

# 字距收拢成一个整体 · tracking-reveal

## 意图

品牌片、高级感的标题：散开的字母安静地聚拢、对齐，像一句话想好了才说出来。慢、稳、没有弹跳，信任感来自"收"的动作本身。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 空画面 |
| 收拢 | 9–33 | 每个字从加宽 0.2–0.4 em 的位置往最终位置收（outQuad），透明度在前 60% 升满；中文副标题晚 4 帧、只加宽 0.15 em |
| 停留 | 33– | 标题停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 时长 | 0.8 s（0.6–1.2） | 慢才有"安静"的意思 | |
| 起始加宽 | 0.3 em（0.1–0.4）；中文、韩文不超过 0.2 em | 中文字距一开就断读 | ★ |
| 插值方式 | 字的位置（`transform`），不是 `letter-spacing` | 插值字距会逐帧重排，整行抖 | ★ |
| 缓动 | outQuad 到 outQuart | 带回弹就不安静了 | |

## 声音

可以不配；配的话一声长的、轻的气声或钢琴单音。

## 风格适配

- 结构参数：从宽到紧、位移插值、透明在前段升满。
- 皮肤参数：字体（大写、细的字重最像）、起始宽度。
- 量化风格：不建议；这个手法靠的是连续。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const line = (str, role, size, y, start, spread, col, track) => {   // each glyph's final x is fixed; only its offset is tweened
    lib.setFont(ctx, tokens, role, size, { weight: 300 });
    const gs = lib.graphemes(str), ws = gs.map((g) => ctx.measureText(g).width + track * size), n = gs.length;
    const u = lib.ease.outCubic(lib.seg(t, start, start + 0.8)); let x = (W - ws.reduce((a, b) => a + b, 0) + track * size) / 2;
    ctx.globalAlpha = lib.seg(u, 0, 0.6); ctx.fillStyle = col;
    gs.forEach((g, i) => { ctx.fillText(g, x + (i - (n - 1) / 2) * spread * size * (1 - u), y); x += ws[i]; });
    ctx.globalAlpha = 1;
  };
  line("STILL WATER", "display", 150, 560, 0.3, 0.3, fg, 0.04);
  line("静水流深", "zh", 64, 680, 0.45, 0.15, ac, 0.3);
}
```

## 已知坑

- 插值 `letter-spacing`，整行逐帧重排、抖 → 固定每个字的最终位置，只插值位移。
- 中文字距开得太大，读成四个字 → 不超过 0.2 em。
- 带回弹或过冲 → 用 outQuad/outCubic，安静地停。

## 验收帧

- `peak`（第 18 帧）：英文收拢了一大半、已经不透明，中文刚开始。
- `settle`（第 39 帧）：两行都收紧了。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 tracking-reveal。文字重写；参数沿用卡片的默认值和范围（中文的上限照卡片对韩文的说法），按 30 fps 换算；草图是本仓库写的。卡片注明的概念来源（HyperFrames、animista、reelforge）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/tracking-reveal/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
