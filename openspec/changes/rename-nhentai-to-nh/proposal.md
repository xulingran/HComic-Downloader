## 为什么

项目中代码注释、docstring 和前端 UI 文案仍使用 "nhentai" 全称，但项目约定中该来源简称 "NH"（类似 "jm" 而非 "jmcomic"）。需要统一命名，使 UI 显示和代码注释一致使用 "NH"。实际网络域名（`nhentai.net` 等）不改动。

## 变更内容

- **修改** 前端 UI 文案：`shared/types.ts` 中 label、`NhEntryGrid.tsx`、`SearchPage.tsx` 中的 "nhentai" 改为 "NH"
- **修改** Python 源代码 docstring 和注释：`sources/nh/` 下所有模块、`python/ipc/tag_list_mixin.py` 中的 "nhentai" 改为 "NH"
- **修改** 测试文件描述和断言：`tests/` 下涉及 "nhentai" 的测试描述和断言值改为 "NH"
- **不改动** 实际域名字符串（`nhentai.net`、`i.nhentai.net`、`t.nhentai.net`）和域名白名单
- **不改动** openspec 文档、`docs/`、`.superpowers/` 中的历史记录

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `nh-entry-page`: 入口页 UI 文案从 "nhentai" 改为 "NH"
- `nh-tag-list`: 标签面板相关 UI 文案从 "nhentai" 改为 "NH"

## 影响

- **前端**：`shared/types.ts`、`src/components/NhEntryGrid.tsx`、`src/pages/SearchPage.tsx`、`src/hooks/useSourceOptions.ts`
- **后端**：`sources/nh/__init__.py`、`sources/nh/constants.py`、`sources/nh/parser.py`、`python/ipc/tag_list_mixin.py`
- **测试**：`tests/test_nh_parser.py`、`tests/test_nh_search_mixin.py`、`tests/unit/hooks/useSourceOptions.test.ts`、`tests/unit/pages/SearchPage.test.tsx`
- **无破坏性变更**：仅文本替换，不涉及逻辑或 API 变更
