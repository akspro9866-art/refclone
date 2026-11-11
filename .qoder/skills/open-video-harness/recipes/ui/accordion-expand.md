---
id: accordion-expand
name: 折叠面板展开
one_liner: 列表里一行从固定的上沿往下展开，下面的行被平滑推开让位，箭头转 180°，展开出来的内容等面板过半才按行淡入
family: ui
role: [feature]
intent: [detail, interact]
energy: 2
duration_f: [30, 75]
types: [promo, short, paper]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element, text]
sound: optional
pitfalls: [fake-ui, uniform-timing]
qa: {peak: 24, settle: 51}
status: tuned
pairs_with: [card-to-workspace]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/accordion-expand/README.md, license: MIT, note: 时序和"先量高度"的禁止项}
sketch_sha: "eb5bc28d94b5"
---

# 折叠面板展开 · accordion-expand

## 意图

一步步展开细节：设置里的高级选项、代码里折起来的一段、FAQ 的答案。展开从一条固定的边开始，周围的内容让开，观众知道新内容插在哪、和周围是什么关系。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–15 | 四行问题，都收着 |
| 展开 | 15–33 | 第二行从它的上沿往下展开到内容的实际高度（outCubic），下面两行被推下去，箭头转 180° |
| 内容 | 25–42 | 展开的内容按行淡入、略上浮，每行晚 2 帧 |
| 停留 | 42– | 停到读完 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 展开高度 | 先量内容的真实高度 | 把收起的内容当 0 高，展开时一跳 | ★ |
| 时长 | 0.6 s，outCubic | | |
| 内容入场 | 面板过半以后 | 内容和面板一起长，会被裁掉一半 | |
| 下面的行 | 跟着平滑下移 | 下面的行一下跳到位 | ★ |

## 声音

可以不配；配的话一声很轻的"展开"。

## 风格适配

- 结构参数：固定上沿、周围让位、内容后到。
- 皮肤参数：行的样式、箭头、分隔线。
- 量化风格：展开按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const rows = ["What does a film cost?", "How is a film checked?", "Can I bring my own voice?", "Who owns the result?"];
  const body = ["Every render goes through bin/vh check:", "black and frozen frames, silence, cuts that", "flash, captions against the safe area, and", "the spec of the delivery file."];
  const X = 460, Wd = 1000, RH = 120, open = lib.ease.outCubic(lib.seg(t, 0.5, 1.1)), BH = 60 + body.length * 52;   // the body's real height, measured first
  let y = 170;
  rows.forEach((r, i) => {
    ctx.strokeStyle = lib.mixColor(bg, fg, 0.18); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X, y); ctx.lineTo(X + Wd, y); ctx.stroke();
    lib.setFont(ctx, tokens, "display", 44, { weight: 600 }); ctx.fillStyle = i === 1 ? lib.mixColor(fg, ac, open) : fg; ctx.fillText(r, X + 20, y + 74);
    const a = i === 1 ? Math.PI * open : 0, cx = X + Wd - 50, cy = y + RH / 2;   // the chevron turns as it opens
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.strokeStyle = fg; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(0, 8); ctx.lineTo(14, -6); ctx.stroke(); ctx.restore();
    y += RH;
    if (i === 1) {
      const h = BH * open;   // grows from its top edge and pushes the rows below
      ctx.save(); ctx.beginPath(); ctx.rect(X, y, Wd, h); ctx.clip();
      body.forEach((l, k) => { const u = lib.ease.outCubic(lib.seg(t, 0.85 + k * 0.07, 1.25 + k * 0.07));
        ctx.globalAlpha = u; lib.setFont(ctx, tokens, "display", 38, { weight: 400 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.25); ctx.fillText(l, X + 20, y + 40 + k * 52 + 10 * (1 - u)); });
      ctx.restore(); ctx.globalAlpha = 1; y += h;
    }
  });
}
```

## 已知坑

- 展开高度没量，先当 0 再一跳 → 先量内容的真实高度，再从 0 插值到它。
- 下面的行一下跳开 → 跟着展开的高度平滑移动。
- 内容和面板一起长、被裁一半 → 面板过半再进。

## 验收帧

- `peak`（第 24 帧）：面板展开到一半多，下面的行在下移，箭头转了一半多，内容的第一行刚出现。
- `settle`（第 51 帧）：面板全开，四行内容都在，箭头朝上。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 accordion-expand。文字重写；时序和"先量高度"的说法沿用卡片，按 30 fps 换算；草图是本仓库写的，问答是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/accordion-expand/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
