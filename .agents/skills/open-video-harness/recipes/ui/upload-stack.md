---
id: upload-stack
name: 文件卡叠起来上传
one_liner: 几张文件卡一张张抬起叠成一列，每张带自己的进度条，按各自的大小用不同的时间走到 100%；全部完成，标题才换成"已上传"
family: ui
role: [feature, proof]
intent: [process, abundance]
energy: 2
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element, text]
sound: optional
pitfalls: [fake-ui, copy-drift]
qa: {peak: 48, settle: 108}
status: tuned
pairs_with: [toast-stack]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/file-upload-stack/README.md, license: MIT, note: 时序和禁止项（完成前进度条不能到 100%；完成后停住）}
sketch_sha: "61c99ea1f3e9"
---

# 文件卡叠起来上传 · upload-stack

## 意图

讲"选好的文件正在上传、各自到哪了"：每张卡一个进度条，大文件慢、小文件快，观众信这是真的在传。全部到了，标题才说"好了"。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 抬起 | 9、15、21 起 | 三张文件卡依次从下方 40 px 抬起、落进列表（12 帧，outCubic） |
| 传 | 15–96 | 每张的进度条按自己的速度走：小文件约 1 s，大文件约 2.5 s；百分比跟着进度条 |
| 各自完成 | 各自到 100% 时 | 那一张的进度条换成"Done"和勾 |
| 全部完成 | 96–105 | 标题从"Uploading 3 files"换成"3 files uploaded" |
| 停留 | 105– | |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 各自的速度 | 按文件大小，最大的最后完成 | 三条一起走一起满，像假的 | ★ |
| 100% | 只在那一张真的完成时出现 | 进度条先满了还在"上传中" | ★ |
| 总标题 | 全部完成后才换 | | |
| 抬起 | 每张晚 6 帧 | | |

## 声音

可以不配；每张完成一声很轻的"叮"。

## 风格适配

- 结构参数：一张一条进度、按大小分速度、全部完成才换标题。
- 皮肤参数：卡片、文件图标、进度条样式。
- 量化风格：进度按一拍二跳。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const files = [{ n: "brief.pdf", s: "2.4 MB", at: 0.3, end: 1.5 }, { n: "cut-v3.mov", s: "380 MB", at: 0.5, end: 3.2 }, { n: "voice.wav", s: "41 MB", at: 0.7, end: 2.4 }];
  const X = 560, Wd = 800, CH = 150, G = 24, Y0 = 300, all = lib.seg(t, 3.2, 3.5);
  lib.setFont(ctx, tokens, "display", 52, { weight: 700 }); ctx.fillStyle = fg;
  ctx.globalAlpha = 1 - all; ctx.fillText("Uploading 3 files", X, 230); ctx.globalAlpha = all; ctx.fillText("3 files uploaded", X, 230); ctx.globalAlpha = 1;
  files.forEach((f, i) => {
    const e = lib.ease.outCubic(lib.seg(t, f.at, f.at + 0.4)); if (e <= 0) return;
    const y = Y0 + i * (CH + G) + 40 * (1 - e), p = lib.seg(t, f.at + 0.2, f.end);   // each at its own pace: the big file finishes last
    ctx.globalAlpha = e; ctx.fillStyle = lib.mixColor(bg, fg, 0.06); ctx.beginPath(); ctx.roundRect(X, y, Wd, CH, 20); ctx.fill();
    ctx.fillStyle = lib.mixColor(ac, bg, 0.3 + 0.2 * i); ctx.beginPath(); ctx.roundRect(X + 28, y + 30, 70, 90, 10); ctx.fill();
    lib.setFont(ctx, tokens, "display", 40, { weight: 600 }); ctx.fillStyle = fg; ctx.fillText(f.n, X + 126, y + 66);
    lib.setFont(ctx, tokens, "display", 30, { weight: 400 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.45); ctx.fillText(f.s, X + 126, y + 108);
    const bx = X + 360, bw = 300;
    if (p < 1) {
      ctx.fillStyle = lib.mixColor(bg, fg, 0.15); ctx.fillRect(bx, y + 92, bw, 10); ctx.fillStyle = ac; ctx.fillRect(bx, y + 92, bw * p, 10);
      lib.setFont(ctx, tokens, "mono", 32); ctx.fillStyle = fg; ctx.textAlign = "right"; ctx.fillText(`${Math.floor(p * 100)}%`, X + Wd - 32, y + 108); ctx.textAlign = "left";
    } else {
      lib.setFont(ctx, tokens, "display", 34, { weight: 600 }); ctx.fillStyle = ac; ctx.textAlign = "right"; ctx.fillText("Done", X + Wd - 80, y + 108); ctx.textAlign = "left";
      ctx.strokeStyle = ac; ctx.lineWidth = 6; ctx.lineCap = "round"; lib.strokePartial(ctx, [[X + Wd - 62, y + 96], [X + Wd - 50, y + 108], [X + Wd - 28, y + 84]], lib.seg(t, f.end, f.end + 0.2));
    }
    ctx.globalAlpha = 1;
  });
}
```

## 已知坑

- 三条进度一样快、一起满 → 按文件大小分速度。
- 进度条到 100% 了还写着"上传中" → 100% 只在完成那一刻出现，紧接着换成"Done"。
- 文件名和大小是编的 → 用真实的，或者明确是示意。

## 验收帧

- `peak`（第 48 帧）：小文件已经完成，另外两张在走，大文件的进度最短。
- `settle`（第 108 帧）：三张都是"Done"，标题是"3 files uploaded"。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 file-upload-stack。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；"按文件大小分速度"和草图是本仓库写的，文件名是占位。卡片注明的概念来源（react-bits）只是手法出处，没有代码进来。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/file-upload-stack/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
