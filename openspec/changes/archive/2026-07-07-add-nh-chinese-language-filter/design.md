## 上下文

NH 搜索当前跨越 React 搜索页、Zustand 搜索缓存、相邻页预加载、Electron IPC、Python SearchMixin 与 `NhParser`。实时 `GET /api/v2/search` 列表只返回 `tag_ids`，而现有 `_parse_search_item` 仍尝试从可选 `tags` 提取 `language`；因此前端无法可靠地用 `ComicInfo.language` 对当前页做本地过滤。

NH 的搜索语法已支持 `language:"chinese"`。该限定可与普通关键词、`tag:"..."` 和热门 `sort` 参数组合，并由服务端返回过滤后的分页。项目所有 NH 请求仍必须复用已注入系统代理的 parser Session。

## 目标 / 非目标

**目标：**
- 提供仅在 NH 来源可见、默认关闭、运行期有效的“仅显示中文”筛选。
- 让最近更新、关键词、精确标签、排行、翻页和相邻页预加载遵守同一筛选状态。
- 保持过滤后分页和缓存准确，避免 N+1 详情请求。
- 以受限、可验证的参数跨越 renderer → Electron → Python 边界。

**非目标：**
- 不新增日文、英文或任意语言选择器。
- 不抓取 `/language/chinese/` HTML 页面，也不引入新的 HTML 解析路径。
- 不修复所有未筛选 NH 搜索结果缺少完整标签的问题。
- 不把筛选偏好写入 `config.json`，也不改变非 NH 来源行为。

## 决策

### 1. 使用搜索 API 语言限定，而不是前端过滤

开启筛选后，Python 必须把固定限定 `language:"chinese"` 合并进 NH 搜索查询：

| 搜索场景 | API 查询语义 |
|---|---|
| 最近更新 | `query=language:"chinese"`，不传热门 sort |
| 关键词 | `query=<用户关键词> language:"chinese"` |
| 精确标签 | `query=tag:"<标签>" language:"chinese"` |
| 热门排行 | `query=language:"chinese"&sort=<当前排行>` |

空关键词且未开启筛选仍走现有 galleries 最近更新端点；空关键词且开启筛选改走 search 端点。查询构造继续使用 `urlencode`，且语言值来自固定枚举，禁止直接拼接任意 renderer 输入。

备选方案是前端按 `ComicInfo.language` 过滤，但实时列表缺少该字段，会产生空页、错误总数和不稳定行为。另一备选方案是逐项请求详情，会把每页一个请求放大为约 26 个请求，增加延迟与限流风险。两者均不采用。

### 2. 新增受限的独立搜索参数

共享前端 API 在现有参数末尾增加可选 `languageFilter?: 'chinese'`，保留现有 `allowInteractiveChallenge` 的位置与语义。preload 验证类型和枚举值；主进程再次验证，并且只允许 `source === 'nh'`。主进程把数据参数映射为 Python JSON-RPC 的 `language_filter: 'chinese'`，但继续消费而不转发 `allowInteractiveChallenge`。

Python `handle_search` 和 NH parser 使用默认空字符串的可选 `language_filter`，确保旧调用与其他来源无需迁移。SearchMixin 负责来源级限制与模式路由，NhParser 负责最终 URL 构造和在受限响应上补充语言元数据。

备选方案是把限定直接塞进可见 `query` 或复用 `tag` 参数。前者会污染搜索框、历史与缓存语义；后者会混淆普通 tag 与 language 类型，因此不采用。

### 3. 筛选是搜索上下文的一部分

`SearchPage` 持有 `nhLanguageFilter` 运行期状态；`createSearchContextKey`、`SearchPageCache` 和 `useSearchPreloader` 的上下文/ref 都加入该字段。筛选开关变化会形成新 context key，从而触发现有预加载中断和迟到结果隔离机制。

筛选在 NH 入口页切换时只更新状态，不发请求；已有结果时切换则清除批量选择并搜索第 1 页。切换到其他来源仅隐藏并停止应用筛选，不把参数传给其他来源；本次 SearchPage keep-alive 生命周期内返回 NH 时可恢复开关状态，应用冷启动仍默认为关闭。

备选方案是复用 `searchTags` 表示中文条件，但会让标签计数、标签面板和上下文展示失真，因此不采用。

### 4. 由查询来源补充列表语言元数据

当且仅当请求携带受支持的 `language_filter='chinese'` 时，NhParser 在解析搜索列表后把结果 `language` 设为 `chinese`。这是由服务端过滤谓词保证的来源信息，不依赖缺失的 `tags`。未筛选列表继续维持现有解析结果；详情页仍以详情 API 的完整 tags 为准。

### 5. UI 与统计文案保持语义准确

“仅显示中文”控件放在 SearchBar 的结果信息/筛选区域，并只在 NH 来源显示。服务端不会同时返回“过滤前数量”，因此 UI 只展示过滤查询自身的“共 N 条结果”，不把未返回的漫画计入现有黑名单“已过滤 N 条”统计。

## 风险 / 权衡

- [NH 搜索语法或端点变更] → 将查询组合集中在 NH parser，并用 URL 构造单元测试覆盖四种模式。
- [筛选与缓存键遗漏导致串页] → 让筛选进入统一 context key，并覆盖主搜索、缓存恢复、预加载与迟到结果测试。
- [位置参数扩展造成前端调用错位] → 只在现有公共 API 参数末尾追加筛选参数，并更新共享类型与 IPC 一致性测试。
- [筛选开启时人为补充 language 可能与未来 API 变化重复] → 仅对固定服务端谓词补充同值字段；若响应未来恢复完整 tags，同值赋值保持幂等。
- [入口页开关行为不明显] → 控件状态即时可见，但遵循入口页“禁止自动内容请求”的既有契约，下一次显式入口动作才使用筛选。

## 迁移计划

1. 先扩展共享类型和逐层 IPC 校验，默认缺省值保持旧行为。
2. 增加 Python 查询组合与测试，再接入前端状态、缓存和预加载。
3. 最后增加 UI 控件与集成测试，并运行项目完整验证流程。

变更不包含持久化数据迁移。回滚时移除可选参数和 UI 状态即可；由于默认关闭且无配置写入，旧缓存可在开发版本升级时直接由既有内存生命周期淘汰。

## 未决问题

无。当前范围固定为中文二态筛选；未来若扩展多语言，应另行将枚举和 UI 升级为语言选择器。
