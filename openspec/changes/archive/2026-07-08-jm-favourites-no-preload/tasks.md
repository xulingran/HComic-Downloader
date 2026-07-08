## 1. 实现 JM 收藏夹禁用预加载

- [x] 1.1 在 `src/pages/FavouritesPage.tsx` 第 345-353 行的 `usePaginatedPreloader` 调用中，将 `enabled` 计算由 `!needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1)` 改为 `source !== 'jm' && !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1)`，使 JM 来源在候选页生成阶段短路（不产生 pending 候选页、不 drain、不发出 in-flight 请求）。
- [x] 1.2 确认改动未影响其他来源：JM 之外来源的 `enabled` 仍为 true（当无 needsLogin/isLoading 且多页时），相邻页预加载行为不变。

## 2. 添加回归测试守护不变量

- [x] 2.1 在 `tests/unit/pages/FavouritesPage.test.tsx`（或新建 `FavouritesPage.preload.test.tsx` 若现有文件不便于挂载该断言）添加测试：当 `source === 'jm'` 且满足其他启用条件（多页、非 loading、非 needsLogin）时，模拟用户停留在某页后，**断言** `getFavourites` mock 仅被主动加载调用（当前页），**禁止**出现相邻页（current ±1、±2）的预加载调用。测试须能通过删除 `source !== 'jm'` 判定来证伪（即删除后测试必须失败）。
- [x] 2.2 在同一测试文件添加对照测试：当 `source` 为非 JM 来源（如 `hcomic`）且满足启用条件时，相邻页预加载**必须**正常触发（验证未误伤其他来源）。
- [x] 2.3 在同一测试文件添加切换测试：从 JM 来源切换到非 JM 来源后，新来源的相邻页预加载**必须**恢复；从非 JM 切换到 JM 后，**禁止**发起新的相邻页预加载（守护规范场景"切到 JM 后预加载停止"）。

## 3. 验证

- [x] 3.1 运行 `npx tsc --noEmit` 确认无类型错误。
- [x] 3.2 运行 `npm test -- FavouritesPage` 确认新增测试与既有 FavouritesPage 测试全部通过。
- [x] 3.3 运行 `npm run lint` 确认 ESLint（含 test-quality 自定义规则）通过——特别注意新增测试不得是"仅断言 mock 被调用而不同时验证真实行为"的裸断言。
- [x] 3.4 运行 `npm run test:coverage` 抽查 `FavouritesPage.tsx` 第 349 行 `enabled` 表达式两个分支（JM / 非 JM）均被覆盖。
