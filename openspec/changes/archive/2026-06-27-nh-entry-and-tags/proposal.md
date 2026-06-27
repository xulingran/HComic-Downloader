## 为什么

nhentai 来源已经支持关键词搜索、最近更新和 popular 排序，但搜索页缺少面向该来源的入口页，用户需要手动理解空关键词、排序参数和标签查询方式。nhentai 同时提供官方标签目录页面，可用于补齐搜索栏旁的标签面板和入口页热门标签快捷入口。

## 变更内容

- 为 nhentai 搜索页增加类似哔咔分类页的来源入口页，提供「最近更新」「热门排行」两个主入口。
- 为入口页增加热门标签快捷入口，数据来自 nhentai 原始标签目录，而不是前端静态列表。
- 将 nhentai 接入现有搜索栏旁的标签面板，并支持「热门」与「A-Z」两种排序。
- 扩展后端标签目录同步：nhentai 使用 `https://nhentai.net/tags?sort=popular` 的原始页面数据同步标签名和数量，并在本地按 count 或 tag 名排序展示。
- 优化 nhentai 标签搜索语义：点击标签时构造精确标签查询，而不是普通关键词搜索。
- 支持 nhentai 热门排行语义：前端使用 ranking 模式表示 popular 排序，后端转换为已有 nhentai popular 请求。

## 功能 (Capabilities)

### 新增功能
- `nh-entry-page`: nhentai 搜索来源首页入口，覆盖最近更新、热门排行和热门标签快捷浏览。
- `nh-tag-list`: nhentai 原始标签目录同步、排序和搜索栏标签面板接入。

### 修改功能
- `electron-ipc-contract`: 扩展 `get_tag_list` IPC 契约，使标签列表可指定排序方式。

## 影响

- 后端：`sources/nh/`、`python/ipc/tag_list_mixin.py`、`python/ipc/search_mixin.py`。
- 前端：`src/pages/SearchPage.tsx`、`src/components/SearchBar.tsx`、`src/components/TagDialog.tsx`、`src/hooks/useTagPanel.ts`，并新增 nhentai 入口页组件。
- 共享类型与 IPC：`shared/types.ts`、`electron/main.ts`、`electron/preload.ts`。
- 测试：新增或更新 nh parser、tag list IPC、SearchPage/TagDialog 相关测试。
- 网络约束：新增 nhentai 标签目录请求必须复用 `NhParser` 的 `requests.Session`，继续通过 `apply_system_proxy_to_session()` 注入的系统代理。
