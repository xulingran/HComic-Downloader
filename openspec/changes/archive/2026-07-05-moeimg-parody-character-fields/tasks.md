## 1. parser 核心改造

- [x] 1.1 在 `sources/moeimg/parser.py` 新增 classmethod `_extract_parodies(cls, detail_data, detail)`：用 `_extract_names` 合并 `detail_data.get("parody")` 与 `detail.get("parody")`（key=`"tag_name"`），经 `_dedupe_keep_order` 去重保序返回 `list[str]`。
- [x] 1.2 新增 classmethod `_extract_characters(cls, detail_data, detail)`：同结构，合并 `detail_data.get("characters")` 与 `detail.get("characters")`。
- [x] 1.3 瘦身 `_extract_manga_tags`：移除对 `detail_data.get("parody")` / `detail.get("parody")` / `detail_data.get("characters")` / `detail.get("characters")` 的合并（删除现有 727-730 行四行），保留 `detail_data.tags` / `detail.tags` / `chapter_detail.tags` 三处纯 tags 合并 + 去重保序。方法签名（含 `chapter_detail` 可选参数）不变。
- [x] 1.4 `get_comic_detail`（SPA 主路径，约 343/369-384 行）：在调用 `_extract_manga_tags` 之外，新增 `parodies = self._extract_parodies(detail_data, detail)` 与 `characters = self._extract_characters(detail_data, detail)`，传入 `ComicInfo(...)` 构造。

## 2. HTML 兜底路径扩展

- [x] 2.1 `_get_comic_detail_from_html`（约 417-476 行）：在 `.manga-detail li` 遍历中新增对 `.md-title` 文案 `Parody` / `Characters` 的识别，收集对应 `.md-content` 下所有 `<a>` 文本到 `parodies` / `characters` 列表（多 `<a>` 全收）。
- [x] 2.2 在该函数返回的 `ComicInfo(...)` 构造中传入 `parodies=parodies, characters=characters`（缺失时为 `[]`）。

## 3. 测试更新与新增

- [x] 3.1 修改 `tests/test_parser_moeimg.py::test_get_comic_detail_builds_download_urls` 第 292 行断言：由 `comic.tags == ["tag1", "tag2", "parody1", "char1", "chapter-tag"]` 改为 `comic.tags == ["tag1", "tag2", "chapter-tag"]`，并新增 `assert comic.parodies == ["parody1"]` 与 `assert comic.characters == ["char1"]`。
- [x] 3.2 新增测试 `test_get_comic_detail_separates_parody_and_characters_from_tags`：构造 `detail.parody` / `detail.characters` / `detail.tags` / `chapter_detail.tags` 均非空的 payload，断言三者各自落到 `parodies` / `characters` / `tags`，互不混入。
- [x] 3.3 新增测试 `test_get_comic_detail_parody_characters_dedup_across_detail_layers`：构造 `detail_data.parody` 与 `detail.parody` 含重复项（如 `["love live", "school"]` 与 `["school", "idol"]`），断言 `ComicInfo.parodies == ["love live", "school", "idol"]`。
- [x] 3.4 新增测试 `test_get_comic_detail_parody_characters_empty_when_missing`：构造 payload 无 parody/characters 键，断言 `parodies == []`、`characters == []` 且不抛异常。
- [x] 3.5 新增测试 `test_get_comic_detail_html_path_extracts_parody_and_characters`：基于现有 HTML 兜底测试模式（参考 `test_get_comic_detail_falls_back_to_html_on_spa_failure`），构造含 `Parody:` / `Characters:` `.md-title` 节点的 HTML，断言 `parodies` / `characters` 正确填充。
- [x] 3.6 检查 `test_get_comic_detail_excludes_language_from_tags`（405 行）等其它既有的 tags 断言，确认未被本次 tags 瘦身破坏；如断言依赖 parody/characters 在 tags 中，则同步修正。

## 4. 验证

- [x] 4.1 运行 `pytest tests/test_parser_moeimg.py` 全绿。
- [x] 4.2 运行 `pytest`（全量）确认无回归。
- [x] 4.3 运行 `npm run lint:py`（ruff）与 `black --check .` 通过。
- [x] 4.4 运行 `openspec-cn validate moeimg-parody-character-fields --strict` 通过。
