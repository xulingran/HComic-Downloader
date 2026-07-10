## 上下文

代码库中存在两种不同的加载态视觉模式，此前在 `unify-pagination-loading` 变更中只统一了第一种：

| 模式 | 组件 | 定位 | 用途 |
|------|------|------|------|
| 全视口遮罩 | `LoadingOverlay` | `fixed inset-0 z-50` + backdrop-blur | 翻页/整页替换时保留旧结果并叠加遮罩 |
| **内联居中（本次）** | （无，各处内联 JSX） | 容器内 `flex justify-center py-12` | 无旧结果可遮罩的首次加载 / Suspense fallback |

内联居中模式当前散落在 3 处，spinner 结构完全一致却各写一份：

| 位置 | spinner 环 | 尺寸 | 动画 | 文案 | 备注 |
|------|-----------|------|------|------|------|
| `FavouritesPage.tsx:451-455` | **无 spinner** | — | — | 「加载中...」 | **唯一缺 spinner 的加载态** |
| `HistoryPage.tsx:247-254` | `border-[text-tertiary] border-t-[accent]` | `w-8 h-8` | `motion-safe:animate-spin` | 「加载中...」 | 规范基准 |
| `PageSkeleton.tsx:11` | `border-[text-tertiary] border-t-[accent]` | `w-8 h-8` | `animate-spin`（**缺 motion-safe**） | 无（用脉冲条替代） | Suspense fallback |

`list-loading-feedback` 规范的"历史页首次加载无旧网格时显示居中 spinner"场景已要求"居中 spinner + 辅助文案"，收藏夹是事实遗漏（`FavouritesPage` 首次加载场景未被规范显式覆盖，但翻页遮罩场景已纳入）。

约束：
- spinner 环样式已在 `LoadingOverlay`（`border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full motion-safe:animate-spin`，`w-8 h-8`）被 `unify-pagination-loading` 确立为项目标准，本组件复用同一模式。
- reduced-motion：spinner 用 `motion-safe:animate-spin`（与 `LoadingOverlay` 一致），reduced-motion 用户看到静止环 + 文案。
- `PageSkeleton` 的脉冲条（`w-32 h-3 bg-[var(--bg-tertiary)] animate-pulse`）是 Suspense fallback 的特有元素（非加载文案），不能被新组件吞掉。

利益相关者：所有使用收藏夹/历史页首次加载、以及 tab 切换 Suspense fallback 的用户；维护者（消除 spinner 漂移根源）。

## 目标 / 非目标

**目标：**
- 新增共享 `InlineLoading` 组件，统一"居中 spinner + 可选文案"的内联加载态。
- 补齐收藏夹首次加载缺失的 spinner，与历史页首次加载视觉一致。
- 消除三处重复的 spinner JSX，数值与样式集中到一处，杜绝再次漂移。
- 修复 `PageSkeleton` spinner 缺失 `motion-safe:` 的可访问性遗漏。

**非目标：**
- 不统一 `BikaCategoryGrid.tsx:43-48` 的加载态——它无文案、用相反环色（`border-[accent] border-t-transparent`），视觉语言不同，强行统一需引入 variant prop 增加复杂度。
- 不统一 `ComicReaderModal` 的 `ReaderLoadingState`——它是 SVG spinner + 暗色横排布局，上下文（阅读器暗背景）与组件设计目标不同。
- 不改 `StartupScreen`——它用内联 hex 样式以像素级匹配 `index.html` 启动骨架屏，不能用 CSS 变量。
- 不改 `LoadingOverlay`（全视口遮罩组件，已由 `unify-pagination-loading` 定型）。
- 不改翻页/整页替换的遮罩路径（保留旧结果 + `LoadingOverlay`）。

## 决策

### 决策 1：组件 API — `text?: string`，极简无 variant

**选择：** `InlineLoading` 接收可选 `text?: string`（默认「加载中...」），渲染 `flex flex-col items-center justify-center gap-3 py-12` 容器 + spinner 环 + 文案。无 variant、无 size、无 intensity。

**理由：** 统一范围内的三处视觉完全一致（同尺寸、同环色、同动画），唯一差异是文案有无——`text` 可选即可覆盖。引入 variant 会让 API 为不统一的目标（Bika/Reader）预留扩展，违背"不统一它们"的非目标决策。

**PageSkeleton 用法：** `PageSkeleton` 不传 `text`（只要 spinner），自行在外层包脉冲条。即 `PageSkeleton` = `<div 容器><InlineLoading text={null} 去掉文案与 py-12？/>...`。由于 `InlineLoading` 的 `py-12` 容器语义是"页面首次加载的纵向留白"，而 `PageSkeleton` 是"填满 lazy 容器 `h-full`"，两者容器不同 → `PageSkeleton` 只复用 `InlineLoading` 的**内部 spinner 块**，不复用外层容器（见决策 2）。

**替代方案：** 组件接收 `variant: 'page' | 'skeleton'` 区分容器。**否决**：容器差异只有 `py-12` vs `h-full`，用 `className` 透传比加 variant 更轻量，且避免为单一调用点加枚举。

### 决策 2：组件结构 — 外层容器 + 内部 spinner 块

**选择：** 组件分两层：
```
InlineLoading (text='加载中...')
├─ 外层: <div className="flex flex-col items-center justify-center gap-3 py-12">  ← 页面级纵向留白
│   ├─ <div spinner className="w-8 h-8 border-2 ... motion-safe:animate-spin" />
│   └─ {text && <div className="text-sm text-[var(--text-secondary)]">{text}</div>}
```

