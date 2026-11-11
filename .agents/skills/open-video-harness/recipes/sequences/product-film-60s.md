---
id: product-film-60s
kind: sequence
name: 60 秒产品发布片
one_liner: 低开品牌、单主角立传、功能镜头和呼吸字卡交替爬升、发布会收场
duration_f: [1650, 1950]
types: [promo]
aspect: [landscape, portrait]
arc: [1, 3, 1, 4, 3, 3, 1, 4, 2, 1, 5, 5]
uses: [brand-imprint-open, spotlight-hero, breath-title-card, deal-to-grid, type-and-filter, oversized-cursor, portal-wipe, row-embed, doc-self-writing, flash-cut, focus-handoff, accelerando-cuts, paparazzi-flash, group-photo-launch]
status: draft
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/sequences/promo-energy-arc.md, license: Apache-2.0, note: 四个段位、占比、字卡密度、填空流程}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: template/TEMPLATE.md, license: Apache-2.0, note: 36 s 模板片的镜头表，本骨架按 60 s 重排}
---

# 60 秒产品发布片 · product-film-60s

多功能的 web 或桌面产品，一支 60 s 的发布片。结构来自 shotcraft 的模板片（36.2 s、10 镜）和它的全片骨架，按本仓库的读时规则和 60 s 的长度重排。下面的帧数是 30 fps、1800 帧的例子；功能镜头的个数按产品的功能清单增减。

## 能量弧

| # | 段位 | 镜头 | 帧 | 秒 | 能量 | 配方 |
|---|---|---|---|---|---|---|
| 1 | ① 品牌开场 | 字标落定 | 0–140 | 0–4.7 | 1 | [brand-imprint-open](../type/brand-imprint-open.md) |
| 2 | ② 单主角立传 | 产品的原子单位 | 140–285 | 4.7–9.5 | 3 | [spotlight-hero](../open/spotlight-hero.md) |
| 3 | ③ 呼吸 1 | 引出第一组功能的字卡 | 285–390 | 9.5–13.0 | 1 | [breath-title-card](../type/breath-title-card.md) |
| 4 | ③ 功能 A | 数量：内容很多、源源不断 | 390–510 | 13.0–17.0 | 4 | [deal-to-grid](../ui/deal-to-grid.md) |
| 5 | ③ 功能 B | 交互：跟着操作一遍（打字、筛选、点击） | 510–660 | 17.0–22.0 | 3 | [type-and-filter](../interaction/type-and-filter.md)，可由 [oversized-cursor](../interaction/oversized-cursor.md) 的点击触发 |
| 6 | ③ 功能 B 详情 | 点开之后看到的东西 | 660–810 | 22.0–27.0 | 3 | [row-embed](../ui/row-embed.md)（由 [portal-wipe](../seam/portal-wipe.md) 带进来） |
| 7 | ③ 呼吸 2 | 引出下一组功能 | 810–915 | 27.0–30.5 | 1 | breath-title-card |
| 8 | ③ 功能 C | 另一个功能，高能量 | 915–1095 | 30.5–36.5 | 4 | 自创 |
| 9 | ③ 功能 D | 信息最密的一镜：文档、报告 | 1095–1305 | 36.5–43.5 | 2 | [doc-self-writing](../ui/doc-self-writing.md) |
| 10 | ③ 呼吸 3 | 收场前最后一句话 | 1305–1410 | 43.5–47.0 | 1 | breath-title-card |
| 11 | ④ 冲刺（可选） | 同一产品的几个构图越切越快；要给一个数字加冕时换成连闪定格 | 1410–1545 | 47.0–51.5 | 5 | [accelerando-cuts](../rhythm/accelerando-cuts.md) 或 [paparazzi-flash](../rhythm/paparazzi-flash.md)，二选一 |
| 12 | ④ 发布会收场 | 每个功能派代表合影，字标落款；片尾有网址或行动号召时，落款停 3–4 s | 1545–1800 | 51.5–60.0 | 5 | [group-photo-launch](../outro/group-photo-launch.md) |

段位的占比：① + ② 约 16%（原骨架：开场 8–12%，立传 12–15%，两段合计最多 20%）；③ 约 62%（原骨架 55–65%）；④ 约 22%（原骨架 13–16%，这里多了一段可选的冲刺；不用冲刺时 ④ 是 14%，135 帧还给功能段）。

三条排法来自原骨架，模板片和两次独立复现都收敛到了这里：

