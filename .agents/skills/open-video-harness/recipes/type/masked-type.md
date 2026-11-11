---
id: masked-type
name: 画面从字里涨上来
one_liner: 一个大的描边字，画面从字形的底部往上涨满，一条带小方块把手的强调色线标着涨到哪；第二行字从一条看不见的切线后面升出来，不是淡入
family: type
role: [hook, open]
intent: [enter, promise, brand-imprint]
energy: 3
duration_f: [60, 150]
types: [promo, short, mv]
engines: [canvas, hyperframes]
aspect: [landscape, square, portrait]
needs: [text, photo]
sound: optional
pitfalls: [text-blur, sub-threshold]
qa: {peak: 27, settle: 66}
status: tuned
pairs_with: [brand-imprint-open]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 09 Masked type 的结构和时序}
sketch_sha: "a015629fc7b0"
---

# 画面从字里涨上来 · masked-type

## 意图

亮出一个活动名、一期刊号或者一句发布标题：字先是空心的轮廓，画面像水一样从字底涨上来，只在字形里面看得到。标记线告诉观众"正在发生什么"，第二行字被一道切口遮着升上来，整张卡像印刷品而不是幻灯片。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–6 | 大字只有细描边；左上角刊号、右上角季节；下面一行是空的 |
| 涨满 | 6–47 | 画面在字形里从底往上涨（入出都缓），一条强调色的线带着左端的小方块把手标着水位 |
| 第二行 | 28–48 | 第二行字从一条看不见的切线后面升上来 |
| 收尾 | 47–54 | 涨满以后标记线淡掉 |
| 停留 | 54–150 | 字里的画面慢慢漂移，字和第二行停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 画面只在字形里 | 字是遮罩，画面在遮罩里 | 画面溢出字形，就成了一张图上压了字 | ★ |
| 第二行 | 遮罩里升起，不淡入 | 淡入的第二行软，像 PPT | ★ |
| 涨满时长 | 40–45 帧 | 太快看不出是"涨"；太慢标记线就成了主角 | |
| 标记线 | 涨满后 6–8 帧淡掉 | 一直留着像没做完 | |

## 声音

可以不配；配的话涨满那一刻一声低音的"嗡"或一下鼓。

## 风格适配

- 结构参数：字形遮罩、从底往上涨、标记线、切口里升起的第二行。
- 皮肤参数：字体（越粗越好，笔画要装得下画面）、字里的画面、强调色。
- 量化风格：水位按一拍二上涨，标记线跟着跳。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const word = "OPUS", BY = 640, size = 440;
  lib.setFont(ctx, tokens, "mono", 30); ctx.fillStyle = fg; ctx.fillText("ISSUE 05", 160, 150);
  ctx.textAlign = "right"; ctx.fillText("SPRING 26", W - 160, 150); ctx.textAlign = "left";
  const m = lib.layer("masked-type");   // the artwork, kept inside the letterforms
  lib.setFont(m, tokens, "display", size, { weight: 800 }); m.textAlign = "center"; m.fillStyle = "#000"; m.fillText(word, W / 2, BY);
  m.globalCompositeOperation = "source-in";
  const g = m.createLinearGradient(0, BY - 330, 0, BY); g.addColorStop(0, lib.mixColor(ac, fg, 0.35)); g.addColorStop(1, ac); m.fillStyle = g; m.fillRect(0, 0, W, H);
  m.globalCompositeOperation = "source-atop";   // source-in would clear everything outside each new shape
  for (let i = 0; i < 9; i++) {   // soft shapes drifting slowly, so the hold keeps living
    const x = W / 2 - 700 + 1400 * lib.hash(i, 1) + 60 * Math.sin(t * 0.6 + i), y = BY - 330 * lib.hash(i, 2) + 30 * Math.cos(t * 0.5 + i * 2);
    m.fillStyle = lib.rgba(i % 2 ? bg : fg, 0.25); m.beginPath(); m.arc(x, y, 60 + 120 * lib.hash(i, 3), 0, lib.TAU); m.fill();
  }
  const top = BY - size * 0.74, fy = lib.lerp(BY + 4, top - 6, lib.ease.inOutCubic(lib.seg(t, 0.2, 1.55)));
  ctx.save(); ctx.beginPath(); ctx.rect(0, fy, W, H - fy); ctx.clip(); ctx.drawImage(m.canvas, 0, 0); ctx.restore();
  lib.setFont(ctx, tokens, "display", size, { weight: 800 }); ctx.textAlign = "center"; ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.strokeText(word, W / 2, BY);
  const ww = ctx.measureText(word).width; ctx.textAlign = "left";
  const mk = 1 - lib.seg(t, 1.55, 1.8);
  if (t > 0.2 && mk > 0) {   // the marker shows what the motion is doing
    ctx.globalAlpha = mk; ctx.strokeStyle = ac; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(W / 2 - ww / 2 - 40, fy); ctx.lineTo(W / 2 + ww / 2 + 40, fy); ctx.stroke();
    ctx.fillStyle = ac; ctx.fillRect(W / 2 - ww / 2 - 58, fy - 9, 18, 18); ctx.globalAlpha = 1;
  }
  const r = lib.ease.outCubic(lib.seg(t, 0.95, 1.6)), CUT = BY + 150;   // the second line rises behind a clean cut
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, CUT); ctx.clip();
  lib.setFont(ctx, tokens, "display", 96, { weight: 500 }); ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.fillText("in motion", W / 2, CUT - 24 + 110 * (1 - r));
  ctx.restore(); ctx.textAlign = "left";
}
```

在 HyperFrames 里用 DOM 做：字用 `background-clip: text` 装画面，水位是一层 `clip-path: inset(...)`，第二行是 `overflow: hidden` 的容器里一个往上走的 span；都由 t 算出来，不用 CSS 动画。

## 已知坑

- 字太细，画面在笔画里看不出来 → 用最粗的字重，字号占画面宽度一半以上。
- 第二行淡入 → 用遮罩升起。
- 字里的画面太花，字读不出来 → 画面压暗或者降饱和，描边留着。
- canvas 里往遮罩上叠第二层画面用 `source-atop`：`source-in` 每画一笔都会清掉笔外的一切，字就空了。

## 验收帧

- `peak`（第 27 帧）：水位涨到字的一半左右，标记线和把手看得清，第二行还没出来。
- `settle`（第 66 帧）：字涨满了，标记线已散，第二行停在下面。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 09 "Masked type"。文字重写；时序从 8 s 循环改成一次涨满加停留，按 30 fps 换算；停留段画面漂移和 HyperFrames 的 DOM 写法是本仓库加的；草图里字中的画面是程序画的占位，用时换成真照片或活动的主视觉。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
