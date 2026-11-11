---
id: doc-self-writing
name: 文档自己写出来
one_liner: 一整页真排版的文档在光标后面一块块"写"出来，侧栏随后铺开，历史条目一条条落进侧栏
family: ui
role: [feature, proof]
intent: [generate, detail]
energy: 2
duration_f: [100, 120]
types: [promo, paper, data]
engines: [canvas, hyperframes]
aspect: [landscape]
needs: [ui-page]
sound: recommended
pitfalls: [too-fast, fake-ui, off-axis-read]
qa: {peak: 30, read: 64, settle: 100}
status: upstream-tested
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/typography/document-typewriter-reveal.md, license: Apache-2.0, note: 结构、判例、音效}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/ui-entrance/document-typewriter-reveal/DocumentTypewriterReveal.tsx, license: Apache-2.0, note: 写入节拍、遮罩、光标、侧栏、历史条目、相机}
sketch_sha: "c3b326fbecef"
---

# 文档自己写出来 · doc-self-writing

## 意图

这一镜靠"文档是真的"服人：观众会一个字一个字地读屏幕。内容在光标后面一块块写出来，静态截图就成了一份正在成形的文档；侧栏里的历史条目一条接一条落下，说明它不是一次性的，而是每周都在产出。它通常是全片信息最密的一镜，排在收场前倒数第 2–3 位。

## 阶段与时值

第 0 帧 = 镜头停在标题的特写上。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 写入 | 6–49 | 20 个内容块两两一对：第 g 对在 6 + 3.5g 帧开始，每块 8 帧写完：一块页面底色的遮罩从左往右收走（右端固定），强调色光标骑在揭开的前沿 |
| 标记 | 每块写完后 4 帧 | 人名的 @ 提及在 8 帧里长出一层强调色底色（透明度 0.7） |
| 相机 | 0–64 | 从标题特写（1.25 倍）拉到全页（0.997 倍），两栏都要入画；之后只做微呼吸（第 78 帧 1.003，第 102 帧 0.995） |
| 侧栏 | 46–80 | 左栏第 46 帧、右栏第 54 帧：底色补丁 10 帧从上往下收走，内侧 1.5 px 的强调色细线跟着长，24 帧后淡去 |
| 历史条目 | 58–91 | 6 条，第 i 条在 58 + 5i 帧从上方 44 px 落下，8 帧，`bezier(0.2,1.15,0.3,1)`（约 0.6% 过冲），空中带影子 |
| 读 | 64–110 | 全页静止（只有微呼吸），观众读字 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 写入节拍 | 两块一组，组间 3.5 帧，每块 8 帧，`bezier(0.4,0,0.6,1)` | 逐块写会超预算：块数 × 节拍要先对上"全页落定"的那一帧，这是这张配方的核心算术 | ★ |
| 光标 | 只跟最新的那一块，写完 2 帧淡掉 | 同时出现几个光标立刻穿帮；永远只有一个"笔尖" | ★ |
| 列表的圆点 | 遮罩往左多盖 28 px | 截图里烤进去的圆点在字的左边约 22 px，不多盖会提前露出来 | |
| @ 提及 | 写完后 4 帧起、8 帧长出 | 高亮晚于写入才读作"重点被标出"；同帧出现读作贴图 | |
| 双栏 | 左 46、右 54，和正文错开 | 同时入场会互相抢视线 | |
| 相机 | 全页时两栏必须都在画里；之后只做 ±0.3% 的呼吸 | 砍掉侧栏等于砍掉"完整产品"的说服力（判例 Q10）；信息镜头正视，不斜拍（判例 Q6） | ★ |
| 内容 | 产品原生排版，文字铺满，侧栏、评论栏完整；人名和数据用虚构的 | "贴图 + 标语"级的假文档整镜返工（判例 Q10）；不出现客户和成员的真名（判例 Q1） | ★ |

## 声音

写入段配打字声，样本裁到和写入严格等长（模板片 44 帧）；历史条目 6 连 pop，每 5 帧一发，音量从 0.40 阶梯降到 0.25，像越来越远（shotcraft 声音判例 S2、S4）。镜头切入时一声柔和的过渡音。

## 风格适配

- 结构参数：两块一组的写入节拍、唯一的光标、写完再标记、正文和侧栏错开、全页正视。
- 皮肤参数：遮罩的颜色（页面底色）、光标和高亮的颜色（品牌强调色）、历史条目的样式。
- 竖屏放不下双栏：只写正文，历史条目改成正文下面的一条时间线，或者这一镜不做竖屏。
- 文档是代码时，写入换成代码逐行出现（同样两行一组、一个光标）。

## 实现

