---
id: spotlight-hero
name: 聚光单主角
one_liner: 光在整页上找一圈、停在一张卡上，镜头从左侧斜着推近；卡抬起悬停，边框上跑两圈光，再落回自己的格子
family: open
role: [hero, open]
intent: [hero, detail]
energy: 3
duration_f: [145, 160]
types: [promo, short, data]
engines: [hyperframes, three, canvas]
aspect: [landscape, portrait]
needs: [ui-page, ui-element]
sound: recommended
pitfalls: [too-fast, text-blur, glow-spill, no-hold]
qa: {peak: 66, settle: 136}
status: upstream-tested
max_per_film: 1
pairs_with: [brand-imprint-open]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/opening/spotlight-hero-card.md, license: Apache-2.0, note: 结构、判例、音效位置}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/opening/spotlight-hero-card/SpotlightHeroCard.tsx, license: Apache-2.0, note: 相机关键帧、聚光站点、动作弧、光束两圈}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/aesthetic-rules.md, license: Apache-2.0, note: 判例 Q2、Q4、Q5、Q6、R1、R3}
sketch_sha: "bcad4eb6f530"
---

# 聚光单主角 · spotlight-hero

## 意图

这一镜只立一个主角：产品里最小、最常见的那块积木，比如一张卡。全页先铺开，一束光在页面上找了几处，停在它身上，观众的视线就被带了过去；它从槽里抬起、悬在半空，才显出厚度和分量；一道光沿着边框转两圈，像在细看它；最后它落回原来的格子，交代它本来就是这一页的一部分。全片最慢、最讲质感的一镜通常是它。

## 阶段与时值

第 0 帧 = 页面全景淡入。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 全景 · 找 | 0–32 | 页面 0–8 帧淡入；相机不动（0.78 倍全页正视）；聚光灯 2–10 帧亮起，经过 4 个中间站（4–28 帧），在第 32 帧锁定主角卡，光池收拢并脉冲一下 |
| 推近 | 32–48 | 16 帧推到 2.6 倍，同时转成左侧斜视（绕 Y 轴 34°、绕 X 轴 8°），`bezier(0.35,0,0.2,1)`；32–38 帧高清卡面叠进来 |
| 弹起 | 48–58 | 卡离开槽位升起，`bezier(0.2,1.25,0.3,1)`（约 2% 过冲），阴影随高度变大变软 |
| 悬停 | 58–112 | 54 帧：上下浮动 4 px、周期 40 帧；光束第一圈 60–74（快、亮），第二圈 80–100（慢、弱），余光 100–112 淡去 |
| 贴回 | 112–130 | 18 帧落回槽位，`bezier(0.4,0,0.3,1.05)`，最后 4 帧轻压一下（缩放 0.997） |
| 锁定 | 130–145 | 相机和卡全部不动，至少 15 帧（原 demo 共 139 帧，落地后只锁了 9 帧；这里按"收尾"一行的 ★ 补足） |

从锁定到落地约 98 帧（3.3 s），这是判例定下来的长度。

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 主角 | 一张卡，一条完整的动作弧 | 开场多卡群舞撑不起第一印象；shotcraft 的开场推倒过六次才收敛到单卡（判例 Q5） | ★ |
| 节奏 | 锁定 → 落地约 3.3 s | "放慢到 3 秒"是用户原话（判例 R3）；质感镜头的初版几乎总是偏快 | ★ |
| 机位 | 从左侧斜着拍：绕 Y 轴 34° 为主，绕 X 轴只有 8° | 侧向水平的机位读得清字；从下方仰拍被否（判例 Q6） | |
| 选卡 | 推近后能落在画面中心的那张；焦点比卡心偏左 30 px，卡落在画面略偏右 | 先按"推近后的构图"选卡，不是随便挑一张 | |
| 聚光灯 | 4 个中间站，光池半径 620 → 420 → 360 px，锁定时 +6% 脉冲；画面外圈压暗 0.16 → 0.42 | 有中间站才像人在找；直奔目标读作程序 | |
| 光束 | 两圈：第一圈 14 帧线性、亮而粗；第二圈 20 帧缓动、0.62 倍亮度、细一半 | 两圈快慢不同才像持续扫描，一圈只是眨眼。光效只给主角这一次（判例 Q4） | ★ |
| 阴影 | 两层：近影 `0 8·h px 10+12·h px`，远影 `0 46·h px 90·h px`（h = 升起的高度 0–1） | 影子不随高度长，悬浮就不成立 | ★ |
| 卡面清晰度 | 推近前 6 帧叠进一张 4 倍截图的卡面 | 推近后字糊，根因是纹理栅格化的分辨率，不是景深（判例 Q2） | ★ |
| 收尾 | 落地后相机的位置、缩放、角度全部锁死 ≥ 15 帧 | 2.6 → 2.58 一类的尾漂读作抖动；呼吸必须是真静止（判例 R1） | ★ |

