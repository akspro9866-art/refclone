---
id: particle-mark
name: 散点飞来拼成标志
one_liner: 左边一片撒开的小点，带着短拖尾沿弧线飞进右边标志的形状里，左边的先走、带一点种子随机；落定的点排在标志形状内的网格上，所以标志是清楚的
family: outro
role: [outro]
intent: [sign-off, brand-imprint]
energy: 3
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [logo]
sound: recommended
pitfalls: [mechanical-stop, overuse]
qa: {peak: 30, settle: 72}
status: tuned
pairs_with: [brand-imprint-open, group-photo-launch]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 16 Particle logo 的结构和时序}
sketch_sha: "702666fa81c4"
---

# 散点飞来拼成标志 · particle-mark

## 意图

一支片子、一条短视频或一篇发布帖的落款：一把散开的点飞过来拼成标志。点落在标志形状里的网格上，所以拼完的标志是清楚的，不是一团雾；散点用种子撒，每次渲染都一样，回放也一样。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–3 | 左边一片撒开的小点，右边标志的淡虚线轮廓，左上角"Mark 01" |
| 飞行 | 3–60 | 每个点在前 1.1 s 里错开起飞，越靠左越早，加一点种子随机；各自沿一条平缓的弧线飞 1 s，身后一段短拖尾 |
| 落定 | 33–62 | 点落进标志里的网格位置；内圈的菱形是强调色 |
| 标注 | 60–66 | 右下角"assembling"换成"assembled"，虚线轮廓散去 |
| 停留 | 66–150 | 标志停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 网格落位 | 落点是标志形状内的规则网格（间距约点径的 3 倍） | 落点随机，拼出来是一团雾 | ★ |
| 种子 | 起点、起飞时刻、弧度都来自 `hash(i)` | 用 `Math.random()` 违反硬规则 1 | ★ |
| 错开 | 按起点从左到右 + 20% 随机 | 一起起飞像整体平移 | |
| 拖尾 | 3 个旧位置、越旧越淡越小 | 用运动模糊会糊掉方向 | |

## 声音

点落定时一串很密的细碎 tick 汇成一声，"assembled"那一下一个干净的音；静音也成立。

## 风格适配

- 结构参数：种子撒点、从左到右错开、弧线飞行、网格落位。
- 皮肤参数：标志的形状（用真标志的轮廓采样）、点的大小和颜色、拖尾长度。
- 量化风格：飞行按一拍二走，拖尾去掉。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const MX = 1260, MY = 540, G = 15, pts = [];
  for (let y = -240; y <= 240; y += G) for (let x = -240; x <= 240; x += G) {   // a grid inside the mark's real shape, so it lands crisp
    const r = Math.hypot(x, y), dia = Math.abs(x) + Math.abs(y) <= 115;
    if ((r >= 178 && r <= 232) || dia) pts.push({ x: MX + x, y: MY + y, dia });
  }
  ctx.save(); ctx.setLineDash([8, 8]); ctx.strokeStyle = lib.rgba(fg, 0.25 * (1 - lib.seg(t, 1.8, 2.3))); ctx.lineWidth = 2; ctx.beginPath();
  ctx.arc(MX, MY, 232, 0, lib.TAU); ctx.moveTo(MX + 178, MY); ctx.arc(MX, MY, 178, 0, lib.TAU);
  ctx.moveTo(MX, MY - 115); ctx.lineTo(MX + 115, MY); ctx.lineTo(MX, MY + 115); ctx.lineTo(MX - 115, MY); ctx.closePath(); ctx.stroke(); ctx.restore();
  const pos = (p, i, tt) => {   // seeded start, start time and arc: identical on every render
    const sx = 140 + 620 * lib.hash(i, 1), sy = 180 + 720 * lib.hash(i, 2), t0 = 0.1 + 0.75 * (sx - 140) / 620 + 0.2 * lib.hash(i, 3);
    const u = lib.ease.inOutCubic(lib.seg(tt, t0, t0 + 1.0)), cx = (sx + p.x) / 2, cy = Math.min(sy, p.y) - 120 - 160 * lib.hash(i, 4), v = 1 - u;
    return [v * v * sx + 2 * v * u * cx + u * u * p.x, v * v * sy + 2 * v * u * cy + u * u * p.y, u];
  };
  pts.forEach((p, i) => {
    const col = p.dia ? ac : fg;
    for (let k = 3; k >= 1; k--) {   // a short trail shows direction without blur
      const [x, y, u] = pos(p, i, t - k * 0.03); if (u <= 0 || u >= 1) continue;
      ctx.fillStyle = lib.rgba(col, 0.15 * (4 - k)); ctx.beginPath(); ctx.arc(x, y, 5 - k, 0, lib.TAU); ctx.fill();
    }
    const [x, y] = pos(p, i, t); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 5, 0, lib.TAU); ctx.fill();
  });
  lib.setFont(ctx, tokens, "mono", 30); ctx.fillStyle = fg; ctx.fillText("Mark 01", 140, 130);
  ctx.textAlign = "right"; ctx.fillText(t < 2.0 ? "assembling" : "assembled", W - 140, H - 110); ctx.textAlign = "left";
}
```

正式做时，落点从真标志采样：把标志画进一张离屏画布，按网格取不透明的像素点，强调色的部分取它自己的颜色。

## 已知坑

- 落点随机撒在形状里 → 网格采样，标志才清楚。
- 用 `Math.random()` 撒点，每次渲染不一样、乱序渲染对不上 → 用 `lib.hash(i, k)`。
- 每支片子都用它收尾 → 同一账号里隔几支用一次（`overuse`）。

## 验收帧

- `peak`（第 30 帧）：左边一半的点在空中，带着拖尾；最早的一批已经落进环里。
- `settle`（第 72 帧）：标志拼完，菱形是强调色，右下角写着"assembled"，虚线轮廓已散。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 16 "Particle logo"。文字重写；时序从 8 s 循环改成一次拼合加停留，按 30 fps 换算；"从真标志采样落点"的做法是本仓库加的；草图里的标志（环加菱形）是占位。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
