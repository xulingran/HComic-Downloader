## 1. Python 后端 — 目录重命名与模块导入

- [x] 1.1 将 `sources/jmcomic/` 目录 `git mv` 为 `sources/jm/`
- [x] 1.2 更新 `sources/jm/__init__.py` 中的导出符号（如需要调整）
- [x] 1.3 更新 `sources/jm/` 内部模块相互引用的导入路径（从 `sources.jmcomic.xxx` 改为 `sources.jm.xxx`）
- [x] 1.4 更新 `sources/__init__.py`：修改 `_VALID_SOURCES`、`_SOURCES_WITH_FAVOURITES`、`_PARSER_MODULES` 等字典中的 `"jmcomic"` 为 `"jm"`
- [x] 1.5 更新 `sources/__init__.py` 中的 `from sources.jmcomic.parser import JmParser` 导入路径
- [x] 1.6 更新 `sources/__init__.py` 中的 `get_jmcomic_cdn_domain()` → `get_jm_cdn_domain()`（方法名 + 内部引用）
- [x] 1.7 更新 `sources/__init__.py` 中的 `set_jmcomic_domain()` → `set_jm_domain()`
- [x] 1.8 更新 `sources/__init__.py` 中 random() 方法的来源过滤条件 `"jmcomic"` → `"jm"`

## 2. Python 后端 — 配置与数据模型

- [x] 2.1 更新 `config.py`：`jmcomic_domain` 字段名 → `jm_domain`；`tag_blacklist`/`duplicate_blacklist`/`missing_blacklist` 默认值键 `"jmcomic"` → `"jm"`
- [x] 2.2 更新 `config.py`：`default_source` 校验值 `"jmcomic"` → `"jm"`
- [x] 2.3 在 `config.py` 的 `__post_init__` 中添加旧键 `jmcomic_domain` → 新键 `jm_domain` 的向后兼容 fallback
- [x] 2.4 更新 `utils.py` 中 `_normalize_source_auth()` 内的 `"jmcomic"` → `"jm"`
- [x] 2.5 更新 `downloader.py` 中 `if site == "jmcomic"` → `"jm"` 以及反混淆导入路径
- [x] 2.6 更新 `url_validator.py` 中 `_TRUSTED_CDN_DOMAINS` 相关的注释（域名本身不变）
- [x] 2.7 更新 `models.py` 中 `ChapterInfo` 文档注释中的 jmcomic 引用

## 3. Python 后端 — IPC Mixin 层

- [x] 3.1 更新 `python/ipc_server.py`：`"get_jmcomic_domains"` → `"get_jm_domains"`
- [x] 3.2 更新 `python/ipc/config_mixin.py`：`_apply_jmcomic_domain()` → `_apply_jm_domain()`；`"jmcomicDomain"` → `"jmDomain"`；`hasJmcomicAuth` → `hasJmAuth`；`handle_get_jmcomic_domains()` → `handle_get_jm_domains()`
- [x] 3.3 更新 `python/ipc/config_mixin.py` 中 blacklist 默认值的 `"jmcomic"` → `"jm"`
- [x] 3.4 更新 `python/ipc/auth_mixin.py`：参数名 `jmcomic_username` → `jm_username`；登录成功后设置域名的逻辑
- [x] 3.5 更新 `python/ipc/download_mixin.py` 中获取 jmcomic parser 的引用
- [x] 3.6 更新 `python/ipc/preview_mixin.py`：导入路径 `sources.jmcomic.descrambler` → `sources.jm.descrambler`；相关变量名
- [x] 3.7 更新 `python/ipc/search_mixin.py` 中所有 `"jmcomic"` 字面量 → `"jm"`；`handle_get_chapter_images()` 中的引用
- [x] 3.8 更新 `python/ipc/favourite_tags_mixin.py` 中 `_TAG_RECOMMENDATION_SOURCES` 的 `"jmcomic"` → `"jm"`
- [x] 3.9 更新 `python/ipc/types.py` 中 `"jmcomicDomain"` → `"jmDomain"` 的键映射
- [x] 3.10 更新 `python/ipc/cover_mixin.py` 中的注释

