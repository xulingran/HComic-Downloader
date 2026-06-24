## 1. 模型与常量基础

- [x] 1.1 在 `models.py` 的 `ComicInfo` dataclass 新增 `language: str | None = None` 字段（位于 `source_site` 与 `scramble_id` 之间，与现有元数据字段风格一致），并更新 docstring Attributes 说明
- [x] 1.2 在 `constants.py` 新增 `LANGUAGE_TO_ISO_639_1: dict[str, str]` 映射表（见 design.md 决策 2 的完整条目，含 chinese→zh、japanese→ja、english→en 及 moeimg 占位值→und，附 croation/croatian 拼写容错）

## 2. moeimg 解析器采集元数据

- [x] 2.1 在 `sources/moeimg/parser.py:get_comic_detail` 的 SPA 路径，从 `detail.get("language")` 提取 language，填入返回的 `ComicInfo(... language=...)`
- [x] 2.2 在 `_get_comic_detail_from_html` 的 `.manga-detail li` 遍历循环中新增 `elif md_title == "Language":` 分支，提取 `<a>` 文本填入 `language`，并在返回的 `ComicInfo(...)` 传入 `language=language`
- [x] 2.3 更新 `tests/test_parser_moeimg.py:test_get_comic_detail_excludes_language_from_tags` 断言 `comic.language == "chinese"`（除原有 `"chinese" not in comic.tags`）
- [x] 2.4 更新 `tests/test_parser_moeimg.py:test_get_comic_detail_falls_back_to_html_on_spa_failure` 断言 `comic.language == "chinese"`，并补 category/publish_date 已有断言确认无回归

## 3. IPC 序列化补全

- [x] 3.1 在 `python/ipc/search_mixin.py:_comic_to_dict` 返回字典新增 `"category"`、`"publishDate"`、`"language"` 三个键（用 `getattr(comic, "category", None)` 等形式，与现有 hasattr 风格一致）
- [x] 3.2 新增/更新测试覆盖 `_comic_to_dict` 输出三键（在 `tests/` 下定位或新建 test_search_mixin 风格测试）

## 4. ComicInfo.xml 写入 LanguageISO

- [x] 4.1 在 `cbz_builder.py` 导入 `LANGUAGE_TO_ISO_639_1`，新增私有方法 `_resolve_language_iso(language)`：归一化小写后查表，未命中返回 None
- [x] 4.2 在 `generate_comic_info_xml` 中，当 `_resolve_language_iso(comic.language)` 非空时调用 `_add_element(root, "LanguageISO", iso_code)`
- [x] 4.3 在 `build_album_cbz` 构造 `album_comic` 时传入 `language=comic.language`
- [x] 4.4 新增测试覆盖：chinese→zh、japanese→ja、english→en、indefinable→und、未知语言不写、None 不写、大小写不敏感（在 `tests/test_cbz_builder.py` 或等价文件）

## 5. 前端类型与抽屉渲染

- [x] 5.1 在 `shared/types.ts` 的 `ComicInfo` 接口新增可选字段 `category?: string`、`publishDate?: string`、`language?: string`
- [x] 5.2 在 `src/components/ComicInfoDrawer.tsx` 的"信息"区块（`displayComic?.sourceSite` 所在 `<p>`），追加 Category（点击触发 `handleSearch(category, 'category')`）、更新时间（只读 `· {publishDate}`）、Language（只读 `· {language}`）的渲染，全部用可选链 + 条件渲染避免空标签
- [x] 5.3 新增前端测试覆盖抽屉对三字段的渲染与缺失时不渲染空标签（定位 ComicInfoDrawer 相关 vitest 测试或新增）

## 6. 验证

- [x] 6.1 运行 `pytest`（聚焦 test_parser_moeimg、test_cbz_builder、test_models、序列化测试）全部通过
- [x] 6.2 运行 `npx tsc --noEmit`、`npm test`、`npm run lint` 通过
- [x] 6.3 运行 `npm run lint:py` 与 `black --check .` 通过
- [x] 6.4 手动验证：启动 `npm run dev`，打开一个 moeimg 漫画抽屉，确认 Category/Language/更新时间显示；下载一个 CBZ，解压确认 `ComicInfo.xml` 含 `<LanguageISO>zh</LanguageISO>`
