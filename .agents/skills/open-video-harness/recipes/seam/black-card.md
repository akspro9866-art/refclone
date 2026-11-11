---
id: black-card
name: 黑场字卡
one_liner: 前镜淡进暗场，一句短话逐词压印上屏，停到读完，再淡入后镜：换章节和喘口气一起做
family: seam
role: [seam, breath]
intent: [chapter, breath]
energy: [1, 2]
duration_f: [96, 161]
jump: [drop, level]
types: [promo, short, paper, data, math]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: recommended
pitfalls: [no-hold, dead-frame, copy-drift, overuse]
qa: {read: 45, settle: 60, last: 96}
status: tuned
max_per_film: 2
pairs_with: [focus-handoff, breath-title-card]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/transition/shot-transitions.md, license: Apache-2.0, note: 六式中的 D 式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/transition/shot-transitions/BlackCardTransition.tsx, license: Apache-2.0, note: 帧数、压印参数、暗底字色}
sketch_sha: "19421ad96e2c"
---

# 黑场字卡 · black-card

## 意图

片子要换一个章节，同时让观众喘一口气。画面先暗下去，一句很短的话一个词一个词压到屏幕上，停到读完，再把下一章交出来。它是章节路标：告诉观众"接下来看什么"。

## 阶段与时值

第 0 帧 = 前镜开始变暗。下表按 4 个词、13 个字符的短句算；停留时长随文案变，见参数表。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 前镜淡出 | 0–8（6–10） | 淡到暗场，`bezier(0.5,0,0.4,1)` |
| 暗场 | 8–20 | 静，只有底垫的声音在继续 |
| 压印 | 18–38 | 字卡淡入（18–26）；第 i 个词在 20 + 3i 帧开始，9 帧压到位；强调色短线 32–44 帧长出 |
| 停留 | 38–84 | 整句静止，时长按读时规则算：这句 13 个字符，Pace 为 normal 时是 46 帧 |
| 退场 | 84–92 | 整张字卡 8 帧淡出 |
| 后镜淡入 | 92–100（6–10） | 字卡完全退掉以后再进后镜 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 停留 | 从最后一个词落定算起，底线是够快读一遍（max(1.5 s, 汉字数 ÷ 7 + 其他字符数 ÷ 20 + 0.8 s)），舒服的时长按 BRIEF 的 Pace（normal：汉字数 ÷ 6 + 其他字符数 ÷ 18 + 0.8 s，不低于底线）；旁白念这句时跟旁白走；当喘息用时可以停得比读时长，落在小节线上 | 这是本仓库的读时规则（TASTE_CHECKLIST #5，`bin/vh readcheck` 可算）。shotcraft 原 demo 只停 15 帧，连快读一遍都不够 | ★ |
| 文案长度 | ≤ 5 个英文词或 ≤ 10 个汉字 | 越长停得越久，字卡就成了一页 PPT；7 个英文词按 normal 要停约 2.5 s，按 relaxed 要 3 s 多 | ★ |
| 逐词压印 | 第 i 个词 delay = 20 + 3i 帧，9 帧；缩放 1.3 → 1、透明度 0 → 1、模糊 7 px → 0；`bezier(0.2,0.75,0.3,1)` | 和 `breath-title-card` 同一套压印，只是更快（3 帧一个词）、底换成暗场 | |
| 字色 | 用风格里较亮的那个颜色（亮底风格就是底色） | 暗底配强调色正文、或者配纯白等宽字，像系统报错弹窗 | ★ |
| 强调 | 一句只有一个强调词：强调色 + 加粗一档，不用斜体 | 两个强调词等于没有；斜体见 playbook/03 §4 | |
| 前后淡化 | 各 6–10 帧 | 再长就成了拖沓的溶解 | |
| 次数 | 一支 30 s 的片子最多 2 次 | 多了节奏碎，每一章都在停 | ★ |

## 声音

暗场期间配乐不能停成数字静音（CLAUDE.md 底线）：鼓撤掉，底垫留着。字卡进场可以配一声轻 swoosh（和 `breath-title-card` 同一个声音，同类元素同一个音），钉在字卡淡入的第 18 帧。

## 风格适配

- 结构参数：暗 → 字 → 停到读完 → 暗 → 后镜，每段的先后；一个强调词。
- 皮肤参数：暗场颜色（由风格压暗得到）、字体、强调色、短线的形状。
- 衬线、等宽都可以，但字要有分量：展示字号 ≥ 84 px（1080p）。
- 一拍二风格：压印取整到 2 帧一个台阶，停留时长不变。

## 实现

