# 知识包合同

讲解抽象知识或资讯时，用一份知识包记录“依据什么规范、用什么词、哪个东西对应哪个概念、每个数字从哪来、按什么顺序讲、查过什么”。方法见 [物即解释](knowledge-visualization.md)、[逐层递进](layered-reveal.md)、[行业规范先行](domain-standards.md)。本文只讲字段、检查和接线。

知识包只检查结构、引用和文字的机械问题。它不能判断比喻是否贴切、事实是否为真、观众是否看懂；这些留在 `checks`，没做就保持 `not_run`。

## 放在哪里

- 嵌入计划：写在 `plan.knowledge`，同时在 `design.expression_ids` 记录用到的 `knowledge.*` 表达。`validate_plan.py` 会把场景、元素、旁白 ID 一并核对，并对旁白与元素文字做受控表达检查。
- 独立文件：只讲稿不做计划时，写成单独的 JSON，顶层加 `"schema_version": 1`，每层用 `script_ref` 指向讲稿里的对应段落。
- 没有知识包也能做视频。只有计划写了 `knowledge` 或选了 `knowledge.*` 表达时才触发这些检查；其他场景行为不变。

```text
python3 SKILL_ROOT/scripts/validate_plan.py plan.json                    # 含 knowledge 时自动一并检查
python3 SKILL_ROOT/scripts/validate_plan.py plan.json --strict-knowledge  # 知识类警告升为错误
python3 SKILL_ROOT/scripts/knowledge_pack.py plan.json                   # 只检查计划里的知识包
python3 SKILL_ROOT/scripts/knowledge_pack.py pack.json --plan plan.json  # 独立知识包对照某个计划
python3 SKILL_ROOT/scripts/controlled_lint.py --text-file script.txt --profile ste-zh-spoken --glossary pack.json
```

`--strict` 把所有警告当错误，`--today YYYY-MM-DD` 让核对日期检查可复现。

## 填写顺序

1. `topic`、`claim`、`relation_type`、`audience`：一句话关系和观众起点。
2. `domain`：先找标准并登记状态，再写术语卡。
3. `truth`：登记每个数字和事实。资讯包同时写 `unknown`。
4. `carrier`：选载体，写部件映射和断点；没有诚实载体就写回退。
5. `layers`：安排层次，每层一个新负荷，写桥接和退出测试。
6. 写旁白或画面，用 `controlled_lint.py` 查句长、术语和读音。
7. `checks`：真做了才改状态，并写证据。

## 字段

必填项以“必”标出。除另有说明，字符串都要求非空。

| 位置 | 字段 | 说明 |
| --- | --- | --- |
| 顶层 | `topic` 必、`claim` 必 | 讲什么；观众结束时能说出的一句话 |
| 顶层 | `relation_type` 必 | `process` `condition` `capacity` `hierarchy` `comparison` `feedback` `transform` `concurrency` `probability` `growth` `causal` `event` `definition` `other` |
| `audience` | `level` 必 | `novice` `practitioner` `expert`；`known`、`unknown` 为字符串数组 |
| `domain` | `field` 必、`standards` 必、`terms` | 领域名；标准卡；术语卡。`notation` 可记符号、单位、大小写约定 |
| `standards[]` | `id` `title` `kind` `status` 必 | `kind`：`standard` `terminology` `style-guide` `convention` `official-doc` `consensus` `none` |
| | `status` | `verified` 已核对；`seed` 种子来源，待核对；`not_found` 找过没有；`none` 确实不适用 |
| | `version` `locator` `checked_on` | `verified` 必填：核对了哪一版、哪一条、哪一天（`YYYY-MM-DD`） |
| | `url` `scope` `sources` | `consensus` 至少两个独立权威来源；`none` 与 `not_found` 要写 `reason` |
| `terms[]` | `id` `preferred` 必 | 首选词；`abbr` 缩写；`spoken_as` 口播读法 |
| | `definition` | 一句话定义；`known_to_audience: true` 时可省略 |
| | `standard_ref` 或 `source` | 词来自哪条标准或哪里；二者至少有一个 |
| | `aliases_forbidden` | 禁用别名，口播与画面都不得出现 |
| | `define_on_first_use` `known_to_audience` | 布尔值；前者为 `false` 时不查首次定义 |
| `expression` | `profile` 必 | `ste-zh-v1`（字幕、铭牌、图注）、`ste-zh-spoken`（旁白）、`none`（须写 `reason`） |
| | `limits` `pronunciations` `allow` `vague_extra` | 覆盖句长上限；字母与缩写读法；本片放行的检查码；追加的含糊词 |
| `carrier` | `kind` 必 | `object` `spatial` `process` `data` `diagram` `none`；`none` 只需 `reason` |
| | `object` `mechanism` `fallback` 必 | 载体是什么；怎样运作；载体不成立时退回什么 |
| | `limits` `mappings` | 总断点；映射表。`object` 至少 3 项，`spatial` `process` `data` 至少 2 项 |
| `mappings[]` | `id` `concept` `part` `breaks_at` 必 | 一个概念对一个部件；比喻在哪里会骗人 |
| | `fidelity` 必 | `exact` `structural` `illustrative` |
| | `questions` 必 | `what` 与 `why` 必填；`happening` `use` 可选 |
| | `element_id` `layer_id` | 画面里的元素；首次登场的层 |
| `truth.claims[]` | `id` `text` `kind` 必 | `sourced` `derived` `illustrative` |
| | `sourced` | `standard_ref` 或 `source`；资讯包还要 `as_of` |
| | `derived` | `derivation` 与 `from`（来源 claim 的 ID，不得成环） |
| | `illustrative` | `disclosure`：内部记录示意用途、依据与不能支持的结论；不渲染为对外制作标签 |
| | `value` `unit` `as_of` `used_in` | 数值要有单位；日期；用到它的旁白或元素 ID |
| `truth.unknown[]` | `id` `text` `status` 必 | `unconfirmed` `disputed` `unknown`；`reason` 写为什么还没确认。资讯包必填，没有时写 `truth.unknown_none_reason` |
| `layers[]` | `id` `level` `goal` `new_load` `exit_test` 必 | `level` 为 `L0` 到 `L6`；末层必须是 `L6` |
| | `bridge_from_previous` | 除第一层外必填：上一层的什么变成这一层的什么 |
| | `scene_ids` `focus_element_id` | 嵌入计划时必填；`L2` 到 `L5` 还要一个点亮的元素 |
| | `script_ref` | 独立文件时必填，指向讲稿里的层标记 |
| | `claim_ids` `element_ids` `chapter` | 本层用到的 claim 与元素；长片可用 `chapter` 重新爬层 |
| | `model_boundary` `extension_pointers` | `L6` 必填：没演示什么、比喻哪里骗人；往哪里继续读 |
| `checks` | `terminology` `accuracy` `novice_read` `peer_read` `expert_read` | 每项 `{status, evidence}`；`status` 为 `not_run` `passed` `partial` `failed` |

