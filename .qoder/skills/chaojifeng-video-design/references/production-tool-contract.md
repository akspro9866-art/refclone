# 制作工具与项目工件合同

本合同将资产优先、工具选择、HDRI对照和日语旁白落到可复用工具。复用现有plan的scene／asset／beat身份与时间，不新增主计划必填字段。工具不安装软件、不启动渲染器、不下载模型或更改场景；实际制作仍由宿主已授权的能力完成。

## 先按任务查职责，再探测能力

工具表为 [production-tools.json](../catalog/production-tools.json)，`tasks`说明适合的职责，`adapter`说明本脚本提供的动作。`candidate`仅为待核候选，`guidance`仅给选择指导；`verification=not_run`不是永久不可用，也不能改成“已安装”。具体状态写本次项目回执，不把本机状态写死进工具表。

```text
python3 SKILL_ROOT/scripts/production_tools.py list --task environment
python3 SKILL_ROOT/scripts/production_tools.py list --task japanese-narration
python3 SKILL_ROOT/scripts/production_tools.py probe
python3 SKILL_ROOT/scripts/production_tools.py polyhaven-search --query studio --type hdris --limit 5 --cache-dir /project/video/cache/polyhaven
python3 SKILL_ROOT/scripts/production_tools.py aivis-speakers
python3 SKILL_ROOT/scripts/production_tools.py check /project/video/production-job.json
python3 SKILL_ROOT/scripts/production_tools.py check /project/video/production-job.json --require-reviewed
```

JSON输出保存到项目，不能用终端打印代替项目留证。`list`返回职责候选，不自动创建固定流水线；Agent按本镜意图选单个或多个工具，记录理由。Mixamo／Unreal是候选，当前许可、资源与接入用前核对；已有Blender／Three.js能完成时不强制切换。日语旁白与BGM分流，ACE-Step保留音乐职责，Aivis不承诺歌唱或Rap。

`probe`仅检查常见本机入口与默认端口；TCP接通不代表协议、插件、模型、权限或音色已经可用，其他配置端口未覆盖时补记范围。它不连接用户场景执行命令，不启动重复服务。`aivis-speakers`仅访问本地引擎的`/speakers`，取得实际speaker/style信息，不硬编码某个style ID，不生成或试听音频。

`polyhaven-search`只取公开API的元信息，返回少量排序候选与原始页，保持来源顺序，不把排名分数当美术质量。使用项目自有缓存，默认本地缓存1小时以减少重复请求；这是本工具的节流策略，不代表服务端配额。响应限制2MB，429／503等错误原样报告，不自动重试，遵从Retry-After和任务预算。元信息成功不标为MCP检索、下载、导入、使用权复核或画面通过。

网站操作仍按宿主浏览器路线；适用的API／MCP走当前有证据的接口。资产下载和MCP导入按实际工具与授权另执行，不从只读探测推导修改场景或安装的授权。

## 用一个项目工件关联决定与证据

复制 [production-job.json](../templates/production-job.json)到项目，沿本次需要填写。空模板只是一份草稿，校验会提示无生产证据；未使用的数组可留空。需要绑定主计划时添加`plan_path`与`plan_sha256`，前者相对于工件目录，后者绑定主计划当前原始字节。主计划改变后重新核关联，不复制一份竞争时钟。

### 工具选择 `tool_choices[]`

每项含`id`、工具表中的`tool_id`、对应`task`、本镜`reason`；按需附`scene_ids`与实际能力回执路径。工具文档、当前接入、实际执行、产物与质量验收分别留证，不用一个“可用”状态合并。

### 素材 `assets[]`

| 字段 | 约定 |
| --- | --- |
| id | 沿plan资产ID；纯内部候选用独立ID，录用后建立映射 |
| role | event-proof／illustration／model／motion／environment／material／audio |
| action | reuse／library／adapt／generate／scratch |
| origin | project／user／library／generated／procedural；与实际来源一致 |
| status | planned／ready／unavailable；ready只表示文件就绪 |
| source、rights | 原始入口／资产ID与实际使用依据，不用“公开可见”代替许可 |
| path、sha256 | ready时必需，路径相对本工件目录；校验流式核哈希 |
| search | generate／scratch前记status=completed或blocked，以及实际查过的sources数组 |
| gap_reason | 为何已有资产不适用、为何需制作缺口；生成／从零时必填 |

