## 为什么

Bika（哔咔/Picacomic）是一个流行的中文漫画平台，拥有大量独家内容。用户希望在 hcomic_downloader 中添加 Bika 作为新的漫画来源，以便在一个应用中管理多个平台的漫画下载需求。

## 变更内容

- **新增** `sources/bika/` 模块，实现 Bika API 解析器
- **新增** Bika 认证支持（username/password 登录获取 JWT token）
- **新增** 章节数量显示（适用于所有有多章节的来源）
- **修改** `MultiSourceParser` 以支持 Bika 来源
- **修改** 配置系统以存储 Bika 认证信息

## 功能 (Capabilities)

### 新增功能
- `bika-source`: Bika 漫画来源集成，包括搜索、详情、收藏、下载功能
- `bika-auth`: Bika 认证系统（HMAC-SHA256 签名 + JWT token）

### 修改功能
<!-- 无修改的现有规范 -->

## 影响

- **Python 后端**: 新增 `sources/bika/` 模块，修改 `sources/__init__.py`、`config.py`
- **TypeScript 前端**: 修改 `shared/types.ts` 添加 Bika 来源，修改 `ComicInfoDrawer.tsx` 显示章节数
- **配置**: `source_auth` 字典新增 `bika` 键，支持 `username`、`password`、`bearer_token`
- **依赖**: 需要 `hmac`、`hashlib`（Python 标准库，无需额外安装）
