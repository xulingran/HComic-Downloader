## 上下文

`SearchPage.tsx`(1100+ 行)承担搜索 UI、状态管理、缓存、预加载四重职责。其中预加载链路——`preloadedPagesRef` 临时缓存、`preloadSearchPage` 抓取、`commitPreloadedSearchPage` 搬运、`usePaginatedPreloader` 装配——散落在组件体的多个位置(行 125、583-628),与搜索主流程、缓存恢复逻辑交织。

commit `2a1d3b2`(`interrupt-preload-on-context-switch`)在 `preloadSearchPage` 内部增加了 `if (signal.aborted) return` 检查(行 592),作为切源中断预加载的最后一道闸。但现有测试无法守护这一行:

- `usePaginatedPreloader.test.tsx` 用 `vi.fn()` 作为 `loadPage`,跳过真实 `preloadSearchPage`。
- `SearchPage.test.tsx` mock 掉全部 IPC + store,数据流被切断。

要为这条 `signal.aborted` 检查写集成测试,需要把 `preloadSearchPage` 从 `SearchPage` 内部提取为可独立挂载的单元。提取本身也改善 SearchPage 耦合度——这是本次变更的双重收益。

**利益相关者约束**(来自 `AGENTS.md`):
- 所有动画用 framer-motion,token 集中管理——本变更不触及动画。
- Context Isolation + IPC 严格校验——本变更不触及 IPC 边界,`searchFn` 仍是注入的 `useSearch()` 返回值。
- `noUnusedLocals`/`noUnusedParameters` 开启——hook 提取后 SearchPage 不得残留未使用的导入或变量。

## 目标 / 非目标

**目标:**
- 把 `preloadSearchPage` 及其依赖的预加载状态从 `SearchPage` 提取到独立 hook `useSearchPreloader`,使 `signal.aborted` 检查成为可独立挂载、可测试的单元。
- 新增集成测试,用真实 `useSearchCacheStore` + 真实 `usePaginatedPreloader` 组合,验证切源中断的四个不变量。
- 守护 commit `2a1d3b2` 的修复不被回归——若有人删除 `signal.aborted` 检查,集成测试必须失败。

**非目标:**
- 不抽取 `useSearchCacheStore` 进 hook(S2 方案)——该 store 的 11 处触碰中仅 2 处属预加载,强行内化破坏内聚。
- 不改 `usePaginatedPreloader` 自身——它已有充分的 hook 层测试(502 行)。
- 不改 `FavouritesPage` / `HistoryPage` 的预加载实现——它们的 `loadPage` 仍内联,留作未来变更。
- 不改 IPC 契约、不改 Python 后端、不改动画系统。
- 不补 `signal.aborted` 检查到 `FavouritesPage` / `HistoryPage`——commit `2a1d3b2` 已在那里加了同样的检查(本次只补测试,不动它们的实现)。

## 决策

### 决策 1:hook 边界选 S1(薄包装)而非 S2(厚封装)

**选择**:hook 内化 `preloadedPagesRef` + `preloadSearchPage` + `commitPreloadedSearchPage` + clear effect + `hasSearchPage` + `usePaginatedPreloader` 装配。**不**内化 `searchContextKey` 计算、`useSearchCacheStore` 读写、`cacheSearchPage` wrapper——它们作为参数/外部依赖传入或保留。

**理由**:耦合面数据显示 `useSearchCacheStore` 在 SearchPage 有 11 处触碰,其中:
- 预加载链路仅 2 处(行 608 commit、行 616 hasPage)
- 搜索主流程 4 处(行 273、340、382 主动写入,行 371 翻页读取)
- 缓存恢复 3 处(行 144-146)

把 store 纳入 hook 会让一个"预加载 hook"霸占整个搜索缓存入口,搜索主流程反而要去 hook 借写入函数——hook 名不副实,破坏内聚。S1 让 hook 只管"预加载的抓取/中转/搬运",store 的读写仍由 SearchPage 直接控制,hook 经 `cacheSearchPage` 参数注入搬运路径。

**考虑过的替代方案**:
- **S2(厚封装)**:把 store 也内化。测试可断言"signal.aborted 时 store 不被脏写"更直接,但代价是破坏内聚,且与既有 9 处 store 用法冲突。否决。
- **S0(纯加测试不重构)**:在测试文件里复制 `preloadSearchPage` 的 4 行关键逻辑。复制会随时间漂移,测试失真。否决。

