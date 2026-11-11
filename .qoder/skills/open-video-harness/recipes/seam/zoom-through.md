---
id: zoom-through
name: 纵深切
one_liner: 沿镜头纵深方向切：推进款里旧字冲向镜头、新字从远处继续长大；拉回款里旧的退远、新的从镜头背后缩回来落定
family: seam
role: [seam, climax]
intent: [carry, payoff]
energy: [2, 4]
duration_f: [18, 24]
jump: [level, rise]
types: [promo, short, meme, mv]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [seam-mismatch, text-blur]
qa: {seam: 6, settle: 21}
status: tuned
impl: [showcase/00-promo-launch-film/compositions/s-lockup.html]
derived_from:
  - {repo: github.com/heygen-com/hyperframes, commit: "a46095f", path: .claude/skills/cut-the-curve/SKILL.md, license: Apache-2.0, note: 第 1、2 式 zoom-through 和 inverse zoom-through、Z 方向的符号规则、模糊量}
sketch_sha: "79295ed6e83c"
---

# 纵深切 · zoom-through

## 意图

两句大字之间换句：沿着镜头的纵深方向切，而不是左右。推进款说"更深一层"：旧的一句冲向镜头、糊掉，新的一句从远处继续长大，像一路往里走。拉回款说"到了"：旧的退远，新的像刚从镜头背后出来，缩回焦平面落定，留给兑现、结论、片尾字标这类时刻。

## 阶段与时值

第 0 帧 = 旧字开始动。

| 款 | 段 | 帧 | 缩放 | 模糊 | 透明度 |
|---|---|---|---|---|---|
| 推进 | 出 | 0–6（0.2 s） | 1 → 1.2，`power3.in` | 0 → 10 px | 1 → 0.15（线性，单独一条） |
| 推进 | 切 | 6 | 新字从 0.75 起 | 10 px | 旧 0，新 0.15 |
| 推进 | 进 | 6–21（0.5 s） | 0.75 → 1，`expo.out` | 10 → 0 | 0.15 → 1 |
| 拉回 | 出 | 0–6 | 1 → 0.8，`power3.in` | 0 → 10 px | 1 → 0.15 |
| 拉回 | 切 | 6 | 新字从 1.25 起 | 10 px | 旧 0，新 0.15 |
| 拉回 | 进 | 6–21 | 1.25 → 1，`expo.out` | 10 → 0 | 0.15 → 1 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 缩放方向的符号 | 切点两侧缩放变化的方向一致：推进款两边都在变大，拉回款两边都在变小 | 旧的退远、新的从小长大（最常见的错法：因为"从小长大"是默认的入场），方向在切点翻转，读作跳 | ★ |
| 两句不同时出现 | 在模糊最大的那一帧硬切，同一时刻只有一句 | 两句叠在一起就成了溶解 | ★ |
| 模糊量 | 字级的主体 10 px；整屏的画面、窗口、截图 18–20 px；切点两侧的模糊和透明度数值相同 | 字用 20 px 会把字形抹烂，读作故障；整屏只用 10 px 像渲染出错 | |
| 出的透明度 | 单独一条线性的补间 | 和缩放共用 `power3.in`，透明度会一直停在接近 1，最后一下才掉 | |
| 用在哪 | 推进：大标题、短句；拉回：兑现、结论、片尾 | 正文不能用；拉回款用在普通接缝上就不值钱了 | |
| 新镜自己的入场 | 切点后约 0.5 s 内，新画面自己的元素不要再做"从小长大"的入场 | 包在外层的缩放是拉回，里面的元素却在放大，符号又翻了 | |

## 声音

可以不配。拉回款用在兑现、片尾时，切点配一记重音（和弦落地或低频冲击），推进款可以配一声短 swish。

## 风格适配

