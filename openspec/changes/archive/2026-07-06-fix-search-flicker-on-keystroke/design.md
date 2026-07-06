## 上下文

搜索页 `SearchPage.tsx` 用一个派生自实时输入的字符串作为结果容器的 React `key`：

```
query (实时, 每按键变)
  └─▶ searchContextKey = createSearchContextKey({query, mode, source, searchTags})
        └─▶ gridContainerKey = `${searchContextKey}:${currentPage}`
              └─▶ <div key={gridContainerKey}> ... <AnimatePresence mode="popLayout"> ...
```

`query` 在 `SearchBar.onChange` 每个按键都会 `setQuery`，因此 `gridContainerKey` 每次按键都变。React 见到 key 变化会卸载旧容器、挂载新容器，`<AnimatePresence mode="popLayout">` 随之对所有子卡片播放 exit（opacity→0, scale→0.9）+ enter（opacity 0→1, y 8→0, 带 stagger 延迟）动画——这就是用户看到的闪烁。

讽刺的是，搜索请求本身只在 Enter / 搜索按钮触发（`handleSearch`），并有 `searchGenRef` 代际守卫防止竞态。也就是说**数据层完全没有抖动，纯粹是渲染层 key 选错了来源**。

代码里已存在 `loadedContextKeyRef`（一个 ref），在 `applySearchResult` / `handleSearch` / `pendingSearch` effect 等数据真正变更处更新，精确表达了「当前 comics 所属的查询上下文」——但它只是个 ref，无法驱动渲染。

### 关键约束

- 翻页时容器 key **必须**变（同一上下文换页会全量替换卡片，需 remount 规避 framer-motion `layout` 在 popLayout 全量替换下的 mount 测量竞态——见 `SearchPage.tsx:163-165` 注释）。
- 新查询/换来源/换 mode 时容器 key **必须**变（整页全量替换）。
- cardStyle 切换时容器 key **必须不变**（依赖 layout 位置过渡）。
- **按键修改未提交的 query 时容器 key 必须不变**（本次修复目标）。

## 目标 / 非目标

**目标：**

- 消除搜索栏打字/删除时结果列表的闪烁。
- 让结果容器的 `key` 反映「已加载的数据所属上下文」而非「实时输入」。
- 复用已有的 `loadedContextKey` 概念，最小化语义改动。

**非目标：**

- 不改动搜索请求触发时机（保持 Enter / 按钮触发，不加 debounce 到请求路径）。
- 不改动动画系统（`AnimatedCardWrapper` / `anim.ts` / `tailwind.config.js`）。
- 不改动卡片级 key（`getComicKey` 已稳定）。
- 不改动缓存查询 / 预取逻辑（`searchContextKey` 实时版保留给它们用）。
- 不引入新的 debounce hook 或请求节流。

## 决策

### 决策 1：把 `loadedContextKeyRef` 提升为 `loadedContextKey` state

**选择**：将 `const loadedContextKeyRef = useRef<string | null>(null)` 改为 `const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null)`，所有现有 `loadedContextKeyRef.current = X` 赋值点改为 `setLoadedContextKey(X)`。

**理由**：
- 现有 ref 已经精确表达了所需语义（注释：「记录当前 comics 所属的搜索上下文」），且更新点已经分布在所有数据真正变更的地方。提升为 state 后，同样的更新时机能驱动渲染，语义零偏移。
- 更新点稀疏（约 8 处，全部在 `applySearchResult` / `handleSearch` / `pendingSearch` effect / `withLoading`），不会引入高频 setState。

**替代方案 A（拒绝）**：新增独立的 `loadedQuery` state 并复制 `query/mode/source/searchTags` 四元组。问题：概念与 `loadedContextKey` 重复，两套「已加载上下文」真相会漂移；且要新增四处 state 同步逻辑。

**替代方案 B（拒绝）**：直接删掉容器 `key`，靠 framer-motion `layout` 自动 diff。问题：违反 `SearchPage.tsx:163-165` 已记录的设计决策——popLayout 全量替换下 `layout` 有 mount 测量竞态（封面从左上角飞入），key 正是为了规避它而存在。

### 决策 2：`gridContainerKey` 改派生自 `loadedContextKey`

**选择**：

```ts
// 修改前
const gridContainerKey = `${searchContextKey}:${pagination?.currentPage ?? 1}`

// 修改后
const gridContainerKey = `${loadedContextKey ?? 'initial'}:${pagination?.currentPage ?? 1}`
```

`loadedContextKey` 为 `null`（首次进入、尚无搜索）时使用兜底字面量 `'initial'`，确保容器仍有稳定 key（不会因 null 拼出 `"null:1"` 这种语义模糊的值，也避免后续 if 分支）。

**理由**：`pagination.currentPage` 仍参与 key——翻页时 `loadedContextKey` 不变（同一上下文），但页码变，key 随之变，保留「翻页 remount」语义。

### 决策 3：实时版 `searchContextKey` useMemo 经核实为孤儿，直接删除

**选择**：删除顶层 `const searchContextKey = useMemo(...)`。

**理由**：实施任务 3.3 时 grep 核实，`searchContextKey` 在 `SearchPage.tsx` 内**已无任何运行时消费者**——所有缓存查询（`searchCacheRef.current.getPage(contextKey, ...)`）与预取（`useSearchPreloader`）都已改为在各搜索流程内部局部 `createSearchContextKey(...)` 计算（见第 267/357/438/483 行的局部 `contextKey`），`useSearchPreloader` hook 也自行接收 `query/mode/source/searchTags` 原值内部计算。原 design 设想的「保留实时版给缓存/预取」与代码现状不符——它是历史迁移遗留的孤儿，保留只会误导读者并触发 `no-unused-vars`。删除更诚实。

**替代方案（拒绝）**：保留作为「实时上下文」预留。问题：无人消费的 useMemo 是死代码，且其依赖 `query/mode/source/searchTags` 会在每次按键时重算，徒增开销。

**`createSearchContextKey` import 保留**：因 267/357/438/483 行的局部调用仍需要它。

## 风险 / 权衡

**[风险] 提升为 state 后，`loadedContextKey` 变更触发额外渲染** → 缓解：变更点全部位于「数据真正变更处」，那些时刻本来就会因 `comics` / `pagination` / `isLoading` 变化而重渲染，多一个 state 变化合并进同一次渲染（React batching），无额外渲染开销。

**[风险] `loadedContextKey` 与 `searchContextKey` 不一致时行为难以推理** → 缓解：两者用途严格分离（前者只驱动 `gridContainerKey`，后者只驱动缓存/预取），并在代码注释中明确标注。新增的渲染稳定性测试会锁定「未提交 query 变化时 `loadedContextKey` 不变」这一不变式。

**[风险] 兜底字面量 `'initial'` 与未来其他初始态冲突** → 缓解：使用具名常量 `INITIAL_GRID_KEY = 'initial'` 而非裸字符串，并在注释中说明其语义为「尚无已加载搜索结果时的容器占位 key」。

**[权衡] 不修复实时输入触发的 `setQuery` 重渲染本身**：用户每次按键仍会让 `SearchPage` 重渲染（因为 `query` 是 state）。这是受控输入的固有成本，且本次只解决「闪烁」（可见的列表 remount），不解决「重渲染」（不可见的虚拟 DOM diff）。若后续需要优化输入响应，可单独引入 `useDeferredValue` 或将 `query` 下沉到 `SearchBar` 内部，不在本次范围。
