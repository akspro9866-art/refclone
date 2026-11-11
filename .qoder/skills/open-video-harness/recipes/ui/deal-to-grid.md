---
id: deal-to-grid
name: 发牌入网格
one_liner: 一摞卡像发牌一样飞进网格的真实槽位，出牌越来越快，相机追着往下滚，满板后停半秒
family: ui
role: [feature]
intent: [abundance]
energy: [4, 5]
duration_f: [88, 115]
types: [promo, data, short]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait]
needs: [ui-page, ui-element]
sound: recommended
pitfalls: [uniform-timing, float-not-land, sub-threshold, mechanical-stop, fake-ui]
qa: {peak: 62, settle: 86}
status: upstream-tested
max_per_film: 1
pairs_with: [portal-wipe]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/ui-entrance/deck-deal-flyin.md, license: Apache-2.0, note: 发牌隐喻、判例、预备拍幅度、拖拽层级}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/ui-entrance/deck-deal-flyin/DeckDealFlyin.tsx, license: Apache-2.0, note: 出牌公式、单卡飞行、相机追逐}
sketch_sha: "c03670fb94c3"
---

# 发牌入网格 · deal-to-grid

## 意图

要观众感到量大，而且还在不停地来。开头只有一摞卡，观众会好奇这是什么；接着卡一张张被甩出去，每张落进页面里自己的格子，出得越来越快，直到整页填满、停住，答案才揭晓：这是几十个真实的项目。

## 阶段与时值

第 0 帧 = 预备拍开始。前面可以接一段可选的牌堆特写（见参数表），这里不算在内。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 预备拍 | 0–8 | 整摞下压 48 px，顶卡向出牌的反方向回拉 30 px，ease-out；首张出牌的那一帧释放 |
| 发牌 | 8–73 | 第 k 张（按阅读顺序）在 8 + 4k − 0.0792·k(k−1) 帧出牌：间隔从 4 帧收紧到 0.2 帧，26 张在第 61 帧前发完 |
| 单卡 | 每张 12 帧 | 飞 8 帧（`bezier(0.3,0,0.2,1)`，途中抬高、放大 6%）→ 落定 4 帧（`bezier(0.3,0,0.25,1.15)`，约 1.3% 过冲）→ 最后 2 帧轻压 0.996 |
| 相机追逐 | 50–72 | 前三行落满以后，页面追着正在落地的那一行往下滚，越滚越快：约 50 px/帧，再到约 70 px/帧，最后一行落地时停住 |
| 满板静止 | 73–88 | 最后一张在第 73 帧落定，阴影收紧，整板静止 0.5 s |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 物理隐喻 | 发牌：从一摞里一张张甩出 | 抽象的"涌入"改了五轮不收敛，换成发牌一轮通过（shotcraft 判例 R2） | ★ |
| 出牌节拍 | 第 k 张 = 起点 + g₀·k − (g₀ − g₁)/(N − 2) · k(k−1)/2；原值 g₀ = 4、g₁ = 0.2、N = 26 | 均匀间隔立刻显得机械；匀加速不够狠也被否，要"hard-accelerating"（判例 R2） | ★ |
| 卡量 | 20–30 张；真卡不够时，用真卡切片错位补齐，落进真实扩展出来的格子 | 卡少了涌入感不成立，宁多勿少 | |
| 终点 | 页面布局里真实的槽位，落定后坐标锁死 | 悬浮在页面上方读作假（判例 Q9） | ★ |
| 预备拍幅度 | 下压 48 px、回拉 30 px（约堆高的六成） | 4 px / 2 px 的初版用户完全看不出，放大 12 倍才通过；先算像素再算比例，全景机位下教科书比例太小 | ★ |
| 预备拍次数 | 整段只做一次，不逐卡做 | 逐卡预备会拖垮加速的节拍 | |
| 落地 | 飞 8 帧之后落定 4 帧（带过冲），轻压落在这 4 帧的后 2 帧里：缓冲约为飞行时间的一半 | 砍掉读作硬冻结；过冲必须真的超过 1（曲线的 y 大于 1）。原卡写"合计 6 帧约为飞行的 30%"，和它自己的 demo 对不上，这里按 demo 的帧数写 | |
| 拖拽层级 | 卡先停；落地阴影晚 2–4 帧收紧；残影再拖 3–5 帧散掉 | 所有东西在同一帧停住读作机械；静止段的最后全部锁死 | |
| 残影 | 飞行中一份滞后 5% 路程的副本，透明度 0.25·(1 − u) | 比真正的运动模糊便宜，单卡层面够用 | |
| 满板停 | 相机停后 0.5 s | 用户逐字要求（判例 R2），砍掉必返工 | ★ |
| 可选：牌堆特写 | 暗色拉丝金属台面，相机侧斜绕牌堆转 34 帧，再拉远到页面，金属在拉远时淡出 | 特写四件套：侧面倾斜角、看得出的堆高、环绕、反差深色材质（判例 Q7）；砍掉的话，要另外交代"牌堆从哪来" | |

