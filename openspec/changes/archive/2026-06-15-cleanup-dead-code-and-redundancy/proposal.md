## 为什么

项目代码库经过多轮迭代积累了三类冗余：(1) 仓库根目录散落的一次性工件（旧虚拟环境、过期评审报告）；(2) 零引用或仅被测试引用的死代码（Python 方法/函数/属性、前端类型/常量）；(3) 重复实现（同一常量两处定义、sqlite 连接样板六处复制）。这些噪声增加阅读负担、误导维护者，且使静态分析工具产生干扰性输出。现在做是因为测试覆盖已较完善（666 个 pytest 用例 + 57 个 vitest 文件），可以在不破坏功能的前提下安全清理。

## 变更内容

### A. 散落工件清理（极低风险）

- **删除** `venv/` 旧虚拟环境目录（2026-02-03 创建，已被 `.venv/`（2026-02-16）取代，两者均被 `.gitignore` 排除，未进 git）
- **删除** `code review.txt`（2026-05-13 的一次性 CodeArts 评审报告，未进 git，且引用了已删除的旧 tkinter 文件 `gui_app.py`/`gui_logic.py`/`search_controller.py`，纯属历史快照）
- **保留** `npm run dev.bat`（用户明确要求保留）
- **更新** `AGENTS.md` 中关于 `run.bat` / `run.sh` 的过时描述（实际文件已不存在）

### B. Python 绝对死代码删除

**类 A — 零引用（连测试都没有）：**
- `album_coordinator.py:80` `AlbumCoordinator.set_album_comic`
- `url_validator.py:93` `URLValidator._is_trusted_cdn`
- `python/ipc_server.py:205` `IPCServer._referer_for_image_url`

**类 B — "测试驱动保留"（生产无引用，仅测试在用）—— 连同测试一并删除：**
- `cbz_builder.py:655` `build_cbz_simple()` + `tests/test_cbz_builder.py` 中 `test_build_cbz_simple` / `test_build_cbz_simple_with_comic_info`
- `cbz_builder.py:347` `CBZBuilder.get_output_path` —— **特殊处理**：`tests/test_download_history.py:138,176` 和 `tests/test_download_manager.py:262` 将其作为构造期望路径的工具，需迁移到 `get_output_path_for_format(comic, "cbz", download_dir)`（已验证两者路径等价，见 design.md）；`tests/test_cbz_builder.py` 中直接测试该方法的用例删除
- `models.py:83` `ComicInfo.safe_author` + `tests/test_models.py::test_safe_author_property`
- `models.py:180` `Pagination.has_previous` + `tests/test_models.py::test_has_previous`
- `sources/__init__.py:138` `MultiSourceParser.get_source_options` + `tests/test_copymanga_source_registration.py:11` 的相关断言
- `sources/jmcomic/domain.py:37` `JmDomainResolver.resolve` + `tests/test_jmcomic_domain.py` 相关用例
- `sources/hcomic/parser.py:351` `HComicParser._extract_hidden_form_fields`（零引用，无测试）
- `sources/bika/constants.py:34-35` `DELETE` / `PUT` HTTP 方法常量（零引用，无测试）
- `python/ipc_server.py:200` `IPCServer._detect_image_type` + `python/ipc_server.py:45` 指引注释 + `tests/test_ipc_preview.py:159` `test_detect_image_type_supports_avif`

> **决策依据**：本项目为内部应用而非发布库，这些"仅测试在用"的符号不构成对外 API 契约。保留它们只是让测试覆盖死代码本身，无实际价值。

### C. 前端死代码删除

- `shared/types.ts:780` `AUTH_REQUIRED_SOURCES` 常量（设计文档明确记载已被 `src/utils/source.ts` 的 `sourceRequiresAuth()` 取代，全项目零引用）
- `shared/types.ts:598` `PythonIPCChannel` 派生类型（零引用，其底层的 `PYTHON_IPC_CHANNEL_MAP` 仍在用）
- `shared/types.ts:260` `SetConfigArgs` 映射类型（零引用，set-config 真实调用走 `ConfigValue`/`ConfigKey`）
- `src/hooks/useTagPanel.ts:10` 移除 `mergeTagSources` 的 `export` 关键字（函数体在文件内部使用，仅 export 多余）

### D. 冗余实现合并

- **`DEFAULT_IMAGE_EXT` 去重**：`downloader.py:31` 本地重定义 `DEFAULT_IMAGE_EXT = ".jpg"`，而 `image_formats.py:3` 已导出同名常量。改为从 `image_formats` import（`downloader.py:18` 已从该模块 import `PAGE_FILENAME_FORMAT`，仅漏了这一项）
- **sqlite 连接样板收敛**：6 个文件各自复制了 `sqlite3.connect(path, check_same_thread=False)` + `PRAGMA journal_mode=WAL`（部分还设置 `row_factory = sqlite3.Row`）。在 `utils.py` 新增 `open_sqlite_db(path, *, row_factory=False) -> sqlite3.Connection` 助手，统一这 6 处的连接初始化。涉及文件：
  - `download_history.py:23-24`
  - `python/ipc/cover_cache.py:40-41`
  - `python/ipc/favourite_tags_mixin.py:26-28`
  - `python/ipc/history_mixin.py:74-76`
  - `python/ipc/preview_cache.py:56-57`
  - `python/ipc/tag_list_mixin.py:27-29`

## 功能 (Capabilities)

### 新增功能
（无）

### 修改功能
（无 —— 本次为纯代码卫生清理，不引入新功能，不改变任何对外规范级行为。所有删除项均经验证为零引用或被取代的死代码，所有合并均保持行为等价。）

## 影响

**受影响代码：**
- Python：`album_coordinator.py`、`cbz_builder.py`、`downloader.py`、`image_formats.py`、`models.py`、`python/ipc_server.py`、`python/ipc/{cover_cache,favourite_tags_mixin,history_mixin,preview_cache,tag_list_mixin}.py`、`sources/{__init__,bika/constants,hcomic/parser,jmcomic/domain}.py`、`url_validator.py`、`utils.py`
- Python 测试：`tests/{test_cbz_builder,test_copymanga_source_registration,test_download_history,test_download_manager,test_ipc_preview,test_models,test_jmcomic_domain}.py`
- 前端：`shared/types.ts`、`src/hooks/useTagPanel.ts`
- 文档：`AGENTS.md`
- 仓库根目录：删除 `venv/`、`code review.txt`

**不受影响：**
- IPC 通道契约（`PYTHON_IPC_CHANNEL_MAP` 等保留）
- 任何运行时行为（所有变更经测试验证保持等价）
- 对外数据格式（CBZ/ComicInfo.xml/schema 不变）

**验证基线**：`pytest`（666 用例，删除死代码测试后约 -10）、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint`。
