## 1. 前端 UI 文案

- [x] 1.1 `shared/types.ts:978` — 将 `label: 'nhentai'` 改为 `label: 'NH'`
- [x] 1.2 `src/components/NhEntryGrid.tsx:54,74` — 将 UI 文案中的 "nhentai" 改为 "NH"
- [x] 1.3 `src/pages/SearchPage.tsx:744` — 将 "返回 nhentai 入口" 改为 "返回 NH 入口"
- [x] 1.4 `src/hooks/useSourceOptions.ts:72` — docstring 中 "nhentai" 改为 "NH"

## 2. Python 后端 docstring 和注释

- [x] 2.1 `sources/nh/__init__.py:1` — 模块 docstring "nhentai" 改为 "NH"
- [x] 2.2 `sources/nh/constants.py:1` — 模块 docstring "nhentai" 改为 "NH"
- [x] 2.3 `sources/nh/parser.py` — 所有 docstring 和注释中的 "nhentai" 改为 "NH"（约 13 处，排除 URL 中的域名）
- [x] 2.4 `python/ipc/tag_list_mixin.py:17,339` — 注释中的 "nhentai" 改为 "NH"

## 3. 测试文件

- [x] 3.1 `tests/test_nh_parser.py:1,25` — docstring 中 "nhentai" 改为 "NH"
- [x] 3.2 `tests/test_nh_search_mixin.py:1` — docstring 中 "nhentai" 改为 "NH"
- [x] 3.3 `tests/unit/hooks/useSourceOptions.test.ts:13` — 断言 `'nhentai'` 改为 `'NH'`
- [x] 3.4 `tests/unit/pages/SearchPage.test.tsx:295,315,337` — 测试描述中 "nhentai" 改为 "NH"

## 4. 验证

- [x] 4.1 `grep -ri "nhentai" --include="*.py" --include="*.ts" --include="*.tsx"` 确认源代码中仅剩域名字符串
- [x] 4.2 运行 `pytest` 确认 Python 测试通过
- [x] 4.3 运行 `npm test` 确认前端测试通过
