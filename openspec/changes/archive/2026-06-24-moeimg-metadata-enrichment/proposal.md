## 为什么

moeimg 来源的漫画详情页实际提供 Category、Language、Author、Tags 四类信息外加更新时间，但当前漫画详情抽屉与 CBZ 元数据只落地了其中一部分：

- **后端解析已拿到** category、author、tags、publish_date（`sources/moeimg/parser.py` 的 `get_comic_detail`），却因 `python/ipc/search_mixin.py:_comic_to_dict` 未序列化 category/publishDate（且模型根本没有 language 字段），导致这些字段到不了前端。
- **Language 整条链路缺失**：`ComicInfo` 模型无 `language` 字段，moeimg 解析器主动丢弃 language（测试 `test_get_comic_detail_excludes_language_from_tags` 明确断言其不在 tags 中），IPC 不传，前端 TS 类型无定义，ComicInfo.xml 也不写 `<LanguageISO>`。
- **前端抽屉**（`ComicInfoDrawer.tsx`）"信息"区块只渲染 sourceSite/pages/albumTotalChapters，category、更新时间无任何展示入口。

结果是用户在抽屉里看不到 Category/Language/更新时间，CBZ 里的语言信息也无法被 Komga/Kavita 等阅读器按语言过滤。本次变更把这条贯穿模型→解析→IPC→前端→落盘的数据流补全。

## 变更内容

- **`ComicInfo` 模型新增 `language` 字段**（`models.py`）：`language: str | None = None`，承载来源返回的原始语言文本（如 "chinese"/"japanese"/"english"）。
- **moeimg 解析器采集并保留 language**（`sources/moeimg/parser.py`）：
  - SPA 路径从 `detail.get("language")` 提取；
  - HTML 兜底路径从 `.manga-detail li` 的 `Language:` 区块提取；
  - 不再把 language 混入 tags（维持现有排除行为），改为独立字段填充。
- **IPC 序列化补全字段**（`python/ipc/search_mixin.py:_comic_to_dict`）：新增序列化 `category`、`publishDate`、`language` 三个键。
- **前端 ComicInfo 类型与抽屉**（`shared/types.ts` + `src/components/ComicInfoDrawer.tsx`）：
  - `ComicInfo` 接口新增可选 `category`、`publishDate`、`language` 字段；
  - "信息"区块渲染 Category（可点击触发 category 搜索）、更新时间；Language 以可读标签形式展示。
- **ComicInfo.xml 落盘补 `<LanguageISO>`**（`cbz_builder.py:generate_comic_info_xml`）：将 language 原文经 ISO 639-1 映射（chinese→zh、japanese→ja、english→en 等）写入标准 `<LanguageISO>` 元素；未知语言不写该元素（避免写入非法 ISO 码）。
- **Language→ISO 映射**集中在 `cbz_builder.py` 或 `constants.py` 的单一来源映射表。

## 功能 (Capabilities)

### 新增功能
- `moeimg-metadata-fields`: moeimg 来源漫画元数据（category、language、author、tags、更新时间）从解析到前端展示再到 ComicInfo.xml 落盘的完整数据流，覆盖字段定义、IPC 序列化契约、前端抽屉渲染、CBZ `<LanguageISO>` 写入。

### 修改功能
- 无现有规范级行为变更（moeimg-login / moeimg-bookmarks 聚焦登录与收藏，与元数据采集正交）。

## 影响

- 受影响文件：
  - 后端：`models.py`（新增字段）、`sources/moeimg/parser.py`（采集 language + HTML 兜底）、`python/ipc/search_mixin.py`（序列化补字段）、`cbz_builder.py`（写 LanguageISO + 映射表，专辑打包路径同步透传 language）、`constants.py`（可选：存放 ISO 映射）。
  - 共享/前端：`shared/types.ts`（ComicInfo 接口）、`src/components/ComicInfoDrawer.tsx`（信息区块渲染）。
  - 测试：`tests/test_parser_moeimg.py`（language 字段断言）、`tests/test_cbz_builder.py` 或等价（LanguageISO 写入）、`tests/test_models.py`（默认值）。
- IPC 契约：`get_comic_detail` / `search` / `get_favourites` 返回的 ComicInfo 对象**新增**三个可选键，向后兼容（旧前端忽略未知键）。
- 向后兼容：已下载的 CBZ 文件不受影响；旧 ComicInfo.xml 无 `<LanguageISO>` 属合法缺省。重新下载的 moeimg 漫画会补全 Category/更新时间显示与 LanguageISO。
