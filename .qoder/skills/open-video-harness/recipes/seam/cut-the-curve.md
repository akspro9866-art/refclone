---
id: cut-the-curve
name: 速度匹配切
one_liner: 前景加速着朝一个方向走出一小段，切点落在运动正快的时候，后景从反方向以同样的速度接着走、减速落定
family: seam
role: [seam]
intent: [carry]
energy: [2, 4]
duration_f: [16, 22]
jump: [level]
types: [promo, short, data, paper, meme]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [none]
sound: optional
pitfalls: [seam-mismatch, dead-frame]
qa: {seam: 10, settle: 20}
status: tuned
pairs_with: [oversized-cursor]
impl: [showcase/00-promo-launch-film/compositions/s-scaffold.html, showcase/00-promo-launch-film/STYLE.md]
derived_from:
  - {repo: github.com/heygen-com/hyperframes, commit: "a46095f", path: .claude/skills/cut-the-curve/SKILL.md, license: Apache-2.0, note: 第 3 式 cut the curve 的行程、镜像缓动、淡出技巧}
sketch_sha: "803da2afc392"
---

# 速度匹配切 · cut-the-curve

## 意图

最朴素、最常用的场景接缝：两个画面之间不做任何特效，靠"运动接着运动"把它们缝起来。前一个画面朝左加速离开，切点落在它最快的那一刻，后一个画面在同一个方向上以同样的速度进来、慢慢停下。观众只感觉到一股向左的"水流"，不觉得切了。HyperFrames 把它当成场景之间的默认接缝。

## 阶段与时值

第 0 帧 = 前景开始走。下面是向左的例子（其他三个方向同理）。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 出 | 0–10 | 前景从 0 走到 −230 px（画面宽度的 12%），`power4.in`：越走越快 |
| 前景淡出 | 0–9 | 透明度 1 → 0，比位移先完成：主体在走完约三成路程时（约第 7 帧）就淡没了；几个元素错开淡出，最后一个在切点前一刻淡没 |
| 切 | 10 | 后景从 +230 px、透明度 0.35 起步 |
| 进 | 10–20 | 后景从 +230 走到 0，`power4.out`：一开始最快、慢慢停下；透明度 0.35 → 1 在前 6 帧完成 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 镜像缓动 | 出 `power4.in`、进 `power4.out`，距离和时长相同 | 两半合起来就是一条 `power4.inOut`，切点两侧的速度正好相等 | ★ |
| 只走一小段 | 画面宽度的 12%（1920 宽是 230 px） | 整屏推出去再推进来，是"推拉门"，速度感反而弱 | ★ |
| 同一方向 | 后景接着前景的方向走 | 方向相反读作两段拼接；全片定一个主流向（playbook/03 §6） | ★ |
| 淡出技巧 | 前景的淡出比位移先完成（0.18–0.3 s 对 0.3–0.34 s）；后景从 0.35 的透明度"点燃" | 0 → 1 的二值出现会跳一下；前景拖着淡出又会糊成一片 | |
| 不留空档 | 最后一个淡出的元素在切点前一刻淡没 | 切点前有一段什么都不动的空档，读作卡住 | |
| 时长 | 出 0.2–0.4 s，进 ≥ 出（本仓库 showcase 00：出 0.3 s，进 0.36 s，切点处 8 px 模糊） | 进比出短，落定会显得急 | |
| 底色 | 舞台的底必须是不透明的 | 两层透明度之和在切点附近小于 1，没有底色时会闪一下白（HyperFrames `seam-craft`） | |
| 可选模糊 | 8–10 px | DOM 里不动画 blur（playbook/03 §4）：要模糊就在 canvas 层做，或者不要。showcase 00 在 DOM 里动画了 `filter: blur`，和这条规则不一致，新片不照抄这一处 | |

## 声音

可以不配。要配就用一声很短的 swish，峰值在切点。它是全片的默认接缝，每次都配声音会很吵：只在章节级的切换上配。

## 风格适配

- 结构参数：镜像缓动、12% 行程、同一方向、淡出比位移先完成。
- 皮肤参数：模糊与否、底色。
- 一拍二：出和进各取整成 5 个台阶；像素风把行程取整到像素网格。
- 文字对文字的接缝可以做成逐词版（HyperFrames 的 waterfall cut：每个词错开 0.022 s 离开，进来的词间隔逐个乘 0.84 收紧）。

