---
id: gl-transition
name: 着色器转场五式
one_liner: 一段着色器、一个参数切五种转场：交叉扭曲、斜向扭曲擦除、梦幻波纹、涟漪、模糊交叉；前后两镜当纹理喂进去，进度由 t 算
family: seam
role: [seam]
intent: [carry, chapter]
energy: [2, 4]
duration_f: [15, 30]
jump: [level, rise]
types: [promo, short, mv, data]
engines: [canvas, hyperframes, three]
aspect: [landscape, portrait, square]
needs: [none]
sound: optional
pitfalls: [overuse, seam-mismatch, motion-sickness]
qa: {seam: 12, settle: 24}
status: tuned
pairs_with: [focus-handoff, black-card]
derived_from:
  - {repo: github.com/gl-transitions/gl-transitions, commit: "0efa165", path: transitions/CrossWarp.glsl, license: MIT, note: crosswarp 一式（作者 Eke Péter）}
  - {repo: github.com/gl-transitions/gl-transitions, commit: "0efa165", path: transitions/DirectionalWarp.glsl, license: MIT, note: directional 一式（作者 pschroen）}
  - {repo: github.com/gl-transitions/gl-transitions, commit: "0efa165", path: transitions/Dreamy.glsl, license: MIT, note: dreamy 一式（作者 mikolalysenko）}
  - {repo: github.com/gl-transitions/gl-transitions, commit: "0efa165", path: transitions/Ripple.glsl, license: MIT, note: ripple 一式（作者 gre）}
  - {repo: github.com/gl-transitions/gl-transitions, commit: "0efa165", path: transitions/LinearBlur.glsl, license: MIT, note: linearblur 一式（作者 gre）}
sketch_sha: "750e69668961"
---

# 着色器转场五式 · gl-transition

## 意图

两镜之间要一个比硬切、淡化更有质感的接缝，又不想每次从头写着色器：一张总表、一段着色器，按片子的语气挑一式，前后两镜各渲成一张画面喂进去，进度由 t 算。五式都是像素级的变形，读起来是"画面本身在变"，不是一块遮罩扫过去。

## 阶段与时值

| 段 | 帧（以 24 帧为例） | 发生什么 |
|---|---|---|
| 进 | 0–12 | 前镜开始变形，后镜从变形里浮出来 |
| 接缝 | 12 | 两镜各占一半，主体在变形最厉害的地方 |
| 出 | 12–24 | 后镜收拢、落定，最后一帧没有残影 |

进度 0→1 在着色器外面加缓动（入出都缓，`inOutCubic`），着色器只吃一个 0–1 的数。

## 参数

| 式 | 读起来像 | 适合 | 参数（默认） | 能量 |
|---|---|---|---|---|
| `crosswarp` | 前镜往前冲、后镜从远处缩进来，从右往左扫过 | 章节往前推、"下一步" | 无 | 3–4 |
| `directional` | 斜向擦除，边被扯开 | 换场景、换话题 | 边缘软度 0.1，方向 (−1, 1) | 3 |
| `dreamy` | 带竖向波纹的交叉淡化 | 回忆、梦、柔的过渡 | 无 | 2 |
| `ripple` | 从中心荡开的涟漪 | 揭示、"一石激起" | 频率 100，速度 50 | 3 |
| `linearblur` | 先糊再清的交叉 | 焦点转移、时间流逝 | 模糊量 0.1 | 2 |

| 通用参数 | 值 | 调节手感 | ★ |
|---|---|---|---|
| 时长 | 15–30 帧 | 短于 12 帧看不出是哪一式；长于 30 帧像特效展示 | |
| 一支片子用几式 | 一两式，同一种接缝用同一式 | 每个接缝换一式，像模板合集 | ★ |
| 两镜的主体 | 位置相近效果最好 | 扭曲类把相隔很远的两个主体扯碎 | ★ |
| 两镜都在动 | 转场期间两边都按自己的 t 走 | 一边定格，接缝处会"卡"一下 | |

## 声音

