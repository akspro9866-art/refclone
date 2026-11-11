---
id: portal-wipe
name: 穿窗
one_liner: 页面上的一张卡放大成全屏窗口，被点开的那个世界从窗里长出来接管画面
family: seam
role: [seam]
intent: [enter, detail]
energy: [3, 4]
duration_f: [40, 48]
jump: [level, rise]
types: [promo, data, paper]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-page, ui-element]
sound: recommended
pitfalls: [seam-mismatch, text-blur, no-hold]
qa: {peak: 20, settle: 48}
status: tuned
pairs_with: [deal-to-grid]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/transition/shot-transitions.md, license: Apache-2.0, note: 六式中的 F 式（平面款、纵深款）}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/transition/shot-transitions/PortalWipeV2.tsx, license: Apache-2.0, note: 纵深款的帧数、缓动、两层视差}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/transition/shot-transitions/MaskWipeReal.tsx, license: Apache-2.0, note: 平面款的帧数和卡面淡出}
sketch_sha: "ad36097602bf"
---

# 穿窗 · portal-wipe

## 意图

从"总览"进到"这一项的详情"：观众刚在页面上看到一排卡，其中一张被放大成窗口，窗里就是它的详情。接缝本身讲了一句话："点开这张卡，进入它的世界"。窗里的新场景必须是这张卡的详情，否则只是一个花哨的擦除。

## 阶段与时值

第 0 帧 = 卡开始放大。下面是纵深款；平面款的差别写在参数表里。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 放大成窗 | 0–40 | 卡的位置、宽高、圆角一起插值到全屏，`bezier(0.7,0,0.3,1)`，先慢后快再收住 |
| 卡面淡出 | 0–17 | 卡面不透明度 1 − 2.4u，前 40% 就透明了，露出窗里的新场景 |
| 窗内补偿 | 0–40 | 窗里的整个新场景从 0.42 倍长到 1 倍，和窗用同一个 u |
| 窗内视差 | 15–48 | 两层轻微散开：远层放大 8%，近层放大 30%，ease-out，第 48 帧速度归零 |
| 静止 | 48 起（属于后镜） | 至少 30 帧真静止，让观众读清新场景 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 同一个 t | 窗的几何和窗里的缩放由同一个进度 u 驱动 | 两者各算各的，中途会错开，读作穿帮 | ★ |
| 窗内层数 | 只有 2 层（远：新场景整页；近：2 张卡），不加模糊 | 原 demo 第一版 3 层、散开 0.85、加模糊，穿窗后画面碎、读不清，被否 | ★ |
| 散开量 | 远层 0.08，近层 0.3 | 大了就读成爆炸，小了没有纵深 | |
| 穿完即停 | 视差在第 48 帧收干，之后至少 30 帧完全静止 | 视差一直飘，会偷走观众读后镜的时间 | ★ |
| 窗内起始缩放 | 0.42 | 窗在卡那么大时，里面已经是完整的新场景缩小版，放大时才连贯 | |
| 平面款 | 45 帧放大，`bezier(0.5,0,0.2,1)`，卡面 1 − 2.2u，窗内没有视差 | 更平静，适合信息密集的详情页 | |
| 被放大的卡 | 用高清纹理（2–4 倍截图） | 这张卡全程被特写，普通截图放大后字会糊 | ★ |

## 声音

窗开始放大时一声短 whoosh，窗铺满全屏的那一帧（第 40 帧）一声轻的落定音。点击触发的话，先有一声点击拟音（真实的快门、开关声，不用游戏提示音），再接 whoosh。

## 风格适配

- 结构参数：同一个 u、两层、穿完即停、窗内从 0.42 起。
- 皮肤参数：圆角大小、窗的投影、窗边是否有描边。
- 平面风格（`swiss-grid-type`、`editorial-data`）用平面款；有纵深的风格（`product-keynote`、`monumental-scifi`）用纵深款。
- 窗不一定是圆角矩形：剪纸风格可以是剪出来的形状，但几何插值和补偿的规则不变。

## 实现

