# 镜头配方库：一镜怎么动

一张配方写的是一个镜头（或一个接缝）的运动和节奏：分几段、每段多少帧、哪些参数不能降、在哪里容易翻车、做完看哪一帧。颜色、字体、质感、音色不在配方里，它们归风格预设（[`styles/`](../styles/README.md)）。风格给皮，配方给骨，所以同一张配方可以穿 31 个预设里的任何一张皮。

- **配方**：`<family>/<id>.md`，一张一个镜头或一个接缝，索引见下文；
- **骨架**：[`sequences/`](sequences/README.md)，整支片子的节奏语法：能量弧、先划走的 hold、按能量落差选接缝、全片限额；
- **镜头语法卡**：`shot/`，景别、角度、轴线、运镜各几张，每张写情绪动机、什么时候用、什么时候别用；关键镜头可以从这里挑 2–3 个选项，选定的写进镜头表的 `camera`（索引见下文）；
- **工具**：`bin/vh recipes list` 按意图、能量、引擎等条件筛，`bin/vh recipes check` 校验 frontmatter 和索引。

分镜时每个镜头都要想"怎么动"；拿不准的时候，这里有现成的做法和数。它不替代类型文档和 playbook：类型文档说这类片子要什么，playbook 说通用的做法，配方说某一种镜头具体怎么做、做到什么数。

## 配方管什么，风格管什么

| 跟配方走（结构参数） | 跟风格走（皮肤参数） |
|---|---|
| 阶段和帧数、hold 的长短、切点间隔的规律 | 颜色、字体、字重、质感、圆角、阴影的颜色 |
| 缓动的形状（先慢后快、带过冲、线性） | 具体用哪条曲线，过冲允许多大 |
| 同时在动的层数，谁先停谁后停 | 纹理：纸、颗粒、扫描线、半调 |
| 全片最多用几次、和谁不能同片 | 音色：用哪一种 whoosh、impact |
| 验收帧：看哪一帧、看什么 | 量化：台阶缓动、一拍二（12 fps） |

**冲突时听谁的**：

1. 顺序和 CLAUDE.md 的"规则冲突时"一致：用户 > 底线（那里列的整一层）> 人批过的立意卡和项目 `STYLE.md`（和默认不一样的地方，先写理由、记进 `DECISIONS.md`；从风格预设借来的东西写进这里才算数）> 类型文档 > 配方的默认值 > `playbook/` 的通用数值。配方比 playbook 具体，所以同一件事两边都写了数，以配方为准。
2. CLAUDE.md 的硬规则和"任何档位都不降的底线"高于任何配方：每一帧是 t 的纯函数、全屏闪白每秒不超过 3 次、字号不低于下限、片中没有数字静音。
3. 参数表里标 ★ 的是命门：风格可以给它换皮，不能降它的档。例如风格要求一拍二（12 fps），hold 仍按秒数给足，切点取整到 2 帧，而不是把 hold 砍半。风格明确不用某种手法时（例如 `product-keynote` 不用 glitch），换一张配方，不要把这张做残。
4. 用了配方又有意偏离它（降档、改结构、换顺序），在 `DECISIONS.md` 写一句为什么。

改写外部配方时已经和本仓库的规则对齐过，下面几处和原文不同，每张配方的"来源"一节写了具体改了什么：

- **画面文字停到读完**：没人念的字从完整显示起，底线是够快读一遍（max(1.5 s, 汉字数 ÷ 7 + 其他字符数 ÷ 20 + 0.8 s)），舒服的时长按 BRIEF 的 Pace（TASTE_CHECKLIST #5，`bin/vh readcheck`）。配方里的例子按 normal 算；shotcraft 的字卡整张只有 1.8 s，停留那一截不够快读一遍，所以改写后的字卡、黑场字卡、字标开场都长一些。
- **要读的字不小于 44 px**（1080p 的辅助文字下限）：原文里 25–26 px 的副标、标语都提上来了。
- **片中没有数字静音**：原文让黑场和死寂段的声音同帧全静，改写后保留一层很低的底（CLAUDE.md 底线）。
- **强调词不用斜体**（`playbook/03-motion-design.md` §4），改用字重或强调色。
- **blur 只在 canvas 层动画**：playbook/03 §4 不让在 DOM 里动画 `blur`。配方里需要虚焦的地方，在 canvas 上用 `ctx.filter` 做，或者在 DOM 里用预先模糊好的副本做交叉淡入。
- **落地回弹不超过约 5%**，这是 playbook/03 §1 卡片档弹簧的上限。原配方里的过冲曲线实测在 1–5% 之间，都在这个范围内，配方里写了每条曲线的实际过冲。

## 怎么挑：先定意图，再看能量

配方是参照，不是每个镜头的必经一步：先按立意和 reads 自己想镜头怎么动，拿不准、或者想要现成的节奏和数时再来挑。配方和骨架都是默认口味，立意需要时可以反着来（`playbook/12-ideation.md` 第 6 节）。

1. **先写 reads**（`playbook/01-pipeline.md`），然后给每个镜头定三样：它在片中的位置（`role`），要观众明白什么（`intent`），手上有什么素材（`needs`）。
2. **套骨架定能量**：从 [`sequences/`](sequences/README.md) 选一条骨架，得到每个位置的目标能量（0–5，和 `playbook/09-narrative.md` 节拍表的能量是同一把尺子）和 hold 预算。叙事的形状（起承转合、好奇缺口、转在哪里）先按 playbook/09 定，骨架管的是能量和停顿。
3. **筛**：条件之间是"并且"，同一个条件里用逗号写几个备选。

   ```bash
   bin/vh recipes list --intent abundance,process --energy 4 --engine hyperframes --have ui-page,ui-element
   bin/vh recipes list --family seam --jump rise          # 能量往上走的接缝
   bin/vh recipes list --role breath --seconds 3-4        # 3–4 秒的呼吸位
   ```
4. **排序，定首选和备选**：意图对得最准的排前面；能量离骨架在这个位置的目标值最近的排前面；一种手法全片只当一次主角，已经用过的往后放。
5. **查全片约束**：`max_per_film`、`conflicts`、整画面冲击不超过 3 处、呼吸位的数量（见骨架的"限额"）。
6. **写进分镜**：用了配方，STORYBOARD 的"配方"列写 `id`（多式配方写 `id · 变体`），"验收帧"列把配方的 `qa` 换算成片内帧号，"转场出"写接缝配方的 id。自己想的镜头空着就行，不用写理由。
7. **写代码前读全文**：读选中配方的全文，再读它"实现"一节指向的代码。只凭名字和印象去写，等于丢掉配方里的调校。

**按努力程度**：

