---
id: glyph-roll
name: 字在槽里滚到下一个
one_liner: 每个字是一格只露一个字高的槽，字条往上滚、换成新词的同位字，左边的先走、每格晚 1–2 帧；状态词、按钮标签换值时用
family: type
role: [feature]
intent: [transform, count]
energy: 2
duration_f: [20, 45]
types: [promo, short, data]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text, ui-element]
sound: optional
pitfalls: [too-fast, overuse]
qa: {peak: 18, settle: 36}
status: tuned
pairs_with: [split-flap]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/glyph-roll/README.md, license: MIT, note: 参数（单字时长、错开、滚动距离、方向）和禁止项}
sketch_sha: "b10aead3bb3d"
---

# 字在槽里滚到下一个 · glyph-roll

## 意图

按钮上的字、状态词、短代码换成另一个值：不是淡入淡出，而是每个字像计数器一样滚到下一个。精确、机械、一眼看出"变了"。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–12 | 胶囊里显示旧词 |
| 滚动 | 12–33 | 每格的字条往上滚一个字高，旧字出上沿、新字从下沿进，入出都缓；每格比左边晚 1–2 帧 |
| 停留 | 33–75 | 新词停住；样片在 2.6 s 再换一次 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 单字时长 | 0.7 s（0.5–0.9），outCubic | | |
| 格间错开 | 0.05 s（0.03–0.08） | | |
| 槽 | 只露一个字高（`overflow: hidden`） | 露出上下的字，滚动就脏了 | ★ |
| 长度 | 5–6 个字以内 | 太长整体时间拖得很长 | |

## 声音

可以不配；配的话一串很轻的齿轮 tick。

## 风格适配

- 结构参数：一格一槽、往同一方向滚、从左往右错开。
- 皮肤参数：字体（等宽最稳）、胶囊样式、方向（顺着选项的顺序上滚或下滚）。
- 量化风格：按一拍二滚，字会在槽里跳一格。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const words = ["Queued", "Synced", "Shared"], swaps = [0.4, 2.6], size = 110, cw = 76, h = size * 1.25;
  const X = (W - words[0].length * cw) / 2, Y = 560;
  ctx.fillStyle = lib.mixColor(bg, fg, 0.08); ctx.beginPath(); ctx.roundRect(X - 70, Y - h / 2 - 30, words[0].length * cw + 140, h + 60, (h + 60) / 2); ctx.fill();
  ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(X - 30, Y, 12, 0, lib.TAU); ctx.fill();
  lib.setFont(ctx, tokens, "mono", size, { weight: 700 }); ctx.fillStyle = fg; ctx.textAlign = "center";
  for (let i = 0; i < words[0].length; i++) {
    ctx.save(); ctx.beginPath(); ctx.rect(X + i * cw, Y - h / 2, cw, h); ctx.clip();   // the slot shows one glyph high
    let off = 0; swaps.forEach((s) => { off += lib.ease.outCubic(lib.seg(t, s + i * 0.05, s + 0.7 + i * 0.05)); });
    const k = Math.floor(off), f = off - k;
    for (const [j, dy] of [[k, -f], [k + 1, 1 - f]]) if (words[j]) ctx.fillText(words[j][i], X + i * cw + cw / 2, Y + size * 0.36 + dy * h);
    ctx.restore();
  }
  ctx.textAlign = "left";
}
```

## 已知坑

- 槽露出上下的字 → 裁到一个字高。
- 新旧词长度不同，后面的格滚出空白 → 用等长的词，或者给短词补空格并让空格也滚。
- 每次状态变化都滚 → 只给观众该注意的那一次。

## 验收帧

- `peak`（第 18 帧）：左边几格已经滚过一半，右边的刚起步。
- `settle`（第 36 帧）：新词停在槽里，上下没有残影。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 glyph-roll。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；"多次换值按 `seg` 累加"的写法和草图是本仓库写的。卡片注明的概念来源（motion-primitives、react-bits、motion.dev 的示例）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/glyph-roll/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
