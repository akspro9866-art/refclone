---
id: my-recipe
name: 中文名
one_liner: 一句话说清这一镜做了什么
family: ui
role: [feature]
intent: [abundance]
energy: 3
duration_f: [60, 90]
types: [promo]
engines: [canvas, hyperframes]
aspect: [landscape, portrait]
needs: [ui-element]
sound: recommended
pitfalls: [too-fast, no-hold]
qa: {peak: 30, settle: 70}
status: draft
derived_from: []
---

<!-- 复制到 recipes/<family>/<id>.md，id 和文件名一致。字段和词表见 recipes/README.md；写完跑 bin/vh recipes check。
     时间一律 30 fps 的帧数，从这张配方的第 0 帧算起。全文 150 行左右。
     从别处学来的要用自己的话重写。derived_from 每项一行，例如
       - {repo: github.com/owner/name, commit: "abc1234", path: docs/card.md, license: Apache-2.0, note: 学了什么}
     来源是 Apache-2.0、MIT 或 CC-BY-4.0 的，按 recipes/README.md "写一张新配方"第 3 步带上许可原文、"许可"一段和 NOTICE 行。 -->

# 中文名 · my-recipe

## 意图

这一镜替观众回答什么问题。一两句话。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 预备 | 0–8 | … |
| 动作 | 8–30 | … |
| 跟随 | 30–40 | 谁先停、谁后停 |
| 落定 · 静止 | 40–90 | hold 至少多少帧，为什么 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| … | … | 往大调会怎样，往小调会怎样，这个值是怎么定下来的 | ★ |

★ = 命门：风格可以换皮，不能降档。

## 声音

钉在哪一帧、哪一类声音（whoosh、impact、riser、sparkle、拟音），写进 `audio/events.json` 的方式；静音时怎么办。

## 风格适配

- 结构参数（跟配方走）：…
- 皮肤参数（跟风格走）：…
- 量化风格（像素风台阶缓动、一拍二）怎么降级：…

## 实现

草图（`styles/_swatch` 场景接口，渲染方法见 recipes/README.md"草图怎么跑"），或本仓库已有实现的路径。

```js
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t);
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, lib.W, lib.H);
  // …
}
```

## 已知坑

- 每条：现象 → 原因 → 怎么做。有判例的写出处。

## 验收帧

- `peak`（第 30 帧）：看什么。
- `settle`（第 70 帧）：看什么。

## 来源

改写自 …（作者，许可）的 …；本仓库改了哪些。原创的写"本仓库原创"。

<!-- 改编自 Apache-2.0、MIT 或 CC-BY-4.0 的材料时，在这里再加一段（照现有配方的写法，check 会查）：
**许可**：本文件修改自 [项目](URL) 在 commit `abc1234` 时的 `上游路径`（Copyright …，许可），改了什么见上一段。来自上游的部分仍按原许可授权，许可全文见 [`LICENSES/<许可>-<仓库名>.txt`](../LICENSES/)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。 -->
