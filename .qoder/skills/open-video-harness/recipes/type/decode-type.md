---
id: decode-type
name: 解码字
one_liner: 字像被程序一点点解出来：乱码按 2 帧一换，每个字在 0.3 s 内依次锁定，锁定之后才开始算读的时间
family: type
role: [hook, feature, climax]
intent: [generate, hook]
energy: [2, 4]
duration_f: [6, 30]
types: [promo, short, data, paper, meme]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [text]
sound: optional
pitfalls: [state-leak, no-hold, overuse]
qa: {peak: 4, read: 9}
status: tuned
impl: [showcase/04-intro-film/js/fx.js, styles/_swatch/lib.js]
derived_from: []
sketch_sha: "bd9e67494650"
---

# 解码字 · decode-type

## 意图

让一行字像是被程序算出来的，而不是贴上去的：片子讲的是代码、数据、系统时，字的出现方式本身就在说"这是机器生成的"。解码只是入场，它必须很快结束，之后字就是普通的要读的字。

## 阶段与时值

第 0 帧 = 这一行开始解码。下表是必读字的做法；只当纹理的字可以解得更慢。

| 段 | 帧 | 发生什么 |
|---|---|---|
| 乱码 | 0–9 | 每个字位先显示随机字符，每 2 帧换一次；字距从 +22% 收回到 0（0–15 帧，ease-out） |
| 依次锁定 | 0–9 | 第 i 个字在 0.3 s × (0.75·i/n + 0.25·hash(i)) 时锁定成真字：大体从左到右，带一点乱序 |
| 读 | 9 起 | 全部锁定，从这一刻起按读时规则计时 |
| 退场（可选） | 最后 7 帧 | 一小段 glitch 退场，或者直接淡出 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 锁定上限 | 必读字 0.3 s（9 帧）内全部锁定 | 解得再慢，观众在读乱码；介绍片 v3 的"动态字"就是按这条做的 | ★ |
| 读时起点 | 从最后一个字锁定的那一刻算（playbook/03 §2） | 从开始解码算，停留就少算了 0.3 s | ★ |
| 状态只看量化后的时间 | 乱码由 hash(种子, 字序号, floor(t / q)) 决定，q = 1–2 帧；锁定时刻也由 hash 算 | 状态依赖"上一帧显示了什么"，乱序渲染的结果就不一样。介绍片修过这个坑：同一个 2 帧桶里的状态曾取决于先渲了哪一帧 | ★ |
| 换字频率 | 每 2 帧一次（15 次/秒） | 每帧都换太躁；4 帧以上一换像卡顿 | |
| 乱码字符集 | 拉丁：大写字母、数字、少量符号；中文：取同一行里的其他汉字 | 中文用同一行的字，字宽和风格不跳；随机生僻字会闪出异体 | |
| 乱码颜色 | 强调色，透明度 0.8；锁定后换回正文色 | 颜色变化本身就告诉观众"这个字好了" | |
| 字距收拢 | +22% → 0，15 帧 | 可选；只在展示字号上用，小字不用 | |

## 声音

可以不配。要配就用很轻、很短的 tick，跟着 2 帧一换的节奏响，全部锁定那一刻停；锁定之后不要再有声音拖着。片子里同时有配乐时，这串 tick 放在配乐的高频下面，不要盖住鼓。

## 风格适配

- 结构参数：0.3 s 上限、读时从锁定起算、状态只由量化时间和 hash 决定、2 帧一换。
- 皮肤参数：乱码字符集（CRT 终端用等宽符号，像素风用点阵字）、乱码颜色、锁定时的一点点亮光。
- 手绘、水墨、剪纸这类手作风格不要用：解码字是"机器感"的签名，放在手作片子里就是穿帮。
- 竖屏的大字（130 px 以上）解码时字距收拢的幅度减半，否则会碰到安全框。

## 实现

本仓库介绍片的 `makeDynText`（`showcase/04-intro-film/js/fx.js`）是完整版：在 canvas 上逐字画，状态按 2 帧的桶取 key，桶不变就不重画；样片库的 `lib.scrambleGlyphs`（`styles/_swatch/lib.js`）是通用版。下面的草图按介绍片的公式写：

```js
// decode-type：第 20 帧起解码，9 帧内全部锁定；乱码 2 帧一换，状态只由量化时间和 hash 决定。
const LINE = "EVERY FRAME IS CODE", T0 = 20, D = 9, POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/";
export function renderAt(t, ctx, tokens, lib) {
  const f = lib.frame(t), k = f - T0, fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = lib.color(tokens, "bg"); ctx.fillRect(0, 0, 1920, 1080);
  if (k < 0) return;
  const n = LINE.length, bucket = Math.floor(k / 2);                  // 2 帧一个桶：同一桶里状态完全相同
  const spread = 0.22 * Math.pow(1 - lib.seg(k, 0, 15), 3);           // 字距 +22% → 0
  lib.setFont(ctx, tokens, "display", 140, { weight: 700 });
  const lay = lib.layoutText(ctx, LINE, { x: 960, y: 580, align: "center" });
  lib.drawGlyphs(ctx, lay, (g, i) => {
    const lock = D * (0.75 * i / n + 0.25 * lib.hash(7, i));          // 第 i 个字锁定的帧
    const done = k >= lock || g.ch === " ";
    const ch = done ? g.ch : POOL[Math.floor(lib.hash(13, i, bucket) * POOL.length)];
    return { ch, dx: (g.cx - 960) * spread, fill: done ? fg : lib.rgba(ac, 0.8) };
  });
}
```

HyperFrames（DOM）里每个字一个定宽的 `span`，内容由同样的公式在 seek 时算出；字宽要固定（等宽字，或按真字宽度给 `min-width`），否则乱码换字时整行会跳。

## 已知坑

- **读乱码**：解码拖到半秒以上，观众在读的其实是乱码。必读字 0.3 s 内锁完；只当背景纹理的字可以慢慢解。
- **状态漏到下一帧**：用"上一帧的状态 + 一点变化"来推下一帧，乱序渲染就不一致（CLAUDE.md 硬规则 1）。每一帧都从 t 重新算。
- **读时少算**：读的时间从锁定起算，不是从开始解码起算。用 `bin/vh readcheck` 核的时候，`start` 填锁定的时刻。
- **字压在运动模糊下**：解码常和甩镜、冲击一起用；必读字在画面上时，屏幕空间的运动模糊压到约 5%（playbook/03 §4）。
- **用太多**：每一行字都解码，就成了噪音。只给标题、关键数字、命令这类字用。
- **还没有人工判定**：介绍片（showcase 04）v3 的动态字用它；这一版过了两轮独立 reviewer，成片仍待用户本人观看（`showcase/04-intro-film/v3/REVIEW.md` 关卡 ③；v2 的人工意见是"不够炫酷"，这一手法是 v3 为此加的）。有人看过、给了判定，就升 `battle-tested`，把判定记在这里。

## 验收帧

- `peak`（第 4 帧）：一部分字已锁定、一部分还是乱码；乱码是强调色，字宽没有跳。
- `read`（第 9 帧）：整行已经是真字，颜色回到正文色；把这一帧和它前后各一帧单独重渲，结果逐像素相同（乱序渲染一致）。

## 来源

本仓库原创：规则写在 `playbook/03-motion-design.md` §4，实现在介绍片（`showcase/04-intro-film/`，v3 的"动态字"，fx 预设 B）。样片库的 `lib.scrambleGlyphs` 是它的通用版。
