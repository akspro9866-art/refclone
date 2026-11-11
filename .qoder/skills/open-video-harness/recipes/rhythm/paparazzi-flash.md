---
id: paparazzi-flash
name: 连闪定格
one_liner: 三次快门白闪，每闪硬切同一素材的一个更近的裁切（全景 → 卡片 → 数字），最后停在那个数字上
family: rhythm
role: [proof, climax]
intent: [punctuate, count]
energy: [4, 5]
duration_f: [125, 135]
types: [promo, data, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-page, number]
sound: required
pitfalls: [flash-rate, no-hold, sound-dependent, overuse]
qa: {peak: 70, settle: 110}
status: tuned
max_per_film: 1
pairs_with: [breath-title-card]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/rhythm/beat-cut-moves.md, license: Apache-2.0, note: 两式中的 B 式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/rhythm/beat-cut-moves/PaparazziFlash.tsx, license: Apache-2.0, note: 闪点、白层衰减、快门余韵、三个裁切}
sketch_sha: "eff0f96be1c3"
---

# 连闪定格 · paparazzi-flash

## 意图

高光时刻的仪式感：像颁奖时的一串快门，三次白闪，每闪一下画面就被"拍"得更近一层，最后停在那个关键数字上。它给一个数字或一个结果加冕，是证据段的最后一击。

## 阶段与时值

第 0 帧 = 活的素材镜头开始。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 活素材 | 0–30 | 中景缓慢推近（1.16 → 1.2 倍）：闪之前画面必须是活的 |
| 第一闪 | 30 | 硬切到全景 + 白闪 |
| 第二闪 | 52 | 硬切到卡片特写（2.3 倍）+ 白闪；间隔 22 帧 |
| 第三闪 | 70 | 硬切到数字特写（4.0 倍）+ 白闪；间隔 18 帧 |
| 定格 | 70–130 | 停在数字上 60 帧 |

每一闪：白层从 0.95 在 4 帧内衰减到 0（ease-out）；白闪的那几帧整画面有 ±2 px 的快门震动；切入的画面从 1.03 倍、上移 16 px 在 6 帧内回落到位（快门余韵）。

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 闪点 | 30 / 52 / 70，间隔 22 → 18 帧，渐紧 | 等距读作幻灯片；三闪在 40 帧里，任何 1 秒里最多 2 闪，守住每秒 3 次的底线 | ★ |
| 白层 | 0.95 起，4 帧衰减 | 0.95 才有闪光灯的爆点；衰减超过 6 帧就成了柔光转场，失去快门感 | |
| 快门余韵 | 切入的画面 1.03 → 1、上移 16 px → 0，6 帧 | 去掉余韵，三闪读作翻页 | |
| 三个裁切 | 同一个素材：1.0 全景 / 2.3 卡片 / 4.0 数字，一层比一层近 | 顺序乱了（特写 → 全景 → 特写）读作剪错了；换了素材就不是"被拍到" | ★ |
| 闪之前 | 活的素材，慢推 | 闪之前是死图，读不出"定格" | |
| 定格 | 第三闪后停 60 帧 | 三闪是重击，hold 要给到平常的两倍以上；数字要读，读时规则（BRIEF 的 Pace）要得更长时再加长 | ★ |
| 次数 | 全片 1 次；和 [accelerando-cuts](accelerando-cuts.md) 一样，都算一处整画面冲击 | 第二次出现，第一次就白打了 | ★ |

## 声音

没有声音不成立：每一闪一声快门（真实的相机快门拟音），三声渐紧，钉在闪的同一帧；定格时配乐给一个延音或和弦，不能停成数字静音。钉帧写相对这个镜头起点的表达式。

## 风格适配

- 结构参数：三闪渐紧、同一素材一层比一层近、余韵、定格的长度。
- 皮肤参数：闪光的颜色（暗底风格可以用强调色的闪，不用纯白）、快门震动的幅度。
- 竖屏：三个裁切竖着构图，数字放在关键内容框的中心。
- 数字本身可以接一个滚动计数（在第三闪之前就滚完，闪的那一刻是定值）。

## 实现

```js
// paparazzi-flash：0–30 活素材慢推 → 30 / 52 / 70 三闪，每闪硬切一个更近的裁切 → 停在数字上。
const F = [30, 52, 70], VIEWS = [[1.0, 960, 540], [2.3, 1170, 330], [4.0, 1170, 345]];
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t);
  let seg = -1; F.forEach((x, i) => { if (f >= x) seg = i; });
  let z, cx, cy, sy = 0;
  if (seg < 0) { z = 1.16 + 0.04 * lib.ease.inOutCubic(lib.seg(f, 0, 30)); cx = 900; cy = 480; }   // 活素材：慢推
  else { [z, cx, cy] = VIEWS[seg]; const u = 1 - (1 - lib.seg(f, F[seg], F[seg] + 6)) ** 3; z *= 1 + 0.03 * (1 - u); sy = -16 * (1 - u); }
  const inFlash = F.some((x) => f >= x && f < x + 4);
  const jx = inFlash ? 2 * lib.hashS(3, f) : 0, jy = inFlash ? 2 * lib.hashS(5, f) : 0;
  ctx.save(); ctx.translate(960 + jx, 540 + jy + sy); ctx.scale(z, z); ctx.translate(-cx, -cy);
  footage(ctx, tokens, lib); ctx.restore();
  let flash = 0; for (const x of F) if (f >= x && f <= x + 4) flash = Math.max(flash, 0.95 * (1 - lib.seg(f, x, x + 4)) ** 2);
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, 1920, 1080); }
}
function footage(ctx, tokens, lib) {                                   // 同一个素材：一页看板，第一行中间那张卡上有个大数字
  const fg = lib.color(tokens, "fg"), bg = lib.color(tokens, "bg");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(3, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = lib.rgba(fg, 0.35); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(3, i, 1), 16);
  }
  lib.setFont(ctx, tokens, "display", 104, { weight: 700 }); ctx.fillStyle = lib.color(tokens, "accent");
  lib.drawText(ctx, "84,213", 1170, 380, { align: "center" });
}
```

## 已知坑

- **闪太多、太密**：三闪之外再加闪，或者把间隔压到 10 帧以内，就碰到"全屏闪白每秒不超过 3 次"的底线（CLAUDE.md），也对光敏观众不友好。
- **无声版**：没有快门声，三闪只是三次白屏。
- **闪之前是死图**：必须先让画面在动，定格才有落差。
- **定格太短**：重击之后的 hold 是平常的两倍以上；数字还要读，按读时规则算。
- **不是判例**：demo 在灰阶占位素材上调过，第一次用在真实素材上要回看。

## 验收帧

- `peak`（第 70 帧，第三闪）：白层最亮的那一帧，画面已经是数字特写；前后一帧里没有过渡帧。
- `settle`（第 110 帧）：停在数字上，完全静止，数字清楚、够大。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）节奏卡 `beat-cut-moves` 的 B 式和 demo `PaparazziFlash.tsx`。文字重写；闪点、白层衰减、快门震动、余韵、三个裁切的倍率和定格长度取原值；闪烁底线的核算和暗底的替代做法是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/rhythm/beat-cut-moves.md`、`demos/rhythm/beat-cut-moves/PaparazziFlash.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
