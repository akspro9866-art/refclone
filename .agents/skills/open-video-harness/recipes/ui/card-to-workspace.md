---
id: card-to-workspace
name: 小卡展开成工作台
one_liner: 角落里一张小卡从自己的角上长成整个编辑器窗口，卡的标题是同一个元素、一路飞进窗口标题栏，虚线从卡角连到窗角，内容等外壳过半才进
family: ui
role: [feature]
intent: [transform, detail]
energy: 3
duration_f: [60, 150]
types: [promo, short]
engines: [canvas, hyperframes]
aspect: [landscape, square]
needs: [ui-element, ui-page, text]
sound: optional
pitfalls: [fake-ui, no-hold, copy-drift]
qa: {peak: 27, settle: 60}
status: tuned
pairs_with: [button-to-player, portal-wipe]
derived_from:
  - {repo: github.com/charlie947/motion-graphics-skills, commit: "229022e", path: skills/motion-effects/references/effects.md, license: MIT, note: 03 Card → workspace 的结构和时序}
sketch_sha: "473409e1e0f5"
---

# 小卡展开成工作台 · card-to-workspace

## 意图

发布一个功能时说"这张小卡就是整个工作台"：一张收起来的卡长成它所属的编辑器。观众盯着卡的标题，标题一路飞进窗口的标题栏，于是知道窗口就是那张卡打开的样子，不是换了一页。

## 阶段与时值

| 段 | 帧 | 发生什么 |
|---|---|---|
| 起始 | 0–6 | 左下角一张描边小卡，标题加两条灰色文字条 |
| 展开 | 6–48 | 外壳从卡自己的角长成窗口（入出都缓）；卡的文字条在前 1/5 淡出；虚线从卡的四角连到窗的四角；标题从卡上飞进标题栏 |
| 内容 | 30–48 | 外壳过半以后，侧栏、文档标题、正文条、配图、两个状态签依次淡入 |
| 停留 | 48–150 | 窗口停住，正文最后一行在光标后面慢慢写出来，状态签从"3 edits"变成"4 edits"；原位留着小卡的虚线轮廓 |

## 参数

| 参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 共享标题 | 同一个元素移动、缩放，从不复制一份 | 两份标题交叉淡化，就读成换页 | ★ |
| 内容入场 | 外壳过半以后 | 提前进来会挤在半成形的壳里 | ★ |
| 角对角虚线 | 30–40% 不透明，只在展开时出现 | 去掉也成立；有它，观众看得出是"从这里长出去的" | |
| 展开时长 | 40–45 帧 | 再快像弹窗；再慢像在等加载 | |

## 声音

外壳展开时一声轻的纸张展开或低音量 whoosh；静音也成立。

## 风格适配

- 结构参数：一个外壳变形、共享标题、内容后到、原位虚影。
- 皮肤参数：窗口的圆角、侧栏的底色、强调色、字体。
- 量化风格：展开按一拍二走台阶，虚线照留。

## 实现

