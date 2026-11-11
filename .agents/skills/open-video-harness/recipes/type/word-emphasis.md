---
id: word-emphasis
name: 句中一处变色放大，其余退后
one_liner: 整句先完整出现，然后其中一个短语换成强调色、围着自己的中心放大 6%，其余字退到 30% 左右的浓度，句子仍然读得通
family: type
role: [proof, breath]
intent: [punctuate, refocus]
energy: 2
duration_f: [45, 120]
types: [short, paper, data, promo]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [overuse, sub-threshold]
qa: {peak: 27, settle: 54}
status: tuned
pairs_with: [highlight-sweep]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/word-emphasis/README.md, license: MIT, note: 参数（倍率、周围浓度、时长、起点）和禁止项}
sketch_sha: "20af905203a5"
---

# 句中一处变色放大，其余退后 · word-emphasis

## 意图

旁白说到关键词的那一刻，画面上的那个词亮起来：颜色、大小一起变，周围的字退后但不消失。视觉焦点和旁白的重音对在同一拍上。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 读 | 0–20 | 整句以正常浓度出现 |
| 强调 | 20–39 | 关键词换成强调色、放大到 1.06；其余字退到 0.32 的浓度 |
| 停留 | 39– | 停住，直到下一句 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 放大倍率 | 1.06（1.03–1.10），围着短语自己的中心 | 太大会压到邻字 | |
| 周围浓度 | 0.32（0.25–0.50） | 再低句子就读不通了 | ★ |
| 时长 | 0.65 s（0.4–0.9），颜色和大小一起变 | | |
| 起点 | 对着旁白里那个词的时间戳 | 早于旁白像剧透，晚了像跟不上 | ★ |

## 声音

不另配；强调对着旁白的重音。

## 风格适配

- 结构参数：先整句、再强调、周围退后但可读。
- 皮肤参数：强调色、倍率。
- 量化风格：变化按一拍二走。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const parts = ["Viewers remember ", "one number", ", not ten."], size = 92, y = 570;
  lib.setFont(ctx, tokens, "display", size, { weight: 700 });
  const e = lib.ease.inOutCubic(lib.seg(t, 0.65, 1.3)), k = lib.lerp(1, 1.06, e);
  const ws = parts.map((s) => ctx.measureText(s).width), slot = ws[1] * k;   // the neighbours part as the phrase grows, so nothing overlaps
  let x = (W - ws[0] - slot - ws[2]) / 2;
  parts.forEach((s, i) => {
    if (i === 1) {   // the phrase grows about its own centre, so it never pushes its neighbours
      const cx = x + slot / 2;
      ctx.save(); ctx.translate(cx, y - size * 0.35); ctx.scale(k, k); ctx.translate(-cx, -(y - size * 0.35));
      ctx.fillStyle = lib.mixColor(fg, ac, e); ctx.fillText(s, cx - ws[i] / 2, y); ctx.restore(); x += slot; return;
    } else { ctx.globalAlpha = lib.lerp(1, 0.32, e); ctx.fillStyle = fg; ctx.fillText(s, x, y); ctx.globalAlpha = 1; }
    x += ws[i];
  });
}
```

## 已知坑

- 一屏强调好几处 → 一句一处。
- 放大围着左边缘，挤到后面的字 → 围着短语的中心放大，两边的字随之各让开一点（DOM 里 `transform` 不占位，要另加左右 margin）。
- 周围退得太淡，句子读不通 → 不低于 0.25。

## 验收帧

- `peak`（第 27 帧）：强调走到一半，颜色在过渡，周围在变淡。
- `settle`（第 54 帧）：关键词是强调色、略大，周围是淡的但读得出。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 word-emphasis。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；"起点对着旁白时间戳"和草图是本仓库写的。卡片注明的概念来源（GSAP、HyperFrames，以及 Mayer 的多媒体学习研究）只是出处。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/word-emphasis/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
