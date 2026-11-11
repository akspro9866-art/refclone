---
id: spring-fan
name: 一摞卡弹簧扇开
one_liner: 三张叠在一起的卡各按不同阻尼的弹簧扇开，最上面那张阻尼最小、摆过头再晃回来；虚线虚影标出它的静止角度，角上拖一串点，角落的小曲线图同步走
family: ui
role: [feature, proof]
intent: [abundance, compare]
energy: 3
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, square, portrait]
needs: [ui-element, text]
sound: optional
pitfalls: [mechanical-stop, uniform-timing]
qa: {peak: 18, settle: 66}
status: tuned
pairs_with: [deal-to-grid]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 07 Spring stack 的结构和时序}
sketch_sha: "126ec585f7f7"
---

# 一摞卡弹簧扇开 · spring-fan

## 意图

一次亮出三个方案、三个案例或三条评价：整整齐齐的一摞，扇开成三张。好看在"弹簧"而不是缓动曲线，而且每张的阻尼不一样：后面的稳、前面的活，最上面那张摆过头再晃回来。虚影和角落的曲线小图不用一个字就把物理讲明白了。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 三张卡叠成一摞，同一个角度，只看得见最上面那张：图、名字、价格、一个勾选按钮 |
| 扇开 | 9–54 | 三张卡绕底边中点各自按弹簧转到自己的角度；最上面那张先走，中间和后面晚 1–2 帧；最上面那张摆过静止角再晃回来 |
| 讲解 | 9–66 | 虚线虚影标出最上面那张的静止角度；它摆动时角上拖一串强调色的点；右下角的小曲线图上一个点沿着弹簧曲线同步走 |
| 停留 | 66–150 | 三张卡停在扇形里，虚影和拖尾散去 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 阻尼（后 / 中 / 前） | ζ ≈ 1.0 / 0.7 / 0.32 | 三张一样的阻尼，就是一个整体在转 | ★ |
| 弹簧本身 | 闭式弹簧，ω ≈ 7 rad/s，约 1.5 s 停稳 | 用缓动曲线模仿回弹，停的那一下是机械的 | ★ |
| 先后 | 前面那张领头，其余晚 0.05 s、0.1 s | | |
| 虚影和曲线小图 | 可选 | 讲"弹性"这个卖点时留着，否则可以拿掉 | |

## 声音

最上面那张摆过头时一声轻的"嗒"，停稳时没有声音；静音也成立。

## 风格适配

