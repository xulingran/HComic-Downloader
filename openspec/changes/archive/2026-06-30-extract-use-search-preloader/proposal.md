## 为什么

`interrupt-preload-on-context-switch`(commit `2a1d3b2`)为切源中断预加载引入了 `signal.aborted` 检查作为最后一道闸——它出现在 `SearchPage.tsx:592` 的 `preloadSearchPage` 内部,IPC `await` 之后、写 `preloadedPagesRef` 之前。这是整个中断机制**最关键的一行**,但**当前没有任何测试守护它**:

- `usePaginatedPreloader.test.tsx`(502 行,12 处 abort 断言)用 `vi.fn()` 作为 `loadPage`,完全跳过 `preloadSearchPage` 的真实实现。删掉第 592 行的 `if (signal.aborted) return`,所有现有测试仍全绿。
- `SearchPage.test.tsx`(1083 行)mock 掉了全部 IPC + store,无法验证预加载的真实数据流。

这正是 `behavior-integration-tests` 规范定义的 "Layer 3 缺口":hook 层与 store 层各自有单测,但"跨 hook 边界的状态协调"——即 `usePaginatedPreloader` 发出 signal、`preloadSearchPage` 检查 signal、`preloadedPagesRef` / `useSearchCacheStore` 据此决定是否写入——这条完整链路没有任何测试守护。最近归档的 `interrupt-preload-on-context-switch`、`fix-jm-favourites-cloudflare-challenge`、`optimize-list-switch-loading` 等多个真实 bug 修复都属于这一类跨模块状态协调问题,修复后只补了单元层的回弹网,缺少集成层的回归守护。

为什么现在做:切源中断刚上线、`preloadSearchPage` 的实现新鲜、上下文完整,此时抽 hook 并补集成测试成本最低;再拖一轮,该逻辑会随 SearchPage(1100+ 行)继续臃肿,抽取难度上升,且中断语义回归风险随每次搜索链路改动累积。

## 变更内容

### Phase 1 — 抽取 `useSearchPreloader` hook(S1 薄包装边界)

把 `SearchPage.tsx` 中**专属于预加载链路**的代码搬到独立 hook:

**移入 hook:**
- `preloadedPagesRef`(临时中转缓存)
- `preloadSearchPage`(含 `signal.aborted` 检查——守护目标)
- `commitPreloadedSearchPage`(中转 → store 的唯一搬运路径)
- `preloadedPagesRef.clear()` on contextKey change
- `hasSearchPage`(查 store)
- `usePaginatedPreloader` 装配

**留在外部(保持内聚):**
- `searchContextKey`(useMemo)——9 处非预加载用途共享,不止预加载
- `useSearchCacheStore` 读写——搜索主流程与缓存恢复仍直接使用
- `cacheSearchPage` wrapper

hook 签名:
```ts
useSearchPreloader({
  query, mode, source, searchTags,    // 上下文,内部用 ref 同步
  searchFn,                            // 唯一外部依赖(IPC 边界)
  currentPage, totalPages,             // 决定预加载触发
  enabled,                             // needsLogin/isLoading 抑制
  cacheSearchPage,                     // 写入 store 的注入点
}) => {
  contextKey: string,
  hasPage: (page) => boolean,
}
```

SearchPage 瘦身约 45 行;无逻辑变更,纯代码搬运。

### Phase 2 — 新增集成测试(`useSearchPreloader.test.tsx`)

用**真实模块组合**守护中断语义:

- **真实**:`useSearchPreloader`(含真实 `usePaginatedPreloader`)
- **真实**:`useSearchCacheStore`(Zustand,jsdom 可跑)
- **Mock**:仅 `searchFn`(用 deferred 控制 IPC resolve 时机)

四个不变量:
1. **核心**:contextKey 切换 + 旧请求迟到 resolve → `preloadedPagesRef` 不含旧 contextKey 的页(`signal.aborted` 检查生效的直接证据)
2. **用户感知**:contextKey 切换 + 旧请求迟到 resolve → `useSearchCacheStore` 不含旧 contextKey 的预加载页(经 `commitPreloadedSearchPage` 的间接守护)
3. **清理**:contextKey 切换 → `preloadedPagesRef` 被清空
4. **正常路径回归**:未切换 contextKey + 预加载 resolve → 正常写入中转 → 经 commit 写入 store(防止中断逻辑误伤)

### Phase 3 — 规范同步

`paginated-preload-interruption` 现有需求只要求 hook 层中断,本次新增"跨 hook 边界的集成测试必须守护 `signal.aborted` 检查"的需求,把 `behavior-integration-tests` 的 Layer 3 缺口判定准则具象到这条链路。

## 功能 (Capabilities)

### 新增功能

无(不引入新能力,`useSearchPreloader` 是既有预加载逻辑的提取,非新行为)。

### 修改功能

- `paginated-preload-interruption`:新增需求——"预加载中断语义必须有跨 hook 边界的集成测试守护"。现有需求只要求 `usePaginatedPreloader` 在 contextKey 变化时中断 in-flight 请求并丢弃迟到结果;本次补充要求**承载 `signal.aborted` 检查的页面层 loadPage 实现**(本次为 `useSearchPreloader`)**必须**有集成测试,用真实 store + 真实 hook 组合验证"迟到结果不写入任何预加载缓存"。

## 影响

- **新增生产代码**:`src/hooks/useSearchPreloader.ts`(~60 行,从 SearchPage 搬运)。
- **修改生产代码**:`src/pages/SearchPage.tsx`(删除约 45 行预加载代码,新增 hook 调用;`searchContextKey` / `cacheSearchPage` / `searchCacheRef` 保留——9 处非预加载用途仍直接使用)。
- **新增测试**:`tests/unit/hooks/useSearchPreloader.test.tsx`(~200 行,4 个不变量的集成测试)。
- **修改规范**:`openspec/specs/paginated-preload-interruption/spec.md` 新增需求 + 场景。
- **无 API 变更**:`useSearchPreloader` 是内部 hook,不暴露到 IPC 或外部接口。
- **无依赖变更**。
- **回归网**:既有 `usePaginatedPreloader.test.tsx`(hook 层)+ `SearchPage.test.tsx`(页面层,1083 行)覆盖搬运后的代码路径;既有 ESLint `test-quality` 规则守护新增测试不引入裸 mock 断言。
- **风险**:低-中。生产代码为纯搬运,但 hook 边界设计需一次到位;若 ref 同步或 `usePaginatedPreloader` 装配位置出错,既有测试网应能捕获。
- **范围限定**:本变更**不**抽取 `searchCacheStore` 进 hook(S2 方案),因为该 store 的 11 处触碰中仅 2 处属预加载,强行内化会破坏内聚。本变更**不**改 `usePaginatedPreloader` 自身、**不**改 IPC 契约、**不**改其他三个使用 `usePaginatedPreloader` 的页面(`FavouritesPage` / `HistoryPage`)——这些页面的 loadPage 实现仍内联,留作未来变更。
