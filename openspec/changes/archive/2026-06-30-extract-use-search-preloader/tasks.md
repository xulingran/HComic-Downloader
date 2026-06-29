## 1. 抽取 `useSearchPreloader` hook

- [x] 1.1 创建 `src/hooks/useSearchPreloader.ts`,定义 hook 签名:接收 `query, mode, source, searchTags, searchFn, currentPage, totalPages, enabled, cacheSearchPage` 参数;返回 `{ contextKey, hasPage, consumePreloaded }`
- [x] 1.2 把 `preloadedPagesRef`(临时中转缓存)从 SearchPage(行 125)搬入 hook 内部
- [x] 1.3 把 `preloadSearchPage`(含 `signal.aborted` 检查,行 583-601)搬入 hook 内部,保留 IPC `await` 后、`.set()` 前的中断检查这一行不变
- [x] 1.4 把 `commitPreloadedSearchPage`(中转 → store 搬运,行 603-609)搬入 hook,作为返回的 `consumePreloaded`;内部调用注入的 `cacheSearchPage(..., false)`
- [x] 1.5 把 `preloadedPagesRef.clear()` 的 contextKey effect(行 611-613)搬入 hook
- [x] 1.6 把 `hasSearchPage`(行 615-618)搬入 hook 作为返回的 `hasPage`
- [x] 1.7 把 `usePaginatedPreloader` 装配(行 620-628)搬入 hook,`loadPage`/`commitPage` 指向 hook 内部的 `preloadSearchPage`/`consumePreloaded`
- [x] 1.8 在 hook 内部用 4 个 ref(`queryRef`/`modeRef`/`sourceRef`/`searchTagsRef`)同步传入的 `query/mode/source/searchTags`,沿用 commit `2a1d3b2` 的 `ref.current = value` 渲染期同步模式
- [x] 1.9 在 hook 内部用 `createSearchContextKey({query, mode, source, searchTags})` 计算 `contextKey`(useMemo)并返回,供集成测试与 hook 内部装配使用

  **实现注记**:深挖后发现 SearchPage 的 4 个 ref(`queryRef`/`modeRef`/`sourceRef`/`searchTagsRef`)被外部 handler 主动写入 40+ 处(如 `handleCategorySearch` 行 421、`handleToggleTag` 行 638),不仅是读取同步。因此按 tasks 2.5 预案:**外部 4 个 ref 保留**(外部 handler 仍需写入),hook 内部维护**独立但同源**的另一组 ref(从传入 prop 同步,纯读取用)。两组 ref 都来自组件 state,渲染结束时必然一致;唯一差异窗口(setState 后、下次渲染前)里 `preloadSearchPage` 不会被调用(它在 effect 里,需渲染提交后触发),故无冲突。

  **实现注记**:hook 内 `preloadedPagesRef.clear()` 改用 render-phase 比较(`clearRef.current !== contextKey`)替代原 useEffect,语义等价但避免引入额外 effect 依赖;`usePaginatedPreloader` 内部已在 contextKey 变化时 abort+clear inFlight,此 clear 是其补充(清中转缓存)。

  **实现注记**:hook 内部 `useSearchCacheStore()` 仅用于 hasPage 读取(经 searchCacheRef);持久层写入经注入的 `cacheSearchPage`,符合 design 决策 2(单一注入搬运路径)。

## 2. SearchPage 接入 hook

