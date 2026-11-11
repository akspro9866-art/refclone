---
id: word-slot-cycle
name: 句子里一个槽轮换词
one_liner: 句子的固定部分不动，只有一个词槽上下轮换几个候选词：旧词往上带点模糊出去、新词从下面进来，槽宽按最宽的词定，句子不跟着跳
family: type
role: [feature, hook]
intent: [abundance, compare]
energy: 2
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [too-fast, copy-drift]
qa: {peak: 27, read: 75}
status: tuned
pairs_with: [glyph-roll]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/word-slot-cycle/README.md, license: MIT, note: 参数（停留、交换、距离、出场模糊）和"槽宽固定"的禁止项}
sketch_sha: "b2db22149330"
---

# 句子里一个槽轮换词 · word-slot-cycle

## 意图

"用 AI 做 ___"这种句式：一个句子装下很多用途、很多受众，观众读到的是"范围很广"。固定部分一动不动，眼睛只盯着那一个槽。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 句子和第一个候选词 |
| 每一轮 | 25 帧一轮 | 停 18 帧，再用 7–8 帧交换：旧词往上 0.6 em、带 4 px 模糊淡出，新词从下方 0.6 em 进来；两者有重叠 |
| 收 | | 最后停在最想让人记住的那个词上 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 停留 | 0.6 s（0.5–1.0） | 少于 0.5 s 读不完 | ★ |
| 交换 | 0.25 s（0.2–0.35），进出重叠 | | |
| 距离 | 0.6 em（0.4–0.8） | | |
| 槽宽 | 按最宽的候选词固定 | 槽宽跟着词变，整句左右跳 | ★ |
| 候选数 | 4–6 个 | | |

## 声音

可以不配；配的话每次交换一声很轻的 tick。

## 风格适配

- 结构参数：固定句子、固定槽宽、上出下进。
- 皮肤参数：槽里词的颜色（强调色）、下划线或底色。
- 量化风格：交换按一拍二走。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const opts = ["explainers", "launch films", "data stories", "music videos", "paper talks"], size = 100, y = 580, em = size;
  lib.setFont(ctx, tokens, "display", size, { weight: 700 });
  const a = "Make ", b = " in code.", wa = ctx.measureText(a).width, slot = Math.max(...opts.map((o) => ctx.measureText(o).width));   // the slot is as wide as the widest word
  const x0 = (W - wa - slot - ctx.measureText(b).width) / 2, sx = x0 + wa;
  ctx.fillStyle = fg; ctx.fillText(a, x0, y); ctx.fillText(b, sx + slot, y);
  ctx.save(); ctx.beginPath(); ctx.rect(sx - 10, y - em * 1.05, slot + 20, em * 1.4); ctx.clip();
  const per = 0.85, k = Math.max(0, Math.floor((t - 0.3) / per)), ph = (t - 0.3) - k * per, sw = t < 0.3 ? 0 : lib.ease.inOutCubic(lib.seg(ph, 0.6, 0.85));
  const cur = opts[Math.min(k, opts.length - 1)], nxt = opts[Math.min(k + 1, opts.length - 1)], moving = k + 1 < opts.length;
  ctx.fillStyle = ac;
  ctx.globalAlpha = moving ? 1 - sw : 1; ctx.filter = moving && sw > 0 ? `blur(${(4 * sw).toFixed(2)}px)` : "none"; ctx.fillText(cur, sx, y - (moving ? 0.6 * em * sw : 0));
  ctx.filter = "none";
  if (moving && sw > 0) { ctx.globalAlpha = sw; ctx.fillText(nxt, sx, y + 0.6 * em * (1 - sw)); }
  ctx.restore(); ctx.globalAlpha = 1;
  ctx.fillStyle = lib.rgba(ac, 0.35); ctx.fillRect(sx, y + 22, slot, 6);
}
```

## 已知坑

- 槽宽跟着词变 → 按最宽的词固定，短词在槽里左对齐。
- 每个词停不到 0.5 s → 减少候选，或者加长镜头。
- 候选词里有夸大的说法 → 这些都是承诺，文案要能兑现。

## 验收帧

- `peak`（第 27 帧）：第一次交换的中间，旧词往上淡出、新词从下面进来。
- `read`（第 75 帧）：某个候选词停在槽里，整句可读。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 word-slot-cycle。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；草图是本仓库写的。卡片注明的概念来源（HyperFrames）只是手法出处。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/word-slot-cycle/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