```js
// black-card：A 在 10–18 帧暗下去，短句逐词压印，停到读完（按 BRIEF 的 Pace），字卡退场后淡入 B。
// HOLD：13 个字符，normal 是 13 / 18 + 0.8 s ≈ 46 帧（底线 max(1.5 s, 13 / 20 + 0.8 s) = 45 帧，playbook/03 §2）。
const T0 = 10, WORDS = ["One", "place", "to", "go."], ACCENT = 1, HOLD = 46;
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg");
  const bgLight = lib.luminance(bg) > lib.luminance(fg);
  const ink = bgLight ? bg : fg, dark = lib.mixColor(bgLight ? fg : bg, "#000000", 0.6);
  const done = 20 + 3 * (WORDS.length - 1) + 9, out = done + HOLD;     // 最后一个词落定 → 停够 → 退场
  ctx.fillStyle = dark; ctx.fillRect(0, 0, 1920, 1080);
  const aOut = lib.bezier(0.5, 0, 0.4, 1)(lib.seg(k, 0, 8));
  if (aOut < 1) { ctx.save(); ctx.globalAlpha = 1 - aOut; page(ctx, tokens, lib, 5); ctx.restore(); }
  const card = Math.min(lib.seg(k, 18, 26), 1 - lib.seg(k, out, out + 8));
  if (card > 0) {
    ctx.save(); ctx.globalAlpha = card;
    lib.setFont(ctx, tokens, "display", 110, { weight: 600 });
    const lay = lib.layoutText(ctx, WORDS.join(" "), { x: 960, y: 560, align: "center" });
    const starts = []; let w = 0; lay.glyphs.forEach((g) => { if (g.ch === " ") w++; starts.push(w); });
    lib.drawGlyphs(ctx, lay, (g, i) => {
      const u = lib.bezier(0.2, 0.75, 0.3, 1)(lib.seg(k, 20 + 3 * starts[i], 29 + 3 * starts[i]));
      return { alpha: u, scale: 1.3 - 0.3 * u, fill: starts[i] === ACCENT ? lib.color(tokens, "accent") : ink };
    });
    ctx.fillStyle = lib.color(tokens, "accent");
    const line = lib.ease.outCubic(lib.seg(k, 32, 44)) * 180; ctx.fillRect(960 - line / 2, 610, line, 5);
    ctx.restore();
  }
  const bIn = lib.bezier(0.3, 0, 0.2, 1)(lib.seg(k, out + 8, out + 16));
  if (bIn > 0) { ctx.save(); ctx.globalAlpha = bIn; page(ctx, tokens, lib, 9); ctx.restore(); }
}
function page(ctx, tokens, lib, seed) {                                // 灰盒页面：顶栏 + 4×3 卡片
  const fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = lib.rgba(fg, 0.08); ctx.fillRect(0, 0, 1920, 88);
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(seed, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = i === seed ? ac : lib.rgba(fg, 0.4); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(seed, i, 1), 16);
  }
}
```

草图省掉了压印里的模糊（DOM 里不动画 blur，见 recipes/README.md）；在 canvas 里要加，就逐词画到一个图层上再带 `ctx.filter` 合成。强调词在草图里只换了颜色，正式做再加粗一档。

## 已知坑

- **停得不够**：原 demo 整句只停 15 帧，读不完就退了。停留按读时规则算，写进分镜时用 `bin/vh readcheck` 核一遍。
- **暗场静成死帧**：暗场 12 帧加上字卡淡入，画面有近半秒几乎全暗。配乐要垫着，不能同时停；暗场本身可以留极淡的渐变。
- **像报错弹窗**：暗底 + 强调色正文，或者暗底 + 细小的等宽白字，读作系统错误。正文用风格里的浅色，字号给足，强调色只给一个词。
- **文案写成第二遍标语**：字卡的话和收尾的标语重复，删一个（shotcraft 判例 P4）。字卡要说"接下来看什么"，带具体的功能名，不写抽象口号（判例 C2）。
- **用太多**：一支 30 s 的片子超过 2 次，节奏就碎了。

## 验收帧

- `read`（第 45 帧）：整句已经落定：字号够大，强调词只有一个，短线已经长出。
- `settle`（第 60 帧）：停留中，画面完全静止；配乐的底垫还在（查音频，不是查画面）。
- `last`（第 96 帧）：字卡已经退完，后镜正在淡入，两者没有叠在一起。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）转场卡 `shot-transitions` 的 D 式和 demo `BlackCardTransition.tsx`。文字重写；淡化、暗场、压印的帧数和暗底字色的规则取原值；停留时长改成本仓库的读时规则（原值 15 帧），强调词从斜体改成加粗，文案长度上限是本仓库加的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/transition/shot-transitions.md`、`demos/transition/shot-transitions/BlackCardTransition.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
