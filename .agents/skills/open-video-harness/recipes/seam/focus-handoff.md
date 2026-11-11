---
id: focus-handoff
name: 虚焦接力
one_liner: 前景失焦、淡出、略向一侧滑走，后景错开 2 帧反向收焦进来，焦点本身就是剪辑点
family: seam
role: [seam]
intent: [refocus]
energy: [2, 3]
duration_f: [12, 20]
jump: [level]
types: [promo, paper, data, short]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [none]
sound: optional
pitfalls: [uniform-timing, seam-mismatch]
qa: {seam: 9, settle: 20}
status: tuned
pairs_with: [black-card]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/transition/shot-transitions.md, license: Apache-2.0, note: 六式中的 C 式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/transition/shot-transitions/FocusHandoffTransition.tsx, license: Apache-2.0, note: 帧数、模糊量、错开起跑}
sketch_sha: "714652fcabf3"
---

# 虚焦接力 · focus-handoff

## 意图

同一个空间里换一个地方看：同一页的另一块区域、长文档的下一节、同一张图的另一处细节。镜头不移动，只是把焦点从这里交给那里，观众的注意力跟着清晰的那一层走。它比甩镜安静，适合信息镜头之间。

## 阶段与时值

第 0 帧 = 前景开始失焦。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 前景失焦 | 0–16 | 模糊 0 → 8 px，不透明度 1 → 0，向左滑 60 px；`bezier(0.45,0,0.3,1)` |
| 后景收焦 | 2–18 | 晚 2 帧起跑：模糊 8 → 0 px，不透明度 0 → 1，从左侧 50 px 处滑回原位；`bezier(0.3,0,0.2,1)` |
| 后景静止 | 18 起（属于后镜） | 真静止，让观众读 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 错开起跑 | 后景比前景晚 2–4 帧 | 同一帧起跑，交叉的那几帧整屏一样糊，读作画面坏了 | ★ |
| 交叉窗口 | 每层 10–16 帧 | 再短像硬切加了点糊；再长就是慢溶解 | |
| 模糊量 | 8 px（1080p） | 画幅变了按高度等比换算；太小读不出"失焦"，太大像转场特效 | |
| 滑动 | 前景向一侧 60 px，后景从另一侧 50 px 回位 | 只动一点点，给失焦一个方向，不要变成推拉 | |
| 景深先立后用 | 这一段里之前已经出现过浅景深（背景虚、主体实） | 景深语言突然出现一次，读作失误而不是设计 | ★ |

## 声音

可以不配。要配就用很轻的一声过渡音，钉在后景开始收焦的第 2 帧；不要用 whoosh，这一式没有运动感。

## 风格适配

- 结构参数：错开起跑、两层方向相反、模糊由深到浅的时长。
- 皮肤参数：模糊的质感。像素风（`pixel-16bit`）不要真模糊，改成马赛克格子由大到小（同样的时值）；半调、孔版风格可以改成网点由粗到细。
- DOM 里不要动画 CSS `blur`（playbook/03 §4）：在 canvas 层用 `ctx.filter` 做，或每层准备一张模糊副本和清晰版交叉淡入。

## 实现

```js
// focus-handoff：A 在 40–56 帧失焦淡出，B 在 42–58 帧收焦淡入，两层滑动方向相反。
const T0 = 40;
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0;
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  const a = lib.bezier(0.45, 0, 0.3, 1)(lib.seg(k, 0, 16));            // A：出焦
  const b = lib.bezier(0.3, 0, 0.2, 1)(lib.seg(k, 2, 18));             // B：晚 2 帧起跑，入焦
  layer(ctx, lib, lib.offscreen("fh-a", (x) => page(x, tokens, lib, 5)), 1 - a, a * 8, -a * 60);
  layer(ctx, lib, lib.offscreen("fh-b", (x) => page(x, tokens, lib, 9)), b, (1 - b) * 8, -(1 - b) * 50);
}
function layer(ctx, lib, img, alpha, blur, dx) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha; if (blur > 0.05) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(img, dx, 0); ctx.restore();
}
function page(ctx, tokens, lib, seed) {                                // 灰盒页面，透明底，只画内容
  const fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(seed, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = i === seed ? ac : lib.rgba(fg, 0.4); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(seed, i, 1), 16);
    ctx.fillStyle = lib.rgba(fg, 0.18); ctx.fillRect(x + 32, y + 70, 300, 10); ctx.fillRect(x + 32, y + 92, 240, 10);
  }
}
```

两层画成透明底的图层再叠，底色只画一次；否则两层底色交叉淡化时，画面整体会暗一下。

## 已知坑

- **同帧起跑**：两层在同一帧开始，中间几帧整屏一样糊。至少错开 2 帧（原 demo 的值）。
- **两层都带底色**：各自带着不透明的底色交叉淡化，中段会出现一次亮度凹陷。底色放在最下面只画一次。
- **拿它换空间**：前后两景不在同一个空间（换了产品、换了场景），焦点接力没有依据，读作溶解。换空间用 `dark-tunnel` 或 `whip-pan`，换章节用 `black-card`。
- **不是判例**：这一式来自 shotcraft 对 Linear 发布片的抽帧逆向，是默认建议，没有用户判例。

## 验收帧

- `seam`（第 9 帧）：两层都半透明，但分得出哪层在出、哪层在进；不是一整屏均匀的糊。
- `settle`（第 20 帧）：后景完全清晰、静止，前景已经没有残影。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）转场卡 `shot-transitions` 的 C 式和 demo `FocusHandoffTransition.tsx`；原作者注明它来自对 Linear 发布片的抽帧逆向。文字重写；帧数、模糊量、滑动距离和错开起跑取原值；像素风、半调风格的替代做法和"底色只画一次"是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/transition/shot-transitions.md`、`demos/transition/shot-transitions/FocusHandoffTransition.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
