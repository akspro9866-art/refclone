---
id: brand-imprint-open
name: 字标压印开场
one_liner: 一个小记号先画出来，字标逐字压印，副标打出，整组停到读完再上浮离场，交给产品画面
family: type
role: [open]
intent: [brand-imprint]
energy: [1, 2]
duration_f: [89, 149]
types: [promo, short, data, paper]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [logo]
sound: recommended
pitfalls: [no-hold, too-fast]
qa: {read: 46, settle: 60, last: 95}
status: upstream-tested
pairs_with: [spotlight-hero]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/opening/brand-ink-open.md, license: Apache-2.0, note: 开场结构和品牌 hold 的判例}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/typography/brand-ink-open/BrandInkOpen.tsx, license: Apache-2.0, note: 帧数、缓动、glint、退场}
sketch_sha: "8b0c40a318ff"
---

# 字标压印开场 · brand-imprint-open

## 意图

第一拍先让观众记住名字：任何产品画面出现之前，字标安安静静地落定，停到读完。它是能量曲线的起点，要低，给后面的爬升留空间。

## 阶段与时值

第 0 帧 = 片子第一帧。下表按 9 个字符的字标算（"Frame Lab"）；停留随字标和副标的长短变。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 记号描出 | 0–18 | 一个小记号（准星、一笔下划线、logo 的一笔）描出来：竖笔 0–9、横笔 8–18 |
| 字标压印 | 10–46 | 第 i 个字在 10 + 3i 帧开始，12 帧压到位：缩放 1.6 → 1（以字的底边为轴），`bezier(0.2,0.7,0.25,1)`；每个字到位时字底闪一道 8 帧的强调色短划 |
| 记号淡出 | 24–34 | 记号画完就退，不和字标抢 |
| 副标打字 | 28 起 | 等宽小字逐字出现，块状光标跟着；打完光标闪，停留期结束前停闪 |
| 停留 | 46–91 | 从字标完整算起，按读时规则停：Pace 为 normal 时是 45 帧（副标 11 个字符最慢，算出 1.4 s，不到底线的 1.5 s，取 1.5 s） |
| 退场 | 91–98 | 7 帧：整组上浮 40 px、缩小 12%、淡出，交给下一镜 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 停留 | 从字标完整算起，取 max(1 s, 字标和副标各自的读时要求) | shotcraft 判例 R1：用户两轮点名"出现后延长停留 1 秒"；本仓库再按读时规则（TASTE_CHECKLIST #5，BRIEF 的 Pace）取大，副标长时比 1 s 长 | ★ |
| 停的对象 | 停的是字标落定的那一刻，不是随便一张内容卡 | 判例 R1：曾把 hold 加错给普通字卡，很快回滚 | ★ |
| 压印 | 起始缩放 1.6，12 帧，字间隔 3 帧；以字的底边为轴 | 从底边压下去才像印上纸；以中心缩放像弹出来 | |
| 入场三件套 | 透明度 + 缩放 + 虚焦 → 清晰 | 缺了虚焦会显得硬（原卡）；DOM 里不动画 blur，虚焦放在 canvas 层做，或用预模糊副本交叉淡入 | |
| 副标 | 等宽，1080p 下不小于 44 px；装饰性的打字可以快到 0.7 帧/字 | 原卡的副标是 26 px 的装饰小字；本仓库里要读的字不小于 44 px（TASTE_CHECKLIST #6）。模拟真实操作的打字要慢到 3 帧/字（shotcraft 的 type-and-filter 判例） | |
| 退场 | 7 帧，比入场快 | 观众已经读完了，拖长退场反而泄气 | |
| 能量 | 全片最低的一段 | 开场炫技会压死后面的爬升（原卡已知坑） | ★ |

## 声音

第一个字落定时一声柔和的过渡音（模板片钉在第 12 帧），退场时一声快 whoosh，把观众带进产品画面（模板片第 78 帧）。音色走电影系（whoosh、impact、sparkle），不用游戏界面的提示音（shotcraft 判例 S1）。

## 风格适配

- 结构参数：记号先于字标且先退、逐字压印、停到读完、快速退场。
- 皮肤参数：记号的形状、字标的字体和颜色、glint 的颜色、副标的字体。
- 字标是图形 logo（不是字）时，把"逐字压印"换成 logo 的部件逐个压印，时值照旧。
- 一拍二：压印取 2 帧一个台阶，停留不变。

## 实现

