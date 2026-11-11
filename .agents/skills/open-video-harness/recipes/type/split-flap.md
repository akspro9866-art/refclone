---
id: split-flap
name: 翻牌字
one_liner: 每个字是一张上下两半的翻牌，上半沿中线往下折、下半翻出新字，中途闪过两个别的字；从左往右每格晚 1 帧，像机场的到站牌
family: type
role: [hook, proof]
intent: [count, transform]
energy: 3
duration_f: [20, 60]
types: [promo, short, data]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [text, number]
sound: recommended
pitfalls: [too-fast, overuse]
qa: {peak: 18, settle: 45}
status: tuned
pairs_with: [glyph-roll]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/split-flap/README.md, license: MIT, note: 参数（每次翻动时长、错开、中间字数）和禁止项}
sketch_sha: "2b2659ef57ee"
---

# 翻牌字 · split-flap

## 意图

时间、排名、库存、目的地这类会"刷新"的短信息：像车站的翻牌一样一格格翻到新值。机械感本身就是信息：它在更新，而且是按顺序更新。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 一排翻牌显示旧值 |
| 翻动 | 9–42 | 每格依次翻三次（经过两个随机字到新值），每次 6 帧：上半往下折 3 帧、下半翻起 3 帧；每格比左边晚 1 帧 |
| 停留 | 42– | 新值停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 每次翻动 | 0.2 s（0.15–0.3） | 再慢就不像机械了 | |
| 格间错开 | 0.04 s（0.02–0.06），从左往右 | | |
| 中间字数 | 2（0–4），由 `hash` 选 | 太多就成了老虎机 | |
| 长度 | 8 个字以内 | 长句子翻起来没完 | ★ |

## 声音

每次翻动一声短促的"嗒"，一排一起翻就是一串；这是它的一半魅力。

## 风格适配

- 结构参数：上下两半、中线为轴、从左往右、经过中间字。
- 皮肤参数：牌的颜色和圆角、字体（等宽最像）。
- 量化风格：天然是台阶，不用改。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const from = "PARIS", to = "TOKYO", CW = 190, CH = 260, X0 = (W - from.length * (CW + 16)) / 2, Y = 390, ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const half = (ch, x, top, k = 1, shade = 0) => {   // one half of a card: the glyph clipped to it, squashed toward the hinge by k
    ctx.save(); ctx.translate(0, Y + CH / 2); ctx.scale(1, k); ctx.translate(0, -(Y + CH / 2));
    ctx.beginPath(); ctx.rect(x, top ? Y : Y + CH / 2, CW, CH / 2); ctx.clip();
    ctx.fillStyle = lib.mixColor(fg, "#000000", shade); ctx.beginPath(); ctx.roundRect(x, Y, CW, CH, 14); ctx.fill();
    lib.setFont(ctx, tokens, "mono", 200, { weight: 700 }); ctx.fillStyle = bg; ctx.textAlign = "center"; ctx.fillText(ch, x + CW / 2, Y + CH / 2 + 72); ctx.restore();
  };
  [...from].forEach((c0, i) => {
    const seq = [c0, ABC[Math.floor(lib.hash(i, 1) * 26)], ABC[Math.floor(lib.hash(i, 2) * 26)], to[i]];
    const s = 0.3 + i * 0.04, f = Math.max(0, (t - s) / 0.2), k = Math.min(3, Math.floor(f)), p = k < 3 ? f - k : 1, x = X0 + i * (CW + 16);
    const A = seq[k], B = seq[Math.min(3, k + 1)];
    if (k === 3) { half(B, x, true); half(B, x, false); }
    else {
      half(B, x, true); half(A, x, false);                        // behind: the next top, the old bottom
      if (p < 0.5) half(A, x, true, 1 - 2 * p, 0.25 * 2 * p);      // the top flap folds down
      else half(B, x, false, 2 * p - 1, 0.25 * (2 - 2 * p));       // the new bottom flap unfolds
    }
    ctx.fillStyle = bg; ctx.fillRect(x, Y + CH / 2 - 2, CW, 4);     // the hinge
  });
  lib.setFont(ctx, tokens, "mono", 34); ctx.fillStyle = ac; ctx.fillText("NEXT DEPARTURE", X0, Y - 40);
}
```

HyperFrames 里每格四个元素（上半、下半、翻动的上片、翻动的下片），父元素 `perspective: 400px`，翻片只用 `rotateX`（转轴在中线），角度由 t 算。

## 已知坑

- 混进 Y 轴旋转，铰链看着别扭 → 只用 `rotateX`，透视 300–600 px。
- 翻一格超过 1 s → 每次 0.2 s，中间字不超过 4 个。
- 中间字用 `Math.random()` → 用 `hash(i, k)`，每次渲染一样。

## 验收帧

- `peak`（第 18 帧）：左边几格在翻第二、三次，右边几格刚开始，能看到折到一半的上片。
- `settle`（第 45 帧）：一排新值停住。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 split-flap。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；canvas 里用"压向中线的半张牌"模拟翻片的草图是本仓库写的。卡片注明的概念来源（react-bits、Magic UI、HyperFrames 等）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/split-flap/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
