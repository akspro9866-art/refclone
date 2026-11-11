---
id: type-and-filter
name: 打字筛选点进
one_liner: 在真实界面上按人手的速度打字搜索，网格自己收敛成一张卡，点击它，镜头推进交给详情
family: interaction
role: [feature]
intent: [interact, search]
energy: 3
duration_f: [70, 80]
types: [promo, short, data]
engines: [canvas, hyperframes]
aspect: [landscape, portrait]
needs: [ui-page, ui-element, text]
sound: recommended
pitfalls: [too-fast, float-not-land, uniform-timing]
qa: {read: 34, peak: 50, settle: 64}
status: upstream-tested
pairs_with: [flash-cut, portal-wipe, oversized-cursor]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/interaction/type-and-filter.md, license: Apache-2.0, note: 结构、判例、音效位置}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/interaction/type-and-filter/TypeAndFilter.tsx, license: Apache-2.0, note: 打字速度、呼吸位、错峰退场、滑位、双圈点击、推进}
sketch_sha: "4575cde95de3"
---

# 打字筛选点进 · type-and-filter

## 意图

观众看完要能复述这一步：搜了什么词，页面跟着怎么变，最后点中了哪一张。所以速度照人手来定：字一个个打出来，打完停一口气，点击之前视线先到。它常排在高能镜头后面，是一个观众跟得上的慢拍。

## 阶段与时值

第 0 帧 = 镜头停在搜索框附近。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 打字 | 10–31 | 每 3 帧一个字符（8 个字符）；光标在打字时常亮 |
| 喘一口气 | 31–42 | 打完停 11 帧（0.37 s），光标开始 8 帧一闪 |
| 筛选 | 42–57 | 非目标卡按阅读顺序每隔 0.4 帧出发，各自 5 帧淡出并下沉 8 px；目标卡 42–52 帧滑到第一行的真实槽位，途中浮起、阴影变宽 |
| 点击 | 58–71 | 两圈强调色涟漪（58、61 帧起，各 10 帧，半径 14 → 54 / 78 px）；第 60 帧起选中框（3 px 描边 + 40 px 辉光） |
| 推进 | 56–72 | 镜头 16 帧推到点击点，放大到 2.2 倍，交给下一镜（常接 `flash-cut`） |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 打字速度 | 3 帧/字符 | 初版嫌快被返工，这是定稿值（"unhurried"，shotcraft 判例 R3）；0.7 帧/字符只给装饰性小字 | ★ |
| 呼吸位 | 打完到筛选之间 11 帧 | 打完立刻筛选，读作机器自动，观众跟不上因果 | ★ |
| 光标 | 打字时常亮，打完后 8 帧一闪，点击后消失 | 打字中闪烁读作卡顿；"常亮 → 闪"的切换本身就是"打完了" | |
| 错峰退场 | 按阅读顺序，间隔 0.4 帧，各 5 帧 | 同时消失读作页面崩溃；哪怕只差 0.4 帧也够 | ★ |
| 目标卡的终点 | 第一行真实的槽位，`bezier(0.35,0,0.2,1)` 滑 10 帧，途中抬高、放大 2% | 滑到画面中央悬着就假了（判例 Q9，曾因此近乎整文件重写） | ★ |
| 点击 | 两圈同心涟漪，起点差 3 帧 | 单圈太轻，看不见 | |
| 搜索框 | 先用页面底色的补丁盖住截图里烤进去的占位文字（保留放大镜），再在上面打字 | 直接在截图上叠字，会和烤进去的占位文字重影 | |

## 声音

模板片的做法：打字段配键盘声，样本裁到和打字严格等长（这里 24 帧，shotcraft 判例 S4）；网格退场配一声快 whoosh（第 42 帧）；点击配真实的快门声，是全片最响的音效（第 58 帧）；推进配一声短 swoosh（第 62 帧）。点击声用真实物件的拟音，不用游戏的提示音（判例 S1）。

## 风格适配

- 结构参数：3 帧/字符、11 帧呼吸、按阅读顺序的错峰、真实槽位、点击触发推进。
- 皮肤参数：光标和涟漪的颜色、选中框的样式、字体（用产品界面自己的字体）。
- 界面是命令行时，打字不变，"筛选"换成输出逐行出现；点击换成回车。
- 想让观众看清是谁在操作，接一个超大光标（[oversized-cursor](oversized-cursor.md)）：光标点击触发筛选或推进。

## 实现