## 4. 共享类型层 (shared/types.ts)

- [x] 4.1 更新 `Config` 接口字段 `hasJmcomicAuth` → `hasJmAuth`、`jmcomicDomain` → `jmDomain`
- [x] 4.2 更新 `ConfigKey` 联合类型中的 `'jmcomicDomain'` → `'jmDomain'`
- [x] 4.3 更新 `ConfigValueMap` 中的 `jmcomicDomain: string` → `jmDomain: string`
- [x] 4.4 更新 `get_jmcomic_domains` → `get_jm_domains`（IPC 方法声明）
- [x] 4.5 更新 IPC 通道映射：`'python:get-jmcomic-domains': 'get_jmcomic_domains'` → `'python:get-jm-domains': 'get_jm_domains'`
- [x] 4.6 更新 `COMIC_SOURCES` 数组中的 `'jmcomic'` → `'jm'`
- [x] 4.7 更新 `SOURCE_META` 中的键 `jmcomic` → `jm`
- [x] 4.8 更新 `GET_JMCOMIC_DOMAINS` 常量 → `GET_JM_DOMAINS`，对应通道名更新
- [x] 4.9 更新 `CONFIG_KEYS` 数组中的 `'jmcomicDomain'` → `'jmDomain'`

## 5. Electron 主进程

- [x] 5.1 更新 `electron/main.ts`：全局变量 `jmcomicCdnDomain` → `jmCdnDomain`、`jmcomicMainDomain` → `jmMainDomain`
- [x] 5.2 更新 `electron/main.ts`：域名白名单中与 jmcomic 相关的变量名和注释
- [x] 5.3 更新 `electron/main.ts`：IPC 处理中 `'jmcomicDomain'` → `'jmDomain'`、`bridge.call('get_jmcomic_domains')` → `'get_jm_domains'`
- [x] 5.4 更新 `electron/login-window.ts`：常量 `JMCOMIC_MIRROR_DOMAINS` → `JM_MIRROR_DOMAINS`；所有 `source === 'jmcomic'` → `'jm'`
- [x] 5.5 更新 `electron/login-window.ts`：`jmcomicUsername` → `jmUsername` 等变量名
- [x] 5.6 更新 `electron/login-preload.ts` 中的 jmcomic 相关引用
- [x] 5.7 更新 `electron/validators.ts` 中 `tagBlacklist()` 校验器的 `jmcomic` 键

## 6. React 前端

- [x] 6.1 更新 `src/hooks/useIpc.ts`：`useJmcomicDomains()` → `useJmDomains()` 及其内部调用
- [x] 6.2 更新 `src/pages/SettingsPage.tsx`：所有 `jmcomicDomain` → `jmDomain`、`jmcomicDomains` → `jmDomains`、`jmcomicAuth` → `jmAuth` 等变量
- [x] 6.3 更新 `src/pages/SettingsPage.tsx`：JMComic 域名选择 UI 组件中的 `jmcomic` 标识符
- [x] 6.4 更新 `src/components/settings/AuthSettings.tsx`：props `jmcomicLoginStatus` → `jmLoginStatus`、`jmcomicLoginMessage` → `jmLoginMessage` 等
- [x] 6.5 更新 `src/pages/HistoryPage.tsx`：`jmcomic: 'JMComic'` → `jm: 'JM'`
- [x] 6.6 更新 `src/pages/HistoryPage.tsx` 中 `getSourceSiteLabel` 映射（如果独立于上方映射则单独更新）
- [x] 6.7 更新 `shared/types.ts` 中 `SOURCE_META` 的 `jm` 条目的 `label` 字段从 `'JMComic'` → `'JM'`
- [x] 6.8 全局搜索前端代码中所有硬编码的 `"JMComic"` 字符串，替换为用户标签来源 `label` 引用或直接改为 `"JM"`
- [x] 6.9 更新 `src/components/ComicInfoDrawer.tsx` 中的注释引用

