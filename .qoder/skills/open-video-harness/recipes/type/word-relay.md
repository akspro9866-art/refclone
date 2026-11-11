---
id: word-relay
name: 大字接力
one_liner: 一个巨大的词从右边冲进来、在中间停 0.6 s、往左退场，下一个词同时冲进来接棒；两到五个词，最后一个词留下来当结论
family: type
role: [hook, climax]
intent: [accelerate, punctuate, promise]
energy: 4
duration_f: [60, 150]
types: [promo, short, meme]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: recommended
pitfalls: [too-fast, overuse]
qa: {peak: 21, settle: 123}
status: tuned
pairs_with: [accelerando-cuts]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/word-relay/README.md, license: MIT, note: 参数（进场、停留、退场、最后一词）和禁止项}
sketch_sha: "6f0ae6a52a91"
---

# 大字接力 · word-relay

## 意图

两到五个词的口号，一次只给一个巨大的词：词像接力棒一样传下去，节奏感就是信息。最后一个词不走，它是结论。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 第一个词 | 6–36 | 从右边 1400 px 外冲进来（12 帧，outCubic），在中间停 18 帧，往左退（9 帧，inCubic） |
| 接棒 | 每 33 帧一个 | 上一个开始退场 3 帧后，下一个冲进来；两个词错开，不叠在一起 |
| 结论 | 105–123 | 最后一个词进来后不再退场，换成强调色 |
| 停留 | 123– | 结论停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 进场 | 0.4 s（0.3–0.5），从画面外（约 +1400 px） | | |
| 停留 | 0.6 s（0.5–1.0） | 少于 0.5 s 读不完就走了 | ★ |
| 退场 | 0.3 s（0.25–0.4），到画面外 | 退场比进场快，才有"传下去"的感觉；下一个晚 0.1 s 进，两个大字才不会撞在一起 | ★ |
| 词数 | 2–5 个 | 6 个以上就拖了 | ★ |

## 声音

每个词进场一声短促的重音（鼓或 whoosh 的尾），节奏对着拍子；结论那一下最重。

## 风格适配

- 结构参数：一次一个词、右进左出、接棒交错、结论留下。
- 皮肤参数：字体（越粗越好）、颜色、方向（竖屏可以上进下出）。
- 量化风格：按一拍二进出，冲击感更强。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const words = ["Write.", "Render.", "Check.", "Ship."];
  lib.setFont(ctx, tokens, "display", 280, { weight: 900 }); ctx.textAlign = "center";
  words.forEach((w, i) => {
    const s = 0.2 + i * 1.1, last = i === words.length - 1;   // the next word enters just after this one starts to leave
    const inn = lib.ease.outCubic(lib.seg(t, s, s + 0.4)), out = last ? 0 : lib.ease.inCubic(lib.seg(t, s + 1.0, s + 1.3));
    if (inn <= 0 || out >= 1) return;
    ctx.fillStyle = last ? lib.mixColor(fg, ac, lib.seg(t, s + 0.4, s + 0.6)) : fg;
    ctx.fillText(w, W / 2 + 1400 * (1 - inn) - 1400 * out, H / 2 + 100);
  });
  ctx.textAlign = "left";
}
```

## 已知坑

- 每个词只停 0.3 s → 至少 0.5 s，最后一个停到读完。
- 六个以上的词 → 拆成两段，或者换别的手法。
- 整支片子反复用 → 一支片子用一次，放在钩子或高潮。

## 验收帧

- `peak`（第 21 帧）：第一个词停在中间。
- `settle`（第 123 帧）：结论词停在中间、强调色。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 word-relay。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；"上一个开始退场、下一个随即进来"的错开和结论变色是本仓库的写法；草图是本仓库写的。卡片注明的概念来源是同作者的 awesome-html-scrolline-deck（MIT）。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/word-relay/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
