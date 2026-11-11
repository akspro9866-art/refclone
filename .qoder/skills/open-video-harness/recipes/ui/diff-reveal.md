---
id: diff-reveal
name: 改动按行显出来
one_liner: 代码或文档的改动一行行显出来：先标删除（底色从左铺开、减号），再插入新增的行（把下面的行推开、加号），左边一列标记；一屏不超过 8 行改动
family: ui
role: [proof, feature]
intent: [compare, transform]
energy: 2
duration_f: [45, 120]
types: [promo, short, paper]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [text]
sound: optional
pitfalls: [copy-drift, sub-threshold]
qa: {peak: 39, settle: 66}
status: tuned
pairs_with: [terminal-run, strike-replace]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/diff-reveal/README.md, license: MIT, note: 规则（先删后加、加减号和颜色并用、一屏不超过 8 行）}
sketch_sha: "c5d082970017"
---

# 改动按行显出来 · diff-reveal

## 意图

讲一次代码评审、一份文档的两个版本：改了哪几行、往哪个方向改，一眼看得出。先删后加，顺序就是改动的逻辑；加减号和颜色一起用，不只靠红绿。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 原文 | 0–15 | 代码在那里，文件名和改动计数在上方 |
| 删 | 15–27 | 两行删除依次标出：淡红底色从左铺开，左边出减号，每行晚 4–5 帧 |
| 加 | 33–57 | 三行新增依次插进来：行高从 0 长出来、把下面的行推开，淡绿底色、加号，每行晚 6 帧 |
| 停留 | 57– | 计数停在"+3 −2" |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 顺序 | 先删后加 | 一起出来，看不出因果 | ★ |
| 标记 | 加减号加颜色 | 只有红绿，色弱分不出 | ★ |
| 改动行数 | 一屏不超过 8 行 | 多了就是一墙颜色 | |
| 插入 | 新行把下面的推开 | 新行一下出现，下面的行一跳 | |

## 声音

可以不配。

## 风格适配

- 结构参数：先删后加、加减号、新增行推开下文。
- 皮肤参数：代码配色、字体、两种底色。
- 量化风格：按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const add = "#2f9e62";   // state colours: removed (accent) and added (green), each with its own sign
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const lines = [
    [" ", "export function renderAt(t, ctx) {"], [" ", "  const u = seg(t, 0.2, 0.8);"],
    ["-", "  ctx.globalAlpha = u;", 0.5], ["-", "  ctx.fillText(title, x, y);", 0.65],
    ["+", "  const k = ease.outCubic(u);", 1.1], ["+", "  ctx.globalAlpha = k;", 1.3], ["+", "  ctx.fillText(title, x, y + 24 * (1 - k));", 1.5],
    [" ", "}"],
  ];
  const X = 300, Wd = 1320, LH = 66;
  ctx.fillStyle = lib.mixColor(bg, fg, 0.04); ctx.beginPath(); ctx.roundRect(X, 150, Wd, 800, 24); ctx.fill();
  lib.setFont(ctx, tokens, "mono", 32); ctx.fillStyle = fg; ctx.fillText("title.js", X + 40, 210);
  const nDel = lines.filter((l) => l[0] === "-" && t >= l[2]).length, nAdd = lines.filter((l) => l[0] === "+" && t >= l[2]).length;
  ctx.fillStyle = add; ctx.fillText(`+${nAdd}`, X + Wd - 190, 210); ctx.fillStyle = ac; ctx.fillText(`−${nDel}`, X + Wd - 100, 210);
  let y = 270;
  lines.forEach(([m, s, at]) => {
    const h = m === "+" ? lib.ease.outCubic(lib.seg(t, at, at + 0.25)) : 1;   // an added line grows in and pushes the rest down
    if (h <= 0) return;
    ctx.save(); ctx.beginPath(); ctx.rect(X, y, Wd, LH * h); ctx.clip();
    if (m === "-") { const u = lib.ease.outCubic(lib.seg(t, at, at + 0.25)); ctx.fillStyle = lib.mixColor(ac, bg, 0.82); ctx.fillRect(X, y, Wd * u, LH); }
    if (m === "+") { ctx.fillStyle = lib.mixColor(add, bg, 0.82); ctx.fillRect(X, y, Wd, LH); }
    const shown = m === " " || t >= at;
    lib.setFont(ctx, tokens, "mono", 36); ctx.fillStyle = m === "-" && shown ? ac : m === "+" ? add : lib.mixColor(fg, bg, 0.5);
    ctx.fillText(m === " " || !shown ? " " : m === "-" ? "−" : "+", X + 30, y + 45);
    ctx.fillStyle = fg; ctx.fillText(s, X + 80, y + 45); ctx.restore();
    y += LH * h;
  });
}
```

## 已知坑

- 加和删同时出来 → 先删后加。
- 只用红绿 → 加上 + 和 −。
- 改动太多，一屏全是颜色 → 每屏不超过 8 行改动，其余折叠。
- 改动是编的 → 用真实的提交。

## 验收帧

- `peak`（第 39 帧）：两行删除已标出，第一行新增正在长出来。
- `settle`（第 66 帧）：三行新增都在，计数是"+3 −2"。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 diff-reveal。文字重写；规则沿用卡片，按 30 fps 换算；"新增行把下文推开"和草图是本仓库写的，代码是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/diff-reveal/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