```js
// type-and-filter：打字 3 帧/字符 → 喘 11 帧 → 错峰退场 + 目标卡滑到第一格 → 双圈点击 → 推进 2.2 倍。
const Q = "nano-lab", TYPE = 10, FILTER = 42, CLICK = 58, TARGET = 6;
const slot = (i) => ({ x: 110 + (i % 4) * 430, y: 230 + Math.floor(i / 4) * 280 });
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent"), bg = lib.color(tokens, "bg");
  const push = lib.bezier(0.35, 0, 0.2, 1)(lib.seg(f, 56, 72)), c = slot(0), cx = c.x + 200, cy = c.y + 125;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.translate(960, 540); ctx.scale(lib.lerp(1, 2.2, push), lib.lerp(1, 2.2, push));
  ctx.translate(-lib.lerp(960, cx, push), -lib.lerp(540, cy, push));
  ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.6); ctx.beginPath(); ctx.roundRect(110, 110, 1700, 76, 38); ctx.fill();
  lib.setFont(ctx, tokens, "body", 44); ctx.fillStyle = fg;
  const typed = Q.slice(0, f < TYPE ? 0 : Math.min(Q.length, Math.floor((f - TYPE) / 3) + 1));
  ctx.fillText(typed, 170, 164);
  const caret = f >= TYPE - 2 && f <= 67 && (f <= TYPE + 24 || Math.floor((f - TYPE - 24) / 8) % 2 === 0);
  if (caret) { ctx.fillStyle = ac; ctx.fillRect(176 + ctx.measureText(typed).width, 126, 3, 46); }
  let rank = 0;
  for (let i = 0; i < 12; i++) {
    const s = slot(i);
    if (i === TARGET) continue;
    const out = lib.ease.inOutCubic(lib.seg(f, FILTER + rank * 0.4, FILTER + rank * 0.4 + 5)); rank++;
    if (out < 1) card(ctx, lib, fg, bg, s.x, s.y + 8 * out, 1 - out, 0, i);
  }
  const u = lib.bezier(0.35, 0, 0.2, 1)(lib.seg(f, FILTER, FILTER + 10)), fl = Math.sin(u * Math.PI), s0 = slot(TARGET);
  card(ctx, lib, fg, bg, lib.lerp(s0.x, c.x, u), lib.lerp(s0.y, c.y, u), 1, fl, TARGET);
  if (f >= 60) { ctx.strokeStyle = lib.rgba(ac, lib.lerp(0.5, 1, lib.seg(f, 60, 63))); ctx.lineWidth = 3; ctx.shadowColor = ac; ctx.shadowBlur = 40;
    ctx.beginPath(); ctx.roundRect(c.x - 6, c.y - 6, 412, 262, 18); ctx.stroke(); ctx.shadowBlur = 0; }
  for (const [start, R] of [[CLICK, 54], [CLICK + 3, 78]]) {            // 两圈涟漪
    const r = 1 - (1 - lib.seg(f, start, start + 10)) ** 3;
    if (f >= start && f <= start + 10) { ctx.strokeStyle = lib.rgba(ac, 1 - r); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, lib.lerp(14, R, r), 0, lib.TAU); ctx.stroke(); }
  }
  ctx.restore();
}
function card(ctx, lib, fg, bg, x, y, a, lift, k) {
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x + 200, y + 125); ctx.scale(1 + 0.02 * lift, 1 + 0.02 * lift);
  ctx.shadowColor = lib.rgba("#3c2d1e", 0.08 + 0.1 * lift); ctx.shadowBlur = 6 + 26 * lift; ctx.shadowOffsetY = 2 + 14 * lift;
  ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.5); ctx.beginPath(); ctx.roundRect(-200, -125, 400, 250, 16); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.fillStyle = lib.rgba(fg, 0.4); ctx.fillRect(-168, -90, 120 + 160 * lib.hash(5, k), 16);
  ctx.fillStyle = lib.rgba(fg, 0.18); ctx.fillRect(-168, -54, 300, 10); ctx.fillRect(-168, -32, 240, 10);
  ctx.restore();
}
```

## 已知坑

- **初版太快**：打字和筛选的第一版几乎总是偏快，被要求"放慢一些"（判例 R3）。起稿就按 3 帧/字符和 11 帧的呼吸位。
- **目标卡悬在中央**：筛选后的卡要落进真实的槽位（判例 Q9）。
- **占位文字重影**：截图里的搜索框有占位文字，先用补丁盖住。
- **点击没有后果**：点击之后必须有事发生（推进、打开详情）。点了什么都没变，观众会以为点空了。

## 验收帧

- `read`（第 34 帧）：搜索词完整，字够大（界面字号放大到能读：1080p 下 ≥ 44 px，TASTE_CHECKLIST #6 的辅助文字下限），光标在闪。
- `peak`（第 50 帧）：非目标卡按阅读顺序依次在走，目标卡正在滑向第一格、带着更宽的阴影。
- `settle`（第 64 帧）：目标卡在第一格的真实位置上，选中框和涟漪可见，镜头开始推进。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的交互卡 `type-and-filter` 和 demo `TypeAndFilter.tsx`（模板片里有用户判例的一镜）。文字重写；打字速度、呼吸位、错峰、滑位、涟漪和推进的帧数取原值；命令行界面的替代做法、和超大光标的搭配是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/interaction/type-and-filter.md`、`demos/interaction/type-and-filter/TypeAndFilter.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