### 决策 2:`cacheSearchPage` 作为参数注入,而非 hook 内部创建

**选择**:hook 签名接收 `cacheSearchPage: (contextKey, page, data, setCurrent?) => void` 作为参数。`commitPreloadedSearchPage` 内部调用它完成"中转 → store"的搬运。

**理由**:`cacheSearchPage` 的实现是 `searchCacheRef.current.setPage(...)` 的薄包装,而 `searchCacheRef` 来自外部 `useSearchCacheStore()`。搜索主流程(行 273、340、382)也直接用 `cacheSearchPage`。若 hook 内部创建自己的 `cacheSearchPage`,会出现两个 wrapper 操作同一 store——多余的间接层。注入让"搬运路径"显式,且测试时可注入真实 wrapper(背后是真实 store)或 spy。

**考虑过的替代方案**:
- hook 内部 `useSearchCacheStore()` + 创建自己的 wrapper:破坏"单一 store 实例"假设,否决。
- hook 直接接收 `searchCacheStore` 实例:暴露过多 store 内部 API,`cacheSearchPage` 是更窄的契约。否决。

### 决策 3:`contextKey` 计算留在 SearchPage,hook 内部用 ref 同步 4 个上下文值

**选择**:hook 接收 `query, mode, source, searchTags` 四个原始值,内部用 ref 同步(沿用 commit `2a1d3b2` 的 `queryRef`/`modeRef`/`sourceRef`/`searchTagsRef` 模式)。`contextKey` 的 `createSearchContextKey({...})` 计算由 hook 内部完成并返回,但 SearchPage 仍保留自己的 `searchContextKey` useMemo(因为 `gridContainerKey`、`handleSearch` 等 9 处非预加载用途需要它)。

**理由**:`contextKey` 是 4 个值的纯函数派生。hook 内部算一份用于预加载装配,SearchPage 算一份用于 UI 与搜索主流程。两者输入相同必输出相同——这是 `createSearchContextKey` 的纯函数保证(已由 `useSearchCacheStore` 的既有测试覆盖)。复制 useMemo 比"从 hook 借 contextKey 反向流回 SearchPage"更简单,且避免 hook 成为大杂烩。

**考虑过的替代方案**:
- 只在 hook 内算 `contextKey`,SearchPage 从返回值取:导致 `gridContainerKey` 依赖 hook 返回值,渲染时序耦合。否决。
- 只在 SearchPage 算,hook 接收 `contextKey` 字符串:hook 内部 `preloadSearchPage` 仍需 4 个值构造缓存数据(`SearchPageCache` 的 query/mode/source/searchTags 字段),所以 4 个值得传进来——那么 contextKey 不如内部算。折中后选当前方案。

### 决策 4:测试用 `renderHook` + 真实 store,而非渲染整个 SearchPage

**选择**:集成测试用 `@testing-library/react` 的 `renderHook` 挂载 `useSearchPreloader`,背后是真实 `useSearchCacheStore`(Zustand store 在 jsdom 可直接运行)。仅 mock `searchFn`(用 deferred 控制 IPC resolve 时机)。断言落在 `preloadedPagesRef` 的暴露快照与 `useSearchCacheStore.getState()` 上。

**理由**:`renderHook` 精准对应"跨 hook 边界的状态协调"这一测试目标,不引入渲染整个 SearchPage 的 108 个 mock 噪声。Zustand store 是纯 JS,jsdom 可跑,无需 mock——这正符合 `behavior-integration-tests` 规范"真实数据流 + mock 边界"的判定。

**考虑过的替代方案**:
- 渲染整个 SearchPage,mock `window.hcomic`:信号被 UI 渲染噪声稀释,且违背"测中断语义而非测 UI"。否决。
- 不抽 hook,用 RTL 渲染 SearchPage 子树:同样需要 mock 大量依赖。否决。

### 决策 5:`preloadedPagesRef` 的可观察性——暴露 `hasPreloaded` 查询函数

**选择**:hook 暴露 `hasPreloaded(page, contextKey): boolean` 查询函数,语义是"中转缓存(`preloadedPagesRef`)是否已有该页的预加载结果"。与 `hasPage`(查持久层)区分:`hasPreloaded` 查的是 IPC 已返回、尚未 commit 的中转数据。

