---
id: explainer-30s
kind: sequence
name: 30 秒讲解
one_liner: 钩子、背景、三步、一口气、兑现、回到开头；旁白定时长，接缝落在句子之间的停顿里
duration_f: [810, 990]
types: [short, promo, paper, data, math]
aspect: [landscape, portrait]
arc: [3, 2, 3, 3, 1, 4, 5, 2]
uses: [flash-cut, cut-the-curve, focus-handoff, whip-pan, breath-title-card, black-card, decode-type, zoom-through]
status: draft
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/sequences/promo-energy-arc.md, license: Apache-2.0, note: 先划 hold、高低交替、限额的方法}
---

# 30 秒讲解 · explainer-30s

有旁白的 30 s 讲解：知识短片、产品的"它怎么工作"、论文的一个核心结论。叙事按 `playbook/09-narrative.md` 的起承转合（短于 45 s 的片子只看它第 3 节的节拍表），钩子的写法见 `playbook/10-hooks-and-packaging.md`；这里把它落成能量、停顿和接缝。和发布片不同，这里的时长由旁白决定（CLAUDE.md 硬规则 2）：先写稿、生成配音、拿到每句的实测时间，再把下面的段位对到句子上。帧数是 30 fps、900 帧的参考值，实测旁白长了就整体顺延，不要压 hold。

## 能量弧

| # | 段位 | 帧 | 秒 | 能量 | 讲什么 | 配方 |
|---|---|---|---|---|---|---|
| 1 | 钩子 | 0–90 | 0–3 | 3 | 第 0.1 s 画面就有动作；旁白第一句抛出问题或承诺（2.5 s 以内） | 自创：一个具体的主体，不用抽象的开场动画；代码、数据题材的标题字可以用 [decode-type](../type/decode-type.md) |
| 2 | 背景 | 90–210 | 3–7 | 2 | 为什么要关心：一个具体的场景或数字 | 自创 |
| 3 | 第一步 | 210–360 | 7–12 | 3 | 一步一个画面，一个画面一件事 | 自创 |
| 4 | 第二步 | 360–510 | 12–17 | 3 | 在第一步的画面上继续，或者换一个空间 | 自创 |
| 5 | 一口气 | 510–600 | 17–20 | 1 | 旁白停一拍；一句字卡（旁白念它），或画面只剩慢推 | [breath-title-card](../type/breath-title-card.md) |
| 6 | 第三步 | 600–720 | 20–24 | 4 | 最有冲击的一步 | 自创 |
| 7 | 兑现 | 720–810 | 24–27 | 5 | 结论或那个数字：全片最强的一击 | 自创；结论大字用 [zoom-through](../seam/zoom-through.md) 的拉回款进场 |
| 8 | 回到开头 | 810–900 | 27–30 | 2 | 回应第 1 段的问题；落款或行动号召停到读完 | 自创 |

- **每 3–5 s 换一件事**（video-types/02 的节奏）：上表每段 3–5 s，正好一段一个新信息。
- **高低交替**：第 3、4 段都是 3，第 5 段落到 1，第 6、7 段往上冲；不要从头到尾都是 3。
- **首尾呼应**：第 8 段回到第 1 段的画面或主体，但有了变化（`templates/STORYBOARD.md` 的对照检查：结尾与开头呼应）。

## 预算

| 什么 | 先划走的 hold | 帧 |
|---|---|---|
| 每句旁白之后 | 画面在句子念完后再停 0.4–0.6 s，才切或开始下一个动作（playbook/03 §2） | 8 × 15 |
| 第 5 段一口气 | 整段 | 90 |
| 第 7 段兑现 | 最强的一击之后，停平常的两倍 | 35 |
| 第 8 段落款 | 停到读完：旁白念的字跟旁白走，没人念的字按读时规则 | 读时 |
| 合计 | | 约 245 + 读时 |

画面上和旁白同一句话的字，按字幕的规则算（跟着配音走，每条 ≥ 1.8 s；HyperFrames 里给这样的片段标 `data-read="subtitle"`，`bin/vh readcheck` 才按这条查）；画面上旁白没念的字，按画面文字的规则算（底线是够快读一遍（max(1.5 s, 汉字数 ÷ 7 + 其他字符数 ÷ 20 + 0.8 s)），舒服的时长按 BRIEF 的 Pace）。两条都能用 `bin/vh readcheck` 核。

## 接缝

接缝放在两句旁白之间的停顿里，占用的帧从停顿里划，不切在词的中间。

| 接缝 | 能量 | 用什么 |
|---|---|---|
| 1 → 2 | 3 → 2 | [flash-cut](../seam/flash-cut.md)，平面风格用 [cut-the-curve](../seam/cut-the-curve.md)；两段在同一个空间里时用 [focus-handoff](../seam/focus-handoff.md) |
| 2 → 3 | 2 → 3 | focus-handoff：同一个画面里把注意力交给第一步 |
| 3 → 4 | 3 → 3 | 同一空间用 focus-handoff；换空间用 [whip-pan](../seam/whip-pan.md) |
| 4 → 5 | 3 → 1 | flash-cut 进字卡；没有旁白念这句时，改用 [black-card](../seam/black-card.md)（黑场字卡 30 s 里最多 2 次） |
| 5 → 6 | 1 → 4 | flash-cut |
| 6 → 7 | 4 → 5 | 落在旁白重音（或配乐最强拍）上的硬切：全片第一处整画面冲击 |
| 7 → 8 | 5 → 2 | 慢慢拉回第 1 段的空间；或 focus-handoff |

全片用 flash-cut、focus-handoff 加 whip-pan 或 black-card 其中之一，一共三种。

## 限额

- 整画面冲击最多 2 处：第 7 段的兑现，最多再加第 6 段的一处。
- 字卡 1 张，黑场字卡最多 1 次（两者选一个做第 5 段）。
- 竖屏：画面文字用竖屏字号（hook 130–170 px、字幕 65–95 px），一行不超过 9–11 个汉字；关键内容放在 x 90–900、y 330–1520 的框里（playbook/03 §5）。
- 旁白不能在第 5 段停成数字静音：旁白停，配乐的底垫继续（CLAUDE.md 底线）。

## 来源

按 video-shotcraft（Vincent Wei，Apache-2.0）全片骨架 `promo-energy-arc` 的方法（先划 hold、高低交替、限额）和本仓库的旁白规则（CLAUDE.md 硬规则 2、playbook/03、playbook/04、video-types/02）排出来的，段位和帧数是本仓库的，还没有在成片里验证过。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/sequences/promo-energy-arc.md`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