## 声音

不逐卡配音，只打三下：镜头拉远、第一批牌飞出时一声大的 whoosh（模板片第 308 帧），加速段再来两声短的（第 340、356 帧，后一声轻些）。如果要给落位配 pop，用三招防机枪：两个样本交替、音量逐次降、间隔跟着出牌加速，密到糊成一片时淡成一道 swoosh（shotcraft 判例 S2）。

## 风格适配

- 结构参数：发牌隐喻、出牌公式、预备拍幅度、真实槽位、拖拽层级、满板停。
- 皮肤参数：卡片（真实截图，或风格化的卡）、台面材质、阴影颜色。
- 手绘、剪纸风格：卡换成风格里的纸片，飞行弧线更高，落地不压而是晃一下；公式不变。
- 竖屏：网格改成 2 列，相机追逐的距离变长，出牌公式不变。

## 实现

```js
// deal-to-grid：预备拍 → 26 张按加速公式发进 4 列网格 → 相机追着往下滚 → 满板停 0.5 s。灰盒卡片代替真实截图。
const N = 26, T0 = 20, PILE = { x: 1400, y: 90 };
const slot = (k) => ({ x: 110 + (k % 4) * 430, y: 150 + Math.floor(k / 4) * 300 });
const cue = (k) => 8 + 4 * k - 0.0792 * k * (k - 1);                  // 间隔 4 帧 → 0.2 帧；第 25 张在第 60.5 帧出牌
const vel = (k, lib) => k < 50 ? 0 : k < 62 ? 50 * lib.seg(k, 50, 54) : k < 72 ? 70 : 0;   // 追着落地的那一行滚：50 → 70 px/帧 → 停
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t) - T0, E = lib.bezier, P = { fg: lib.color(tokens, "fg"), paper: lib.mixColor(lib.color(tokens, "bg"), "#ffffff", 0.6) };
  let camY = 0; for (let k = 0; k < f; k++) camY += vel(k, lib);       // 对整数帧求和：仍是 t 的纯函数
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.translate(0, -camY);
  ctx.strokeStyle = lib.rgba(P.fg, 0.08); for (let k = 0; k < N; k++) { const s = slot(k); ctx.strokeRect(s.x, s.y, 400, 260); }
  const ant = 1 - (1 - lib.seg(f, 0, 8)) ** 2;                        // 预备拍：整摞下压 48 px，顶卡向右回拉 30 px
  const cards = [];
  for (let k = 0; k < N; k++) {
    const c = cue(k), s = slot(k), px = PILE.x + ((k * 7) % 9 - 4) * 2 + (k === 0 && f < c ? 30 * ant : 0);
    const py = PILE.y + ((k * 5) % 7 - 3) * 2 - (N - k) * 3 + (f < c ? 48 * ant : 0);
    const u = E(0.3, 0, 0.2, 1)(lib.seg(f, c, c + 8)), st = E(0.3, 0, 0.25, 1.15)(lib.seg(f, c + 8, c + 12));
    const rank = f < c ? 1 + (N - k) / N : f < c + 12 ? 3 + k / N : 0;  // 画的顺序：已落定 < 牌堆（底到顶）< 空中
    cards.push({ k, rank, u, px, py, x: lib.lerp(px, s.x, u), y: lib.lerp(py, s.y, u), c,
      lift: f < c ? 0.1 : Math.sin(u * Math.PI) + 0.15 * (1 - st), shadow: 1 - lib.seg(f, c + 10, c + 14),
      sc: (1 + 0.06 * Math.sin(u * Math.PI)) * (f >= c + 10 && f < c + 12 ? 0.996 : 1) });
  }
  for (const q of cards.sort((a, b) => a.rank - b.rank)) {
    if (q.u > 0.02 && q.u < 0.98) card(ctx, lib, P, lib.lerp(q.x, q.px, 0.05), lib.lerp(q.y, q.py, 0.05), q.sc, 0, 0.25 * (1 - q.u), q.k);   // 残影
    card(ctx, lib, P, q.x, q.y, q.sc, q.shadow * Math.max(q.lift, 0.05), 1, q.k);   // 阴影比卡晚 2–4 帧收紧
  }
  ctx.restore();
}
function card(ctx, lib, P, x, y, sc, lift, alpha, k) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x + 200, y + 130); ctx.scale(sc, sc);
  ctx.shadowColor = lib.rgba("#3c2d1e", 0.08 + 0.22 * lift); ctx.shadowBlur = 10 + 60 * lift; ctx.shadowOffsetY = 2 + 34 * lift;
  ctx.fillStyle = lib.mixColor(P.paper, P.fg, 0.03 + 0.04 * lib.hash(4, k)); ctx.beginPath(); ctx.roundRect(-200, -130, 400, 260, 16); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.fillStyle = lib.rgba(P.fg, 0.4); ctx.fillRect(-168, -94, 120 + 160 * lib.hash(4, k, 1), 16);
  ctx.fillStyle = lib.rgba(P.fg, 0.18); ctx.fillRect(-168, -58, 300, 10); ctx.fillRect(-168, -36, 240, 10);
  ctx.restore();
}
```

