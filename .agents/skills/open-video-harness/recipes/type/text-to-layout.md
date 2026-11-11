---
id: text-to-layout
name: 一行标题重排成整页
one_liner: 一行小字的标题拆成两半，各自飞到整页版式里的位置并长大，后一半先下落再左移、从不和前一半挤在一行；其余元素按阅读顺序到场：眉题、图、正文、引语卡
family: type
role: [feature, open]
intent: [transform, detail]
energy: 3
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [text, photo]
sound: optional
pitfalls: [copy-drift, text-blur, uniform-timing]
qa: {peak: 24, settle: 66}
status: tuned
pairs_with: [doc-self-writing]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 11 Text → layout 的结构和时序}
sketch_sha: "5cfc1175af28"
---

# 一行标题重排成整页 · text-to-layout

## 意图

把一篇文章的标题变成封面或预告：同一行字自己"排版"成整页，观众看着标题拆开、长大、落位，知道这一页就是从那一行来的。标题从不重打一遍；其余元素按阅读顺序进场，眼睛跟着读下去。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–6 | 一条虚线框里一行小字标题 |
| 拆开 | 6–32 | 标题拆成前后两半，各自飞向大标题的两行并长大；后一半先往下落（6–20），再往左移（15–32），两半从不同处一行 |
| 引线 | 24–33 | 虚线标出两半各去了哪，原来的框里留一行淡淡的旧字 |
| 到场 | 30–48 | 眉题淡入（30），配图从左往右擦开（32），正文四行依次画出（33），引语卡最后升起（36） |
| 停留 | 48–150 | 整页停住，配图里的画面慢慢漂 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 标题不重打 | 同一串字移动、长大 | 旧字淡出、新标题淡入，就是换页 | ★ |
| 后一半先落再移 | 下落和左移错开约 0.3 s | 直线斜着飞，两半会在半路叠成一团 | ★ |
| 阅读顺序 | 眉题 → 图 → 正文 → 引语，每样晚 2–3 帧 | 一起出来像截图 | |
| 旧字的虚影 | 原位 15–20% 不透明 | 可省 | |

## 声音

可以不配；配的话每样元素到场一声很轻的纸张声，越来越轻。

## 风格适配

- 结构参数：一行拆两半、后一半先落再移、阅读顺序到场。
- 皮肤参数：版式本身（栏宽、字号、配图位置）、字体、强调色。
- 量化风格：飞行按一拍二走，到场顺序不变。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const muted = lib.mixColor(bg, fg, 0.2), io = lib.ease.inOutCubic;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const SX = 560, SY = 300, a = "Design that", b = "moves people", L1 = [200, 440], L2 = [200, 590];
  lib.setFont(ctx, tokens, "display", 44, { weight: 700 });
  const off = ctx.measureText(a + " ").width;
  ctx.save(); ctx.setLineDash([10, 8]); ctx.strokeStyle = lib.rgba(fg, 0.35); ctx.lineWidth = 2; ctx.strokeRect(SX - 28, SY - 56, 640, 84);
  const g = lib.seg(t, 0.8, 1.1);
  if (g > 0) {   // where each half went, and a ghost of the old line
    ctx.globalAlpha = g; ctx.fillStyle = lib.rgba(fg, 0.18); ctx.fillText(`${a} ${b}`, SX, SY);
    ctx.strokeStyle = lib.rgba(ac, 0.55); ctx.beginPath(); ctx.moveTo(SX, SY + 12); ctx.lineTo(L1[0], L1[1] - 110); ctx.moveTo(SX + off, SY + 12); ctx.lineTo(L2[0] + 120, L2[1] - 110); ctx.stroke();
  }
  ctx.restore();
  const u1 = io(lib.seg(t, 0.2, 1.0));
  lib.setFont(ctx, tokens, "display", lib.lerp(44, 140, u1), { weight: 700 }); ctx.fillStyle = fg;
  ctx.fillText(a, lib.lerp(SX, L1[0], u1), lib.lerp(SY, L1[1], u1));
  const dn = io(lib.seg(t, 0.2, 0.65)), lf = io(lib.seg(t, 0.5, 1.05));   // the second half drops first, then slides left
  lib.setFont(ctx, tokens, "display", lib.lerp(44, 140, io(lib.seg(t, 0.2, 1.05))), { weight: 700 });
  ctx.fillText(b, lib.lerp(SX + off, L2[0], lf), lib.lerp(SY, L2[1], dn));
  const k = lib.seg(t, 1.0, 1.3);   // then the rest, in reading order
  lib.setFont(ctx, tokens, "mono", 32); ctx.fillStyle = lib.rgba(ac, k); ctx.fillText("FIELD NOTES", L1[0], 250);
  const im = io(lib.seg(t, 1.05, 1.6));
  if (im > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(1180, 330, 560 * im, 400); ctx.clip();
    ctx.fillStyle = lib.mixColor(ac, bg, 0.45); ctx.fillRect(1180, 330, 560, 400);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = lib.rgba(i % 2 ? fg : bg, 0.22); ctx.beginPath(); ctx.arc(1240 + 460 * lib.hash(i, 5) + 20 * Math.sin(t * 0.7 + i), 360 + 340 * lib.hash(i, 6), 50 + 70 * lib.hash(i, 7), 0, lib.TAU); ctx.fill(); }
    ctx.restore();
  }
  ctx.fillStyle = muted;
  [860, 900, 820, 600].forEach((w, i) => ctx.fillRect(L1[0], 680 + i * 46, w * io(lib.seg(t, 1.1 + i * 0.08, 1.5 + i * 0.08)), 20));
  const q = lib.ease.outCubic(lib.seg(t, 1.2, 1.6));
  if (q > 0) {
    ctx.globalAlpha = q; const y = 780 + 30 * (1 - q);
    ctx.fillStyle = lib.mixColor(bg, fg, 0.06); ctx.fillRect(1180, y, 560, 170); ctx.fillStyle = ac; ctx.fillRect(1180, y, 8, 170);
    lib.setFont(ctx, tokens, "display", 36, { weight: 500 }); ctx.fillStyle = fg; ctx.fillText("“Motion reads before", 1220, y + 72); ctx.fillText("words do.”", 1220, y + 120); ctx.globalAlpha = 1;
  }
}
```

HyperFrames 里两半各是一个 span，用 `transform` 移动和缩放（不要改 `font-size`，会逐帧重排）；落定以后再换成正常排版的元素，一帧之内换、位置对齐。

## 已知坑

- 两半直线斜飞，半路叠在一起 → 后一半先落、再移。
- 逐帧改字号，字的宽度一跳一跳 → 用缩放，落定后再换真排版。
- 其余元素一起淡入 → 按阅读顺序，每样晚 2–3 帧。

## 验收帧

- `peak`（第 24 帧）：前一半在飞向第一行的途中，后一半已经落下、正往左移，两半不在同一行。
- `settle`（第 66 帧）：整页齐了：眉题、两行大标题、正文、配图、引语卡；原位的旧字虚影还在。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 11 "Text → layout"。文字重写；时序从 8 s 循环改成一次重排加停留，按 30 fps 换算；HyperFrames 的写法和"缩放而不是改字号"是本仓库加的；草图是本仓库写的灰盒，引语是占位。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
