---
id: scatter-assemble
name: 散落的字母聚成一句话
one_liner: 撒在画面四处、带着旋转的字母，从种子决定的起点依次飞回来，在落点前减速，拼成一句可读的话；落定时没有残留的旋转和透明
family: type
role: [hook, open]
intent: [enter, generate]
energy: 3
duration_f: [45, 90]
types: [promo, short, mv]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [text]
sound: optional
pitfalls: [too-fast, uniform-timing, state-leak]
qa: {peak: 24, settle: 54}
status: tuned
pairs_with: [particle-mark]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/text-scatter-assemble/README.md, license: MIT, note: 参数（起点范围、错开、时长、缓动、种子）和禁止项}
sketch_sha: "71e883f37970"
---

# 散落的字母聚成一句话 · scatter-assemble

## 意图

"零散的东西被整理成意义"：开场标题从碎片里拼出来。字母一个接一个归位，最后一刻减速，注意力在落定前收拢到句子上。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 散 | 0–6 | 字母撒在画面各处，各自带一点旋转、半透明 |
| 聚 | 6–51 | 每个字母比前一个晚 1–2 帧起飞，各飞 0.9 s，落点前减速（outCubic），旋转和透明同时归零 |
| 停留 | 51– | 句子停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 起点范围 | 横向 ±200%、纵向 ±150% 的画面半宽（相对落点） | 太近像抖了一下，太远飞不完 | |
| 错开 | 0.05 s（0.03–0.08） | 看得出落定的顺序 | |
| 单字时长 | 0.9 s（0.7–1.2） | | |
| 种子 | 起点、旋转都由 `hash(i, k)` 给 | `Math.random()` 每次渲染不同 | ★ |
| 落定 | 旋转、透明、位置同一帧归零 | 残留一点旋转，句子看着歪 | ★ |

## 声音

可以不配；配的话很密的细碎声收成一声。

## 风格适配

- 结构参数：种子起点、依次归位、落点前减速、落定无残留。
- 皮肤参数：字体、散开的范围、要不要拖尾。
- 量化风格：按一拍二飞。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const str = "Pieces become a plan", size = 120, y = 580;
  lib.setFont(ctx, tokens, "display", size, { weight: 800 });
  let x = (W - ctx.measureText(str).width) / 2;
  lib.graphemes(str).forEach((ch, i) => {
    const w = ctx.measureText(ch).width, u = lib.ease.outCubic(lib.seg(t, 0.2 + i * 0.05, 1.1 + i * 0.05));   // seeded start, decelerating home
    const dx = lib.hashS(i, 1) * W * 0.5 * (1 - u), dy = lib.hashS(i, 2) * H * 0.42 * (1 - u), r = lib.hashS(i, 3) * 1.4 * (1 - u);
    ctx.save(); ctx.translate(x + w / 2 + dx, y - size * 0.35 + dy); ctx.rotate(r); ctx.globalAlpha = lib.lerp(0.35, 1, u);
    ctx.fillStyle = i < 6 ? ac : fg; ctx.fillText(ch, -w / 2, size * 0.35); ctx.restore();
    x += w;
  });
}
```

## 已知坑

- 起点用 `Math.random()` → `hash(i, k)`，乱序渲染也一样。
- 落定那一帧还带着 1–2° 的旋转或 0.98 的透明 → 三样同一个进度，一起归零。
- 超过 20 个字的句子 → 换别的入场，散开太多读不出。

## 验收帧

- `peak`（第 24 帧）：前几个字母已经归位，后面的还在空中、带着旋转。
- `settle`（第 54 帧）：整句落定，没有歪的字。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 text-scatter-assemble。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；草图是本仓库写的。卡片注明的概念来源（Codrops 的两个排版示例、reelforge）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/text-scatter-assemble/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
