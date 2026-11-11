---
id: drop-blackout-slam
name: 黑场蓄爆
one_liner: 正常播放中一帧切进 12 帧的黑，画面里什么都没有，然后主视觉带着震屏和一圈亮环砸进来：全片最高潮的前一拍
family: rhythm
role: [climax]
intent: [punctuate, hush, payoff]
energy: 5
duration_f: [110, 140]
types: [promo, mv, meme, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: required
pitfalls: [dead-frame, sound-dependent, overuse, no-hold]
qa: {seam: 55, peak: 63, settle: 100}
status: tuned
max_per_film: 1
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/rhythm/montage-rhythm-moves.md, license: Apache-2.0, note: 三式中的 A 式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/rhythm/montage-rhythm-moves/DropBlackoutSlam.tsx, license: Apache-2.0, note: 黑场长度、砸入、震屏、亮环、收尾}
sketch_sha: "bb0ce23b0d41"
---

# 黑场蓄爆 · drop-blackout-slam

## 意图

演唱会里 drop 之前灯全灭的那一拍：画面正常在播，突然全黑，观众屏住气，然后最重要的那句话、那个名字砸出来。黑是蓄力，砸是释放。它只能给全片最高潮的前一拍用一次，用在发布口号、产品名、关键数字的登场上。

## 阶段与时值

第 0 帧 = 铺垫段开始。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 铺垫 | 0–49 | 画面正常"在播"：整体缩放在 1.00–1.02 之间呼吸（周期 48 帧），一个小节拍点每 12 帧亮一下 |
| 黑场 | 50–61 | 一帧切进纯黑（不是 #000，是很深的底色），整整 12 帧，画面上什么都没有 |
| 砸入 | 62–67 | 主视觉从 1.35 倍 5 帧撞到 1（ease-out）；同一帧起整画面震动 10 px，按 e^(−t/2.5 帧) 衰减，第 76 帧强制归零；一圈亮环从中心 80 px 扩到 900 px，16 帧散尽 |
| 静止 | 76–130 | 至少 50 帧真静止（重击之后 hold 加倍） |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 铺垫是活的 | 黑场之前画面在正常动（呼吸、拍点） | 先让观众感到"片子在正常播"，黑掉才有落差 | |
| 黑场 | 12 帧，画面上完全没有东西 | 黑场里放 logo、微光，都在泄压；死寂才是蓄力（原卡的命门） | ★ |
| 黑场的声音 | 本仓库改动：音乐的鼓和旋律一起断，但留一层极低的底（混响尾巴、低频嗡鸣或环境声），不出数字静音 | 原卡要求画面和声音同帧全静。CLAUDE.md 的底线是片中不出现数字静音，TASTE_CHECKLIST #18 也不许声音和画面同时停死 | ★ |
| 三件事同帧 | 砸入、震屏、亮环在同一帧开始，同一帧落在音乐的最强一击上 | 错开一两帧，冲击就散了 | ★ |
| 震屏 | 10 px，τ ≈ 2.5 帧，约 12 帧收干，之后强制为 0 | 衰减慢了就成了持续的抖；收干后必须真静止 | |
| 次数 | 全片 1 次；算一处整画面冲击（全片最多 3 处） | 第二次出现，第一次就白打了 | ★ |
| 收尾 | 砸入后 ≥ 50 帧静止；砸出来的字要读，按读时规则（BRIEF 的 Pace）停够 | 重拳之后 hold 加倍 | ★ |

## 声音

依赖声音：黑场那一拍，配乐的鼓和和声同帧撤掉，只剩很低的底；砸入那一帧是全片最响的一击（低频冲击 + 镲），和画面同帧。钉帧写相对这个镜头起点的表达式；成片混音后用 `bin/vh qa` 查黑场那一段不是数字静音。

## 风格适配

- 结构参数：活的铺垫、12 帧空的黑、三件事同帧、只一次、之后长 hold。
- 皮肤参数：黑场的颜色（用风格底色压到最暗，而不是纯黑）、砸进来的东西、亮环的颜色和粗细。
- 亮底的片子也能用：黑场本身就是反差最大的一刻。
- 一拍二：砸入的 5 帧取整成 3 个台阶，震屏按 2 帧一变，衰减时长不变。

