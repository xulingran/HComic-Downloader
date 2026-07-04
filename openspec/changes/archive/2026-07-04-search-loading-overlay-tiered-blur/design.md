## 上下文

搜索页结果区在加载期间会短暂叠加遮罩（`SearchPage.tsx:907-912`）。当前实现：

- 渲染条件：`isLoading && filteredComics.length > 0`（旧结果仍在时）。
- 视觉：`bg-[var(--bg-primary)]/60 backdrop-blur-[1px]` + 居中文字「加载中...」。`backdrop-blur-[1px]` 模糊极轻，旧结果几乎完全可读。
- 触发路径有两类：
  1. **翻页**：`handleSearch` → `withLoading(fn, { keepExisting: true })`，不清空旧结果，遮罩渲染。
  2. **认证来源切换的校验窗口**：`handleSourceChange`（第 587-600 行）切到 jm/bika/copymanga 时，先 `setLoading(true)` 保留旧结果，`await verifySourceAuth()`，校验通过后才进入 `withLoading`。这段窗口期旧结果仍在 + `isLoading=true`，遮罩渲染。
- 加载状态存储于全局 `useComicStore`：`{ isLoading: boolean }`，无强度/场景信息。
- 现有规范 `list-loading-feedback` 已规定"翻页保留旧结果+遮罩"和"新查询立即清空+骨架"，但**未覆盖**"认证校验窗口"这一中间态，也未对遮罩强度/文案分级。

利益相关者：依赖 `useComicStore.isLoading` 的消费者（搜索页、收藏页、历史页共用该 store 字段，但各自渲染遮罩；本变更仅改搜索页渲染层）。

## 目标 / 非目标

**目标：**
- 搜索页遮罩按"旧结果是否将被替换"分两档：
  - light：翻页（旧结果仍可参考，仅表"加载中"）
  - strong：换来源认证窗口、随机、分类、NH 入口、抽屉/侧栏标签搜索（旧结果即将被整页替换）
- strong 档视觉上明确传达"正在更换"：重模糊 + 文案区分（「切换中...」/「搜索中...」）。
- 不破坏现有"新查询立即清空走骨架"路径（`keepExisting: false` 时 `clearSearchResult()` 触发骨架，不进遮罩）。

**非目标：**
- 不改 `FavouritesPage` / 历史页的遮罩（它们共用 `useComicStore.isLoading` 但本变更不动其渲染层）。
- 不引入 scale/transform 退场动画（YAGNI，纯模糊+文案已足够）。
- 不改 `useComicStore` 的 `isLoading` 布尔语义（避免波及多页面消费者）。
- 不引入新的 `overlayIntensity` 显式参数（优先复用 `keepExisting`）。

## 决策

### 决策 1：遮罩强度信号存放在哪 —— 组件局部 state，而非全局 store

**选择**：在 `SearchPage` 组件内用 `useState<'light' | 'strong' | null>` 持有当前遮罩强度，由 `withLoading` 和 `handleSourceChange` 在 `setLoading(true)` 前同步设置。渲染层读这个局部 state 决定 class 与文案。

**理由**：
- `useComicStore.isLoading` 被搜索/收藏/历史三页消费。若在 store 上加 `loadingIntensity` 字段，三页的 `setLoading` 调用点都要同步维护该字段，扩散面大且收藏/历史页本次不改动 → 违反最小变更。
- 遮罩的**渲染**本就是各页各自实现的（搜索页 `SearchPage.tsx:908`、收藏页 `FavouritesPage.tsx:483`），强度天然是"渲染层概念"，放组件局部 state 与渲染职责对齐。
- `setLoading` 的调用都发生在 `SearchPage` 内部（`withLoading`、`handleSourceChange`、初始化挂载第 194/297 行），信号源与消费点同组件，无需提升到 store。

**替代方案（已否决）**：
- 在 `useComicStore` 加 `loadingIntensity` 字段 → 扩散到所有 `setLoading` 调用点与三页渲染层，超出本次范围。
- 用 React Context 提供 → 过度工程，单组件 state 足够。

### 决策 2：分级信号如何派生 —— 复用 `keepExisting` + 认证窗口显式标注

**选择**：
- `withLoading` 内部：`const intensity = opts.keepExisting ? 'light' : 'strong'`，在 `setLoading(true)` 同时设置遮罩强度 state。
- `handleSourceChange` 的认证窗口（第 587-588 行 `setLoading(true)`）：显式设置为 `'strong'`（该路径不走 `withLoading`，故 `keepExisting` 派生够不到，需手动标）。
- `withLoading` 的 `finally` 与 `handleSourceChange` 的 `setLoading(false)` 处同步清空强度 state。

