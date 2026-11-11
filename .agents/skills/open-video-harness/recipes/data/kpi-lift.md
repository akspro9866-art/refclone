---
id: kpi-lift
name: 指标卡从仪表盘里浮出来
one_liner: 四个强调色角标先卡住要讲的那张指标卡，其余仪表盘变暗，那张卡从它真实的位置和大小放大成占满画面的大卡，原位留下空槽，大卡的内容后到
family: data
role: [proof, feature]
intent: [refocus, detail]
energy: 3
duration_f: [60, 150]
types: [data, promo]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [ui-page, number]
sound: optional
pitfalls: [fake-ui, float-not-land, copy-drift]
qa: {peak: 36, settle: 75}
status: tuned
pairs_with: [chart-morph, spotlight-hero]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 06 Dashboard zoom 的结构和时序}
sketch_sha: "4e8e7c077f94"
---

# 指标卡从仪表盘里浮出来 · kpi-lift

## 意图

从一整页仪表盘里拎出真正要说的那个数。先用角标说"就是这张"，再动；卡从它在页面上的真实位置和大小长大，观众读到的是"同一张卡走近了"，不是切到另一页。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–3 | 安静的仪表盘：三张指标卡、一条趋势线、两条灰色文字条 |
| 角标 | 3–18 | 四个强调色角标从外面收拢、带一点回弹地卡住中间那张卡 |
| 变暗 | 9–45 | 仪表盘其余部分渐暗 |
| 浮起 | 21–57 | 那张卡从原位放大成大卡（入出都缓），虚线连着原位四角和大卡四角；原位留下虚线空槽 |
| 内容 | 39–72 | 大卡的标签、涨幅签和大数字淡入，迷你走势线从左往右画出 |
| 停留 | 72–150 | 大卡停住，走势线末点每 1.4 s 放一圈涟漪 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 从真实位置长大 | 起点就是那张卡在页面上的矩形 | 从画面中心弹出来，就和仪表盘断了关系 | ★ |
| 先指再动 | 角标先到，卡后动 | 一起动，观众来不及知道是哪张 | ★ |
| 原位空槽 | 浮起后原位留虚线轮廓 | 去掉也成立；留着，回放时知道它回哪 | |
| 背景变暗 | 到 25–30% 亮度 | 太暗像弹了模态框；不暗抢不过来 | |

## 声音

角标卡住时一声短 click，卡浮起时一声低音量 whoosh；静音也成立。

## 风格适配

