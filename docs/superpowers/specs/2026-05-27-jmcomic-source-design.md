# jmcomic 来源集成设计

## 概述

为 hcomic_downloader 添加禁漫天堂（jmcomic）作为第三个漫画来源，支持登录、搜索、排行、标签搜索、随机浏览和图片反混淆。采用独立模块架构（`jmcomic/`），通过 `MultiSourceParser` 统一调度。

参考实现：`E:\Developing\ComicGUISpider` 中的 `ComicSpider\spiders\jm.py` 和 `utils\website\providers\jm.py`。

## 范围

### 包含

- jmcomic 搜索（关键词、标签、排行）
- jmcomic 随机浏览
- jmcomic 漫画详情获取
- jmcomic 图片反混淆（descramble）
- jmcomic 弹窗登录 + 手动 Cookie 粘贴
- jmcomic 域名动态发现
- 前端来源选择器扩展
- 前端排行模式 UI

### 不包含

- jmcomic 收藏夹（后续实现）
- jmcomic 批量收藏夹导入

## 目录结构

```
jmcomic/
├── __init__.py
├── parser.py          # JmParser — 搜索、详情、排行、标签解析
├── domain.py          # 域名发布页发现 + 本地缓存
├── descrambler.py     # 图片反混淆算法
└── constants.py       # 域名、URL 模板、headers 等常量
```

## 模块设计

### 1. 域名发现 — `jmcomic/domain.py`

**流程：**

1. 启动时读本地缓存 `~/.hcomic_downloader/jm_domain.txt`
2. 缓存存在且未过期（< 24h）→ 直接使用
3. 否则请求发布页 `https://jm365.work/mJ8rWd`，解析 HTML 提取域名列表
4. 逐个测试域名可用性（HEAD 请求，5s 超时）
5. 可用域名写入缓存并返回

**失败降级：** 发布页不可用时，使用硬编码 fallback 域名 `18comic.vip`。

**接口：**

```python
class JmDomainResolver:
    FALLBACK_DOMAIN = "18comic.vip"
    PUBLISH_URL = "https://jm365.work/mJ8rWd"
    CACHE_PATH = "~/.hcomic_downloader/jm_domain.txt"
    CACHE_TTL_SECONDS = 86400  # 24h

    def resolve(self) -> str:
        """返回当前可用域名，如 '18comic.vip'"""
```

### 2. 搜索与内容解析 — `jmcomic/parser.py`

**JmParser 实现与 HComicParser 相同的接口：**

| 方法 | 签名 | 说明 |
|------|------|------|
| `search` | `(keyword, page, mode) -> (list[ComicInfo], PaginationInfo)` | 关键词/标签/排行搜索 |
| `random` | `() -> (list[ComicInfo], PaginationInfo)` | 随机页面 |
| `get_comic_detail` | `(comic_id, slug) -> ComicInfo` | 漫画详情，补齐图片 URL 列表 |
| `configure_auth` | `(cookie, user_agent, bearer_token)` | 设置 Cookie 认证 |
| `verify_login_status` | `() -> (bool, str)` | 验证 Cookie 有效性 |

**搜索 URL 构建：**

- `mode="keyword"` → `https://{domain}/search/photos?main_tag=0&search_query={keyword}`
- `mode="tag"` → `https://{domain}/search/photos?main_tag=0&search_query={keyword}`（禁漫自动匹配标签）
- `mode="ranking"` → 排行榜 URL，通过中文关键词映射：

**排行关键词映射（`constants.py`）：**

```python
RANKING_MAPPINGS = {
    "日更新": {"t": "t", "o": "mr"},
    "周更新": {"t": "w", "o": "mr"},
    "月更新": {"t": "m", "o": "mr"},
    "总更新": {"t": "a", "o": "mr"},
    "日点击": {"t": "t", "o": "mv"},
    "周点击": {"t": "w", "o": "mv"},
    # ... 依此类推，共 16 种组合
}
```

排行 URL 格式：`https://{domain}/albums?t={time}&o={order}`

**排行预处理：** `MultiSourceParser.search()` 中对 `source="jmcomic"` 检查 query 是否匹配排行关键词，匹配则切换 `mode="ranking"` 并清空 query。

**HTML 解析：** 使用 `lxml` + `requests`（与 HComicParser 一致），从搜索结果页面提取：
- 漫画 ID、标题、封面 URL、预览 URL
- 作者、标签、分类
- 分页信息

**ComicInfo 字段映射：**

```python
ComicInfo(
    id=漫画ID,
    title=标题,
    author=作者,
    pages=页数,
    tags=[标签列表],
    cover_url=封面URL,
    preview_url=详情页URL,
    media_id=漫画ID,
    comic_source="JMCOMIC",
    source_site="jmcomic",
)
```

### 3. 图片反混淆 — `jmcomic/descrambler.py`

**算法（来自参考项目）：**

