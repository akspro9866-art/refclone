---
id: group-photo-launch
name: 发布会合影
one_liner: 每个展示过的功能派一个代表元素，从四面八方飞来围成合影，字标最后压印落款，全片能量最高
family: outro
role: [outro, climax]
intent: [sign-off, payoff]
energy: 5
duration_f: [150, 180]
types: [promo, short]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [ui-element, logo]
sound: recommended
pitfalls: [no-hold, copy-drift, glow-spill, too-fast]
qa: {peak: 34, read: 80, settle: 120}
status: upstream-tested
max_per_film: 1
pairs_with: [brand-imprint-open]
derived_from:
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: references/shots/outro/outro-group-photo-launch.md, license: Apache-2.0, note: 合影结构、判例、固定的收尾声音句式}
  - {repo: github.com/Vincentwei1021/video-shotcraft, commit: "e2d8928", path: demos/outro/outro-group-photo-launch/OutroGroupPhotoLaunch.tsx, license: Apache-2.0, note: 飞入、退后排、crane、氛围三件套、字标}
sketch_sha: "6824e0f18a46"
---

# 发布会合影 · group-photo-launch

## 意图

收场时，前面出现过的每个功能都派一个代表回到画面，围着字标站成一张合影。观众最后带走的印象是：这些都是同一个产品的东西。排场要像发布会，全片的能量在这里到顶。

## 阶段与时值

第 0 帧 = 收尾镜头第一帧。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 入场氛围 | 0–40 | 背景页面 24 帧内虚化成景深；一道光带从左扫到右（2–14 帧）；整层 crane 落下：绕 X 轴 4° → 0、缩放 1.06 → 1，`bezier(0.3,0,0.2,1)` |
| 四方飞入 | 4–40 | 9 个代表元素依次飞入：第 i 个在 4 + 3i 帧出发，12 帧到位，`bezier(0.34,1.4,0.44,1)`（约 5% 过冲）；飞行中旋转从 2 倍收到原角度（±5° 以内）、缩放 1.12 → 1；落地那一刻一团强调色光 6 帧淡掉 |
| 退后排 | 42–50 | 字标要登场，所有元素透明度降 12%、饱和度降 8%，给主角让位 |
| 字标压印 | 42–79 | 第 i 个字在 42 + 1.8i 帧开始，8 帧到位（上移 28 px → 0、缩放 1.35 → 1）；字标背后的舞台光 42 → 50 → 58 帧：0 → 0.5 → 0.25 |
| 收线 | 58–80 | 强调色短线 58–70 长出，两端各射出一条 190 px 的细延长线（58–66）后淡去；标语 68–80 淡入 |
| 落款停留 | 80 起 | 整组停到读完（这里 75 帧），镜头保持极慢的推近（+3.5%）；片尾最后 12 帧淡出 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 代表元素 | 每个展示过的功能都有一个，一个不少 | 缺谁观众都会察觉（判例 Q8 的自检项） | ★ |
| 结构先于特效 | 先有"四方飞入围住字标"的骨架，再加 crane、舞台光、金尘 | 直接堆特效没有骨架 | ★ |
| 飞入 | 出发间隔 3 帧，飞 12 帧，起点偏移 360–500 px，后到的叠在上面 | 同时到读作爆炸；间隔再大就成了逐个展示 | |
| 过冲 | `bezier(0.34,1.4,0.44,1)`，约 5% | 原代码注释的教训：旧曲线的 y 从没超过 1，落地没有弹；这里 5% 也是本仓库卡片档弹簧的上限 | ★ |
| 退后排 | 字标登场时配角整体降 12% 透明度、8% 饱和度 | 配角不让位，字标压不住 9 个元素 | |
| crane | 只有 4°，40 帧落下，之后缓推 3.5% | 幅度就这么小已经读作"落机位"，大了会晕（原卡的推测） | |
| 氛围三件套 | 光带（600 px 宽，峰值 0.12）、舞台光、金尘 20 颗（2–3 px、透明度 0.15–0.35、全部由序号推出） | 金尘超过 30 颗开始像下雪（原卡的推测）；粒子参数必须确定 | |
| 落款停留 | 从标语完整算起，取 max(1 s, 读时规则) | 判例 R1 要满 1 秒；本仓库的读时规则更严（TASTE_CHECKLIST #5） | ★ |
| 干净 | 收尾不加解说字幕；标语和前面的字卡不重复 | 判例 C1 的例外项、P4 的去重 | |

## 声音

固定的三拍句式，模板片定稿后唯一没改过的一段：riser 铺在飞入组装下面（第 5 帧起），一记 impact 钉在字标压印（第 40 帧，全片最响），sparkle 点在短线长出（第 65 帧）。riser 要在 impact 之前收住，不能和 impact 叠成一团。

## 风格适配