跟着式走：`crosswarp`、`directional` 配一声 whoosh，`ripple` 配一声低的"咚"，`dreamy`、`linearblur` 可以只让音乐交叉。不要每个接缝用同一个音效。

## 风格适配

- 结构参数：两镜当纹理、进度在外面加缓动、一支片子一两式。
- 皮肤参数：每式的参数（方向、频率、模糊量）。
- 量化风格：进度按一拍二取值，变形一跳一跳，适合像素风和定格风。

## 实现

```js
let fx;   // compiled once and reused: a cache, not state that changes what a frame shows
const FRAG = `
uniform float u_progress, u_kind, u_smooth, u_amp, u_speed, u_blur;
uniform vec2 u_dir;
vec4 getFromColor(vec2 p) { return texture(u_tex0, p); }
vec4 getToColor(vec2 p) { return texture(u_tex1, p); }
// CrossWarp: Eke Péter, MIT (gl-transitions)
vec4 crossWarp(vec2 p, float progress) {
  float x = smoothstep(0.0, 1.0, progress * 2.0 + p.x - 1.0);
  return mix(getFromColor((p - 0.5) * (1.0 - x) + 0.5), getToColor((p - 0.5) * x + 0.5), x);
}
// DirectionalWarp: pschroen, MIT (gl-transitions)
vec4 directionalWarp(vec2 uv, float progress) {
  vec2 v = normalize(u_dir); v /= abs(v.x) + abs(v.y);
  float d = v.x * 0.5 + v.y * 0.5;
  float m = 1.0 - smoothstep(-u_smooth, 0.0, v.x * uv.x + v.y * uv.y - (d - 0.5 + progress * (1.0 + u_smooth)));
  return mix(getFromColor((uv - 0.5) * (1.0 - m) + 0.5), getToColor((uv - 0.5) * m + 0.5), m);
}
// Dreamy: mikolalysenko, MIT (gl-transitions)
vec2 dreamyOffset(float progress, float x) { return vec2(0.0, 0.03 * progress * cos(10.0 * (progress + x))); }
vec4 dreamy(vec2 p, float progress) {
  return mix(getFromColor(p + dreamyOffset(progress, p.x)), getToColor(p + dreamyOffset(1.0 - progress, p.x)), progress);
}
// Ripple: gre, MIT (gl-transitions)
vec4 ripple(vec2 uv, float progress) {
  vec2 dir = uv - vec2(0.5); float dist = length(dir);
  vec2 offset = dir * (sin(progress * dist * u_amp - progress * u_speed) + 0.5) / 30.0 * progress;
  return mix(getFromColor(uv + offset), getToColor(uv), smoothstep(0.2, 1.0, progress));
}
// LinearBlur: gre, MIT (gl-transitions)
vec4 linearBlur(vec2 uv, float progress) {
  vec4 c1 = vec4(0.0), c2 = vec4(0.0); float disp = u_blur * (0.5 - distance(0.5, progress));
  for (int xi = 0; xi < 6; xi++) for (int yi = 0; yi < 6; yi++) {
    vec2 v = vec2(float(xi) / 6.0 - 0.5, float(yi) / 6.0 - 0.5);
    c1 += getFromColor(uv + disp * v); c2 += getToColor(uv + disp * v);
  }
  return mix(c1 / 36.0, c2 / 36.0, progress);
}
void main() {
  float k = u_kind, pr = u_progress; vec2 p = v_uv;
  outColor = k < 0.5 ? crossWarp(p, pr) : k < 1.5 ? directionalWarp(p, pr) : k < 2.5 ? dreamy(p, pr) : k < 3.5 ? ripple(p, pr) : linearBlur(p, pr);
}`;

export function renderAt(t, ctx, tokens, lib) {
  const { W, H } = lib, bg = lib.color(tokens, "bg"), fg = lib.color(tokens, "fg"), ac = lib.color(tokens, "accent");
  const scene = (name, dark, title) => lib.offscreen(name, (c) => {   // the two shots; in a film, each is its own shot rendered at t
    c.fillStyle = dark ? fg : bg; c.fillRect(0, 0, W, H);
    c.fillStyle = ac; c.beginPath(); c.arc(dark ? W * 0.7 : W * 0.3, H * 0.42, 220, 0, lib.TAU); c.fill();
    lib.setFont(c, tokens, "display", 120, { weight: 800 }); c.fillStyle = dark ? bg : fg; c.fillText(title, dark ? 160 : W * 0.5, H * 0.78);
  });
  const A = scene("glt-a", false, "Chapter one"), B = scene("glt-b", true, "Chapter two");
  const kinds = ["crosswarp", "directional", "dreamy", "ripple", "linearblur"];
  const S = [0.05, 0.9, 1.9, 2.9, 3.9], k = Math.max(0, S.filter((x) => t >= x).length - 1), s = S[k];   // the sample runs all five, one a second
  const p = lib.ease.inOutCubic(lib.seg(t, s, s + 0.7)), [from, to] = k % 2 === 0 ? [A, B] : [B, A];
  fx = fx || lib.shader(FRAG);
  ctx.drawImage(fx.render(t, { u_progress: p, u_kind: k, u_dir: [-1, 1], u_smooth: 0.1, u_amp: 100, u_speed: 50, u_blur: 0.1 }, { u_tex0: from, u_tex1: to }), 0, 0, W, H);
  lib.setFont(ctx, tokens, "mono", 34); ctx.fillStyle = ac; ctx.fillText(kinds[k], 80, H - 70);
}
```

