---
id: whip-pan
name: 甩镜
one_liner: 相机一拍横甩到下一景，中段糊到认不出，借糊帧换景；两款：直接落位、急刹长尾
family: seam
role: [seam]
intent: [carry]
energy: [3, 5]
duration_f: [8, 60]
jump: [level, rise]
types: [promo, short, meme, mv]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [none]
sound: recommended
pitfalls: [sub-threshold, seam-mismatch, text-blur, motion-sickness]
qa: {peak: 4, settle: 20}
status: tuned
pairs_with: [dark-tunnel]
impl: [showcase/04-intro-film/js/fx.js]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/transition/shot-transitions.md, license: Apache-2.0, note: 六式中的 E 式（基本款、急刹款）}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/transition/shot-transitions/WhipPanReal.tsx, license: Apache-2.0, note: 跨度、缓动、快门}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/transition/shot-transitions/WhipBrakeReal.tsx, license: Apache-2.0, note: 急刹款的路程配比}
sketch_sha: "95e9bc587540"
---

# 甩镜 · whip-pan

## 意图

快节奏的功能段连着打，镜头从一处甩到另一处，中间糊成一片，观众只感觉到"很快地过去了"。比 `dark-tunnel` 省帧、轻快。两款的区别在落点：后镜自己有入场动作，用基本款直接落位；后镜要靠内容说话（要读的字、要看清的卡），用急刹款，给视线一段追上来的长尾。

## 阶段与时值

第 0 帧 = 开始甩。甩之前和落位之后各至少 20 帧的静止属于两侧镜头。

| 款 | 帧 | 发生什么 |
|---|---|---|
| 基本款 | 0–8 | 8 帧横移 1.5 屏（1080p 下 2880 px），`bezier(0.6,0,0.4,1)`：平均 360 px/帧，中段约 900 px/帧；到位即停 |
| 急刹款 | 0–60 | 横移约 2.1 屏（1080p 下约 4070 px），一条曲线 `bezier(0.05,0.6,0.2,1)`：起步即最快（约 650 px/帧），前 3 帧在 300 px/帧以上、糊透；前 12 帧走完 70% 的路，后 48 帧减速滑进落点 |
| 落位后 | 基本款 8 起，急刹款 60 起 | 真静止，至少 20 帧 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 峰值速度 | ≥ 300 px/帧（1080p） | 不够快就糊不透，中段能看清两景的拼缝，换景穿帮；跨度按这条下限倒推 | ★ |
| 运动模糊 | 子帧模糊，快门约 200°（0.55 帧），采样按"拖影的相邻两次采样间距不超过字高"定，原 demo 用 20 | 只包甩的那几帧；整镜都包会把慢的部分也抹软 | ★ |
| 两景的位置 | 在同一条水平线上拼接（同一个页面空间） | 上下错位，甩的中段会出现一道斜着的缝 | |
| 基本款跨度 | 8 帧 1.5 屏 | 更长的跨度要按比例加帧，保持峰值速度而不是时长 | |
| 急刹款跨度 | 约 2.1 屏（4070 px），一路上都有内容（原 demo 是一条 10 张卡的长廊） | 按 1.5 屏做，过 300 px/帧的只剩 2 帧，糊不透；路上留空，减速的那几十帧就是空画面 | ★ |
| 急刹款长尾 | 48 帧，不超过 60 | 长尾再长就吃掉了后镜自己的入场；宁短勿长 | ★ |
| 两款混用 | 同一支片子两款都用，算两种转场 | playbook/03 §6：转场种类少、反复用 | |

急刹款原 demo 把路程拆成两段，各自 ease-out，交界处速度会先掉到 0 再起步。这里改成一条曲线：起步即最快，速度一路连续地降到 0，前 20% 的时间走完 70% 的路。跨度同为约 4070 px 时，峰值约 650 px/帧（原 demo 约 710），糊透的是前 3 帧（原 demo 前 4 帧），要藏的拼缝或要换的景必须在这 3 帧里过去；之后是看得清的减速，所以长廊上要一直有内容。

## 声音

一声 whoosh 钉在开始甩的那一帧，峰值落在甩的中段；急刹款可以在落位时补一声很轻的"停"（软的 impact 或 tick）。连续几次甩镜，whoosh 用两个样本交替、音量逐次降一点，避免机枪感（shotcraft 声音判例 S2）。

## 风格适配

