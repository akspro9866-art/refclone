---
id: chat-thread
name: 对话一条条上来
one_liner: 消息一条条出现，新气泡从 0.75 倍长到 1 倍，旧的对话整体往上推一格；问和答左右分开，条与条之间给够读的时间
family: ui
role: [feature]
intent: [process, interact]
energy: 2
duration_f: [90, 180]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element, text]
sound: optional
pitfalls: [too-fast, fake-ui, copy-drift]
qa: {peak: 39, settle: 108}
status: tuned
pairs_with: [answer-stream]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/chat-thread/README.md, license: MIT, note: 参数（出现时长、起始倍率、消息间隔、行高）和禁止项}
sketch_sha: "23d0ee5fa620"
---

# 对话一条条上来 · chat-thread

## 意图

把一段问答、一个聊天机器人的回复流程按时间摆出来：谁问、谁答、先后关系一目了然。旧消息往上推，新消息从底部长出来，观众的视线始终停在底部。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 第一条 | 9–16 | 右侧（用户）气泡从自己的下角长出来，0.75 → 1 倍 |
| 推上去 | 每条出现时 | 旧消息整体往上推一格（8 帧，outCubic） |
| 往下 | 每 27 帧一条 | 左侧（产品）回答、再问、再答 |
| 停留 | 108– | 最后一条停到读完 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 出现 | 0.2 s，从 0.75 倍（0.75–0.95），原点在气泡的下角 | 从中心放大，像弹窗 | |
| 消息间隔 | 0.9 s（0.9–2.0，按长度） | 比读的速度快，就成了刷屏 | ★ |
| 推上 | 和新消息同时开始，8 帧 | 先推再出，有一拍空白 | |
| 左右 | 用户在右（强调色），产品在左（底色） | | |

## 声音

每条消息一声很轻的"啵"，左右两边可以用两个音高。

## 风格适配

- 结构参数：底部长出、旧的上推、左右分开、按读速给间隔。
- 皮肤参数：气泡圆角、颜色、头像要不要。
- 量化风格：出现和上推按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lib.mixColor(bg, fg, 0.04); ctx.beginPath(); ctx.roundRect(460, 60, 1000, 960, 32); ctx.fill();
  const msgs = [[1, "Can you cut the intro to 5 s?"], [0, "Done. I kept the title and the first chord."], [1, "And the end card?"], [0, "It now holds for 2 s, long enough to read."]];
  const at = (k) => 0.3 + k * 0.9, Hb = 96, gap = 24, BOTTOM = 960;
  lib.setFont(ctx, tokens, "display", 40, { weight: 500 });
  msgs.forEach(([me, s], k) => {
    if (t < at(k)) return;
    let lift = 0; for (let j = k + 1; j < msgs.length; j++) lift += (Hb + gap) * lib.ease.outCubic(lib.seg(t, at(j), at(j) + 0.27));   // newer ones push it up
    const w = ctx.measureText(s).width + 64, x = me ? 1400 - w : 520, y = BOTTOM - Hb - lift;
    const g = lib.lerp(0.75, 1, lib.ease.outBack(lib.seg(t, at(k), at(k) + 0.2))), ox = me ? x + w : x, oy = y + Hb;   // grows from its lower corner
    ctx.save(); ctx.translate(ox, oy); ctx.scale(g, g); ctx.translate(-ox, -oy); ctx.globalAlpha = lib.seg(t, at(k), at(k) + 0.12);
    ctx.fillStyle = me ? ac : lib.mixColor(bg, fg, 0.1); ctx.beginPath(); ctx.roundRect(x, y, w, Hb, 30); ctx.fill();
    ctx.fillStyle = me ? bg : fg; ctx.fillText(s, x + 32, y + 61); ctx.restore();
  });
}
```

## 已知坑

- 消息间隔比读的速度快 → 按字数给，短句 0.9 s 起。
- 气泡从中心放大，像弹窗 → 原点放在气泡贴着的那一侧的下角。
- 对话内容是编的产品能力 → 用产品真能做到的事。

## 验收帧

- `peak`（第 39 帧）：第二条（回答）刚长出来，第一条正被推上去。
- `settle`（第 108 帧）：四条都在，最后一条停住。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 chat-thread。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；草图是本仓库写的，对话是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/chat-thread/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