| | `quick` | `standard` | `studio` |
|---|---|---|---|
| 配方 | 可选；只挑 `battle-tested` 和 `upstream-tested` 的，参数照抄 | 可选：拿不准的镜头再查；用了的写 id，读全文和实现 | 同左；hook 和高潮两个位置各做两个方案的小样对比（配方或自创都行） |
| 骨架 | 可选 | 可选：全片节奏没把握时先套骨架 | 同左；用了骨架就按它做 animatic |
| 验收帧（用了配方的镜头） | 每镜 1 帧（`peak`） | 每镜 2 帧（`peak`、`settle`） | 同左，外加每个接缝前后 0.5 s 的 strip |
| 回写 | 不回写 | 值得复用的自创手法记进 `LESSONS.md` | 值得复用的写成新配方，状态标 `draft` |

## 索引

状态的含义见下文"状态"。时长按 30 fps 换算；接缝的时长是它从两侧镜头里借走的帧，字卡和开场、收场的时长随文案变（停到读完）。这张表由 `bin/vh recipes list --md` 生成，`bin/vh recipes check` 会核对整行（链接、一句话、能量、时长、状态）。

**全片骨架 `sequences/`**：[launch-15s](sequences/launch-15s.md)（15 s 发布 teaser）· [explainer-30s](sequences/explainer-30s.md)（30 s 有旁白的讲解）· [product-film-60s](sequences/product-film-60s.md)（60 s 产品发布片）；从立意出发的五条：[time-dilation-replay](sequences/time-dilation-replay.md)（时间放大镜）· [machine-eye-portrait](sequences/machine-eye-portrait.md)（机器视角的肖像）· [making-of-self](sequences/making-of-self.md)（用做法讲做法）· [mascot-style-tour](sequences/mascot-style-tour.md)（吉祥物穿越风格）· [workflow-as-story](sequences/workflow-as-story.md)（工作流即故事）；按题材的两条：[data-along-time](sequences/data-along-time.md)（沿时间轴的数据故事）· [live-countdown](sequences/live-countdown.md)（实时倒计时分屏）。规则和接缝选型表见 [sequences/README.md](sequences/README.md)。

**接缝 `seam/`**

| 配方 | 一句话 | 能量 | 时长 | 状态 |
|---|---|---|---|---|
| [black-card](seam/black-card.md) | 前镜淡进暗场，一句短话逐词压印上屏，停到读完，再淡入后镜：换章节和喘口气一起做 | 1–2 | 3.2–5.4 s | tuned |
| [cut-the-curve](seam/cut-the-curve.md) | 前景加速着朝一个方向走出一小段，切点落在运动正快的时候，后景从反方向以同样的速度接着走、减速落定 | 2–4 | 0.53–0.73 s | tuned |
| [dark-tunnel](seam/dark-tunnel.md) | 前景顺着运动方向推出画面，穿过几帧有尘点的暗场，后景从景深里迎面放大、收焦 | 4–5 | 0.73–1.1 s | tuned |
| [flash-cut](seam/flash-cut.md) | 前镜推近到切点，硬切处骑一层 10 帧的暖白光，盖住换页 | 2–4 | 0.33 s | upstream-tested |
| [flash-stitch](seam/flash-stitch.md) | 两种画面媒介之间的硬切上插 1 帧（60 fps 是 2 帧）高反差的"底片"：二值、双色或负片，读不出内容，却把两边焊在一起 | 4–5 | 0.03–0.07 s | draft |
| [focus-handoff](seam/focus-handoff.md) | 前景失焦、淡出、略向一侧滑走，后景错开 2 帧反向收焦进来，焦点本身就是剪辑点 | 2–3 | 0.4–0.67 s | tuned |
| [gate-as-door](seam/gate-as-door.md) | 世界里立着一扇形状对应下一章的门（画框、竖屏、节点），镜头朝门心加速穿过去，门框掠出画面，门里的世界接管 | 3–5 | 0.8–1.6 s | tuned |
| [gl-transition](seam/gl-transition.md) | 一段着色器、一个参数切五种转场：交叉扭曲、斜向扭曲擦除、梦幻波纹、涟漪、模糊交叉；前后两镜当纹理喂进去，进度由 t 算 | 2–4 | 0.5–1 s | tuned |
| [portal-wipe](seam/portal-wipe.md) | 页面上的一张卡放大成全屏窗口，被点开的那个世界从窗里长出来接管画面 | 3–4 | 1.3–1.6 s | tuned |
| [whip-pan](seam/whip-pan.md) | 相机一拍横甩到下一景，中段糊到认不出，借糊帧换景；两款：直接落位、急刹长尾 | 3–5 | 0.27–2 s | tuned |
| [zoom-through](seam/zoom-through.md) | 沿镜头纵深方向切：推进款里旧字冲向镜头、新字从远处继续长大；拉回款里旧的退远、新的从镜头背后缩回来落定 | 2–4 | 0.6–0.8 s | tuned |

**节奏 `rhythm/`**

| 配方 | 一句话 | 能量 | 时长 | 状态 |
|---|---|---|---|---|
| [accelerando-cuts](rhythm/accelerando-cuts.md) | 同一产品的 6 个构图硬切，切点间隔每两刀减半，越切越快地逼近，最后一刀定格回全景慢推 | 5 | 4.3–4.8 s | tuned |
| [drop-blackout-slam](rhythm/drop-blackout-slam.md) | 正常播放中一帧切进 12 帧的黑，画面里什么都没有，然后主视觉带着震屏和一圈亮环砸进来：全片最高潮的前一拍 | 5 | 3.7–4.7 s | tuned |
| [paparazzi-flash](rhythm/paparazzi-flash.md) | 三次快门白闪，每闪硬切同一素材的一个更近的裁切（全景 → 卡片 → 数字），最后停在那个数字上 | 4–5 | 4.2–4.5 s | tuned |
| [thread-through-cuts](rhythm/thread-through-cuts.md) | 一个亮点拖着一条线从这一闪跑进下一闪，切点都落在它跑动的时候；闪得再快，眼睛也有东西可跟，一串画面读作一条路 | 5 | 3–5.7 s | battle-tested |

**文字 `type/`**

