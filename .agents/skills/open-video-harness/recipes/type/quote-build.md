---
id: quote-build
name: 引语卡按顺序搭起来
one_liner: 大引号先到，几行引文一行行从下方 24 px 升起，署名最后才贴上；停留时间按字数给足，引文一字不改
family: type
role: [proof, breath]
intent: [payoff, hush]
energy: 1
duration_f: [90, 180]
types: [promo, short, paper]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [copy-drift, no-hold]
qa: {peak: 27, settle: 60}
status: tuned
pairs_with: [word-rise]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/quote-card-build/README.md, license: MIT, note: 参数（引号、每行、行间、署名延迟、停留）和禁止项}
sketch_sha: "eb73e678a0d3"
---

# 引语卡按顺序搭起来 · quote-build

## 意图

一条用户评价、一句采访原话：话和说话的人之间的关系要清楚，读的时间要够。分量来自顺序：先是引号，然后是话，最后才是谁说的。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 引号 | 6–15 | 大引号从 0.8 倍放大到 1，淡入 |
| 引文 | 12–42 | 三行依次从下方 24 px 升起，每行 15 帧，行间晚 4 帧 |
| 署名 | 47–57 | 最后一行落定 8 帧后，短横和署名贴上 |
| 停留 | 57– | 按字数停：至少 字数 × 0.12 s |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 引号 | 0.3 s，0.8 → 1 | | |
| 每行 | 0.5 s（0.4–0.7），从下方 24 px | | |
| 行间 | 0.12 s（0.08–0.16） | | |
| 署名 | 最后一行之后 0.25 s（0.15–0.4），永远最后 | 署名先到，读成"某某说"的预告 | ★ |
| 行数 | 不超过 4 行 | | |
| 停留 | ≥ 字数 × 0.12 s（3–6 s） | 引语没读完就切 | ★ |

## 声音

不另配；有旁白时旁白读引文。

## 风格适配

- 结构参数：引号 → 引文逐行 → 署名，停到读完。
- 皮肤参数：引号的样式和颜色、字体（衬线最像引语）、卡片底。
- 量化风格：逐行出场按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const lines = ["It felt like the film", "was explaining itself", "while I watched."], X = 440;
  const q = lib.ease.outCubic(lib.seg(t, 0.2, 0.5));
  ctx.save(); ctx.globalAlpha = q; ctx.translate(X - 20, 330); ctx.scale(lib.lerp(0.8, 1, q), lib.lerp(0.8, 1, q));
  lib.setFont(ctx, tokens, "display", 260, { weight: 800 }); ctx.fillStyle = ac; ctx.fillText("“", -40, 120); ctx.restore();
  lines.forEach((l, i) => {   // the lines in reading order
    const u = lib.ease.outCubic(lib.seg(t, 0.4 + i * 0.12, 0.9 + i * 0.12));
    ctx.globalAlpha = u; lib.setFont(ctx, tokens, "display", 84, { weight: 500 }); ctx.fillStyle = fg; ctx.fillText(l, X + 60, 460 + i * 110 + 24 * (1 - u));
  });
  const a = lib.ease.outCubic(lib.seg(t, 1.55, 1.9));   // the attribution always comes last
  ctx.globalAlpha = a; ctx.fillStyle = ac; ctx.fillRect(X + 60, 820, 48 * a, 4);
  lib.setFont(ctx, tokens, "mono", 34); ctx.fillStyle = fg; ctx.fillText("a first-time viewer (placeholder)", X + 130, 834); ctx.globalAlpha = 1;
}
```

## 已知坑

- 署名和引文一起出来 → 署名永远最后。
- 引文"顺手"改了几个字 → 一字不改，出处记进 NOTES；需要删节就用省略号并标明。
- 停留太短 → 按字数给时间，宁长勿短。

## 验收帧

- `peak`（第 27 帧）：前两行在，第三行正在升起，署名还没出。
- `settle`（第 60 帧）：三行和署名都在。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 quote-card-build。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；草图是本仓库写的，引文和署名是占位。卡片注明的概念来源（textillate、Motion Canvas）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/quote-card-build/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
