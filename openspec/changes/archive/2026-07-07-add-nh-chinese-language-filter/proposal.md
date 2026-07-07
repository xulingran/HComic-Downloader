## 为什么

NH 搜索页目前无法只浏览中文漫画；若在前端按 `ComicInfo.language` 过滤，实时 NH 搜索响应又只提供 `tag_ids` 而不提供完整语言元数据，容易把整页结果误判为空。NH API 已支持 `language:"chinese"` 搜索限定，因此应在服务端查询阶段完成过滤，以保持结果与分页准确。

## 变更内容

- 在 NH 来源搜索界面增加默认关闭的“仅显示中文”筛选开关，其他来源不显示该控件。
- 将中文筛选作为独立搜索上下文应用于 NH 的最近更新、关键词、精确标签和热门排行，并在切换筛选时从第一页重新查询。
- 使用 NH API 的 `language:"chinese"` 条件执行服务端过滤，禁止依赖列表项缺失的 `language` 字段做前端逐项剔除，也禁止用语义不同的 `tag:"chinese"` 代替。
- 扩展搜索 IPC 契约、搜索缓存和相邻页预加载上下文，使筛选与未筛选请求彼此隔离，并确保翻页继续携带筛选条件。
- 中文筛选开启时，由查询语义为返回项补充可信的 `language="chinese"` 元数据；关闭时保持现有结果行为。

## 功能 (Capabilities)

### 新增功能
- `nh-language-filter`: 定义 NH“仅显示中文”筛选的界面、服务端查询组合、分页、缓存、预加载和元数据行为。

### 修改功能
- `electron-ipc-contract`: 扩展搜索调用的可选 NH 语言筛选参数，并规定 renderer、preload、主进程与 Python JSON-RPC 的校验和转发边界。

## 影响

- 前端搜索状态和界面：`src/pages/SearchPage.tsx`、`src/components/SearchBar.tsx`、`src/hooks/useIpc.ts`。
- 搜索缓存和预加载：`src/stores/useSearchCacheStore.ts`、`src/hooks/useSearchPreloader.ts`。
- Electron/共享 IPC 契约：`shared/types.ts`、`electron/preload.ts`、`electron/main.ts` 及契约测试。
- Python 搜索编排和 NH 解析器：`python/ipc/search_mixin.py`、`sources/nh/parser.py` 及对应测试。
- 不新增第三方依赖，不改变非 NH 来源的搜索语义。
