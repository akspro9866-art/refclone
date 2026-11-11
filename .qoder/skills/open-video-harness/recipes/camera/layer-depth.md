---
id: layer-depth
name: 页面的几层拉开纵深
one_liner: 叠得几乎平的三层（图表在后、列表居中、页面在前）从后往前依次拉开、转向同一个灭点，每层留着自己的内容；虚线引向灭点，停留时机位上下浮动，三层错开着呼吸
family: camera
role: [feature]
intent: [detail, connect]
energy: 2
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes, three]
aspect: [landscape]
needs: [ui-page]
sound: optional
pitfalls: [motion-sickness, fake-ui]
qa: {peak: 30, settle: 72}
status: tuned
pairs_with: [row-embed]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 13 Perspective shift 的结构和时序}
sketch_sha: "74ec1da78d86"
---

# 页面的几层拉开纵深 · layer-depth

## 意图

讲一个服务、一个品牌系统或一个技术栈"由哪几层组成"：平平的一页被拆开，几层错开排在纵深里。所有层朝同一个灭点，纵深才对；每层都留着真内容，观众读到的是"这东西的几层"，而不是三张灰卡。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–6 | 三层几乎重合，看上去是一页 |
| 拉开 | 6–51 | 从最后一层开始，每层晚 4–5 帧，各自沿着法线方向拉开、转到同一个角度，镜头同时往左挪一点让出灭点 |
| 引线 | 27–39 | 虚线从每层的左角引向灭点，灭点上一个小圆点 |
| 停留 | 51–150 | 机位上下缓缓浮动，远近的层位移不同（视差），整摞在呼吸 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 同一个灭点 | 所有层用同一台相机投影 | 每层各自斜切（仿射），透视就错了 | ★ |
| 每层真内容 | 图表、列表、页面各有可读的东西 | 灰卡读不出"层" | ★ |
| 从后往前 | 每层晚 4–5 帧 | 一起拉开像整体旋转 | |
| 停留的浮动 | ±40 px，周期约 3 s | 太大会晕；不动像停帧 | |

## 声音

可以不配；配的话拉开时一声低的、慢的"展开"。

## 风格适配

- 结构参数：从后往前拉开、同一灭点、每层真内容。
- 皮肤参数：层数、每层的内容、层间距、角度。
- 量化风格：拉开按一拍二走，引线照画。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const surf = lib.mixColor(bg, fg, 0.05), line = lib.mixColor(bg, fg, 0.28), muted = lib.mixColor(bg, fg, 0.18);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const LW = 900, LH = 600, F = 1100, CY = H / 2, io = lib.ease.inOutCubic, mid = io(lib.seg(t, 0.35, 1.55));
  const CX = lib.lerp(W / 2, W * 0.36, mid), cam = t > 1.7 ? 40 * Math.sin(lib.TAU * (t - 1.7) / 3.2) : 0;
  const card = (c, title) => { c.fillStyle = surf; c.fillRect(0, 0, LW, LH); c.strokeStyle = line; c.lineWidth = 4; c.strokeRect(2, 2, LW - 4, LH - 4);
    lib.setFont(c, tokens, "display", 44, { weight: 700 }); c.fillStyle = fg; c.fillText(title, 48, 84); };
  const paint = [
    (c) => { card(c, "Data"); c.strokeStyle = ac; c.lineWidth = 8; c.beginPath();
      for (let i = 0; i < 8; i++) { const x = 60 + i * 112, y = 500 - 280 * (i / 7) - 70 * lib.hash(i, 9); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); },
    (c) => { card(c, "Logic"); for (let i = 0; i < 5; i++) { c.fillStyle = i === 1 ? ac : fg; c.beginPath(); c.arc(70, 160 + i * 88, 12, 0, lib.TAU); c.fill();
      c.fillStyle = muted; c.fillRect(110, 148 + i * 88, 420 + 200 * lib.hash(i, 4), 24); } },
    (c) => { card(c, "Interface"); c.fillStyle = lib.mixColor(ac, bg, 0.5); c.fillRect(48, 130, 380, 400); c.fillStyle = muted;
      for (let i = 0; i < 6; i++) c.fillRect(470, 140 + i * 60, 360 - 60 * (i % 3), 26); },
  ];
  const th = 50 * mid * Math.PI / 180, layers = [0, 1, 2].map((i) => {   // back to front, each a beat behind, along the layers' normal
    const p = io(lib.seg(t, 0.2 + i * 0.15, 1.4 + i * 0.15)), gap = lib.lerp(8, 260, p) * (1 - i), a = 50 * p * Math.PI / 180;
    return { x: -Math.sin(a) * gap, z: 1500 + Math.cos(a) * gap, th: a };
  });
  const proj = (L, u, v) => { const X = L.x + u * Math.cos(L.th), Z = L.z + u * Math.sin(L.th); return [CX + F * X / Z, CY + F * (v - cam) / Z]; };
  layers.forEach((L, i) => {   // one camera for all three: vertical strips of the flat layer, each at its own depth
    const src = lib.offscreen(`layer-depth-${i}`, paint[i], LW, LH), N = 90;
    for (let k = 0; k < N; k++) {
      const u0 = -LW / 2 + LW * k / N, u1 = u0 + LW / N, um = (u0 + u1) / 2;
      const [x0] = proj(L, u0, 0), [x1] = proj(L, u1, 0), [, yt] = proj(L, um, -LH / 2), [, yb] = proj(L, um, LH / 2);
      ctx.drawImage(src, LW * k / N, 0, LW / N, LH, x0, yt, x1 - x0 + 0.7, yb - yt);
    }
  });
  const g = lib.seg(t, 0.9, 1.3);
  if (g > 0 && th > 0.01) {   // guides to the one vanishing point
    const vx = CX + F / Math.tan(th);
    ctx.save(); ctx.globalAlpha = g; ctx.setLineDash([10, 10]); ctx.strokeStyle = lib.rgba(fg, 0.35); ctx.lineWidth = 2; ctx.beginPath();
    layers.forEach((L) => { for (const v of [-LH / 2, LH / 2]) { const [x, y] = proj(L, -LW / 2, v); ctx.moveTo(x, y); ctx.lineTo(vx, CY); } });
    ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(vx, CY, 9, 0, lib.TAU); ctx.fill(); ctx.restore();
  }
}
```

草图用竖条切片在 canvas 2D 里做透视（绕竖轴转，竖线仍是竖线，所以每条竖条只要一个缩放）。HyperFrames 里每层是一个 DOM 元素，父容器设 `perspective` 和 `perspective-origin`，每层 `transform: translate3d(...) rotateY(...)`，数值由 t 算；层多或要光影时用 Three.js。

## 已知坑

- 每层各自斜切成平行四边形 → 用一台相机投影，所有层朝同一个灭点。
- 三层是三张灰卡 → 每层放能读出的真内容，标出它是哪一层。
- 停留时晃得太大 → 浮动 ±40 px 以内、周期 3 s 以上，【底线】里的晕动要守。

## 验收帧

- `peak`（第 30 帧）：最后一层已经拉开，中间一层在半路，最前一层刚起步，引线开始出现。
- `settle`（第 72 帧）：三层错开排在纵深里，引线和灭点都在，内容读得出。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 13 "Perspective shift"。文字重写；时序从 8 s 循环改成一次拉开加停留，按 30 fps 换算；"沿法线拉开"和竖条切片的透视做法、停留段的视差浮动是本仓库的写法；草图是本仓库写的灰盒。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