```js
// doc-self-writing：12 块两两一对写入（3.5 帧一组，8 帧一块，遮罩从左往右收走，光标骑在前沿）→ 左栏铺开 → 6 条历史条目落下。
const BLOCKS = Array.from({ length: 12 }, (_, i) => ({ x: 640, y: 170 + i * 62, w: i % 4 === 0 ? 700 : 1040 - 90 * (i % 3), h: i % 4 === 0 ? 40 : 22 }));
const cue = (i) => 6 + Math.floor(i / 2) * 3.5;
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent"), bg = lib.color(tokens, "bg");
  const z = f < 64 ? lib.lerp(1.25, 0.997, lib.ease.inOutCubic(lib.seg(f, 0, 64))) : 1 + 0.003 * Math.sin((f - 64) / 38 * Math.PI);
  const cy = lib.lerp(300, 540, lib.ease.inOutCubic(lib.seg(f, 0, 64)));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-lib.lerp(1100, 960, lib.seg(f, 0, 64)), -cy);
  ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.7); ctx.fillRect(560, 110, 1250, 900);                   // 文档页
  let caret = -1;
  BLOCKS.forEach((b, i) => {
    ctx.fillStyle = lib.rgba(fg, b.h > 30 ? 0.8 : 0.35); ctx.fillRect(b.x, b.y, b.w, b.h);             // 截图里"烤好"的内容
    const cover = 1 - lib.bezier(0.4, 0, 0.6, 1)(lib.seg(f, cue(i), cue(i) + 8));                      // 遮罩：右端固定，从左往右收走
    if (cover > 0) { ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.7); ctx.fillRect(b.x - 4 + (b.w + 8) * (1 - cover), b.y - 3, (b.w + 8) * cover, b.h + 6); }
    if (f >= cue(i) && f <= cue(i) + 10) caret = i;                                                   // 光标只跟最新的一块
  });
  if (caret >= 0) { const b = BLOCKS[caret], c = 1 - lib.bezier(0.4, 0, 0.6, 1)(lib.seg(f, cue(caret), cue(caret) + 8));
    ctx.fillStyle = ac; ctx.fillRect(b.x - 4 + (b.w + 8) * (1 - c), b.y - 2, 2, Math.min(20, b.h + 4)); }
  const rail = lib.seg(f, 46, 56);                                                                      // 左栏：补丁从上往下收走
  ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.4); ctx.fillRect(110, 110, 400, 900 * rail);
  ctx.fillStyle = lib.rgba(ac, 1 - lib.seg(f, 56, 80)); ctx.fillRect(508, 110, 1.5, 900 * rail);
  for (let i = 0; i < 6; i++) {                                                                         // 历史条目：一条条落进侧栏
    const u = lib.bezier(0.2, 1.15, 0.3, 1)(lib.seg(f, 58 + 5 * i, 66 + 5 * i)); if (f < 58 + 5 * i) continue;
    const y = 160 + i * 64 - 44 * (1 - u), air = 1 - u;
    ctx.save(); ctx.shadowColor = lib.rgba("#000000", 0.2 * air); ctx.shadowBlur = 20 * air; ctx.shadowOffsetY = 10 * air;
    ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.8); ctx.fillRect(140, y, 340, 50); ctx.restore();
    ctx.fillStyle = lib.rgba(fg, 0.4); ctx.fillRect(160, y + 18, 180, 12);
  }
  ctx.restore();
}
```

草图只画了左栏；正式片是整页截图，写入的遮罩按截图里每一块内容的 bbox（`layout.json`）来盖，历史条目是 DOM 重画的，要和截图里已有条目的行高严格对齐。

## 已知坑

- **假文档**：贴一张图、写一句标语，整镜会被推翻重做。用产品原生的排版把假内容铺满（判例 Q10）。
- **多个光标**：同时写几块时每块都画光标，立刻穿帮。只有最新的一块有光标。
- **算不过来**：块多、每块单独写，会超出镜头的预算。先算"最后一对何时写完"，要赶在全页落定之前（这里第 49 帧，全页是第 64 帧）。
- **活数据页**：协作文档一类的页面，重新全量截图会刷掉已经定稿的纹理；只刷需要的那一页。
- **斜着拍**：信息最密的一镜要正视，读得清最重要（判例 Q6）。

## 验收帧

- `peak`（第 30 帧）：一半的块已经写完，只有一个光标，在最新那一块的前沿。
- `read`（第 64 帧）：全页入画，两栏都在，正文全部写完；1080p 下正文字号够读（截图的字要按放大后的实际像素量）。
- `settle`（第 100 帧）：6 条历史条目都已落进侧栏，只剩相机的微呼吸。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的卡 `document-typewriter-reveal` 和同名 demo（模板片里有用户判例的一镜）。文字重写；写入节拍、遮罩、光标、@ 提及、侧栏、历史条目和相机的数值取原值；竖屏和代码文档的做法是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/typography/document-typewriter-reveal.md`、`demos/ui-entrance/document-typewriter-reveal/DocumentTypewriterReveal.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
