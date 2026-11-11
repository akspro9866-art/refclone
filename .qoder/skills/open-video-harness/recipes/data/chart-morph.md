---
id: chart-morph
name: 柱子收成一条线
one_liner: 六根柱子从左到右依次收细成发丝，一条线从左往右画过它们的顶点，点逐个弹出，最后一个点挂上数值标签；前后是同一组数
family: data
role: [proof]
intent: [transform, payoff]
energy: 2
duration_f: [60, 150]
types: [data, promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [series, number]
sound: optional
pitfalls: [copy-drift, too-fast, no-hold]
qa: {peak: 39, settle: 75}
status: tuned
pairs_with: [kpi-lift]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 05 Chart morph 的结构和时序}
sketch_sha: "9685fb5031e2"
---

# 柱子收成一条线 · chart-morph

## 意图

把一周的结果放进报告或成绩贴：先用柱子让人看到每一天，再收成一条线让人看到走势。数始终是同一组，柱子变线只是换了一种看法，观众因此信它。线是画出来的，不是淡入的。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 柱状图：标题、六根柱子、浅网格线和基线；数是样例时右上角写"illustrative" |
| 收细 | 9–38 | 柱子从左到右依次收细成发丝，每根比前一根晚 2–3 帧 |
| 画线 | 27–54 | 一条平滑的线从左往右画过六个柱顶，线下的浅色填充跟着出来；线到哪个点，哪个点弹出来 |
| 标签 | 54–66 | 最后一个点（强调色）上方升起数值标签 |
| 停留 | 66–150 | 图停住，最后一个点每 1.4 s 放一圈涟漪 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 数不变 | 柱顶就是线的点 | 变形途中数变了，观众就不信了 | ★ |
| 画线方式 | 从左往右画（裁切或描边进度） | 淡入的线没有方向 | ★ |
| 柱子错开 | 每根晚 2–3 帧 | 一起收像换图 | |
| 样例标注 | 数不是真的就写"illustrative" | 不写就是编造 | ★ |

## 声音

点弹出时每个一声很轻的 tick，标签升起时一声稍亮的；静音也成立。

## 风格适配

- 结构参数：柱子依次收细、线从左往右画、点随线弹出、同一组数。
- 皮肤参数：线宽、填充的浓淡、点的大小、强调色。
- 量化风格：画线按一拍二推进，点照样随线弹出。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const grid = lib.mixColor(bg, fg, 0.12), muted = lib.mixColor(fg, bg, 0.4);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const vals = [42, 55, 48, 66, 74, 92], days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const X0 = 360, X1 = 1560, Y0 = 860, Y1 = 320;
  const px = (i) => lib.lerp(X0 + 100, X1 - 100, i / 5), py = (v) => lib.lerp(Y0, Y1, v / 100);
  lib.setFont(ctx, tokens, "display", 60, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText("Weekly reach", X0, 210);
  lib.setFont(ctx, tokens, "mono", 28); ctx.fillStyle = muted; ctx.textAlign = "right"; ctx.fillText("illustrative", X1, 210); ctx.textAlign = "left";
  ctx.strokeStyle = grid; ctx.lineWidth = 2;
  for (let g = 1; g <= 4; g++) { ctx.beginPath(); ctx.moveTo(X0, py(g * 25)); ctx.lineTo(X1, py(g * 25)); ctx.stroke(); }
  ctx.strokeStyle = fg; ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y0); ctx.stroke();
  vals.forEach((v, i) => {   // bars slim to hairlines, left to right
    const s = lib.ease.inOutCubic(lib.seg(t, 0.3 + i * 0.08, 0.75 + i * 0.08)), w = lib.lerp(120, 2, s);
    ctx.fillStyle = lib.mixColor(lib.mixColor(fg, bg, 0.25), grid, s); ctx.fillRect(px(i) - w / 2, py(v), w, Y0 - py(v));
    lib.setFont(ctx, tokens, "display", 32); ctx.fillStyle = muted; ctx.textAlign = "center"; ctx.fillText(days[i], px(i), Y0 + 52); ctx.textAlign = "left";
  });
  const P = vals.map((v, i) => [px(i), py(v)]);
  const curve = (c) => { c.moveTo(...P[0]); for (let i = 0; i < 5; i++) { const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(5, i + 2)];
    c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]); } };
  const d = lib.ease.inOutCubic(lib.seg(t, 0.9, 1.8));
  if (d > 0) {   // the line is drawn, not faded: a clip that moves left to right
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, lib.lerp(P[0][0], P[5][0], d) + 1, H); ctx.clip();
    ctx.beginPath(); curve(ctx); ctx.lineTo(P[5][0], Y0); ctx.lineTo(P[0][0], Y0); ctx.closePath(); ctx.fillStyle = lib.rgba(ac, 0.12); ctx.fill();
    ctx.beginPath(); curve(ctx); ctx.strokeStyle = fg; ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore();
  }
  P.forEach(([x, y], i) => {   // each dot pops as the line reaches it
    const p = lib.seg(d, i / 5, i / 5 + 0.12); if (p <= 0) return;
    ctx.fillStyle = i === 5 ? ac : fg; ctx.beginPath(); ctx.arc(x, y, 13 * lib.ease.outBack(p), 0, lib.TAU); ctx.fill();
  });
  const tag = lib.ease.outCubic(lib.seg(t, 1.8, 2.2));
  if (tag > 0) {
    const [x, y] = P[5]; ctx.globalAlpha = tag; ctx.fillStyle = ac; ctx.beginPath(); ctx.roundRect(x - 60, y - 110 + 20 * (1 - tag), 120, 64, 12); ctx.fill();
    lib.setFont(ctx, tokens, "display", 40, { weight: 700 }); ctx.fillStyle = bg; ctx.textAlign = "center"; ctx.fillText("92", x, y - 64 + 20 * (1 - tag)); ctx.textAlign = "left"; ctx.globalAlpha = 1;
  }
  if (t > 2.2) {   // the hold keeps a pulse on the point that matters
    const ph = lib.fract((t - 2.2) / 1.4), [x, y] = P[5];
    ctx.strokeStyle = lib.rgba(ac, 0.5 * (1 - ph)); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 13 + 34 * ph, 0, lib.TAU); ctx.stroke();
  }
}
```

## 已知坑

- 变形途中数被"顺手"改了 → 柱顶和线上的点用同一个数组。
- 线淡入 → 从左往右画，点跟着线出来。
- 样例数没有标注 → 写"illustrative"或换成真数据；真数据照抄来源。

## 验收帧

- `peak`（第 39 帧）：前几根已经是发丝，线画到一半，画过的点弹出来了。
- `settle`（第 75 帧）：线、填充和六个点齐了，最后一个点挂着标签。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 05 "Chart morph"。文字重写；时序从 8 s 循环改成一次变形加停留，按 30 fps 换算；停留段的涟漪是本仓库加的；草图是本仓库写的灰盒，数是样例。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