放进片子时：前后两镜各渲成一张画面（同一个 t），喂给 `u_tex0`、`u_tex1`，`u_kind` 选式，`u_progress` 是缓动过的进度。HyperFrames 里放在一层 canvas 上；Three.js 里是一个全屏四边形的 `ShaderMaterial`。要加 gl-transitions 里别的式：把它的 `transition(vec2)` 函数体抄进来改名，`progress` 改成参数、它的 uniform 加 `u_` 前缀，保留作者和许可那一行注释，再在本节的许可段落和 `NOTICE.md` 里补上它的路径。

## 已知坑

- 每个接缝换一式 → 一支片子一两式，同一种接缝同一式。
- 前后两镜的主体隔得很远，扭曲类的式把主体扯碎 → 换 `linearblur`、`dreamy`，或者直接切。
- 一边是定格画面 → 两镜在转场期间都按自己的 t 走。
- `ripple` 的频率和振幅调太大，看着晕 → 守默认值附近。
- 渲染环境没有 WebGL2，`lib.shader` 会报错 → 退到 `lib.wipe`、`lib.iris` 这类 2D 转场。

## 验收帧

- `seam`（第 12 帧）：两镜各占一半，变形最厉害，主体还认得出。
- `settle`（第 24 帧）：后镜完全落定，没有残影、没有残余的扭曲。

## 来源

改写自 gl-transitions（MIT）的五个转场：CrossWarp（Eke Péter）、DirectionalWarp（pschroen）、Dreamy（mikolalysenko）、Ripple（gre）、LinearBlur（gre）。着色器代码在原文上改过：五段合进一个着色器、用 `u_kind` 切换；`progress` 改成参数；各式的 uniform 加了 `u_` 前缀；Dreamy 里没用到的相位参数删了；`getFromColor`、`getToColor` 由本仓库按 `lib.shader` 的两张纹理定义。选型表、时长、声音、已知坑和草图是本仓库写的。

**许可**：本文件修改自 [gl-transitions](https://github.com/gl-transitions/gl-transitions) 在 commit `0efa165` 时的 `transitions/CrossWarp.glsl`、`transitions/DirectionalWarp.glsl`、`transitions/Dreamy.glsl`、`transitions/Ripple.glsl`、`transitions/LinearBlur.glsl`（Copyright (c) 2017-present gl-transitions contributors，各文件的作者见上一段，MIT），改了什么见上一段。来自上游的部分仍按 MIT 授权，许可全文见 [`LICENSES/MIT-gl-transitions.txt`](../LICENSES/MIT-gl-transitions.txt)；本仓库的改动按仓库根目录的 MIT 许可。所有改编文件和上游出处的清单见 [`NOTICE.md`](../NOTICE.md)。