```
输入：原始图片 bytes, epsId (漫画ID), scramble_id
输出：正确排列的图片 bytes

规则：
  epsId < 220980 → 不打乱，直接返回
  epsId < 268850 → num = 10
  epsId > 421926 → num = md5(str(epsId) + scramble_id)[-1] % 8 * 2 + 2
  其他            → num = md5(str(epsId) + scramble_id)[-1] % 10 * 2 + 2

打乱方式：
  将图片纵向等分为 num 块，按逆序重新拼接
```

**接口：**

```python
def descramble_image(image_bytes: bytes, eps_id: int, scramble_id: str) -> bytes:
    """对 jmcomic 图片进行反混淆，返回处理后的图片 bytes。
    如果无需反混淆（num == 0），返回原始 bytes。
    """
```

**依赖：** `Pillow` 库，需在 `requirements.txt` 中新增。

**scramble_id 来源：** 图片 URL 路径中包含 `/{epsId}/{scramble_id}/xxx.jpg`，在 `JmParser.get_comic_detail()` 解析页面时提取。scramble_id 存储在 `ComicInfo` 的扩展字段中（需在 `models.py` 的 `ComicInfo` 中新增可选字段 `scramble_id: str = ""`）。

**集成点：** 在 `downloader.py` 的图片下载完成后：

```python
if comic.source_site == "jmcomic" and comic.scramble_id:
    from jmcomic.descrambler import descramble_image
    image_data = descramble_image(image_data, int(comic.id), comic.scramble_id)
```

### 4. 认证与登录

#### 模式 1 — 弹窗登录（BrowserWindow）

复用 hcomic 的登录弹窗架构：

```
electron/main.ts:
  openLoginWindow(source) 中根据 source 参数决定：
    "hcomic"  → loadURL('https://h-comic.com')，监测 auth0.com 回调
    "jmcomic" → loadURL('https://{domain}')，监测 Cookie 中出现 session 字段
```

**jmcomic 登录成功检测：**
1. 监测 `did-navigate` 事件
2. 从登录页跳转到首页（URL 不再包含 `login`）→ 登录成功
3. 提取 session cookies，通过 `apply_auth` IPC 传给 Python 后端

#### 模式 2 — 手动粘贴 Cookie

设置页面来源配置区域提供文本框，用户粘贴 Cookie 字符串后解析存入 `config.source_auth.jmcomic.cookie`。

#### IPC 层改动

- `handle_apply_auth(curl_text, source="hcomic")` — 支持 source 参数
- `handle_verify_auth(source="hcomic")` — 支持 source 参数
- `electron/main.ts` 中 `openLoginWindow` 增加 source 参数

**登录状态验证：** `JmParser.verify_login_status()` 访问需要登录的页面（如收藏夹或个人中心），根据响应判断 Cookie 是否有效。

### 5. 前端 UI 改动

| 组件 | 改动 |
|------|------|
| `shared/types.ts` | `COMIC_SOURCES` 加入 `'jmcomic'` |
| `shared/types.ts` | `AppConfig.tagBlacklist` 扩展 `jmcomic` 键 |
| 来源选择器 | 显示名"禁漫天堂" |
| 搜索模式选择器 | 切换到 jmcomic 时增加"排行"选项 |
| 排行模式 UI | 选择排行时，搜索框变为下拉选择器（16 种排行组合） |
| 设置页 | 新增 jmcomic 认证区域（Cookie 输入框 + 弹窗登录按钮） |
| 随机按钮 | 切换到 jmcomic 时可用 |

**排行下拉选项：**

```
日更新 / 周更新 / 月更新 / 总更新
日点击 / 周点击 / 月点击 / 总点击
日评分 / 周评分 / 月评分 / 总评分
日收藏 / 周收藏 / 月收藏 / 总收藏
```

### 6. 错误处理

| 场景 | 处理 |
|------|------|
| 域名不可用 | 发布页 + fallback 均失败时返回明确错误提示 |
| 图片反混淆失败 | 降级为直接保存原图，日志记录警告 |
| Cookie 过期 | `verify_login_status()` 返回失败，前端弹出重新登录提示 |
| 5 秒盾 / Cloudflare | User-Agent 伪装 + Referer 头，失败时提示稍后重试 |
| 漫画需登录/JCoins | 检测 URL 跳转到 login 页，提示需要登录或付费 |
| 排行关键词解析失败 | 降级为普通关键词搜索 |

### 7. 依赖变更

**`requirements.txt` 新增：**

```
Pillow>=10.0.0
```

## 改动文件清单

### 新增文件

- `jmcomic/__init__.py`
- `jmcomic/parser.py`
- `jmcomic/domain.py`
- `jmcomic/descrambler.py`
- `jmcomic/constants.py`

### 修改文件

- `parser.py` — MultiSourceParser 注册 jmcomic，排行关键词预处理
- `models.py` — ComicInfo 新增 `scramble_id` 字段
- `downloader.py` — 下载后根据 source_site 调用反混淆
- `shared/types.ts` — COMIC_SOURCES、tagBlacklist、IPC 接口
- `electron/main.ts` — 登录弹窗支持 source 参数、域名白名单
- `electron/preload.ts` — 新增 jmcomic 相关 API
- `src/` — 来源选择器、搜索模式、设置页 UI
- `requirements.txt` — 新增 Pillow