```js
// portal-wipe 纵深款：第 30 帧起，强调色那张卡放大成全屏窗口，窗里是它的"详情"（另一张灰盒页面）。
const T0 = 30, CARD = { x: 540, y: 450, w: 400, h: 260, r: 18 };
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0, fg = lib.color(tokens, "fg");
  const u = lib.bezier(0.7, 0, 0.3, 1)(lib.seg(k, 0, 40));
  const spread = 1 - (1 - lib.seg(k, 15, 48)) ** 3;                  // ease-out，第 48 帧收干
  page(ctx, tokens, lib, 5);                                          // 旧场景
  const x = lib.lerp(CARD.x, 0, u), y = lib.lerp(CARD.y, 0, u), w = lib.lerp(CARD.w, 1920, u), h = lib.lerp(CARD.h, 1080, u);
  const r = lib.lerp(CARD.r, 0, u), s = lib.lerp(0.42, 1, u);         // 窗和窗内：同一个 u
  if (k < 0) return;
  ctx.save();
  if (u < 1) { ctx.shadowColor = "rgba(0,0,0,0.22)"; ctx.shadowBlur = 48; ctx.shadowOffsetY = 12; }
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = lib.color(tokens, "bg"); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.clip();
  ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s);               // 窗内舞台：1920×1080，以窗心为中心
  ctx.save(); ctx.scale(1 + 0.08 * spread, 1 + 0.08 * spread); ctx.scale(0.82, 0.82); ctx.translate(-960, -540);
  page(ctx, tokens, lib, 9); ctx.restore();                           // 远层：新场景整页
  ctx.save(); ctx.scale(1 + 0.3 * spread, 1 + 0.3 * spread); ctx.translate(-960, -540);
  ctx.strokeStyle = lib.rgba(fg, 0.2); ctx.lineWidth = 2;
  for (const [cx, cy, cw, ch] of [[150, 660, 380, 250], [1420, 160, 340, 220]]) {
    ctx.fillStyle = lib.color(tokens, "bg"); ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = lib.color(tokens, "accent"); ctx.fillRect(cx + 30, cy + 34, cw * 0.4, 14);
    ctx.fillStyle = lib.rgba(fg, 0.25); ctx.fillRect(cx + 30, cy + 68, cw * 0.7, 10); ctx.fillRect(cx + 30, cy + 90, cw * 0.55, 10);
  }
  ctx.restore(); ctx.restore();                                       // 近层：两张卡
  const face = Math.max(0, 1 - 2.4 * u);                             // 卡面：前 40% 就淡没了
  if (face > 0) { ctx.save(); ctx.globalAlpha = face; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
    ctx.fillStyle = lib.color(tokens, "accent"); ctx.fillRect(x, y, w, h); ctx.restore(); }
}
function page(ctx, tokens, lib, seed) {                                // 灰盒页面：顶栏 + 4×3 卡片
  const fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = lib.rgba(fg, 0.08); ctx.fillRect(0, 0, 1920, 88);
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = i === seed ? ac : lib.rgba(fg, 0.05 + 0.06 * lib.hash(seed, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = lib.rgba(fg, 0.4); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(seed, i, 1), 16);
  }
}
```

HyperFrames（DOM）里是一个 `overflow: hidden` 的 div 当窗，`left/top/width/height/border-radius` 都由同一个 u 算；窗里放一个 1920×1080 的舞台，`transform: translate(-50%,-50%) scale(s)`。

## 已知坑

- **窗和窗内不同步**：窗用一条曲线、窗内用另一条，或者窗内晚几帧起步，中途会看到新场景在窗里滑动。两者只用一个 u。
- **窗里塞了无关的场景**：新场景要是这张卡的详情（真实的详情页截图）；换成别的内容，语义就断了。
- **窗内层太多**：3 层以上、散开太大、再加模糊，穿窗之后画面是碎的。只留 2 层。
- **视差不停**：窗铺满以后视差还在飘，观众没法读后镜。第 48 帧之后一个像素都不动。
- **卡的字糊**：被放大的卡用高清截图。原 demo 用的是单独截的高清卡片纹理。
- **不是判例**：纵深款的参数在灰盒上调的，没有经过真实素材；平面款用真实纹理校过一次。

## 验收帧

- `peak`（第 20 帧）：窗大约放大到一半，卡面已经透明；窗里的新场景和窗的边缘同步，没有错位。
- `settle`（第 48 帧）：窗已铺满，两层视差停住；和第 49、50 帧逐像素相同。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）转场卡 `shot-transitions` 的 F 式，以及 demo `PortalWipeV2.tsx`（纵深款）和 `MaskWipeReal.tsx`（平面款）。文字重写；帧数、缓动、卡面淡出系数、窗内起始缩放和两层视差的系数取原值，风格适配和声音一节是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/transition/shot-transitions.md`、`demos/transition/shot-transitions/PortalWipeV2.tsx`、`demos/transition/shot-transitions/MaskWipeReal.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
