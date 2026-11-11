---
id: char-stagger
name: 字按阅读顺序升起
one_liner: 一行短标题的字按阅读顺序从下方 64 px 升起、同时淡入，每个字比前一个晚 1 帧，各走约 0.6 s；中文按字、英文按字母
family: type
role: [hook, open]
intent: [enter]
energy: 2
duration_f: [30, 90]
types: [promo, short, mv, data]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [too-fast, uniform-timing]
qa: {peak: 18, settle: 45}
status: tuned
pairs_with: [breath-title-card]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/char-stagger/README.md, license: MIT, note: 参数（间隔、距离、单字时长）和禁止项}
sketch_sha: "f34edcf80574"
---

# 字按阅读顺序升起 · char-stagger

## 意图

让一个短标题按读的方向一个字一个字站起来：观众的眼睛跟着入场的先后读下去，标题有了节奏。只给短标题和一句话用，长段落逐字动就成了噪音。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 等待 | 0–9 | 空画面 |
| 升起 | 9–45 | 第一个字从下方 64 px 升起并淡入，之后每个字晚 1 帧（0.035 s），每个字走 18–19 帧 |
| 停留 | 45– | 标题停住，读完再走 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 字间隔 | 0.035 s（0.02–0.06） | 空格也算一格 | ★ |
| 升起距离 | 64 px（32–80） | 距离和间隔不要同时调大，会变成"飞" | |
| 单字时长 | 0.62 s（0.4–0.8），位移和透明一起结束 | | |
| 缓动 | outCubic | 匀速像打字机 | |

## 声音

可以不配；配的话一声轻的上行音，不要每个字一声。

## 风格适配

- 结构参数：阅读顺序、字间隔、位移和透明同时结束。
- 皮肤参数：字体、字号、距离。
- 量化风格：按一拍二走，每个字的位置一跳一跳。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const line = (str, role, size, y, start, col) => {   // each character a beat after the last, in reading order
    lib.setFont(ctx, tokens, role, size, { weight: 700 });
    const gs = lib.graphemes(str); let x = (W - ctx.measureText(str).width) / 2;
    gs.forEach((ch, i) => {
      const u = lib.ease.outCubic(lib.seg(t, start + i * 0.035, start + 0.62 + i * 0.035));
      ctx.globalAlpha = u; ctx.fillStyle = col; ctx.fillText(ch, x, y + 64 * (1 - u)); x += ctx.measureText(ch).width;
    });
    ctx.globalAlpha = 1;
  };
  line("Motion reads first", "display", 130, 500, 0.3, fg);
  line("每一帧都先被读到", "zh", 84, 650, 0.75, ac);
}
```

逐字测宽会丢掉字偶距；正式做时用 `lib.layoutText` 排一次、再逐字画（`lib.drawGlyphs`），HyperFrames 里每个字一个 span、`transform` 由 t 算。

## 已知坑

- 整段正文逐字升起 → 只给标题和一句话用。
- 间隔和距离同时调大，字像从底下飞上来 → 只调一个。
- 中文按字可以；英文长单词按字母会碎，超过 20 个字母改按词。

## 验收帧

- `peak`（第 18 帧）：英文行前半已经站好，后半还在升起；中文行还没开始。
- `settle`（第 45 帧）：两行都齐了。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 char-stagger。文字重写；参数（间隔、距离、单字时长、起始时刻）沿用卡片的默认值和范围，按 30 fps 换算；中英两行、逐字测宽的草图是本仓库写的。卡片自己注明的概念来源（GSAP 时间线文档、HyperFrames）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/char-stagger/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
