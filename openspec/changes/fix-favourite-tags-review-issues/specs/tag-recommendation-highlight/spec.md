## 新增需求

### 需求:推荐入口必须与搜索页高亮门控一致，禁止对不支持推荐的来源暴露写入入口

推荐标签功能的全部用户触点（详情抽屉入口、搜索页高亮、设置页来源 tab）必须对「来源是否支持推荐」保持一致的判定。搜索页高亮已按 `sourceSupportsTagRecommendation(source)` 门控；详情抽屉的 tag chip 小按钮必须遵循同一门控——对 `SOURCE_META[<source>].supportsTagRecommendation === false` 的来源（如 NH、copymanga）禁止生成「加入推荐 / 取消推荐」动作。禁止出现「抽屉可写入、搜索页不消费、设置页无法管理、后端 normalize 丢弃」的断裂链路，必须从最早可达的入口拦截假成功写入。

#### 场景:NH 来源抽屉 tag chip 不出现推荐动作

- **当** 用户在来源为 `nh` 的漫画详情抽屉中点击某 tag chip 的小按钮
- **那么** 可触发的动作必须仅限屏蔽类（`block` / `unblock`）
- **且** 禁止出现 `favourite` / `unfavourite` 动作或对应 UI

#### 场景:入口门控与搜索页门控共用同一事实源

- **当** 抽屉渲染 tag chip 动作 或 搜索页计算推荐高亮集合
- **那么** 二者必须都通过 `utils/source.ts` 的 `sourceSupportsTagRecommendation` 判定
- **且** 禁止在任一处硬编码来源名单，必须复用 `SOURCE_META` 这一单一事实源