草图里的 z 轴用"放大 + 阴影变深变远"近似；要真的抬高、带牌堆特写的斜视，用 CSS 3D 或 Three.js。

## 已知坑

- **抽象的 flood**：没有物理隐喻的"一堆卡涌进来"，怎么调都不对。先找隐喻（发牌、多米诺、传送带），再写代码。
- **同时飞**：所有卡同时出发读作爆炸；错峰而且越来越快，才是这一式的灵魂。
- **手搓的假卡**：卡的纹理用真实页面元素的切片（判例 Q1），补齐的卡用真卡错位复用，不要画假卡。
- **预备拍看不出**：渲染后不逐帧看，能不能看出蓄力？看不出等于没做。
- **全部同一帧停住**：卡、阴影、残影在同一帧冻结，像机器。按层级错开 2–5 帧，再全部锁死。
- **相机快速段闪烁**：30 fps 下相机每帧跳 50–70 px 会频闪。快速段包子帧运动模糊（playbook/08），慢的部分不要包，否则细纹理会被抹软。

## 验收帧

- `peak`（第 62 帧）：最后几张还在空中，出牌间隔明显比开头密；相机在快速滚动，正在落地的那一行在画面里；没有一张卡悬在页面上方不落。
- `settle`（第 86 帧）：整板静止，每张卡都在真实的格子里，阴影已经收紧；和第 87 帧逐像素相同。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的界面卡 `deck-deal-flyin` 和 demo `DeckDealFlyin.tsx`，以及它引用的判例 R2、Q1、Q7、Q9、S2。文字重写；出牌公式、预备拍幅度、单卡飞行与落定的帧数和缓动、残影和相机追逐的速度取原值；出牌公式的一般形式、手绘和竖屏的适配是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/ui-entrance/deck-deal-flyin.md`、`demos/ui-entrance/deck-deal-flyin/DeckDealFlyin.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
