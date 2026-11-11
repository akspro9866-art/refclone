---
id: diffusion-reveal
name: 噪声成字
one_liner: 整个画面先淹进噪声，一道前沿走过，噪声退去，字一个个长出来；最要紧的字最后落下，一记重音，两帧之内读得清
family: type
role: [open, climax]
intent: [brand-imprint, generate, payoff]
energy: [4, 5]
duration_f: [45, 150]
types: [promo, short, paper]
engines: [canvas, three]
aspect: [landscape, portrait, square]
needs: [text]
sound: recommended
pitfalls: [text-blur, flash-rate, state-leak, overuse]
qa: {peak: 60, read: 67, settle: 120}
status: battle-tested
max_per_film: 1
pairs_with: [thread-through-cuts]
derived_from: []
sketch_sha: "9ea9e23835fa"
---

# 噪声成字 · diffusion-reveal

## 意图

把扩散模型的做法演出来：前向是所有东西一点点被噪声吃掉，反向是噪声一步步退去，字从里面长出来。它既是转场，也是一次揭晓：前面再杂的画面都收进同一片噪声，然后只留下一个名字或一句结论。片子讲 AI、讲生成时，手法本身就有含义；不沾这个话题的片子，它就只是个炫的转场，优先考虑别的。

跟 `decode-type` 的区别：那一式是一行字的乱码逐字锁定，可以在片中反复用小的；这一式占满全屏，全片一次。

## 阶段与时值

下面是草图的帧数，草图的第 66 帧是落点。真片子里噪声段可以更短（一支片头里前向 12 帧、反向 12 帧），规律不变。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 原画面 | 0–36 | 前面的内容 |
| 前向 | 36–48 | 画面分成格子，一格格翻成噪声，直到全屏都是 |
| 反向 | 48–66 | 前沿从右往左走，走过的地方噪声退去；后面的字逐个长出来，每 3 帧一个（第 57、60、63 帧） |
| 雏形 | 58–66 | 最要紧的字在噪声里开始显形，从粗到细，升到约 40% |
| 落下 | 66 | 这个字放大着落下，其余已就位；最多 1 帧全亮 |
| 看清 | 67 起 | 第 2 帧（落下那帧算第 1 帧）起全部读得清 |
| 停留 | 67–150 | 慢推，停到读完 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 噪声格子 | 由粗到细三档，离前沿越近越细（草图 48、24、12 px） | 只有一种大小时读作花屏；离前沿越近越细，才读作"一步步变清楚" | ★ |
| 字的顺序 | 最要紧的字最后落下，不一定按阅读顺序 | 按阅读顺序从左到右，揭晓就没有悬念了 | ★ |
| 字的间隔 | 3 帧一个，正好落在配乐的 16 分音符上（150 bpm） | 再慢就拖了，噪声段不是读字的时候 | |
| 雏形 | 落下前约 8 帧开始显形，到约 40% | 全程纯噪声时，观众以为字已经出齐；显得太早，落下就没劲了 | ★ |
| 落下的放大 | 这个字 1.16 倍收回，其他字 1.04 倍 | 只有它动得多，才看得出是它落下 | |
| 全亮 | 最多 1 帧，衰减很快（`exp(-80·t)`） | 这是全片唯一的闪白时才成立；多了会碰到闪白底线，也盖字 | ★ |
| 字的热色 | 落下时偏白，约 0.3 s 冷到正常色 | 白太久字就融在辉光里，读不清 | |
| 停留 | 字读得清之后至少 2 s | 读时底线之外，名字要让人记住 | |

## 声音

一个字一个音，音高逐级往上，落在字长出来的那一帧；最后一个字是重音和长和弦（比如 A、B、升 C 解决到 D）。爆开之前收住半拍，只留低音和吸气声，重音才显得重。这几个音可以单独存成声音标识，别的片子也能用。

## 风格适配

- 结构参数：前向 → 前沿走过 → 字逐个长出 → 雏形 → 落下 → 停留；格子由粗到细；最要紧的字最后。
- 皮肤参数：噪声的颜色（压暗，亮点要少）、字的材质、辉光。
- 一拍二（12 fps）：噪声每 2 帧换一次，字的间隔取 4 帧。
- 竖屏：字竖排时前沿从下往上走，或把字断成两行，前沿走两遍。

## 实现

