---
id: toast-stack
name: 通知一张张叠上来
one_liner: 完成通知从右边滑进来、在右上角叠成一摞，最新的在最上面；中间一条被关掉以后，下面的平滑补上空位，同时可读的不超过三条
family: ui
role: [feature, proof]
intent: [abundance, process]
energy: 3
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [ui-element, text]
sound: optional
pitfalls: [too-fast, fake-ui]
qa: {peak: 51, settle: 99}
status: tuned
pairs_with: [upload-stack]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/toast-stack/README.md, license: MIT, note: 参数和"同时不超过三条"的禁止项}
sketch_sha: "ee361e9c87d6"
---

# 通知一张张叠上来 · toast-stack

## 意图

告诉观众"好几件事都办完了"：渲染完成、字幕对齐、检查通过，一条条通知叠上来，顺序就是事情发生的顺序。关掉一条，其余的补位，摞子一直是整齐的。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 进 | 9、27、45 起 | 三条通知依次从右边 140 px 外滑进（outCubic，10 帧），新的在上，旧的往下让一格 |
| 关 | 78–87 | 中间那条往右滑出、淡掉 |
| 补位 | 80–92 | 下面那条平滑地升上来补空位 |
| 停留 | 92– | 两条停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 进场 | 0.35 s，从右 140 px，outCubic | | |
| 间隔 | 0.6 s 起，按读的速度 | 太快读不完 | |
| 同时可读 | ≤ 3 条 | 多了就是刷屏 | ★ |
| 补位 | 关掉一条后，其余平滑移动，不跳 | 一下跳过去，看不出谁走了 | ★ |

## 声音

每条进来一声很轻的提示音，关掉那条不配。

## 风格适配

- 结构参数：新的在上、旧的让位、关掉后补位。
- 皮肤参数：通知卡的样子、图标、角落位置。
- 量化风格：进出和补位按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lib.mixColor(bg, fg, 0.05); ctx.fillRect(160, 120, 1000, 840);   // the page underneath, kept quiet
  const toasts = [{ at: 0.3, a: "Render finished", b: "film.mp4 · 1:12" }, { at: 0.9, a: "Captions synced", b: "38 cues", off: 2.6 }, { at: 1.5, a: "Check passed", b: "no failures" }];
  const TW = 600, TH = 112, GAP = 16, X = W - 120 - TW, TOP = 120, io = lib.ease.outCubic;
  const enter = (k) => io(lib.seg(t, toasts[k].at, toasts[k].at + 0.35)), gone = (k) => (toasts[k].off ? lib.ease.inOutCubic(lib.seg(t, toasts[k].off, toasts[k].off + 0.4)) : 0);
  toasts.forEach((o, k) => {
    const e = enter(k); if (e <= 0) return;
    let y = TOP; for (let j = k + 1; j < toasts.length; j++) y += (TH + GAP) * enter(j) * (1 - gone(j));   // newer ones sit above; a closed one gives its place back
    const d = gone(k), x = X + 140 * (1 - e) + 160 * d;
    ctx.globalAlpha = e * (1 - d);
    ctx.fillStyle = bg; ctx.strokeStyle = lib.mixColor(bg, fg, 0.18); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x, y, TW, TH, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(x + 52, y + TH / 2, 16, 0, lib.TAU); ctx.fill();
    lib.setFont(ctx, tokens, "display", 36, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText(o.a, x + 92, y + 50);
    lib.setFont(ctx, tokens, "display", 28, { weight: 400 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.4); ctx.fillText(o.b, x + 92, y + 88);
    ctx.globalAlpha = 1;
  });
}
```

## 已知坑

- 同时堆五六条 → 最多三条可读，其余收成"还有 3 条"。
- 关掉一条，下面的一下跳上来 → 补位要有过程。
- 通知内容是产品做不到的事 → 文案对着真实功能写。

## 验收帧

- `peak`（第 51 帧）：三条都在，最新的一条刚落定在最上面。
- `settle`（第 99 帧）：中间那条已关，剩下两条贴在一起。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 toast-stack。文字重写；时序和"同时不超过三条"沿用卡片，按 30 fps 换算；"关掉一条后补位"的写法和草图是本仓库写的，通知文案是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/toast-stack/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
