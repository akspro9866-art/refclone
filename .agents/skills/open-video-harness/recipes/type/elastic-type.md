---
id: elastic-type
name: 字母站在同一条基线上拉伸
one_liner: 一个词的每个字母站在锁死的基线上拉高变窄，从中间的字母开始往两边传，中间那个最高、最窄、是唯一的强调色，旁边一个读数从 wdth 100 数到 62
family: type
role: [hook, open]
intent: [enter, hook]
energy: 4
duration_f: [60, 150]
types: [promo, short, mv]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [text]
sound: optional
pitfalls: [text-blur, uniform-timing]
qa: {peak: 39, settle: 72}
status: tuned
pairs_with: [breath-title-card]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 10 Elastic type 的结构和时序}
sketch_sha: "c0ccacdf62ce"
---

# 字母站在同一条基线上拉伸 · elastic-type

## 意图

活动、直播、播客的开场标题卡：一个词被"拉"起来，像捏着中间那个字母往上提。基线从头到尾不动，字母同时变高变窄，所以这个词始终是一个词；中间那个字母是唯一的强调色，眼睛有一个落点。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–9 | 词静静站在一条标着"baseline"的线上，下面一个小号的同词虚影 |
| 拉伸 | 9–66 | 从中间的字母开始往两边传，每往外一对晚 4–5 帧；中间那个在 1.3 s 到顶，最外面一对在 2.2 s 到位；顶点依次往外递减 |
| 讲解 | 9–39 | 中间字母顶上一个方块把手和光标，一条虚线量出它升了多少，读数从 wdth 100 数到 62 |
| 停留 | 66–150 | 峰形停住，中间那个字母轻轻呼吸（高度 ±2.5%） |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 基线锁死 | 所有字母的底边在同一条线上 | 底边一飘，词就散了 | ★ |
| 高和宽一起变 | 拉高时变窄（中间约 2 倍高、0.62 倍宽） | 只拉高不变窄，像被拉伸的位图 | ★ |
| 从中间往外传 | 每对晚 4–5 帧 | 一起拉像缩放 | |
| 读数 | 可选 | 讲"可变字体"时留着 | |

## 声音

拉伸时一声往上滑的音（滑音或弦乐上行），到顶时停；静音也成立。

## 风格适配

- 结构参数：锁死的基线、从中间往外传、高窄同变、唯一的强调字母。
- 皮肤参数：字体（可变字体的 `wdth` 轴最好）、颜色、读数的样子。
- 量化风格：拉伸按一拍二走，峰形不变。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const muted = lib.mixColor(fg, bg, 0.5);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const word = [..."STRETCH"], mid = 3, BY = 760, size = 260;
  lib.setFont(ctx, tokens, "display", size, { weight: 800 });
  const adv = word.map((ch) => ctx.measureText(ch).width);
  const breathe = t > 2.2 ? 1 + 0.025 * Math.sin(lib.TAU * (t - 2.2) / 1.6) : 1;
  const st = word.map((_, i) => {   // from the middle letter outwards, each pair a beat later
    const d = Math.abs(i - mid), p = lib.ease.inOutCubic(lib.seg(t, 0.3 + d * 0.15, 1.3 + d * 0.3));
    return { p, sy: lib.lerp(1, 2.0 - 0.25 * d, p) * (d === 0 ? breathe : 1), sx: lib.lerp(1, 0.62 + 0.38 * d / 3, p) };
  });
  const total = adv.reduce((s, a, i) => s + a * st[i].sx, 0);
  ctx.strokeStyle = muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(240, BY); ctx.lineTo(W - 240, BY); ctx.stroke();   // the locked baseline
  lib.setFont(ctx, tokens, "mono", 26); ctx.fillStyle = muted; ctx.fillText("baseline", 240, BY + 44);
  let x = W / 2 - total / 2; const tops = [];
  word.forEach((ch, i) => {
    const { sx, sy } = st[i];
    ctx.save(); ctx.translate(x, BY); ctx.scale(sx, sy);
    lib.setFont(ctx, tokens, "display", size, { weight: 800 }); ctx.fillStyle = i === mid ? ac : fg; ctx.fillText(ch, 0, 0); ctx.restore();
    tops.push([x + adv[i] * sx / 2, BY - size * 0.72 * sy]); x += adv[i] * sx;
  });
  const [hx, hy] = tops[mid], y0 = BY - size * 0.72, pm = st[mid].p;
  if (pm > 0) {   // the handle on the middle letter, and how far it moved
    ctx.save(); ctx.setLineDash([8, 8]); ctx.strokeStyle = ac; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx + 110, y0); ctx.lineTo(hx + 110, hy); ctx.stroke(); ctx.restore();
    ctx.fillStyle = bg; ctx.strokeStyle = ac; ctx.lineWidth = 3; ctx.fillRect(hx - 11, hy - 11, 22, 22); ctx.strokeRect(hx - 11, hy - 11, 22, 22);
    const cx = hx + 8, cy = hy + 8; ctx.fillStyle = fg; ctx.strokeStyle = bg; ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 48); ctx.lineTo(cx + 13, cy + 36); ctx.lineTo(cx + 22, cy + 55); ctx.lineTo(cx + 30, cy + 51); ctx.lineTo(cx + 21, cy + 33); ctx.lineTo(cx + 36, cy + 33); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  lib.setFont(ctx, tokens, "mono", 36); ctx.fillStyle = fg; ctx.textAlign = "right"; ctx.fillText(`wdth ${Math.round(lib.lerp(100, 62, pm))}`, W - 240, 200); ctx.textAlign = "left";
  lib.setFont(ctx, tokens, "display", 64, { weight: 800 }); ctx.fillStyle = lib.rgba(fg, 0.18); ctx.textAlign = "center"; ctx.fillText("STRETCH", W / 2, BY + 160); ctx.textAlign = "left";
}
```

草图用 `scale` 假装可变宽度，竖笔会跟着变细；正式做时用带 `wdth` 轴的可变字体（HyperFrames 里 `font-variation-settings: "wdth" …` 逐字设置，数值由 t 算），笔画粗细才保得住。

## 已知坑

- 字母底边跟着缩放漂起来 → 以基线为原点缩放（先移到基线，再 `scale`）。
- 只拉高不变窄 → 宽度同时收，中间收得最多。
- 用缩放假装可变字体，竖笔细得发虚 → 正式片用真的可变字体。

## 验收帧

- `peak`（第 39 帧）：中间的字母到顶，旁边一对在半路，最外面一对刚起步，读数是 62。
- `settle`（第 72 帧）：峰形齐了，基线一条直线。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 10 "Elastic type"。文字重写；时序从 8 s 循环改成一次拉伸加停留，按 30 fps 换算；停留段的呼吸和"用可变字体代替缩放"的提醒是本仓库加的；草图是本仓库写的灰盒。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
