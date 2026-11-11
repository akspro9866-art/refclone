---
id: row-embed
name: 行嵌入
one_liner: 数据行一条条从上方落下，从斜的俯仰角放平，卡进页面里自己的行位，卡进去的那一帧底边闪一道强调色的缝
family: ui
role: [feature]
intent: [detail, process]
energy: 3
duration_f: [68, 100]
types: [promo, data]
engines: [canvas, hyperframes]
aspect: [landscape, portrait]
needs: [ui-page]
sound: optional
pitfalls: [float-not-land, glow-spill, fake-ui]
qa: {peak: 40, settle: 70}
status: upstream-tested
pairs_with: [portal-wipe]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/ui-entrance/row-embed.md, license: Apache-2.0, note: 结构、判例}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/ui-entrance/row-embed/RowEmbed.tsx, license: Apache-2.0, note: 节拍、飞行姿态、补丁、强调色缝、相机}
sketch_sha: "9b3e2eae7278"
---

# 行嵌入 · row-embed

## 意图

要让观众觉得数据是长在页面里的，而不是凭空显示出来的。每一行从上方落下、放平，正好卡进属于它的那一行；卡进去的那一帧，行底亮起一道细缝，眼睛看到的是"咔哒"一声。结构化数据进入详情页、列表成批入场，都可以用它。

## 阶段与时值

第 0 帧 = 镜头开始下摇。下表按 5 行算。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 相机 | 0–68 | 匀速下摇（原 demo：页面坐标里镜头中心从 y 300 摇到 760），缩放 1.1 → 1.0；和行雨同时进行 |
| 行雨 | 12–60 | 第 i 行在 12 + 9i 帧出发，飞 12 帧：从上方 120 px、俯仰 16° 的姿态收平落下，`bezier(0.3,0,0.25,1)`；前 3 帧淡入 |
| 落地 | 每行 +12 | 缩放 1.06 → 0.995，再 4 帧回到 1（轻压）；行位上的补丁在落地后 2 帧消失 |
| 缝 | 每行 +12 到 +20 | 底边 2 px 强调色缝从中心向两边 5 帧展开，8 帧内淡掉，带 6 px 辉光 |
| 静止 | 68 起 | 最后一道缝在第 68 帧收完，整页静止 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 节拍 | 第 i 行 = 12 + 9i；先算"最后一行何时落地"再定间隔 | 行数 × 间隔要对上镜头的预算；5 行在第 60 帧落完 | ★ |
| 飞行姿态 | 透视下 `translateY(−120·air) rotateX(16°·air)`，air 从 1 到 0 | 俯仰收平是"嵌进去"的关键读感；纯垂直下落读作贴纸 | ★ |
| 飞行体 | 用整页截图裁出这一行（背景图负偏移），不重画内容 | 重画的行和页面的字体渲染有肉眼可见的差别（判例 Q1） | ★ |
| 空槽补丁 | 行位先盖一块页面底色，落地后 2 帧消失 | 没有补丁，截图里烤进去的行会先透出来，飞入变成重影 | |
| 缝 | 只在底边、只闪一次、裁在圆角里 | 四边都闪读作选中框；光溢出圆角是廉价感的来源（判例 Q4） | |
| 相机 | 和行雨并行匀速下摇 | 相机等行落完再动，镜头会拖 | |
| 终点 | 页面布局里的真实槽位 | 悬在页面上方不落，显得假（判例 Q9） | ★ |

## 声音

镜头切入时一声柔和的过渡音（模板片第 475 帧）；行落地不逐条配音。行数多、间隔匀的时候逐条 pop 会像机枪，缝就是视觉上的拟音（shotcraft 声音判例 S2 的反面自检）。

## 风格适配

- 结构参数：等间隔的行雨（行少，等距就够；大批量才需要加速，见 [deal-to-grid](deal-to-grid.md)）、俯仰收平、补丁、底边的缝、并行的相机。
- 皮肤参数：缝的颜色、行的圆角和阴影。
- 平面风格不做俯仰：改成从上方 40 px 滑下、落地时压一下，缝照旧。
- 竖屏：行更窄，行数更多时间隔缩到 6–7 帧，仍然先算最后一行的落地时间。

