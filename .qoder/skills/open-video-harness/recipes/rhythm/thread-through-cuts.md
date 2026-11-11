---
id: thread-through-cuts
name: 一条线穿过快切
one_liner: 一个亮点拖着一条线从这一闪跑进下一闪，切点都落在它跑动的时候；闪得再快，眼睛也有东西可跟，一串画面读作一条路
family: rhythm
role: [hook, climax]
intent: [accelerate, connect]
energy: 5
duration_f: [90, 170]
types: [promo, short, meme, mv]
engines: [canvas, three]
aspect: [landscape, portrait, square]
needs: [none]
sound: recommended
pitfalls: [uniform-timing, seam-mismatch, flash-rate, overuse]
qa: {peak: 96, settle: 140}
status: battle-tested
max_per_film: 1
pairs_with: [diffusion-reveal]
derived_from: []
sketch_sha: "1a0e304f7995"
---

# 一条线穿过快切 · thread-through-cuts

## 意图

一串内容不同的快闪，单看每一闪都好，连起来却读作混乱：观众不知道该看哪儿，也不知道它们为什么排在一起。这一式给全部画面加一条共同的线：一个亮点拖着尾巴跑，切点落在它跑动的时候，下一闪从它跑到的地方接着跑。观众跟着线走，画面换得再快也读作"一路过来"。

跟 `accelerando-cuts` 的区别：那一式靠同一个主体撑住一串硬切；这一式的每一闪可以是完全不同的东西，撑住它们的是这条线。

## 阶段与时值

下面是草图的 150 帧；真片子的帧数跟着内容和配乐走，规律不变。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 第一闪 | 0–30 | 最长的一闪：观众先认出亮点，知道要跟它 |
| 越切越快 | 30 / 54 / 72 / 84 / 93 / 99 | 每闪 24 → 18 → 12 → 9 → 6 → 6 帧；亮点和尾巴连续穿过每个切点 |
| 落点 | 105–129 | 亮点减速，24 帧内落定 |
| 兑现 · 静止 | 124–150 | 线快停下时，这一串要交代的东西（名字、结论）淡入，停到读完 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 位置连续 | 亮点在切点前后是同一个屏幕位置 | 这是整张配方的命门；跳一下，线就断了，又变回一串碎片 | ★ |
| 每闪时长 | 从 24–27 帧一路缩到 3–6 帧 | 第一闪要够长，让观众认出亮点；3 帧以下眼睛跟不上 | ★ |
| 尾巴长度 | 起手约 0.6 s，随切点变快缩到约 0.3 s | 0.6 s 的尾巴拖过五个 6 帧的闪，会缠成一团；太短又读不出是一条线 | ★ |
| 短闪怎么走 | 9 帧以上的闪，线可以走这一闪自己的路径（沿针、沿弧、沿信号）；6 帧以下的连续几闪，共用一条长曲线 | 短闪各走各的路，线就成了锯齿 | ★ |
| 接上自己的路径 | 从切点的位置出发，约 3 帧追上这一闪的路径（差距按 `exp(-34·t)` 收） | 直接跳到路径起点就断了 | |
| 平滑 | 尾巴的点做一次滑动平均 | 不平滑时，路径的折点在尾巴上都看得见 | |
| 颜色 | 一种强调色，全片只有它是这个颜色 | 画面里别的东西也用这个色，眼睛就找不到线了 | ★ |
| 其他动效 | 速度线、辉光都压在线下面 | 速度线比线还亮时，观众跟的就是速度线 | |

**接缝**：两个时代、两种世界之间最大的那一切，让线的形状接上下一闪的形状（弧线接上圆边、直线接上走线）。这一下不用解释，观众自己会看懂两边是一回事。

## 声音

每个切点一声，切点放在配乐的网格上（150 bpm 时 1 拍 12 帧，16 分音符 3 帧，这张配方的帧数都能落格）。音高一路往上。落点一记重音，之前留半拍空，让它显得更重。没有配乐时，一串越来越密的 tick 加最后一记 impact 也成立。

## 风格适配

- 结构参数：位置连续、每闪时长的缩短规律、尾巴随速度变短、落点之后的 hold。
- 皮肤参数：线和亮点的颜色、粗细、发不发光；浅色纸面上用暗一点的芯，不要靠叠加发光，否则纸会烧白。
- 一拍二（12 fps）：切点取整到偶数帧，最短一闪取 4 帧；亮点仍然每帧算位置。
- 竖屏：路径放在竖屏的关键内容框里（playbook/03 §5），上下移动为主。

## 实现

