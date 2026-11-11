---
id: handwrite-on
name: 笔尖按笔顺写出来
one_liner: 一个手写的词或签名按真实笔顺被笔尖一笔笔写出来：笔画走中心线、圆头，每笔的时间跟长度成正比，曲线处慢、笔与笔之间停一下
family: type
role: [outro, breath]
intent: [sign-off, hush]
energy: 1
duration_f: [45, 120]
types: [promo, short, handdrawn, mv]
engines: [canvas, hyperframes, manim]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [too-fast, sub-threshold]
qa: {peak: 66, settle: 90}
status: tuned
pairs_with: [underline-draw]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/handwriting-write-on/README.md, license: MIT, note: 参数（每笔时长、笔间停顿、线宽）和"走中心线"的禁止项}
sketch_sha: "3ba8e13f9fc3"
---

# 笔尖按笔顺写出来 · handwrite-on

## 意图

签名、问候、手写的标题：让人看见"有人在写"。手的速度和顺序带着人味，所以笔顺要对、每笔的快慢跟长度走，笔与笔之间抬一下手。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 写 | 9–72 | 五笔依次写出（每笔 0.3–0.6 s，按长度；笔间停 2–3 帧），笔尖是一个小圆点跟着走 |
| 收 | 72–87 | 最后一笔（底下的强调色花线）写完，笔尖消失 |
| 停留 | 87– | 字停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 路径 | 笔画的中心线，不是字体轮廓 | 拿轮廓来描，会出现双线的边 | ★ |
| 每笔时长 | 0.4 s（0.3–0.6），按长度比例 | 每笔一样长，短笔慢得发呆 | ★ |
| 笔间停顿 | 80 ms（60–120） | 不停就成了一条连续的线 | |
| 线宽 | 8 px（4–12），圆头圆角 | 字太小时手写感出不来 | |

## 声音

可以不配；配的话很轻的笔尖划纸声，跟着每一笔起落。

## 风格适配

- 结构参数：笔顺、中心线、按长度分配时间、笔间停顿。
- 皮肤参数：笔的颜色和粗细、要不要抖动（`wobblePath`）。
- 量化风格：按一拍二推进，笔尖一跳一跳。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const Q = (a, c, b, n = 24) => Array.from({ length: n + 1 }, (_, k) => { const u = k / n, v = 1 - u; return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]]; });
  const strokes = [   // centre lines in stroke order: H, H, crossbar, i, its dot, the swash under it all
    Q([720, 380], [700, 540], [705, 700]), Q([905, 370], [895, 540], [900, 700]), Q([690, 560], [800, 520], [925, 545]),
    Q([1040, 520], [1020, 640], [1045, 700]), Q([1040, 440], [1043, 444], [1047, 450], 4), Q([660, 780], [900, 720], [1150, 760], 32),
  ];
  const len = strokes.map((p) => p.slice(1).reduce((s, q, k) => s + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0));
  let s = 0.3; const tip = [];
  ctx.strokeStyle = fg; ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.lineJoin = "round";
  strokes.forEach((p, i) => {   // each stroke takes time in proportion to its length; the pen lifts between strokes
    const d = 0.12 + len[i] / 900, u = lib.ease.inOutSine(lib.seg(t, s, s + d));
    if (i === 5) ctx.strokeStyle = ac;
    if (u > 0) lib.strokePartial(ctx, p, u);
    if (u > 0 && u < 1) tip.push(p[Math.round(u * (p.length - 1))]);
    s += d + 0.08;
  });
  if (tip.length) { const [x, y] = tip[0]; ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(x, y, 9, 0, lib.TAU); ctx.fill(); }
}
```

真字形的中心线可以从单线字体（Hershey 之类的 single-stroke 字体）取，或者手描几笔存成点列；Manim 里用 `Create` 画中心线路径，效果相同。

## 已知坑

- 用字体轮廓做描边动画，出来是空心双线 → 用中心线。
- 每笔时间一样 → 按长度分。
- 字号太小，看不出是在写 → 手写动画只给大字。

## 验收帧

- `peak`（第 66 帧）：H 写完了，i 的竖写到一半，笔尖看得见。
- `settle`（第 90 帧）：六笔写完，底下的强调色花线也完了，笔尖已消失。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 handwriting-write-on。文字重写；参数沿用卡片的默认值和范围，按 30 fps 换算；"按长度分时间"的写法和草图是本仓库写的。卡片注明的概念来源（HyperFrames 的字幕目录、Manim）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/handwriting-write-on/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