- [x] 2.1 在 SearchPage 导入 `useSearchPreloader`,替换已搬出的代码块(行 125、583-628)
- [x] 2.2 保留 SearchPage 自身的 `searchContextKey` useMemo(行 127-132)——`gridContainerKey`、`handleSearch` 等 9 处非预加载用途仍直接使用;此 useMemo 与 hook 内部的 contextKey 输入相同,`createSearchContextKey` 纯函数保证输出一致
- [x] 2.3 保留 SearchPage 的 `cacheSearchPage` wrapper(行 139-141)与 `searchCacheRef`(行 91-93)——搜索主流程的 4 处主动写入(行 273、340、382)与缓存恢复(行 144-146)仍直接使用;`cacheSearchPage` 作为参数注入 hook
- [x] 2.4 从 hook 返回值取 `hasPage` 传给(已搬入 hook 的)装配——验证 SearchPage 不再直接调用 `usePaginatedPreloader`、不再直接持有 `preloadedPagesRef`
- [x] 2.5 删除 SearchPage 中已搬出的 4 个 ref(`queryRef`/`modeRef`/`sourceRef`/`searchTagsRef`,行 117-124)——它们已由 hook 内部持有;**但仅在确认这 4 个 ref 在 SearchPage 别处无其他引用后删除**(用 `grep queryRef\.current src/pages/SearchPage.tsx` 等核查;若 `handleSearch` 等仍引用,则保留外部的 ref,不强行删除)
- [x] 2.6 运行 `npx tsc --noEmit` 确认无类型错误(`noUnusedLocals` 会拦截残留的未使用导入/变量)

  **实现注记**:4 个外部 ref **保留**——深挖发现 `handleCategorySearch`/`handleToggleTag`/`handleRandom` 等 handler 主动写入它们 40+ 处(如 `queryRef.current = categoryTitle`)。这些 ref 的职责是"在 setState 触发重渲染前,handler 内部后续同步代码读到最新值";hook 内部维护另一组独立 ref(从 prop 同步,纯读取用),两组同源自组件 state,无冲突。tsc `noUnusedLocals` 通过证实外部 ref 仍被使用。

## 3. 既有测试回归验证

- [x] 3.1 运行 `npm test -- SearchPage` 确认 SearchPage 既有测试(1083 行)全绿——这是搬运正确性的首要回归网
- [x] 3.2 运行 `npm test -- usePaginatedPreloader` 确认 hook 层测试(502 行)全绿——hook 装配搬运不应影响其行为
- [x] 3.3 运行 `npm test` 确认全套前端测试无回归
- [x] 3.4 若 SearchPage 测试因 mock 结构变化(如不再需要 mock `usePaginatedPreloader`)而失败,按 test-discipline 准则修正——补充真实行为断言,而非加裸 mock 断言

  **回归结果**:SearchPage 48 测试全绿;usePaginatedPreloader 19 测试全绿;全套 83 文件 / 1224 测试全绿,零回归。既有测试无需任何改动——SearchPage 测试 mock 的是 `useIpc`/`useComicStore` 等上层依赖,不直接 mock `usePaginatedPreloader`,故 hook 抽取对其透明。

## 4. 新增集成测试 `useSearchPreloader.test.tsx`

- [x] 4.1 创建 `tests/unit/hooks/useSearchPreloader.test.tsx`,搭建测试基础设施:`renderHook` 挂载真实 `useSearchPreloader` + 真实 `useSearchCacheStore`;`searchFn` 用 deferred 模式控制 IPC resolve 时机(沿用 `usePaginatedPreloader.test.tsx` 的 `createDeferred` 模式)
- [x] 4.2 实现"迟到结果不写入中转缓存"场景:触发来源 A 预加载 → 切到来源 B → A 迟到 resolve → 断言 `hasPreloaded(A 的 page, A 的 contextKey)` 返回 `false`(直接观察中转层,绕过 commit-gate)
- [x] 4.3 实现"迟到结果不污染持久缓存存储"场景:上述流程后断言 `useSearchCacheStore.getState().contexts[A_contextKey]` 不含预加载写入的页(用户感知层补充断言)
- [x] 4.4 实现"contextKey 切换时中转缓存被清空"场景:A 下预加载 → 切到 B → 断言 `hasPreloaded(A 的 page, A 的 contextKey)` 返回 `false`(双重保护:signal.aborted + clear)
- [x] 4.5 实现"未切换 contextKey 时预加载正常写入"场景:触发 A 预加载 → 不切换 → resolve → 断言 `hasPage` 经 commit 后数据出现在 store(守护中断逻辑未误伤正常路径)
- [x] 4.6 (验证性,手动)临时删除 `useSearchPreloader.ts` 中的 `if (signal.aborted) return` 行,确认 4.2 与 4.4 场景失败;恢复后确认全绿——这是集成测试存在的根本理由的负向验证(记录在 commit message,不留删除痕迹)

  **负向验证结果(关键)**:第一轮负向验证揭露 design 决策 5 的不足——最初用 `consumePreloaded` + store 状态间接断言中转层,删除 `signal.aborted` 后**只有不变量 3 失败**,不变量 1、2 通过。根因:`usePaginatedPreloader` 的 commit-gate(`generation` 检查)是更外层保护,即使中转缓存被脏写,自动 commit 仍被拦截,store 层断言无法捕获。

  **修正**:给 hook 增加 `hasPreloaded(page, contextKey)` 查询函数,让测试直接观察中转缓存状态,绕过 commit-gate。第二轮负向验证确认:删除 `signal.aborted` 后,不变量 1、3 通过 `hasPreloaded` 断言失败(`expected true to be false`),证明中转层被脏写;不变量 2(store 层)仍通过(commit-gate 兜底),正确反映双层保护的语义分层。design.md 与 specs delta 已同步更新 `hasPreloaded` 的引入理由。

  **API 影响**:`hasPreloaded` 在生产代码中也有合理用途(去重检查、预加载状态查询),非纯测试出口,不构成 API 污染。