**可选：悬停注记**。悬停期间在卡的左侧浮现两行大衬线注记，关键词背后 12 帧长出一道荧光笔色条；注记必须在同一个 3D 空间里、跟同一台相机的透视走，并在卡贴回之前退场。平面叠在屏幕上的字被否过（判例 C3）。

## 声音

模板片的三声：卡弹起前 3 帧一声大 whoosh（第 45 帧），光束开始时一声 sparkle（第 59 帧），贴回时一声短促的 snap（第 122 帧，音源的峰值在它之后几帧）。弹起、光效、落定各有自己的声音（shotcraft 判例 S2、S4）。

## 风格适配

- 结构参数：一张卡、3.3 s 的动作弧、两圈快慢不同的光束、影子随高度、落地后锁死。
- 皮肤参数：聚光灯和光束的颜色（纸墨风是暖白，暗底风格可以用强调色）、卡的材质、圆角。
- 平面风格（`swiss-grid-type`、`isotype`）不做斜视：正视推近，弹起改成放大 6% 加阴影，其余时值不变。
- 需要透视（斜视、升起的 z）时用 HyperFrames 的 CSS 3D 或 Three.js 层；下面的 canvas 草图是正视的近似。

## 实现

```js
// spotlight-hero（正视近似）：找 → 推近 → 弹起悬停 → 光束两圈 → 贴回 → 锁定。斜视和 z 轴要用 CSS 3D 或 Three.js。
const C = { x: 540, y: 450, w: 400, h: 260, r: 18 }, CX = C.x + C.w / 2, CY = C.y + C.h / 2;
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent"), E = lib.bezier;
  const push = E(0.35, 0, 0.2, 1)(lib.seg(f, 32, 48)), z = lib.lerp(0.78, 2.6, push);
  const rise = E(0.2, 1.25, 0.3, 1)(lib.seg(f, 48, 58)), reseat = E(0.4, 0, 0.3, 1.05)(lib.seg(f, 112, 130));
  const lift = rise * (1 - reseat), bob = Math.sin((f - 58) / 40 * lib.TAU) * 4 * lift;
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-lib.lerp(960, CX - 30, push), -lib.lerp(540, CY, push));
  page(ctx, tokens, lib, C);
  if (lift > 0) {                                                      // 空槽：底色补丁 + 强调色细边
    ctx.fillStyle = lib.color(tokens, "bg"); ctx.strokeStyle = lib.rgba(ac, 0.4 * (1 - reseat)); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(C.x, C.y, C.w, C.h, C.r); ctx.fill(); ctx.stroke();
  }
  const s = (1 + 0.06 * lift) * (f >= 126 && f < 130 ? 0.997 : 1);    // 正视里用放大代替 z
  ctx.save(); ctx.translate(CX, CY - bob); ctx.scale(s, s); ctx.translate(-CX, -CY);
  ctx.shadowColor = lib.rgba("#000000", 0.22 * lift); ctx.shadowBlur = 90 * lift; ctx.shadowOffsetY = 46 * lift;
  ctx.fillStyle = lib.mixColor(lib.color(tokens, "bg"), "#ffffff", 0.5); ctx.beginPath(); ctx.roundRect(C.x, C.y, C.w, C.h, C.r); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.fillStyle = ac; ctx.fillRect(C.x + 32, C.y + 36, 220, 16);
  ctx.fillStyle = lib.rgba(fg, 0.3); ctx.fillRect(C.x + 32, C.y + 72, 300, 10); ctx.fillRect(C.x + 32, C.y + 94, 240, 10);
  const lap = (a, b, e, w, k) => {                                     // 光束：沿圆角矩形跑一段 14% 周长的亮弧
    const u = e(lib.seg(f, a, b)); if (f < a - 1 || f > b + 1 || lift < 0.4) return;
    const P = 2 * (C.w + C.h) - (8 - 2 * Math.PI) * C.r;
    ctx.save(); ctx.setLineDash([0.14 * P, P]); ctx.lineDashOffset = -u * P; ctx.lineCap = "round";
    ctx.strokeStyle = lib.rgba(lib.mixColor("#ffffff", ac, 0.25), k); ctx.lineWidth = w;
    ctx.beginPath(); ctx.roundRect(C.x - 3, C.y - 3, C.w + 6, C.h + 6, C.r + 3); ctx.stroke(); ctx.restore();
  };
  lap(60, 74, (u) => u, 5, 1); lap(80, 100, E(0.4, 0, 0.4, 1), 3.5, 0.62);
  ctx.restore(); ctx.restore();
  const on = lib.seg(f, 2, 10), K = [4, 8, 16, 22, 28, 48];            // 聚光：屏幕空间里经过几个中间站落到主角卡上，推近时跟到画面中心
  const hx = 960 + (CX - 960) * 0.78, hy = 540 + (CY - 540) * 0.78;   // 主角卡在全景（0.78 倍）里的屏幕位置；中间站相对它摆，和原 demo 的走位一样
  const px = track(f, K, [hx - 480, hx - 480, hx + 384, hx - 154, hx, 960]), py = track(f, K, [hy - 400, hy - 400, hy - 238, hy - 76, hy, 540]);
  const pulse = f < 36 ? 0.06 * lib.seg(f, 32, 36) : 0.06 * (1 - lib.seg(f, 36, 41));
  const R = track(f, [22, 32, 48], [620, 420, 360]) * (1 + pulse), vig = track(f, [22, 32, 48], [0.16, 0.34, 0.42], (u) => u) * on;
  ctx.save(); ctx.translate(px, py); ctx.scale(1, 0.8);                // 一个椭圆：中心暖光，外圈压暗（超出半径的部分取最后一个颜色）
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, `rgba(255,241,214,${0.42 * on})`); g.addColorStop(0.45, `rgba(255,241,214,${0.1 * on})`); g.addColorStop(1, `rgba(70,56,38,${vig})`);
  ctx.fillStyle = g; ctx.fillRect(-4000, -4000, 8000, 8000); ctx.restore();
  if (f < 8) { ctx.fillStyle = lib.rgba(lib.color(tokens, "bg"), 1 - lib.seg(f, 0, 8)); ctx.fillRect(0, 0, 1920, 1080); }   // 0–8 帧淡入
  function track(k, fs, vs, e = E(0.4, 0, 0.3, 1)) {                  // 分段插值，每段各自缓动（和 Remotion 的 interpolate 一样）
    let i = 0; while (i < fs.length - 2 && k >= fs[i + 1]) i++;
    return lib.lerp(vs[i], vs[i + 1], e(lib.seg(k, fs[i], fs[i + 1])));
  }
}
function page(ctx, tokens, lib, hero) {                                // 灰盒页面：4×3 卡片，主角卡由上面单独画
  const fg = lib.color(tokens, "fg");
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    if (x === hero.x && y === hero.y) continue;
    ctx.fillStyle = lib.rgba(fg, 0.05 + 0.06 * lib.hash(3, i)); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = lib.rgba(fg, 0.35); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(3, i, 1), 16);
  }
}
```

