# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HComic Downloader 是一个基于 tkinter 的 GUI 应用程序，用于从 h-comic.com 搜索、下载和打包漫画。漫画以 CBZ 格式（带 ComicInfo.xml 元数据）保存。

## Development Commands

### Running the Application

```bash
# 一键启动（推荐）
./run.sh

# 或手动启动
source venv/bin/activate
python main.py
```

### Environment Setup

```bash
# 创建虚拟环境（首次）
python3 -m venv venv

# 激活并安装依赖
source venv/bin/activate
pip install -r requirements.txt
```

### Configuration Location

配置文件保存在 `~/.hcomic_downloader/config.json`。应用首次运行时会自动创建。

## Architecture

### Core Modules

| Module | Responsibility |
|--------|---------------|
| `main.py` | 应用入口，初始化日志和 GUI |
| `gui.py` | tkinter GUI 主界面（约 1800 行） |
| `parser.py` | h-comic.com 页面解析，搜索/收藏/详情 |
| `downloader.py` | 多线程图片下载，支持重试 |
| `cbz_builder.py` | CBZ 打包和 ComicInfo.xml 生成 |
| `models.py` | 数据模型（ComicInfo, PaginationInfo） |
| `config.py` | 配置管理（JSON 持久化） |
| `auth_parser.py` | 从 curl 命令提取 Cookie/User-Agent |
| `utils.py` | 工具函数（代理、文件名清理等） |
| `font_config.py` | 跨平台字体检测 |

### Data Flow

```
用户搜索 → parser.search() → ComicInfo 列表
    ↓
用户选择下载 → downloader.download_comic() → 临时图片目录
    ↓
cbz_builder.build_cbz() → CBZ 文件（含 ComicInfo.xml）
```

### Key Patterns

1. **会话复用**: `parser.session` 和 `downloader.session` 共享认证和代理配置
2. **编码处理**: 服务器可能返回错误的 Content-Type，`parser._get_response_text()` 强制 UTF-8
3. **JS 对象解析**: `parser._extract_payload_data()` 用正则提取内嵌 JS 对象，然后转换为 JSON
4. **跨平台滚动**: GUI 同时处理 MouseWheel、TouchpadScroll、Button-4/5 事件
5. **异步图片加载**: 封面使用线程池加载，滚动期间缓存更新避免回调风暴

### Important Implementation Details

#### ComicInfo 哈希支持
`ComicInfo` 实现了 `__hash__` 和 `__eq__`，可存储在 `set` 中用于批量选择：

```python
selected_comics: set[ComicInfo] = set()
```

#### 图片 URL 构造
图片 URL 由 `ComicInfo.get_image_url(page)` 动态生成，格式：
```
https://h-comic.link/api/{suffix}/{media_id}/pages/{page}
```
其中 `suffix` 由 `comic_source` 决定：`mms`(MMCG_SHORT) / `mml`(MMCG_LONG) / `nh`(默认)

#### 登录状态管理
- Cookie 和 User-Agent 从 curl 命令提取（`auth_parser.py`）
- 配置保存在 `~/.hcomic_downloader/config.json`
- 应用启动时自动静默校验登录状态（`parser.verify_login_status()`）

#### 系统代理
代理从系统设置自动检测，通过 `utils.get_system_proxies()` 获取并注入所有 requests 会话。

### GUI State Management

重要的状态变量（定义在 `HComicDownloaderGUI.__init__`）：

| 变量 | 用途 |
|------|------|
| `search_results` | 当前搜索结果列表 |
| `selected_comics` | 批量选择中的漫画集合 |
| `current_page / total_pages` | 分页状态 |
| `current_view_mode` | "search" 或 "favourites" |
| `is_batch_downloading` | 批量下载进行标志 |
| `batch_select_mode_var` | 批量选择模式开关 |

### Testing Notes

项目目前没有自动化测试。手动测试关键流程：
1. 搜索/翻页
2. 单个下载
3. 批量下载
4. 收藏夹（需要登录）
5. 预览图开关
6. 字体切换
7. 代理切换
