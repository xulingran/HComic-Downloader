# paginated-preload-interruption 规范

## 目的

定义分页预加载在查询上下文切换、组件卸载和异步请求迟到时的中断与提交边界，防止旧来源、旧查询或交互挑战结果污染当前页面及缓存。

## 需求

### 需求:查询上下文切换时必须中断所有 in-flight 预加载请求

分页列表预加载 hook（`usePaginatedPreloader`，搜索页 / 收藏页 / 历史页共用）在查询上下文（`contextKey`）发生变化时，**必须**中断该 contextKey 下所有尚未完成的 in-flight 预加载请求。中断**必须**覆盖所有触发 `contextKey` 变化的场景——搜索页切换来源 / 切换查询词 / 切换搜索模式 / 切换筛选标签、收藏页切换来源、历史页切换筛选条件。中断语义**必须**对全部已发出但未完成的预加载 IPC 请求一次性生效，**禁止**让旧上下文的请求继续写入预加载结果缓存。

#### 场景:搜索页切换来源时旧来源预加载被中断

- **当** 搜索页已加载来源 A 的某页且相邻页预加载正在抓取来源 A 的第 N±1、N±2 页（请求在 IPC `await` 中挂起），用户切换到来源 B（`contextKey` 从 `search:...A` 变为 `search:...B`）
- **那么** 来源 A 下所有 in-flight 预加载请求被标记为已中断
- **且** 这些请求即使随后从 Python 后端返回，也**禁止**把结果写入来源 A 的预加载结果缓存（`preloadedPagesRef` / `useSearchCacheStore`）

#### 场景:收藏页切换来源时旧来源预加载被中断

- **当** 收藏页已加载来源 A 的某页且相邻页预加载正在抓取来源 A 的第 N±1、N±2 页，用户切换到来源 B（`contextKey` 从 `favourites:A` 变为 `favourites:B`）
- **那么** 来源 A 下所有 in-flight 预加载请求被标记为已中断
- **且** 这些请求的迟到返回**禁止**写入来源 A 的预加载结果缓存，避免脏数据残留与内存泄漏

#### 场景:切换查询词/模式/标签时预加载被中断

- **当** 搜索页已加载上下文 A（来源 + 查询词 + 模式 + 标签的组合）且预加载 in-flight，用户修改查询词 / 搜索模式 / 筛选标签使 `contextKey` 变为 B（B ≠ A）
- **那么** 上下文 A 下所有 in-flight 预加载请求被中断
- **且** 迟到返回**禁止**写入上下文 A 的预加载结果缓存

### 需求:预加载请求完成后写入结果前必须检查中断态

`loadPage` 回调（页面实现的 `preloadSearchPage` / `preloadFavouritesPage` 等）在预加载 IPC `await` 完成、写入预加载结果缓存之前，**必须**检查该请求是否已被中断；已中断时**必须**丢弃结果并立即返回，**禁止**执行任何缓存写入。该检查**必须**发生在 IPC `await` 之后、缓存 `.set()` 之前这一关键窗口，确保即使 Python 端请求已跑完，过期结果也不会污染缓存。

#### 场景:迟到完成的请求在写入前被丢弃

- **当** 某预加载请求的 IPC 调用已发出，随后 `contextKey` 变化使该请求被标记中断，最终该请求的 IPC 调用从 Python 端返回结果
- **那么** `loadPage` 检测到中断态后**禁止**将结果写入 `preloadedPagesRef`
- **且** **禁止**触发该页的 `commitPage` 回调
- **且** 不抛出异常（中断是正常控制流，非错误）

#### 场景:未中断的请求正常写入结果

- **当** 某预加载请求在完成时其所属 `contextKey` 仍是当前上下文（未被中断）
- **那么** `loadPage` 正常将结果写入预加载结果缓存
- **且** 正常触发 `commitPage` 提交该页

### 需求:组件卸载时必须中断所有 in-flight 预加载请求

当承载 `usePaginatedPreloader` 的页面组件卸载时，所有 in-flight 预加载请求**必须**被中断，迟到返回**禁止**写入任何预加载缓存。这保证页面被 keep-alive 移出存活集合或彻底卸载时，不残留无主的预加载协程与脏写。

#### 场景:页面卸载后迟到请求不写入

- **当** 搜索页 / 收藏页 / 历史页组件卸载，而其 in-flight 预加载请求随后从 Python 端返回
- **那么** 这些请求被判定为已中断
- **且** **禁止**写入对应的预加载结果缓存

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

### 需求:搜索预加载必须以非交互模式调用搜索 IPC

搜索页预加载（`useSearchPreloader`）调用 `search` IPC 时必须传递 `allowInteractiveChallenge=false`（或省略该参数使其缺省为 false）。这确保相邻页预加载、后台缓存刷新等非用户主动触发的搜索请求遇到 JM 反爬挑战时静默失败，保留既有缓存，绝不打开可见或隐藏的验证窗口。

#### 场景:预加载被挑战时静默失败

- **当** 搜索预加载请求 JM 搜索相邻页，Python 返回结构化挑战错误（`-32002`），且预加载以 `allowInteractiveChallenge=false` 调用
- **那么** 主进程禁止打开验证窗口
- **且** 该预加载请求按可恢复挑战错误结束
- **且** 预加载结果不写入缓存（由既有中断语义处理），已显示的搜索结果缓存保留

#### 场景:用户主动搜索可触发交互恢复

- **当** 用户主动点击搜索（`handleSearch`），以 `allowInteractiveChallenge=true` 调用 `search`，Python 返回结构化挑战错误
- **那么** 主进程可打开 JM 验证窗口
- **且** 验证完成后用原参数重试搜索一次

#### 场景:预加载与主动搜索的交互标志分离

- **当** 同一搜索页同时存在用户主动搜索（交互）和相邻页预加载（非交互）的请求
- **那么** 主动搜索请求携带 `allowInteractiveChallenge=true`，预加载请求携带 `allowInteractiveChallenge=false`
- **且** 两者独立判定是否触发验证窗口，互不干扰
