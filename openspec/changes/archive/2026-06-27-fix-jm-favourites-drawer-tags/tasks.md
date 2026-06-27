# 实现任务

> 参考：proposal.md（动机）、specs/drawer-tag-enrich-recovery/spec.md（需求契约）、design.md（决策理由）。
> 范围：仅前端 `src/components/ComicInfoDrawer.tsx` + 其测试，不动后端。

## 1. enrich 状态机与失败判定

- [x] 1.1 在 `ComicInfoDrawer.tsx` 新增 `enrichState` state（`'idle' | 'loading' | 'success' | 'error'`），与现有 `favouritesState` 四态模式同构
- [x] 1.2 新增 `retryCount` state（`number`，初值 0），作为 enrich effect 的重试触发依赖
- [x] 1.3 改造 enrich `useEffect`（当前 line 68-89）：
  - 进入 effect 时 `setEnrichState('loading')`（仅在确实需要 enrich 的分支）
  - `.then` 中 `result.comic` 非空 → `setEnrichedComic(result.comic)` + `setEnrichState('success')`
  - `.then` 中 `result.comic === null` → `setEnrichState('error')`（**bug 核心：消除静默忽略 null**）
  - `.catch` 由 `() => {}` 改为 `() => setEnrichState('error')`
  - 跳过 enrich 的分支（`!sourceNeedsDetailEnrich && hasCompleteData`）→ `setEnrichState('idle')`
  - effect 依赖项追加 `retryCount`（保留现有 `eslint-disable exhaustive-deps`）
- [x] 1.4 新增 `retryEnrich` `useCallback`：`setEnrichState('loading')` + `setRetryCount(n => n + 1)`，依赖 `[drawerComic?.id, comicSource]`

## 2. 失败反馈 UI

- [x] 2.1 计算封装条件变量：`hasCompleteData = Array.isArray(drawerComic?.tags) && drawerComic.tags.length > 0`、`shouldEnrich = sourceNeedsDetailEnrich(comicSource) || !hasCompleteData`、`tagsEmpty = !(displayComic?.tags && displayComic.tags.length > 0)`
- [x] 2.2 在标签区渲染处（当前 line 379 `{displayComic?.tags && displayComic.tags.length > 0 && (...)}` 的相邻位置）新增失败 UI 区块：当 `shouldEnrich && enrichState === 'error' && tagsEmpty` 时渲染"标签加载失败"文案 + "重试"按钮
- [x] 2.3 失败 UI 样式沿用现有 error/accent 色系（`text-[var(--error)]` 文案、`bg-[var(--accent)]/10` 重试按钮），保持与组件其它元素视觉一致
- [x] 2.4 重试按钮 `onClick={retryEnrich}`，`disabled={enrichState === 'loading'}`，禁止关闭抽屉或重置其它抽屉状态

## 3. 单元测试

- [x] 3.1 调整 `tests/unit/components/ComicInfoDrawer.test.tsx` 的 `sourceNeedsDetailEnrich` mock，使其支持按来源返回真值（用 `vi.mocked` + 在新用例内 `mockReturnValue`），确保现有用例（依赖 `() => false`）不受影响
- [x] 3.2 新增用例"JM 收藏夹条目 enrich 失败时显示重试 UI"：列表项 `sourceSite='jm'` + 空 tags，`mockGetComicDetail.mockResolvedValueOnce({ comic: null })`，断言出现"标签加载失败"和"重试"按钮
- [x] 3.3 新增用例"点击重试后 enrich 成功则失败 UI 消失"：第一次返回 null，点击重试后 `mockResolvedValueOnce` 返回带 tags 的 comic，断言 tags 渲染、失败 UI 消失
- [x] 3.4 新增用例"enrich 成功时不显示失败 UI"：mock 返回带 tags 的 comic，断言不出现"标签加载失败"

## 4. 验证

- [x] 4.1 运行 `npm test`，确认新增 3 用例通过且现有用例无回归
- [x] 4.2 运行 `npx tsc --noEmit`，确认无类型错误
- [x] 4.3 运行 `npm run lint`，确认无 ESLint 错误（含 `react-hooks/exhaustive-deps`、`react-hooks/set-state-in-effect` 等既有规则的兼容）
