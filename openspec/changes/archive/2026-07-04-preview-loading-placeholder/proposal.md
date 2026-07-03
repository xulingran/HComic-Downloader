## 为什么

漫画预览（阅读器）界面中，未加载的页面当前显示**白色或近白色占位**——在翻页模式下，`Skeleton` 组件走浅色主题变量（`#f5f7fa`/`#eef1f5`），而阅读器整体强制深色背景（`#1a1a2e`），形成刺眼的白色色块，既不美观也不传达"正在加载"的语义。此外滚动模式与翻页模式的占位实现**互不一致**（滚动用横纹+孤立 spinner，翻页用浅色 Skeleton），违反统一的加载视觉语言。

本变更将两种模式的"已发起加载、未完成"占位统一为**阅读器背景色 + 中心 spinner**的样式，明确传达"正在加载"，并与阅读器整体深色融为一体。

## 变更内容

- **统一"加载中"占位**：滚动模式（`ReaderPage.tsx`）与翻页模式（`PageFlipView.tsx`）的"已进入视口/已发起请求但未完成"占位，统一为「阅读器背景色（`#1a1a2e`）填充 + 中心 spinner」的样式，保持 `aspect-ratio: 3/4` 以避免加载完成时高度跳动。
- **保留滚动模式的"未进入视口"横纹占位**：滚动模式下，未进入视口且非 `priority` 的页面继续使用现有 `repeating-linear-gradient` 横纹（懒加载占位，不发起请求），与"加载中"二态区分，避免满屏 spinner 喧闹。
- **翻页模式移除浅色 `Skeleton`**：翻页模式加载中占位改用统一组件，不再走主题变量，消除浅色主题下阅读器内的白色色块。
- **不改变失败页（`error` 态）占位**：失败态由 `preview-error-recovery` 规范管理，本变更不涉及。

## 功能 (Capabilities)

### 新增功能
- `preview-loading-placeholder`: 漫画预览阅读器内未加载页的统一占位视觉规范——"加载中"用阅读器背景色 + spinner，"未进入视口（懒加载）"保留横纹二态区分。

### 修改功能
<!-- 无。失败态占位由 preview-error-recovery 规范管理，不在此变更范围；加载语义不触及 list-loading-feedback（列表查询场景）。 -->

## 影响

- **代码**：
  - `src/components/ReaderPage.tsx`：替换加载中分支（当前为孤立的 `animate-spin` + 透明底）为统一占位；保留未进入视口分支的横纹。
  - `src/components/PageFlipView.tsx`：替换 `Skeleton variant="rect"` 调用为统一占位。
  - 新增共享组件（如 `src/components/common/` 下的 `ReaderPagePlaceholder.tsx`，或扩展现有 `Skeleton` 增加 `reader` 变体——具体由 design.md 决定）。
- **不动**：失败态、空白态、整章加载态（`ReaderLoadingState`）、`startup-skeleton-screen` 的启动屏 Skeleton 体系。
- **测试**：新增占位组件的渲染测试（深色背景、spinner 存在、aspect-ratio）；更新或新增 `ReaderPage`/`PageFlipView` 加载分支的快照/行为测试。
- **依赖**：无新增第三方依赖；spinner 复用现有 `animate-spin` Tailwind 类。
