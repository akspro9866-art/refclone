# 行业规范先行：先找共识，再开口

讲解涉及专业领域时读取。先找这个领域最合适的标准、术语规范和行业共识，再用它们写稿和画图，让表达更简短、准确，也让 Agent 不凭印象改写行业术语。适用于口播、字幕、铭牌和图注；不是文案风格指南，创意文案可按末节例外处理。

## 为什么

飞机维修手册靠 ASD-STE100（简化技术英语）这套受控语言，让不同母语的人读到同样的意思。它的做法是：用有限的规则和一份受控词表，把信息写准。公开讨论里常把同一思路概括为“受控语言 → 图 → 网页 → 视频”的升级阶梯（只读到二手转述，未取得原帖，不作一手来源）。本 Skill 借的是这条思路：每升一级媒介，都复用同一套术语、数字和规则，而不是每一级重新措辞。

边界必须守住（官方 Issue 9，2025-01-15，核对于 2026-10-19）：

- STE 不能单独使用，需配合技术出版规范、风格指南和官方指令。
- STE 不规定缩写、计量单位和排版，这些由项目或行业规范决定。
- STE 只为技术文档开发；官方只说它的规则和受控词表“可以帮助”会议与演示中的口头交流，并不是口播规范。
- 本 Skill 的 STE-zh 是自行改编的中文规则集，不是 ASD 官方标准，数字阈值也不是 ASD 数字，不得声称“符合 ASD-STE100”。

## 四步

```text
 ① 识别领域 → ② 找规范与共识 → ③ 写成术语卡与表达规则 → ④ 全片遵守并核对
  domain.field   domain.standards     domain.terms / expression     controlled_lint.py
```

1. 识别领域：写进 `domain.field`。跨领域时分开登记。
2. 找规范与共识，按优先级读：国际标准或 IETF RFC > 国家标准 > 行业协会、官方文档 > 权威教材与术语库 > 历史行业共识。读现行版本，记下版本、位置和核对日期。
3. 写成术语卡：每个术语写首选写法、定义、禁用别名、缩写、读音。写成表达规则：选 `expression.profile`，需要时放宽或收紧句长，补读音表。
4. 全片遵守：口播、字幕、铭牌、图注都用同一个词；用 `controlled_lint.py` 查机械问题；定稿前再核一次现行版本。

找不到合适标准时，如实写 `kind: none` 与理由，只做本片的术语卡；不要编一个标准名字出来。

## 来源状态

| status | 含义 | 要求 |
| --- | --- | --- |
| verified | 本次已读原文，核对过版本与位置 | 必须有 `version`、`locator`、`checked_on`；超过一年提示重查 |
| seed | 只是起点，没读过原文或只读过摘要 | 使用前必须核实版本、条款与现行状态；基于 seed 的 claim 会被提示 |
| not_found | 找过，没有合适来源 | 必须写 `reason` |
| none | 此领域没有适用标准 | 与 `kind: none` 一起出现，必须写 `reason` |

`kind` 可选 standard、terminology、style-guide、convention、official-doc、consensus、none。选 consensus（历史行业共识）时，至少列两个相互独立的权威来源。不复制标准的长篇原文，只记位置和必要的短语。

## 领域起点表

只是起点。标“已核对”的在 2026-10-19 研究时读过；“种子”没有读过原文。两类在使用时都要按现行版本再核一次，国家标准尤其如此（例如量和单位的 GB 3100/3101/3102 系列正在修订更替，现行编号与版本使用前必须核实）。

| 领域 | 起点来源 | 状态 |
| --- | --- | --- |
| 网络协议 | IETF RFC，以 rfc-editor.org 现行版本为准；例：RFC 9293（STD 7，2022 年 8 月，取代 RFC 793） | 已核对 RFC 9293 的 §3.5、图 6、图 8 |
| 技术写作与受控语言 | ASD-STE100 Issue 9（2025-01-15） | 已核对规则号与适用边界 |
| 通用清晰表达 | ISO 24495-1:2023 Plain language，第 1 部分：指导原则与指南 | 已核对存在与主题，条款用前读原文 |
| 多媒体学习 | Mayer 多媒体学习原则（第 2 版 12 条，第 3 版 2020 年 15 条） | 已核对条数，用前注明采用哪一版 |
| 汉语标点与数字用法 | GB/T 15834-2011、GB/T 15835-2011 | 已核对编号，用前确认现行有效 |
| 汉语科技术语 | 全国科学技术名词审定委员会“术语在线” | 已核对入口，具体术语逐条查 |
| 解剖学 | Terminologia Anatomica 第 2 版（FIPAT，2019） | 已核对 |
| 电气图形符号 | IEC 60617 | 已核对 |
| 安全标志与颜色 | ISO 7010:2019、ISO 3864-1 | 已核对 |
| 齿轮与轴测制图 | ISO 1122-1:1998、ISO 701:1998、ISO 5456-3:1996 | 已核对 |
| 量与单位 | BIPM《SI 手册》、ISO 80000 系列、国际计量学词汇 VIM | 种子 |
| 化学 | IUPAC Gold Book | 种子 |
| 软件与系统工程术语 | ISO/IEC/IEEE 24765 | 种子 |
| 建模符号 | UML、BPMN（OMG） | 种子 |
| 航空通话 | ICAO 标准用语 | 种子 |
| 新闻写作与核查 | AP Stylebook、路透社手册、新华社新闻信息报道中的禁用词和慎用词；IFCN 原则守则 | 种子 |
| 数据可视化 | Cleveland–McGill 感知排序、FT Visual Vocabulary | 种子 |
| 可访问性与配色 | WCAG、Okabe–Ito 色盲友好配色 | 种子 |
| 类比与认知负荷 | Gentner 结构映射、Lakoff–Johnson 概念隐喻、Sweller 认知负荷、预测—观察—解释 | 种子 |