```js
// brand-imprint-open：记号描出 → 字标逐字压印（字底 glint）→ 副标打字 → 停到读完 → 7 帧上浮离场。
const MARK = "Frame Lab", KICKER = "VIDEO AS CODE";
const DONE = 10 + 3 * (MARK.length - 1) + 12;                          // 字标完整：第 46 帧
const CPS = 18, PAD = 0.8, FLOOR = 1.5;                                // BRIEF 的 Pace = normal：其他字符 18 个/秒，另加 0.8 s，不低于底线 1.5 s（playbook/03 §2）
const OUT = DONE + Math.round(Math.max(FLOOR, MARK.replace(/ /g, "").length / CPS + PAD, KICKER.replace(/ /g, "").length / CPS + PAD) * 30);
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  const o = lib.bezier(0.4, 0, 0.5, 1)(lib.seg(f, OUT, OUT + 7));
  ctx.save(); ctx.globalAlpha = 1 - o;                                // 退场：上浮 40 px、缩小 12%
  ctx.translate(960, 540 - 40 * o); ctx.scale(1 - 0.12 * o, 1 - 0.12 * o); ctx.translate(-960, -540);
  ctx.save(); ctx.globalAlpha *= 1 - lib.seg(f, 24, 34); ctx.strokeStyle = ac; ctx.lineWidth = 5; ctx.lineCap = "round";
  lib.strokePartial(ctx, [[960, 330], [960, 390]], lib.bezier(0.3, 0, 0.2, 1)(lib.seg(f, 0, 9)));
  lib.strokePartial(ctx, [[930, 360], [990, 360]], lib.seg(f, 8, 18)); ctx.restore();
  lib.setFont(ctx, tokens, "display", 132, { weight: 600 }); ctx.fillStyle = fg;
  const lay = lib.layoutText(ctx, MARK, { x: 960, y: 560, align: "center" });
  lib.drawGlyphs(ctx, lay, (g, i) => {
    const u = lib.bezier(0.2, 0.7, 0.25, 1)(lib.seg(f, 10 + 3 * i, 22 + 3 * i));
    return { alpha: u, scale: 1.6 - 0.6 * u };                        // drawGlyphs 以字的基线中点为轴缩放
  });
  lay.glyphs.forEach((g, i) => {                                       // 字底 glint：到位那一帧最亮，前后各 4 帧
    const c = 22 + 3 * i, gl = Math.max(0, 1 - Math.abs(f - c) / 4);
    if (gl > 0 && g.ch !== " ") { ctx.fillStyle = lib.rgba(ac, gl); ctx.fillRect(g.cx - g.w * gl / 2, 572, g.w * gl, 3); }
  });
  lib.setFont(ctx, tokens, "mono", 44); ctx.fillStyle = lib.rgba(fg, 0.7);   // 要读的副标：不小于 44 px
  const typed = lib.typewriter(KICKER, t, { start: 28 / 30, cps: 30 / 0.7 });
  const kl = lib.layoutText(ctx, KICKER, { x: 960, y: 650, align: "center", tracking: 4 });
  lib.drawText(ctx, typed, kl.x0, 650, { tracking: 4 });
  const doneK = 28 + Math.ceil(KICKER.length * 0.7), blink = f < doneK || (f < OUT - 10 && Math.floor((f - doneK) / 2) % 2 === 0);
  if (f >= 28 && blink) { ctx.fillStyle = lib.rgba(ac, 0.85); ctx.fillRect(kl.x0 + ctx.measureText(typed).width + typed.length * 4 + 8, 614, 22, 40); }
  ctx.restore();
}
```

`lib.drawGlyphs` 把每个字平移到它基线的中点再缩放，所以缩放天然以字底为轴。DOM 里对应的写法是每个字一个 `inline-block`，`transform-origin: center bottom`。

## 已知坑

- **停得不够**：短于 1 秒必返工（判例 R1），在本仓库还要过读时规则。停的是字标，不是开场里别的东西。
- **开场炫技**：光效、粒子、大动作放在开场，后面就没法爬升了。开场是全片最安静的一段。
- **副标抢戏**：副标打得比字标还慢、还大，观众的视线会被拉走。副标小、快、等宽，字标是主角。
- **记号不退**：准星或记号画完留在画面上，会和字标抢焦点。画完就淡出。

## 验收帧

- `read`（第 46 帧）：字标完整，所有字都已落位；glint 只剩最后一个字的尾巴。
- `settle`（第 60 帧）：停留中，只有光标在闪，其他全部静止。
- `last`（第 95 帧）：退场中段，整组在上浮、缩小、变淡，方向和下一镜的运动一致。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的开场卡 `brand-ink-open` 和 demo `BrandInkOpen.tsx`。文字重写；记号、压印、glint、打字和退场的帧数与缓动取原值；停留改成"1 秒判例和本仓库读时规则取大"，"字标是图形 logo 时"的做法是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/opening/brand-ink-open.md`、`demos/typography/brand-ink-open/BrandInkOpen.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
