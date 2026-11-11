# 按表达场景组合三维、合成与交付能力

本参考落实“镜头意图 → 可用路线 → 能力证据 → 最小试验 → 资源上限 → 回退”。适用于八类既有场景，不新设一套题材分类，也不把任何引擎当全部视频的前提。先确定画面要解释什么或让观众感受什么，再选择单一工具或组合。2026-10-25读取指定仓库的DeepWiki结构与问答，并回读下述官方源码／文档；说明能力不等于本机已接入或试片通过。

## 在创建对象之前写镜头

沿已有scene／element／beat ID，在计划或镜头笔记写清：

1. 本镜观众新增什么，哪个可见事件证明它；事实与创作比喻分别记依据。
2. 景别、构图、视线与主要焦点；字幕和标注需要的留白。
3. 角色意图与表情变化、进入姿势 → 主动作 → 最终姿势；没有角色则写对象的初态与终态。
4. 摄像机起点、移动、注视目标和落定构图；运镜为何帮助理解或感受。
5. 主光方向、环境光与反射、材质轮廓、背景和明暗关系；避免字幕、脸和动作被高光遮住。
6. 声音锚点、动作落定、阅读／情绪停留与下一镜接力；执行帧从唯一有效排程派生。

有表现力的角色需要实际建模或合适模型、绑定／形变、姿势、表情与时机；摄像机移动也要创作和检查，工具不会自动产生表演。先用低成本的初态、动作极值与终态检查轮廓、穿插、视线、接地和焦点，再完成必要的连续镜头。不能用一个漂亮静帧代替角色表演或电影镜头验收。

## 按需要的表达选择职责

| 表达任务 | 优先考虑的路线 | 可组合部分与边界 |
| --- | --- | --- |
| 角色的表情、肢体、道具互动和小世界故事 | Blender中的可编辑场景、骨骼／形变与摄像机 | 渲染镜头交给Remotion或已有编辑器加精确文字与声音；模型存在不代表表演已完成 |
| 需要材质、反射、空间灯光和摄影式构图的物体／品牌镜头 | Blender，按视觉要求与资源选Cycles或EEVEE | 两者都可做最终渲染；不把EEVEE只当预览，也不无条件指定高成本路径追踪 |
| 几何、空间关系、粒子、可计算过程、数据驱动三维讲解 | Three.js，或工程已有的等价程序化路线 | 可与Remotion的帧时间结合；三维不是必需，平面更清楚就用平面 |
| 真实视频／照片、标题、字幕、图表与音频的可复用装配 | Remotion的Composition与Sequence，或已有合成器 | 真实媒体可直接输入；预渲染Blender视频不需要先转成Three.js场景 |
| 需要同一镜头中三维对象与React排版配合 | 已核版本的Remotion＋`@remotion/three`／React Three Fiber | `ThreeCanvas`用于运行三维场景；不是把任意`.blend`自动无损转换的工具 |
| 编码、封装、流选择及适配交付格式 | 当前可用FFmpeg与探测工具 | 已合规的导出不重复有损转码；文件技术检查不能代替观看与听审 |

以上为依据工具职责形成的设计选择，不是“唯一最好”的性能榜。优先已有工程、资产、缓存与运行实例；只有表达收益明确时才增加工具，重渲染、模型任务和媒体处理默认串行。不能因流程列出三种引擎就启动三个环境。

## 常见组合按镜头选择

- **知识说唱**：真实档案／照片与已核图表承担事实；需要可计算的空间机制时用Three.js，角色或物体表演段按需用Blender；Remotion或已有合成器统一歌词、音乐、镜头和转场，最后按交付需要用FFmpeg。
- **角色电影短片**：先写镜头、表情、姿势和运镜；Blender完成可编辑表演与灯光，按镜输出媒体，合成器组织字幕、声音和整片；没有复杂排版需求可直接沿Blender工程交付，不强加Remotion。
- **产品／品牌片**：真实操作和输出保留证据；三维物体与材质镜头表达形象和情绪，图形与标题在可编辑层控制，不让三维比喻冒充不存在的产品能力。
- **机制／数据讲解**：先用清楚的关系图和变量；确有空间关系再用Three.js或Blender；精确标签、数值和字幕保持可编辑并与计算同源。

这些组合可在整片或一个镜头内混用。镜头间靠主体、动作、方向、尺度、色光或声音接力，不按工具分割成互不相干的章节。

## HDRI、世界照明与反射

