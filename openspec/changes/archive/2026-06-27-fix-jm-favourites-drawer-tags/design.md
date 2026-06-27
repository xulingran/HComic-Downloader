## 上下文

`ComicInfoDrawer` 是搜索页/收藏夹页/历史页共用的漫画详情抽屉。部分来源（JM、moeimg）的搜索/收藏卡片 DOM 不含完整元数据，抽屉打开时会通过 `getComicDetail` IPC 请求详情页补全（enrich）。

已确认根因（探索阶段用真实 JM 收藏夹 HTML 验证）：JM 收藏夹列表页服务端 HTML **完全不含 tag 字段**，列表项 `tags=[]`。当前 enrich effect 存在两个静默失败点：
1. `.catch(() => {})` 吞掉所有 reject；
2. `.then` 中对 `result.comic === null` 无任何处理（`setEnrichedComic` 不被调用，`enrichedComic` 保持 null）。

后果：一旦详情页请求失败（Cloudflare 拦截 / 限流 / 限制级需登录），`enrichedComic` 为 null，`displayComic` fallback 到列表项，tags 区空白，用户无任何反馈。搜索页看似正常仅因搜索卡片 DOM 自带 tags 兜底。

约束：
- 方案 A（用户已选定）—— 仅前端兜底，不动后端 parser（`_parse_search_item` 提取 `tags=[]` 符合 HTML 实情，无 bug）、不动 IPC、不动数据流。
- 抽屉已有成熟的四态状态机模式（`favouritesState: idle/loading/success/error`），新状态机须沿用该模式以保持代码一致性。
- 现有测试 `ComicInfoDrawer.test.tsx` 用真实 store + mock hooks 模式。

## 目标 / 非目标

**目标：**
- 消除 enrich 的静默失败（reject 与 `comic === null` 两种情况）。
- 在确实需要 enrich 却失败时，向用户提供可见反馈 + 手动重试入口。
- 不破坏现有抽屉行为（收藏状态、tag 点击搜索、动画）。

**非目标：**
- 不在后端为收藏夹列表项批量补全 tags（已有 `_enrich_tags_for_comics` 基础设施，但本变更明确排除后端改动，保持最小风险）。
- 不修改 `_parse_search_item`（提取 `tags=[]` 符合 HTML 实情）。
- 不改 `displayComic` 的 merge 逻辑（`{...drawerComic, ...enrichedComic}`）——成功覆盖、失败 fallback 的语义正确，问题仅在"失败无反馈"。
- 不引入自动重试 / 退避策略（用户选定的交互形态是"内联手动重试按钮"）。

## 决策

### 决策 1：enrich 失败的判定 = reject ∪ (resolve 但 comic 为 null)

**选择**：两种情况都置 `error`。
**理由**：`comic === null` 是 JM 场景最常见的失败形态（详情页被 Cloudflare 拦截、限制级重定向、专辑下架），原代码静默忽略它正是 bug 核心。只处理 reject 会漏掉这个主路径。
**替代方案**：仅把 reject 置 error、null 保持静默 —— 否决，因为 null 才是主要失败形态。

### 决策 2：状态机 `enrichState` 沿用 `favouritesState` 四态模式

**选择**：`idle / loading / success / error` 四态，与同文件 `favouritesState` 完全同构。
**理由**：保持代码风格一致，降低阅读成本；该模式已被同组件验证。
**替代方案**：仅用 boolean `enrichFailed` —— 否决，无法区分 loading/success，重试时无法回到 loading 态。

### 决策 3：重试机制用 `retryCount` state 驱动 effect 重新执行

**选择**：`retryEnrich` 回调内 `setRetryCount(n => n + 1)`，`retryCount` 加入 enrich effect 依赖项。effect 执行时先 `setEnrichState('loading')` 再发起请求。
**理由**：复用现有 effect 的 fetch 逻辑，避免把请求逻辑抽成独立函数后两处调用（减少重复与漂移风险）。effect 依赖列表已用 `eslint-disable exhaustive-deps` 兜底，加入 `retryCount` 不引入新警告。
**替代方案**：
- 把 fetch 逻辑抽成 `useCallback`，effect 与重试按钮都调它 —— 增加一层抽象，但本组件其他 effect（favourites check）也未抽离，保持一致更优。
- 用 `useRef` 计数器触发 —— 无法触发重渲染，effect 不会重跑。

### 决策 4：失败 UI 的显示条件 = `shouldEnrich && enrichState==='error' && displayComic.tags 为空`

**选择**：封装 `shouldEnrich = sourceNeedsDetailEnrich(comicSource) || !hasCompleteData`（与 effect 的进入条件同构），仅在三者全满足时渲染失败 UI。
**理由**：
- `shouldEnrich` 保证只在"本就需要 enrich"的场景反馈，避免对 hcomic（列表项自带 tags）误报。
- `tags 为空` 保证：若列表项已有 tags（即便 enrich 失败），仍正常显示 tags 而非失败 UI——这才是用户期望（有数据就展示数据）。
**替代方案**：只要 `enrichState==='error'` 就显示 —— 否决，会对"列表项已有 tags、enrich 只是锦上添花失败"的场景误报，反而打断正常体验。

### 决策 5：失败 UI 内联于标签区，不关闭抽屉

**选择**：在标签区位置（`displayComic?.tags` 渲染处的相邻区块）渲染 `[!] 标签加载失败 [重试]`，重试不关闭抽屉。
**理由**：用户选定此交互形态（"抽屉内联重试按钮"）。内联在标签区而非顶部 Toast，是因为失败语义直接对应"标签没加载出来"，就近提示 + 就近重试最连贯。
**替代方案**：Toast 提示 + 手动重开抽屉 —— 否决（用户未选）；自动延迟重试 —— 否决（增加请求量且失败仍无可见反馈）。

## 风险 / 权衡

- **[重试触发额外请求量]** → 重试是用户主动行为，每次点击一次请求，频率可控；且 JM 详情页请求本就是 enrich 的常规开销，无可避免。
- **[失败 UI 与标签区布局重叠/跳动]** → 失败 UI 仅在 tags 为空时出现，此时标签区本就空白，UI 占位即填空，不产生布局抖动。
- **[现有测试 mock `sourceNeedsDetailEnrich: () => false` 会破坏新用例]** → 新用例需在该用例内用 `vi.mocked` 覆盖为按来源返回真值；现有用例保持 false 不受影响（已确认现有用例不依赖 enrich 触发）。
- **[回归风险]** → 改动集中在单文件单 effect + 一处 UI 渲染，`displayComic` merge 逻辑不变；回退仅需还原该文件。