- 结构参数：每张一个弹簧、阻尼从后往前递减、领头的先走。
- 皮肤参数：卡的样子、扇开的角度、阴影。
- 量化风格：按一拍二取弹簧的值，摆动仍然看得出。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const surf = lib.mixColor(bg, fg, 0.04), line = lib.mixColor(bg, fg, 0.25);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const PX = W / 2, PY = 900, CW = 420, CH = 560, D = Math.PI / 180;
  const cards = [{ to: -16, zeta: 1.0, t0: 0.4 }, { to: -3, zeta: 0.7, t0: 0.35 }, { to: 11, zeta: 0.32, t0: 0.3 }];   // back, middle, top
  const ang = (c, tt) => (-2 + (c.to + 2) * lib.spring(tt - c.t0, { w: 7, zeta: c.zeta })) * D;
  const corner = (a) => [PX + (CW / 2) * Math.cos(a) + CH * Math.sin(a), PY + (CW / 2) * Math.sin(a) - CH * Math.cos(a)];
  const card = (a, i) => {
    ctx.save(); ctx.translate(PX, PY); ctx.rotate(a);
    ctx.shadowColor = "rgba(0,0,0,0.12)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.fillStyle = surf; ctx.beginPath(); ctx.roundRect(-CW / 2, -CH, CW, CH, 24); ctx.fill(); ctx.shadowColor = "transparent";
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = [lib.mixColor(ac, bg, 0.6), lib.mixColor(ac, fg, 0.3), ac][i]; ctx.beginPath(); ctx.roundRect(-CW / 2 + 24, -CH + 24, CW - 48, 300, 16); ctx.fill();
    const [name, price] = [["Winter kit", "$52"], ["Autumn kit", "$44"], ["Summer kit", "$48"]][i];
    lib.setFont(ctx, tokens, "display", 44, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText(name, -CW / 2 + 28, -CH + 392);
    lib.setFont(ctx, tokens, "display", 36, { weight: 500 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.4); ctx.fillText(price, -CW / 2 + 28, -CH + 444);
    if (i === 2) { ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(CW / 2 - 70, -70, 36, 0, lib.TAU); ctx.fill();
      ctx.strokeStyle = bg; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(CW / 2 - 86, -70); ctx.lineTo(CW / 2 - 74, -58); ctx.lineTo(CW / 2 - 52, -84); ctx.stroke(); }
    ctx.restore();
  };
  card(ang(cards[0], t), 0); card(ang(cards[1], t), 1);
  const g = lib.env(t, 0.3, 2.4, 0.2, 0.5);
  if (g > 0) {   // the top card's resting angle, as a dashed ghost
    ctx.save(); ctx.translate(PX, PY); ctx.rotate(cards[2].to * D); ctx.globalAlpha = 0.4 * g; ctx.setLineDash([12, 10]);
    ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(-CW / 2, -CH, CW, CH, 24); ctx.stroke(); ctx.restore();
  }
  card(ang(cards[2], t), 2);
  const sp = Math.abs(ang(cards[2], t) - ang(cards[2], t - 1 / 30)) / D;
  for (let k = 1; k <= 6; k++) {   // a short trail of dots behind the swinging corner
    const [x, y] = corner(ang(cards[2], t - k * 0.035));
    ctx.fillStyle = lib.rgba(ac, 0.7 * (1 - k / 7) * lib.clamp(sp / 1.2)); ctx.beginPath(); ctx.arc(x, y, 8 - k * 0.8, 0, lib.TAU); ctx.fill();
  }
  const bx = W - 460, by = H - 300, bw = 340, bh = 200, iy = (s) => by + bh - 30 - (bh - 60) * s / 1.4;   // the curve inset
  ctx.globalAlpha = g; ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(bx, iy(1)); ctx.lineTo(bx + bw, iy(1)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.beginPath();
  for (let k = 0; k <= 60; k++) { const tau = 2 * k / 60, x = bx + 20 + (bw - 40) * k / 60, y = iy(lib.spring(tau, { w: 7, zeta: 0.32 })); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  const tau = lib.clamp(t - 0.3, 0, 2); ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(bx + 20 + (bw - 40) * tau / 2, iy(lib.spring(tau, { w: 7, zeta: 0.32 })), 9, 0, lib.TAU); ctx.fill();
  lib.setFont(ctx, tokens, "mono", 26); ctx.fillStyle = fg; ctx.fillText("spring  ζ 0.32", bx, by - 16); ctx.globalAlpha = 1;
}
```

## 已知坑

- 用 `outBack` 之类的缓动假装弹簧：每张一样、停的那一下很硬 → 用闭式弹簧（`lib.spring`），每张自己的阻尼。
- 三张同时起步 → 领头的先走，其余晚 1–2 帧。
- 停留段还在晃 → 弹簧要在 1.5–1.8 s 内停稳，停住以后的画面要能读。

## 验收帧

- `peak`（第 18 帧）：最上面那张摆过了虚影的角度，角上的拖尾最长，曲线小图上的点在过冲的峰上。
- `settle`（第 66 帧）：三张卡停在扇形里，虚影正在散去。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 07 "Spring stack"。文字重写；时序从 8 s 循环改成一次扇开加停留，按 30 fps 换算；弹簧用本仓库 `lib.spring` 的闭式解（每一帧是 t 的纯函数），草图是本仓库写的灰盒。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
