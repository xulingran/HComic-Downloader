## 上下文

当前项目的 `sources/jmcomic/parser.py` 中，`JmParser.search()` 只处理两类输入：

1. 排行榜关键词（如 `周更新`）→ 请求 `/albums?t=&o=`。
2. 普通关键词 → 请求 `/search/photos?search_query=`，并用 `_parse_search_results()` 解析 `thumb-overlay` 卡片列表。

参考项目 ComicGUISpider 的 jmcomic 实现没有显式的“ID 模式”。它在 `build_preview_search_url()` 中将任意 keyword 拼接到搜索 URL，然后在 `parse_preview_search_response()` 中检测响应是否实际上是专辑详情页（HTML 含 `album_photo_cover` 与 `var aid = \d+;`）。如果是，则调用 `parse_book()` 返回单条结果。这说明 jmcomic 服务端对纯数字搜索词通常会直接返回详情页。

当前项目缺少这种详情页响应识别，因此用户在 keyword 模式下输入纯数字 ID 时会得到空结果。

## 目标 / 非目标

**目标：**
- 在 keyword 模式下，用户输入纯数字 jmcomic 专辑 ID 时，直接返回单条漫画结果。
- 若详情页获取失败，静默 fallback 到普通关键词搜索，避免阻断用户。
- 对服务端返回详情页的搜索响应做兜底识别，提高解析鲁棒性。
- 保持现有搜索、排行榜、随机漫画逻辑不变。

**非目标：**
- 不新增前端搜索模式（如 `id` 模式），用户仍在 keyword 模式下输入。
- 不修改 IPC 契约、`SEARCH_MODES`、主进程校验或前端搜索组件。
- 不调整其他来源的搜索行为。

## 决策

1. **主动识别纯数字 ID 并直接请求详情页**
   - 在 `JmParser.search()` 中增加 `_is_comic_id(keyword)` 判断：`^\d+$`。
   - 命中时直接调用 `get_comic_detail(comic_id)`，成功后返回 `[comic]` 与 `total_pages=1` 的分页信息。
   - 这样比依赖服务端重定向更稳定，且与 ComicGUISpider 的“输 ID 即可命中”体验一致。

2. **保留详情页兜底识别**
   - 在 `_parse_search_results()` 中检测详情页特征：`album_photo_cover` 与 `var aid = (\d+);`。
   - 如果命中，提取 `aid` 作为 `comic_id` 调用 `_parse_detail()`，返回单条结果。
   - 覆盖服务端对任意 keyword 返回详情页的场景。

3. **失败时 fallback 到普通搜索**
   - `get_comic_detail()` 本身已捕获所有异常并返回 `None`。
   - `search()` 在 ID 路径返回 `None` 后继续走原有搜索 URL，避免用户看到空结果。

4. **不新增常量或配置**
   - ID 判断使用简单正则 `^\d+$`，不需要新增配置项；jmcomic 的 album ID 在现有代码中始终为纯数字。

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| 未来 jmcomic 使用非数字 ID | 将 `_is_comic_id` 实现为正则常量，便于后续调整。 |
| 服务端对不存在 ID 返回非 404 的奇怪页面 | `get_comic_detail` 已做异常捕获；`_parse_detail` 解析失败也会返回不完整对象，fallback 逻辑兜底。 |
| 普通关键词恰好是纯数字（极小概率） | 先尝试 ID 路径，失败后再搜索，语义上无害；若确实需要搜索纯数字，仍可命中。 |
| 详情页检测误识别 | 同时要求 `album_photo_cover` 与 `var aid = \d+;` 两个特征，误报概率低。 |

## 迁移计划

无需迁移。本次变更为解析层新增行为，不影响持久化数据、配置或用户习惯。部署后用户直接在 keyword 模式下输入数字 ID 即可使用。

## 待解决问题

无。
