---
id: shutter-reveal
name: 百叶板收拢露出画面
one_liner: 整个画面被七条深色竖板盖着，竖板从左到右依次往自己的中线收窄到没有，每条带一道淡淡的亮边；露出的画面随后慢慢推近，左上角一个"新品"标签
family: fx
role: [open, hook]
intent: [enter, hook]
energy: 3
duration_f: [45, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [photo]
sound: recommended
pitfalls: [uniform-timing, flash-rate]
qa: {peak: 30, settle: 60}
status: tuned
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 12 Image reveal 的结构和时序}
sketch_sha: "82033d51561d"
---

# 百叶板收拢露出画面 · shutter-reveal

## 意图

预告一件新品、一张主视觉：画面先被盖住，竖板一条接一条收拢，像拉开一扇百叶窗。每条竖板带一道亮边，读起来是实物，不是遮罩；从左到右依次走，眼睛跟着扫过画面。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–6 | 七条深色竖板盖满画面，接缝处一道道亮边 |
| 收拢 | 6–51 | 每条竖板往自己的中线收窄到没有，从左到右，每条比前一条晚 4–5 帧，每条收 18 帧 |
| 标签 | 32–42 | 左上角"新品"标签淡入 |
| 停留 | 51–150 | 画面慢慢推近（约 4%） |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 竖板数 | 5–9 条，竖屏 4–6 条 | 太多像条码，太少像两扇门 | |
| 依次收拢 | 每条晚 4–5 帧 | 一起收像一次擦除 | ★ |
| 亮边 | 每条两侧 2 px、15–20% 白 | 去掉就是平面遮罩 | ★ |
| 收向中线 | 每条往自己的中线收 | 往一边收是另一种（擦除） | |

## 声音

每条竖板收拢时一声很轻的"嗒"，七声连成一串，音高可以一路往上；静音也成立。

## 风格适配

- 结构参数：竖板依次收向自己的中线、亮边。
- 皮肤参数：竖板的颜色（跟品牌的暗色走）、条数、方向（也可以横板）。
- 量化风格：收拢按一拍二走，亮边保留。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const k = 1 + 0.04 * lib.seg(t, 1.7, 5);   // a slow push once it is open
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2);
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, lib.mixColor(ac, bg, 0.55)); sky.addColorStop(1, lib.mixColor(ac, "#ffd9a0", 0.5));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);   // a stand-in picture: swap in the real photo
  ctx.fillStyle = lib.mixColor(ac, "#fff3c4", 0.6); ctx.beginPath(); ctx.arc(W * 0.66, H * 0.48, 130, 0, lib.TAU); ctx.fill();
  for (let j = 0; j < 3; j++) {
    ctx.fillStyle = lib.mixColor(fg, ac, 0.25 + 0.2 * j); ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H * (0.62 + 0.1 * j) - 70 * Math.sin(x / 230 + j * 2) - 35 * Math.sin(x / 97 + j));
    ctx.lineTo(W, H); ctx.fill();
  }
  ctx.restore();
  const n = 7, sw = W / n;
  for (let i = 0; i < n; i++) {   // each slat narrows to its own centre line, left to right
    const u = lib.ease.inOutCubic(lib.seg(t, 0.2 + i * 0.15, 0.8 + i * 0.15)), w = (sw + 2) * (1 - u), cx = sw * (i + 0.5);
    if (w <= 0.5) continue;
    ctx.fillStyle = lib.mixColor(fg, "#000000", 0.4); ctx.fillRect(cx - w / 2, 0, w, H);
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(cx - w / 2, 0, 2, H); ctx.fillRect(cx + w / 2 - 2, 0, 2, H);   // the light edge of a real slat
  }
  const l = lib.seg(t, 1.05, 1.4);
  if (l > 0) {
    ctx.globalAlpha = l; lib.setFont(ctx, tokens, "display", 36, { weight: 600 });
    const w = ctx.measureText("New drop").width + 48; ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(120, 100, w, 64, 32); ctx.fill();
    ctx.fillStyle = fg; ctx.fillText("New drop", 144, 145); ctx.globalAlpha = 1;
  }
}
```

## 已知坑

- 所有竖板一起收 → 依次走，每条晚 4–5 帧。
- 竖板是纯平的色块 → 加亮边，或者一点从上到下的明暗。
- 竖板深、画面亮，收拢时整屏从暗跳到亮 → 画面先压暗一点、停留时再提亮；闪的次数守【底线】，每秒不超过 3 次。

## 验收帧

- `peak`（第 30 帧）：左边三条已经收完或快收完，中间那条正在收，右边的还盖着。
- `settle`（第 60 帧）：竖板全没了，标签在左上角，画面开始推近。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 12 "Image reveal"。文字重写；时序从 8 s 循环改成一次揭开加停留，按 30 fps 换算；停留段的推近是本仓库加的；草图里的画面是程序画的占位，用时换成真照片。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