## 已知坑

- **开场放一群卡**：多元素一起跳舞，第一印象立不起来（判例 Q5）。一张卡，一条完整的弧。
- **推近后字糊**：先查纹理的分辨率链（截图倍率 → 栅格化方式 → 缩放方式），最后才动相机和景深。浏览器里放大用 CSS `zoom`（布局级放大）而不是 `transform: scale`，后者先降采样再放大（判例 Q2）。
- **光效群发**：给每张卡都闪一下被否了两次（"不需要每个卡片都闪烁一下"）。光束只给主角、只这一次，而且要裁在圆角里面（判例 Q4）。
- **落地后还在漂**：落地以后相机和卡都要锁死；DOM 文字在亚像素漂移下会闪。
- **太快**：初版几乎总是偏快，锁定到落地短于 3 秒就返工。

## 验收帧

- `peak`（第 66 帧）：卡悬在最高处，光束第一圈跑到一半；卡上的字边缘清楚（裁一块放大看），光没有溢出圆角。
- `settle`（第 136 帧）：卡已贴回槽位，空槽的边已经消失；和第 135 帧逐像素相同（没有尾漂）。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的开场卡 `spotlight-hero-card`、demo `SpotlightHeroCard.tsx` 和它引用的审美判例。文字重写；相机关键帧、聚光站点、光池半径、动作弧的帧数与缓动、光束两圈的参数取原值；平面风格的替代做法和正视的 canvas 近似是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/opening/spotlight-hero-card.md`、`demos/opening/spotlight-hero-card/SpotlightHeroCard.tsx`、`references/aesthetic-rules.md`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
