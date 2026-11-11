---
id: gate-as-door
name: 穿门
one_liner: 世界里立着一扇形状对应下一章的门（画框、竖屏、节点），镜头朝门心加速穿过去，门框掠出画面，门里的世界接管
family: seam
role: [seam]
intent: [enter, carry]
energy: [3, 5]
duration_f: [24, 48]
jump: [level, rise]
types: [promo, paper, data]
engines: [three, canvas]
aspect: [landscape, portrait, square]
needs: [3d]
sound: recommended
pitfalls: [seam-mismatch, glow-spill, text-blur]
qa: {seam: 16, settle: 36}
status: tuned
pairs_with: [one-take-world-travel]
impl: [showcase/04-intro-film/js/arch.js, showcase/04-intro-film/js/pipeline.js, showcase/04-intro-film/js/main.js]
derived_from: []
sketch_sha: "be0df33ca6da"
---

# 穿门 · gate-as-door

## 意图

一镜到底的片子里换章节：不切，而是穿过一扇门。门是这个世界里真实存在的物体，它的形状就是下一章的样子：一个 16:9 的画框通向"屏幕里的世界"，一块竖屏通向竖屏短片，一个六边形节点通向这个节点里的内容。观众穿门的那一刻就知道"进去了"。

## 阶段与时值

第 0 帧 = 镜头开始朝门加速。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 瞄准 | 0–14 | 镜头对准门心加速，门从画面的一半长到七成；透过门已经看得见下一章的一部分（它在更深处，长得比门慢） |
| 门亮 | 10–16 | 门框自己的光亮一下再衰减（门的材质发光，不是整画面闪白），落在拍上或拍前 1–2 帧 |
| 穿 | 14–18 | 门框在 4 帧里扫出画面四边；这一刻镜头最快 |
| 接管 | 18–36 | 门里的世界铺满画面并继续长大，镜头在第 24 帧前后越过门所在的平面，然后减速，进入下一章的第一个站点 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 门的形状 | 就是下一章内容的形状（画框、竖屏、节点、环） | 形状和下一章无关，就只是一个转场特效 | ★ |
| 门后的纵深 | 下一章在门后更深的地方，穿门前长得比门慢 | 门里是一张贴在门上的图，穿过去就像穿过一张纸 | ★ |
| 穿门落拍 | 门框离开画面的那几帧落在强拍上（介绍片：光环在 braam 那一小节依次亮起，六边形节点在小节线上穿过） | 穿门和音乐错开，观众感觉不到"进去"那一下 | |
| 穿门速度 | 门框在 4–8 帧里扫出画面（从七成大到超出画面三成） | 更慢像在门口犹豫；更快就只闪过一个框 | |
| 门的光 | 门自己的材质亮起、随后衰减（介绍片的环：亮度 1.1 + 3.2·e^(−t/0.4 s)） | 用整画面闪白代替门的光，会计入闪白的次数，也抢了穿门本身 | |
| 同一方向 | 穿门前后镜头的运动方向一致，穿过去之后继续向前减速 | 穿过去立刻转向，读作两段镜头 | ★ |
| 一串门 | 可以连穿（介绍片 9 个 16:9 的环，间隔 5.6 m，按 32 分音符依次亮） | 连穿 3 个以上时，只有第一个和最后一个落在重拍上，中间的是节奏 | |

## 声音

穿门的那一拍一记重音（冲击或和弦进入）；靠近时一道 riser 或 whoosh 的上升段。门亮的声音可以是一声很短的"上电"。穿门之后配乐进入下一段，不留空拍。

## 风格适配

- 结构参数：门的形状对应下一章、门后有纵深、落拍、方向不变。
- 皮肤参数：门的材质和光（发光的线框、纸框、木门、屏幕边框）、门后世界的样子。
- 2D 风格也能做：门是画面里的一个框，下一章的画面在框里用更慢的缩放长大（下面的草图就是这样做的）；剪纸、手绘风格可以是一个撕开的纸洞。
- 一拍二：穿门的 4–8 帧取整成 2–4 个台阶，门框的扫出仍然要连续，不能跳格。

## 实现

介绍片（`showcase/04-intro-film/`）有几处：v3 在 `js/main.js` 里第 9 小节的 9 个光环（S4 → S5，v5 的正文从第 10 小节开始，看不到这一处）；`js/arch.js` 里 `projects/` 那个可以穿过去的六边形节点（`shape: "portal"`，S5 → S6）；v5 的 `js/pipeline.js` 里三道人工关卡，门里是被审的那份东西（这支片子自己的大纲、分镜联系表、初版联系表），镜头靠近时它铺满门框，穿过之前淡掉。下面是 2D 的草图：用 1/距离算门和门后世界各自的缩放。

