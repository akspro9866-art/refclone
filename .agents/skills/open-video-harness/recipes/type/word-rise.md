---
id: word-rise
name: 逐词上浮、去掉模糊
one_liner: 一两行字幕按词（中文按词组）依次上浮 12 px，模糊从 6 px 收到 0，全句在 1.2 s 内出齐；安静、按读的顺序
family: type
role: [open, breath]
intent: [enter, hush]
energy: 1
duration_f: [30, 90]
types: [short, promo, paper, data]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [text-blur, too-fast]
qa: {peak: 18, settle: 45}
status: tuned
pairs_with: [breath-title-card, char-stagger]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/word-rise-fade/README.md, license: MIT, note: 参数（词间隔、单词时长、上浮距离、起始模糊）和按词组切的规则}
sketch_sha: "0806c6a5e347"
---

# 逐词上浮、去掉模糊 · word-rise

## 意图

讲解片的一两行说明、品牌片的开场一句：字一个词一个词地从模糊里浮出来，读的顺序就是出现的顺序，语气是平静的。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 第一行 | 9–36 | 每个词比前一个晚 2–3 帧，各用 10 帧上浮 12 px、模糊从 6 px 收到 0、透明升满 |
| 第二行 | 24–48 | 中文行按词组同样出场 |
| 停留 | 48– | 停到读完 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 词间隔 | 0.08 s（0.05–0.12），词多就缩短 | 整句出齐不超过 1.2 s | ★ |
| 单词时长 | 0.35 s（软模糊版到 0.9 s） | | |
| 上浮 | 12 px（8–14） | | |
| 起始模糊 | 6 px（0–10） | 0 就是纯上浮淡入 | |
| 中文 | 按词组切，不把助词单独拎出来 | "的""了"单独浮上来，读着断 | ★ |

## 声音

不另配。

## 风格适配

- 结构参数：按词、读的顺序、模糊收到 0。
- 皮肤参数：模糊量、距离、字体。
- 量化风格：不建议，模糊收敛要连续。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const line = (words, role, size, y, start, col) => {
    lib.setFont(ctx, tokens, role, size, { weight: 500 });
    const ws = words.map((w) => ctx.measureText(w).width); let x = (W - ws.reduce((a, b) => a + b, 0)) / 2;
    words.forEach((w, i) => {   // word by word, in reading order; the blur closes to zero
      const u = lib.ease.outCubic(lib.seg(t, start + i * 0.08, start + 0.35 + i * 0.08));
      if (u > 0) { ctx.filter = u < 1 ? `blur(${(6 * (1 - u)).toFixed(2)}px)` : "none"; ctx.globalAlpha = u; ctx.fillStyle = col; ctx.fillText(w, x, y + 12 * (1 - u)); }
      x += ws[i];
    });
    ctx.filter = "none"; ctx.globalAlpha = 1;
  };
  line(["A ", "calm ", "line, ", "built ", "in ", "reading ", "order."], "display", 80, 520, 0.3, fg);
  line(["按阅读的顺序，", "一个词", "一个词地", "浮上来。"], "zh", 64, 640, 0.8, ac);
}
```

## 已知坑

- 词太多，全句出齐拖过 1.2 s → 缩短间隔。
- 中文按字切或把助词单独拎出来 → 按词组切。
- 模糊没收到 0 就停了，字是软的 → 最后一帧必须是 0。

## 验收帧

- `peak`（第 18 帧）：英文行前半清楚、后半还在模糊里浮上来。
- `settle`（第 45 帧）：两行都清楚、停住。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 word-rise-fade。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；中文按词组切的例子和草图是本仓库写的（卡片说的是韩文按语节切）。卡片注明的概念来源（HyperFrames）只是手法出处。和 `breath-title-card` 的区别：那一张是一整个字卡镜头（压印、强调词、短横、停读），这一张只管字幕一类的一两行怎么出来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/word-rise-fade/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