```js
// diffusion-reveal：画面 → 12 帧淹进噪声 → 前沿从右往左走，字一个个长出来 → 第一个字最后落下。
// 噪声只由格子和帧号决定，每帧重算，不存状态。
const WORD = "CODE", F_FWD = 36, F_RUN = 48, F_HIT = 66, CY = 640;
const noiseAt = (ctx, lib, x, y, s, ix, iy, f, fg, ac) => {
  const n = lib.hash(ix, iy, s, f);
  ctx.fillStyle = n > 0.992 ? ac : lib.rgba(fg, 0.05 + 0.7 * n ** 5);
  ctx.fillRect(x, y, s - 1, s - 1);
};
function picture(ctx, tokens, lib, f) {     // 灰盒：前面的内容
  const fg = lib.color(tokens, "fg");
  const z = 1 + 0.03 * lib.seg(f, 0, F_RUN);
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -540);
  for (let i = 0; i < 12; i++) {
    const x = 110 + (i % 4) * 430, y = 150 + Math.floor(i / 4) * 280;
    ctx.fillStyle = lib.rgba(fg, 0.08 + 0.1 * lib.hash(3, i)); ctx.fillRect(x, y, 400, 240);
  }
  ctx.restore();
}
function mosaic(ctx, draw, block) {     // 字的雏形：先画小，再放大，不做平滑
  const w = Math.ceil(1920 / block), h = Math.ceil(1080 / block), c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d"); g.scale(1 / block, 1 / block); draw(g);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(c, 0, 0, w * block, h * block); ctx.imageSmoothingEnabled = true;
}
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), fg = lib.color(tokens, "fg"), bg = lib.color(tokens, "bg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1920, 1080);
  lib.setFont(ctx, tokens, "display", 300, { weight: 700 });
  const adv = WORD.split("").map((c) => ctx.measureText(c).width), total = adv.reduce((a, b) => a + b, 0) + 3 * 24;
  let x0 = 960 - total / 2; const left = [], cx = [];
  adv.forEach((w, i) => { left.push(x0); cx.push(x0 + w / 2); x0 += w + 24; });
  const q = f - F_HIT, z = 1 + 0.03 * lib.seg(f, F_HIT, 150);
  const letter = (g, i, k = 1) => { lib.setFont(g, tokens, "display", 300, { weight: 700 }); g.textAlign = "center"; g.fillStyle = fg;
    g.save(); g.translate(960, 540); g.scale(z, z); g.translate(-960, -540); g.translate(cx[i], CY - 110); g.scale(k, k); g.fillText(WORD[i], 0, 110); g.restore(); };
  if (f < F_RUN) {
    picture(ctx, tokens, lib, f);
    if (f >= F_FWD) {
      const fwd = lib.seg(f, F_FWD, F_RUN - 1) ** 1.5;
      for (let iy = 0; iy < 12; iy++) for (let ix = 0; ix < 20; ix++) {
        if (lib.hash(ix, iy, 7) >= fwd) continue;
        ctx.fillStyle = bg; ctx.fillRect(ix * 96, iy * 96, 96, 96);
        for (let b = 0; b < 4; b++) noiseAt(ctx, lib, ix * 96 + (b % 2) * 48, iy * 96 + (b >> 1) * 48, 48, ix * 2 + (b % 2), iy * 2 + (b >> 1), f, fg, ac);
      }
    }
    return;
  }
  if (f < F_HIT) {
    // 前沿：第 57、60、63 帧分别走到第 4、3、2 个字的左边，然后停在第 2 个字左边，等第一个字落下
    const stops = [[F_RUN, 1920], [57, left[3] - 30], [60, left[2] - 30], [63, left[1] - 30]];
    let front = stops[stops.length - 1][1];
    for (let k = 0; k < stops.length - 1; k++) if (f < stops[k + 1][0]) { front = lib.lerp(stops[k][1], stops[k + 1][1], lib.seg(f, stops[k][0], stops[k + 1][0])); break; }
    for (let iy = 0; iy < 23; iy++) for (let ix = 0; ix < 40; ix++) {
      const x = ix * 48, y = iy * 48, d = front - x;
      if (d <= 0) continue;
      const sub = d < 90 ? 4 : d < 200 ? 2 : 1, s = 48 / sub;
      for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) noiseAt(ctx, lib, x + a * s, y + b * s, s, ix * sub + a, iy * sub + b, f, fg, ac);
    }
    for (let i = 1; i < WORD.length; i++) if (cx[i] > front) letter(ctx, i);
    const hint = lib.seg(f, F_HIT - 8, F_HIT);     // 第一个字的雏形：格子由粗到细，升到 40%
    if (hint > 0) { ctx.globalAlpha = 0.42 * hint; mosaic(ctx, (g) => letter(g, 0), hint < 0.4 ? 24 : hint < 0.75 ? 12 : 6); ctx.globalAlpha = 1; }
    return;
  }
  const boom = Math.exp((-q / 30) * 80), s0 = 1 + 0.16 * Math.exp((-q / 30) * 9), s1 = 1 + 0.04 * Math.exp((-q / 30) * 9);
  for (let i = 0; i < WORD.length; i++) letter(ctx, i, i === 0 ? s0 : s1);
  if (boom > 0.01) { ctx.fillStyle = lib.rgba(fg, 0.9 * boom); ctx.fillRect(0, 0, 1920, 1080); }
}
```

草图只演时序和结构：字直接用 `fillText`，落下时的热色和辉光没有画。真片子里可以把字做成距离场，让前沿和雏形都按距离场取样（`engines/canvas-film/README.md` 的"自己写合成"）。

## 已知坑

- **判例**：一支 8 秒的片头（2026-11）。全片的快闪淹进噪声，账号名从噪声里长出来，第一个字最后落下；用户看完粗剪说"行，就这版"，成片通过。
- **字落下后看不清**：全亮衰减慢、白热的字色、辉光和光线四样一起盖字，独立 reviewer 第一轮就提了。全亮压到 1 帧，字的热色和辉光减弱之后，第 2 帧起读得出。
- **第一个字全程是噪声**：观众以为只有三个字。落下前约 8 帧让它显形，到约 40%。
- **噪声不能随手取随机数**：要按格子和帧号算哈希（硬规则 1），乱序渲染才一致；格子的 hash 带上帧号，噪声才每帧都变。
- **噪声吃码率**：这几帧的码率是别处的好几倍。母版 CRF 留余量，上传前用 `bin/vh deliver` 看平台的码率够不够。
- **噪声太亮会闪**：亮的格子多了，整屏明暗会跳，读作闪烁。亮度压到 `n⁵` 这样的分布，亮点只占少数。

## 验收帧

- `peak`（第 60 帧）：两个字已经长出来，前沿在走，左边还是噪声，离前沿越近格子越细；第一个字有雏形，但还读不出。
- `read`（第 67 帧）：落下那帧算第 1 帧，这是第 2 帧，四个字都读得清。
- `settle`（第 120 帧）：字稳定，还有慢推，没有残留的噪声。

## 来源

本仓库原创：手法取自扩散模型的原理（前向加噪、反向去噪），帧数和参数是一支 8 秒片头调出来的。没有参考别家的配方。
