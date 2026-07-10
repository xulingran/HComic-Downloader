## 为什么

收藏夹页首次加载（`FavouritesPage.tsx:451-455`）只渲染一行静态「加载中...」文字，是整个代码库里唯一一个没有 spinner 的内联居中加载态——`HistoryPage` 的首次加载用了完全相同的场景却带了 spinner + `motion-safe:animate-spin`，而 `PageSkeleton`（tab 切换 Suspense fallback）也用了同一套 spinner 环。这三处的 spinner 结构、配色、尺寸完全一致，却各写一份内联 JSX，导致收藏夹这一处漏跟了 spinner（`list-loading-feedback` 规范已要求历史页首次加载显示居中 spinner，收藏夹是事实上的遗漏）。抽一个共享组件可以一举消除漂移根源并补齐收藏夹的 spinner。

## 变更内容

- **新增共享 `InlineLoading` 组件**（`src/components/common/InlineLoading.tsx`）：渲染"居中 spinner 环 + 可选辅助文案"的内联加载态（非全视口遮罩，区别于已有 `LoadingOverlay`）。spinner 采用项目已验证的 `border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full motion-safe:animate-spin` 模式，与 `LoadingOverlay` / `PageSkeleton` 一致。
- **补齐收藏夹首次加载的 spinner**：`FavouritesPage` 首次加载从纯文字改为 `InlineLoading`（spinner + 「加载中...」），与 `HistoryPage` 首次加载对齐，满足 `list-loading-feedback` 规范对居中 spinner 的要求。
- **`HistoryPage` 首次加载改用 `InlineLoading`**：内联 spinner + 文案块替换为组件调用，消除重复 JSX。
- **`PageSkeleton` 内部改用 `InlineLoading`**：spinner 环复用组件，`PageSkeleton` 保留其独有的脉冲条（`w-32 h-3 animate-pulse`，非加载文案）并修复 spinner 缺失 `motion-safe:` 修饰符的可访问性遗漏。

## 功能 (Capabilities)

### 新增功能

- `inline-loading-state`: 内联居中加载态共享组件的视觉契约——spinner 环（`border-t-accent` + `motion-safe:animate-spin`）+ 可选辅助文案、竖向 `gap-3` 排列、`py-12` 容器，用于无旧结果可遮罩的首次加载 / Suspense fallback 等内联场景，与全视口遮罩 `LoadingOverlay` 区分。

### 修改功能

- `list-loading-feedback`: 收藏夹页首次加载（无旧结果）的加载指示器从静态纯文字改为居中 spinner + 辅助文案，补齐与历史页首次加载一致的契约（规范本已要求"居中 spinner + 辅助文案"，收藏夹是事实遗漏）。

## 影响

- `src/components/common/InlineLoading.tsx` — 新建共享组件
- `src/pages/FavouritesPage.tsx:451-455` — 纯文字加载块改为 `<InlineLoading />`
- `src/pages/HistoryPage.tsx:247-254` — 内联 spinner + 文案块改为 `<InlineLoading />`
- `src/components/common/PageSkeleton.tsx` — spinner 环改用 `InlineLoading` 内部（保留脉冲条），补 `motion-safe:`
- `tests/unit/components/common/InlineLoading.test.tsx` — 新建组件单元测试
- `tests/unit/pages/FavouritesPage.test.tsx` — 补充首次加载 spinner 存在断言
- `tests/unit/pages/HistoryPage.test.tsx` — 首次加载断言改为查询 spinner（行为不变，查询方式微调）