## 实现

```js
// cut-the-curve：A 向左加速走 230 px（power4.in，10 帧；字 7 帧内淡没，下划线晚 2 帧，在切点前一刻淡没）
// → 第 10 帧切 → B 从 +230 px、透明度 0.35 起，以同样的速度进来、减速停下（power4.out）。
const T0 = 40, D = 230, T = 10;
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0;
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);        // 不透明的底
  if (k < T) {
    const u = lib.seg(k, 0, T);
    scene(ctx, tokens, lib, "Every frame", 5, -D * u ** 4, 1 - lib.seg(k, 0, 7), 1 - lib.seg(k, 2, 9.9));   // power4.in
  } else {
    const u = lib.seg(k, T, 2 * T), a = lib.lerp(0.35, 1, lib.seg(k, T, T + 6));
    scene(ctx, tokens, lib, "is code.", 9, D * (1 - u) ** 4, a, a);                                         // power4.out
  }
}
function scene(ctx, tokens, lib, word, seed, x, aWord, aBar) {
  ctx.save(); ctx.translate(x, 0);
  lib.setFont(ctx, tokens, "display", 180, { weight: 700 }); ctx.fillStyle = lib.rgba(lib.color(tokens, "fg"), aWord);
  lib.drawText(ctx, word, 960, 600, { align: "center" });
  ctx.fillStyle = lib.rgba(lib.color(tokens, "accent"), aBar); ctx.fillRect(760 + 60 * lib.hash(seed), 660, 400, 8);
  ctx.restore();
}
```

本仓库的发布片 `showcase/00-promo-launch-film/` 全片的场景接缝都是向左的速度匹配切：`compositions/s-scaffold.html` 里有进（`x: 230 → 0`、`power4.out`、0.36 s、透明度从 0.35 起）和出（`x: 0 → −230`、`power4.in`、0.3 s，淡出在切点前完成）的 GSAP 写法，参数表在它的 `STYLE.md`。HyperFrames 的 GSAP 模板在 `references/repos/hyperframes/_upstream_claude/skills/cut-the-curve/examples/gsap-implementation.md`（Apache-2.0，只读）。

## 已知坑

- **缓动没有镜像**：出用 `power4.in`、进用 `power2.out`，切点两侧的速度对不上，接缝会顿一下。
- **两侧都用 inOut**：两边都先慢后快再慢，切点落在速度最低的时候，就只是一次普通的硬切。
- **全屏推出**：整屏推走再推进来，速度感和连续感都不如只走 12%。
- **反向**：相邻两个接缝方向相反，观众被来回拉扯。全片一个主流向，反方向留给有含义的时刻。
- **没有底色**：切点附近会闪白。
- **还没有人工判定**：showcase 00 全片的接缝都用它，那支片子的审阅关卡经用户授权跳过，评审只有一轮独立 reviewer（`showcase/00-promo-launch-film/NOTES.md` 的自评记录），还没有人给过判定。有人看过、给了判定，就升 `battle-tested`，把判定记在这里。

## 验收帧

- `seam`（第 10 帧）：后景刚进来，透明度约 0.35，位置在 +230 px；前景已经淡没。和第 9 帧比，两层的运动方向相同。
- `settle`（第 20 帧）：后景到位，完全不透明，不再移动。

## 来源

改写自 HyperFrames（HeyGen，Apache-2.0）的 `cut-the-curve` skill 第 3 式。文字重写；行程、镜像缓动、淡出技巧、不透明底色的数值取原文；本仓库的发布片 showcase 00 全片用它做接缝（有独立 reviewer 的评审记录，见它的 NOTES.md），帧数换算和 DOM 里不动画 blur 的对齐是本仓库补的。

**许可**：本文件修改自 [HyperFrames](https://github.com/heygen-com/hyperframes) 在 commit `a46095f` 时的 `.claude/skills/cut-the-curve/SKILL.md`（Copyright 2026 HeyGen, Inc.，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-hyperframes.txt`](../LICENSES/Apache-2.0-hyperframes.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
