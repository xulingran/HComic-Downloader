# 实现任务

## 1. 共享 InlineLoading 组件

- [x] 1.1 创建 `src/components/common/InlineLoading.tsx`：接收可选 `text?: string`（默认「加载中...」）与可选 `className?: string`（合并到外层容器，在 `py-12` 之后，允许覆盖）。渲染 `flex flex-col items-center justify-center gap-3 py-12` 外层容器，内部 spinner（`w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full motion-safe:animate-spin`，与 `LoadingOverlay.tsx:33` 完全一致）+ 可选文案（`text-sm text-[var(--text-secondary)]`，`text` 为空字符串时不渲染文案节点）。组件顶部注释说明：内联居中加载态（首次加载/Suspense fallback），与全视口遮罩 `LoadingOverlay` 区分；spinner 复用同一 `border-t-accent` 模式与 `motion-safe:animate-spin`。
  - **不导出独立 `<Spinner>`**（design.md 决策 2）：spinner 只是一行 className，`PageSkeleton` 直接复用相同字符串字面量即可，避免过度抽象。
- [x] 1.2 为 InlineLoading 写单元测试 `tests/unit/components/common/InlineLoading.test.tsx`，参照 `LoadingOverlay.test.tsx` 的断言模式：
  - spinner DOM 存在（`.rounded-full.motion-safe\\:animate-spin`）且 `className` 含 `border-t-[var(--accent)]`、`w-8 h-8`、`border-[var(--text-tertiary)]`；
  - 默认文案「加载中...」显示；自定义文案透传且默认文案消失；`text=""` 时不渲染文案节点（`queryByText('加载中...')` 为 null）；
  - 外层容器含 `py-12`、`gap-3`、`flex flex-col`；
  - spinner 是不确定性动画（不含 `<circle>` / `stroke-dashoffset`，区别于 `CircularProgress`）。

## 2. FavouritesPage 接入（补齐 spinner）

- [x] 2.1 修改 `src/pages/FavouritesPage.tsx:451-455`：将纯文字加载块（`<div className="flex items-center justify-center py-12"><span>加载中...</span></div>`）替换为 `<InlineLoading />`（默认文案相同）。在文件顶部 import `InlineLoading`（与已有的 `LoadingOverlay` import 并列）。
- [x] 2.2 更新 `tests/unit/pages/FavouritesPage.test.tsx:188-195`（`shows loading state initially`）：保留 `getByText('加载中...')` 断言（`InlineLoading` 默认文案相同），补充 spinner DOM 存在断言：`expect(document.querySelector('.rounded-full.motion-safe\\:animate-spin')).not.toBeNull()`，与 `HistoryPage.test.tsx:188` 的断言模式对齐。

## 3. HistoryPage 接入

- [x] 3.1 修改 `src/pages/HistoryPage.tsx:247-254`：将内联 spinner + 文案块（`<div className="flex flex-col items-center justify-center gap-3 py-12">...spinner...加载中...</div>`）替换为 `<InlineLoading />`。import `InlineLoading`。行为零变化（视觉与结构完全一致）。
- [x] 3.2 更新 `tests/unit/pages/HistoryPage.test.tsx:180-191`（首次加载测试）：断言无需改变（文案与 spinner 选择器均兼容 `InlineLoading`），仅确认测试仍通过。若查询方式需微调，参照 `InlineLoading.test.tsx` 的选择器。

## 4. PageSkeleton 接入（补 motion-safe）

- [x] 4.1 修改 `src/components/common/PageSkeleton.tsx:11`：将 spinner 的 `animate-spin` 改为 `motion-safe:animate-spin`（修复 reduced-motion 可访问性遗漏），其余 className 保持与 `InlineLoading` / `LoadingOverlay` 一致。**不改**脉冲条（`w-32 h-3 animate-pulse`）与外层容器结构（`h-full`）。
  - **不强行套 `<InlineLoading>` 外壳**（design.md 决策 2）：`PageSkeleton` 容器是 `h-full`（填满 lazy 容器）且含脉冲条，与 `InlineLoading` 的 `py-12` + 文案结构不同，只复用 spinner className 字面量。
- [x] 4.2 确认 PageSkeleton 无独立测试文件（grep 验证）；若 `react-code-splitting` 相关测试涉及 Suspense fallback 的 spinner 断言，确认其选择器兼容 `motion-safe:animate-spin`。

## 5. 验证

- [x] 5.1 运行 `npm test`（前端测试全绿，含 `InlineLoading.test.tsx` 新测试 + FavouritesPage/HistoryPage 测试更新）。
- [x] 5.2 运行 `npx tsc --noEmit`（`InlineLoading` 新组件类型检查通过）。
- [x] 5.3 运行 `npm run lint`（ESLint 通过，含 test-quality 闸门；确认无"纯 mock 调用断言"违规）。
- [x] 5.4 运行 `npm run lint:test-quality`（测试质量闸门通过）。
- [x] 5.5 运行 `npm run dev` 手动验证（用户已确认视觉验证通过；自动化验证 5.1-5.4 已全绿）：收藏夹首次加载显示 spinner + 「加载中...」（不再是纯文字）；历史页首次加载视觉不变；tab 切换 Suspense fallback 的 spinner 在 reduced-motion 下停转（此前 `PageSkeleton` 会强制转动）。