**理由**(实施时负向验证揭露):最初的方案是"通过 `consumePreloaded` + store 状态间接断言",但负向验证(临时删除 `signal.aborted` 检查)发现——`usePaginatedPreloader` 的 **commit-gate**(`state.generation === generationRef.current`,行 79)是更外层的保护:即使 `signal.aborted` 检查失效导致 `preloadedPagesRef` 被脏写,commit-gate 仍会拦截自动 commit,使 store 层断言通过。这使不变量 1、2 无法捕获 `signal.aborted` 检查的失效——而那正是集成测试存在的根本理由。

`hasPreloaded` 让测试**直接观察中转层**,绕过 commit-gate,专一守护 `signal.aborted` 检查。负向验证确认:删除该检查后,不变量 1、3 通过 `hasPreloaded` 断言失败(`expected true to be false`),证明中转层被脏写;不变量 2(store 层)仍通过(commit-gate 兜底),作为用户感知层的补充断言。

`hasPreloaded` 在生产代码中也有合理用途(如去重检查、预加载状态查询),不是纯测试出口,故不构成 API 污染。

**考虑过的替代方案**:
- 暴露 `preloadedPagesRef` 的只读快照:扩大 API 面,且 ref 快照在并发下可能失真。否决。
- 只测 store 不测 ref:负向验证证实无法区分"ref 没脏"与"ref 脏了但 commit-gate 拦截"。否决。
- 通过 `consumePreloaded` + 手动触发 commit 间接断言:负向验证证实此路径被 commit-gate 兜底,无法捕获 signal.aborted 失效。否决。

## 风险 / 权衡

- **[风险] hook 提取时 ref 同步顺序出错,导致预加载读到陈旧值** → 缓解:沿用 commit `2a1d3b2` 已验证的 ref 同步模式(`ref.current = value` 在渲染期同步赋值);既有 `usePaginatedPreloader.test.tsx` + `SearchPage.test.tsx` 作为回归网;集成测试不变量 4(正常路径)专门守护"未切换时正常写入"。

- **[风险] hook 内部 `contextKey` 与 SearchPage 的 `searchContextKey` 因输入不同步而漂移** → 缓解:`createSearchContextKey` 是纯函数,输入相同时输出必然相同;两个 useMemo 的输入(query/mode/source/searchTags)来自同一组件 state,不会分别漂移。集成测试不变量 2 顺带验证 contextKey 一致性。

- **[权衡] 不暴露 `preloadedPagesRef`,测试只能间接断言中转层** → 可接受。用户感知的是持久层(store),中转层是实现细节;间接断言验证的恰好是用户感知的状态。若未来需要直接观察中转层(如调试),可临时暴露 dev-only getter,不纳入正式 API。

- **[权衡] 本次只补 `useSearchPreloader` 的集成测试,`FavouritesPage` / `HistoryPage` 的 `loadPage` 仍是黑盒** → 可接受。两个页面的 `loadPage` 实现内联且有 `signal.aborted` 检查(commit `2a1d3b2`),但无集成测试。本次范围限定搜索页作为范本;若范本验证有效,未来变更可复用此模式扩展到其他页面。在 proposal 的非目标中明确声明。

- **[风险] 测试用 deferred 模拟 IPC resolve 时机,可能与真实微任务调度有差异** → 缓解:`usePaginatedPreloader.test.tsx` 已大量使用 deferred 模式并稳定运行(行 228、295、335、377),证明该模式可靠;集成测试沿用同一模式,不引入新的时序假设。

## 迁移计划

纯前端重构,无数据迁移、无配置迁移、无 IPC 契约变更。

**部署步骤**:
1. 创建 `src/hooks/useSearchPreloader.ts`,从 SearchPage 搬运预加载代码。
2. SearchPage 改为调用 hook,删除已搬运代码。
3. 运行 `npm test` 确认既有测试全绿(SearchPage 测试网)。
4. 新增 `tests/unit/hooks/useSearchPreloader.test.tsx`。
5. 运行完整 7 步验证流程(含 `lint:test-quality` 守护新增测试质量)。

**回滚策略**:本变更纯代码搬运 + 新增测试,无生产数据影响。若发现问题,`git revert` 即可完全回滚,无遗留状态。
