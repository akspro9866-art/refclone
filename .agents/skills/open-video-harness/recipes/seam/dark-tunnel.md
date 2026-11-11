---
id: dark-tunnel
name: 穿暗场直航
one_liner: 前景顺着运动方向推出画面，穿过几帧有尘点的暗场，后景从景深里迎面放大、收焦
family: seam
role: [seam]
intent: [carry]
energy: [4, 5]
duration_f: [22, 34]
jump: [level]
types: [promo, short, paper, mv]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [none]
sound: recommended
pitfalls: [dead-frame, seam-mismatch, text-blur]
qa: {peak: 5, seam: 15, settle: 30}
status: tuned
pairs_with: [whip-pan]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/transition/shot-transitions.md, license: Apache-2.0, note: 六式中的 B 式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/transition/shot-transitions/DarkTunnelTransition.tsx, license: Apache-2.0, note: 帧数和缓动}
sketch_sha: "73633329657e"
---

# 穿暗场直航 · dark-tunnel

## 意图

两个高能量场景之间跳转，但要让观众觉得是同一条镜头一路飞过去的，没有停。前景被甩出画面，镜头穿过一小段暗场，下一个场景从深处迎面扑过来。适合暗色调的片子当主力转场。

## 阶段与时值

第 0 帧 = 前景开始推出。以下是 26 帧的中间值，三段各自可以在范围里伸缩。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 推出 | 0–10（8–12） | 前景顺着相机运动方向滑出画面，`bezier(0.45,0,0.2,1)` |
| 进暗场 | 6–14 | 暗场从 0 淡到满，压住推出的尾巴，不留纯黑帧 |
| 暗场滑行 | 14–16（4–8） | 只有暗场的微渐变和尘点，尘点和相机同向掠过 |
| 迎入 | 16–26（10–14） | 后景从 0.6 倍放大到 1、模糊 12 px 收到 0，同时沿同一方向从画面一侧滑入；暗场在 16–24 帧淡出 |
| 后景静止 | 26 起（属于后镜） | 真静止，至少 30 帧再有下一个大动作 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 运动方向 | 前景出和后景入同向（相机一路向右 → 前景向左出，后景从右边来、也向左走） | 方向对撞就读成两条片子硬拼在一起。原 demo 第一版就是写反了才改的 | ★ |
| 暗场 | 不是纯黑：中心略亮的径向渐变 + 4–20 颗尘点，尘点 6–14 px/帧向同一方向漂 | 纯黑死场读作断片；暗场超过 10 帧时必须有东西在动 | ★ |
| 进暗场的时机 | 前景出画前 4 帧就开始淡入 | 等前景完全出画再淡，会漏 2 帧纯黑 | ★ |
| 后景起点 | 缩放 0.6、模糊 12 px、偏移半屏 | 起点越小越像"从远处飞来"；小于 0.5 时看不清是什么就到了（推测） | |
| 迎入缓动 | `bezier(0.3,0,0.2,1)`，10 帧 | 前段快、落点稳；速度曲线和推出段接得上，不回摆 | |
| 总长 | 22–34 帧 | 帧从两侧镜头的预算里划走；再长就成了一段独立的"穿越"镜头 | |

## 声音

一声 whoosh（运镜类）铺满暗场，峰值落在后景迎入的第一帧附近（第 16 帧）。shotcraft 的原卡没有写这一式的声音，这里按它的产品片音效词表（运镜配 whoosh）补的。静音版照样成立。

## 风格适配

- 结构参数：同向、暗场不死、进暗场压住推出尾巴、后景从小从糊到清。
- 皮肤参数：暗场的颜色（由风格的底色压暗得到）、尘点的形状（颗粒、光斑、像素点）。
- 亮底风格也能用，但暗场会成为全片最暗的几帧，要和配乐的低点对齐；否则换 `whip-pan`。
- DOM 里不要动画 CSS `blur`（playbook/03 §4）：后景的虚焦在 canvas 层做，或者用一张预先模糊好的副本和清晰版交叉淡入。

## 实现