- 结构参数：每个功能一个代表、四方飞入、退后排、字标最后到、停到读完、三拍声音句式。
- 皮肤参数：代表元素的样子（真实截图切片、风格化的图标）、光和尘的颜色、字标的字体。
- 安静的风格（`ink-wash`、`archival-pan-zoom`）不要硬上发布会：保留合影结构，去掉光带和金尘，飞入改成慢慢聚拢，能量降到 3–4。
- 字距呼吸（字标落定后字距放开一点点）只在 canvas 里做；DOM 里不动画 `letter-spacing`（playbook/03 §4）。

## 实现

```js
// group-photo-launch：背景虚化 + crane → 9 个代表元素四方飞入 → 退后排 → 字标压印 + 舞台光 → 短线、标语 → 停到读完。
const MARK = "Frame Lab", TAG = "EVERY FRAME IS CODE";
const ELS = [[960, 84, 1180, 40, 0, 0, -120], [300, 400, 260, 220, -5, -500, 0], [1630, 380, 240, 200, 4, 500, 0],
  [1460, 740, 540, 110, -3, 450, 260], [260, 800, 220, 190, 3, -400, 300], [620, 930, 520, 108, 2, 0, 320],
  [760, 180, 560, 36, -1.5, 0, -240], [1560, 950, 280, 50, -2, 380, 0], [1620, 170, 550, 44, 2.5, 360, -200]];   // cx, cy, w, h, 角度, 起点偏移
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent"), bg = lib.color(tokens, "bg"), E = lib.bezier;
  const crane = E(0.3, 0, 0.2, 1)(lib.seg(f, 0, 40)), cam = 1.06 - 0.06 * crane + 0.035 * lib.seg(f, 40, 180);
  const recede = lib.seg(f, 42, 50), OUT = 80 + 75;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  ctx.save(); ctx.globalAlpha = 1 - lib.seg(f, OUT, OUT + 12);
  ctx.save(); ctx.translate(960, 486); ctx.scale(cam, cam * (1 - 0.02 * (1 - crane))); ctx.translate(-960, -486);   // 平面近似：4° 俯仰用纵向压缩代替
  ctx.save(); ctx.filter = `blur(${14 * E(0.4, 0, 0.4, 1)(lib.seg(f, 0, 24))}px)`; ctx.globalAlpha *= 0.5;
  for (let i = 0; i < 12; i++) { ctx.fillStyle = lib.rgba(fg, 0.1); ctx.fillRect(110 + (i % 4) * 430, 150 + Math.floor(i / 4) * 300, 400, 260); }
  ctx.restore();
  ELS.forEach(([cx, cy, w, h, rot, dx, dy], i) => {
    const c = 4 + 3 * i; if (f < c) return;
    const u = E(0.34, 1.4, 0.44, 1)(lib.seg(f, c, c + 12)), air = Math.max(0, 1 - u);
    ctx.save(); ctx.globalAlpha *= lib.seg(f, c, c + 3) * (1 - 0.12 * recede);
    ctx.translate(cx + dx * (1 - u), cy + dy * (1 - u)); ctx.rotate(rot * (2 - u) * Math.PI / 180); ctx.scale(1.12 - 0.12 * u, 1.12 - 0.12 * u);
    ctx.shadowColor = lib.rgba("#1e1912", 0.16 + 0.1 * air); ctx.shadowBlur = 24 + 46 * air; ctx.shadowOffsetY = 10 + 26 * air;
    ctx.fillStyle = lib.mixColor(bg, "#ffffff", 0.7); ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 12); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.fillStyle = lib.rgba(fg, 0.3); ctx.fillRect(-w / 2 + 20, -h / 2 + Math.min(20, h / 3), w * 0.5, Math.min(14, h / 4));
    ctx.restore();
    const glow = 0.35 * (1 - lib.seg(f, c + 12, c + 18));                // 落地光：6 帧，只在落地这一次
    if (f >= c + 12 && glow > 0) { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
      g.addColorStop(0, lib.rgba(ac, glow)); g.addColorStop(0.7, lib.rgba(ac, 0)); ctx.fillStyle = g; ctx.fillRect(cx - w / 2, cy - w / 2, w, w); }
  });
  ctx.restore();
  const stage = f < 50 ? 0.5 * lib.seg(f, 42, 50) : 0.5 - 0.25 * lib.seg(f, 50, 58);
  const sg = ctx.createRadialGradient(960, 470, 0, 960, 470, 700); sg.addColorStop(0, lib.rgba("#fff6e4", 0.95 * stage)); sg.addColorStop(0.75, lib.rgba("#fff6e4", 0));
  ctx.fillStyle = sg; ctx.fillRect(0, 0, 1920, 1080);
  lib.setFont(ctx, tokens, "display", 148, { weight: 600 }); ctx.fillStyle = fg;
  lib.drawGlyphs(ctx, lib.layoutText(ctx, MARK, { x: 960, y: 530, align: "center" }), (g, i) => {
    const u = E(0.2, 0.75, 0.3, 1)(lib.seg(f, Math.round(42 + 1.8 * i), Math.round(42 + 1.8 * i) + 8));
    return { alpha: u, dy: 28 * (1 - u), scale: 1.35 - 0.35 * u };
  });
  const rule = 260 * E(0.3, 0, 0.2, 1)(lib.seg(f, 58, 70)), ext = 190 * lib.seg(f, 58, 66) * (1 - lib.seg(f, 66, 72));
  ctx.fillStyle = ac; ctx.fillRect(960 - rule / 2, 580, rule, 6); ctx.fillRect(830 - ext, 582, ext, 1.5); ctx.fillRect(1090, 582, ext, 1.5);
  lib.setFont(ctx, tokens, "mono", 44); ctx.fillStyle = lib.rgba(fg, 0.7 * lib.seg(f, 68, 80));
  lib.drawText(ctx, TAG, 960, 660, { align: "center", tracking: 5 });
  for (let i = 0; i < 20; i++) {                                         // 金尘：20 颗，参数全由序号推出
    const y = (((i * 613 + 271) % 1080 - f * (0.3 + (i % 5) * 0.11)) % 1080 + 1080) % 1080;
    const x = (i * 439 + 137) % 1920 + Math.sin(f * (0.022 + (i % 3) * 0.008) + i * 0.83) * (9 + (i % 4) * 5);
    ctx.fillStyle = lib.rgba(lib.mixColor(ac, "#ffd98a", 0.6), 0.15 + ((i * 7) % 5) * 0.05); ctx.fillRect(x, y, 2 + (i % 3) * 0.5, 2 + (i % 3) * 0.5);
  }
  const sw = lib.bezier(0.4, 0, 0.6, 1)(lib.seg(f, 2, 14)) * 2720 - 700, so = f < 5 ? 0.12 * lib.seg(f, 2, 5) : 0.12 * (1 - lib.seg(f, 11, 14));
  if (so > 0) { const lg = ctx.createLinearGradient(sw - 300, 0, sw + 300, 0);
    lg.addColorStop(0, "rgba(255,244,224,0)"); lg.addColorStop(0.5, `rgba(255,244,224,${so})`); lg.addColorStop(1, "rgba(255,244,224,0)"); ctx.fillStyle = lg; ctx.fillRect(sw - 300, 0, 600, 1080); }
  ctx.restore();
}
```

