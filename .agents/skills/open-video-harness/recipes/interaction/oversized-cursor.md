---
id: oversized-cursor
name: 超大光标
one_liner: 一只画面宽度 7% 的光标从画外进来，把视线带到下一个目标，点一下让下一件事发生，然后离开或带进下一镜
family: interaction
role: [feature]
intent: [interact, locate]
energy: [2, 3]
duration_f: [30, 90]
types: [promo, short, data]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-page]
sound: recommended
pitfalls: [sub-threshold, dead-frame, fake-ui]
qa: {peak: 16, settle: 30}
status: tuned
pairs_with: [type-and-filter, cut-the-curve]
conflicts: [browser-walkthrough]
impl: [showcase/00-promo-launch-film/index.html]
derived_from:
  - {repo: github.com/heygen-com/hyperframes, commit: "a46095f", path: .claude/skills/oversized-cursor/SKILL.md, license: Apache-2.0, note: 尺寸、入场、尖端对准、点击、离场和跨镜交接}
sketch_sha: "7fc01544a8c9"
---

# 超大光标 · oversized-cursor

## 意图

光标是发布片里最便宜、收益最高的运动来源：一个元素、只动 transform，就能把视线从画面这头带到那头，让下一件事有一个"原因"（是这一下点击触发的），还能把观众从一张静止的画面里拽出来。它必须大：真实尺寸的光标在视频里等于不存在。

## 阶段与时值

第 0 帧 = 光标开始进场。下面是一次"进场 → 点击 → 让开"。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 进场 | 0–16 | 从画面下方以外（纵向 115–120%）沿一条直线滑到目标，`power3.out`，12–28 帧（0.4–0.92 s） |
| 点击 | 16–26 | 以箭头尖为轴：3 帧压到 0.84 倍（`power2.in`），7 帧弹回（`power2.out`）；被点的东西同一帧开始反应 |
| 下一件事 | 16 起 | 打字、展开、变形、转场：都由这一下点击触发，同一帧开始 |
| 让开 | 26–48 | 不是它主导的段落（打字、旁白）里，光标 15–27 帧滑到一边，不停在内容上面，也不原地晃 |
| 离场或交接 | 最后 9–21 帧 | 从最近的边加速出画（`power2.in`）；或者在切点前 0.3 s 朝下一镜的点击位置加速，下一镜接着以同样的速度减速到位 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 大小 | 全画幅时画面宽度的 7%（1920 宽约 134 px）；在画面里的小窗口里 4.6–5.5% | 拿不准就再大一点；真实大小看不见 | ★ |
| 进场 | 永远从画外进来，一条连续的直线（默认从下往上） | 在停留的位置淡入、用遮罩揭出来，读作故障（反复出现过的失败） | ★ |
| 尖端对准 | 箭头尖（不是图标框的中心）落在目标中心；缩放以尖端为轴（箭头 SVG 在 24 单位的 viewBox 里是 `21% 14%`） | 以中心为轴点击，尖端会滑开 | |
| 点击 | 压 0.1 s、弹回 0.22 s（1 : 2） | 对称的压和弹不像真的点了一下 | |
| 点击有后果 | 每次点击都让下一件事在同一帧发生 | 点了没反应，观众会以为点空了 | ★ |
| 让开 | 0.5–0.9 s，`power2.out` | 光标停在正在打的字上面，或者在原地微微晃，都是干扰 | |
| 离场 | 出画（0.5–0.7 s，`power2.in`）或跨镜交接；不在原地淡出 | 原地淡出和淡入一样读作故障 | ★ |
| 样子 | 一种箭头造型全片不变：白身黑边，或黑身白边（1.4 px），按画面反差选；投影 `0 4px 6px rgba(0,0,0,0.3)` | 产品有自己的标志性光标（多人协作的彩色箭头带名字）时，可以换成它，规则不变 | |

## 声音

每次点击一声真实的点击拟音（鼠标、触控板、快门类），钉在压下的那一帧；进场和离场可以配很轻的 swish，也可以不配。点击声不要用游戏界面的提示音（shotcraft 声音判例 S1）。

## 风格适配

- 结构参数：大小下限、画外进出、尖端对准、1 : 2 的点击、点击触发下一件事。
- 皮肤参数：光标的造型和颜色、投影。
- 手绘、剪纸风格：光标换成画出来的手或指针，但仍然从画外进来、点击仍然有压和弹。
- 竖屏：大小按画面宽度的 7–9% 算，进场改从下方，避开平台的遮挡区。

## 实现

本仓库的发布片 `showcase/00-promo-launch-film/index.html` 用一只 134 px 的光标串起三个功能镜头：从下方进场、点击、打字时让开、在切点前 0.3 s 朝下一镜的按钮加速、下一镜接着减速到位、最后从下边出画。下面是 canvas 版的一次"进场 → 点击 → 让开"：

