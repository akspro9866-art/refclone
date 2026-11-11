---
id: edited-plate-lapse
name: 一张底图编辑出几版再做延时
one_liner: 同一张图编辑出白天、去掉物体的几版，几乎逐像素对齐；昼夜靠版与版交叉淡化，物体抠成一层从遮挡后面升起，图不扭曲；满高时合成就是原图，无缝接下一镜
family: fx
role: [hook, open]
intent: [process, transform]
energy: [2, 4]
duration_f: [90, 240]
types: [short, promo, paper, data]
engines: [canvas]
aspect: [landscape, portrait, square]
needs: [photo]
sound: recommended
pitfalls: [flash-rate, state-leak, no-hold]
qa: {peak: 90, settle: 200}
status: battle-tested
derived_from: []
---

# 一张底图编辑出几版再做延时 · edited-plate-lapse

## 意图

把很长的时间压进几秒，让观众第一眼就看到"过了很久"：一张书桌，窗外昼夜转了几轮，纸堆从薄薄一层长到很高。画面从第一帧就在动，不用给旁白添一个字。代价是素材：要几张彼此对得上的图，所以从一张定好的底图编辑出来，不各生成各的。

## 阶段与时值

下面是一支片子开头的时值，一共约 7 s，能量和长度按片子调。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 转昼夜 | 0–119 | 白天版淡入淡出 4 轮，越转越快；物体层跟着升起，升得越来越慢也行 |
| 落定 | 119–216 | 回到底图的光，物体层接着升到满高；旁白念到要点时计数这类读数落定 |
| 交接 | 216 起 | 合成和原图逐像素相同，换回原图，接下一镜或开始推镜 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 昼夜曲线 | `0.5 - 0.5 * cos(2π * 轮数 * (t / T) ^ 1.3)`，4 轮、T ≈ 4 s | 指数大于 1 就是越转越快；最快的一轮约 0.8 s，离"每秒 3 次闪白"的底线很远 | |
| 物体层位移 | 只平移，从满高往下藏，起点约露 10% | 从零开始头几帧什么都看不到；只平移，顶面和纹理始终是对的 | ★ |
| 遮挡线 | 一条手画的多边形，贴着遮挡物的上沿（桌面后沿） | 物体从它后面升起，这条线藏住了层的下沿；没有遮挡物，这个做法就不成立 | ★ |
| 差值阈值 | 高斯 σ 1 之后，通道最大差 > 18（0–255） | 低了把噪点和光影差算进物体，高了啃掉物体的暗部；多边形限定范围，取最大连通块 | |
| 补丁层 | 物体升起时淡入，透明度用 `s * s`（`s` 是升起的比例） | 编辑版改到的物体周围（影子、墙面）靠它在满高时回到原图 | ★ |

## 声音

昼夜轮转下面铺一层有机的底，每轮一次轻微的起伏就够，不逐轮打点（越转越快时打点会连成一串）。落定那一帧配一个实的声音（压纸、盖章这类拟音），和读数同一帧。旁白已定稿时，这段不需要声音之外的说明。静音时靠物体升高和窗外明暗也读得懂。

## 风格适配

- 结构参数（跟配方走）：底图和几版编辑版逐像素对齐；物体只平移；满高时等于原图。
- 皮肤参数（跟风格走）：画风、昼夜的色调、颗粒。
- 手绘或矢量风格的底图不用这张配方：直接把层分开画。这张配方解决的是生成图没有分层的问题。

## 实现

**1. 编辑出几版**：先定底图（夜景版），其余都从它编辑，每次只改一样东西，提示词开头把不变的说死。走 Codex 时用 `bin/vh image gen <项目> --provider codex --ref <底图> --prompt-file <提示词>` 把图带上：图放进 `assets/genimg/<id>/`，模型、提示词和参考图自动记进 `assets/ledger.json`，不用再手动登记。

```text
Edit this photograph. Keep it exactly the same picture: the same camera, framing, perspective and scale,
every object in exactly the same place at exactly the same size: {列出画面里的东西}.
Change ONE thing only: {现在是正午 / 去掉桌子左边那摞纸；那里露出空桌面，后面的墙接上}.
Do not move, resize, redraw or restyle anything else. No text, no letters, no numbers, no logos, no watermark.
```

要四张：底图、白天版、底图去物体、白天版去物体（从白天版编辑）。

