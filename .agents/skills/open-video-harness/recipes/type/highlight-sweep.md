---
id: highlight-sweep
name: 荧光笔扫过关键词
one_liner: 句子先读一拍，一条荧光笔色带从左往右扫过关键词，色带在字的下半部、垫在字后面，一句话只扫一处
family: type
role: [proof, feature]
intent: [punctuate, refocus]
energy: 2
duration_f: [45, 90]
types: [short, paper, data, promo]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [overuse, sub-threshold]
qa: {peak: 27, settle: 54}
status: tuned
pairs_with: [underline-draw, word-emphasis]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/highlight-sweep/README.md, license: MIT, note: 参数（时长、起点、色带高度、左右余量）和禁止项}
sketch_sha: "2226e90c4e4d"
---

# 荧光笔扫过关键词 · highlight-sweep

## 意图

一句话里只有一个短语最要紧：像拿荧光笔划过去一样把它标出来。句子先完整出现、先读一拍，再划；划的方向就是读的方向。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 读 | 0–12 | 句子完整地在那里 |
| 划 | 12–42 | 色带从关键词左边 8 px 处起，匀匀地扫到右边 8 px 处（入出略缓） |
| 停留 | 42– | 色带和句子停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 时长 | 1.0 s（0.7–1.5） | 太快看不出方向 | |
| 起点 | 0.4 s（0.2–0.5） | 先让句子被读到 | ★ |
| 色带高度 | 字号的 55–80%，压在字的下半部 | 盖满整个字就成了反白 | |
| 一次一处 | 一句只划一个短语 | 划三处等于没划 | ★ |

## 声音

可以不配；配的话一声很轻的马克笔摩擦声，长度和色带一样。

## 风格适配

- 结构参数：先读后划、从左往右、垫在字后面。
- 皮肤参数：色带颜色（强调色的浅调）、圆角、略微倾斜。
- 量化风格：色带按一拍二伸长，像一格格涂上去。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const pre = "Most teams ship ", key = "once a month", post = ".", size = 96, y = 580;
  lib.setFont(ctx, tokens, "display", size, { weight: 700 });
  const w0 = ctx.measureText(pre).width, wk = ctx.measureText(key).width, x = (W - ctx.measureText(pre + key + post).width) / 2;
  const u = lib.ease.inOutSine(lib.seg(t, 0.4, 1.4));   // the band goes the way the sentence reads
  if (u > 0) { ctx.fillStyle = lib.mixColor(ac, bg, 0.6); ctx.beginPath(); ctx.roundRect(x + w0 - 8, y - size * 0.5, (wk + 16) * u, size * 0.62, 6); ctx.fill(); }
  ctx.fillStyle = fg; ctx.fillText(pre + key + post, x, y);   // the text sits on top of the band
}
```

HyperFrames 里色带是关键词 span 的一个伪元素或背景层，宽度（或 `scaleX`，`transform-origin: left`）由 t 算。

## 已知坑

- 色带画在字上面，字被盖淡 → 先画色带再画字。
- 一句里划好几处 → 只划一处，其余用别的办法。
- 色带颜色太深，读起来是反白 → 用强调色的浅调。

## 验收帧

- `peak`（第 27 帧）：色带扫到关键词一半左右。
- `settle`（第 54 帧）：色带停住，整句读得清。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 highlight-sweep。文字重写；参数沿用卡片的默认值和范围（时长取范围中段），按 30 fps 换算；草图是本仓库写的。卡片注明的概念来源（GSAP、HyperFrames、Vox 的讲解片）只是手法出处。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/highlight-sweep/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