## 实现

```js
// drop-blackout-slam：0–49 正常在播（呼吸 + 拍点）→ 50–61 空的黑 → 62 砸入：缩放 1.35 → 1、震屏 10 px 指数衰减、亮环 80 → 900 px。
const BLACK = 50, SLAM = 62;
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const dark = lib.mixColor(lib.luminance(bg) < lib.luminance(fg) ? bg : fg, "#000000", 0.7);
  if (f < BLACK) {                                                      // 铺垫：画面在正常播
    const s = 1.01 + 0.01 * Math.sin(f / 48 * lib.TAU);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
    ctx.save(); ctx.translate(960, 540); ctx.scale(s, s); ctx.translate(-960, -540);
    for (let i = 0; i < 12; i++) { ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(9, i)); ctx.fillRect(110 + (i % 4) * 430, 150 + Math.floor(i / 4) * 300, 400, 260); }
    ctx.restore();
    const b = f % 12, on = b < 1 ? lib.lerp(0.25, 1, b) : lib.lerp(1, 0.25, lib.seg(b, 1, 5));
    ctx.fillStyle = lib.rgba(fg, on); ctx.beginPath(); ctx.arc(1846, 1014, 18 * (1 + 0.5 * Math.max(0, 1 - Math.abs(b - 1) / 4)), 0, lib.TAU); ctx.fill();
    return;
  }
  ctx.fillStyle = dark; ctx.fillRect(0, 0, 1920, 1080);                 // 黑场：什么都没有
  if (f < SLAM) return;
  const k = f - SLAM, amp = k < 14 ? 10 * Math.exp(-k / 2.5) : 0;       // 震屏：第 14 帧后强制归零
  const r = lib.lerp(80, 900, 1 - (1 - lib.seg(k, 0, 16)) ** 3), ra = k < 3 ? lib.lerp(0.85, 0.55, k / 3) : 0.55 * (1 - lib.seg(k, 3, 16));
  ctx.save(); ctx.translate(amp * lib.hashS(1, f), amp * lib.hashS(2, f));
  if (ra > 0) { ctx.strokeStyle = lib.rgba(ac, ra); ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(960, 540, r, 0, lib.TAU); ctx.stroke(); }
  const s = lib.lerp(1.35, 1, 1 - (1 - lib.seg(k, 0, 5)) ** 3);
  ctx.translate(960, 540); ctx.scale(s, s);
  lib.setFont(ctx, tokens, "display", 260, { weight: 800 }); ctx.fillStyle = lib.luminance(bg) > lib.luminance(fg) ? bg : fg;
  lib.drawText(ctx, "LAUNCH", 0, 90, { align: "center" });
  ctx.restore();
}
```

## 已知坑

- **黑场里有东西**：一个 logo、一点微光，蓄力就泄了。12 帧里画面上什么都不放。
- **声音同时停死**：原卡让声音和画面一起静，本仓库不允许片中出现数字静音：鼓和旋律撤掉，留一层很低的底。混音后用 `bin/vh qa` 查。
- **无声版**：没有声音，12 帧的黑读作播放器卡了。这一式只给有配乐的片子。
- **一个镜头两个震源**：震屏和别的抖动（冲击反馈、多米诺震动）不能叠在同一个镜头里。
- **不是判例**：demo 在灰阶占位素材上调过，第一次用在真实素材上要回看。

## 验收帧

- `seam`（第 55 帧，黑场中）：整帧是同一个很深的颜色，没有任何元素；这一刻的音频不是数字静音。
- `peak`（第 63 帧，砸入后一帧）：主视觉正在撞向 1 倍，震屏和亮环同时在；落在配乐最强的一击上。
- `settle`（第 100 帧）：震屏早已归零，画面完全静止，砸出来的字清楚。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）节奏卡 `montage-rhythm-moves` 的 A 式和 demo `DropBlackoutSlam.tsx`。文字重写；黑场长度、砸入、震屏、亮环、收尾的数值取原值；黑场里保留一层低音底、不出数字静音，是按本仓库的底线改的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/rhythm/montage-rhythm-moves.md`、`demos/rhythm/montage-rhythm-moves/DropBlackoutSlam.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
