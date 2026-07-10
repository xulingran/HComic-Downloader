## 新增需求

### 需求:内联居中加载态必须使用共享 InlineLoading 组件渲染

当页面需要在无旧结果可遮罩的场景下展示居中加载态（如列表页首次加载、React.lazy Suspense fallback）时，系统**必须**使用共享 `InlineLoading` 组件渲染"居中 spinner 环 + 可选辅助文案"的结构，而**禁止**在各页面内联重复编写 spinner 的 JSX。`InlineLoading` **必须**渲染一个不确定性 spinner（`w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full motion-safe:animate-spin`），其视觉模式**必须**与全视口遮罩组件 `LoadingOverlay` 的 spinner 一致。spinner 下方**必须**可选地渲染一行 `text-sm text-[var(--text-secondary)]` 辅助文案（默认「加载中...」）。`InlineLoading` 的容器**必须**纵向居中排列 spinner 与文案（`flex flex-col items-center justify-center gap-3`）。内联加载态使用纯静态文字作为唯一指示器**禁止**发生。

#### 场景:列表页首次加载显示 InlineLoading

- **当** 列表页（收藏夹页、历史页）首次加载且无旧结果列表可见
- **那么** 渲染共享 `InlineLoading` 组件，居中显示旋转的 spinner 环与「加载中...」辅助文案
- **且** spinner 环配色为 `border-[var(--text-tertiary)] border-t-[var(--accent)]`，尺寸为 `w-8 h-8`
- **且** 不展示全视口翻页遮罩层（`LoadingOverlay`），因无旧结果容器

#### 场景:InlineLoading 的 spinner 尊重 reduced-motion

- **当** 用户启用了 `prefers-reduced-motion` 且 `InlineLoading` 处于显示状态
- **那么** spinner 停止转动（呈现静止环）
- **且** 辅助文案仍正常显示

#### 场景:InlineLoading 支持自定义文案

- **当** 调用方向 `InlineLoading` 传入自定义 `text`
- **那么** spinner 下方显示该自定义文案
- **且** 不显示默认「加载中...」

### 需求:PageSkeleton 的 spinner 必须与 InlineLoading 视觉一致并尊重 reduced-motion

`PageSkeleton`（React.lazy Suspense fallback）中的 spinner **必须**采用与 `InlineLoading` 完全一致的 spinner 环样式（`w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full`），并**必须**使用 `motion-safe:animate-spin` 尊重 reduced-motion。`PageSkeleton` 缺失 `motion-safe:` 修饰符导致 reduced-motion 用户看到强制转动**禁止**发生。`PageSkeleton` 保留其独有的脉冲条（`animate-pulse` 占位条）作为 Suspense fallback 的补充视觉元素。

#### 场景:tab 切换 Suspense fallback 显示一致 spinner

- **当** 用户切换到一个尚未加载的 tab 页面，触发 React.lazy Suspense fallback
- **那么** fallback 渲染 `PageSkeleton`，其 spinner 环样式与 `InlineLoading` / `LoadingOverlay` 一致
- **且** spinner 使用 `motion-safe:animate-spin`，reduced-motion 用户看到静止环