- **功能段高低交替**：高能量的镜头（发牌、堆叠）和稳节奏的镜头（交互、读字段）间隔着排；连着两个高能镜头读作嘈杂。
- **信息最密的一镜排在收场前倒数第 2–3 位**（这里是第 9 镜）：观众这时已经认识了产品，读得进去。
- **每 1–2 个功能镜头后插一张呼吸字卡**，全片 2–4 张；重要功能出场之前的那张，就是它的路标。

## 预算

先把下面这些 hold 划走，再往剩下的帧里排动作：

| 镜头 | 先划走的 hold | 帧 |
|---|---|---|
| 1 字标 | 字标完整后停到读完 | 读时 |
| 2 主角 | 落回槽位后锁死 | 15 |
| 3、7、10 字卡 | 每张停到读完 | 3 × 读时 |
| 4 发牌 | 满板静止 | 15 |
| 5、6、8、9 功能 | 每镜最后一个动作落定后 | 4 × 15 |
| 11 冲刺 | 最后一刀之后 | 35 |
| 12 收场 | 落款停到读完 | 读时 |
| 合计 | | 125 + 五处读时 |

hold 占到四分之一以上是正常的：shotcraft 的判例里，用户的六次节奏反馈全部是"放慢、停留"，没有一次说太慢（判例 R3）。放不下时，先删一个功能镜头，不要压 hold。读时规则只管字最少停多久；发牌后的满板静止、冲刺后的 35 帧这类呼吸位是节奏，不按读时算，也不因为读时规则变松就跟着压短。

## 接缝

| 接缝 | 能量 | 用什么 |
|---|---|---|
| 1 → 2 | 1 → 3 | 不另加：字标上浮离场（7 帧）接主角全景淡入（8 帧），两个配方自带的首尾就是接缝 |
| 2 → 3 | 3 → 1 | 硬切进字卡，配一声 swoosh（模板片的做法） |
| 3 → 4 | 1 → 4 | [flash-cut](../seam/flash-cut.md) |
| 4 → 5 | 4 → 3 | 同一页面里镜头带过去（一镜内的运镜，11 帧 swoosh 回到搜索框），不算接缝 |
| 5 → 6 | 3 → 3 | [portal-wipe](../seam/portal-wipe.md)：点开结果卡进入详情；备选 flash-cut 加推近 |
| 6 → 7 | 3 → 1 | 硬切进字卡，同一声 swoosh |
| 7 → 8 | 1 → 4 | flash-cut |
| 8 → 9 | 4 → 2 | [focus-handoff](../seam/focus-handoff.md)（同一个产品空间里换到文档）；换空间时用 flash-cut |
| 9 → 10 | 2 → 1 | 硬切进字卡 |
| 10 → 11 | 1 → 5 | 落在最强拍上的硬切，冲刺的建立段自己开场 |
| 11 → 12 | 5 → 5 | 冲刺定格之后硬切进收场，收场的背景先虚化、crane 落下 |
| 片尾 | | 收场最后 12 帧淡出，配乐的尾音接住 |

全片用了三种接缝（flash-cut、portal-wipe、focus-handoff），加上硬切和镜头内的运镜，符合"2–3 种、反复用"（playbook/03 §6）。暗色调的片子把 3 → 4、7 → 8 换成 [dark-tunnel](../seam/dark-tunnel.md)。

## 限额

- 整画面冲击最多 3 处：冲刺的最后一刀、收场字标压印的那一击，最多再加一处（例如发牌的第一张），三处都钉在配乐最强的 hit 上，相邻两处隔 16 拍以上。
- 递进硬切串、发布会合影、聚光单主角、发牌入网格：每个全片 1 次。
- 呼吸字卡 3 张（上限 4）；黑场字卡不用，或者替换其中一张字卡。
- 光效只给主角：聚光灯和轮廓光只在第 2 镜，合影的落地光只在第 12 镜。
- 声音：收尾固定用 riser → impact → sparkle 三拍（shotcraft 判例 S2 的定稿段落）；连发的落位音用双样本交替和音量递减。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的全片骨架 `references/sequences/promo-energy-arc.md` 和模板片的镜头表 `template/TEMPLATE.md`。原骨架是 36 s 模板片的单例判例，本骨架按 60 s 重排了帧数，字卡和落款的停留改成本仓库的读时规则（原模板每张字卡 1.8 s），接缝表按 `recipes/sequences/README.md` 的能量落差规则选。还没有在本仓库的成片里验证过。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/sequences/promo-energy-arc.md`、`template/TEMPLATE.md`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