| 配方 | 一句话 | 能量 | 时长 | 状态 |
|---|---|---|---|---|
| [brand-imprint-open](type/brand-imprint-open.md) | 一个小记号先画出来，字标逐字压印，副标打出，整组停到读完再上浮离场，交给产品画面 | 1–2 | 3–5 s | upstream-tested |
| [breath-title-card](type/breath-title-card.md) | 一句话逐词压印上屏，只有一个强调词，短横线收住，停到读完：两段高能镜头之间的喘息和路标 | 1–2 | 3.2–5.5 s | upstream-tested |
| [char-stagger](type/char-stagger.md) | 一行短标题的字按阅读顺序从下方 64 px 升起、同时淡入，每个字比前一个晚 1 帧，各走约 0.6 s；中文按字、英文按字母 | 2 | 1–3 s | tuned |
| [decode-type](type/decode-type.md) | 字像被程序一点点解出来：乱码按 2 帧一换，每个字在 0.3 s 内依次锁定，锁定之后才开始算读的时间 | 2–4 | 0.2–1 s | tuned |
| [diffusion-reveal](type/diffusion-reveal.md) | 整个画面先淹进噪声，一道前沿走过，噪声退去，字一个个长出来；最要紧的字最后落下，一记重音，两帧之内读得清 | 4–5 | 1.5–5 s | battle-tested |
| [elastic-type](type/elastic-type.md) | 一个词的每个字母站在锁死的基线上拉高变窄，从中间的字母开始往两边传，中间那个最高、最窄、是唯一的强调色，旁边一个读数从 wdth 100 数到 62 | 4 | 2–5 s | tuned |
| [glyph-roll](type/glyph-roll.md) | 每个字是一格只露一个字高的槽，字条往上滚、换成新词的同位字，左边的先走、每格晚 1–2 帧；状态词、按钮标签换值时用 | 2 | 0.67–1.5 s | tuned |
| [handwrite-on](type/handwrite-on.md) | 一个手写的词或签名按真实笔顺被笔尖一笔笔写出来：笔画走中心线、圆头，每笔的时间跟长度成正比，曲线处慢、笔与笔之间停一下 | 1 | 1.5–4 s | tuned |
| [highlight-sweep](type/highlight-sweep.md) | 句子先读一拍，一条荧光笔色带从左往右扫过关键词，色带在字的下半部、垫在字后面，一句话只扫一处 | 2 | 1.5–3 s | tuned |
| [masked-type](type/masked-type.md) | 一个大的描边字，画面从字形的底部往上涨满，一条带小方块把手的强调色线标着涨到哪；第二行字从一条看不见的切线后面升出来，不是淡入 | 3 | 2–5 s | tuned |
| [quote-build](type/quote-build.md) | 大引号先到，几行引文一行行从下方 24 px 升起，署名最后才贴上；停留时间按字数给足，引文一字不改 | 1 | 3–6 s | tuned |
| [scatter-assemble](type/scatter-assemble.md) | 撒在画面四处、带着旋转的字母，从种子决定的起点依次飞回来，在落点前减速，拼成一句可读的话；落定时没有残留的旋转和透明 | 3 | 1.5–3 s | tuned |
| [split-flap](type/split-flap.md) | 每个字是一张上下两半的翻牌，上半沿中线往下折、下半翻出新字，中途闪过两个别的字；从左往右每格晚 1 帧，像机场的到站牌 | 3 | 0.67–2 s | tuned |
| [strike-replace](type/strike-replace.md) | 一条删除线从左往右划过旧说法，停一拍，新说法才从下方 12 px 升到它下面；旧的留在 45% 浓度，看得出改了什么 | 2 | 1–3 s | tuned |
| [text-to-layout](type/text-to-layout.md) | 一行小字的标题拆成两半，各自飞到整页版式里的位置并长大，后一半先下落再左移、从不和前一半挤在一行；其余元素按阅读顺序到场：眉题、图、正文、引语卡 | 3 | 2–5 s | tuned |
| [text-wave](type/text-wave.md) | 一道只有三四个字宽的波从句首扫到句尾，只托起它经过的字（高度不超过字号的 30%），扫完歇一下再来，像句子在呼吸 | 2 | 1.2–5 s | tuned |
| [tracking-reveal](type/tracking-reveal.md) | 字距拉得很开的一行标题慢慢收拢成紧凑的整体，透明度在前 60% 里升满；插值的是每个字的位移，不是字距属性，所以行不会抖 | 1 | 0.6–1.5 s | tuned |
| [underline-draw](type/underline-draw.md) | 关键词下面一笔画出一条略带弧度的下划线，从左到右一次画完，像有人拿笔指着它；线在字下面，不压笔画 | 2 | 1–2.5 s | tuned |
| [word-emphasis](type/word-emphasis.md) | 整句先完整出现，然后其中一个短语换成强调色、围着自己的中心放大 6%，其余字退到 30% 左右的浓度，句子仍然读得通 | 2 | 1.5–4 s | tuned |
| [word-relay](type/word-relay.md) | 一个巨大的词从右边冲进来、在中间停 0.6 s、往左退场，下一个词同时冲进来接棒；两到五个词，最后一个词留下来当结论 | 4 | 2–5 s | tuned |
| [word-rise](type/word-rise.md) | 一两行字幕按词（中文按词组）依次上浮 12 px，模糊从 6 px 收到 0，全句在 1.2 s 内出齐；安静、按读的顺序 | 1 | 1–3 s | tuned |
| [word-slot-cycle](type/word-slot-cycle.md) | 句子的固定部分不动，只有一个词槽上下轮换几个候选词：旧词往上带点模糊出去、新词从下面进来，槽宽按最宽的词定，句子不跟着跳 | 2 | 2–5 s | tuned |

**开场 `open/`、界面 `ui/`、交互 `interaction/`、运镜 `camera/`、数据 `data/`、特效 `fx/`、收尾 `outro/`**

