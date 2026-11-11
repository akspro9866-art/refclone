---
id: flowing-paths
name: 光点沿路径流过节点
one_liner: 一个源头错开发出三个光点，沿弯曲的连线流向三个渠道，线是被光点一路点亮的；光点到达时节点回一圈涟漪，第二批光点汇进结果，线色从冷色渐到强调色
family: data
role: [feature, proof]
intent: [connect, process]
energy: 3
duration_f: [90, 150]
types: [promo, data, short]
engines: [canvas, hyperframes]
aspect: [landscape]
needs: [text]
sound: recommended
pitfalls: [glow-spill, uniform-timing]
qa: {peak: 45, settle: 96}
status: tuned
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 15 Flowing paths 的结构和时序}
sketch_sha: "812d5153fb8e"
---

# 光点沿路径流过节点 · flowing-paths

## 意图

讲"一份东西分发到几个渠道、再汇成一个结果"，或者一个简单的漏斗：光点走过的地方才亮，节点在光点到达时才回应，因果一眼看得见。第二波光点让停留段一直活着。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–8 | 五个节点：左边源头，中间三个渠道，右边结果；节点之间是很淡的弯线 |
| 分发 | 8–46 | 源头错开 4 帧发出三个光点，各走约 1 s 到一个渠道，走过的线被点亮；到达时渠道节点放一圈涟漪、变亮 |
| 汇合 | 53–89 | 三个渠道各发一个光点汇向结果，这三条线从冷色渐到强调色；结果节点每接到一个就亮一次 |
| 第二波 | 108–150 | 同样的路线再走一遍（更快），线已经亮着，只有光点和涟漪 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 线被光点画亮 | 亮的部分止于光点 | 线先整条亮再跑光点，因果就反了 | ★ |
| 到达才回应 | 节点在光点到的那一帧起涟漪 | 提前亮是"预告"，不是"到达" | ★ |
| 错开 | 三个光点之间 4 帧 | 同时走像一条线 | |
| 光晕 | 光点外一圈 25–30 px 的淡晕 | 晕太大，几条线糊在一起 | |

## 声音

每个光点到达时一声短促的音，三个渠道三个音高，汇进结果时一个和弦；静音时涟漪就是到达的信号。

## 风格适配

- 结构参数：光点画亮线、到达才回应、两段（分发和汇合）、第二波。
- 皮肤参数：节点的形状和文字、线的弯度、冷色和强调色。
- 量化风格：光点按一拍二跳，涟漪照常。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const cool = lib.mixColor(fg, bg, 0.35), io = lib.ease.inOutSine;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const N = { Brief: [320, 540], Email: [960, 290], Reel: [960, 540], Post: [960, 790], Report: [1600, 540] }, ch = ["Email", "Reel", "Post"];
  const path = (a, b) => { const [x0, y0] = [N[a][0] + 110, N[a][1]], [x3, y3] = [N[b][0] - 110, N[b][1]], mx = (x0 + x3) / 2;
    return (u) => { const v = 1 - u; return [v * v * v * x0 + 3 * v * u * mx + u * u * u * x3, (v * v * v + 3 * v * v * u) * y0 + (3 * v * u * u + u * u * u) * y3]; }; };
  const stroke = (f, u, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); for (let k = 0; k <= 48; k++) { const [x, y] = f(u * k / 48); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); };
  const pulse = (x, y, col) => { const g = ctx.createRadialGradient(x, y, 0, x, y, 28); g.addColorStop(0, lib.rgba(col, 0.45)); g.addColorStop(1, lib.rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 28, 0, lib.TAU); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 9, 0, lib.TAU); ctx.fill(); };
  const ring = (name, t0) => { const p = lib.seg(t, t0, t0 + 0.5); if (p <= 0 || p >= 1) return; const [x, y] = N[name];
    ctx.strokeStyle = lib.rgba(ac, 0.6 * (1 - p)); ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(x - 110 - 30 * p, y - 40 - 30 * p, 220 + 60 * p, 80 + 60 * p, 40 + 30 * p); ctx.stroke(); };
  const lit = {};
  ch.forEach((c, i) => {
    const out = path("Brief", c), into = path(c, "Report"), s1 = 0.25 + i * 0.14, s2 = 1.75 + i * 0.14;
    stroke(out, 1, lib.rgba(fg, 0.12), 3); stroke(into, 1, lib.rgba(fg, 0.12), 3);
    const u1 = io(lib.seg(t, s1, s1 + 1.0)), u2 = io(lib.seg(t, s2, s2 + 1.0));
    if (u1 > 0) stroke(out, u1, cool, 4);   // the pulse draws its line
    if (u2 > 0) for (let k = 0; k < 12; k++) { const a = k / 12, b = Math.min(u2, (k + 1) / 12); if (b > a) { ctx.strokeStyle = lib.mixColor(cool, ac, a); ctx.lineWidth = 4; ctx.beginPath(); for (let j = 0; j <= 4; j++) { const [x, y] = into(a + (b - a) * j / 4); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); } }
    if (u1 > 0 && u1 < 1) pulse(...out(u1), cool);
    if (u2 > 0 && u2 < 1) pulse(...into(u2), ac);
    const w1 = io(lib.seg(t, 3.6 + i * 0.14, 4.3 + i * 0.14)), w2 = io(lib.seg(t, 4.35 + i * 0.14, 5.05 + i * 0.14));   // the second wave keeps the hold alive
    if (w1 > 0 && w1 < 1) pulse(...out(w1), cool);
    if (w2 > 0 && w2 < 1) pulse(...into(w2), ac);
    ring(c, s1 + 1.0); ring(c, 4.3 + i * 0.14); ring("Report", s2 + 1.0); ring("Report", 5.05 + i * 0.14);
    lit[c] = t >= s1 + 1.0; lit.Report = lit.Report || t >= s2 + 1.0;
  });
  lit.Brief = t >= 0.25;
  Object.entries(N).forEach(([name, [x, y]]) => {   // a node answers when a pulse arrives
    ctx.fillStyle = lib.mixColor(bg, fg, lit[name] ? 0.1 : 0.04); ctx.strokeStyle = lit[name] ? ac : lib.rgba(fg, 0.3); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x - 110, y - 40, 220, 80, 40); ctx.fill(); ctx.stroke();
    if (lit[name]) { ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(x - 76, y, 9, 0, lib.TAU); ctx.fill(); }
    lib.setFont(ctx, tokens, "display", 38, { weight: 600 }); ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.fillText(name, x + (lit[name] ? 14 : 0), y + 13); ctx.textAlign = "left";
  });
}
```

## 已知坑

- 线先整条亮、再跑光点 → 亮的部分止于光点。
- 节点提前亮 → 涟漪从光点到达的那一帧开始。
- 光晕太大，几条线在交汇处糊成一团 → 晕的半径不超过线间距的三分之一。

## 验收帧

- `peak`（第 45 帧）：三个光点都快到渠道了，第一个渠道刚放涟漪，三条分发线各亮了一大半。
- `settle`（第 96 帧）：所有线都亮了，汇合线从冷色渐到强调色，结果节点亮着。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 15 "Flowing paths"。文字重写；时序按 30 fps 换算，第二波提前到 3.6 s、走得更快，好放进 5 s 的样片；草图是本仓库写的灰盒，节点名是占位。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
