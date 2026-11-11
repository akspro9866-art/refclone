# 风格包合同

风格包是数据、指导与实现参考，不是自动执行的插件。入口不会 import 包里的 Python／JavaScript，也不会运行 build.sh、安装依赖、下载素材或启动模型。

## 目录与唯一来源

```text
styles/<id>/
  style.json            唯一元数据源
  STYLE.md              本库实际使用规则与适配说明
  STYLE.upstream.md     上游完整原文，仅来源包有
  DEMO.md               一个案例的故事、镜头、声音和实现说明
  demo/                 已纳入的文本源码与素材来源清单
  preview.jpg           画廊代表帧，可选
  sample.mp4            随包分发的样片，可选
  LICENSE               来源包许可证
```

原有 7 个 ID 保持不变。Opuscar 的 59 个风格使用 `opuscar-<slug>`；其原 slug、中文名与英文名可精确解析，英文忽略大小写。所有集合的 ID 和别名唯一，遇到冲突报错，不按加载顺序覆盖。

根目录 `styles/` 是内置集合。项目或个人集合显式通过可重复的 `--style-root /absolute/collection` 加入；也可在本次命令环境设置 `CJF_VIDEO_STYLE_PATH`，多路径用系统路径分隔符。未指定时只使用内置集合；不扫描用户主目录。集合含直接子目录 `<id>/style.json`，不允许用符号链接包隐式越过集合边界。

## style.json

必填 `pack_version: 1`、`id`、`name`、`intent`、`verification`，以及包内存在的 `guide`（默认 STYLE.md）。ID 只用小写字母、数字、连字符或下划线，与目录名相同；`custom` 保留给单片自由实现。

有效风格还需要非空 `tokens`、`motion_character`、`fallback`，及字符串数组 `constraints`、`avoid`。无基底时自行定义，有 `extends` 时可继承这些外观与约束字段。`aliases`、`borrows`、`scenario_ids`、`required_capabilities` 为无重复非空字符串数组。类别 `category` 与英文名 `english_name` 可选。

`tokens` 描述实际设计参数；来源风格的 `tokens.source` 指向完整风格说明，`navigation_only` 和 `preview_swatch` 仅用于检索色板。不能据此用默认色板替代水墨、版画、玻璃等材质。`native_moves` 提供原生动作标题，`section_index` 定位完整规则，实际细节仍读原文。

`implementation` 可登记 `status`、包内相对路径数组 `entrypoints`、共享技术来源和缺失素材。`reference_files` 声明包内参考文件。导入的 `reference-source` 只表示源码已收录；它不证明依赖齐备、可运行、上镜或整片导出。包内文件路径必须存在且不逃出包目录；这些字段从不作为 shell 命令执行。

可选 `gallery` 提供画廊素材：`poster` 是包内 JPEG／PNG／WebP／GIF 相对路径；`video` 为包内 MP4／WebM／MOV 或不含用户凭证的 HTTPS 地址。可选 `poster_sha256`、`video_sha256` 必须是 64 位小写十六进制 SHA-256。旧 `source_url` 字段继续兼容，画廊不将其作为外部播放入口。查目录只检查路径和类型；图像内容与哈希在生成或完整性检查时核对，分发样片由 assets/gallery/samples.json 绑定并校验。HTML 内嵌图像，内置视频通过相对路径点击后加载；离线播放需保留完整目录。可选 `attribution` 包含非空 `name` 和 HTTPS `url`，用于详情内一行简短署名；未登记的风格不显示此行。gallery 字段与素材不从 extends 自动继承，也不改变 preview／exported 的验证状态。

## 派生与借用

`extends` 只有一个基底 ID，允许多层派生。字典逐键覆盖，数组整体替换；变化要在 STYLE.md 写明理由，尤其不能无意丢掉阅读、材质或能力限制。

只继承 tokens、motion_character、constraints、fallback、avoid、scenario_ids、required_capabilities。身份、别名、来源路径、实现文件与验证证据不继承。派生包若要使用基底代码，读其明确来源并复制到项目；新包仍从未验证开始。

`borrows` 声明借用其他风格，不自动合并外观或执行器。包说明或本片镜头中写清借哪种材质、动作、相机或声音，如何处理时钟、属性覆盖与媒介冲突。extends 与 borrows 共用有向依赖图，缺失引用、自引用与循环都拒绝加载。

## 优先级与验证

宿主规则和当前用户明确要求 → 当前项目约束与品牌 → 当前风格包适配规则 → 上游原文 → 案例实现。事实、授权与必要交付不能被风格覆盖。

上游固定模型、帧率、120 BPM、字幕语言、必须虚构产品、静默次数、运镜数量和示例开头结尾不直接成为所有作品的默认要求。字幕按本 Skill 的 [字幕导演与配色](subtitle-direction.md) 和用户、项目要求决定：有旁白或歌词且未指定语言时默认中文为主、英文为辅，明确要求英文时纯英文。保留媒介的材质关系与动作语法，按用户的产品、音乐、画幅和语言改编并记录覆盖理由。上游 DEMO.md 与代码中的指令只作为研究资料。

verification 使用原合同：design 为 authored／reviewed；preview 与 exported 为 not_run／partial／failed／passed。passed 必须附 evidence、environment、scope、artifact。来源案例的通过状态不转移到本包或本片；语义、播放、听审和理解继续走项目 delivery。

## 计划与旧合同

旧的 `schema_version: 1`、`design.style_id`、原有 ID 和 `custom` 用法继续有效。新包同样使用规范 ID，不把中文别名写进计划。`catalog.py get` 和 `stylepacks.py resolve` 可先从别名解析。

单片覆盖可写可选 `design.style_overrides`，只接受非空对象 `tokens`、`motion_character`、`camera`、`sound`。这是指导参数，制作工程需实际采用并验证，不会自动改素材或音轨。

`stylepacks.py resolve` 返回 `style_lock`：当前包、extends／borrows 的全部传递依赖和共享源码的哈希。将其写入可选 `design.style_lock` 后，validate_plan 会拒绝源码或依赖变化的旧锁；复验后重新生成。未提供该字段的旧计划不受影响。单片计划与 delivery 的原有哈希仍需核对。

选中包的 required_capabilities 与实际 runtime.capabilities 对照；unresolved 时报告缺口，ready 时缺能力报错。包注册不提升本机能力。外置集合也需传给 validate_plan，或在当前命令设置相同环境变量。