## 实现

```js
// row-embed：5 行，第 i 行在 12 + 9i 帧出发，飞 12 帧（俯仰收平 + 下落），落地轻压，底边强调色缝从中心展开。
const T0 = 10, ROWS = 5, RW = 1500, RH = 120, X = 210, Y0 = 300, GAP = 150;
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0, fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent"), bg = lib.color(tokens, "bg");
  const cam = lib.seg(k, 0, 68), camY = lib.lerp(300, 560, cam), z = lib.lerp(1.1, 1.0, cam);   // 匀速下摇（草图页面上的坐标）
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -camY);
  lib.setFont(ctx, tokens, "display", 64, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText("Detail", X, 200);
  for (let i = 0; i < ROWS; i++) {
    const y = Y0 + i * GAP, cue = 12 + 9 * i, land = cue + 12;
    const p = lib.bezier(0.3, 0, 0.25, 1)(lib.seg(k, cue, land)), air = 1 - p;
    if (k < land + 2) { ctx.fillStyle = bg; ctx.fillRect(X - 8, y - 4, RW + 24, RH + 8); }         // 空槽补丁
    if (k < cue) continue;
    const sc = k < land ? 1.06 - 0.065 * p : 0.995 + 0.005 * (1 - (1 - lib.seg(k, land, land + 4)) ** 2);
    ctx.save(); ctx.globalAlpha = lib.seg(k, cue, cue + 3);
    ctx.translate(X + RW / 2, y + RH / 2 - 120 * air); ctx.scale(sc, sc * Math.cos(16 * air * Math.PI / 180));   // 平面近似：俯仰 = 纵向压缩
    ctx.shadowColor = lib.rgba("#1e1912", 0.22 * air); ctx.shadowBlur = 60 * air; ctx.shadowOffsetY = 30 * air;
    ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.6); ctx.beginPath(); ctx.roundRect(-RW / 2, -RH / 2, RW, RH, 8); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.fillStyle = lib.rgba(fg, 0.45); ctx.fillRect(-RW / 2 + 32, -18, 260 + 200 * lib.hash(2, i), 14);
    ctx.fillStyle = lib.rgba(fg, 0.2); ctx.fillRect(-RW / 2 + 32, 10, 700, 10);
    ctx.restore();
    if (k >= land && k < land + 8) {                                    // 缝：底边、从中心展开、只闪一次
      const w = RW * (1 - (1 - lib.seg(k, land, land + 5)) ** 3), a = k < land + 2 ? 1 : 1 - lib.seg(k, land + 2, land + 8);
      ctx.fillStyle = lib.rgba(ac, a); ctx.shadowColor = ac; ctx.shadowBlur = 6; ctx.fillRect(X + (RW - w) / 2, y + RH - 2, w, 2); ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
}
```

草图用纵向压缩近似俯仰；要有真正的透视（远边小、近边大），用 CSS 3D（`perspective(900px) rotateX(…)`）或 Three.js。飞行体在正式片里是整页截图里裁出来的那一行。

## 已知坑

- **悬浮不落**：行要飞进页面布局里真实的位置，落地即嵌入（判例 Q9："从空中飞入，嵌入 dashboard"）。
- **光溢出圆角**：缝和辉光都裁在行的圆角里面（判例 Q4）。
- **重画的行**：用截图裁片，不重画内容；重画的字和页面其他地方对不上（判例 Q1）。
- **逐条配 pop**：行多、间隔匀的时候会像机枪，靠缝做视觉拟音就够了。

## 验收帧

- `peak`（第 40 帧）：两三行同时在空中，姿态从仰到平依次变化；底下的空槽补丁还在。
- `settle`（第 70 帧）：所有行都嵌在页面里、和截图里的布局严丝合缝，缝已经消失，整页静止。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的界面卡 `row-embed` 和 demo `RowEmbed.tsx`（模板片里有用户判例的一镜）。文字重写；节拍、飞行姿态、落地轻压、补丁、缝和相机的数值取原值；平面风格和竖屏的做法是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/ui-entrance/row-embed.md`、`demos/ui-entrance/row-embed/RowEmbed.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
