# STYLE

<!-- 一页纸的设计系统，从立意推出来（playbook/12-ideation.md）。subagent 并行时，这份文件和 STORYBOARD 一起作为契约。没想法的地方从 playbook/03-motion-design.md 的默认值起步；和默认做法不同、有协作价值的决定记进 DECISIONS.md（12 第 6 节）。 -->

## Canvas
- Size {W}x{H}, fps {fps}; safe box x {..–..}, y {..–..}; caption band y {..–..} (keep faces/key action above it)
- Grid (optional, Code2Video style): animation area {x0,y0,x1,y1} divided 6×6, anchors A1–F6; place objects only via grid helpers; labels within 1 cell of their object

## Palette
| token | hex | 用途 |
|---|---|---|
| bg | | |
| fg | | |
| accent | | 强调色：默认一个，同一时刻只有它饱和；立意要几个颜色时每个一行，写明意思 |
| muted | | 次要元素、基线 |
| {entity colors} | | 讲解类：一个概念一个颜色，全片不变 |

- Color arc（按幕，可选）：{act 1 冷白 = 未知、安静 → act 2 琥珀 = 系统在运转 → act 3 红 = 高潮、警报}。每一幕写出主色调和它的含义，与 STORYBOARD 的 World 一行一致

## Type
- Display: {font}, weights {..}; Body/caption: {font}; Mono: {font}
- Sizes: title {..}px, body {..}px, caption {..}px; tracking {..}em
- Font files: {assets/fonts/… or system}

## Motion tokens
<!-- 运动的语域从立意来：平滑的长尾、机械的台阶、卡通的过冲、手持的抖动都行，写清楚是哪一种。没想法时从 playbook/03 §1–2 的默认值起步。 -->
| token | value |
|---|---|
| register | {e.g. smooth long tails; overshoot only for character reactions} |
| enter | {…} |
| exit | {…} |
| move / camera | {…} |
| stagger | {…} |
| hold before climax | {…} |

## Transitions (pick 2–3, reuse)
- {e.g. brush wipe at chapter breaks}
- {e.g. match cut on shape}
- Dominant direction: {left / up / push-in}

## Not in this film
- {from the concept: what this film won't do, and why. playbook/03 §0 lists what videos look like when nothing was chosen}
