## 为什么

搜索结果中，命中 tag 黑名单的漫画会被渲染成屏蔽占位符（`BlockedPlaceholder`）。在封面卡片（cover）模式下，该占位符的内容区结构与正常 `CoverCard` 不一致——缺少作者栏占位、标题无最小高度、内容区 padding 从 `p-2` 变为 `p-3`。三者叠加导致屏蔽卡片比同行正常卡片矮约一整行（作者栏高度），破坏 CSS Grid 的行对齐，视觉上参差不齐。

详细列表（detailed）模式下正常卡与屏蔽卡都只有标题一行，高度天然一致，不受此问题影响。

## 变更内容

- 修复封面模式下 `BlockedPlaceholder` 的内容区结构，使其与正常 `CoverCard` 占位高度对齐：
  - 内容区 padding 由 `p-3` 改为 `p-2`，与 `CoverCard` 一致。
  - 标题容器补上 `min-h-[2.5rem]`，与 `CoverCard` 标题最小高度对齐。
  - 标题下方补一个空占位行（`h-4 mt-0.5`），对齐 `CoverCard` 的作者栏高度。
- 不改变屏蔽占位符的设计意图（简化视觉：`line-through` 标题、无作者文字、封面区 🚫 图标 + 「已屏蔽」标签）。
- 不修改详细列表（detailed）模式下的屏蔽占位符——它本身高度一致，无此问题。

## 功能 (Capabilities)

### 新增功能
- `blocked-card-placeholder`: 规范搜索结果中被 tag 黑名单命中的漫画卡片的占位呈现。覆盖封面模式下占位卡片必须与正常卡片保持网格行高度对齐的约束，以及屏蔽态的简化视觉契约（line-through 标题、屏蔽图标、不展示作者等信息）。

### 修改功能
<!-- 无现有规范的屏蔽占位符需求被修改。详细列表模式的屏蔽占位符行为不在本变更范围内。 -->

## 影响

- 受影响代码：`src/pages/SearchPage.tsx` 的 `BlockedPlaceholder` 组件（封面变体分支）。
- 不受影响：`src/components/common/ComicCard.tsx`（正常卡片）、`BlockedPlaceholder` 的 detailed 变体分支、网格容器、`AnimatedCardWrapper`、过滤逻辑（`filteredComics`）。
- 无 API / 依赖 / 数据流变更，纯前端视觉布局修复。
- 测试：需补充 `BlockedPlaceholder` 封面变体的渲染测试，断言其与正常 `CoverCard` 占位高度结构对齐（padding / min-height / 作者占位行）。
