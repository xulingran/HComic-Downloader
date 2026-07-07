## 1. 扩展搜索 IPC 契约

- [x] 1.1 在 `shared/types.ts` 和 `src/hooks/useIpc.ts` 为搜索调用追加受限的 `languageFilter?: 'chinese'` 参数，并在 Python `IPCMethods.search` 参数中声明 `language_filter?: 'chinese'`
- [x] 1.2 在 `electron/preload.ts` 校验语言筛选的类型与枚举值，并把合法参数传给主进程
- [x] 1.3 在 `electron/main.ts` 二次校验语言筛选、拒绝非 NH 来源携带筛选，并仅将合法值映射为 Python `language_filter`
- [x] 1.4 更新 IPC 一致性、preload 与主进程 handler 测试，覆盖合法、缺省、非法值、跨来源拒绝及 `allowInteractiveChallenge` 不转发

## 2. 实现 NH 服务端语言查询

- [x] 2.1 扩展 `python/ipc/search_mixin.py` 的 `handle_search`，仅允许 NH 使用 `language_filter='chinese'`，并把该参数传入 NH 搜索分发链路
- [x] 2.2 重构 `sources/nh/parser.py` 的搜索 URL 构造，使最近更新、关键词、精确标签和四种排行可组合 `language:"chinese"`，同时保持未筛选请求原行为及系统代理 Session 复用
- [x] 2.3 在仅中文服务端查询返回时为搜索列表项补充 `language='chinese'`，并确保未筛选且缺少 tags 的条目不被误标
- [x] 2.4 增加 Python 单元测试，覆盖四种查询模式、URL 编码、分页字段、`tag:"chinese"` 不被误用、缺失 tags 元数据和非法语言筛选拒绝

## 3. 隔离搜索缓存与预加载上下文

- [x] 3.1 为 `SearchPageCache`、`SearchContextInput` 和 `createSearchContextKey` 增加语言筛选维度，确保同查询的筛选/未筛选缓存键不同
- [x] 3.2 扩展 `useSearchPreloader` 的参数、ref 和 `SearchFn`，让相邻页请求及缓存提交携带对应语言筛选
- [x] 3.3 更新搜索缓存与预加载测试，覆盖筛选缓存隔离、翻页参数透传、切换筛选中断旧请求和迟到结果禁止提交

## 4. 接入 NH 搜索页交互

- [x] 4.1 在 `SearchPage` 增加默认关闭且不持久化的 NH 仅中文状态，并把它传入最近更新、关键词、标签、排行、翻页、后台刷新和预加载调用
- [x] 4.2 在 `SearchBar` 的结果信息区域增加仅 NH 可见的“仅显示中文”复选框，并保持现有黑名单过滤数量文案独立
- [x] 4.3 实现开关行为：NH 入口页只更新状态不请求；已有结果时清除批量选择、从第 1 页重新搜索；非 NH 请求不携带筛选
- [x] 4.4 更新 `SearchPage`/`SearchBar` 测试，覆盖默认状态、来源可见性、入口页无请求、四类入口应用筛选、结果页重搜、翻页、搜索历史不污染及返回 NH 后的运行期状态

## 5. 完整验证

- [x] 5.1 运行 NH/Python 定向测试与前端搜索、缓存、预加载、IPC 定向测试并修复回归
- [x] 5.2 运行 `pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`npm run format:py`、`npm run lint` 和 `npm run lint:test-quality`，确认全部通过