`passed` 必须有证据，写清实际做了什么、谁、什么时候。没有做过的检查不要写成 `passed`。

## 检查码

错误会让 `valid` 为 false；警告标 (w)，在严格模式下升为错误。

| 范围 | 检查码 |
| --- | --- |
| 结构 | `pack_type` `schema_version` `object_type` `array_type` `string_array` `boolean_type` `required_string` `stable_id` `duplicate_id` `placeholder_text` `template_text` (w) `relation_type` `audience_level` `notation` |
| 标准 | `standards_required` `standard_kind` `standard_status` `standard_none_status` `consensus_sources` `verified_incomplete` `checked_on_format` `checked_on_future` `stale_standard_check` (w) `standard_unverified` (w) `no_verified_standard` (w) |
| 术语 | `no_terms` (w) `term_standard_reference` `term_source_required` `duplicate_term` `alias_conflict` `alias_is_preferred` |
| 表达 | `expression_profile` `expression_limits` `pronunciations`，另转发 [受控表达检查码](domain-standards.md) |
| 载体 | `carrier_kind` `mapping_count` `mapping_fidelity` `mapping_questions` `unknown_question` (w) `mapping_not_one_to_one` `mapping_layer_reference` `mapping_element_reference` |
| 真值 | `claims_required` `claim_kind` `claim_source_required` `claim_standard_reference` `claim_on_unverified_standard` (w) `claim_from_required` `claim_from_reference` `claim_cycle` `claim_value` `claim_unit` `claim_as_of` `claim_used_in_reference` `number_not_in_ledger` (w) |
| 资讯 | `event_claim_as_of` `unknown_required` `unknown_status` |
| 层次 | `layers_required` `layer_level` `layer_order` `first_layer` `bridge_required` `multiple_new_loads` (w) `layer_claim_reference` `layer_scene_required` `layer_scene_reference` `focus_required` `focus_reference` `layer_element_reference` `layer_unanchored` `closing_layer_required` `closing_incomplete` `run_without_numbers` (w) `run_not_grounded` (w) `scene_without_layer` (w) |
| 检查 | `check_status` `check_evidence` `unknown_check` (w) |
| 计划接线 | `knowledge_pack_missing` (w) `knowledge_expression_unrecorded` (w)，另外选了 `knowledge.*` 却找不到对应 ID 时由计划合同报 `design_reference` |

### 几条容易误解的规则

- 一个概念对一个部件，反过来也一样；同名概念或部件出现两次，报 `mapping_not_one_to_one`。
- `seed` 状态的标准能用，但每个引用它的 claim 都会收到警告；先核对再宣称准备就绪。
- 日期超过 365 天的 `verified` 会收到 `stale_standard_check`：标准会修订，要重新查当前版本。
- `number_not_in_ledger` 只扫两位以上的数字，不扫个位数；它防的是“画面上出现了账本没登记的数字”。
- 受控表达检查对旁白和元素文字各查一遍，两者相同时只报一次。
- 首次出现术语时要有定义：同句有“是指、表示、就是、是一种”这类提示，或下一句以该术语或“它、该”开头并给出定义。不满足就报 `undefined_on_first_use`。

## 示例

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| [tcp-handshake.plan.json](../examples/tcp-handshake.plan.json) | 真实事实的机制类：载体是“对账台”，标准取自 RFC 9293 §3.5 | 结构示例，未生成视频；事实于 2026-10-19 核对 |
| [evidence-board.plan.json](../examples/evidence-board.plan.json) | 资讯类：证据板；事件与数字均为虚构 | 虚构示例，不得当新闻发布 |
| [correlation-common-cause.knowledge-pack.json](../examples/correlation-common-cause.knowledge-pack.json) | 无诚实载体时退到关系图；独立知识包，可单独校验，也可用 `--plan` 对照已有计划校验 | 虚构场景。单独校验无警告；对照计划时会因计划里的分号报一条 `semicolon` 警告，这是预期的 |

模板见 [knowledge-pack.json](../templates/knowledge-pack.json)；评测提示见 [knowledge-method-evals.json](../evals/knowledge-method-evals.json)。
