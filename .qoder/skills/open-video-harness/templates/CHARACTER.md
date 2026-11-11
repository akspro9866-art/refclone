# CHARACTER：主角 / 主体设定

<!-- 片子有主角，或有一个反复出现的主体（一颗卫星、一只猫、一个产品）时写：导演模式里的 character，最早在检查点 E0。
     先出一张设定图给人看，定稿以后每个镜头都照它画。主体在故事里怎么保持一致、怎么变化，见 playbook/09-narrative.md 的"主体一致性：Subject Bible"。 -->

**一句话**：{谁；在片子里干什么；三个词的性格或功能}

## 设定图（人看这一张）

`out/review/character-sheet.png`，一张图放下：
- **三视图**：正面、侧面、背面（扁平 2D 至少正面加侧面）；
- **表情 / 状态**：3 种，每种写一句什么时候用（例如 平静 = 讲解时，警觉 = 收到预警，松口气 = 错开之后）；
- **比例**：和片中的关键道具同框，写成一句尺寸关系（例如 面板展开宽 = 误差泡泡短轴的 0.8 倍）；
- **剪影测试**：涂成纯色还认得出，缩到 64 px 还认得出。

定稿以后，设定图和各个视图放进 `cast/<id>/`：`bin/vh cast add <项目> <id> --kind character --name … --ref out/review/character-sheet.png=sheet --ref …=front --final`。之后生图用 `bin/vh image gen … --ref cast:<id>`，每一镜都从同一套参考出；front、left、back、right 四个视图也是以后做 3D 模型的输入。设定图（sheet）和四视图是两回事：sheet 一张图里排着几个角度，给人看、给生图当参考；四视图是四张分开的图，每张只有一个角度、背景干净，left、right 指角色自己的左右（从 sheet 裁出来或单独生成都行）。服装、道具、场景同样各放一个（`--kind costume|prop|set`）。

## 色彩 tokens

| token | hex | 用在哪 |
|---|---|---|
| body | | |
| line | | |
| accent | | 只给{…}用 |

不在 STYLE.md 的调色板之外加新颜色。

## 画法

- 线宽 {..} px，辅线 {..} px，圆角 {..}；
- 一处定义、到处调用：一个 `drawCharacter(pose, expression, t)` 之类的函数，镜头里不各画一份。

## 跨镜一致性（每个场景自查时过一遍）

每个有它的镜头取一帧，并排拼成 `out/check/character-xshot.png`，眯眼看比例、线宽、颜色有没有漂。

| 镜头 | 视角 | 表情 | 比例 | 颜色 | 备注 |
|---|---|---|---|---|---|
| {S01} | | | ✓ | ✓ | |