```js
// thread-through-cuts：7 闪越切越短，再落到一处；亮点走一条连续的样条，切点落在它跑动的时候。尾巴按 f 往回取，不存状态。
const CUTS = [0, 30, 54, 72, 84, 93, 99, 105, 150];
const PTS = [[200, 880], [640, 260], [1320, 760], [1660, 260], [1120, 180], [500, 520], [980, 900], [1500, 640], [960, 760]];
const cr = (a, b, c, d, u) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
function head(f, lib) {
  f = Math.max(0, Math.min(f, 149));
  let i = 0; while (i < CUTS.length - 2 && f >= CUTS[i + 1]) i++;
  let u = lib.seg(f, CUTS[i], CUTS[i + 1]);
  if (i === CUTS.length - 2) u = 1 - (1 - lib.seg(f, CUTS[i], CUTS[i] + 24)) ** 3;   // 最后一段：24 帧内减速落定
  const p = (k) => PTS[Math.max(0, Math.min(PTS.length - 1, k))];
  return [0, 1].map((a) => cr(p(i - 1)[a], p(i)[a], p(i + 1)[a], p(i + 2)[a], u));
}
function flash(ctx, tokens, lib, i, f) {     // 灰盒：每闪一种结构，让切点看得出来
  const fg = lib.color(tokens, "fg"), bg = lib.color(tokens, "bg");
  ctx.fillStyle = i % 2 ? bg : lib.mixColor(bg, fg, 0.08); ctx.fillRect(0, 0, 1920, 1080);
  const z = 1 + 0.08 * lib.seg(f, CUTS[i], CUTS[i + 1]);
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -540);
  ctx.strokeStyle = ctx.fillStyle = lib.rgba(fg, 0.22); ctx.lineWidth = 3;
  const kind = i % 4;
  if (kind === 0) for (let k = 0; k < 15; k++) { ctx.fillRect(140 * k, 0, 3, 1080); ctx.fillRect(0, 90 * k, 1920, 3); }
  if (kind === 1) for (let k = 1; k < 9; k++) { ctx.beginPath(); ctx.arc(960, 540, 66 * k, 0, 6.3); ctx.stroke(); }
  if (kind === 2) for (let k = 0; k < 11; k++) ctx.fillRect(200 + 145 * k, 800 - 620 * lib.hash(i, k), 90, 620 * lib.hash(i, k));
  if (kind === 3) for (let k = 0; k < 60; k++) { ctx.beginPath(); ctx.arc(1920 * lib.hash(i, k, 1), 1080 * lib.hash(i, k, 2), 8 + 26 * lib.hash(i, k, 3), 0, 6.3); ctx.fill(); }
  ctx.restore();
}
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), ac = lib.color(tokens, "accent"), fg = lib.color(tokens, "fg");
  let i = 0; while (i < CUTS.length - 2 && f >= CUTS[i + 1]) i++;
  if (i < CUTS.length - 2) flash(ctx, tokens, lib, i, f);
  else { ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080); }
  const L = lib.lerp(18, 9, lib.seg(f, 30, 105)), N = 48;   // 尾巴长度（帧）：起手 0.6 s，后来 0.3 s
  ctx.lineCap = "round"; ctx.strokeStyle = ac;
  for (let k = N; k > 0; k--) {
    const a = head(f - (L * k) / N, lib), b = head(f - (L * (k - 1)) / N, lib), u = 1 - k / N;
    ctx.globalAlpha = u; ctx.lineWidth = 2 + 8 * u;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const [x, y] = head(f, lib);
  ctx.fillStyle = lib.rgba(ac, 0.25); ctx.beginPath(); ctx.arc(x, y, 34, 0, 6.3); ctx.fill();
  ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(x, y, 12, 0, 6.3); ctx.fill();
  const r = lib.seg(f, 124, 134);     // 落点之后，这一串要交代的东西出现
  if (r > 0) {
    lib.setFont(ctx, tokens, "display", 150, { weight: 700 });
    ctx.fillStyle = lib.rgba(fg, r); ctx.textAlign = "center";
    ctx.fillText("THE LINE LANDS", 960, 600 + 14 * (1 - r));
  }
}
```

草图走的是一条样条。真片子里长一些的闪可以走自己的路径，见"参数"。亮点的位置都按 `t` 算，尾巴是往回取的同一个函数，乱序渲染结果不变；要是把位置存进数组一帧帧累加，就破了硬规则 1。

## 已知坑

- **判例**：一支 8 秒的片头（2026-11，切点 16 个）。第一版 15 闪没有贯穿的东西，用户看完说单独每个分镜都还可以，但整体放一起的顺序没看懂、有点混乱；加上这条线、让它穿过每个切点之后，用户说"行，就这版"，成片通过。
- **缠成一团**：尾巴不随切点变短，线在几个短闪里来回折，像一团乱麻。尾巴从 0.6 s 缩到 0.3 s，短闪共用一条长曲线之后才干净。
- **折线**：直接连路径上的点，折角都看得见。尾巴的点做一次滑动平均。
- **线被盖掉**：速度线的亮度起初比线还高，观众跟错了东西。其他动效压低，让线始终是画面里最亮的动的东西。
- **纸面烧白**：亮的线和辉光叠在浅色底上，把纸烧成一片白。浅底上用暗一点的芯，减少发光。
- **闪得太狠**：相邻几闪明暗差太大会连成闪烁，碰到"全屏闪白每秒不超过 3 次"的底线。切完跑一次 `bin/vh check` 看 `cuts:` 那一行。

## 验收帧

- `peak`（第 96 帧）：一个 6 帧的短闪中间。尾巴从上一闪的位置拖过来，线是连续的；把切点前后两帧叠起来看，亮点的位置接得上。
- `settle`（第 140 帧）：线已经停下，要交代的东西读得清，这一帧画面里没有别的东西在抢。

## 来源

本仓库原创：从一支 8 秒片头的粗剪和成片里总结出来。一条线串起快切这个想法在片头和预告片里很常见，这里没有参考哪一支片子或哪一张别家的配方，帧数和参数都是那支片子调出来的。
