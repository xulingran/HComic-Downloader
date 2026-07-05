## 为什么

moeimg 详情页的原始数据包含 Parody（原著）与 Characters（角色）两类独立实体，但 `MoeImgParser._extract_manga_tags` 将它们与普通 tags 一起扁平化合并进单一 `ComicInfo.tags` 列表。结果是：`ComicInfo.parodies` 与 `ComicInfo.characters` 永远为空，前端 `ComicInfoDrawer` 中已就位的紫色"原著"chip 区、青色"角色"chip 区永远不显示，用户在详情抽屉里看到的是一锅大杂烩"标签"，无法区分原著/角色/普通标签。

抽屉已具备渲染 parody/character chip 的全部代码与 IPC 序列化通路（`_comic_to_dict` 已转发这两个字段），缺的只是 parser 把数据填进结构化字段，并把它们从 `tags` 中剔除以避免重复显示。

## 变更内容

- `MoeImgParser` 新增 parody / characters 的独立抽取逻辑，分别填充 `ComicInfo.parodies`、`ComicInfo.characters`。
- `_extract_manga_tags` 不再合并 parody / characters，只保留纯 tags（含 `chapter_detail.tags`），保证"标签"区不再重复显示原著与角色。
- `get_comic_detail`（SPA 主路径）与 `_get_comic_detail_from_html`（HTML 兜底路径）均采集 Parody / Characters 节点，分别填入 `parodies` / `characters`。
- 不改动：前端组件、IPC 序列化、其他来源（hcomic / jm / bika / copymanga）parser、搜索屏蔽/推荐匹配逻辑。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `moeimg-metadata-fields`: 扩展 moeimg 详情元数据的结构化采集范围 —— 在已有的 category/language/author/tags/publish_date 五项基础上，新增 Parody 与 Characters 两类实体独立采集到 `ComicInfo.parodies` / `ComicInfo.characters`，并从 `tags` 中剔除这两类以消除重复显示。

## 影响

- **代码**：`python/sources/moeimg/parser.py`（`_extract_manga_tags` 拆分 + 新增 parody/characters 抽取辅助方法 + `get_comic_detail` / `_get_comic_detail_from_html` 两条路径填充新字段）。
- **数据契约**：`ComicInfo.parodies` / `characters` 对 moeimg 来源由"恒为空"变为"按详情页实际内容填充"；`ComicInfo.tags` 对 moeimg 详情由"含 parody+characters"变为"仅纯 tags"。前端 `ComicInfoDrawer` 既有"原著"/"角色"chip 分区将自动显示。
- **不受影响**：前端代码、`_comic_to_dict` 序列化（已转发两字段）、其他来源 parser、搜索屏蔽/推荐匹配（moeimg 搜索结果 `tags=[]` 为既有现状，屏蔽匹配本就不依赖详情页 tags；抽屉 enrich 数据为 local state，不回流搜索列表）。
- **测试**：moeimg parser 相关单元测试需新增/调整 parody、characters、tags 三者的断言。
