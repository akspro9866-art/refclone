---
id: accelerando-cuts
name: 递进硬切串
one_liner: 同一产品的 6 个构图硬切，切点间隔每两刀减半，越切越快地逼近，最后一刀定格回全景慢推
family: rhythm
role: [climax, hook]
intent: [accelerate, punctuate]
energy: 5
duration_f: [130, 145]
types: [promo, short, meme, mv]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [ui-page]
sound: required
pitfalls: [uniform-timing, no-hold, sound-dependent, overuse, flash-rate]
qa: {peak: 92, settle: 118}
status: tuned
max_per_film: 1
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/rhythm/beat-cut-moves.md, license: Apache-2.0, note: 两式中的 A 式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/rhythm/beat-cut-moves/BeatCutAccelerando.tsx, license: Apache-2.0, note: 切点帧、视图池、切帧提亮、末段慢推}
sketch_sha: "4dfe40da9374"
---

# 递进硬切串 · accelerando-cuts

## 意图

把"切"本身打成鼓点：同一个产品的几个构图一刀比一刀快地切过去，观众感到自己在冲向结论；最后一刀戛然停住，回到全景，重重落地。预告片式的蓄力，或者功能连打冲向结尾。

## 阶段与时值

第 0 帧 = 建立镜头开始。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 建立 | 0–48 | 全景 v0，观众先认清这是谁 |
| 五连切 | 49 / 65 / 77 / 85 / 91 | 切到 v1…v5，间隔 16 → 12 → 8 → 6 → 4 帧；真硬切，没有过渡帧 |
| 最后一刀 | 95 | 切回全景 v0 |
| 定格慢推 | 95–115 | 缩放 1 → 1.06，ease-out，之后不动 |
| 静止 | 115–130 | 真静止；从最后一刀算起 hold 共 35 帧 |

整段 130 帧（原 demo 的长度）。能伸缩的只有建立镜头：观众需要多认一会儿时可以加到 64 帧，整段不超过 145 帧；五连切的间隔和最后的 35 帧 hold 不变。

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 切点间隔 | 16, 12, 8, 6, 4 帧：每两刀减半（相邻两刀约 ÷1.41） | 等差地缩短（16, 13, 10, 7, 4）读不出加速；最后一个间隔小于 4 帧，眼睛跟不上 | ★ |
| 视图池 | 6 个构图，都是同一个产品：两页 × 1 倍、约 1.8 倍、约 2.7 倍，每个对准一个焦点并把它推到画面中心 | 六个无关的画面读作故障；观众要在加速中一直认得这是谁 | ★ |
| 切帧提亮 | 只在切的那 1 帧：亮度 +5%，叠 6% 白 | 是"咔"一声，不是闪光灯；再厚就成了 `paparazzi` 式的连闪，也会碰到闪烁底线 | |
| 最后一刀之后 | 回全景，20 帧 ease-out 推到 1.06 倍，然后不动，共 35 帧 | 戛然而止是这一式的句号：最后一刀之后不许再有任何切；hold 比平常更长，是底线不是建议 | ★ |
| 次数 | 全片 1 次 | 这是全片最响的一记，第二次出现，第一次就白打了 | ★ |

**有配乐时**，两种排法：一是按音乐的网格排，间隔写成 1、¾、½、⅜、¼ 拍（120 BPM 左右正好约等于 16/12/8/6/4 帧）；二是让配乐迁就画面，在这 5 个切点上写一串加速的打击，代码作曲可以把打击放在任意帧上（`bin/vh music`）。不管哪种，切点必须和声音落在同一帧。

## 声音

没有声音这一式不成立：每一刀一声短促的 tick 或鼓点，最后一刀一记重的 impact，之后留一段混响尾巴，配乐的底垫接住 35 帧的 hold。连发的 tick 用两个样本交替、音量逐次降一点（shotcraft 声音判例 S2）。钉帧写相对这个镜头起点的表达式，不写片内绝对帧。

## 风格适配

- 结构参数：减半律、6 个构图都是同一个主体、最后一刀回全景、35 帧 hold、全片一次。
- 皮肤参数：切帧提亮的颜色（亮底提亮，暗底可以改成一帧轻微的色偏）、构图里的素材。
- 一拍二（12 fps）：切点取整到偶数帧（16/12/8/6/4 本来就是偶数），hold 不变。
- 竖屏：视图池改成竖向的局部构图，焦点放在竖屏的关键内容框里（playbook/03 §5）。

## 实现

```js
// accelerando-cuts：0–48 建立，49/65/77/85/91 五刀，95 回全景并慢推，hold 到 130。真硬切：落在哪个区间就画哪个视图。
const CUTS = [0, 49, 65, 77, 85, 91, 95];
const VIEWS = [[5, 1, 960, 540], [5, 1.8, 760, 590], [5, 2.6, 580, 360], [9, 1, 960, 540], [9, 1.9, 1170, 590], [9, 2.8, 1170, 280]];
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t);
  let seg = 0; CUTS.forEach((c, i) => { if (f >= c) seg = i; });
  const last = seg === CUTS.length - 1, [seed, z, cx, cy] = VIEWS[last ? 0 : seg];
  const push = last ? 1 + 0.06 * (1 - (1 - lib.seg(f, 95, 115)) ** 3) : 1;
  page(ctx, tokens, lib, seed, z * push, cx, cy);
  if (CUTS.includes(f) && f > 0) { ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(0, 0, 1920, 1080); }   // 只在切的那一帧
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

## 已知坑

- **切点等差缩短**：16、13、10、7、4 这样等差地缩，观众感觉不到加速。按减半律排。
- **视图不是同一个主体**：跨产品、跨场景的素材别用这一式；观众在加速里认不出主体，就只剩画面乱跳。
- **手滑加了过渡帧**：两刀之间加 2 帧交叉淡化就不是硬切了，节拍感立刻糊掉。硬切 = 当前帧落在哪个区间就画哪个视图。
- **hold 给少了**：切得越狠，切完停得要越久。35 帧是底线。
- **切帧的亮度加过头**：最后四刀挤在 0.6 秒里，每刀都闪一下就碰到"全屏闪白每秒不超过 3 次"的底线。提亮只有 +5%，读作快门的"咔"，不读作闪光。
- **不是判例**：demo 在灰阶占位素材上调过，参数是起点；第一次用在真实素材上要回看一遍。

## 验收帧

- `peak`（第 92 帧，最后一个 4 帧的段里）：看得出这仍然是同一个产品（和第 10 帧对比主体）；前一帧和这一帧之间没有过渡帧。
- `settle`（第 118 帧）：已经回到全景并停住，和第 119 帧逐像素相同；声音的尾巴和底垫还在。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）节奏卡 `beat-cut-moves` 的 A 式和 demo `BeatCutAccelerando.tsx`。文字重写；切点帧、视图池的构成、切帧提亮、末段慢推和 hold 取原值；按拍号排的换算、闪烁底线的说明和竖屏的做法是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/rhythm/beat-cut-moves.md`、`demos/rhythm/beat-cut-moves/BeatCutAccelerando.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