| 配方 | 一句话 | 能量 | 时长 | 状态 |
|---|---|---|---|---|
| [spotlight-hero](open/spotlight-hero.md) | 光在整页上找一圈、停在一张卡上，镜头从左侧斜着推近；卡抬起悬停，边框上跑两圈光，再落回自己的格子 | 3 | 4.8–5.3 s | upstream-tested |
| [accordion-expand](ui/accordion-expand.md) | 列表里一行从固定的上沿往下展开，下面的行被平滑推开让位，箭头转 180°，展开出来的内容等面板过半才按行淡入 | 2 | 1–2.5 s | tuned |
| [answer-stream](ui/answer-stream.md) | 一段 AI 回答按词组一块块出来，每块先以 22% 浓度出现、0.26 s 内实到 100%，末尾跟一个强调色的光标块；出完停住给读的时间 | 2 | 2–5 s | tuned |
| [button-to-player](ui/button-to-player.md) | 一颗"预览"小按钮的外壳自己拉长成整个播放器，播放键一路移到中心、长出底盘，再变成暂停，原位留一个按钮的虚影 | 3 | 2.2–5 s | tuned |
| [card-to-workspace](ui/card-to-workspace.md) | 角落里一张小卡从自己的角上长成整个编辑器窗口，卡的标题是同一个元素、一路飞进窗口标题栏，虚线从卡角连到窗角，内容等外壳过半才进 | 3 | 2–5 s | tuned |
| [chat-thread](ui/chat-thread.md) | 消息一条条出现，新气泡从 0.75 倍长到 1 倍，旧的对话整体往上推一格；问和答左右分开，条与条之间给够读的时间 | 2 | 3–6 s | tuned |
| [deal-to-grid](ui/deal-to-grid.md) | 一摞卡像发牌一样飞进网格的真实槽位，出牌越来越快，相机追着往下滚，满板后停半秒 | 4–5 | 2.9–3.8 s | upstream-tested |
| [diff-reveal](ui/diff-reveal.md) | 代码或文档的改动一行行显出来：先标删除（底色从左铺开、减号），再插入新增的行（把下面的行推开、加号），左边一列标记；一屏不超过 8 行改动 | 2 | 1.5–4 s | tuned |
| [doc-self-writing](ui/doc-self-writing.md) | 一整页真排版的文档在光标后面一块块"写"出来，侧栏随后铺开，历史条目一条条落进侧栏 | 2 | 3.3–4 s | upstream-tested |
| [drag-drop](ui/drag-drop.md) | 光标按住列表里的一项，提起一个半透明的副本；副本跟着光标走，经过的项依次让位，虚线槽标出它会落在哪，最后贴合落进去 | 3 | 1.5–3.5 s | tuned |
| [error-shake](ui/error-shake.md) | 输入框短促地左右摇三下标出错误，边框和下面一行说明变成错误色；改对以后边框换成成功色，一个勾一笔画出来 | 3 | 1.5–3.5 s | tuned |
| [gen-scan](ui/gen-scan.md) | 一条扫描带从上往下扫过画框，带上方是完成的图、下方还是粗像素格，进度数字跟着扫描带走、到底才说"完成" | 3 | 2–5 s | tuned |
| [glass-focus](ui/glass-focus.md) | 一块玻璃透镜在一张整体模糊的报表上一行行移动，只有透镜里的那一行清晰、放大 1.1 倍，字的两侧各一道极淡的色散，透镜顶上一道高光、两圈边 | 2 | 2–5 s | tuned |
| [hold-confirm](ui/hold-confirm.md) | 按住按钮时一层填充从左往右涨，第一次中途松手，填充退回去；第二次按满，按钮才换成完成的勾；"刻意的等待"就这样被看见 | 2 | 2–4 s | tuned |
| [magnetic-dock](ui/magnetic-dock.md) | 一排图标在深色半透明的坞里，光标滑过时每个图标按它到光标距离的钟形曲线放大，坞围着光标变宽而不是往一边长，标签始终在最大的那个图标上方 | 3 | 2–5 s | tuned |
| [modal-lift](ui/modal-lift.md) | 背景压暗（不糊），一个对话框从下方 24 px、0.96 倍浮到正中落定，焦点只剩它；随后光标点下确认键，键按下去再弹回 | 2 | 1–3 s | tuned |
| [row-embed](ui/row-embed.md) | 数据行一条条从上方落下，从斜的俯仰角放平，卡进页面里自己的行位，卡进去的那一帧底边闪一道强调色的缝 | 3 | 2.3–3.3 s | upstream-tested |
| [search-results](ui/search-results.md) | 一个短胶囊先展开成整条搜索框，再一个字一个字打进搜索词，词打完后三张结果卡错开一拍从下方升起落位，每张带一个真数字 | 3 | 2–4 s | tuned |
| [spring-fan](ui/spring-fan.md) | 三张叠在一起的卡各按不同阻尼的弹簧扇开，最上面那张阻尼最小、摆过头再晃回来；虚线虚影标出它的静止角度，角上拖一串点，角落的小曲线图同步走 | 3 | 2–5 s | tuned |
| [swipe-reveal](ui/swipe-reveal.md) | 列表里一行被手指往左推开，底下露出两个操作按钮（归档、删除），停住让人看清，然后行回弹盖上；手势的方向和藏着的操作一起讲清楚 | 2 | 1.5–3.5 s | tuned |
| [tab-stretch](ui/tab-stretch.md) | 选中的深色胶囊滑向下一个标签时前沿先走、后沿晚一拍，于是先拉长再缩回；标签字色跟着胶囊盖住的比例渐变，下面的面板逐行侧滑换成新内容 | 3 | 1.5–5 s | tuned |
| [terminal-run](ui/terminal-run.md) | 终端里一条命令按人手的速度敲完、回车，输出一行行出来，最后一行是结论，然后回到提示符；输出照抄真实的一次运行，不编数字 | 2 | 2.5–5 s | tuned |
| [toast-stack](ui/toast-stack.md) | 完成通知从右边滑进来、在右上角叠成一摞，最新的在最上面；中间一条被关掉以后，下面的平滑补上空位，同时可读的不超过三条 | 3 | 2–5 s | tuned |
| [toggle-slide](ui/toggle-slide.md) | 开关的圆钮滑到另一头、带一点回弹落定，轨道换色，圆钮上出现勾、旁边的"关"换成"开"；状态不只靠颜色表达 | 2 | 0.67–2 s | tuned |
| [upload-stack](ui/upload-stack.md) | 几张文件卡一张张抬起叠成一列，每张带自己的进度条，按各自的大小用不同的时间走到 100%；全部完成，标题才换成"已上传" | 2 | 2–5 s | tuned |
| [zoom-callout](ui/zoom-callout.md) | 界面上一个很小的数先被圈出来，一条线从圈引到旁边，一个圆形放大框弹出来，里面是同一个数的 4.5 倍字号和它的标签 | 2 | 1.5–4 s | tuned |
| [browser-walkthrough](interaction/browser-walkthrough.md) | 每个页面状态一张真截图，光标走向量好的目标、停稳再点，页面在点下去之后才换，镜头比光标沉稳，只在要看的区域变了才推过去 | 1–2 | 4–12 s | tuned |
| [oversized-cursor](interaction/oversized-cursor.md) | 一只画面宽度 7% 的光标从画外进来，把视线带到下一个目标，点一下让下一件事发生，然后离开或带进下一镜 | 2–3 | 1–3 s | tuned |
| [type-and-filter](interaction/type-and-filter.md) | 在真实界面上按人手的速度打字搜索，网格自己收敛成一张卡，点击它，镜头推进交给详情 | 3 | 2.3–2.7 s | upstream-tested |
| [layer-depth](camera/layer-depth.md) | 叠得几乎平的三层（图表在后、列表居中、页面在前）从后往前依次拉开、转向同一个灭点，每层留着自己的内容；虚线引向灭点，停留时机位上下浮动，三层错开着呼吸 | 2 | 2–5 s | tuned |
| [one-take-world-travel](camera/one-take-world-travel.md) | 一台镜头在同一个 3D 世界里从一个站点飞到下一个：甩过去、到站减速成慢推、停站时保留低幅漂移，字在读的时候骑在镜头前 | 2–5 | 3–8 s | tuned |
| [chart-morph](data/chart-morph.md) | 六根柱子从左到右依次收细成发丝，一条线从左往右画过它们的顶点，点逐个弹出，最后一个点挂上数值标签；前后是同一组数 | 2 | 2–5 s | tuned |
| [flowing-paths](data/flowing-paths.md) | 一个源头错开发出三个光点，沿弯曲的连线流向三个渠道，线是被光点一路点亮的；光点到达时节点回一圈涟漪，第二批光点汇进结果，线色从冷色渐到强调色 | 3 | 3–5 s | tuned |
| [kpi-lift](data/kpi-lift.md) | 四个强调色角标先卡住要讲的那张指标卡，其余仪表盘变暗，那张卡从它真实的位置和大小放大成占满画面的大卡，原位留下空槽，大卡的内容后到 | 3 | 2–5 s | tuned |
| [edited-plate-lapse](fx/edited-plate-lapse.md) | 同一张图编辑出白天、去掉物体的几版，几乎逐像素对齐；昼夜靠版与版交叉淡化，物体抠成一层从遮挡后面升起，图不扭曲；满高时合成就是原图，无缝接下一镜 | 2–4 | 3–8 s | battle-tested |
| [shutter-reveal](fx/shutter-reveal.md) | 整个画面被七条深色竖板盖着，竖板从左到右依次往自己的中线收窄到没有，每条带一道淡淡的亮边；露出的画面随后慢慢推近，左上角一个"新品"标签 | 3 | 1.5–5 s | tuned |
| [group-photo-launch](outro/group-photo-launch.md) | 每个展示过的功能派一个代表元素，从四面八方飞来围成合影，字标最后压印落款，全片能量最高 | 5 | 5–6 s | upstream-tested |
| [particle-mark](outro/particle-mark.md) | 左边一片撒开的小点，带着短拖尾沿弧线飞进右边标志的形状里，左边的先走、带一点种子随机；落定的点排在标志形状内的网格上，所以标志是清楚的 | 3 | 2–5 s | tuned |

