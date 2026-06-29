## 新增需求

### 需求:承载 signal.aborted 检查的页面层 loadPage 实现必须有跨 hook 边界的集成测试守护

"预加载请求完成后写入结果前必须检查中断态"需求规定了 `loadPage` 回调实现(如搜索页的 `preloadSearchPage`)在 IPC `await` 之后、缓存写入之前**必须**检查 `signal.aborted`。这一检查是切源中断机制的最后一道闸——它位于页面层代码(非 `usePaginatedPreloader` hook 本身),hook 层的单元测试因 `loadPage` 被 `vi.fn()` 替换而**无法**守护这一行代码。因此,承载该检查的页面层 `loadPage` 实现**必须**有跨 hook 边界的集成测试,用真实 `usePaginatedPreloader`(产生真实 `AbortSignal`)+ 真实预加载缓存存储(Zustand store,jsdom 可跑)组合验证,仅 mock 外部 IPC 边界(用 deferred 控制返回时机)。该集成测试**禁止**通过 mock `loadPage` 来跳过真实实现——若如此,则等同于 hook 层单元测试,无法守护 `signal.aborted` 检查这一行。

搜索页的 `loadPage` 实现**必须**提取为独立可挂载的单元(本次为 `useSearchPreloader` hook),使集成测试能在不渲染整个页面(及其全部依赖)的前提下挂载真实的 `loadPage` 实现。该提取**禁止**改变预加载的运行时行为——预加载的触发、中断、缓存写入语义必须与提取前完全一致,由既有页面层测试网守护。

集成测试**必须**能直接观察中转缓存(`preloadedPagesRef`)的状态——通过 hook 暴露的 `hasPreloaded(page, contextKey)` 查询函数(查中转层)而非仅观察持久缓存存储(查持久层)。理由:`usePaginatedPreloader` 的 commit-gate(`generation` 检查)是更外层的保护,即使 `signal.aborted` 检查失效导致中转缓存被脏写,commit-gate 仍会拦截自动搬运到持久层,使仅观察持久层的断言无法捕获 `signal.aborted` 检查的失效。`hasPreloaded` 让测试绕过 commit-gate,专一守护 `signal.aborted` 检查这一行。

#### 场景:迟到结果不写入中转缓存(preloadedPagesRef)

- **当** 集成测试用真实 `useSearchPreloader`(含真实 `preloadSearchPage` 与 `signal.aborted` 检查)+ 真实 `usePaginatedPreloader` + mock `searchFn`(deferred 控制)挂载,触发来源 A 的某页预加载并使请求在 IPC `await` 中挂起,随后切换 contextKey 到来源 B,再让来源 A 的迟到请求 resolve
- **那么** 通过 `hasPreloaded(page, contextKeyA)` 查询中转缓存**必须**返回 `false`——即 `signal.aborted` 检查生效的直接证据:迟到结果禁止写入 `preloadedPagesRef`。该断言**禁止**仅依赖持久缓存存储状态,因 commit-gate 会兜底拦截自动搬运,掩盖中转层的脏写

#### 场景:迟到结果不污染持久缓存存储(searchCacheStore)

- **当** 上述场景发生后,测试观察持久缓存存储 `useSearchCacheStore` 的状态
- **那么** 来源 A 的 contextKey 下**禁止**出现由预加载迟到结果写入的页(仅搜索主流程的主动写入允许;预加载链路的迟到结果经 `signal.aborted` 检查与 `usePaginatedPreloader` 的 commit-gate 双重拦截,**禁止**到达持久层)。此场景作为用户感知层的补充断言,核心守护由"迟到结果不写入中转缓存"场景承担

#### 场景:contextKey 切换时中转缓存被清空

- **当** `useSearchPreloader` 的 `contextKey` 从 A 变为 B,且 A 下 `preloadedPagesRef` 此前已有数据(由未中断的正常预加载写入),或迟到结果在切换后被 `signal.aborted` 检查丢弃
- **那么** contextKey 切换后通过 `hasPreloaded(page, contextKeyA)` 查询中转缓存**必须**返回 `false`——双重保护(`signal.aborted` 丢弃 + contextKey 切换 `.clear()`)生效,禁止残留 A 的数据被 B 的 commit 误搬运

#### 场景:未切换 contextKey 时预加载正常写入

- **当** 集成测试触发来源 A 的某页预加载,请求正常 resolve 且期间 contextKey 未变化
- **那么** 结果**必须**正常写入 `preloadedPagesRef`(经 `hasPreloaded` 可查),经 `commitPage` 搬运后**必须**出现在持久缓存存储中(守护中断逻辑没有误伤正常预加载路径,防止过度中断)

#### 场景:删除 signal.aborted 检查时集成测试必须失败

- **当** 有人删除 `preloadSearchPage` 内部的 `if (signal.aborted) return` 检查(或使其失效),运行本需求的集成测试
- **那么** "迟到结果不写入中转缓存"与"contextKey 切换时中转缓存被清空"场景**必须**失败(通过 `hasPreloaded` 断言返回 `true` 而非 `false`)——这是集成测试存在的根本理由:守护 `signal.aborted` 检查这一行不被无声删除。"迟到结果不污染持久缓存存储"场景可能仍通过(commit-gate 兜底),这正确反映了双层保护的语义分层