草图用放大和一点纵向压缩近似 crane 的 4° 俯仰；要真的俯仰，用 CSS 3D（`perspective(1400px) rotateX(…)`）或 Three.js。代表元素在正式片里是各功能镜头里出现过的真实元素切片。

## 已知坑

- **收尾偏保守**：初版几乎总是"安静地签个名"，用户要的是发布会（判例 Q8：签名 → 合影 → 发布会，三次加码）。起稿就按发布会的规格给足。
- **漏了功能**：合影里少了某个已经展示过的功能，观众会察觉。对着功能清单逐个点名。
- **光效溢出**：落地光要短（6 帧）、只在落地时出现一次，而且不能比元素本身亮；光溢出圆角是廉价感的典型来源（判例 Q4）。
- **标语重复**：同一句话全片只出现一次；和前面字卡撞了，删一个（判例 P4）。
- **停得不够**：落款停不满，观众记不住名字。按读时规则算，最后再淡出。

## 验收帧

- `peak`（第 34 帧）：9 个元素里大部分已经到位，最后一个在空中；每个功能都有代表，互相不遮住关键部分。
- `read`（第 80 帧）：字标、短线、标语都已完整；配角已经退后一层，字标是画面里最亮、最清楚的东西。
- `settle`（第 120 帧）：停留中，只有极慢的推近和金尘在动；字的边缘清楚。

## 来源

改写自 video-shotcraft（Vincent Wei，Apache-2.0）的收尾卡 `outro-group-photo-launch` 和 demo `OutroGroupPhotoLaunch.tsx`。文字重写；飞入、退后排、crane、光带、舞台光、金尘、字标压印和短线的帧数与缓动取原值；落款停留改成本仓库的读时规则，标语字号提到 44 px，安静风格的降级做法是本仓库补的。

**许可**：本文件修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 在 commit `e2d8928` 时的 `references/shots/outro/outro-group-photo-launch.md`、`demos/outro/outro-group-photo-launch/OutroGroupPhotoLaunch.tsx`（Copyright 2026 Wei Yihao，Apache-2.0），改了什么见上一段。来自上游的部分仍按 Apache-2.0 授权，许可全文见 [`LICENSES/Apache-2.0-video-shotcraft.txt`](../LICENSES/Apache-2.0-video-shotcraft.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
