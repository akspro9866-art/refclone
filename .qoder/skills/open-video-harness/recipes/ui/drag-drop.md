---
id: drag-drop
name: 拖到新位置
one_liner: 光标按住列表里的一项，提起一个半透明的副本；副本跟着光标走，经过的项依次让位，虚线槽标出它会落在哪，最后贴合落进去
family: ui
role: [feature]
intent: [interact, transform]
energy: 3
duration_f: [45, 105]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, portrait, square]
needs: [ui-element, text]
sound: optional
pitfalls: [fake-ui, float-not-land]
qa: {peak: 33, settle: 63}
status: tuned
pairs_with: [oversized-cursor]
derived_from:
  - {repo: github.com/gongnyang/awesome-ai-motion, commit: "1e3c249", path: effects/drag-and-drop/README.md, license: MIT, note: 时序和"移动中原件和副本不能都不透明"的禁止项}
sketch_sha: "1d7bf28a5c57"
---

# 拖到新位置 · drag-drop

## 意图

演示重新排序、把文件拖进投放区：谁被拿起来了、搬到了哪、结果是什么，三件事都要看得见。提起时有影子，原位留空槽；经过的项让位；落下时贴合，不飘。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 指 | 0–12 | 光标停在第四项上 |
| 提起 | 12–18 | 按下：一个副本提起（放大 3%、加影子、90% 浓度），它空出的位置是一个虚线槽 |
| 拖 | 18–48 | 副本跟着光标往上走（入出都缓），经过的项按副本中心的位置依次往下让一格，虚线槽跟着移到副本会落下的那一格 |
| 落 | 48–57 | 副本贴进第一格，影子收掉，空槽消失 |
| 停留 | 57– | 新顺序停住 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 副本 | 90% 浓度、放大 3%、影子 | 副本和原件都实心，像复制了一份 | ★ |
| 虚线槽 | 标出副本会落在哪一格 | 没有它，观众不知道放手后会去哪 | |
| 让位 | 按副本中心的位置连续让，不按时间 | 按时间让，副本还没到，别人先跑了 | ★ |
| 落定 | 放下时贴合到格子，不弹 | 落下后还在飘 | |

## 声音

提起一声很轻的"嗒"，落下一声稍实的"嗒"。

## 风格适配

- 结构参数：副本半透明、原位空槽、按位置让位、贴合落定。
- 皮肤参数：列表样式、影子、光标。
- 量化风格：拖动按一拍二。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const items = ["Write the brief", "Pick a style", "Storyboard", "Record the voice", "Render a draft"], X = 560, Wd = 800, RH = 120, G = 20, Y0 = 200;
  const slotY = (k) => Y0 + k * (RH + G), from = 3, to = 0;
  const lift = lib.ease.outCubic(lib.seg(t, 0.4, 0.6)), move = lib.ease.inOutCubic(lib.seg(t, 0.6, 1.6)), drop = lib.ease.outCubic(lib.seg(t, 1.6, 1.9));
  const cy = lib.lerp(slotY(from), slotY(to), move);   // the copy follows the cursor
  const row = (s, x, y, a = 1, k = 1, shadow = 0) => {
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x + Wd / 2, y + RH / 2); ctx.scale(k, k); ctx.translate(-(x + Wd / 2), -(y + RH / 2));
    if (shadow) { ctx.shadowColor = `rgba(0,0,0,${0.22 * shadow})`; ctx.shadowBlur = 40 * shadow; ctx.shadowOffsetY = 14 * shadow; }
    ctx.fillStyle = lib.mixColor(bg, fg, 0.06); ctx.beginPath(); ctx.roundRect(x, y, Wd, RH, 20); ctx.fill(); ctx.shadowColor = "transparent";
    ctx.fillStyle = lib.mixColor(bg, fg, 0.3); for (let d = 0; d < 6; d++) { ctx.beginPath(); ctx.arc(x + 40 + (d % 2) * 14, y + 44 + Math.floor(d / 2) * 16, 4, 0, lib.TAU); ctx.fill(); }
    lib.setFont(ctx, tokens, "display", 44, { weight: 600 }); ctx.fillStyle = fg; ctx.fillText(s, x + 90, y + 75); ctx.restore();
  };
  items.forEach((s, k) => {
    if (k === from) return;
    const give = k >= to && k < from ? lib.clamp((slotY(k) + RH + G - cy) / (RH + G)) : 0;   // make room by where the copy is, not by the clock
    row(s, X, slotY(k) + give * (RH + G));
  });
  if (lift > 0 && drop < 1) { ctx.save(); ctx.setLineDash([12, 10]); ctx.strokeStyle = lib.rgba(fg, 0.35 * lift * (1 - drop)); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(X, slotY(Math.round((cy - Y0) / (RH + G))), Wd, RH, 20); ctx.stroke(); ctx.restore(); }   // where it will land
  row(items[from], X, cy, lib.lerp(1, 0.9, lift * (1 - drop)), lib.lerp(1, 1.03, lift * (1 - drop)), lift * (1 - drop));
  const px = X + Wd - 120, py = cy + RH / 2;   // the cursor rides on the copy
  ctx.fillStyle = fg; ctx.strokeStyle = bg; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + 52); ctx.lineTo(px + 14, py + 40); ctx.lineTo(px + 24, py + 60); ctx.lineTo(px + 32, py + 55); ctx.lineTo(px + 22, py + 36); ctx.lineTo(px + 38, py + 36); ctx.closePath(); ctx.fill(); ctx.stroke();
}
```

## 已知坑

- 拖动时原件和副本都是实心 → 副本半透明，空出的位置只留虚线槽。
- 其余项按时间让位 → 按副本的位置连续让。
- 放下后还在晃 → 落定贴合，影子收掉。

## 验收帧

- `peak`（第 33 帧）：副本在半路，第二、三项已经下移一格，第一项正在让。
- `settle`（第 63 帧）：新顺序停住，被拖的那项在第一格，没有影子。

## 来源

改写自 gongnyang/awesome-ai-motion（MIT）的卡片 drag-and-drop。文字重写；时序和禁止项沿用卡片，按 30 fps 换算；"按副本位置让位"的写法和草图是本仓库写的，列表文字是占位。

**许可**：本文件修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 在 commit `1e3c249` 时的 `effects/drag-and-drop/README.md`（Copyright (c) 2026 gongnyang，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-awesome-ai-motion.txt`](../LICENSES/MIT-awesome-ai-motion.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
