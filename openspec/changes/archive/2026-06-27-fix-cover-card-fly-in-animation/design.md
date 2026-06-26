## 上下文

「标题+封面」(cover) 显示模式下翻页时，偶尔有漫画封面从左上角飞入。根因调查已确认：

- `AnimatedCardWrapper`（`src/components/common/AnimatedCardWrapper.tsx:28`）开启了 `layout={!reduceMotion}`，使 framer-motion 对每个卡片做 layout 动画（位置/尺寸变化时的 transform 校正）。
- 列表容器（`src/pages/SearchPage.tsx:667-668`）用 `<LayoutGroup>` + `<AnimatePresence mode="popLayout">` 包裹。
- 翻页 = `setComics(result.comics)` **整页替换** `comics` 数组，所有卡片 key 全变。
- `cardItemVariants`（`src/lib/anim.ts:232-236`）只有 `{opacity, y:8}`，**绝不会**产生 x 方向大位移。能产生「从左上角飞入」这种大位移的只有 `layout` 属性。

机制：翻页全量替换时，新卡片 mount 的瞬间 framer-motion 用 `getBoundingClientRect()` 测量初始位置做 layout 校正；但此刻浏览器尚未完成布局（grid 行高未定 + 封面 Skeleton→img 异步切换 + 旧卡片 popLayout 弹出占位叠加），测量到的初始位置常为 `(0,0)` 或上一行位置，framer-motion 把卡片 transform 到该错误位置再过渡回来 → 视觉飞入。

`AnimatePresence mode="popLayout"` + 子项 `layout` 是为**局部增删**（删一个卡片、其余补位）设计的；翻页全量替换用不上 popLayout 的「挤出」优势，反而引入 mount 测量竞态。

detailed 模式不受影响：封面固定 `w-14 h-14`，行高无异步变化，测量稳定。

## 目标 / 非目标

**目标：**
- 消除 cover 模式翻页/新搜索时的「封面从左上角飞入」bug，使翻页后卡片只走规定的 stagger 淡入上移（opacity 0→1 + y 8px→0），无任何 transform 飞入。
- 保留 `cardStyle`（cover↔detailed）切换时的 layout 位置平滑过渡。
- 保留局部增删（取消收藏、加入黑名单导致单卡片移除）时剩余卡片 layout 归位。
- 保留 stagger 封顶、reduced-motion 退化、`contain: layout`。

**非目标：**
- 不重构动画架构、不替换 framer-motion。
- 不改 `src/lib/anim.ts` 的 variants 定义。
- 不改 detailed 模式（其本身稳定）。
- 不处理阅读器翻页（PageFlipView）、Tab 切换、弹窗动画——这些与卡片列表无关。

## 决策

### 决策 1：用「整页重挂载」消除全量替换竞态

**选择**：在所有使用 `LayoutGroup + AnimatePresence mode="popLayout"` 包裹卡片网格的页面，给列表 grid 容器加一个由「搜索/列表上下文 + 当前页码」派生的稳定 `key`。翻页或新搜索时 key 变化 → React 整页重挂载 grid 子树 → 所有卡片走 fresh mount 的 stagger 进场动画（opacity + y），framer-motion 不存在「从旧测量位置校正」的前提，竞态根除。

**为什么不用替代方案：**

- *替代 A：去掉 `AnimatedCardWrapper` 的 `layout` 属性*。会同时关掉 cardStyle 切换的位置过渡与局部增删的归位动画，违反现有 `ui-animation` 需求（cardStyle 切换平滑过渡、卡片移除剩余归位）。伤及无辜，否决。
- *替代 B：把 `AnimatePresence mode="popLayout"` 改为 `mode="wait"`*。`mode="wait"` 要求旧动画完全播完再挂新内容，翻页会有可感的「先空一下再出现」延迟，体验劣化；且仍依赖 mount 时机测量，不根治。否决。
- *替代 C：仅给封面 `<img>` 固定 aspect-ratio*。缩小但**不消除**竞态窗口（mount 测量时序问题本身未解决），治标不治本。可作为辅助优化但不作为主方案。

整页重挂载是唯一既根治竞态、又完全不损伤其它动画语义的方案：翻页本就是「全新一批内容」，fresh mount 在语义上完全正确。

### 决策 2：key 的派生方式

- **SearchPage**：`key = createSearchContextKey(...) + ':' + page`。需覆盖「翻页」「新搜索」「换来源/换 mode（keyword/tag/random）」三类全量替换。复用已有的 `createSearchContextKey`（`src/stores/useSearchCacheStore.ts`）作为搜索上下文部分，拼接 `pagination.currentPage` 作为页码部分。
- **FavouritesPage**：`key = favouriteSource + ':' + (favouritesPage ?? 0) + ':' + (activeTagFilter ?? '')`。收藏列表的全量替换触发点是换来源、翻页、换 tag 筛选。
- **DownloadPage**：先评估。任务列表通常是**增量**增删（单个任务进入/完成），不是全量替换，popLayout + layout 在此正是其设计用途，**预计无需修改**。tasks 中列为「确认」步骤，若确认无全量替换竞态则不动。

key 必须满足：同一批内容稳定（不随无关 re-render 变）、不同批内容必变。

### 决策 3：重挂载不影响 stagger 与 reduced-motion

整页重挂载后，新挂载的卡片仍是 `AnimatedCardWrapper`，仍走 `getCardItemVariants(index)` 的前 20 项 stagger；reduced-motion 下仍走 `getReducedCardItemVariants()`。本决策不改这些路径，仅改挂载粒度。

## 风险 / 权衡

- **[整页重挂载有轻微性能开销]** → 翻页时所有卡片 DOM 重建。但翻页是低频用户主动操作（非滚动连续触发），且单页卡片数受分页限制（通常 ≤ 24），开销可忽略。封面有 `coverCache`（`useCoverImage.ts`）与 `usePaginatedPreloader` 预加载，重挂载后命中缓存可立即显示，无额外网络请求。
- **[重挂载会丢失卡片内部瞬时状态]** → 如 DetailedCard 的 `showAllTags` 展开态。翻页本就切换内容，丢失瞬时 UI 态符合预期；不持久化的状态本不该跨页保留。可接受。
- **[key 设计不当导致不必要重挂载或漏重挂载]** → 通过「同批内容 key 稳定、不同批 key 必变」原则 + 回归测试覆盖（验证翻页后 key 变化、同页 re-render key 不变）。
- **[DownloadPage 可能同样有 bug 但被遗漏]** → tasks 中设为「先确认」步骤；若发现全量替换场景则一并修，否则不动并记录原因。

## Migration Plan

- 纯前端改动，无数据/配置迁移，无回滚风险。
- 改动可独立提交、独立回滚（git revert 单个 commit）。
- 验证流程：`npx tsc --noEmit` + `npm test` + `npm run lint` + 手动在 cover 模式下反复翻页确认无飞入。

## Open Questions

- DownloadPage 是否存在全量替换竞态？需在 tasks 阶段确认其任务列表的数据流（增量 vs 全量）。倾向于不修改，除非确认有问题。
