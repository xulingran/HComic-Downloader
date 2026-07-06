## 为什么

搜索栏在用户打字输入或删除文字时，下方结果列表会发生可见的闪烁——所有卡片会先淡出（exit 动画）再淡入（enter 动画），即使此时并未发起任何搜索请求。这给用户造成「每次按键都触发了重载」的错觉，严重影响输入体验。

根因：搜索结果容器的 React `key`（`gridContainerKey`）派生自**实时输入值** `query`（经 `searchContextKey`），而 `query` 在每个按键都会变化。结果容器在每次按键时被整体 remount，触发 `<AnimatePresence mode="popLayout">` 对所有卡片重放进入/退出动画。然而搜索请求实际只在 Enter 或点击搜索按钮时才发起——也就是说渲染层的抖动与数据层完全脱钩。

## 变更内容

- 将搜索结果容器的 `key` 解耦自实时输入：`gridContainerKey` 改为派生自**已加载的搜索上下文**（即当前 `comics` 实际所属的 query/mode/source/searchTags），仅在真正完成一次搜索后才更新。
- 把现有的 `loadedContextKeyRef`（一个用于区分翻页与新查询的 ref）提升为 React state，使其能够驱动渲染；更新点保持不变（仍在 `applySearchResult`、`handleSearch`、`pendingSearch` effect 等数据真正变更处 setState）。
- 经实施核实，顶层 `searchContextKey` useMemo 已是孤儿（缓存/预取逻辑早已改为各流程内部局部计算），一并删除以避免死代码与 `no-unused-vars` 警告。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `list-loading-feedback`: 补充「未提交搜索时结果列表必须保持稳定」的渲染契约——当前规范只约束了新查询/翻页两种数据流转下的展示策略，未覆盖「输入未提交」这一中间态。需新增需求：输入框值变化但未提交搜索时，已加载的结果列表不得发生整体重挂载或重放卡片进出场动画。

## 影响

- **受影响代码**：
  - `src/pages/SearchPage.tsx`（核心：`searchContextKey` / `gridContainerKey` / `loadedContextKeyRef` 的角色重排，约 8-10 处 ref 赋值改为 setState）
  - 可能涉及 `src/stores/useSearchCacheStore.ts`（`createSearchContextKey` 仍保留，调用方语义不变）
- **不受影响**：
  - 搜索请求路径（`handleSearch` / `withLoading` / `searchGenRef` 竞态守卫）——本来就不在按键时触发
  - 卡片级 key（`getComicKey`）——本来就稳定
  - 动画系统（`AnimatedCardWrapper` / `anim.ts`）——无需改动，问题在调用方
- **回归风险**：低。改动集中在「何时换容器 key」，原有「翻页保留旧结果 + 遮罩」「新查询清空 + 骨架」的行为依赖 `loadedContextKey` 的更新时机，提升为 state 后语义不变。
- **测试**：建议补一个渲染稳定性测试，断言「修改未提交的 query 不触发结果容器 remount」（例如通过断言容器 DOM 节点引用在按键前后保持同一引用，或动画 variant 不重置）。
