## 为什么

nhentai 是全球最大的同人漫画托管平台之一，拥有海量内容和完善的 API。当前项目支持 5 个来源（hcomic、moeimg、jm、bika、copymanga），但缺少 nhentai 这一重要来源。添加 nhentai 支持可以显著扩展内容覆盖范围，且其 JSON API 结构清晰、无需登录，集成难度较低。

## 变更内容

- **新增** nhentai 来源解析器（`sources/nh/`），支持：
  - 搜索（通过 `/api/v2/search` API）
  - 漫画详情获取（通过 `/api/v2/galleries/{id}` API）
  - 图片 URL 构建（`i.nhentai.net/galleries/{media_id}/{page}.{ext}`）
  - 缩略图获取
  - 标签/语言元数据提取
- **修改** `sources/__init__.py` 注册新来源到 `MultiSourceParser` 分发层
- **修改** 前端来源列表，添加 nhentai 选项
- **新增** nhentai ComicSource 常量（`NH`）

## 功能 (Capabilities)

### 新增功能

- `nh-search`: nhentai 搜索功能，支持关键词搜索、分页、排序
- `nh-detail`: nhentai 漫画详情解析，提取标题、标签、语言、页数、图片列表
- `nh-download`: nhentai 图片下载，构建正确的图片 URL 并下载

### 修改功能

<!-- 无现有功能需要修改 -->

## 影响

- **代码**：新增 `sources/nh/` 目录（parser.py, constants.py），修改 `sources/__init__.py`、`models.py`（添加 NH ComicSource）、前端来源配置
- **API**：新增 nhentai API 集成（`nhentai.net/api/v2`）
- **依赖**：无新依赖，使用现有 `requests` 库
- **系统**：nhentai 需要代理访问（被墙），复用现有系统代理机制