`PageSkeleton` 不直接用 `<InlineLoading />`（它的容器是 `h-full` 而非 `py-12`，且要加脉冲条），而是提取 spinner 为组件内的**私有子块**或在 `InlineLoading` 导出一个不带容器的 spinner。

**进一步选择：** 不导出独立 `<Spinner>`——`PageSkeleton` 直接 import `InlineLoading` 并传 `text` 为空、再用 `className` 覆盖容器为 `h-full`、在外层加脉冲条。但这会让 `PageSkeleton` 的 JSX 变扭（要覆盖默认 `py-12`）。

**最终选择：** `InlineLoading` 接收可选 `className?: string` 合并到外层容器（`className` 在 `py-12` 之后，可覆盖）。`PageSkeleton` 渲染：
```tsx
<div className="flex items-center justify-center h-full">
  <div className="flex flex-col items-center gap-4">
    <InlineLoading spinnerOnly />   {/* 或 InlineLoading 只渲染 spinner */}
    <div className="w-32 h-3 ... animate-pulse" />
  </div>
</div>
```
为避免 `spinnerOnly` 这种半渲染 prop，**实际实现：`InlineLoading` 的外层容器默认 `py-12`，`PageSkeleton` 不复用 `InlineLoading` 的容器，而是复用其 spinner DOM 模式**——即把 spinner 环样式提取为一个组件内的常量字符串或子组件。

**结论（实现时落实）：** 创建 `InlineLoading` 组件（带容器 + spinner + 文案）。`PageSkeleton` 改为渲染 `<InlineLoading text="" />` 会引入空文案节点，故 `PageSkeleton` 保留自己的容器结构，仅将其 spinner `<div>` 的 className 替换为与 `InlineLoading` 完全一致的字符串常量（从 `InlineLoading` 导出该常量，或直接复用相同字面量 + 补 `motion-safe:`）。

**理由：** 避免过度抽象。三处中 `HistoryPage`/`FavouritesPage` 直接用 `<InlineLoading />`（容器 + spinner + 文案全复用）；`PageSkeleton` 只需 spinner DOM 一致（容器不同），复用 className 常量即可，不强行套组件外壳。

**替代方案：** 导出独立 `<Spinner>` 原子组件，`InlineLoading` 和 `PageSkeleton` 都用它。**否决**：多一个导出单元，而 spinner 只是一行 className，收益不抵复杂度。保持 `InlineLoading` 为唯二复用点（History/Favourites 整体复用、PageSkeleton 复用 spinner className）。

### 决策 3：默认文案「加载中...」与 `LoadingOverlay` 一致

**选择：** `text` 默认 `'加载中...'`，与 `LoadingOverlay` 的 `text` 默认值一致。

**理由：** 两个加载态组件（内联 `InlineLoading` / 遮罩 `LoadingOverlay`）文案统一，减少认知负担。`PageSkeleton` 不传 text（用脉冲条替代文案，见决策 2）。

**替代方案：** 默认无文案，调用方显式传。**否决**：History/Favourites 都要「加载中...」，默认值消除重复传参。

### 决策 4：补齐收藏夹 spinner 属于规范一致性修复

**选择：** `FavouritesPage` 首次加载从纯文字改为 `<InlineLoading />`，这同时修复了 `list-loading-feedback` 规范的覆盖缺口（规范已要求历史页首次加载"居中 spinner + 辅助文案"，收藏夹同场景应一致）。

**理由：** 规范"历史页首次加载无旧网格时显示居中 spinner"场景的措辞虽只点名历史页，但其底层需求"加载指示器必须使用 spinner 并尊重 reduced-motion"是通用的——纯静态文字指示器已被规范明确禁止作为加载遮罩的唯一指示器。收藏夹首次加载的纯文字是同一违规，本次一并修复。

## 风险 / 权衡

- **[回归] `PageSkeleton` 改 spinner className 可能影响 Suspense fallback 视觉** → spinner 环从 `animate-spin` 改 `motion-safe:animate-spin` 仅影响 reduced-motion 用户（停转），非 reduced-motion 用户视觉零变化。脉冲条不动。手动验证 tab 切换 fallback 即可。
- **[回归] `FavouritesPage` 首次加载从纯文字变 spinner + 文案，纵向布局微变** → 原来是 `py-12` + 单行文字，改后是 `py-12` + spinner(32px) + `gap-3` + 文字，高度增加约 48px。首次加载是短暂态（通常 <1s），视觉变化可接受且符合规范。测试需补 spinner 存在断言。
- **[测试] `FavouritesPage.test.tsx:188` 的 `shows loading state initially` 只断言了「加载中...」文字** → 文字断言可保留（`InlineLoading` 默认文案相同），但应补充 spinner DOM 存在断言（`.rounded-full.motion-safe\\:animate-spin`），与 `HistoryPage.test.tsx:188` 的断言模式对齐。
- **[过度抽象风险]** 只有 2 个整组件复用点（History/Favourites）+ 1 个 className 复用点（PageSkeleton）→ 组件 ROI 偏低但非负：消除的"收藏夹漏跟 spinner"正是重复 JSX 导致的真实 bug，抽组件的根本收益是防漂移而非减代码量。