## STE-zh：受控表达

`controlled_lint.py` 只查机械问题：句长、分号、被动、含糊词、首次出现的术语是否定义、禁用别名、口播读音。它不判断事实是否正确、比喻是否贴切，也不判断观众是否看懂。

| 检查码 | 来自 STE 的哪一条 | 中文改编 | 默认级别 |
| --- | --- | --- | --- |
| sentence_over_target / sentence_too_long | 5.1 程序句 ≤20 词；6.3 描述句 ≤25 词 | 按字数：描述与注释 22/30，程序与警告 18/24（目标/硬上限） | 超目标为提示，超硬上限为警告 |
| too_many_sentences | 6.6 段落 ≤6 句 | 每段 ≤6 句 | 警告 |
| semicolon | 8.1 不用分号 | 同 | 警告 |
| passive_marker | 3.6 用主动语态 | 检测“被”字句 | 警告；口播档为提示 |
| multiple_instructions | 5.2 一句一个指令 | 程序句、警告句里含并列动作的连接词 | 警告 |
| forbidden_alias | 1.11 不用不同的技术名词指同一事物 | 术语卡的 `aliases_forbidden` | 错误 |
| undefined_on_first_use | 1.8 用本领域认可的技术名词 | 首次出现要有定义（本 Skill 补充） | 警告 |
| vague_word、unclear_reference | 精神相近，无直接条文 | 含糊词表、句首代词 | 警告、提示 |
| colloquial | 1.10 不用俚语和行话 | 口语词表 | 技术文字档警告；口播档关闭 |
| missing_pronunciation、symbol_in_speech | STE 不管口头表达 | 口播档补充：没有读音的外文词、口播里的符号 | 警告、提示 |
| placeholder_text | 无 | TODO、待填写、待补充、TBD | 错误 |

句长数字为听感推算：每秒约 4–5 个字，硬上限 30 字约 6–7 秒。项目可在 `expression.limits` 覆盖。STE 的受控词表（第二部分）这里不复制，用术语卡代替：只管本片用到的词。

两个档位：

- `ste-zh-v1`：技术文字、字幕、铭牌、图注。
- `ste-zh-spoken`：口播与旁白。允许亲切口语，但术语、句长和读音仍受控。

```text
python3 SKILL_ROOT/scripts/controlled_lint.py --text-file script.md --profile ste-zh-spoken --glossary pack.json
python3 SKILL_ROOT/scripts/controlled_lint.py --text-file script.md --glossary pack.json --emit-speech speech.txt
```

`--glossary` 可以是知识包，也可以是内嵌 `knowledge` 的计划。`--emit-speech 文件` 在检查通过后，把读音表应用到稿件，写出可交给语音合成的文字；目标文件已存在时拒绝覆盖，也不判断读对了没有。稿件里可用单独一行的 `<!-- kind=procedure layer=L2 id=seg-03 defines=term-a lint=off speak=off -->` 给下一段标注类型、层级和已定义的术语，或关闭检查与朗读。

## 读音词典

语音合成常把英文缩写读错。口播里出现的外文词、缩写，要在 `expression.pronunciations` 或术语卡的 `spoken_as` 里写明读法，例如“SYN”写成“S Y N”。`plan.scenes[].narration[].spoken` 写读音表处理后的最终读法，`display` 写字幕的规范写法，两者不同是正常的。数字里像编号的（如标准号）也单独写读法。

## 例外

创意文案、诗化旁白、品牌口号可以把 `expression.profile` 设为 `none`，并写下 `reason`。规范让位于观众理解：不要为了通过检查，把自然的话改成别扭的话。通过检查不证明讲得好；是否讲得好，靠新手读者和懂行读者的检查（见 [知识包合同](knowledge-pack.md)）。

## 最小术语卡

```json
{
  "id": "term-seq", "preferred": "序号", "abbr": "SEQ",
  "definition": "发送方给报文段编的号",
  "standard_ref": "std-rfc9293", "aliases_forbidden": ["序列号"]
}
```

首选写法、禁用别名与缩写在整片内统一；定义要短，要写成观众能直接说出口的话。
