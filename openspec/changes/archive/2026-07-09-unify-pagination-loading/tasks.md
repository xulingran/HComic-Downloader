# 实现任务

## 1. 共享 LoadingOverlay 组件

- [x] 1.1 创建 `src/components/common/LoadingOverlay.tsx`：接收 `intensity: 'light' | 'strong'` 与可选 `text?: string`（默认「加载中...」）。渲染 `fixed inset-0 z-50 flex flex-col items-center justify-center` 容器（相对视口定位，spinner 永远在视口正中而非网格容器中心），背景与模糊按 intensity 取值：light=`backdrop-blur-[8px] bg-[var(--bg-primary)]/80`，strong=`backdrop-blur-[16px] bg-[var(--bg-primary)]/92`。内部居中渲染 spinner（`w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full motion-safe:animate-spin`，与 PageSkeleton.tsx:11 模式一致）+ 下方一行 `text-sm text-[var(--text-secondary)]` 辅助文案。
  - **定位修正（absolute → fixed）**：初版用 `absolute inset-0` 相对网格容器定位，导致 spinner 落在网格中心而非视口中心（内容比视口高时跑到视口外，矮时偏离中心）。改为 `fixed inset-0 z-50`：遮罩覆盖整个视口（含标题栏/侧栏/翻页控件），spinner 永远在视口正中，最强烈地表明"正在加载"。design.md 决策 1 已记录此取舍。
- [x] 1.2 为 LoadingOverlay 写单元测试 `tests/unit/components/common/LoadingOverlay.test.tsx`：断言 light/strong 两档 class 差异（含 `backdrop-blur-[8px]` / `backdrop-blur-[16px]` 与不透明度）、spinner DOM 存在（`rounded-full`）、默认文案「加载中...」、自定义文案透传。

## 2. SearchPage 接入

- [x] 2.1 修改 `src/pages/SearchPage.tsx`：删除内联 `OVERLAY_STYLES` 字符串字面量（lines 43-46）及遮罩渲染处（lines 1035-1041）的重复结构，改为渲染 `<LoadingOverlay intensity={overlayIntensity ?? 'light'} />`（overlayIntensity 仍由 `withLoading` 据 keepExisting 派生，handleSourceChange 仍显式标 strong，逻辑不变）。
- [x] 2.2 更新 `tests/unit/pages/SearchPage.test.tsx`：将「翻页 light 档」（line 1100 起）断言从 `backdrop-blur-[2px]` / bg/40 改为 `backdrop-blur-[8px]` / bg/80；将「strong 档」（line 1135/1174 起）从 `backdrop-blur-[10px]` / bg/85 改为 `backdrop-blur-[16px]` / bg/92；遮罩定位逻辑（line 1088-1091，靠「加载中」文案排除「搜索中」按钮）改判 spinner 存在或保留文案断言（LoadingOverlay 默认含「加载中...」文案，故现有 textContent 断言可保留）。

## 3. FavouritesPage 接入

- [x] 3.1 修改 `src/pages/FavouritesPage.tsx`：将内联遮罩（lines 475-480 的 `bg-[var(--bg-primary)]/60 backdrop-blur-[1px]` div + 纯文字 span）替换为 `<LoadingOverlay intensity="light" />`（收藏夹翻页恒为 light 档，无 strong 路径）。
- [x] 3.2 更新 `tests/unit/pages/FavouritesPage.test.tsx`：line 194 的 `getByText('加载中...')` 断言可保留（LoadingOverlay 默认文案相同）；补充断言遮罩含 `backdrop-blur-[8px]`（替代原 1px）与 spinner DOM 存在。

## 4. HistoryPage 改造（卸载 → 保留遮罩）

- [x] 4.1 修改 `src/pages/HistoryPage.tsx`：移除翻页时的 early-return（lines 244-250 的 `if (isLoading) return ...纯文本`）。改为在有旧网格时（`items.length > 0 && isLoading`）于网格容器外包 `relative` div 并叠加 `<LoadingOverlay intensity="light" />`，保留旧 items；在首次加载（`items.length === 0 && isLoading`）保留居中 spinner + 文案（LoadingOverlay 需在无 relative 父容器时也能居中显示，或保留现有空态分支用 LoadingOverlay 的无遮罩变体——见验证）。注意保留 `error` 分支（line 252）不变。
- [x] 4.2 为 HistoryPage 翻页保留行为新增/更新测试 `tests/unit/pages/HistoryPage.test.tsx`：断言翻页加载时（有旧 items）旧网格仍渲染（不卸载）且遮罩含 `backdrop-blur-[8px]` + spinner；首次加载（无旧 items）显示居中 spinner、无遮罩层。

## 5. 验证

- [x] 5.1 运行 `npm test`（前端测试全绿，含 LoadingOverlay 新测试 + 三页测试更新；absolute→fixed 修正后重跑相关 4 文件 117 测试全绿）。
- [x] 5.2 运行 `npx tsc --noEmit`（LoadingOverlay 新组件的类型检查通过；fixed 修正后重跑通过）。
- [x] 5.3 运行 `npm run lint`（ESLint 通过，含 test-quality 闸门；fixed 修正后重跑 0 errors）。
- [x] 5.4 运行 `npm run dev` 手动验证：收藏夹翻页遮罩明显增强（旧结果基本不可辨认）且 spinner 转动；搜索页翻页 light 档与换来源 strong 档视觉差异清晰；历史页翻页保留旧网格 + 遮罩 + spinner；系统开启 reduced-motion 时 spinner 停转。（用户已手动验证通过；absolute→fixed 修正后 spinner 位于视口正中。）
