---
id: tab-stretch
name: 选中块拉伸着换标签
one_liner: 选中的深色胶囊滑向下一个标签时前沿先走、后沿晚一拍，于是先拉长再缩回；标签字色跟着胶囊盖住的比例渐变，下面的面板逐行侧滑换成新内容
family: ui
role: [feature]
intent: [compare, interact]
energy: 3
duration_f: [45, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element, text, number]
sound: optional
pitfalls: [mechanical-stop, uniform-timing]
qa: {peak: 20, settle: 60}
status: tuned
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 04 Tabs → panels 的结构和时序}
sketch_sha: "b6f9b7473f51"
---

# 选中块拉伸着换标签 · tab-stretch

## 意图

对比几个方案、套餐或渠道，又不想摆一墙字：一组标签，选中块从一个滑到下一个，下面的面板跟着换。好看的地方在"拉伸"：前沿先走、后沿跟上，胶囊像有弹性的东西被拖过去。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–12 | 三个标签，第一个被深色胶囊选中；面板显示它的标题、计数签和三行排名 |
| 拉伸 | 12–30 | 胶囊前沿先走，后沿晚 3–4 帧跟上，所以先拉长、落位时缩回；身后拖两道短速度线；每个标签的字色按胶囊盖住它的比例渐变 |
| 换面板 | 27–45 | 面板标题和三行依次侧滑 15 px 淡出，新内容从另一侧滑入，从上往下每行晚 2 帧 |
| 停留 | 45–150 | 新面板停住；样片在 3 s 处再换一次，同样的拉伸 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 后沿延迟 | 3–4 帧 | 0 帧就是一块等宽的块在平移，显得机械；太长像橡皮筋断了 | ★ |
| 字色 | 按覆盖比例连续渐变 | 一下翻色会闪 | ★ |
| 面板侧滑 | 14–16 px，从上往下错开 2 帧 | 整块一起换像刷新页面 | |
| 速度线 | 两道，只在移动时出现，长度跟速度走 | 可省 | |

## 声音

胶囊落位时一个短 click；静音也成立。

## 风格适配

