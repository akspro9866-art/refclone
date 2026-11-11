# DECISIONS：谁拍板，定了什么，为什么

<!-- 导演模式的账本（CLAUDE.md"导演模式"），也是项目里记创作决策的唯一地方：立意、引擎、风格、结构、偏离 BRIEF 的地方、立意改写了哪些口味默认（TASTE_CHECKLIST 里没标【底线】的条目、playbook/03 的运动默认值、类型的语域和节拍；规矩见 playbook/12 第 6 节），都记在这里；
     NOTES.md 只记事实核对、自评和素材台账。上表每件事一行：谁拍板、定了没有、在哪看。
     下面按时间记 agent 定的事，每条带理由和翻案的代价，人随时可以翻。人自己说的话记在 REVIEW.md。 -->

Director: {照抄 BRIEF 的 Director 行；没写就写"按 {effort} 的默认"}

| 决定 | 谁拍板 | 状态 | 在哪看 |
|---|---|---|---|
| concept 立意 | {own / review / delegate} | {待定 / 已定（关卡 ①）} | {REVIEW.md 关卡 ①；立意卡在 out/review/gate-1.html} |
| spec 规格 | | | {BRIEF 的 Spec 几行} |
| outline 大纲 | | | |
| style 风格 | | | |
| character 主角 | | | |
| theme 主旋律 | | | |
| voice 配音 | | | |
| script 旁白稿 | | | |
| hook 钩子 | | | |
| storyboard 分镜 | | | |
| rhythm 剪辑节奏 | | | |
| packaging 标题封面 | | | |

## agent 定的事

<!-- 一条一行：日期 · 决定 · 定了什么 — 理由 — 翻案：改哪里、要花多少。
     作废的不删：整行划掉，后面注明原因，改后的另起一条，例如 `- ~~2026-10-03 style · 夜色画面 — 理由：…~~（关卡 ① 后作废）`。审阅台把划掉的收进"已经作废的"。 -->
- {YYYY-MM-DD} engine · {HyperFrames} — 理由：{…} — 翻案：{…}
- {YYYY-MM-DD} 转场 · 段落之间经黑场淡出再淡入，各 0.6 s，不叠字；一个画面停 6–15 s，旁白在走 — 理由：书信体，段落之间是翻页，不是切换；写在关卡 ① 批过的立意卡 B 上 — 翻案：换回硬切或带承载物的转场，约 20 分钟（只动转场）
- {YYYY-MM-DD} voice · {Qwen 女声 Serena，语速约 4.5 字/秒} — 理由：{…} — 翻案：重跑 `bin/vh tts`，约 5 分钟；每句的起止会变，要重新锁时（E3）
