---
id: search-results
name: 搜索框展开出结果
one_liner: 一个短胶囊先展开成整条搜索框，再一个字一个字打进搜索词，词打完后三张结果卡错开一拍从下方升起落位，每张带一个真数字
family: ui
role: [feature]
intent: [search, process]
energy: 3
duration_f: [60, 120]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait]
needs: [ui-element, text, number]
sound: recommended
pitfalls: [too-fast, uniform-timing, copy-drift]
qa: {peak: 45, settle: 80}
status: tuned
pairs_with: [type-and-filter]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 02 Search → results 的结构和时序}
sketch_sha: "c722f8fd3d67"
---

# 搜索框展开出结果 · search-results

## 意图

演示"搜了就有"：帮助中心、内容库、站内搜索。三步依次发生、互不抢：框先打开，再打字，最后结果一张接一张落下来。每张结果带一个真数字，观众知道搜到的是实打实的东西。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 展开 | 6–22 | 带放大镜的短胶囊（灰色占位"搜索"）拉宽到整条，出现光标 |
| 打字 | 24–39 | 搜索词逐字打出，每字 2–3 帧 |
| 结果 | 40–65 | 词打完才出结果：三张卡各从下方 14 px 升起落位，一张比前一张晚 4–5 帧 |
| 停留 | 65–120 | 列表停住，光标每半秒闪一下 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 展开先于打字 | 打字在展开结束后才开始 | 两个动作同时走会打架 | ★ |
| 结果错开 | 4–5 帧一张 | 同时出现像截图；间隔太大像网速慢 | ★ |
| 升起距离 | 14 px | 再大就是"飞进来"，不是"落位" | |
| 每张一个数字 | "邮件 · 打开率 48%" | 灰色占位条读不出内容 | ★ |

## 声音

键盘声跟着打字（每个字一下、音量低），三张结果各一声轻 tick；静音时去掉。

## 风格适配

- 结构参数：先开框再打字、结果错开落位。
- 皮肤参数：框的圆角、卡片的色块和字体。
- 量化风格：打字本来就是台阶，结果按一拍二落位。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const open = lib.ease.inOutCubic(lib.seg(t, 0.2, 0.75)), w = lib.lerp(300, 1300, open), x = (W - w) / 2;
  ctx.fillStyle = lib.mixColor(bg, fg, 0.08); ctx.strokeStyle = lib.mixColor(bg, fg, 0.3); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x, 220, w, 110, 55); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = fg; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x + 70, 268, 18, 0, lib.TAU); ctx.moveTo(x + 83, 281); ctx.lineTo(x + 98, 296); ctx.stroke();
  const q = lib.typewriter("spring", t, { start: 0.8, cps: 12 });
  lib.setFont(ctx, tokens, "display", 52, { weight: 500 });
  if (!q) { ctx.fillStyle = lib.mixColor(bg, fg, 0.4); ctx.fillText("Search", x + 120, 293); }
  else { ctx.fillStyle = fg; ctx.fillText(q, x + 120, 293); }
  if (open >= 1 && lib.step(t, 2) * 2 % 2 === 0) { const cw = ctx.measureText(q).width; ctx.fillStyle = ac; ctx.fillRect(x + 124 + cw, 255, 4, 52); }
  const rows = [["Email", "48% opens"], ["Reel", "12.4k views"], ["Post", "3.1% saves"]];
  rows.forEach(([k, v], i) => {
    const a = lib.ease.outCubic(lib.seg(t, 1.35 + i * 0.15, 1.85 + i * 0.15));
    if (a <= 0) return;
    const y = 380 + i * 170 + (1 - a) * 14;
    ctx.globalAlpha = a;
    ctx.fillStyle = lib.mixColor(bg, fg, 0.06); ctx.beginPath(); ctx.roundRect(x, y, 1300, 140, 24); ctx.fill();
    ctx.fillStyle = [ac, lib.mixColor(ac, fg, 0.4), lib.mixColor(ac, bg, 0.4)][i]; ctx.beginPath(); ctx.roundRect(x + 30, y + 25, 90, 90, 18); ctx.fill();
    lib.setFont(ctx, tokens, "display", 46, { weight: 600 }); ctx.fillStyle = fg; ctx.fillText(`Spring ${k}`, x + 150, y + 62);
    lib.setFont(ctx, tokens, "display", 38, { weight: 400 }); ctx.fillStyle = lib.mixColor(fg, bg, 0.35); ctx.fillText(`${k} · ${v}`, x + 150, y + 110);
    ctx.globalAlpha = 1;
  });
}
```

## 已知坑

- 打字太快（每字 1 帧）读不出是在打字 → 每字 2–3 帧，或按读时算。
- 结果用灰条占位 → 每张一个真数字和一句标题。
- 搜索词和结果对不上（搜"春季"出来"年度报告"）→ 文案自己先对一遍。

## 验收帧

- `peak`（第 45 帧）：词刚打完，第一张结果在落位途中。
- `settle`（第 80 帧）：三张都落定，框里光标在闪。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 02 "Search → results"。文字重写；时序从 8 s 循环改成一次性的入场加停留，按 30 fps 换算；草图是本仓库写的灰盒。和 `interaction/type-and-filter` 的区别：那一张是在真界面上打字让网格收敛成一张卡、再点进去，这一张是空框打开、结果一张张落下。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