模型、角色、动作、HDRI和纹理先查项目／缓存，再查许可合适的资产库，优先适配，最后只补缺失部分。检索受阻时如实记阻塞与替代表达，不伪造“查完”。角色按比例、骨架、蒙皮、面部控制检查；动作按重定向、脚底、手部接触和节奏检查。适配记录、源到派生关系与导入scene ID可以放在同一素材行，不再新建重复素材台账。

event-proof必须保留原始证据；生成或程序搭出的现场不能证明事件发生。关系图、创作模型与环境按其真实角色登记，不能用更漂亮的资产扩大事实主张。

### HDRI与画面 `lighting_reviews[]`

每项含`id`、`scene_id`、环境`asset_id`、`status`（not_run／passed／partial／failed）、实际`scope`（still／clip）和`finding`。通过时提供不同的`baseline_evidence[]`、`candidate_evidence[]`本地证据文件，改名的相同内容会被拒绝；证据应来自同一镜头、相同构图和相当的输出条件，明确只改变了什么。若同时更换光、材质和曝光，就记录多变量修改，不能归因于HDRI一项。

在finding或随附记录中分别描述：光向／色彩、曝光、轮廓与主体分离、材质反射、接地阴影、空间感、连续运动中的高光与接缝，以及下载／加载／渲染成本。可以保留原方案或判新方案更差，不要求每镜一定更换HDRI。背景与照明分开核，资产存在不等于合理使用；只有静帧时不能把`motion_continuity`写成passed。

先用够用规格做对照，再为镜头需要提升规格。用户截图中“20MB压到约500KB UltraHDR JPEG”只作为案例线索，不成为默认压缩比、格式或效果承诺；使用前另核当前执行器、解码、亮度范围与实际导出结果。

### 日语旁白 `voice_jobs[]`

每项含`id`、`language`、`mode`、`tool_id`、`status`、显式`listening`记录。Aivis分支为`language=ja`、`mode=narration`，模型／音色的使用依据写`model_rights`；ready时给实际`path`和`sha256`。选中候选、软件存在、style发现、生成成功和听感认可各自记录。

用完整语义句／段生成，统一音色和风格，真实音频先量时再排字幕。Aivis引擎可连接WAV，但拼接不自动改善停顿、呼吸、音量与声线；已有音频仅需拼接时可复用FFmpeg或既有工程。听审通过先要求音频ready且哈希匹配，再需`listening.status=passed`、`method=listened`或`user-feedback`及`evidence[]`实际记录路径；ASR／波形／拼接退出码不能代替。字幕与音轨变更仍按既有声音合同重验。

Aivis程序许可与声音模型条件分别核实，不能由免费软件推定任意声音用途。未接入、没有合适模型或不支持的歌唱任务准确报告缺口；候选不自动切付费服务或下载模型。来源见 [场景与工具组合](scene-tool-composition.md#日语旁白与其他工具候选)。

## 校验边界与实际交付

`check`返回valid、errors、warnings与`scope=declared-production-evidence-only`，检查工具／任务匹配、素材优先记录、事实画面来源边界、文件哈希、计划漂移、对照证据与声音验收声明。它不联网核许可证、不理解像素、不听声音、不证明记录真实；即使声明有passed，它自己的`media_review`仍为not_run。

默认允许带未审项的草稿并给warning；`--require-reviewed`将已登记灯光／听审的未完成项判为错误，空工件也失败。只覆盖本工件登记的范围，不能替代整片知识、阅读、声画、连续播放与交付检查。实际录用、审片与返修沿 [审片与修改](review-and-revision.md) 执行，最终仍交真实MP4、必要可编辑源与产物一致性记录。
