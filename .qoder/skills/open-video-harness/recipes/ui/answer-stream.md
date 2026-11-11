---
id: answer-stream
name: 回答按词组流出来
one_liner: 一段 AI 回答按词组一块块出来，每块先以 22% 浓度出现、0.26 s 内实到 100%，末尾跟一个强调色的光标块；出完停住给读的时间
family: ui
role: [feature, proof]
intent: [generate, process]
energy: 2
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element, text]
sound: optional
pitfalls: [fake-ui, too-fast, copy-drift]
qa: {peak: 39, settle: 84}
status: tuned
pairs_with: [chat-thread, doc-self-writing]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/answer-stream/README.md, license: MIT, note: 参数（组数、间隔、起始浓度、实化时长）和禁止项}
sketch_sha: "b4664d68cfe8"
---

# 回答按词组流出来 · answer-stream

## 意图

演示一个 AI 产品"在生成"：回答不是一下出现，而是一块块流出来，新出来的那块先淡、马上实，观众看得见生成的顺序和当前写到哪了。出完要停，给人读。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 提问 | 0–15 | 面板里一个提问的气泡 |
| 流出 | 18–77 | 回答分 10 组，每 5–6 帧出一组；新组先以 22% 浓度出现，8 帧内实到 100%；末尾一个强调色光标块跟着走 |
| 收 | 77–107 | 光标块闪两下后消失 |
| 停留 | 77– | 回答停住，至少 0.5 s，按字数给足 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 组数 | 10（6–16），按意群切 | 按字切太碎，整句出又看不出顺序 | |
| 组间隔 | 0.18 s（0.12–0.25） | | |
| 起始浓度 | 0.22（0.15–0.4），只有新组是淡的 | 整段一起淡入，看不出生成顺序 | ★ |
| 实化 | 0.26 s（0.15–0.35） | | |
| 结束后停留 | ≥ 0.5 s，按字数 | 刚出完就切，没人读完 | ★ |

## 声音

可以不配；配的话很轻的连续 tick，出完停。

## 风格适配

- 结构参数：按组出、新组淡、光标块跟着末尾、出完停。
- 皮肤参数：面板样式、光标块颜色、字体。
- 量化风格：本来就是一组组跳，不用改。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lib.mixColor(bg, fg, 0.04); ctx.beginPath(); ctx.roundRect(360, 120, 1200, 840, 28); ctx.fill();
  lib.setFont(ctx, tokens, "display", 44, { weight: 500 });
  const q = "How should a film open?", qw = ctx.measureText(q).width;
  ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(1500 - qw - 60, 180, qw + 60, 84, 30); ctx.fill(); ctx.fillStyle = bg; ctx.fillText(q, 1500 - qw - 30, 237);
  const groups = ["Start with ", "the picture, ", "not the logo. ", "Ask one question ", "the film will answer, ", "then show ", "the first step ", "of the answer ", "within ", "two seconds."];
  lib.setFont(ctx, tokens, "display", 56, { weight: 500 });
  let x = 420, y = 380, end = null;
  groups.forEach((g, k) => {   // group by group; only the newest is faint
    const s = 0.6 + k * 0.18, w = ctx.measureText(g).width;
    if (x + w > 1500) { x = 420; y += 84; }
    if (t >= s) { ctx.globalAlpha = lib.lerp(0.22, 1, lib.seg(t, s, s + 0.26)); ctx.fillStyle = fg; ctx.fillText(g, x, y); end = [x + ctx.measureText(g.trimEnd()).width, y]; }
    x += w;
  });
  ctx.globalAlpha = 1;
  const done = 0.6 + 9 * 0.18 + 0.26;
  if (end && (t < done || (t < done + 1.0 && lib.step(t, 4) * 4 % 2 === 0))) { ctx.fillStyle = ac; ctx.fillRect(end[0] + 10, end[1] - 44, 22, 52); }   // the cursor block
}
```

## 已知坑

- 整段一起淡入 → 只有最新的一组是淡的。
- 回答内容是编的、和产品真实输出不一样 → 用产品的真实输出，或者明确标成示意。
- 出完立刻切走 → 停到读完。

## 验收帧

- `peak`（第 39 帧）：回答出了一半多，最新一组还是淡的，光标块在末尾。
- `settle`（第 84 帧）：回答出完，光标块在闪，整段可读。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 answer-stream。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；草图是本仓库写的，问答内容是占位。卡片注明的概念来源（GSAP、HyperFrames）只是手法出处，没有代码进来。和 `doc-self-writing` 的区别：那一张是整页排版好的文档在光标后面一块块写出来、侧栏跟着铺开，这一张只是一段对话式的回答按词组流出。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/answer-stream/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