- 结构参数：峰值速度下限、只糊甩的那几帧、急刹款的 70/30 路程配比和长尾上限。
- 皮肤参数：模糊的质感。像素风、一拍二风格不做子帧模糊，改成 2–3 张"拖影帧"（`halftone-comic`、`pixel-16bit` 用速度线或残影）。
- 一镜到底的 3D 片子里，甩镜不是换景，而是给相机时间加一段 slow–FAST–slow 的变速：本仓库介绍片的 `makeWarp`（`showcase/04-intro-film/js/fx.js`）在切换点前后 ±0.3–0.5 s 的窗口里，把相机时间的斜率拉到中心 1.9 倍、两肩 0.49 倍，窗口两端斜率为 1，进出都没有顿挫。

## 实现

```js
// whip-pan：两景在同一条水平线上，第 40 帧起甩；KIND 改成 "brake" 看急刹款（跨度 4070 px，路上补一页，减速时不会空）。只在甩的时候做子帧模糊。
const T0 = 40, KIND = "basic", D = KIND === "basic" ? 2880 : 4070;
export function renderAt(t, ctx, tokens, lib) {
  const camX = (k) => KIND === "basic" ? D * lib.bezier(0.6, 0, 0.4, 1)(lib.seg(k, 0, 8))
                                       : D * lib.bezier(0.05, 0.6, 0.2, 1)(lib.seg(k, 0, 60));
  const world = (tt, c) => {                                          // 两个灰盒页面在同一条水平线上
    const x = camX(tt * 30 - T0);
    c.fillStyle = lib.color(tokens, "bg"); c.fillRect(0, 0, 1920, 1080);
    c.save(); c.translate(-x, 0); page(c, tokens, lib, 5);
    for (let px = 1720; px + 1860 <= D + 110; px += 1720) { c.save(); c.translate(px, 0); page(c, tokens, lib, 7); c.restore(); }   // 路上的页，页距 1720
    c.translate(D, 0); page(c, tokens, lib, 9); c.restore();
  };
  const k = lib.frame(t) - T0, moving = KIND === "basic" ? k >= 0 && k <= 8 : k >= 0 && k <= 14;
  if (moving) lib.motionBlur(ctx, t, world, { samples: 20, shutter: 0.55 });
  else world(t, ctx);
}
function page(ctx, tokens, lib, seed) {                                // 灰盒页面：4×3 卡片，不画底色
  const fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(seed, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = i === seed ? ac : lib.rgba(fg, 0.4); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(seed, i, 1), 16);
    ctx.fillStyle = lib.rgba(fg, 0.18); ctx.fillRect(x + 32, y + 70, 300, 10); ctx.fillRect(x + 32, y + 92, 240, 10);
  }
}
```

HyperFrames（DOM）里没有现成的子帧模糊：整页高帧率渲染再平均，或在 Three.js 层里累积（playbook/08"真正的子帧运动模糊"）。子帧不能跨切点。

## 已知坑

- **不够快**：跨度小、峰值低于 300 px/帧，中段糊不透，拼缝露出来。先按峰值速度定跨度，再定帧数。
- **甩完还在漂**：落位之后还有 1–2 px 的尾漂，DOM 文字会闪（`video-types/03` 自查重点）。落位后坐标锁死。
- **必读字在甩的路上**：甩镜的模糊会抹花所有东西。要读的字在落位之后再出现，或者用急刹款让视线追上（playbook/03 §4）。
- **连甩**：几个甩镜首尾相接，或者紧跟在一串快速特写之后，看着晕。两次甩镜之间留出一个完整的静止镜头。
- **不是判例**：两款的参数是在占位素材上调的，后来换成真实素材校过一次，没有用户判例。

## 验收帧

- `peak`（第 4 帧，基本款；急刹款看第 1 帧）：整屏糊透，认不出两景的边界，也认不出任何字。
- `settle`（第 20 帧）：落位后完全静止，和第 19 帧逐像素相同（没有尾漂）。急刹款看第 60 帧以后。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）转场卡 `shot-transitions` 的 E 式和 demo `WhipPanReal.tsx`、`WhipBrakeReal.tsx`。文字重写；两款的跨度、基本款的缓动、快门、70/30 路程配比和长尾上限取原值；急刹款改成一条速度连续的曲线，峰值和糊透的帧数按这条曲线重算；一镜到底里的变速甩镜来自本仓库介绍片。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/transition/shot-transitions.md`、`demos/transition/shot-transitions/WhipPanReal.tsx`、`demos/transition/shot-transitions/WhipBrakeReal.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
