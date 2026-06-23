## 1. 核心解析逻辑

- [x] 1.1 在 `sources/jmcomic/parser.py` 的 `JmParser` 中新增静态方法 `_is_comic_id(keyword: str) -> bool`，使用正则 `^\d+$` 判断 keyword 是否为纯数字专辑 ID。
- [x] 1.2 修改 `JmParser.search()`：在排行榜判断之后、普通搜索之前，插入 ID 优先路径。若 `_is_comic_id(keyword)` 为真，调用 `self.get_comic_detail(keyword)`；成功返回 `[comic]` 与 `current_page=1, total_pages=1, total_items=1` 的分页信息；失败或返回 None 时继续走原有搜索逻辑。
- [x] 1.3 修改 `JmParser._parse_search_results()`：在解析列表之前检测详情页特征（HTML 同时含 `album_photo_cover` 与 `var aid = (\d+);`）。若命中，提取 `aid` 作为 comic_id 调用 `_parse_detail()` 返回单条结果；否则保持原有列表解析。

## 2. 单元测试

- [x] 2.1 在 `tests/test_jmcomic_parser.py` 新增 `test_search_by_id_returns_single_comic`：keyword 为纯数字时，验证请求的是 `/album/{id}`，且返回单条结果与正确分页。
- [x] 2.2 新增 `test_search_by_id_fallback_to_keyword_on_failure`：当 `get_comic_detail` 返回 None 时，验证 fallback 到 `/search/photos?search_query={id}` 并按列表解析。
- [x] 2.3 新增 `test_search_results_parses_detail_page`：向 `_parse_search_results` 传入详情页 HTML，验证返回单条结果而非空列表。

## 3. 验证与提交前检查

- [x] 3.1 运行 `pytest tests/test_jmcomic_parser.py` 确认所有新增与既有测试通过。
- [x] 3.2 运行 `npm run lint:py` 与 `black --check .` 确认 Python 代码风格合规。