**理由**：
- `keepExisting` 的语义本就是"保留旧结果"，等价于"旧结果还有用" → light；反之"整页替换" → strong。复用零冗余。
- 认证窗口是唯一不走 `withLoading` 却会触发遮罩的路径，单独标注一处即可，不值得为此抽参数。
- 未来若出现"keepExisting=true 但要 strong"的例外场景，再拆显式参数（YAGNI）。

**替代方案（已否决）**：
- 给 `withLoading` 加第三参数 `overlayIntensity: 'light' | 'strong'` → 每个调用点都要标，且当前所有调用点都能从 `keepExisting` 推导出来，纯冗余。
- 用"是否换来源"作为分级依据 → 需要比较新旧 source，比 `keepExisting` 复杂且与现有上下文判定重复。

### 决策 3：两档视觉与文案的取值

| 档位 | 背景 | 模糊 | 文案 | 旧结果可读性 |
|------|------|------|------|--------------|
| light（翻页） | `bg-[var(--bg-primary)]/40` | `backdrop-blur-[2px]` | 「加载中...」 | 基本可读 |
| strong（换源/新查询） | `bg-[var(--bg-primary)]/85` | `backdrop-blur-[10px]` | 「加载中...」 | 几乎不可辨认 |

**文案统一为「加载中...」**（不分 switching/searching 子变体）。

**理由**：
- 重模糊本身已足以传达"正在更换"（用户原话："不够直观的表示出正在更换"——核心诉求是视觉强度）。
- `SearchBar` 搜索按钮在 `isLoading=true` 时已显示「搜索中...」（`SearchBar.tsx:222`）。遮罩若再用「搜索中...」会同屏重复；用「切换中...」则与按钮文案冲突。统一「加载中...」避免与按钮语义撞车。
- `bg-primary/85` 取较高不透明度确保即便封面颜色鲜艳也能压住；`blur-10px` 达到"不可辨认"程度（对照 `ComicReaderModal` 已用的 `blur-8px`，略加重）。
- 状态模型因此从 4 变体（light/strong/switching/searching）简化为 2 变体（light/strong），实现更简。

### 决策 4：强度令牌的归属 —— 内联 className，不进 tailwind.config

**选择**：两档 class 直接写在 `SearchPage.tsx` 遮罩 DOM 的条件 className 里（或抽成组件内常量对象），不新增 tailwind 设计令牌。

**理由**：
- 仅此一处使用，非系统化设计语言；引入令牌反而增加间接层。
- 与 `ComicReaderModal` 等已用内联 `backdrop-filter` 风格一致。
- 若未来 `FavouritesPage` 也要分级再抽公共，届时提升。

## 风险 / 权衡

- **[认证窗口极快返回时 strong 遮罩闪烁]** → `verifySourceAuth` 命中本地缓存/快速成功时，strong 遮罩可能一闪而过造成抖动。缓解：现有翻页遮罩本就接受短时显示，strong 档视觉差异是"更明显"而非"更长"，闪烁概率与现状相同；若实测明显，可考虑给遮罩加 100ms 延迟显示（与 `ComicReaderModal` 占位策略一致），但本变更先不加，实测后再定。
- **[文案统一后 strong 档仅靠模糊传达"更换"]** → 不再有「切换中...」文字提示。缓解：重模糊（blur-10px）+ 高不透明度（bg/85）使旧结果几乎不可辨认，视觉强度差异已足够；用户原诉求聚焦"更模糊一些"，文案是次要的。
- **[light 档比现状还轻（bg /40 vs /60）]** → 翻页时旧结果更"穿"出来。这是有意为之（翻页时旧结果有参考价值），但需确认用户不觉得"遮罩消失了"。缓解：实测翻页体感，若反馈"看不到加载态"再调到 /50。
- **[切换到 bika/nh 未认证分支不进遮罩]** → `handleSourceChange` 第 601-604 行切到 bika/nh 直接 `clearSearchResult()` 走骨架，无遮罩。这是现有行为，本变更不动，但 spec 里需明确"认证窗口"专指 jm/bika/copymanga 的 `requiresAuth` 分支，避免歧义。

## 开放问题

1. light 档 `bg-primary/40` 是否过轻？需实测。
