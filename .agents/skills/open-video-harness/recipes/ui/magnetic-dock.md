---
id: magnetic-dock
name: 光标划过的放大坞
one_liner: 一排图标在深色半透明的坞里，光标滑过时每个图标按它到光标距离的钟形曲线放大，坞围着光标变宽而不是往一边长，标签始终在最大的那个图标上方
family: ui
role: [feature]
intent: [abundance, interact]
energy: 3
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [ui-element, text]
sound: optional
pitfalls: [mechanical-stop, fake-ui]
qa: {peak: 45, read: 105}
status: tuned
pairs_with: [oversized-cursor]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 08 Magnetic dock 的结构和时序}
sketch_sha: "9c8cf2d7d734"
---

# 光标划过的放大坞 · magnetic-dock

## 意图

展示"我们接了这些工具"或"这些集成都有"：一排图标，光标划过，靠近的图标鼓起来，标签跟着走。好看在放大是一条平滑的衰减，不是"这个大、其余小"；坞围着光标变宽，所以光标下的那一点始终在光标下。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 七个一样大的图标在坞里，光标在画面右外侧 |
| 滑入 | 9–45 | 光标从右边滑到坞中间，图标随距离鼓起来，坞变宽 |
| 扫过 | 54–117 | 光标往左扫到第二个图标，再往右扫到第六个，鼓包和标签跟着走 |
| 回中 | 123–144 | 光标回到中间停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 放大曲线 | 钟形，σ ≈ 1.1 个图标间距，峰值约 1.9 倍 | σ 太小就是"只有一个变大"；太大整排一起胖 | ★ |
| 围着光标长 | 光标下的点固定不动（按放大曲线的积分排位置） | 从左端排起，整排会往右窜 | ★ |
| 标签 | 永远在当前最大的图标上方 | | |
| 衰减曲线 | 坞上方一条淡虚线画出钟形 | 可省；讲"手感"时留着 | |

## 声音

可以不配；配的话光标停下时一声很轻的 tick。

## 风格适配

- 结构参数：钟形放大、围着光标排位、标签跟着最大的。
- 皮肤参数：坞的颜色和圆角、图标的样子、光标的样子。
- 量化风格：光标位置按一拍二走，放大照公式算。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const names = ["Draw", "Notes", "Chat", "Tasks", "Files", "Calls", "Code"], S = 110, G = 128, DB = 820, sig = 140;
  const base = (i) => W / 2 + (i - 3) * G, L = base(0) - G / 2, R = base(6) + G / 2, io = lib.ease.inOutSine;
  const cx = t < 1.5 ? lib.lerp(W + 80, base(3), lib.ease.outCubic(lib.seg(t, 0.3, 1.5)))
    : t < 2.6 ? lib.lerp(base(3), base(1), io(lib.seg(t, 1.8, 2.6)))
    : t < 3.9 ? lib.lerp(base(1), base(5), io(lib.seg(t, 2.8, 3.9)))
    : lib.lerp(base(5), base(3), io(lib.seg(t, 4.1, 4.8)));
  const p = 1 - lib.seg(Math.max(L - cx, cx - R, 0), 0, 160), A = 0.9 * p, K = A * sig * Math.sqrt(Math.PI) / 2;
  const erf = (x) => { const s = Math.sign(x), a = Math.abs(x), k = 1 / (1 + 0.3275911 * a);
    return s * (1 - ((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-a * a)); };
  const X = (x) => x + K * erf((x - cx) / sig);   // the integral of the bell: the point under the cursor stays put
  const sz = (x) => S * (1 + A * Math.exp(-(((x - cx) / sig) ** 2)));
  ctx.fillStyle = lib.rgba(fg, 0.88); ctx.beginPath(); ctx.roundRect(X(L) - 24, DB - 150, X(R) - X(L) + 48, 150, 40); ctx.fill();
  if (p > 0) {   // the falloff, drawn
    ctx.save(); ctx.setLineDash([8, 8]); ctx.strokeStyle = lib.rgba(fg, 0.35 * p); ctx.lineWidth = 2; ctx.beginPath();
    for (let k = 0; k <= 80; k++) { const u = lib.lerp(L, R, k / 80), y = DB - 380 - 90 * Math.exp(-(((u - cx) / sig) ** 2)) * p; k ? ctx.lineTo(X(u), y) : ctx.moveTo(X(u), y); }
    ctx.stroke(); ctx.restore();
  }
  let big = 0;
  names.forEach((n, i) => {
    const x = X(base(i)), s = sz(base(i)); if (s > sz(base(big))) big = i;
    ctx.fillStyle = lib.mixColor(ac, i % 2 ? fg : bg, 0.12 * (i % 4)); ctx.beginPath(); ctx.roundRect(x - s / 2, DB - 20 - s, s, s, s * 0.24); ctx.fill();
    lib.setFont(ctx, tokens, "display", s * 0.42, { weight: 700 }); ctx.fillStyle = bg; ctx.textAlign = "center"; ctx.fillText(n[0], x, DB - 20 - s * 0.35); ctx.textAlign = "left";
  });
  if (p > 0.5) {   // the label always sits over the biggest icon
    const x = X(base(big)), s = sz(base(big)); lib.setFont(ctx, tokens, "display", 34, { weight: 600 });
    const w = ctx.measureText(names[big]).width + 44; ctx.globalAlpha = lib.seg(p, 0.5, 1);
    ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(x - w / 2, DB - 20 - s - 84, w, 58, 14); ctx.fill();
    ctx.fillStyle = bg; ctx.textAlign = "center"; ctx.fillText(names[big], x, DB - 20 - s - 43); ctx.textAlign = "left"; ctx.globalAlpha = 1;
  }
  const y = DB - 70;   // the cursor
  ctx.fillStyle = fg; ctx.strokeStyle = bg; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(cx, y); ctx.lineTo(cx, y + 56); ctx.lineTo(cx + 15, y + 42); ctx.lineTo(cx + 26, y + 64); ctx.lineTo(cx + 35, y + 59); ctx.lineTo(cx + 24, y + 38); ctx.lineTo(cx + 42, y + 38); ctx.closePath(); ctx.fill(); ctx.stroke();
}
```

## 已知坑

- 只有光标下那一个放大，其余不动 → 放大是距离的连续函数，邻居也要鼓一点。
- 坞从左端排起，放大时整排往右窜 → 按放大曲线的积分排位置，让光标下的点不动。
- 图标是七个灰方块 → 每个图标给一个可辨认的字或图形，标签用真名字。

## 验收帧

- `peak`（第 45 帧）：光标停在坞中间，中间的图标最大，两边依次变小，标签在它上方。
- `read`（第 105 帧）：光标往右扫的途中，鼓包和标签跟着光标，坞的宽度围着光标变。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 08 "Magnetic dock"。文字重写；时序从 8 s 循环改成滑入、扫一个来回、回中，按 30 fps 换算；"围着光标排位"用钟形的积分（误差函数）算，是本仓库的写法；图标名是占位，用时换成真的工具名或集成名。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