[Poly Haven](https://polyhaven.com/license)是可选的HDRI、纹理与三维模型来源，不是照明引擎。其官方许可页源码与英文正文声明这些资产使用CC0，允许商用和再分发、不强制署名；来源与资产ID仍留在内部。网站／API访问规则与资产许可是不同事项，本参考不承诺无限采集、接口配额或替其他素材库推定许可。

HDRI可用于环境照明与材质反射，能否显示为背景、怎样形成阴影取决于实际引擎、材质和配置。Three.js的`Scene.background`与`Scene.environment`分别控制背景和环境映射；只显示一张背景图不能证明物体已经得到相同照明。Blender按World、材质与所选渲染器配置；根据镜头需要补主光、轮廓光、接触关系和局部控制。

在项目笔记保留所用HDRI／纹理／模型的原始入口、资产ID、许可、下载规格、本地路径和哈希。先用够用分辨率验证构图、环境方向和反射，再按输出需要提高规格；不默认下载最大文件。检查脸、金属／玻璃、暗部轮廓、接地、曝光、背景与主体分离，以及连续运镜中高光和阴影是否自然。不同引擎间不承诺灯光、材质、色彩管理无损等价；合成前核实际渲染。

合理使用的目标是本镜的质感、空间感与情绪得到可观察改善。按 [工具合同](production-tool-contract.md) 保留同镜头基线／候选，比较光向与色彩、主体轮廓、曝光、材质反射、接地及动态接缝，并记录加载／渲染代价；新方案更差时保留原方案。静帧不能验连续高光，下载／导入成功不能验美术效果。UltraHDR JPEG与固定压缩比仅为用户截图中的案例线索，未验证当前解码和导出前不设默认格式，也不固定“500KB”作为质量或体积标准。

## Blender MCP：交互创作的可选接入

指定的 [MCP for Blender](https://github.com/ahujasid/mcp-for-blender)是社区项目，README明确其非Blender官方出品。它由MCP服务与Blender内插件通过连接协作，可检查场景、执行Blender代码和获取视口截图，并包含Poly Haven素材接入。渲染和保存`.blend`仍需要真实执行并回读，不因MCP连接成功就视为场景或电影完成。

交互搭景与“检查 → 修改 → 看结果”循环可优先复用已接入MCP；可重复渲染和批处理也可用已有`bpy`／无界面脚本。先核已运行的Blender、场景归属、MCP服务、插件与协议版本；同一任务不重复启动服务，不接管用户未授权场景。接入缺失时按实际任务处理，不因读本参考就自动改全局配置或执行一键安装。

该项目支持执行Python代码，安全模式不是进程隔离保证。接入前核当前源码与配置的执行范围、外部生成服务、费用和数据流；只启用本次所需部分。已读源码中无详细数据同意时仍可发送最小匿名使用记录，不能称“默认完全无遥测”；提示词、代码／场景等详细采集与基础遥测分别检查。`DISABLE_TELEMETRY`等关闭变量的实际支持见当次源码，不能仅凭名称猜测。此处是针对该接入的事实边界，不改变用户现有设置或同意状态。

资产路线按“现有／缓存 → 授权库 → 适配 → 补缺口”执行。调用前区分Poly Haven状态、元信息查询、下载与导入；源码支持某命令不代表本机已接入，端口接通也不代表协议可用。项目回执记实际工具、请求范围、资产ID与导入scene，不将公开API搜索冒充MCP调用。轻量探测、缓存查询与记录校验用 [production_tools.py](../scripts/production_tools.py)，输入输出见 [制作工具合同](production-tool-contract.md)。

## 日语旁白与其他工具候选

工具表按任务查询，允许单用或组合：Blender负责角色、骨架、表情与适配；Mixamo是动作／角色来源候选，许可与重定向用前核；Unreal Engine是复杂环境、灯光与摄影机候选，先评估已有工程能否完成，收益明确才切换；Poly Haven提供环境与道具素材；已有ACE-Step 1.5承担BGM／歌曲制作，不能因此把它当所有语种的旁白引擎。这里不承诺Mixamo／Unreal当前许可、连接和实机兼容性已核验。

需要日语旁白时，可按用户约束与实际能力选AivisSpeech Engine。它是日语TTS候选，软件与声音模型的使用条件分别核；本地`/speakers`发现实际style，不硬编码某个人声。完整语义句／段生成、真实音频量时、声线与停顿听审后再组织字幕；引擎的WAV连接只是串接波形，不自动改善语气、呼吸或衔接。已有音频仅需拼接可复用FFmpeg／现有工程，不必安装整个语音软件。

原项目保留未使用的VOICEVOX歌声代码，不能据此宣称支持歌唱／Rap；实际引擎的歌手接口标不支持。以本次官方README与引擎实现为准，不把继承界面、旧文档或API类型当能力证明。旁白、音乐、演唱分别选路线，音轨改变后沿既有合同重验。

来源：[AivisSpeech README](https://github.com/Aivis-Project/AivisSpeech/blob/77a3675f7b76865cfa0253ac30f41ef1dd822e27/README.md)、[Engine API用法](https://github.com/Aivis-Project/AivisSpeech-Engine/blob/master/README.md)、[WAV连接实现](https://github.com/Aivis-Project/AivisSpeech-Engine/blob/2537cdbdda42b3554f1b873e8cc085e8c515d58f/voicevox_engine/tts_pipeline/connect_base64_waves.py)、[歌手接口](https://github.com/Aivis-Project/AivisSpeech-Engine/blob/2537cdbdda42b3554f1b873e8cc085e8c515d58f/voicevox_engine/app/routers/character.py)。2026-10-25已读相关范围，未本机合成或听审；DeepWiki对继承Sing Editor的支持推断与一手说明冲突，本方法以一手证据为准。

## Remotion的可复用合成与官方代理指导

按当前官方说明，将主题、镜头素材、标题、字幕、音轨与所需参数组织为可复用Composition；Sequence与媒体源区间从项目有效排程派生。保存源工程、依赖锁文件、素材清单与必要配置，不能只交MP4。

实际采用Remotion的项目先检查已安装的官方Agent Skills与版本，复用宿主已提供的指导；需要项目内安装时在实际渲染项目根目录按 [官方Agent Skills文档](https://www.remotion.dev/docs/ai/skills) 执行用户给定的入口：

```sh
npx skills add remotion-dev/skills
```

先核安装目标与作用范围，不在通用Context目录盲装，不覆盖本方法论或重复安装同名能力。官方指导属于可更新的项目／宿主能力，不把整套第三方Skill复制进本Skill；执行前按宿主安装规则核当前CLI选项。命令被文档收录不代表本机已执行或客户端已加载。

Three.js本身有动画剪辑、混合、骨骼和形变等能力，不把它说成“没有动画”；完整视频的排程、取帧和编码仍需工程组织。`@remotion/three`官方文档要求动画由`useCurrentFrame()`声明式驱动，避免直接依赖实时累积。资源准备、随机性和时间依据都要受控；`EffectComposer`管理后期pass，不自动保证时间确定性。具体媒体与ThreeCanvas API以本项目版本当前文档为准。

## 跨工具交接与真实MP4验收

每个镜头交接记录：源scene ID、工程版本／哈希、摄像机、帧率、帧范围、分辨率、源入出点与主片落点、是否带alpha、色彩／透明解释、依赖资产及声音职责。采用视频或图像序列前核双方实际支持；Blender材质无需跨引擎编辑时优先交预渲染媒体，不假称自动保留可编辑三维。

FFmpeg按实际需要编码、封装或选择流；显式核要保留的视频、音频、字幕与元信息，避免自动流选择遗漏必要声音。重编码后重查响度／真峰值、起止、时长、声画落点和全片解码；记录当前工程与最终文件哈希。

观看实际输出MP4，检查首帧、最密段、动作落定、表情姿势、运镜、转场和结尾；声音检查唱词、清晰度、主次、节奏、尾音与接缝。网页预览或视口截图不能替代最终MP4；解码通过也不能代替连续看听。可编辑`.blend`及相关资产、实际使用的Three.js源码、Remotion项目和最终文件按所选路线交付；没有用到的工程不硬造。未完成的听审、播放或理解检查如实记账。

## 一手来源与范围

- [Blender官方仓库](https://github.com/blender/blender)：DeepWiki结构及两次针对性问答，覆盖动画、骨骼、摄像机、World、Cycles与EEVEE；未本机运行这些能力，不提供未实测版本参数。
- [Three.js Scene源码](https://github.com/mrdoob/three.js/blob/dev/src/scenes/Scene.js)：已读背景／环境字段；动画与后期边界经仓库DeepWiki复核。
- [Remotion官方Agent Skills源文档](https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/ai/skills.mdx)、[ThreeCanvas源文档](https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/three-canvas.mdx)：已读，支持安装入口及帧驱动边界；预渲染媒体与运行三维的分工经仓库问答复核。
- [Poly Haven许可页源码](https://github.com/Poly-Haven/polyhaven.com/blob/master/pages/license.tsx)、[英文正文](https://github.com/Poly-Haven/polyhaven.com/blob/master/public/locales/en/license.json)：已读，区分资产CC0与网站代码许可；未取得动态服务条款全文。
- [Blender MCP README](https://github.com/ahujasid/mcp-for-blender/blob/main/README.md)、[遥测源码](https://github.com/ahujasid/mcp-for-blender/blob/main/src/blender_mcp/telemetry.py)：已读相关范围，具体安装与兼容性仍须任务当时核对。
- [FFmpeg官方文档](https://ffmpeg.org/ffmpeg.html)的[原始源码](https://github.com/FFmpeg/FFmpeg/blob/master/doc/ffmpeg.texi)：已读输入输出、选项作用范围与流选择说明；具体交付参数按项目核验。

检索日期2026-10-25；相关性依据为本轮指定的镜头与组合需求，权威性以官方源码／项目维护者说明的职责范围判断，创建／修改及访问互动指标未逐一取得，均不猜测。上述职责组合与镜头先行规则为本方法原创适配，文档研究不代表安装、实际三维试片、声音或跨工具成片验证。