## 5. 规范与文档同步

- [x] 5.1 确认 `openspec/changes/extract-use-search-preloader/specs/paginated-preload-interruption/spec.md` delta 已就绪(本变更已创建,并在 Phase 4 负向验证后同步 `hasPreloaded` 观察出口的需求)
- [x] 5.2 在 commit message 中记录:hook 边界选 S1 而非 S2 的耦合面数据理由(`searchCacheStore` 11 处触碰中仅 2 处属预加载)、`signal.aborted` 负向验证结果、`hasPreloaded` 引入理由

  **注**:5.2 的 commit message 待用户提交时写入;关键发现已记录在 design.md 决策 5 与 tasks.md Phase 4 实现注记中,确保可追溯。

## 6. 完整验证流程

- [x] 6.1 `pytest` — Python 测试(本变更不触及 Python,确认无意外回归)
- [x] 6.2 `npx tsc --noEmit` — TypeScript 类型检查
- [x] 6.3 `npm test` — 前端测试(含新增集成测试)
- [x] 6.4 `npm run lint:py` — Python lint(无 Python 改动,确认无意外)
- [x] 6.5 `black --check .` — Python 格式化(同上)
- [x] 6.6 `npm run lint` — JS/TS lint
- [x] 6.7 `npm run lint:test-quality` — 测试质量闸门(守护新增集成测试不引入裸 mock 断言、纯 store CRUD 往返)

  **验证结果(全绿)**:
  - pytest: 971 passed
  - tsc: 无错误(`noUnusedLocals` 通过)
  - vitest: 84 文件 / 1228 测试 passed(较变更前 83 文件 / 1224 测试,新增 1 文件 4 测试)
  - ruff: All checks passed
  - black: 126 files unchanged
  - ESLint: 无错误
  - lint:test-quality: 通过(新增集成测试无裸 mock 断言违规)

  **实施中发现并修正的问题**:
  1. 初版 hook 用 render-phase ref 比较(`clearRef.current !== contextKey`)替代 useEffect,触发 React 19 `react-hooks/refs` 规则(4 个 error)。修正:改回 useEffect(与原 SearchPage 行 610-612 一致)。修正后重新负向验证,确认 signal.aborted 守护链路仍完整。
  2. 初版测试用 `consumePreloaded` + store 状态间接断言中转层,负向验证发现被 commit-gate 兜底掩盖。修正:引入 `hasPreloaded` 查询函数直接观察中转层,绕过 commit-gate。

  两次发现都证明"实施时负向验证"的价值——它揭露了 design 与初版实现的不足,而非仅做正向绿灯确认。
