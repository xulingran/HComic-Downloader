---
name: copymanga-source
date: 2026-06-06
status: approved
---

# 拷贝漫画 (CopyManga) 来源设计

## 概述

为 hcomic_downloader 添加拷贝漫画（copymanga）来源，支持搜索、漫画详情（章节列表）、图片 URL 解密（供下载/预览使用）。不包含登录和收藏夹功能。

## 方案选择

**方案 A：最小依赖移植**（已选定）

- 将参考项目 `ComicGUISpider/utils/website/providers/kaobei.py` 的 AES 解密逻辑移植到本项目现有的 `requests.Session` + `ParserContextMixin` 模式中
- AES 解密使用 `cryptography` 库
- 搜索走 API，章节数据走 API 解密，图片 URL 从章节 HTML 页提取并解密
- 新增依赖：仅 `cryptography`

## 域名

- PC 站：`www.2026copy.com`
- API：`api.2026copy.com`

## 文件结构

```
sources/copymanga/
├── __init__.py          # 空文件
├── constants.py         # 域名、Headers、API路径等常量
├── parser.py            # CopyMangaParser 主类
└── crypto.py            # AES-CBC 解密 + 密钥提取逻辑
```

### 各模块职责

| 文件 | 职责 |
|------|------|
| `constants.py` | `PC_DOMAIN`, `API_DOMAIN`, 各场景的 `HEADERS`, `UA_MAPI` 等常量 |
| `crypto.py` | `decrypt_aes_cbc()` 解密函数 + `extract_aes_key()` 从页面 JS 提取密钥 + `AesKeyCache` 内存缓存类 |
| `parser.py` | `CopyMangaParser(ParserContextMixin)` 主类，实现搜索、详情、章节、图片等接口 |

## AES 解密与密钥管理

### 加密方案

AES-128-CBC，PKCS7 padding。

### 密钥获取流程

1. 访问 PC 站任意漫画页（如 `/comic/yiquanchaoren`）
2. 从 HTML 中 `<script>` 标签提取 JS 变量值作为 AES key
   - 遍历 `<script>` 标签文本，找到以 `var` 开头的文本
   - 正则匹配 `=['"]...['"]` 提取值
3. key 缓存在内存中（Parser 实例生命周期内有效）

### 解密流程

1. API 返回的加密字符串：前 16 字符是 IV，剩余是 cipher hex
2. AES-128-CBC 解密（key=提取的密钥, iv=前16字符）
3. PKCS7 unpadding
4. JSON parse 得到明文数据

### crypto.py 接口

```python
class AesKeyCache:
    """内存缓存 AES 密钥，首次使用时懒加载。"""
    def get(self) -> str | None: ...
    def set(self, key: str) -> None: ...
    def clear(self) -> None: ...

def extract_aes_key(html_text: str) -> str:
    """从 PC 站页面 HTML 提取 AES 密钥。"""

def decrypt_aes_cbc(encrypted: str, aes_key: str) -> dict:
    """解密拷贝漫画的加密数据。
    encrypted 格式: iv(16字符) + cipher_hex
    """
```

### 错误处理

- 解密失败时自动 `clear()` 缓存密钥，下次请求重新获取
- 密钥提取失败抛出 `ParserResponseError`（与项目现有异常体系一致）

## Parser 核心接口

### 搜索

```
GET https://api.2026copy.com/api/v3/search/comic?platform=1&limit=30&offset={offset}&q={keyword}
Headers: UA_MAPI（移动端 UA + platform/version 等自定义头）
```

- 返回 JSON，路径 `results.list` 是漫画数组
- 每条包含 `path_word`, `name`, `author[*].name`, `popular`, `cover`, `datetime_updated` 等
- `offset = (page - 1) * 30` 实现分页
- 解析为 `ComicInfo`（`source_site="copymanga"`, `id=path_word`）

### 漫画详情

```
GET https://www.2026copy.com/comicdetail/{path_word}/chapters
Headers: UA_MAPI + Referer
```

- 返回加密 JSON，`results` 字段是加密字符串
- 解密后得到 `build`（含 `path_word`）和 `groups.default.chapters` 章节数组
- 填充 `ComicInfo` + `ChapterInfo` 列表
- 顺带填充 author、tags 等元数据

### 章节图片 URL

1. `GET https://www.2026copy.com/comic/{path_word}/chapter/{chapter_id}` → 返回 HTML
2. 从 HTML 提取 `var contentKey = "..."` 的值（加密字符串）
3. 解密 contentKey → 得到图片 URL 数组，每项格式 `{"url": "https://..."}`

### 接口签名

```python
class CopyMangaParser(ParserContextMixin):
    def search(self, keyword, page=1, *, tag="") -> tuple[list[ComicInfo], PaginationInfo | None]
    def get_comic_detail(self, comic_id, slug="") -> ComicInfo | None
    def get_chapters(self, path_word: str) -> list[ChapterInfo]
    def get_chapter_images(self, path_word: str, chapter_id: str) -> list[str]
    def configure_auth(self, cookie="", user_agent="", bearer_token="")  # 无操作，保留接口兼容
```

### prepare_for_download 集成

在 `MultiSourceParser.prepare_for_download` 中增加 `copymanga` 分支：

- 单章节：直接 `get_chapter_images` 填充 `image_urls`
- 多章节：保留章节列表，前端选章后通过 `handle_get_chapter_preview_urls` 按章加载（与 jmcomic/bika 模式一致）

## 系统集成点

### sources/__init__.py（MultiSourceParser）

| 改动 | 说明 |
|------|------|
| `import CopyMangaParser` | 新增导入 |
| `_VALID_SOURCES` | 添加 `"copymanga"` |
| `SOURCE_OPTIONS` | 添加 `("copymanga", "拷贝漫画")` |
| `__init__` 中 `self.parsers` | 注册 `"copymanga": CopyMangaParser(...)` |
| `get_sessions()` | 添加 copymanga 的 session |
| `prepare_for_download()` | 添加 copymanga 分支 |

### python/ipc/search_mixin.py

| 改动 | 说明 |
|------|------|
| `_VALID_SOURCES` | 添加 `"copymanga"` |
| `handle_get_chapter_preview_urls()` | 添加 copymanga 分支 |

### python/ipc_server.py

无需改动。

### 前端

前端来源选择器从 `IPC.getSourceOptions()` 自动获取新来源，无需后端额外适配。章节选择 UI 复用 jmcomic/bika 已有的多章节弹窗。

### 依赖

`requirements.txt` 或 `pyproject.toml` 添加 `cryptography`。

## 修改文件总览

| 文件 | 类型 |
|------|------|
| `sources/copymanga/__init__.py` | **新增** |
| `sources/copymanga/constants.py` | **新增** |
| `sources/copymanga/crypto.py` | **新增** |
| `sources/copymanga/parser.py` | **新增** |
| `sources/__init__.py` | 修改 |
| `python/ipc/search_mixin.py` | 修改 |
| `requirements.txt` | 修改 |