- 结构参数：前沿先走后沿跟上、字色按覆盖比例、面板逐行侧滑。
- 皮肤参数：胶囊和面板的圆角、颜色、字体。
- 量化风格：胶囊按一拍二走，字色仍按覆盖比例算。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const line = lib.mixColor(bg, fg, 0.2), muted = lib.mixColor(fg, bg, 0.45);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const TW = 300, X0 = (W - TW * 3) / 2, Y = 150, TH = 96, moves = [{ t: 0.4, to: 1 }, { t: 3.0, to: 2 }];
  const pill = (tt) => {   // leading edge first, trailing edge a beat behind: it stretches, then shortens as it lands
    let l = X0, r = X0 + TW;
    for (const m of moves) { r += TW * lib.ease.inOutCubic(lib.seg(tt, m.t, m.t + 0.45)); l += TW * lib.ease.inOutCubic(lib.seg(tt, m.t + 0.12, m.t + 0.6)); }
    return [l, r];
  };
  const [l, r] = pill(t), v = Math.abs(pill(t)[0] - pill(t - 1 / 30)[0]);
  ctx.fillStyle = lib.mixColor(bg, fg, 0.05); ctx.beginPath(); ctx.roundRect(X0 - 8, Y - 8, TW * 3 + 16, TH + 16, (TH + 16) / 2); ctx.fill();
  if (v > 1) { ctx.strokeStyle = lib.rgba(fg, Math.min(0.5, v / 40)); ctx.lineWidth = 4; for (const k of [0.36, 0.64]) { ctx.beginPath(); ctx.moveTo(l - 24 - v * 2.5, Y + TH * k); ctx.lineTo(l - 24, Y + TH * k); ctx.stroke(); } }
  ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(l + 6, Y + 6, r - l - 12, TH - 12, (TH - 12) / 2); ctx.fill();
  ["Reels", "Posts", "Email"].forEach((s, i) => {
    const a = X0 + i * TW, cover = lib.clamp((Math.min(r, a + TW) - Math.max(l, a)) / TW);
    lib.setFont(ctx, tokens, "display", 40, { weight: 600 }); ctx.fillStyle = lib.mixColor(muted, bg, cover);
    ctx.textAlign = "center"; ctx.fillText(s, a + TW / 2, Y + TH / 2 + 14); ctx.textAlign = "left";
  });
  const data = [
    { h: "Reels this week", n: "12 live", rows: [["Hook test #4", "4.2k"], ["Studio tour", "3.1k"], ["Q&A, part 2", "2.7k"]] },
    { h: "Posts this week", n: "8 live", rows: [["Five tips, carousel", "1.9k"], ["Team photo", "1.4k"], ["Friday poll", "960"]] },
    { h: "Email this week", n: "3 sent", rows: [["Spring launch", "48%"], ["Weekly digest", "41%"], ["Webinar invite", "37%"]] },
  ];
  const lineAt = (k) => {   // which panel a line shows, and where it is in its slide
    let idx = 0, x = 0, a = 1;
    for (const m of moves) {
      const o = lib.seg(t, m.t + 0.5 + k * 0.07, m.t + 0.72 + k * 0.07);
      if (o <= 0) break;
      if (o < 1) { x = -15 * lib.ease.inCubic(o); a = 1 - o; break; }
      const i = lib.ease.outCubic(lib.seg(t, m.t + 0.72 + k * 0.07, m.t + 1.0 + k * 0.07));
      idx = m.to; x = 15 * (1 - i); a = i;
    }
    return { d: data[idx], x, a };
  };
  const PX = X0 - 8, PW = TW * 3 + 16;
  ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(PX, 300, PW, 640, 24); ctx.stroke();
  { const { d, x, a } = lineAt(0); ctx.globalAlpha = a;
    lib.setFont(ctx, tokens, "display", 52, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText(d.h, PX + 48 + x, 400);
    lib.setFont(ctx, tokens, "display", 30, { weight: 600 }); ctx.fillStyle = ac; ctx.textAlign = "right"; ctx.fillText(d.n, PX + PW - 48 + x, 396); ctx.textAlign = "left"; }
  for (let k = 1; k <= 3; k++) {
    const { d, x, a } = lineAt(k), y = 430 + (k - 1) * 160; ctx.globalAlpha = 1;
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(PX + 48, y); ctx.lineTo(PX + PW - 48, y); ctx.stroke();
    ctx.globalAlpha = a; const [name, val] = d.rows[k - 1];
    lib.setFont(ctx, tokens, "mono", 34); ctx.fillStyle = muted; ctx.fillText(`0${k}`, PX + 48 + x, y + 95);
    lib.setFont(ctx, tokens, "display", 44, { weight: 500 }); ctx.fillStyle = fg; ctx.fillText(name, PX + 140 + x, y + 95);
    lib.setFont(ctx, tokens, "display", 44, { weight: 700 }); ctx.textAlign = "right"; ctx.fillText(val, PX + PW - 48 + x, y + 95); ctx.textAlign = "left";
  }
  ctx.globalAlpha = 1;
}
```

## 已知坑

- 胶囊等宽平移、匀速到站 → 后沿晚 3–4 帧，入出都缓。
- 字色在胶囊过半时一下翻转 → 按覆盖比例连续渐变。
- 面板整块淡入淡出 → 逐行侧滑，从上往下错开。

## 验收帧

- `peak`（第 20 帧）：胶囊拉得最长，横跨两个标签，两个标签的字都是半色。
- `settle`（第 60 帧）：胶囊落在第二个标签上，新面板三行齐了。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 04 "Tabs → panels"。文字重写；时序从 8 s 循环改成一次切换加停留（样片在停留里再切一次），按 30 fps 换算；草图是本仓库写的灰盒，演示数字是编的样例，用时换成真的。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