本库只收了一部分。shotcraft 的其余卡片（共 157 张）可以在它的[在线 Gallery](https://vincentwei1021.github.io/video-shotcraft/) 看样片，源码在 `references/repos/video-shotcraft/references/shots/`（Apache-2.0，只读）；借用时按下文"写一张新配方"改写进来。[motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) 的 16 张效果配方全收了；[awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion) 的 637 张卡里挑了 30 张文字和界面的，其余（转场、数据、加载、3D 等）在它的网站和仓库里；[gl-transitions](https://github.com/gl-transitions/gl-transitions) 挑了五式合成 `gl-transition` 一张，其余的照那张"实现"一节末尾的说明加进来。

**镜头语法 `shot/`**

配方管一镜怎么动、动多少帧；这几张管机位怎么选：离多远、从哪个高度、守不守轴线、镜头怎么走，以及每种选择对观众意味着什么。关键镜头（钩子、转折、结尾）可以给 2–3 个选项和一句理由，选定的写进镜头表（`shots.json` 或 `edit.json` 的段）的 `camera`，写卡片的 `code`：`"camera": {"size": "MCU", "angle": "low", "move": "push-in"}`，可加 `"axis": "hold"`。`bin/vh storyboard` 在分镜页每镜下面印出它；`bin/vh recipes list --grammar` 列全部（`--grammar size` 只列景别）。这是选项，不是规定：用了哪一个、为什么，写在分镜里就行。

| 卡片 | code | 名字 | 一句话 |
|---|---|---|---|
| [extreme-wide](shot/extreme-wide.md) | `EWS` | 大远景 | 环境占满画面，主体只是其中一个小点：先让观众知道这是哪里、有多大 |
| [long](shot/long.md) | `LS` | 远景 | 主体认得出，但只占画面的一小块，环境占了大半：人在什么地方、周围有什么 |
| [wide](shot/wide.md) | `WS` | 全景 | 主体从头到脚都在画面里，周围留一圈环境：看清整个动作和它在空间里的位置 |
| [medium](shot/medium.md) | `MS` | 中景 | 主体腰部以上，手和脸都在画面里：讲解、对话和手上动作的默认距离 |
| [medium-close](shot/medium-close.md) | `MCU` | 近景（中近景） | 主体胸口以上，脸是画面的重心：观众开始注意它在想什么 |
| [close-up](shot/close-up.md) | `CU` | 特写 | 一张脸或一件东西占满画面：观众只能看它此刻的变化 |
| [extreme-close](shot/extreme-close.md) | `ECU` | 大特写 | 一只眼睛、一根手指、一个零件的局部：强到几乎看不出它属于什么 |
| [eye-level](shot/eye-level.md) | `eye` | 平视 | 机位和主体的眼睛一样高：中性、平等，观众和它站在同一个高度 |
| [high-angle](shot/high-angle.md) | `high` | 俯拍 | 机位高于主体、往下看：主体显得小、被看着；空间的布局一眼看清 |
| [low-angle](shot/low-angle.md) | `low` | 仰拍 | 机位低于主体、往上看：主体显得高大、有分量，像在仰望它 |
| [top-down](shot/top-down.md) | `top` | 顶拍 | 相机在正上方垂直往下看：画面变成平面，图案、布局和顺序最清楚 |
| [dutch](shot/dutch.md) | `dutch` | 斜角 | 画面绕镜头轴歪一个角度，地平线不再水平：读作失衡、不安、出了问题 |
| [hold-line](shot/hold-line.md) | `hold` | 守轴线 | 两个主体之间连一条线，所有机位都在线的同一侧：谁在左、谁在右，切来切去都不变 |
| [cross-line](shot/cross-line.md) | `cross` | 越轴 | 机位跨到轴线另一侧，左右对调：观众往往一下子迷了方向；有铺垫时，有时用来暗示关系或立场变了 |
| [direction](shot/direction.md) | `direction` | 运动方向一致 | 主体在画面里朝哪边走，跨镜头也朝那边走：前进一直是同一个方向 |
| [static](shot/static.md) | `static` | 固定 | 机位不动，只有画面里的东西在动：稳、可信，让内容自己说话 |
| [push-in](shot/push-in.md) | `push-in` | 推 | 镜头朝主体慢慢靠近，景别越来越紧：注意力收拢，"这里要紧" |
| [pull-out](shot/pull-out.md) | `pull-out` | 拉 | 镜头从主体往后退，周围的东西一点点进画：揭示语境，原来它在这里、原来它这么小 |
| [pan](shot/pan.md) | `pan` | 摇 | 机位不动，镜头水平转头（上下转是俯仰摇 tilt）：扫过一片空间，把两样东西连起来 |
| [tilt](shot/tilt.md) | `tilt` | 俯仰摇 | 机位不动，镜头上下转头：从脚看到头、从地面看到塔顶，在量一样东西有多高 |
| [track](shot/track.md) | `track` | 移 | 镜头整体平行移动，跟着主体走或沿着一排东西滑过：在路上、一起走 |
| [crane](shot/crane.md) | `crane` | 升降 | 镜头整体升高或降低，视点跟着变：升起常是离开、看清全局，降下是走进去、落到一个人身上 |
| [orbit](shot/orbit.md) | `orbit` | 环绕 | 镜头绕着主体转圈，主体一直在画面中心：立体、隆重，像在端详一件展品 |
| [drift](shot/drift.md) | `drift` | 漂移 | 镜头低幅度、慢慢地浮动，像手持或呼吸：画面是活的，但不引人注意 |

和常用的景别对照：国内教材常说的五级是远景、全景、中景、近景、特写，再往两头加大远景和大特写；这里每一级一张卡，code 用英语的缩写。边界各家说法不一，最常见的分歧是中景（膝部以上还是腰部以上，见 `medium` 卡）。

| 常用的说法 | 卡片 | code | 取到哪里（以人为例） |
|---|---|---|---|
| 大远景 | `extreme-wide` | `EWS` | 人只是一个点，环境占满画面 |
| 远景 | `long` | `LS` | 人认得出，只占一小块 |
| 全景 | `wide` | `WS` | 从头到脚 |
| 中景 | `medium` | `MS` | 腰部以上（不少教材取膝部以上） |
| 近景（中近景） | `medium-close` | `MCU` | 胸部以上 |
| 特写 | `close-up` | `CU` | 肩部以上，或一张脸、一件东西 |
| 大特写 | `extreme-close` | `ECU` | 脸或物件的一个局部 |

## frontmatter

frontmatter 是 YAML 的一个严格子集：一行一个 `key: value`；值是普通或加引号的标量、`[列表]` 或 `{映射}`；没有值的键下面跟 `  - 项` 的块列表。不用锚点，不写多行标量。各家 YAML 解析器读法不一的写法，`bin/vh recipes check` 一律报错、不去猜：`yes`/`no`/`on`/`off`；带前导零、下划线、指数或冒号的数（`1:30` 在 YAML 1.1 里是 90）；日期；`{key:value}` 冒号后不空格；`[ ]`、`{ }` 里没加引号的 `?`；双引号里的反斜杠；既没有值也没有列表项的键。能通过校验的，PyYAML 读出来是同一个结果。`check` 还会逐项校验字段，并在词表和本文不一致时报错。

| 字段 | 必填 | 写法 | 说明 |
|---|---|---|---|
| `id` | 是 | `flash-cut` | 小写、连字符；和文件名一致；发布后不改 |
| `name` | 是 | `推进流白` | 中文名 |
| `one_liner` | 是 | 一句话 | 这一镜做了什么 |
| `family` | 是 | 词表 | 手法的类别，也是所在的目录 |
| `role` | 是 | `[feature, climax]` | 在片中的位置，词表 |
| `intent` | 是 | `[accelerate]` | 要观众明白什么，词表 |
| `energy` | 是 | `4` 或 `[3, 5]` | 0 最静，5 最响（六档的含义见 `sequences/README.md`）；接缝写它适用的能量范围 |
| `duration_f` | 是 | `[120, 135]` | 30 fps 下的帧数范围；接缝写它从两侧借走的帧 |
| `types` | 是 | `[promo, short]` | 适合的视频类型，和 `bin/vh new` 的类型名一致 |
| `engines` | 是 | `[canvas, hyperframes]` | 能做的引擎，词表 |
| `aspect` | 是 | `[landscape, portrait]` | 适合的画幅 |
| `needs` | 是 | `[ui-page]` | 需要的素材，词表；不需要素材写 `[none]` |
| `sound` | 是 | `required` | 声音依赖度 |
| `pitfalls` | 是 | `[too-fast, no-hold]` | 容易犯的错，词表；正文"已知坑"逐条展开 |
| `qa` | 是 | `{peak: 44, settle: 78}` | 验收帧：从配方第 0 帧起算（30 fps），键见词表 |
| `status` | 是 | `tuned` | 验证到什么程度，见"状态" |
| `derived_from` | 是 | 块列表 | 每项 `{repo, commit, path, license}`，可加 `note`。`repo` 写仓库地址（如 `github.com/Vincentwei1021/video-shotcraft`），`commit` 是借用时上游的提交（加引号的 7–40 位十六进制），`path` 是上游仓库里的路径；只来自拆解、`license: none` 的来源可以不写 `commit`。原创的写 `[]` |
| `jump` | 接缝必填 | `[level, rise]` | 这个接缝适合哪种能量变化 |
| `max_per_film` | 否 | `1` | 全片最多用几次 |
| `conflicts` | 否 | `[paparazzi-flash]` | 不能同片出现的配方；两边都要写 |
| `pairs_with` | 否 | `[breath-title-card]` | 常和它搭配的配方 |
| `impl` | 否 | `[showcase/04-intro-film/js/fx.js]` | 本仓库里已有的实现；`check` 会确认文件存在 |
| `sketch_sha` | 否 | `"023b04a621bc"` | 联系表是照哪一版草图渲的：草图 sha256 的前 12 位，`bin/vh recipes sample` 写进来，不手填；`check` 拿它和现在的草图比 |

骨架（`sequences/*.md`）用同一种格式，字段是 `id`、`kind: sequence`、`name`、`one_liner`、`duration_f`、`types`、`aspect`、`arc`（每一段的能量，如 `[1, 3, 4, 2, 5]`）、`uses`（用到的配方 id）、`status`、`derived_from`。镜头语法卡（`shot/*.md`）也是，字段是 `id`、`kind: grammar`、`grammar`（词表）、`code`（镜头表里写的短码，同一类里不重复）、`name`、`one_liner`、`derived_from`，可加 `types`、`recipes`（做这个运镜的配方 id）；正文要有"情绪动机""什么时候用""什么时候别用""来源"四节，用和别用各至少一条；卡的别名写在 `<!-- know: 荷兰角, 倾斜 -->` 里，`bin/vh know` 按它找到卡。`kind` 的取值是 `recipe`（缺省）、`sequence` 或 `grammar`。

## 词表

词表只追加，不改名、不重排：已经发布的词不换含义。

**family**（手法的类别）：`open` 开场与品牌 · `type` 文字与字卡 · `ui` 界面登场与陈列 · `interaction` 交互演示 · `data` 数据与指标 · `camera` 运镜与空间 · `rhythm` 切点与节奏 · `fx` 光效与强调 · `seam` 接缝（转场） · `outro` 收尾

**role**（在片中的位置）：`hook` 前 3 秒的钩子 · `open` 开场 · `hero` 单主角立传 · `feature` 功能镜头 · `breath` 呼吸位 · `proof` 证据（数字、案例） · `climax` 高潮 · `outro` 收尾 · `seam` 接缝

**intent**（要观众明白什么），按组：

| 组 | 词 |
|---|---|
| 开场 | `hook` 抓住注意 · `promise` 承诺一个结果 · `brand-imprint` 记住名字 |
| 展示 | `hero` 这就是主角 · `abundance` 东西很多、源源不断 · `process` 一步步怎么做 · `compare` 前后或两者对比 · `transform` 从一样变成另一样 · `detail` 看清细节 · `locate` 它在哪里 · `connect` 它们之间的关系 · `count` 有多少 · `timeline` 随时间怎样 |
| 交互 | `interact` 跟着操作一遍 · `search` 找到它 · `generate` 它自己生成出来 |
| 节奏 | `breath` 喘口气 · `accelerate` 越来越快 · `punctuate` 重重一击 · `hush` 屏息 · `payoff` 兑现前面的铺垫 |
| 接缝 | `carry` 带着动量过去 · `enter` 钻进去看详情 · `chapter` 换章节 · `refocus` 同一空间里转移注意 |
| 收尾 | `sign-off` 落款 · `cta` 行动号召 |

**types**：`math` · `short` · `promo` · `mv` · `data` · `paper` · `handdrawn` · `meme` · `long` · `recap`（即 `bin/vh types` 里除 `edit` 以外的 10 类；`edit`（09）剪用户自己的素材，暂无配方。`long`、`recap` 也还没有专门标它们的配方：`--type long` 连带列出 `paper`、`data`、`math` 的，`--type recap` 连带列出 `mv` 的）

**engines**：`hyperframes` HTML/DOM + GSAP 的 composition · `canvas` 2D canvas 的 `renderAt(t)`（草图就是这种，在 HyperFrames 里跑） · `three` HyperFrames 里的 Three.js 层 · `p5` ClaudeAnimationBase · `manim` · `remotion`（来源的参考实现，本仓库不首选）

**aspect**：`landscape` 16:9 · `portrait` 9:16 · `square` 1:1

**needs**（需要的素材）：`ui-page` 整页截图 · `ui-element` 元素级截图或组件 · `text` 文案 · `number` 数字 · `series` 数据序列 · `photo` 照片 · `footage` 视频素材 · `logo` 标志或字标 · `3d` 三维模型或场景 · `none` 不需要素材

**sound**：`required` 没有声音就不成立 · `recommended` 有声音明显更好 · `optional` 静音也成立

**jump**（接缝两侧的能量变化）：`rise` 往上走 · `level` 持平 · `drop` 往下落

**qa**（验收帧的种类）：`read` 第一条必读信息完整显示 · `peak` 动作最快、最满的一帧 · `seam` 转场正中 · `settle` 落定之后、hold 之中 · `last` 切走前的最后一帧

**status**：`battle-tested` · `upstream-tested` · `tuned` · `draft`（见下一节）

**grammar**（镜头语法卡的类别）：`size` 景别 · `angle` 角度 · `axis` 轴线 · `move` 运镜

**license**（`derived_from` 里的许可）：`Apache-2.0` · `MIT` · `CC0-1.0` · `CC-BY-4.0` · `none`（只来自拆解分析，没有复制任何文字或代码）。`Apache-2.0`、`MIT`、`CC-BY-4.0` 的来源要带许可原文和 NOTICE 行，见"写一张新配方"。

**pitfalls**（容易犯的错）：

| 词 | 含义 |
|---|---|
| `too-fast` | 初版几乎总是偏快：动作弧、打字、hold 被压短 |
| `no-hold` | 落定之后没有静止就切走了 |
| `uniform-timing` | 等距、匀速、同时入场，读作机械 |
| `sub-threshold` | 预备动作、光效、位移的幅度低于肉眼能察觉的阈值，做了等于没做 |
| `float-not-land` | 飞入的元素悬在页面上方，没有落进真实的槽位 |
| `text-blur` | 推近或透视下字发糊（纹理分辨率不够），或者必读字压在运动模糊下面 |
| `dead-frame` | 纯黑、纯白或空的帧，读作断片或播放卡住 |
| `seam-mismatch` | 接缝两侧的方向、速度、轴线接不上 |
| `flash-rate` | 全屏闪有超过每秒 3 次的风险 |
| `glow-spill` | 光效溢出圆角、烧掉字，或者给每个元素都发一次光 |
| `overuse` | 用多了就失效，配合 `max_per_film` |
| `sound-dependent` | 没有声音就读不出节奏 |
| `mechanical-stop` | 所有层在同一帧停住，缺少先后 |
| `fake-ui` | 用手搓的仿真界面代替真实截图 |
| `off-axis-read` | 机位倾斜，信息密集的画面读不清 |
| `motion-sickness` | 连续甩镜或大幅旋转，看着晕 |
| `state-leak` | 状态依赖上一帧，乱序渲染的结果不一样 |
| `copy-drift` | 文案抽象、重复，或和画面对不上 |

## 状态

- `battle-tested`：本仓库做过的片子里用过，而且有人看过、给了判定，判定记在"已知坑"里。独立 reviewer 的打分不算判定。
- `upstream-tested`：来源项目的成片里用过，有用户判例，参数是判例定下来的；本仓库还没用过。
- `tuned`：实现过、调过，但还没有人给过判定：在灰盒或占位素材上调的（来源自己这样说明），或者用在本仓库还没有人看过的片子里（只过了独立 reviewer 的也在这一档）。
- `draft`：只来自拆解或描述，还没有人实现过。

`quick` 档只用前两种。一张配方在本仓库的片子里用过、有了人的判定，就升到 `battle-tested`，在"已知坑"里记下判例。showcase 00、04 用过的六张在"已知坑"里写了还差什么。

## 草图怎么跑

每张配方的"实现"一节给一段草图，写法是风格样片的场景接口（`styles/_swatch/README.md`）：一个 ES module，导出 `renderAt(t, ctx, tokens, lib)`，画在 1920×1080 的 canvas 上，`lib` 是 `styles/_swatch/lib.js`，也就是组件库 `components/lib` 加上样片的内容规格（缓动、`seg`、`hash`、`drawGlyphs`、`motionBlur`、弹簧轨道等）；做好的动效组件（翻页、纸面转场、章节进度条……）在 `components/`，`bin/vh components list` 列出来。草图只读 `tokens` 里的 `bg`、`fg`、`accent` 三个颜色和 `display`、`body`、`zh`、`mono` 几个字体角色。大多数预设都有这些键；缺的时候 `lib.js` 的 `color()` 回退到前景色（`fg`、`ink`、`text` 依次找），字体角色回退到安全字体。

试一张草图，并且换一张皮：

```bash
mkdir -p /tmp/try && cp styles/swiss-grid-type/tokens.json /tmp/try/     # 皮：任选一个预设
# 把配方"实现"一节的代码块存成 /tmp/try/swatch.js
styles/_swatch/render.sh /tmp/try --draft --hud                         # → /tmp/try/media/swatch.mp4，联系表在 styles/_swatch/out/try/sheet.png
```

草图是 5 秒、30 fps（样片渲染器的固定长度），只为说明时序和结构，素材用灰盒代替。放进真实项目时，把灰盒换成截图，把时间换成分镜里的片内时间。

**样片**：每张有草图的配方都带一张渲好的联系表，`<family>/media/<id>.jpg`（1600 px 宽，十格：验收帧和其间的时刻，`swiss-grid-type` 的皮），读配方前先看它，就知道这个动作长什么样。`bin/vh recipes list --json` 的 `sample` 字段给出路径。改了草图就重渲：

```bash
bin/vh recipes sample <id> --draft                  # → <family>/media/<id>.jpg，草图的 sha 写进 sketch_sha；视频留在 styles/_swatch/out/recipe-<id>/（不进 git）
bin/vh recipes sample <id> --style risograph        # 换一张皮看看：联系表放在视频旁边，不动配方那张
```

草图没变就不重渲（`--force` 照渲）。`bin/vh recipes check` 会查：有草图的配方都有联系表，联系表是照现在的草图渲的（`sketch_sha`），每张不超过 120 kB、2000 px 宽，每张联系表都有它的配方；草图也要守硬规则 1（`tools/purity.py` 的那张表；HyperFrames 注册表的 add 和组件的 check 读的也是它）。

## 写一张新配方

1. 复制 [`_TEMPLATE.md`](_TEMPLATE.md) 到 `<family>/<id>.md`，按模板的节写，全文控制在 150 行左右。
2. 时间一律写 30 fps 的帧数，必要时附拍数；参数表标出 ★；验收帧写进 `qa`。
3. 从别处学来的，用自己的话重写，不整段搬原文和代码；只学时序、编排、缓动这类手法，不复刻具体的画面、文案和品牌。在 `derived_from` 写明仓库、commit、上游路径和许可，正文"来源"一节写清改了什么。来源是 `Apache-2.0`、`MIT` 或 `CC-BY-4.0` 的，还要做三件事（`check` 会查）：把它的许可原文逐字放进 `LICENSES/<许可>-<仓库名>.txt`；在"来源"一节末尾加一段"**许可**：本文件修改自 …"，写出上游文件、commit 和许可原文的链接（照现有配方的写法）；在 [`NOTICE.md`](NOTICE.md) 的表里加一行。
4. 渲样片：`bin/vh recipes sample <id> --draft`，然后看那张联系表：动作是不是你写的样子，关键的一格（`peak`）是不是落在动作中间。
5. 在上面的索引里加一行（`bin/vh recipes list --md` 打印），然后跑 `bin/vh recipes check`。

## 来源与许可

本仓库是 MIT 许可，但下面这些文件改编自别的项目：两个是 Apache-2.0，按 Apache-2.0 第 4 条处理；五个是 MIT，带上它们的版权和许可声明。逐文件的清单在 [`NOTICE.md`](NOTICE.md)。

- **哪些文件**：17 张配方、3 条骨架和 `sequences/README.md` 修改自 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（Copyright 2026 Wei Yihao）的镜头卡、demo 和全片骨架；`cut-the-curve`、`zoom-through`、`oversized-cursor` 三张修改自 [HyperFrames](https://github.com/heygen-com/hyperframes)（Copyright 2026 HeyGen, Inc.）的 skill。MIT 的五个：16 张修改自 [motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills)（Copyright (c) 2026 Charlie Hills）的效果配方，30 张修改自 [awesome-ai-motion](https://github.com/gongnyang/awesome-ai-motion)（Copyright (c) 2026 gongnyang）的卡片，`gl-transition` 一张的着色器修改自 [gl-transitions](https://github.com/gl-transitions/gl-transitions)（Copyright (c) 2017-present gl-transitions contributors）的五个转场，骨架 `live-countdown` 修改自 [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)（Copyright (c) 2026 LemoLab）的倒计时风格，`browser-walkthrough` 一张修改自 [MengTo/Skills](https://github.com/MengTo/Skills)（Copyright (c) 2026 Meng To）的浏览器录屏 skill。
- **许可怎么算**：来自上游的部分仍按它自己的许可（Apache-2.0 或 MIT），七个上游的许可原文连同版权行逐字放在 [`LICENSES/`](LICENSES/)；本仓库的改动按 MIT。把这些文件拿到别处用，要连同它的"许可"一段、对应的许可原文和 `NOTICE.md` 一起带走。
- **每个文件怎么标**：frontmatter 的 `derived_from` 写上游仓库、commit 和路径；正文"来源"一节先写改了什么（文字重写，参数按本仓库的规则改过，见上文"和原文不同"的几处），末尾一段"**许可**"写明本文件修改自哪些上游文件、在哪个 commit，并链接许可原文。
- **NOTICE 和署名**：七个上游在所用的 commit 都没有 NOTICE 文件，所以没有要转载的 NOTICE 文字。Apache-2.0 的两个，用到的上游文件里没有单独的版权头，要保留的是两份 LICENSE 里的版权行；gl-transitions 的每个着色器文件写着自己的作者，作者名写在 `gl-transition` 的"来源"里，着色器代码里保留了作者注释。shotcraft 注明它的 B、C 两式转场来自对 Linear 发布片的抽帧逆向，这句话在 `dark-tunnel`、`focus-handoff` 的"来源"里保留了。
- **其余都是本仓库的**：原创的配方（`decode-type`、`diffusion-reveal`、`edited-plate-lapse`、`gate-as-door`、`one-take-world-travel`、`thread-through-cuts`，以及只来自拆解、没有复制任何内容的 `flash-stitch`）、本文、`_TEMPLATE.md` 和 `tools/recipes.py` 按 MIT。

shotcraft 的卡片本身研究自公开的商业片和个人作品，作者声明只取手法、全部重写；我们守同一条边界。拆解和取舍的全过程见 [`cases/promo-video-shotcraft.md`](../cases/promo-video-shotcraft.md)。同作者的 video-talkcraft、anything2explainer 是 PolyForm Noncommercial：`needs`（按输入素材筛）这个思路受 talkcraft 的输入类型索引启发，没有用它的文字和代码。