```js
// gate-as-door（2D 近似）：镜头 z 从 8 走到 10.4，门在 z=10（距离 1 时正好铺满画面，约第 17 帧），门后的世界在 z=14。
const T0 = 20, GATE = 10, BACK = 14;
export function renderAt(t, ctx, tokens, lib) {
  const k = lib.frame(t) - T0, fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const z = 8 + 2.4 * lib.ease.inOutCubic(lib.seg(k, 0, 36));         // 14–18 帧门框扫出画面，约第 24 帧越过门的平面
  const sB = 4 / (BACK - z);                                           // 门后的世界：更深，长得更慢
  ctx.fillStyle = lib.mixColor(lib.color(tokens, "bg"), "#000000", 0.35); ctx.fillRect(0, 0, 1920, 1080);
  if (z < GATE - 0.02) {
    const sG = 1 / (GATE - z), w = 1920 * sG, h = 1080 * sG;           // 门：1/距离
    ctx.save(); ctx.translate(960, 540); ctx.scale(sG, sG); ctx.translate(-960, -540);                        // 门所在的墙：门四周铺开的一大片
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { ctx.save(); ctx.translate(i * 1920, j * 1080); page(ctx, tokens, lib, 3 + i + 3 * j, 0.35); ctx.restore(); }
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(960 - w / 2, 540 - h / 2, w, h); ctx.clip();
    ctx.translate(960, 540); ctx.scale(sB, sB); ctx.translate(-960, -540); page(ctx, tokens, lib, 9, 1); ctx.restore();
    const glow = 1 + 2 * Math.exp(-Math.max(0, k - 10) / 6) * (k >= 10 ? 1 : 0);   // 门自己的光，第 10 帧亮起再衰减
    ctx.strokeStyle = lib.rgba(ac, Math.min(1, 0.45 * glow)); ctx.lineWidth = 10 * sG; ctx.shadowColor = ac; ctx.shadowBlur = 30 * glow;
    ctx.strokeRect(960 - w / 2, 540 - h / 2, w, h); ctx.shadowBlur = 0;
  } else {
    ctx.save(); ctx.translate(960, 540); ctx.scale(sB, sB); ctx.translate(-960, -540); page(ctx, tokens, lib, 9, 1); ctx.restore();
  }
}
function page(ctx, tokens, lib, seed, a) {                             // 灰盒页面：底 + 4×3 卡片
  const fg = lib.color(tokens, "fg");
  ctx.fillStyle = lib.mixColor(lib.color(tokens, "bg"), "#000000", 1 - a); ctx.fillRect(0, 0, 1920, 1080);
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 300;
    ctx.fillStyle = lib.rgba(fg, (0.05 + 0.06 * lib.hash(seed, i)) * a); ctx.beginPath(); ctx.roundRect(x, y, 400, 260, 18); ctx.fill();
    ctx.fillStyle = i === seed ? lib.color(tokens, "accent") : lib.rgba(fg, 0.4 * a); ctx.fillRect(x + 32, y + 36, 140 + 180 * lib.hash(seed, i, 1), 16);
  }
}
```

## 已知坑

- **门里是贴图**：门后的世界和门一起放大，穿过去像穿过一张纸。门后的东西要在更深处，按自己的距离缩放。
- **门的光变成闪白**：门亮用门自己的材质，亮度不压过画面里的字；整画面闪白另算次数（playbook/08 的底线）。
- **穿门时有字**：穿门的那几帧最快，字都会被抹花；门框上的标签在穿门前就淡出，下一章的字在接管之后再出。
- **穿过去就转向**：方向一变，穿门就读成切换。穿过去之后继续向前，下一次转向留给下一跳。
- **还没有人工判定**：介绍片（showcase 04）v3 的三处穿帧用它；这一版过了两轮独立 reviewer，成片仍待用户本人观看（`showcase/04-intro-film/v3/REVIEW.md` 关卡 ③；v2 的人工意见是"不够炫酷"，这一手法是 v3 为此加的）。有人看过、给了判定，就升 `battle-tested`，把判定记在这里。

## 验收帧

- `seam`（第 16 帧）：门框正在离开画面四边，门里的世界占了画面的大部分；没有必读字。
- `settle`（第 36 帧）：门已经在镜头后面，新的一章铺满画面，镜头停在下一章的起点，方向和穿门前一致。

## 来源

本仓库原创，来自介绍片（`showcase/04-intro-film/`）v3 的三处"穿帧"：竖屏（S2 → S3）、光环（S4 → S5）、`projects/` 六边形（S5 → S6）。`playbook/08-vfx-and-motion-sources.md`"一镜到底"一节把它写成"人工关卡是镜头能飞穿的门"。
