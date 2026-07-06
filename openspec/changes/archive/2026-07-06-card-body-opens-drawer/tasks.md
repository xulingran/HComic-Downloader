## 1. 实现 body 回退逻辑

- [x] 1.1 在 `src/hooks/useCardInteraction.ts` 的 `handleCardClick` 内增加非批量模式 fallback：当 `onClick` 未传入时调用 `onOpenDrawer()`（用 `if (onClick) { onClick(comic); return } onOpenDrawer()` 显式形式，保留 `onClick` 优先语义）
- [x] 1.2 将 `onOpenDrawer` 加入 `handleCardClick` 的 `useCallback` 依赖数组（当前缺失，加入后避免陈旧闭包）

## 2. 测试覆盖

- [x] 2.1 在 `tests/unit/components/common/ComicCard.test.tsx` 新增 CoverCard 用例：非批量模式、仅传 `onOpenReader`、未传 `onClick` 时，点击卡片 body 区（`div[class*="rounded-xl"]` 容器）**必须**调用 `openDrawer`（来自 `useDrawerStore` mock）
- [x] 2.2 新增 CoverCard 用例：非批量模式、同时传 `onClick` 与 `onOpenReader` 时，点击 body 区**必须**调用 `onClick` 且**不**调用 `openDrawer`（验证 `onClick` 优先语义未被破坏）
- [x] 2.3 新增 CoverCard 用例：批量模式下点击 body 区**必须**调用 `onToggleSelect` 且**不**调用 `openDrawer`（验证批量分支提前 return 未受影响）
- [x] 2.4 新增 DetailedCard 用例：非批量模式、仅传 `onOpenReader` 时，点击整行 body 区（作者/页数文字或行 padding，即未命中封面缩略图/标题/tag/下载按钮的区域）**必须**调用 `openDrawer`

## 3. 验证闸门

- [x] 3.1 `npm test`（ComicCard 相关用例全部通过，含新增 4 个 + 既有用例无回归）
- [x] 3.2 `npx tsc --noEmit`（类型检查通过，`onOpenDrawer` 进入依赖数组后无类型错误）
- [x] 3.3 `npm run lint`（ESLint 通过，无 `react-hooks/exhaustive-deps` 警告）
- [x] 3.4 `npm run lint:test-quality`（测试质量闸门通过——新增用例须验证真实行为而非裸 mock 调用断言）