- 结构参数：缩放方向的符号、只有一句、模糊的数值按主体大小。
- 皮肤参数：字体、模糊用高斯还是运动方向的模糊。
- DOM 里不动画 blur（playbook/03 §4）：模糊放在 canvas 层，或者用一张预模糊的副本在切点前后交叉；showcase 00 在 DOM 里直接动画了 `filter: blur`，新片不照抄这一处。
- 像素风：模糊换成像素化（格子由小变大再变小），缩放取整到整像素。

## 实现

本仓库的发布片 `showcase/00-promo-launch-film/compositions/s-lockup.html` 用拉回款把片尾字标带进来：`scale 1.25 → 1`、模糊 10 → 0、透明度 0.15 → 1，都是 0.5 s 的 `expo.out`，接在上一镜"退远"的出场后面。下面是 canvas 草图，`KIND` 换成 `"pull"` 看拉回款：

```js
// zoom-through：第 40 帧起旧句出（6 帧）→ 第 46 帧在模糊最大时硬切 → 新句进（15 帧）。推进款两边都在变大，拉回款两边都在变小。
const T0 = 40, KIND = "push";
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0, push = KIND === "push";
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  const expoOut = (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
  if (k < 6) {
    const u = lib.seg(k, 0, 6), p3 = u ** 3;                            // power3.in
    line(ctx, tokens, lib, "Every frame", push ? 1 + 0.2 * p3 : 1 - 0.2 * p3, 10 * p3, 1 - 0.85 * u);
  } else {
    const e = expoOut(lib.seg(k, 6, 21));
    line(ctx, tokens, lib, "is code.", push ? 0.75 + 0.25 * e : 1.25 - 0.25 * e, 10 * (1 - e), 0.15 + 0.85 * e);
  }
}
function line(ctx, tokens, lib, text, s, blur, a) {
  ctx.save(); ctx.globalAlpha = a; if (blur > 0.05) ctx.filter = `blur(${blur}px)`;
  ctx.translate(960, 540); ctx.scale(s, s);
  lib.setFont(ctx, tokens, "display", 200, { weight: 700 }); ctx.fillStyle = lib.color(tokens, "fg");
  lib.drawText(ctx, text, 0, 70, { align: "center" }); ctx.restore();
}
```

## 已知坑

- **符号翻转**：拉回款的出场后面接了一个"从小长大"的入场（或反过来）。切点前后 0.1 s 各抽一帧，比一比缩放是在变大还是变小。
- **两句同屏**：交叉淡化代替硬切。
- **模糊量不对**：字用 20 px、整屏用 10 px，都不对。
- **用在正文上**：只给大标题和短句。
- **推进款还没在本仓库用过**：showcase 00 只用了拉回款；推进款的数值来自 HyperFrames 的文档，第一次用要回看。
- **还没有人工判定**：showcase 00 用拉回款做片尾字标的入场，那支片子的审阅关卡经用户授权跳过，评审只有一轮独立 reviewer（`showcase/00-promo-launch-film/NOTES.md` 的自评记录），还没有人给过判定。有人看过、给了判定，就升 `battle-tested`，把判定记在这里。

## 验收帧

- `seam`（第 6 帧，切点）：只有新句，模糊 10 px、透明度约 0.15；和第 5 帧比，缩放变化的方向相同。
- `settle`（第 21 帧）：新句清楚、落定，不再缩放。

## 来源

改写自 HyperFrames（HeyGen，Apache-2.0）`cut-the-curve` skill 的第 1、2 式和它的"Z 方向是一个符号"规则。文字重写；缩放、模糊、透明度和缓动的数值取原文；本仓库的发布片 showcase 00 用拉回款做片尾字标的入场。

**许可**：本文件修改自 [HyperFrames](https://github.com/heygen-com/hyperframes) 在 commit `a46095f` 时的 `.claude/skills/cut-the-curve/SKILL.md`（Copyright 2026 HeyGen, Inc.，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-hyperframes.txt`](../LICENSES/Apache-2.0-hyperframes.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