## 7. 测试文件 — Python

- [x] 7.1 更新 `tests/test_jmcomic_parser.py` → `test_jm_parser.py`（文件名 + 内容引用）
- [x] 7.2 更新 `tests/test_jmcomic_descrambler.py` → `test_jm_descrambler.py`（文件名 + 内容引用）
- [x] 7.3 更新 `tests/test_jmcomic_favourites.py` → `test_jm_favourites.py`（文件名 + 内容引用）
- [x] 7.4 更新 `tests/test_multi_source_parser.py` 中所有 `"jmcomic"` → `"jm"` 和导入路径
- [x] 7.5 更新 `tests/test_sources_lazy_import.py` 中的导入路径
- [x] 7.6 更新 `tests/test_ipc_download_chapters.py` 中的 `"jmcomic"` → `"jm"`
- [x] 7.7 更新 `tests/test_ipc_preview.py` 中的导入路径和引用
- [x] 7.8 更新 `tests/test_config.py` 中的配置键 `jmcomic_domain` → `jm_domain`
- [x] 7.9 更新 `tests/test_download_manager.py`、`test_cbz_builder.py`、`test_download_history.py` 等测试中的 `"jmcomic"` → `"jm"`
- [x] 7.10 更新 `tests/test_favourite_tags.py` 中的来源引用
- [x] 7.11 更新 `tests/test_models.py`、`test_url_validator.py`、`test_maintenance_*.py`、`test_album_*.py`、`test_reading_history.py`、`test_tag_list.py` 中的引用
- [x] 7.12 运行 `pytest` 确认全部 Python 测试通过

## 8. 测试文件 — 前端

- [x] 8.1 更新 `tests/unit/hooks/useAuth.test.ts` 中的 jmcomic 引用
- [x] 8.2 更新 `tests/unit/hooks/useComicReader.test.tsx` 中的引用
- [x] 8.3 更新 `tests/unit/hooks/useDownloadHelper.test.ts` 中的引用
- [x] 8.4 更新 `tests/unit/pages/SettingsPage.test.tsx` 中的引用
- [x] 8.5 更新 `tests/unit/pages/SearchPage.test.tsx` 中的 jmcomic 引用
- [x] 8.6 更新 `tests/unit/pages/HistoryPage.test.tsx`、`FavouritesPage.test.tsx` 中的引用
- [x] 8.7 更新 `tests/unit/stores/*.test.ts` 和 `tests/unit/preload/preload.test.ts` 中的引用
- [x] 8.8 运行 `npm test` 确认前端测试通过

## 9. 文档

- [x] 9.1 更新 `README.md` 中所有 `jmcomic` 相关描述
- [x] 9.2 更新 `AGENTS.md` 中架构描述和路径引用
- [x] 9.3 更新 `docs/superpowers/specs/2026-05-27-jmcomic-source-design.md` → `jm-source-design.md`（文件名 + 内容）
- [x] 9.4 更新 `docs/superpowers/specs/2026-05-30-jmcomic-chapters-design.md` → `jm-chapters-design.md`（文件名 + 内容）
- [x] 9.5 更新 `docs/superpowers/specs/2026-05-29-source-module-restructure-design.md` 中的引用

## 10. 集成验证

- [x] 10.1 运行 `npx tsc --noEmit` 确认 TypeScript 类型检查通过
- [x] 10.2 运行 `npm run lint:py` 确认 Python lint 通过
- [x] 10.3 运行 `black --check .` 确认 Python 格式化通过
- [x] 10.4 运行 `npm run lint` 确认 ESLint 通过
- [x] 10.5 运行 `npm run dev` 确认应用能正常启动
