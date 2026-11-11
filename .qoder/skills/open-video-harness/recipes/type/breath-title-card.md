---
id: breath-title-card
name: 呼吸字卡
one_liner: 一句话逐词压印上屏，只有一个强调词，短横线收住，停到读完：两段高能镜头之间的喘息和路标
family: type
role: [breath]
intent: [breath, promise]
energy: [1, 2]
duration_f: [96, 166]
types: [promo, short, data, paper]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [no-hold, copy-drift, overuse]
qa: {read: 34, settle: 60}
status: upstream-tested
max_per_film: 4
pairs_with: [flash-cut, black-card]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/typography/paper-title-card.md, license: Apache-2.0, note: 压印配方、单强调词、短线、同色系底}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/typography/paper-title-card/PaperTitleCard.tsx, license: Apache-2.0, note: 帧数和缓动}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/sequences/promo-energy-arc.md, license: Apache-2.0, note: 呼吸字卡的密度规则}
sketch_sha: "63584dcb85d6"
---

# 呼吸字卡 · breath-title-card

## 意图

高能镜头连着来，观众需要停一下。这张字卡用一句话占住这一拍：下一段讲什么、凭什么值得看，一句说完。它也是路标：重要功能出场前的那张字卡，标出了这一章从哪里开始。

## 阶段与时值

第 0 帧 = 字卡第一帧。下表按一句 3 个词块的中文（"每一帧，都是代码。"）算；停留随文案变。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 压印 | 4–21 | 第 i 个词（中文是词块）在 4 + 4i 帧开始，9 帧压到位：缩放 1.28 → 1，透明度 0 → 1，`bezier(0.2,0.75,0.3,1)` |
| 短线 | 16–34 | 强调色短线从 0 长到 220 px，`bezier(0.3,0,0.2,1)` |
| 停留 | 34–96 | 从短线长完算起，按读时规则停：这一句 Pace 为 normal 时是 62 帧（2.1 s） |
| 退场 | 96–104 | 整张卡 8 帧淡出，交给下一镜 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 停留 | 没人念：底线是够快读一遍（max(1.5 s, 汉字数 ÷ 7 + 其他字符数 ÷ 20 + 0.8 s)），舒服的时长按 BRIEF 的 Pace；旁白念这句：跟旁白走，念完再停 0.4–0.6 s；当喘息用时可以停得比读时长，落在小节线上 | 本仓库的读时规则（TASTE_CHECKLIST #5，`bin/vh readcheck`）。shotcraft 原卡整张只有 50–55 帧（1.8 s），压印完剩下的停留连快读一遍都不够 | ★ |
| 强调词 | 一句恰好一个：强调色 + 加粗一档；选功能名或收益词 | 两个强调词等于没有。原卡用斜体，本仓库不用斜体做强调（playbook/03 §4） | ★ |
| 压印 | 起始缩放 1.28，9 帧，词间隔 4 帧 | 1.28 是"压上纸"的读感；逐词间隔再大就像打字机 | |
| 底色 | 片子自己的底色，中心加一块很淡的暖光 | 和产品画面同一个世界，字卡才不像插播的广告 | ★ |
| 字 | 展示字体，1080p 下 96–120 px，字重 600 | 字要有分量；一句话一行，最多两行 | |
| 副行（可选） | 等宽字 + 一个滚动的数字（"5 of 31 fetched today"），不小于 44 px | 具体数字最有说服力；数字必须在字卡淡出之前滚定；副行也要算进读时 | |
| 密度 | 每 1–2 个功能镜头后插一张，全片 2–4 张 | 少了没有呼吸，多了每一章都在停（shotcraft 全片骨架） | |

## 声音

同一支片子里所有字卡用同一个声音：一声短 swoosh，钉在第 0 帧。字卡本身不要落地重音，能量留给前后的镜头。

## 风格适配

- 结构参数：逐词压印的节奏、一个强调词、短线收住、停到读完、同色系底。
- 皮肤参数：字体（衬线、黑体、等宽都行）、强调色、短线的形状（可以是笔刷、印章、下划线）、底上的质感。
- 一拍二和像素风：压印改成 2–3 个台阶（大、中、原大），停留时长不变。
- 竖屏：字号用竖屏的 hook 档（130–170 px），一行不超过 9–11 个汉字（playbook/03 §2）。