```js
// oversized-cursor：从画外滑到按钮（power3.out，16 帧）→ 以尖端为轴点击（压 3 帧、弹 7 帧）→ 按钮同帧反应 → 光标让开。
const T0 = 20, BTN = { x: 760, y: 470, w: 400, h: 110 }, TIP = [BTN.x + BTN.w / 2, BTN.y + BTN.h / 2];
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0, fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent"), bg = lib.color(tokens, "bg");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  const clicked = k >= 16, press = k < 16 ? 1 : k < 19 ? lib.lerp(1, 0.94, lib.seg(k, 16, 19)) : lib.lerp(0.94, 1, lib.seg(k, 19, 26));
  ctx.save(); ctx.translate(BTN.x + BTN.w / 2, BTN.y + BTN.h / 2); ctx.scale(press, press);           // 按钮：和点击同一帧开始反应
  ctx.fillStyle = clicked ? ac : lib.mixColor(bg, fg, 0.12); ctx.beginPath(); ctx.roundRect(-BTN.w / 2, -BTN.h / 2, BTN.w, BTN.h, 55); ctx.fill();
  lib.setFont(ctx, tokens, "body", 48, { weight: 600 }); ctx.fillStyle = clicked ? bg : fg; lib.drawText(ctx, clicked ? "Rendering…" : "Render", 0, 16, { align: "center" });
  ctx.restore();
  const inU = 1 - (1 - lib.seg(k, 0, 16)) ** 3;                         // power3.out
  const away = 1 - (1 - lib.seg(k, 30, 50)) ** 2;                        // 让开：power2.out
  let x = TIP[0], y = lib.lerp(1080 * 1.18, TIP[1], inU);
  x = lib.lerp(x, 1500, away); y = lib.lerp(y, 880, away);
  const s = k < 16 ? 1 : k < 19 ? lib.lerp(1, 0.84, lib.seg(k, 16, 19) ** 2) : lib.lerp(0.84, 1, 1 - (1 - lib.seg(k, 19, 26)) ** 2);
  cursor(ctx, x, y, 134 * s);                                           // (x, y) 是箭头尖：缩放以尖端为轴
}
function cursor(ctx, x, y, size) {                                      // 箭头：24 单位的 viewBox，尖端在 (0, 0)
  const u = size / 24;
  ctx.save(); ctx.translate(x, y); ctx.scale(u, u);
  ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 6 / u; ctx.shadowOffsetY = 4 / u;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.2, 13); ctx.lineTo(7, 19.5); ctx.lineTo(9.6, 18.4); ctx.lineTo(6.9, 12); ctx.lineTo(12.4, 12); ctx.closePath();
  ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.shadowColor = "transparent"; ctx.lineWidth = 1.4; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();
  ctx.restore();
}
```

## 已知坑

- **太小**：按真实比例画的光标在视频里看不见；至少画面宽度的 7%。
- **原地出现、原地消失**：淡入淡出都读作故障，光标必须"走进房间"再"走出去"。
- **点了没后果**：每一次点击都要让下一件事同一帧发生，否则删掉这次点击。
- **停在字上**：光标不主导的段落里要让开，不能压着正在出现的字，也不要原地晃来晃去。
- **尖端没对准**：按图标框的中心对准，尖端会偏到按钮外面；按箭头尖对准，缩放也以尖端为轴。
- **还没有人工判定**：showcase 00 用它串起三个功能镜头，那支片子的审阅关卡经用户授权跳过，评审只有一轮独立 reviewer（`showcase/00-promo-launch-film/NOTES.md` 的自评记录），还没有人给过判定。有人看过、给了判定，就升 `battle-tested`，把判定记在这里。

## 验收帧

- `peak`（第 16 帧，点击的那一帧）：箭头尖正好在按钮中心，按钮在同一帧开始反应（换色、压下）。
- `settle`（第 30 帧）：点击完成，下一件事已经开始，光标正在离开内容，没有压着字。

## 来源

改写自 HyperFrames（HeyGen，Apache-2.0）的 `oversized-cursor` skill。文字重写；尺寸、进出场规则、尖端的轴点、点击的 1 : 2 时值和跨镜交接取原文；本仓库的发布片 showcase 00 用它串起三个功能镜头。风格适配和竖屏的做法是本仓库补的。

**许可**：本文件修改自 [HyperFrames](https://github.com/heygen-com/hyperframes) 在 commit `a46095f` 时的 `.claude/skills/oversized-cursor/SKILL.md`（Copyright 2026 HeyGen, Inc.，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-hyperframes.txt`](../LICENSES/Apache-2.0-hyperframes.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
