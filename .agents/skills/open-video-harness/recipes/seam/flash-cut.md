---
id: flash-cut
name: 推进流白
one_liner: 前镜推近到切点，硬切处骑一层 10 帧的暖白光，盖住换页
family: seam
role: [seam]
intent: [carry, enter]
energy: [2, 4]
duration_f: 10
jump: [level, rise]
types: [promo, short, data, paper]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [none]
sound: optional
pitfalls: [glow-spill, seam-mismatch, dead-frame]
qa: {peak: 4, seam: 5}
status: upstream-tested
pairs_with: [breath-title-card]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: assets/lib/FlashCut.tsx, license: Apache-2.0, note: 光的形状和时值}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/transition/shot-transitions.md, license: Apache-2.0, note: 六式中的 A 式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: template/src/aifl/Main.tsx, license: Apache-2.0, note: 模板片里的 4 处用法和音效位置}
sketch_sha: "f565e67e9d20"
---

# 推进流白 · flash-cut

## 意图

两个能量相近的画面之间换页，又不想让观众看见"换"。前镜往里推，推到最快的时候切，切点被一团暖白的光盖住，读起来像镜头钻进了光里，出来已经是下一页。它是整片的"默认接缝"：不抢戏，可以反复用。

## 阶段与时值

第 0 帧 = 切点前 5 帧。光一共 10 帧，切点在第 5 帧。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 前镜推近 | 切点前 12–16 帧起（属于前镜） | 相机往目标推，越推越快（ease-in），切点前一帧速度最大 |
| 光起 | 0–4 | 不透明度 0 → 0.85，线性 |
| 硬切 | 5 | 第一帧后镜，光还在 0.7 左右 |
| 光退 | 4–10 | 0.85 → 0，线性 |
| 后镜 | 5 起（属于后镜） | 第一帧就在动：慢推、落定或元素入场 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 光的时长 | 10 帧，骑在切点两侧各 5 帧 | 模板片 4 处都是这个值。再短就只剩一下闪，再长就成了柔光溶解，切点反而被看见（推测） | ★ |
| 峰值 | 0.85，落在切点前 1 帧 | 峰值在切之前，换页的那一帧已经在光里 | ★ |
| 形状 | 径向：中心 0.98，半径 55% 处 0.55，80% 以外全透明；中心在画面 50%、45% 高 | 边角始终看得见，所以是一团光，不是整屏闪白 | ★ |
| 颜色 | 暖白（纸墨风的原值 `rgb(255,248,235)`） | 皮肤参数：冷色系风格用冷白，暗底风格可以降到 0.6 | |
| 前镜推近 | 切前 16 帧，推到 1.3–2.2 倍，ease-in | 推近给切一个方向："钻进去"。模板片在点击之后推 16 帧到 2.2 倍 | |
| 用在哪 | 字卡 → 实景、页面 → 页面、点开 → 详情 | 模板片 36 s 里用了 4 次，都在这三种接缝上 | |

## 声音

光本身不配声。模板片的做法是把一声柔和的过渡音（transition-soft 一类）钉在后镜的第一个动作上，比切点晚 2–4 帧；前镜的推近如果是点击触发的，推近配一声短 swoosh。写进 `audio/events.json` 时，`t` 取后镜第一个动作的时间常量，不写裸秒数。

## 风格适配

- 结构参数：10 帧、峰值位置、径向形状（中心亮、边缘透明）、前镜 ease-in 推近。
- 皮肤参数：光的颜色和峰值亮度。暗底风格（`dark-math`、`monumental-scifi`）峰值降到 0.5–0.6，否则画面从暗直接跳到亮，像闪屏。
- 一拍二（12 fps）：光的 10 帧取整成 5 个台阶；像素风（`pixel-16bit`）改成 3–4 级调色板亮度台阶，不用平滑渐变。

## 实现

```js
// flash-cut：A 推近，第 40 帧硬切到 B，暖白径向光骑在 35–45 帧。灰盒页面代替真实截图。
const CUT = 40;
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t);
  const u = lib.ease.inCubic(lib.seg(f, CUT - 16, CUT));             // 推向强调色那张卡，越推越快
  if (f < CUT) page(ctx, tokens, lib, 5, 1 + 0.8 * u, lib.lerp(960, 740, u), lib.lerp(540, 580, u));
  else page(ctx, tokens, lib, 9, 1.06 - 0.06 * lib.ease.outCubic(lib.seg(f, CUT, CUT + 24)));
  const k = f - (CUT - 5);                                           // 本配方的帧号：0…10
  const a = k <= 4 ? 0.85 * lib.clamp(k / 4) : 0.85 * lib.clamp(1 - (k - 4) / 6);
  if (a <= 0) return;
  const light = lib.mixColor("#ffffff", lib.color(tokens, "accent"), 0.06);
  ctx.save(); ctx.globalAlpha = a; ctx.translate(960, 486); ctx.scale(1, 0.62);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1360);
  g.addColorStop(0, lib.rgba(light, 0.98)); g.addColorStop(0.55, lib.rgba(light, 0.55)); g.addColorStop(0.8, lib.rgba(light, 0));
  ctx.fillStyle = g; ctx.fillRect(-1360, -1360, 2720, 2720); ctx.restore();
}
function page(ctx, tokens, lib, seed, z = 1, cx = 960, cy = 540) {     // 灰盒页面：顶栏 + 4×3 卡片
  const fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-cx, -cy);
  ctx.fillStyle = lib.rgba(fg, 0.08); ctx.fillRect(0, 0, 1920, 88);
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(seed, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = i === seed ? ac : lib.rgba(fg, 0.4); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(seed, i, 1), 16);
    ctx.fillStyle = lib.rgba(fg, 0.18); ctx.fillRect(x + 32, y + 70, 300, 10); ctx.fillRect(x + 32, y + 92, 240, 10);
  }
  ctx.restore();
}
```

HyperFrames（DOM）里是一个铺满的 `div`，背景是同样的径向渐变，不透明度按上面的三个关键帧由 t 算出；不要用 CSS transition。

## 已知坑

- **把光当装饰**：光只盖硬切。给入场、落定或高光时刻也加一道光，它就不再是接缝的记号（shotcraft 审美准则 Q4：光效只给主角一次）。
- **暗场里再叠白光**：和 `dark-tunnel` 的暗场叠在同一个接缝上，读作穿帮。一个接缝只用一式。
- **后镜第一帧是静止的**：光退去以后看到一张死图，像是播放卡了一下。后镜从第一帧就要有东西在动（本仓库的建议，模板片的后镜都是带着运镜进来的）。
- **全屏化**：把渐变换成纯色全屏，就成了整画面闪白，要按 CLAUDE.md 的底线计数（每秒不超过 3 次），也会压过真正的冲击点。保持径向、边缘透明。

## 验收帧

- `peak`（第 4 帧，切点前 1 帧）：光最亮，但四个角仍然看得见前镜；光里没有被烧掉的必读字。
- `seam`（第 5 帧）：已经是后镜，而且后镜在动（和第 6 帧对比，位置或缩放有变化）；前后两镜的推进方向一致。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的 `FlashCut` 组件、转场卡 `shot-transitions` 的 A 式，以及模板片 `Main.tsx` 里的 4 处用法和音效位置。文字重写；时值和形状取原值，暗底降亮、量化降级和"后镜第一帧要在动"是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `assets/lib/FlashCut.tsx`、`references/shots/transition/shot-transitions.md`、`template/src/aifl/Main.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