## 实现

```js
// breath-title-card：逐词压印 → 短线 → 停到读完（readcheck）→ 淡出。中文按词块，拉丁文按空格分词。
const WORDS = ["每一帧，", "都是", "代码。"], ACCENT = 2;
const PACE = { relaxed: [4.5, 15, 1.0], normal: [6, 18, 0.8], brisk: [7, 20, 0.8] };  // 汉字/秒、其他字符/秒、另加秒数（playbook/03 §2）
const [CJK, OTHER, PAD] = PACE.normal;                                // BRIEF 的 Pace
const HOLD = Math.round(Math.max(1.5, 7 / CJK + 2 / OTHER + PAD) * 30);  // 7 个汉字、2 个标点 → 62 帧（底线 57 帧）
const DONE = 34, OUT = DONE + HOLD;                                    // 短线长完 = 完整显示的那一刻
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), bg = lib.color(tokens, "bg");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  const g = ctx.createRadialGradient(960, 454, 0, 960, 454, 1000);     // 同色系底 + 中心一块很淡的暖光
  g.addColorStop(0, lib.rgba(lib.mixColor(bg, "#fff4dc", 0.5), 0.5)); g.addColorStop(0.65, lib.rgba(bg, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.globalAlpha = 1 - lib.seg(f, OUT, OUT + 8);
  const starts = [], text = WORDS.join(""); WORDS.forEach((w, i) => { for (const _ of lib.graphemes(w)) starts.push(i); });
  lib.setFont(ctx, tokens, "zh", 112, { weight: 600 });
  const lay = lib.layoutText(ctx, text, { x: 960, y: 560, align: "center" });
  lib.drawGlyphs(ctx, lay, (gl, i) => {
    const w = starts[i], u = lib.bezier(0.2, 0.75, 0.3, 1)(lib.seg(f, 4 + 4 * w, 13 + 4 * w));
    return { alpha: u, scale: 1.28 - 0.28 * u, fill: w === ACCENT ? lib.color(tokens, "accent") : lib.color(tokens, "fg") };
  });
  const line = 220 * lib.bezier(0.3, 0, 0.2, 1)(lib.seg(f, 16, 34));
  ctx.fillStyle = lib.color(tokens, "accent"); ctx.fillRect(960 - line / 2, 610, line, 6);
  ctx.restore();
}
```

草图没有做逐词的虚焦（DOM 里不动画 blur，见 recipes/README.md），强调词只换了颜色，正式做时再加粗一档。草图按字缩放（每个字以自己为中心），原 demo 按词缩放；中文按字缩放更自然，拉丁文按词缩放更像压印。

## 已知坑

- **停得不够**：照搬原卡的 1.8 s，压印完剩下的停留不够快读一遍，读时检查报 FAIL，观众也读不完。停留按规则算，排分镜时用 `bin/vh readcheck` 核一遍。
- **文案抽象**：用户逐字改掉过"one board"一类的隐喻，要求写成"团队 + 功能名 + 收益"（shotcraft 判例 C2）。画面锁定以后，对着最终的镜头把字卡文案重写一遍（判例 C1）。
- **字卡和收尾标语重复**：同一句话全片只出现一次（判例 P4）。
- **副行数字没滚完就淡出**：排节拍时从字卡淡出的那一帧往回倒推数字滚动的起点。
- **当成插播**：换了一个和片子无关的底色、字体，字卡就像广告。用片子自己的底色和字体。

## 验收帧

- `read`（第 34 帧）：整句完整，强调词只有一个，短线已经长完；字号在 1080p 下不小于 84 px。
- `settle`（第 60 帧）：停留中，画面完全静止，没有还在飘的东西。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的字卡 `paper-title-card`、它的 demo `PaperTitleCard.tsx`，以及全片骨架 `promo-energy-arc` 里的字卡密度规则。文字重写；压印的帧数、缓动、单强调词、短线和同色系底取原值；停留改成本仓库的读时规则，强调从斜体改成加粗，中文按词块压印是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/typography/paper-title-card.md`、`demos/typography/paper-title-card/PaperTitleCard.tsx`、`references/sequences/promo-energy-arc.md`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
