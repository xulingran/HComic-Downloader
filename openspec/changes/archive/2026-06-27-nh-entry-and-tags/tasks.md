## 1. 后端 nhentai 标签目录能力

- [x] 1.1 在 `sources/nh/constants.py` 增加 nhentai 标签目录 URL 常量。
- [x] 1.2 在 `NhParser` 中实现标签页请求、分页解析、标签名和 count 解析，所有请求复用已注入系统代理的 Session。
- [x] 1.3 为 nhentai 标签解析添加单元测试，覆盖 `tagchip` 解析、精确 count title 解析、简写 count 兜底和分页解析。
- [x] 1.4 在 `TagListMixin` 中将 `nh` 加入支持来源，并让 `refresh_tag_list('nh')` 使用 nh 原始标签目录同步。
- [x] 1.5 扩展 `TagListDB.get_tags()` 支持 `popular` 与 `name` 排序，并保持关键词过滤兼容。
- [x] 1.6 确保 nh 标签刷新失败时不清空已有缓存，成功后再替换缓存数据。

## 2. 搜索语义和 IPC 契约

- [x] 2.1 在 `SearchMixin.handle_search()` 中支持 nh + ranking + `popular` 转换为 popular 排序请求。
- [x] 2.2 在 `SearchMixin.handle_search()` 中支持 nh 标签搜索转换为 `tag:"..."` 精确查询，并处理多标签与引号转义。
- [x] 2.3 扩展 `shared/types.ts` 的 tag list IPC 类型和 `HcomicAPI.getTagList` 签名，增加可选 `sort` 参数。
- [x] 2.4 在 `electron/main.ts` 为 `GET_TAG_LIST` 增加 sort 参数校验，只允许 `popular` 和 `name`。
- [x] 2.5 在 `electron/preload.ts` 为 `getTagList` 增加 sort 参数校验与透传。
- [x] 2.6 将 `shared/types.ts` 中 nh 来源能力标记更新为支持标签列表，必要时标记支持排行语义。

## 3. 前端标签面板

- [x] 3.1 扩展 `src/hooks/useIpc.ts` 的 `useTagList().getTagList` 参数，支持 sort。
- [x] 3.2 扩展 `useTagPanel`，增加 `sort` / `setSort` 状态，并按当前排序读取标签列表。
- [x] 3.3 更新 `TagDialog`，增加「热门 / A-Z」排序切换 UI，切换时保留已选标签。
- [x] 3.4 确保 nh 来源显示搜索栏旁标签按钮，并能打开、刷新、切换排序和选择标签。

## 4. nhentai 入口页

- [x] 4.1 新增 `NhEntryGrid` 组件，展示最近更新、热门排行和热门标签区域。
- [x] 4.2 `NhEntryGrid` 使用 `getTagList('nh', '', 1, 24, 'popular')` 获取热门标签，空数据时展示同步提示和刷新入口。
- [x] 4.3 在 `SearchPage` 中接入 nh 入口页空状态，切换到 nh 时清空结果并显示入口页。
- [x] 4.4 实现最近更新、热门排行、热门标签点击处理，并维护 query/mode/source/searchTags/ref 与缓存上下文一致。
- [x] 4.5 在查看 nh 入口触发的结果时提供返回入口页操作，返回时清空结果、分页和错误状态。

## 5. 测试和验证

- [x] 5.1 添加或更新 Python 测试，覆盖 nh 标签同步、tag list 排序和 nh 搜索语义转换。
- [x] 5.2 添加或更新前端测试，覆盖 nh 标签按钮显示、TagDialog 排序切换、NhEntryGrid 主入口和热门标签点击。
- [x] 5.3 运行相关 Python 测试（至少 `tests/test_nh_parser.py` 和新增/受影响测试）。
- [x] 5.4 运行相关前端测试（至少 SearchPage/TagDialog 受影响测试）。
- [x] 5.5 运行类型检查或 lint 中与本变更直接相关的验证，记录结果。

## 6. 追加实现与整理

- [x] 6.1 为 nhentai 全量标签同步增加限流间隔，避免 tags API 429。
- [x] 6.2 为 `refresh_tag_list('nh')` 增加 `tag_list_progress` 事件上报。
- [x] 6.3 将前端标签弹窗接入同步进度显示，并区分运行中与错误状态。
- [x] 6.4 将 nhentai 入口页的热门标签刷新逻辑改为仅重新获取第一页热门标签。
- [x] 6.5 将上述增量实现对应的测试与验证同步更新。
