## 修改需求

### 需求:推荐高亮的数据源必须为用户主动确认的 my_tags，禁止使用被动反推的 favourite_tag_index

搜索结果卡片的推荐高亮必须以用户主动加入 `my_tags` 的标签集合为唯一生效源。系统**禁止**直接使用 `sync_favourite_tags` 反推出的 `favourite_tag_index` 作为高亮依据。`favourite_tag_index` 的数据仅供设置页「检测标签」候选池展示，由用户挑选确认进入 `my_tags` 后才生效为高亮。

`favourite_tag_highlight` 开关的含义变更为「是否高亮 `my_tags` 命中的漫画」：开启时按 `my_tags[当前来源]` 计算 `recommendedTags`；关闭时 `recommendedTags` 为空集。`favourite_tag_min_matches` 的语义保持不变（漫画命中的推荐标签数 ≥ 该值时才高亮），只是命中来源从 `favourite_tag_index` 改为 `my_tags`。

视觉规范（CoverCard 整圈琥珀内描边、DetailedCard 加粗左边框、与选中态优先级 `selected > recommended`、大小写不敏感匹配）**必须**保持不变，仅高亮数据源改变。

#### 场景:高亮基于 my_tags 而非 favourite_tag_index

- **当** `favourite_tag_highlight` 为 `true`，当前来源为 `jm`，`my_tags["jm"]` 含 `["NTR","人妻"]`
- **那么** `recommendedTags` 集合必须为 `{"ntr","人妻"}`（来自 `my_tags`，小写归一）
- **且** 即使 `favourite_tag_index` 中 `jm` 来源还有 `["校園"]`，`"校園"` 也不得出现在 `recommendedTags` 中（除非用户已将其加入 `my_tags`）

#### 场景:my_tags 为空时不产生任何高亮

- **当** `favourite_tag_highlight` 为 `true`，但 `my_tags[当前来源]` 为空数组
- **那么** `recommendedTags` 必须为空集
- **且** 任何卡片都不得显示推荐态视觉信号（即使 `favourite_tag_index` 有数据）

#### 场景:favourite_tag_highlight 关闭时即使 my_tags 非空也不高亮

- **当** `favourite_tag_highlight` 为 `false`，`my_tags[当前来源]` 非空
- **那么** `recommendedTags` 必须为空集
- **且** 推荐高亮功能完全关闭，与开关关闭的旧行为一致

#### 场景:最少命中数基于 my_tags 计算

- **当** `favourite_tag_highlight` 为 `true`，`favourite_tag_min_matches` 为 `2`，某漫画的标签为 `["NTR","人妻","校園"]`，`my_tags["jm"]` 为 `["NTR","人妻"]`
- **那么** 该漫画命中 `my_tags` 的标签数为 2，`isRecommended` 为 `true`
- **当** 同一漫画的 `my_tags["jm"]` 改为 `["NTR"]`（命中数 1 < 阈值 2）
- **那么** `isRecommended` 必须为 `false`

#### 场景:isBlocked 优先于 isRecommended 保持不变

- **当** 某漫画的标签同时命中 `tag_blacklist` 与 `my_tags`
- **那么** `isBlocked` 必须优先，`isRecommended` 必须被压制（`isRecommended = !isBlocked && ...`）
- **且** 该卡片按屏蔽态处理（被过滤掉）
