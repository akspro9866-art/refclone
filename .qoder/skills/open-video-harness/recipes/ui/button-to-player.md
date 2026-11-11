---
id: button-to-player
name: 按钮长成播放器
one_liner: 一颗"预览"小按钮的外壳自己拉长成整个播放器，播放键一路移到中心、长出底盘，再变成暂停，原位留一个按钮的虚影
family: ui
role: [feature]
intent: [transform, interact]
energy: 3
duration_f: [66, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element]
sound: recommended
pitfalls: [uniform-timing, no-hold, fake-ui]
qa: {peak: 36, settle: 90}
status: tuned
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 01 Button → player 的结构和时序}
sketch_sha: "023b04a621bc"
---

# 按钮长成播放器 · button-to-player

## 意图

告诉观众"点这一下就能看"：同一个物体变了形，而不是从按钮淡出、播放器淡入。眼睛一直跟着那颗按钮，它长大以后还是它。落地页、发布邮件里的"看演示"时刻最合适。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–12 | 左上角一颗胶囊按钮：▶ 加"预览"二字，在暗底上停住 |
| 变形 | 12–78 | 外壳从按钮的位置拉成播放器的形状（入出都缓，三次方）；字在前 1/4 淡出；内容在后半段淡入；播放键从按钮移到播放器中心，背后长出一块暗色底盘，颜色从墨色变成面色 |
| 变暂停 | 78–90 | 约 2.6 s 时，播放图形变形成暂停（两根竖条），不是换图 |
| 停留 | 90–150 | 进度条往前爬、时间读数往上数；原位一直留着按钮的淡虚影 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 变形时长 | 66 帧（2.2 s） | 再短就成了"砰"地换图；再长像在等 | ★ |
| 内容入场 | 变形过半以后才淡入 | 提前进来会挤在半成形的壳里 | ★ |
| 虚影 | 按钮原位 15–20% 不透明的轮廓 | 去掉它，观众说不出播放器从哪来 | |
| 播放→暂停 | 两个图形之间的形变，约 12 帧 | 直接换图会跳一下 | |

## 声音

外壳开始拉长时一声轻的"展开"（低音量的 whoosh 或纸张展开），变暂停那一帧一个短 click；静音也成立。

## 风格适配

- 结构参数（跟配方走）：一个物体变形、内容后到、虚影、播放变暂停。
- 皮肤参数（跟风格走）：圆角、底色、强调色、缩略图的内容。
- 量化风格（像素风、一拍二）：变形按 12 fps 走台阶，虚影保留。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const u = lib.ease.inOutCubic(lib.seg(t, 0.4, 2.6));
  const A = { x: 220, y: 180, w: 260, h: 88, r: 44 }, B = { x: 360, y: 150, w: 1200, h: 760, r: 28 };
  const L = (k) => lib.lerp(A[k], B[k], u);
  ctx.save(); ctx.globalAlpha = 0.18; ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);   // the ghost
  ctx.beginPath(); ctx.roundRect(A.x, A.y, A.w, A.h, A.r); ctx.stroke(); ctx.restore();
  ctx.fillStyle = lib.mixColor(bg, fg, 0.12); ctx.beginPath(); ctx.roundRect(L("x"), L("y"), L("w"), L("h"), L("r")); ctx.fill();
  const label = 1 - lib.seg(t, 0.4, 0.95), inner = lib.seg(t, 2.0, 2.6);   // in once the shell is nearly its size
  lib.setFont(ctx, tokens, "display", 40, { weight: 600 }); ctx.fillStyle = fg; ctx.globalAlpha = label;
  ctx.fillText("Preview", A.x + 96, A.y + 58); ctx.globalAlpha = 1;
  if (inner > 0) {
    ctx.globalAlpha = inner;
    ctx.fillStyle = lib.mixColor(bg, fg, 0.22); ctx.fillRect(B.x + 40, B.y + 40, B.w - 80, B.h - 220);          // thumbnail
    lib.setFont(ctx, tokens, "display", 48, { weight: 600 }); ctx.fillStyle = fg; ctx.fillText("Spring launch", B.x + 40, B.y + B.h - 110);
    const p = lib.lerp(0.12, 0.4, lib.seg(t, 2.6, 5));
    ctx.fillStyle = lib.mixColor(bg, fg, 0.3); ctx.fillRect(B.x + 40, B.y + B.h - 60, B.w - 80, 8);
    ctx.fillStyle = ac; ctx.fillRect(B.x + 40, B.y + B.h - 60, (B.w - 80) * p, 8);
    ctx.beginPath(); ctx.arc(B.x + 40 + (B.w - 80) * p, B.y + B.h - 56, 14, 0, lib.TAU); ctx.fill();
    lib.setFont(ctx, tokens, "mono", 34); ctx.fillStyle = fg; ctx.textAlign = "right";
    ctx.fillText(`0:${String(Math.floor(lib.lerp(5, 17, lib.seg(t, 2.6, 5)))).padStart(2, "0")} / 0:42`, B.x + B.w - 40, B.y + B.h - 110);
    ctx.textAlign = "left"; ctx.globalAlpha = 1;
  }
  // the play glyph travels to the centre, grows a disc and turns into pause
  const cx = lib.lerp(A.x + 50, B.x + B.w / 2, u), cy = lib.lerp(A.y + A.h / 2, B.y + (B.h - 180) / 2 + 40, u), s = lib.lerp(1, 2.4, u);
  ctx.fillStyle = lib.mixColor(fg, bg, u); ctx.globalAlpha = u; ctx.beginPath(); ctx.arc(cx, cy, 34 * s, 0, lib.TAU); ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fill(); ctx.globalAlpha = 1;
  const m = lib.ease.inOutCubic(lib.seg(t, 2.6, 3.0));   // play → pause, a morph of two shapes
  ctx.fillStyle = lib.mixColor(fg, "#ffffff", u);
  const k = 12 * s;
  ctx.beginPath(); ctx.moveTo(cx - k * 0.8, cy - k); ctx.lineTo(cx - k * 0.8 + lib.lerp(k * 1.9, k * 0.6, m), cy + lib.lerp(0, -k, m)); ctx.lineTo(cx - k * 0.8 + lib.lerp(k * 1.9, k * 0.6, m), cy + lib.lerp(0, k, m)); ctx.lineTo(cx - k * 0.8, cy + k); ctx.fill();
  if (m > 0) { ctx.globalAlpha = m; ctx.fillRect(cx + k * 0.2, cy - k, k * 0.6, 2 * k); ctx.globalAlpha = 1; }
}
```

## 已知坑

- 内容和外壳一起长大，字会在半成形的壳里被压扁 → 内容等外壳过半再进。
- 两个元素交叉淡化（按钮淡出、播放器淡入）读起来是换页 → 永远只有一个外壳在变形。
- 停留段完全不动像卡住 → 进度条、读数一直在走。

## 验收帧

- `peak`（第 36 帧）：外壳在半路，按钮的字已经没了、播放器的内容还没进来，播放键正在途中。
- `settle`（第 90 帧）：播放器停住，暂停键在中心，原位的按钮虚影看得见。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 01 "Button → player"。文字重写；时序从原文的 8 s 循环（2.2 s 变形、停留、回到起点）改成镜头内的一次变形加停留，帧数按 30 fps 换算；草图是本仓库写的灰盒。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
