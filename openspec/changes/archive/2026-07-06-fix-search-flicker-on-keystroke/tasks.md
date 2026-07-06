## 1. 状态改造：loadedContextKey 提升为 React state

- [x] 1.1 在 `src/pages/SearchPage.tsx` 把 `const loadedContextKeyRef = useRef<string | null>(null)`（第 144 行）替换为 `const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null)`，并补 `useState` 的 import。
- [x] 1.2 引入具名占位常量 `const INITIAL_GRID_KEY = 'initial'`（文件顶部常量区，附注释说明语义为「尚无已加载搜索结果时的容器占位 key」）。
- [x] 1.3 把以下 8 处 `loadedContextKeyRef.current = X` 全部改为 `setLoadedContextKey(X)`：
  - 第 264 行（初始挂载推荐 sections effect 内）
  - 第 342 行（pendingSearch effect 清空分支）
  - 第 354 行（pendingSearch effect 成功分支）
  - 第 418 行（withLoading 非翻页清空分支）
  - 第 426 行（withLoading cacheResult=false 分支）
  - 第 435 行（withLoading 成功后设置上下文）
  - 第 480 行（handleSearch 缓存命中分支）
  - 第 264 行已计入，另需核查 applySearchResult 是否内部也设置（当前未设置，无需改）

## 2. 翻页判定读取点处理（关键陷阱）

- [x] 2.1 第 499 行 `const isPaging = loadedContextKeyRef.current === contextKey` 改为读取 state。由于 `handleSearch` 是 `useCallback`，必须把 `loadedContextKey` 加入其依赖数组（第 501 行的依赖列表），确保闭包拿到最新值；否则翻页/新查询判定会读到 stale state。
- [x] 2.2 验证 `handleSearch` 加入 `loadedContextKey` 依赖后不会引发其他依赖链问题（如传递给子组件的 props 引用变化）。若有性能顾虑，可保留一个 `loadedContextKeyRef` 镜像在每次渲染时同步（`loadedContextKeyRef.current = loadedContextKey`），第 499 行仍读 ref——两种方案择一，需在代码注释中说明选择理由。

## 3. 容器 key 解耦

- [x] 3.1 修改 `gridContainerKey`（第 166 行）从 `` `${searchContextKey}:${pagination?.currentPage ?? 1}` `` 改为 `` `${loadedContextKey ?? INITIAL_GRID_KEY}:${pagination?.currentPage ?? 1}` ``。
- [x] 3.2 更新第 163-165 行注释，说明 key 现派生自「已加载上下文」而非「实时输入」，按键时不再变化。
- [x] 3.3 确认 `searchContextKey`（实时版 useMemo，第 156-161 行）保留不变，且其消费者仅限缓存查询（`searchCacheRef.current.getPage(contextKey, ...)` 等）与预取（`useSearchPreloader`），不再喂给 `gridContainerKey`。grep 验证无其他渲染层 key 消费者。

## 4. 测试：渲染稳定性回归

- [x] 4.1 新增测试用例（`tests/` 下，复用现有 SearchPage 测试套件命名约定），覆盖 spec 场景「打字输入新字符时结果列表不闪烁」与「删除搜索栏文字时结果列表不闪烁」：渲染 SearchPage → 完成一次搜索加载结果 → 模拟 `setQuery` 修改未提交的 query → 断言结果容器 DOM 节点引用保持同一引用（或断言容器 `key`/`data-grid-key` 属性值未变）。
- [x] 4.2 新增测试覆盖 spec 场景「提交搜索后容器 key 按预期切换」：修改 query 并触发 `handleSearch`（mock search 返回新结果）→ 断言容器 `key` 切换为新上下文。
- [x] 4.3 新增测试覆盖 spec 场景「翻页时容器 key 仍按页码切换」：已加载某页后触发翻页 → 断言容器 `key` 的页码部分变化。
- [x] 4.4 新增测试覆盖 spec 场景「首次进入页面无搜索时容器拥有稳定占位 key」：未发起搜索时 → 断言容器 `key` 含 `INITIAL_GRID_KEY` 占位值；输入未提交 query 后 → 占位 key 仍不变。

## 5. 验证闸门

- [x] 5.1 运行 `npm test`（前端测试，含新增渲染稳定性用例）全部通过。
- [x] 5.2 运行 `npx tsc --noEmit` 类型检查通过（重点确认 `loadedContextKey` 的 `string | null` 类型在所有使用点正确）。
- [x] 5.3 运行 `npm run lint`（ESLint）通过，无未使用变量（如彻底移除 `loadedContextKeyRef` 后无残留引用）。
- [x] 5.4 运行 `npm run lint:test-quality` 测试质量闸门通过（新增测试不得是裸 mock 调用断言）。
- [x] 5.5 手动验证：`npm run dev` 启动，在搜索栏快速打字/删除，确认结果列表无闪烁；提交搜索后列表正常切换；翻页正常 remount。
