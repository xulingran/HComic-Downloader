## 为什么

当前 ComicCard 网格与下载列表在以下场景**没有任何进出场动画**：

- 搜索 / 筛选切换时，旧结果直接消失、新结果瞬间出现，视觉上「啪」地切换
- 收藏 / 取消收藏、加入 / 移出黑名单时，列表项直接消失或出现，没有过渡
- 下载任务进入 / 完成移除时，任务项直接消失，列表布局瞬间抖动

成熟的列表 UI（如 macOS Finder、iOS SpringBoard、Notion 看板）都有「卡片淡入上移」「位置变化平滑过渡」「移除时缩小淡出」的体验。`framer-motion` 的 `AnimatePresence` + `layout` 动画正是为此设计——它能让位置变化、增删都得到平滑过渡，无需手写复杂的 transform 计算。

## 变更内容

- **ComicCard 网格进出场**：搜索 / 筛选切换时，卡片淡入 + 轻微上移（`y: 8 → 0`、`opacity: 0 → 1`）。前 20 张用 `staggerChildren` 错峰（每张 20ms 延迟），第 21 张及之后立即出现（避免长列表全量动画导致卡顿）。
- **ComicCard layout 动画**：卡片位置变化（如切换 cardStyle 在 cover / detailed 之间）时，用 `layout` prop 让位置平滑过渡而非瞬间跳变。
- **DownloadPage 任务列表**：任务进入时从顶部滑入，完成移除时淡出缩小。专辑卡（变更外）保持不动，仅章节子行进出有动画。
- **避免全量 stagger**：长列表（搜索结果可能上百项）必须限制初始动画的卡片数（如仅前 20 张 stagger），否则一次性 mount 几百个 motion 组件会卡顿。
- **layout 动画的性能护栏**：长列表开启 `layout` 时配合 `LayoutGroup` + `layoutScroll`，并审计是否需要引入虚拟列表（虚拟列表属于本变更范围之外的独立话题，如发现严重卡顿，记录为变更 6 的待办）。
- **reduced-motion 退化**：所有进出场退化为纯 opacity，无位移。

## 功能 (Capabilities)

### 修改功能
- `ui-animation`: 扩展规范，新增列表进出场动画的行为契约——ComicCard 网格 / DownloadPage 任务列表的进入 / 退出 / layout 变化、stagger 上限、reduced-motion 退化路径。

## 影响

- 受影响文件：`src/components/common/ComicCard.tsx`、`src/pages/SearchPage.tsx`、`src/pages/FavouritesPage.tsx`、`src/pages/HistoryPage.tsx`、`src/pages/DownloadPage.tsx`、`src/components/tools/DuplicateGroup.tsx`（如适用）。
- 不影响：IPC、Python、store 数据结构（仅读取 state 触发渲染）、shared types。
- 行为差异（用户可感知）：
  - 搜索 / 筛选切换时卡片淡入上移，而非瞬间出现
  - cardStyle 切换时位置平滑过渡
  - 下载任务进出有过渡
  - 系统开启「减少动画」时退化为纯淡入淡出
- 风险：中。列表性能是潜在坑——长列表全量 stagger 会卡顿，需要严格限制前 N 项。需要在变更 6 性能审计中验证。
- 依赖：变更 1（framer-motion + anim.ts）。与变更 2 / 3 互相独立，可并行。
- 待定：是否需要引入虚拟列表（如 `react-virtual` / `@tanstack/react-virtual`）作为配合——本变更**不引入**，但在变更 6 评估。
