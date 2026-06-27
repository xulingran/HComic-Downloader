## 1. 基础结构

- [x] 1.1 创建 `sources/nh/` 目录结构（`__init__.py`, `constants.py`, `parser.py`）
- [x] 1.2 在 `models.py` 的 ComicSource 中添加 `NH = "NH"` 常量（Python 端使用字符串字面量，无需额外定义）
- [x] 1.3 在 `sources/__init__.py` 中注册 nh 来源（`_VALID_SOURCES`, `_PARSER_MODULES`, `_SOURCES_WITH_FAVOURITES`）

## 2. 常量定义

- [x] 2.1 在 `sources/nh/constants.py` 中定义 API URL（search、gallery detail）
- [x] 2.2 定义图片和缩略图 host（`i.nhentai.net`、`t.nhentai.net`）
- [x] 2.3 定义请求 headers（User-Agent、Referer、Accept）

## 3. 解析器核心实现

- [x] 3.1 实现 `NhParser.__init__`，创建 requests.Session 并应用系统代理
- [x] 3.2 实现 `search(keyword, page)` 方法，调用 `/api/v2/search` API
- [x] 3.3 实现 `get_comic_detail(comic_id)` 方法，调用 `/api/v2/galleries/{id}` API
- [x] 3.4 实现 `prepare_for_download(comic)` 方法，构建图片 URL 列表
- [x] 3.5 实现辅助方法：`_build_image_url`、`_build_thumbnail_url`

## 4. 元数据解析

- [x] 4.1 解析搜索结果条目，提取 id、title、pages、thumbnail
- [x] 4.2 解析详情响应，提取完整元数据（author、tags、language）
- [x] 4.3 实现标题优先级逻辑（japanese > pretty > english > "未知标题"）

## 5. 接口适配

- [x] 5.1 实现 `configure_auth` 方法（空实现，nhentai 无需登录）
- [x] 5.2 实现 `verify_login_status` 方法（返回成功状态）
- [x] 5.3 实现 `favourites` 方法（返回空结果，nhentai 无收藏功能）

## 6. 前端集成

- [x] 6.1 在前端来源配置中添加 nhentai 选项
- [x] 6.2 更新类型定义，添加 nh 来源支持

## 7. 测试

- [x] 7.1 编写搜索功能单元测试
- [x] 7.2 编写详情解析单元测试
- [x] 7.3 编写图片 URL 构建单元测试
