## 上下文

nhentai 来源已在后端存在独立解析器，并通过 `requests.Session` 调用 `apply_system_proxy_to_session()` 满足系统代理约束。当前 `NhParser.search()` 已支持：空关键词加载最近更新、空关键词配合 `tag="popular"` 加载 popular 排序、关键词搜索。前端搜索页对哔咔有空状态分类入口页，但 nhentai 仍只显示普通空状态，且 `SOURCE_META.nh.supportsTagList` 为 false，搜索栏旁的标签面板不可用。

现有标签面板由 `TagListMixin` + SQLite `tag_list.db` + `useTagPanel` + `TagDialog` 组成。它目前通过搜索结果和收藏标签增量积累标签，支持 hcomic、moeimg、bika，不适合 nhentai 的原始标签目录；nhentai 提供 `/tags?sort=popular` 和 `/tags?sort=name` 页面，页面中的 `tagchip` 包含标签名与数量，可作为标签面板和入口页热门标签的数据源。

## 目标 / 非目标

**目标：**
- 在 nhentai 来源空状态显示入口页，包含最近更新、热门排行和热门标签快捷入口。
- 将 nhentai 接入现有搜索栏标签按钮和 `TagDialog`。
- 标签列表支持「热门」和「A-Z」排序，并优先使用 nhentai 原始标签目录数据。
- 点击 nhentai 标签时使用精确标签查询语义。
- 保持现有 IPC、缓存、分页和标签面板架构的兼容性。

**非目标：**
- 不新增独立的远程标签浏览页面。
- 不实现 nhentai 的收藏、随机或登录功能。
- 不引入新的前端 UI 库或 Python 依赖。
- 不实时抓取每一次标签弹窗打开；标签同步仍通过刷新动作和本地缓存完成。

## 决策

### 1. nhentai 标签目录在解析器层抓取

**选择**：在 `NhParser` 中新增标签目录请求和 HTML 解析方法，由 `TagListMixin` 在刷新 nh 标签列表时调用。

**理由**：
- `NhParser` 已经持有注入系统代理的 Session，新增网络请求放在解析器层能遵守仓库网络约束。
- 标签目录是 nh 来源的站点能力，解析细节应封装在 `sources/nh/`。
- IPC 层保持编排职责，不直接了解远端 HTML 结构。

**替代方案**：在 `TagListMixin` 直接请求 nhentai URL。该方案实现较快，但容易绕过解析器统一代理、headers 和错误处理约定，因此不采用。

### 2. 同步 popular 原始数据，本地提供两种排序

**选择**：`refresh_tag_list('nh')` 抓取 `https://nhentai.net/tags?sort=popular&page=N` 全量标签，保存标签名和精确数量；`get_tag_list(..., sort='popular'|'name')` 在 SQLite 中按 `count DESC, tag ASC` 或 `tag ASC` 排序。

**理由**：
- popular 页面已经包含完整标签与 count，足以派生热门和 A-Z 两种展示顺序。
- 避免为同一份标签数据分别抓取 popular 与 name 两套页面。
- 本地排序让 TagDialog 切换排序即时响应，也减少站点请求频率。

**替代方案**：分别抓取 `/tags?sort=popular` 与 `/tags?sort=name` 并保留远端顺序。该方案更贴近页面顺序，但存储模型复杂，收益较小。

### 3. 扩展现有 tag list IPC，而非新增 nh 专用 IPC

**选择**：为 `get_tag_list` 增加可选 `sort` 参数，`TagListDB.get_tags()` 支持排序；`refresh_tag_list` 继续保留现有签名，内部对 nh 走原始标签目录同步。

**理由**：
- 前端已有 `useTagPanel` 和 `TagDialog`，扩展现有契约可复用 UI 和行为。
- `refresh_tag_list` 对其他来源仍维持现有搜索结果采集逻辑。
- sort 只影响读取顺序，不影响刷新语义。

**替代方案**：新增 `get_nh_tags` / `refresh_nh_tags` IPC。该方案会形成平行管线，增加前端条件分支和测试面。

### 4. nh 热门排行使用 ranking 模式表达

**选择**：前端点击「热门排行」时设置 `mode='ranking'`、`query='popular'`，后端 `SearchMixin` 将 nh + ranking 转换为 `effective_query=''`、`effective_tag='popular'`。

**理由**：
- 缓存 key 已包含 mode/query，可避免最近更新和热门排行都为空查询导致缓存冲突。
- 语义清晰，后续如果 SearchBar 支持 nh ranking 下拉也能复用。

**替代方案**：前端直接调用 `search('', 'keyword', 1, 'nh', 'popular')`。该方案改动少，但缓存上下文无法区分最近更新和 popular。

### 5. nh 标签搜索使用精确 tag 查询

**选择**：当 `source='nh'` 且 mode 为 tag 时，后端将单个或多个标签转换为 `tag:"name"` 形式拼接后传给 `NhParser.search()`。

**理由**：
- nhentai 搜索语法支持标签限定，能避免普通关键词搜索误命中标题或其他字段。
- 前端点击标签与手动输入关键词的语义分离。
- 多标签可以从 `searchTags` 逗号列表转换为多个 tag 条件。

**替代方案**：保持普通关键词搜索。该方案简单，但不符合用户点击标签的预期。

### 6. 入口页热门标签复用本地 tag list

**选择**：新增 `NhEntryGrid` 组件，通过 `getTagList('nh', '', 1, 24, 'popular')` 获取热门标签；如果本地没有标签，显示同步提示和刷新按钮。

**理由**：
- 入口页和搜索栏标签面板使用同一数据源，避免静态列表与弹窗不一致。
- 没有标签数据时用户有明确动作同步原始目录。
- 不阻塞最近更新和热门排行入口。

**替代方案**：入口页写死热门标签。该方案离线可用但不满足“直接用原始数据”。

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| nhentai 标签页 HTML 结构变化导致解析失败 | 解析逻辑集中在 `NhParser` 并增加单元测试覆盖 `tagchip`、`name`、`count[title]` 等结构 |
| 全量同步标签页耗时或失败 | 沿用 `refresh_tag_list` 长超时和刷新按钮；同步前不清空旧数据，成功后再替换 |
| 标签页分页数量变化 | 从页面分页解析总页数，无法解析时回退只同步当前页 |
| count 显示有 `224.6k` 简写导致精度丢失 | 优先解析 `title="224,619 galleries"` 的精确数字，简写仅作兜底 |
| A-Z 本地排序与远端分组锚点略有差异 | 用户需要的是标签排序和筛选能力，本地 `tag ASC` 满足功能需求，不复刻远端字母分组 |
| 新增 sort 参数影响现有 IPC 调用 | 参数可选，默认 `popular`，现有调用保持兼容 |
| nh 标签精确查询中的引号或特殊字符 | 构造查询前转义双引号并过滤空标签 |
