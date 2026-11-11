---
id: terminal-run
name: 终端里敲命令出结果
one_liner: 终端里一条命令按人手的速度敲完、回车，输出一行行出来，最后一行是结论，然后回到提示符；输出照抄真实的一次运行，不编数字
family: ui
role: [feature, proof]
intent: [process, generate]
energy: 2
duration_f: [75, 150]
types: [promo, short, paper]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [text]
sound: optional
pitfalls: [copy-drift, too-fast]
qa: {peak: 81, settle: 120}
status: tuned
pairs_with: [diff-reveal]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/terminal-run/README.md, license: MIT, note: 时序和"不放编出来的成功数字"的禁止项}
sketch_sha: "f1cc40af63d7"
---

# 终端里敲命令出结果 · terminal-run

## 意图

把"一条命令换来一个结果"讲清楚：安装、构建、一次自动检查。命令敲出来，回车，输出一行行地来，最后一行是要观众记住的结论。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 敲 | 12–63 | 命令按每秒 16 个字敲出来，光标块跟着 |
| 回车 | 63–70 | 停一拍 |
| 输出 | 70–100 | 输出一行行出来，每行晚 7–8 帧；最后一行是结论，强调色 |
| 回到提示符 | 110– | 新的提示符和闪烁的光标 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 敲字速度 | 12–18 字/秒，略有停顿更像人 | 一下全出来，就不是"敲" | |
| 回车后的停顿 | 0.2–0.3 s | 不停，像预录的 | |
| 输出 | 照抄真实运行的输出，长的就剪掉中间 | 编一个"✓ 1,204 tests passed"，是造假 | ★ |
| 结论行 | 最后一行，强调色 | | |

## 声音

可以不配；配的话很轻的键盘声跟着敲字，回车一声稍重。

## 风格适配

- 结构参数：敲、停、逐行输出、结论行、回到提示符。
- 皮肤参数：终端的配色、字体、窗口样式。
- 量化风格：本来就是一格格的，不用改。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const TX = 260, TY = 140, TW = 1400, TH = 800, ink = "#e8e6e1", dim = "#8a8781";
  ctx.fillStyle = lib.mixColor(fg, "#000000", 0.35); ctx.beginPath(); ctx.roundRect(TX, TY, TW, TH, 22); ctx.fill();
  for (let i = 0; i < 3; i++) { ctx.fillStyle = dim; ctx.beginPath(); ctx.arc(TX + 40 + i * 32, TY + 36, 9, 0, lib.TAU); ctx.fill(); }
  const cmd = "bin/vh check out/film.mp4", start = 0.4, cps = 16, typed = lib.typewriter(cmd, t, { start, cps }), enter = start + cmd.length / cps + 0.25;
  lib.setFont(ctx, tokens, "mono", 40); const cw = ctx.measureText("M").width, Y = TY + 140, L = 62;
  ctx.fillStyle = ac; ctx.fillText("$", TX + 50, Y); ctx.fillStyle = ink; ctx.fillText(typed, TX + 50 + 2 * cw, Y);
  const blink = lib.step(t, 4) * 4 % 2 === 0;
  if (t < enter && (blink || typed.length < cmd.length)) { ctx.fillStyle = ink; ctx.fillRect(TX + 50 + (2 + typed.length) * cw, Y - 34, cw, 44); }
  // a placeholder in the shape of bin/vh check's lines: paste the real run's output here
  const out = [["✓", "spec, length and audio streams", dim], ["✓", "no black or frozen stretch", dim], ["✓", "no digital silence", dim], ["!", "a still stretch at 0:31", ink], ["→", "ways out: bin/vh recipes list --role breath", ac]];
  out.forEach(([m, s, col], i) => {
    const a = lib.seg(t, enter + 0.3 + i * 0.25, enter + 0.36 + i * 0.25); if (a <= 0) return;
    ctx.globalAlpha = a; ctx.fillStyle = m === "!" ? ac : col; ctx.fillText(m, TX + 50, Y + (i + 1) * L); ctx.fillStyle = col; ctx.fillText(s, TX + 50 + 2 * cw, Y + (i + 1) * L); ctx.globalAlpha = 1;
  });
  const back = enter + 0.3 + out.length * 0.25 + 0.3;
  if (t >= back) { const y2 = Y + (out.length + 1.4) * L; ctx.fillStyle = ac; ctx.fillText("$", TX + 50, y2); if (blink) { ctx.fillStyle = ink; ctx.fillRect(TX + 50 + 2 * cw, y2 - 34, cw, 44); } }
}
```

## 已知坑

- 输出是编的，尤其是数字 → 照抄一次真实运行；太长就剪中间、标出省略。
- 敲字匀速、没有停顿 → 可以在空格后停 1–2 帧。
- 字太小，手机上读不出 → 终端字号按"在哪看"的下限来，行数少一点。

## 验收帧

- `peak`（第 81 帧）：命令敲完，输出出了两三行。
- `settle`（第 120 帧）：输出全出来，结论行是强调色，新提示符在闪。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 terminal-run。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；草图是本仓库写的，输出是照 `bin/vh check` 的样子写的占位，用时换成真实运行的输出。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/terminal-run/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
