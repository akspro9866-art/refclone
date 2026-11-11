---
id: flash-stitch
name: 闪帧缝合
one_liner: 两种画面媒介之间的硬切上插 1 帧（60 fps 是 2 帧）高反差的"底片"：二值、双色或负片，读不出内容，却把两边焊在一起
family: seam
role: [seam]
intent: [carry, punctuate]
energy: [4, 5]
duration_f: [1, 2]
jump: [level, rise]
types: [meme, mv, promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [none]
sound: required
pitfalls: [flash-rate, overuse, sound-dependent]
qa: {seam: 0}
status: draft
pairs_with: [accelerando-cuts]
derived_from:
  - {repo: x.com/tkm_hmng8, path: status/2105255710531674358, license: none, note: 本仓库 2026-10-01 对这支 showreel 的逐帧测量；只取手法}
sketch_sha: "d782dace1f9c"
---

# 闪帧缝合 · flash-stitch

## 意图

快剪片子里，相邻两镜常常是完全不同的画面媒介：终端、漫画、像素、3D 渲染。直接硬切，两边各说各的；在切点插 1 帧高反差的"底片"，观众读不出这一帧的内容，但眼睛记住了一次强烈的闪动，两种媒介就被焊成了同一个节拍。它是节拍乐器，不是转场特效。

## 阶段与时值

第 0 帧 = 切点后的第一帧（30 fps 插 1 帧，60 fps 插 2 帧）。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 前镜 | 到切点为止 | 前镜照常运动，切在拍上 |
| 闪帧 | 0（60 fps：0–1） | 后镜第一帧的高反差版本：二值化成两种颜色（黑 + 信号色）、双色调，或负片 |
| 后镜 | 1 起 | 后镜正常画面，接着前镜的节拍继续 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 长度 | 30 fps 1 帧，60 fps 2 帧（约 33 ms） | 更长就读得出内容，成了一张"特效图"；更短在 30 fps 下做不到 | ★ |
| 做法 | 三选一：二值（阈值 + 黑 + 信号色）、双色调（两种强调色）、负片 | 测到的三处分别是黄黑二值、红黑双色、负片；同一支片子里可以轮换 | |
| 用在哪 | 换"世界"的切点上（媒介、配色完全变了） | 同一个世界里的切点不用插；每一刀都插，就是频闪 | ★ |
| 频率 | 全屏的闪每秒不超过 3 次（CLAUDE.md 底线） | 174 BPM 一拍一切已经是每秒 2.9 次，所以只插在部分切点上 | ★ |
| 亮度 | 二值、负片都会比前后两镜亮很多；暗底片子里用双色调，把亮的那一色压到中等亮度 | 连着几次纯白的大面积闪，对光敏的观众不友好 | |
| 变体：像素拖影 | 3–4 帧：前镜被像素化并横向拖成条纹，接后镜 | 同一支片子里的另一种缝合，适合像素、复古世界之间 | |

## 声音

依赖声音：闪帧落在一个打击上（军鼓、拍手、切片的鼓），和切点同一帧。没有打击的闪帧读作画面出错。

## 风格适配

- 结构参数：1–2 帧、只在换世界的切点、每秒不超过 3 次。
- 皮肤参数：二值和双色调用哪两种颜色（取两侧世界里各自的主色，最能把它们焊在一起）。
- 安静的风格（水墨、档案推拉、水彩）不要用；它是快剪、梗视频、showreel 的语汇（`brutalist-meme` 这一类）。
- 一拍二的片子本身每 2 帧才换一次画面，闪帧就占满一个"格"：可以用，但频率减半。

## 实现

```js
// flash-stitch：两个"世界"之间在第 60 帧硬切，切点的第一帧画成后镜的二值版本（黑 + 信号色），读不出内容。
const CUT = 60;
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t);
  if (f < CUT) return worldA(ctx, tokens, lib, f);
  if (f > CUT) return worldB(ctx, tokens, lib, f);
  const B = lib.offscreen("fs-b", (x) => worldB(x, tokens, lib, f));   // 闪帧：后镜第一帧的二值版
  ctx.fillStyle = lib.color(tokens, "accent"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.filter = "grayscale(1) contrast(1000%)"; ctx.globalCompositeOperation = "multiply"; ctx.drawImage(B, 0, 0); ctx.restore();
}
function worldA(ctx, tokens, lib, f) {                                 // 世界 A：暗底等宽终端
  ctx.fillStyle = "#07090a"; ctx.fillRect(0, 0, 1920, 1080);
  lib.setFont(ctx, tokens, "mono", 44); ctx.fillStyle = "#39ff88";
  for (let i = 0; i < 9; i++) ctx.fillText("> render frame " + String(f * 9 + i).padStart(4, "0") + "  ok", 160, 220 + i * 76);
}
function worldB(ctx, tokens, lib, f) {                                 // 世界 B：亮底大色块海报
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = lib.color(tokens, "fg"); ctx.beginPath(); ctx.arc(1260, 540, 330 + 2 * (f - CUT), 0, lib.TAU); ctx.fill();
  lib.setFont(ctx, tokens, "display", 190, { weight: 800 }); ctx.fillStyle = lib.color(tokens, "accent"); ctx.fillText("NEXT", 140, 620);
}
```

canvas 的 `filter: grayscale(1) contrast(1000%)` 近似二值化，再用 `multiply` 叠在信号色上，得到"黑 + 信号色"。负片用 `filter: invert(1)`。要精确的阈值和双色调，用 `lib.shader` 写一个片元着色器。

## 已知坑

- **每一刀都插**：就成了频闪，而且很快碰到每秒 3 次的底线。只插在换世界的切点。
- **读得出内容**：闪帧超过 1 帧（30 fps），观众会去读它，它就成了一张突兀的特效图。
- **没有打击**：闪帧必须落在一个打击上。
- **未经验证**：这张配方来自对一支 showreel 的逐帧测量，本仓库还没有在成片里用过，参数是起点。

## 验收帧

- `seam`（第 0 帧）：整帧只有两种颜色（或是负片），是后镜的构图；前一帧是前镜，后一帧是后镜，都没有闪。另查：这一秒里的闪帧加上其他全屏闪，不超过 3 次。

## 来源

本仓库对一支公开 showreel 的拆解（@tkm_hmng8 的 FUNTECH SHOWREEL 2026，X，2026-09-30；49.7 s、60 fps、174 BPM）：在内存里逐帧解码测到切点处的 2 帧高反差闪帧（黄黑二值、红黑双色、负片各一处）和 3–4 帧的像素拖影。只取手法，没有使用它的任何画面、声音或文字。
