---
id: launch-15s
kind: sequence
name: 15 秒发布 teaser
one_liner: 主角一条完整的弧、一个功能冲刺、屏息一秒、最响的一击砸出字标
duration_f: [420, 480]
types: [promo, short]
aspect: [landscape, portrait, square]
arc: [3, 4, 1, 5]
uses: [spotlight-hero, whip-pan, deal-to-grid, accelerando-cuts, drop-blackout-slam, group-photo-launch]
status: draft
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/sequences/promo-energy-arc.md, license: Apache-2.0, note: 段位和先划 hold 的方法，压缩到 15 s}
---

# 15 秒发布 teaser · launch-15s

15 s 放不下 60 s 片子的四个段位，但规则一条不少：开场要有一个完整的主角，收场要是真正的峰值，中间只留一个功能，最响的那一击之前留一口气。它适合发布前的预告、社交平台上的短宣传。下面按 30 fps、450 帧、120 BPM（一拍 15 帧，一小节 60 帧）排，边界都落在拍上。

## 能量弧

| # | 段位 | 帧 | 秒 | 拍 | 能量 | 配方 |
|---|---|---|---|---|---|---|
| 1 | 主角 · 钩子 | 0–135 | 0–4.5 | 1–9 | 3 | [spotlight-hero](../open/spotlight-hero.md) |
| 2 | 功能冲刺 | 135–270 | 4.5–9.0 | 10–18 | 4 | [whip-pan](../seam/whip-pan.md) 进，[deal-to-grid](../ui/deal-to-grid.md) |
| 3 | 屏息 | 270–300 | 9.0–10.0 | 19–20 | 1 | 不换镜：满板停住，配乐抽掉鼓、留底垫，一道 riser 吸气 |
| 4 | 峰值落款 | 300–450 | 10.0–15.0 | 21–30 | 5 | [group-photo-launch](../outro/group-photo-launch.md)，只叫回 4–5 个元素 |

- **钩子不另做**：聚光灯在第 0.1 s 亮起、开始游走，这就是第一个事件（styles/_swatch 的内容规格：第一个事件在 0.1 s，而且要看得见）。15 s 的片子不单独做钩子镜头，主角一出场就是钩子。
- **一个功能**：选最有"量"或最有"手感"的那一个。产品有好几个画面值得看时，第 2 段换成 [accelerando-cuts](../rhythm/accelerando-cuts.md)（4.3–4.8 s），它的最后一刀定格正好接屏息。
- **屏息**：第 3 段只有 1 s，是高潮之前的戏剧逗号（playbook/03 §2 要求 0.3–0.75 s，这里给足一拍）。画面不换，靠声音做"吸气"。想更狠，把第 3、4 段的开头换成 [drop-blackout-slam](../rhythm/drop-blackout-slam.md)：12 帧空的黑，再砸出字标（黑场里保留一层低音底）。

## 预算

| 镜头 | 先划走的 hold | 帧 |
|---|---|---|
| 1 主角 | 落回槽位后锁死，也是甩镜之前的静止 | 20 |
| 2 功能 | 满板静止（第 236–270 帧） | 34 |
| 3 屏息 | 整段 | 30 |
| 4 落款 | 字标和标语完整后停到读完，最后 12 帧淡出 | 读时 + 12 |
| 合计 | | 约 96 + 读时 |

主角的配方要 145–160 帧（锁定到落地约 3.3 s 是判例定下的，不能压）。这一段只给了 135 帧，所以把主角开头"找"的那一段从 32 帧压到 17 帧（中间站减到 2 个），动作弧不动，落地后锁 20 帧（配方要 ≥ 15 帧，甩镜要求甩之前 ≥ 20 帧的静止）：17 + 16 + 10 + 54 + 18 + 20 = 135。甩镜在第 143 帧落位，先静止 20 帧再开始发牌的预备拍；发牌段 88 帧，最后一张在第 236 帧落定，之后满板静止，一直延续到屏息结束。

## 接缝

| 接缝 | 能量 | 用什么 |
|---|---|---|
| 片头 | | 主角全景 8 帧淡入（配方自带） |
| 1 → 2 | 3 → 4 | [whip-pan](../seam/whip-pan.md) 基本款，8 帧，从第 135 帧（第 10 拍）起甩；方向和主角推近的方向一致 |
| 2 → 3 | 4 → 1 | 不换镜：发牌的满板静止直接延长成屏息 |
| 3 → 4 | 1 → 5 | 落在第 6 小节强拍（第 300 帧）上的硬切：全片第一处整画面冲击 |
| 片尾 | | 落款最后 12 帧淡出，配乐的尾音接住 |

## 限额

- 整画面冲击最多 2 处：第 300 帧那一击，最多再加主角弹起时的一记；15 s 里超过 2 处就只剩吵。
- 不用字卡和黑场字卡：连压印带停留，一张就要 3 s 上下，15 s 的片子放不下；屏息就是这支片子的呼吸位。
- 闪白最多 1 次；甩镜只用 1 次。
- 竖屏：主角推近后竖着构图（卡落在关键内容框里），合影的 4–5 个元素上下排列，字标放在 y≈0.3H（playbook/03 §5）。

## 来源

按 video-shotcraft（Vincent Wei，Apache-2.0）全片骨架 `promo-energy-arc` 的规则（低开主角、先划 hold、峰值收场、限额）压缩到 15 s，拍号和帧数是本仓库排的，还没有在成片里验证过。"主角一出场就是钩子"来自本仓库样片的内容规格（`styles/_swatch/README.md`）；屏息的做法和本仓库一次拉片的观察一致：一支 174 BPM 的 showreel（@tkm_hmng8，2026-09-30）在最后一记之前留了约 2 s 近静音。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/sequences/promo-energy-arc.md`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