```js
export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const surf = lib.mixColor(bg, fg, 0.06), line = lib.mixColor(bg, fg, 0.28), muted = lib.mixColor(bg, fg, 0.18);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const A = { x: 160, y: 740, w: 400, h: 200, r: 18 }, B = { x: 300, y: 110, w: 1400, h: 860, r: 22 };
  const u = lib.ease.inOutCubic(lib.seg(t, 0.2, 1.6)), L = (k) => lib.lerp(A[k], B[k], u);
  const R = { x: L("x"), y: L("y"), w: L("w"), h: L("h"), r: L("r") };
  ctx.save(); ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  ctx.globalAlpha = 0.2 * lib.seg(t, 0.2, 0.5); ctx.beginPath(); ctx.roundRect(A.x, A.y, A.w, A.h, A.r); ctx.stroke();   // the closed card's ghost
  ctx.globalAlpha = 0.35 * lib.env(t, 0.25, 1.9, 0.2, 0.4);   // guides, corner to corner, only while it opens
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(A.x + A.w * cx, A.y + A.h * cy); ctx.lineTo(R.x + R.w * cx, R.y + R.h * cy); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = surf; ctx.strokeStyle = line; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, R.r); ctx.fill(); ctx.stroke();
  const bars = 1 - lib.seg(t, 0.2, 0.5);
  if (bars > 0) { ctx.globalAlpha = bars; ctx.fillStyle = muted; ctx.fillRect(A.x + 30, A.y + 100, 300, 18); ctx.fillRect(A.x + 30, A.y + 136, 220, 18); ctx.globalAlpha = 1; }
  const inner = lib.seg(t, 1.0, 1.6), X = B.x + 340;
  if (inner > 0) {
    ctx.globalAlpha = inner;
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(B.x, B.y + 80); ctx.lineTo(B.x + B.w, B.y + 80); ctx.stroke();
    for (let i = 0; i < 3; i++) { ctx.fillStyle = line; ctx.beginPath(); ctx.arc(B.x + 36 + i * 30, B.y + 40, 9, 0, lib.TAU); ctx.fill(); }
    ctx.fillStyle = lib.mixColor(bg, fg, 0.03); ctx.fillRect(B.x + 2, B.y + 82, 280, B.h - 84);
    ["Overview", "Launch plan", "Assets", "Notes"].forEach((s, i) => {
      if (i === 1) { ctx.fillStyle = lib.rgba(ac, 0.14); ctx.beginPath(); ctx.roundRect(B.x + 16, B.y + 106 + i * 64, 248, 52, 10); ctx.fill(); }
      lib.setFont(ctx, tokens, "display", 30, { weight: i === 1 ? 600 : 400 }); ctx.fillStyle = i === 1 ? ac : fg; ctx.fillText(s, B.x + 36, B.y + 142 + i * 64);
    });
    lib.setFont(ctx, tokens, "display", 72, { weight: 700 }); ctx.fillStyle = fg; ctx.fillText("Launch plan", X, B.y + 200);
    const edits = t < 4.2 ? "3 edits" : "4 edits";
    [["Draft", ac], [edits, line]].forEach(([s, c], i) => {
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(X + i * 150, B.y + 236, 136, 46, 23); ctx.stroke();
      lib.setFont(ctx, tokens, "display", 26, { weight: 600 }); ctx.fillStyle = c === ac ? ac : fg; ctx.textAlign = "center"; ctx.fillText(s, X + i * 150 + 68, B.y + 268); ctx.textAlign = "left";
    });
    ctx.fillStyle = muted; [560, 600, 520, 430].forEach((w, i) => ctx.fillRect(X, B.y + 330 + i * 48, w, 20));
    ctx.fillStyle = lib.mixColor(ac, bg, 0.55); ctx.beginPath(); ctx.roundRect(X + 640, B.y + 320, 380, 270, 14); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (t > 2.0) {   // the hold keeps living: the next line writes itself behind a caret
    const w = 40 + 400 * lib.seg(lib.step(t, 12), 2.0, 4.2);
    ctx.fillStyle = muted; ctx.fillRect(X, B.y + 330 + 4 * 48, w, 20);
    if (lib.step(t, 2) * 2 % 2 === 0) { ctx.fillStyle = ac; ctx.fillRect(X + w + 6, B.y + 316 + 4 * 48, 4, 46); }
  }
  lib.setFont(ctx, tokens, "display", lib.lerp(40, 30, u), { weight: 600 }); ctx.fillStyle = fg;   // one title, travelling
  ctx.fillText("Q3 brief", lib.lerp(A.x + 30, B.x + 150, u), lib.lerp(A.y + 64, B.y + 51, u));
}
```

## 已知坑

- 标题在卡上淡出、在窗口里另起一个淡入 → 共享元素只有一份，一路移动。
- 窗口里全是灰条 → 至少一个真标题、两个真状态签，侧栏有一项亮着。
- 停留段一动不动像截图 → 让一行字在光标后面写出来，或者一个签变一下。

## 验收帧

- `peak`（第 27 帧）：外壳在半路，标题在飞行途中，角对角的虚线看得见，内容还没进来。
- `settle`（第 60 帧）：窗口停住，内容齐了，原位的小卡虚影还在。

## 来源

改写自 charlie947/motion-graphics-skills（Charlie Hills，MIT）的效果配方 03 "Card → workspace"。文字重写；时序从 8 s 循环改成一次性的展开加停留，按 30 fps 换算；停留段的"写出一行字"和状态签变化是本仓库加的；草图是本仓库写的灰盒。和 `seam/portal-wipe` 的区别：那一张是转场（点开的卡放大成下一镜的全屏），这一张留在同一镜里，讲的是"这张卡就是这个工作台"。

**许可**：本文件修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 在 commit `229022e` 时的 `skills/motion-effects/references/effects.md`（Copyright (c) 2026 Charlie Hills，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-motion-graphics-skills.txt`](../LICENSES/MIT-motion-graphics-skills.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
