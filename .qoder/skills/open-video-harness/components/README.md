# components：能复用的动效，算好状态再落笔

一个组件是一段能复用的动效：弹簧驱动的形状、翻页、纸面转场、章节进度条、一块块搭起来的建筑。它分两层：

- **状态层**：`state(params, t)` 算出这一帧的样子（位置、大小、透明度、进度、切片），是 t 的纯函数，不碰 DOM 和画布；
- **落笔层**：薄薄一层，把状态画出来。`canvas(ctx, state, …)` 画进 2D canvas；`dom(…)` 改 DOM 元素的样式和文字；`three(mesh, state, params, THREE)` 改 Three.js 对象（比如 `InstancedMesh` 每个实例的矩阵），three 由调用的人传进来，组件自己不引入它。字幕、章节条、标题卡这类以字为主的组件 canvas 和 DOM 两种都有，在 HyperFrames 里用 DOM 排，中文断行、字距、字体特性都交给浏览器；颗粒、纸纹、翻页这类效果只有 canvas 一种；3D 的（`build-up`）有 canvas（2.5D 方块，样片和不用 3D 的片子用）和 three 两种。

同一份状态，HyperFrames 的合成、canvas-film 的页面、风格样片的场景都能用；硬规则 1 由状态层保证：同一个 t 永远算出同一个状态，乱序画也一样。

## 有哪些

`bin/vh components list` 列出全部组件、各自有哪几种落笔、一句话说明（`--json` 给机读的参数表）。参数表在每个组件的 `slots.json`：

```json
{"version": 1, "name": "chapter-bar", "summary": "…", "painters": ["canvas", "dom"],
 "slots": [{"name": "chapters", "type": "array", "default": [], "text": "…"}, …], "provenance": [...]}
```

每个参数有类型、默认值、取值范围和一句话；`component.js` 导出的 `defaults` 和它对得上（`bin/vh components check` 查）。

## 库：`lib/`

组件共用的计算和画法，也是风格样片的 `lib`（`styles/_swatch/lib.js` 把它整个转出去，再加上样片自己的内容规格）：

| 文件 | 有什么 |
|---|---|
| `core.js` | 画面（`FRAME`、`setFrame`）、时间（`frame`、`step`、`seg`、`env`、`tween`）、安全框（`safeBoxes`、`anchor`、`slots`）、数学、带种子的哈希和噪声、缓动、闭式弹簧（`spring`、`springTrack`）、颜色和 tokens |
| `motion.js` | 改目标不留状态的弹簧轨道（`track`、`colorTrack`、`hold`）、内容换位（`swap`）、光标的路线和按压（`cursorPath`、`presses`）、声明式场景的状态（`scene`） |
| `text.js` | 从风格 tokens 取字体，canvas 里逐字排版和画字，解码和打字机 |
| `paint.js` | 离屏图层、质感（颗粒、纸、网点、扫描线、暗角、墨晕、毛边、RGB 分离）、手绘线、通用转场（擦除、光圈、甩镜、运动模糊） |
| `gl.js` | 离屏 WebGL2 全屏着色器 |

画面的尺寸和帧率是一个设置：默认 1920×1080、30 fps、dpr 1（样片的），别的页面在第一帧之前调一次 `setFrame({ w, h, fps, dpr })`。出 4K（dpr 2）时，canvas 按 `w·dpr` 开、`ctx.scale(dpr, dpr)`，坐标照旧按 CSS px 写（`engines/README.md`"出 4K"）；不给尺寸的图层跟着 dpr 开，库里把图层画回去的地方都按 CSS 尺寸画。

## 在项目里用

组件和库都是 ES 模块，用到哪个就复制进项目（`projects/` 以外的东西不改，CLAUDE.md 硬规则 6）：

```bash
bin/vh components add <项目> chapter-bar page-turn    # 复制 lib/ 和这两个组件到 <项目>/components/，打印怎么接
```

- **HyperFrames**：合成里 `<script type="module">` 引入组件，在挂在时间线上的驱动 tween 里按 t 调 `state()` 和落笔（`engines/README.md`"最小写法"的驱动 tween）。字用 DOM 落笔。
- **canvas-film**：`film.html` 加一行 `<script type="module" src="components/lib/global.js"></script>`，经典脚本里用 `OVH.grain(X, t, {…})` 这样调（模块在 `ready` 之前就加载完了）；画尺寸不是 1920×1080 的，在 `ready` 里 `OVH.setFrame({ w: W, h: H, fps: FILM.fps, dpr: PRX })`。有 three 画法的组件配 Three.js 层用：在 `FILM.three.build` 里 `await import(new URL("components/<名字>/component.js", document.baseURI).href)`，在镜头的 `pose(t)` 里调它的 `three()`（`build-up/sample/three-film.js` 是一支完整的例子）。
- **风格样片和配方草图**：场景从 `../../components/<组件>/component.js` 引入（样片的 stage 会把 `components/` 一起复制过去，同 `vendor/` 的约定）。

## 样片

每个组件带一段 5 秒的样片：`<组件>/sample/` 是一个样片场景（`swatch.js` + `tokens.json`，接口同 `styles/_swatch/README.md`），`bin/vh components sample <组件>` 用样片渲染器渲出来（`sample/media/swatch.mp4` 不入库），联系表存成 `sample/media/sheet.jpg` 入库：agent 读这张图，就知道这个组件动起来是什么样子。

`build-up` 的联系表是它的 canvas 落笔画的（2.5D 方块），不是 three 落笔，也没有 HDRI；three 落笔的样子看 `build-up/sample/three-film.js` 渲出的帧。canvas 落笔按每块中心由远到近排着画，只对一样大的盒子排得对，大小不一的盒子前后会排错，要准确的遮挡就用 three 落笔。

## 写一个新组件

1. 新建 `components/<名字>/`：`component.js` 导出 `defaults`、`state(params, t)` 和至少一种落笔；`slots.json` 写参数表；`sample/` 放一个 5 秒的样片场景。
2. 状态层只用 `lib/` 和参数，不读 `Math.random`、`Date.now`、DOM，不留跨帧状态；要缓存，就缓存只由参数决定的东西。
3. 借来的代码：MIT、Apache-2.0 这类许可的，把许可原文放进 `LICENSES/`，在 `NOTICE.md` 加一行，文件头写明出处；只借思路的，文件头写一句跟的是谁的思路。
4. `bin/vh components check`，再 `bin/vh components sample <名字>`，看联系表。