```js
// dark-tunnel：A 在 30–40 帧向左推出，暗场 36–54，B 在 46–56 帧从右侧、0.6 倍、模糊中迎入。
const T0 = 30;                                                        // 本配方第 0 帧
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg");
  const dark = lib.mixColor(bg, "#000000", 0.88);                     // 暗场由风格底色压暗
  const glow = lib.luminance(bg) > lib.luminance(fg) ? bg : fg;       // 尘点和中心微光用风格里较亮的颜色
  ctx.fillStyle = dark; ctx.fillRect(0, 0, 1920, 1080);
  if (k < 16) {                                                       // A：推出（相机向右 = 画面向左）
    const push = -1920 * lib.bezier(0.45, 0, 0.2, 1)(lib.seg(k, 0, 10));
    ctx.save(); ctx.translate(push, 0); page(ctx, tokens, lib, 5); ctx.restore();
  }
  const vis = Math.min(lib.seg(k, 6, 14), 1 - lib.seg(k, 16, 24));   // 暗场：压住 A 的尾巴，B 进来时退
  if (vis > 0) {
    ctx.save(); ctx.globalAlpha = vis;
    const g = ctx.createRadialGradient(960, 486, 0, 960, 486, 900);
    g.addColorStop(0, lib.mixColor(dark, glow, 0.12)); g.addColorStop(0.7, dark);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
    ctx.fillStyle = lib.rgba(glow, 0.35);                             // 尘点：和相机同向掠过
    for (let i = 0; i < 18; i++) {
      const x = (lib.hash(7, i) * 2400 - k * (6 + 8 * lib.hash(8, i))) % 2400;
      ctx.fillRect((x + 2400) % 2400 - 240, 120 + lib.hash(9, i) * 840, 3, 3);
    }
    ctx.restore();
  }
  if (k >= 16) {                                                      // B：从右边、从远处、从虚到实
    const u = lib.bezier(0.3, 0, 0.2, 1)(lib.seg(k, 16, 26));
    const B = lib.offscreen("dt-b", (x) => page(x, tokens, lib, 9));
    ctx.save(); ctx.filter = `blur(${(1 - u) * 12}px)`;
    ctx.translate(960 + (1 - u) * 960, 486); ctx.scale(0.6 + 0.4 * u, 0.6 + 0.4 * u); ctx.translate(-960, -486);
    ctx.drawImage(B, 0, 0); ctx.restore();
  }
}
function page(ctx, tokens, lib, seed) {                                // 灰盒页面：顶栏 + 4×3 卡片
  const fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = lib.rgba(fg, 0.08); ctx.fillRect(0, 0, 1920, 88);
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(seed, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = i === seed ? ac : lib.rgba(fg, 0.4); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(seed, i, 1), 16);
  }
}
```

快速的推出和迎入可以再包一层子帧运动模糊（`lib.motionBlur`，或 playbook/08 的做法），只包这两段，慢的部分不要包。

## 已知坑

- **纯黑死帧**：暗场淡入晚了，前景出画和暗场满之间会漏出 1–2 帧纯黑，读作断片。暗场要在前景出画前就开始淡入。
- **方向对撞**：前景向右出、后景也从右边进（屏幕上两者方向相反），读作两条片子。按屏幕空间检查：两者都朝同一个方向移动。
- **后景的字糊**：后景是"迎面放大着看"的，截图分辨率不够时字会糊。后景用 2 倍截图，推近用的元素另截高清图（shotcraft 审美准则 Q2）。
- **暗场里再叠白闪**：一个接缝只用一式，暗场里加闪白读作穿帮。
- **不是判例**：这一式是 shotcraft 从 Linear 发布片抽帧逆向来的默认建议，没有用户判例；和项目里的判断冲突时，以项目为准。

## 验收帧

- `peak`（第 5 帧）：前景推出的中段，速度最大；方向和后镜入场一致。
- `seam`（第 15 帧）：暗场里。不是纯黑，尘点可见而且在动（和第 14、16 帧比较）。
- `settle`（第 30 帧）：后景已经静止、清晰，字的边缘没有糊。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）转场卡 `shot-transitions` 的 B 式和 demo `DarkTunnelTransition.tsx`；原作者注明它来自对 Linear 发布片的抽帧逆向。文字重写；帧数、缓动、起点缩放和模糊取原值，暗场颜色改成由风格底色推出，声音一节是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/transition/shot-transitions.md`、`demos/transition/shot-transitions/DarkTunnelTransition.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