**2. 抠层**（Pillow、numpy、scipy，一次性脚本放项目 `tools/`）：

```python
d = gaussian_filter(np.abs(full - clean).max(axis=2), 1.0)
m = (d > 18) & poly_mask            # 手画的多边形框住物体，挡住别处的差异
m = binary_fill_holes(binary_closing(m, iterations=5)); m = largest_component(binary_opening(m, iterations=2))
alpha = np.clip(gaussian_filter(m.astype(float), 1.0) * 1.2 - 0.1, 0, 1)      # 物体层：原图的像素 + 这个 alpha
changed = binary_dilation(gaussian_filter(np.abs(full - clean).max(axis=2), 2.0) > 10, iterations=8) & box
feather = np.clip(gaussian_filter(changed.astype(float), 8) * 1.4, 0, 1)
base = full * (1 - feather[..., None]) + clean * feather[..., None]            # 去物体版：只有改到的地方用编辑版
patch = np.dstack([full, feather * (1 - alpha) * 255])                         # 补丁层：改到的地方的原图
```

`base` 这一步最要紧：编辑版在别处也会有细微变化，这样处理之后，框外的像素就是原图，交接时才对得上。

**3. 合成**（2D canvas，每帧按 t 算，不存状态）：

```js
function lapse(t, X, IMG) {   // 坐标按底图；要推镜时整体套一个变换
  const m = dayAmount(t), s = rise(t);                      // 都是 t 的函数
  X.drawImage(IMG.nightBase, 0, 0, W, H);
  blend(X, IMG.dayBase, m);
  blend(X, IMG.nightPatch, s * s); blend(X, IMG.dayPatch, s * s * m);
  X.save(); clipPolygon(X, HIDE);                           // 遮挡线以上才画
  const dy = (1 - s) * RISE;                                // 只平移
  X.drawImage(IMG.nightObject, 0, dy, W, H);
  blend(X, IMG.dayObject, m, dy);
  X.restore();
}
```

## 已知坑

- **判例**：一支 33 分钟旁白片的开头（2026-11）。旁白已定稿，开头原来是一个慢推，人看了整片，觉得开头几秒没有抓人的东西。换成这个做法，第 1 帧就在动，前 4 秒就有事发生，旁白一个字没改；人看过开头这段的样片后放行。
- **图不扭曲是取舍，不是洁癖**：想让纸堆"长高"，最直接的是竖向拉伸或网格变形，可纸张的边、标签的高度和透视会跟着一起变形，几帧之内就看得出是一张被拉的图。整层平移牺牲的是真实生长：顶面从头到尾是同一张，升起时不会多出新的纸。观众的眼睛在飞来的稿纸和昼夜上，这个代价看不出来。要真的一张张加厚，就得 3D 或分层重画。
- **飞入的东西接上顶面**：物体层只是平移，顶面的位置要算出来（满高时顶面的多边形加上当前的 `dy`），飞来的东西落在那里，才不会悬空。
- **交叉淡化中途有重影**：编辑版偶尔错开几个像素，白天和夜晚各一半的那一帧能看出来。查 `m = 0.5` 那一帧的 crop；只有个别地方错开时重新编辑一次，比事后配准省事。
- **光是淡出来的**：影子不会真的走，只是两版之间淡入淡出。转得快的时候看不出来；放慢到单轮两三秒以上就露馅，所以这个做法只给快的延时。
- **闪**：昼夜版亮度差很大、又转得很快时会碰到"全屏闪白每秒不超过 3 次"的底线。白天版不用太亮，切完跑 `bin/vh check` 看 `cuts:` 那一行。
- **事实**：这是编辑出来的图，假设场景要写明（"假设你……"），计数这类读数也要在 NOTES 里写清是算术，AI 生成内容照常声明。

## 验收帧

- `peak`（第 90 帧）：白天和黑夜转得最快的一段，物体层升到一半，看下沿藏在遮挡线后面，上沿和顶面干净。
- `settle`（第 200 帧）：物体接近满高。把满高那一帧和原图比（`ffmpeg -lavfi psnr`，或直接相减），差异只应该是颗粒这类后面加上的东西。

## 来源

本仓库原创：从一支片子（2026-11）开头的做法总结出来，帧数和阈值都是那支片子调出来的，换一张图要重新看差值和遮挡线。