- 结构参数：角标先到、从真实矩形长大、背景变暗、内容后到。
- 皮肤参数：卡的圆角和阴影、角标的粗细、强调色。
- 量化风格：放大按一拍二，角标的回弹保留。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const surf = lib.mixColor(bg, fg, 0.06), line = lib.mixColor(bg, fg, 0.22), muted = lib.mixColor(fg, bg, 0.4);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const tiles = [["Visits", "48,210", "+6%"], ["Signups", "12,480", "+18%"], ["Churn", "2.1%", "-0.4"]];
  const T = (i) => ({ x: 200 + i * 520, y: 150, w: 480, h: 230 }), S = T(1), Bc = { x: 360, y: 140, w: 1200, h: 800 };
  const u = lib.ease.inOutCubic(lib.seg(t, 0.7, 1.9)), R = { x: lib.lerp(S.x, Bc.x, u), y: lib.lerp(S.y, Bc.y, u), w: lib.lerp(S.w, Bc.w, u), h: lib.lerp(S.h, Bc.h, u) };
  const tile = (r, [k, v, dl], a = 1) => {
    ctx.globalAlpha = a; ctx.fillStyle = surf; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 18); ctx.fill();
    lib.setFont(ctx, tokens, "display", 30, { weight: 500 }); ctx.fillStyle = muted; ctx.fillText(k, r.x + 32, r.y + 60);
    lib.setFont(ctx, tokens, "display", 72, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText(v, r.x + 32, r.y + 160);
    lib.setFont(ctx, tokens, "display", 30, { weight: 600 }); ctx.fillStyle = ac; ctx.textAlign = "right"; ctx.fillText(dl, r.x + r.w - 32, r.y + 60); ctx.textAlign = "left"; ctx.globalAlpha = 1;
  };
  tiles.forEach((d, i) => { if (i !== 1) tile(T(i), d); });
  ctx.fillStyle = surf; ctx.beginPath(); ctx.roundRect(200, 420, 1520, 320, 18); ctx.fill();
  ctx.strokeStyle = fg; ctx.lineWidth = 4; ctx.beginPath();
  for (let i = 0; i < 24; i++) { const x = 240 + i * 62, y = 680 - 200 * (i / 23) * 0.7 - 60 * lib.hash(i, 7); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  ctx.fillStyle = line; ctx.fillRect(200, 790, 900, 24); ctx.fillRect(200, 836, 640, 24);
  if (u <= 0) tile(S, tiles[1]);
  else { ctx.save(); ctx.strokeStyle = fg; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.roundRect(S.x, S.y, S.w, S.h, 18); ctx.stroke(); ctx.restore(); }
  ctx.fillStyle = lib.rgba(bg, 0.72 * lib.ease.inOutCubic(lib.seg(t, 0.3, 1.5))); ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.globalAlpha = 0.35 * lib.env(t, 0.75, 2.1, 0.2, 0.4);
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(S.x + S.w * cx, S.y + S.h * cy); ctx.lineTo(R.x + R.w * cx, R.y + R.h * cy); ctx.stroke(); }
  ctx.restore();
  if (u > 0) {
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 50 * u; ctx.shadowOffsetY = 16 * u;
    ctx.fillStyle = lib.mixColor(bg, fg, 0.04); ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 18 + 10 * u); ctx.fill(); ctx.restore();
    const small = 1 - lib.seg(t, 0.75, 1.05);
    if (small > 0) tile({ x: R.x, y: R.y, w: S.w, h: S.h }, tiles[1], small);
  }
  const big = lib.seg(t, 1.3, 1.9);
  if (big > 0) {
    ctx.globalAlpha = big;
    lib.setFont(ctx, tokens, "display", 48, { weight: 500 }); ctx.fillStyle = muted; ctx.fillText("Signups", Bc.x + 72, Bc.y + 120);
    ctx.fillStyle = lib.rgba(ac, 0.15); ctx.beginPath(); ctx.roundRect(Bc.x + Bc.w - 252, Bc.y + 72, 180, 66, 33); ctx.fill();
    lib.setFont(ctx, tokens, "display", 40, { weight: 700 }); ctx.fillStyle = ac; ctx.textAlign = "center"; ctx.fillText("+18%", Bc.x + Bc.w - 162, Bc.y + 120); ctx.textAlign = "left";
    lib.setFont(ctx, tokens, "display", 230, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText("12,480", Bc.x + 64, Bc.y + 400);
    ctx.globalAlpha = 1;
  }
  const sp = lib.ease.inOutCubic(lib.seg(t, 1.5, 2.4));
  if (sp > 0) {   // the sparkline draws on; its last point keeps a pulse through the hold
    const pts = Array.from({ length: 12 }, (_, i) => [Bc.x + 72 + i * 96, Bc.y + 700 - i * 18 - 50 * lib.hash(i, 3)]);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, lib.lerp(pts[0][0], pts[11][0], sp) + 1, H); ctx.clip();
    ctx.strokeStyle = ac; ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
    if (sp >= 1) {
      const [x, y] = pts[11], ph = lib.fract(Math.max(0, t - 2.4) / 1.4);
      ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(x, y, 12, 0, lib.TAU); ctx.fill();
      ctx.strokeStyle = lib.rgba(ac, 0.5 * (1 - ph)); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 12 + 30 * ph, 0, lib.TAU); ctx.stroke();
    }
  }
  const b = lib.spring(t - 0.1, { w: 16, zeta: 0.6 }), ba = lib.seg(t, 0.1, 0.2) * (1 - lib.seg(t, 0.75, 1.0)), o = lib.lerp(60, 10, b);
  if (ba > 0) {   // the brackets say "this one" before anything moves
    ctx.globalAlpha = ba; ctx.strokeStyle = ac; ctx.lineWidth = 6;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = S.x + S.w / 2 + sx * (S.w / 2 + o), y = S.y + S.h / 2 + sy * (S.h / 2 + o);
      ctx.beginPath(); ctx.moveTo(x, y - sy * 40); ctx.lineTo(x, y); ctx.lineTo(x - sx * 40, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
```

## 已知坑

- 大卡从画面中心弹出来 → 起点必须是那张卡在页面上的真实矩形。
- 角标和放大同时开始 → 角标先卡住，停 3–5 帧再浮起。
- 大卡上换了一个数（12,480 变成 12.5k）→ 大卡和小卡读同一个数，格式也一样。

## 验收帧

- `peak`（第 36 帧）：卡浮到半路，背景已经暗了，角对角的虚线和原位空槽都看得见。
- `settle`（第 75 帧）：大卡停住，大数字、涨幅签和走势线齐了。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 06 "Dashboard zoom"。文字重写；时序从 8 s 循环改成一次浮起加停留，按 30 fps 换算；原位空槽和停留段的涟漪是本仓库加的；草图是本仓库写的灰盒，数是样例。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
