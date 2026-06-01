# AGENTS.md

此文件为代码智能体（如 CodeArts）在本仓库中工作提供指导。

## 项目概述

HComic Downloader 是一个基于 Electron + React + TypeScript 的前端应用，搭配 Python 后端，用于从 h-comic.com 搜索、下载和打包漫画。漫画以 CBZ 格式（带 ComicInfo.xml 元数据）保存。

## 开发命令

### 环境设置

```bash
# 创建虚拟环境（首次）
python3 -m venv venv

# 激活并安装依赖
source venv/bin/activate        # Linux/macOS
venv\Scripts\activate          # Windows
pip install -r requirements.txt
pip install -r requirements-dev.txt  # 开发依赖
```

### 运行应用

```bash
# 一键启动（推荐）
./run.sh            # Linux/macOS
run.bat             # Windows

# 或手动启动
source venv/bin/activate && python -m hcomic_downloader.main
```

### 构建/格式化和测试命令

```bash
# 运行所有 Python 测试
pytest

# 运行特定 Python 测试文件
pytest tests/test_models.py

# 运行特定 Python 测试类
pytest tests/test_models.py::TestComicInfo

# 运行单个 Python 测试方法
pytest tests/test_models.py::TestComicInfo::test_default_values

# 运行 Python 测试并生成覆盖率报告
pytest --cov=. --cov-report=html

# 运行所有 TypeScript/React 测试
npm test

# 运行 TypeScript 测试（监视模式）
npm run test:watch

# 运行 TypeScript 测试并生成覆盖率报告
npm run test:coverage

# TypeScript 类型检查
npx tsc --noEmit

# ESLint（src/electron/shared/tests）
npm run lint
# 自动修复可修问题
npm run lint:fix
# Python lint（封装 ruff，跨平台路径兼容）
npm run lint:py

# Python 代码格式化与质量检查（venv 中已安装 ruff + black）
# ruff 跨平台调用：
#   - macOS/Linux:  venv/bin/ruff
#   - Windows:      venv\Scripts\ruff.exe
# 建议使用 npm run lint:py 包装脚本，跨平台路径自动适配
ruff check .           # 检查
ruff check . --fix     # 自动修复
black .                # 格式化
black --check .        # 仅检查不修改
```

### 项目打包

```bash
# 使用 pyinstaller 打包为可执行文件
pyinstaller --onefile --name "HComicDownloader" main.py
```

## 代码风格指南

### Python 版本
- Python 3.8+

### 导入顺序
1. 标准库导入
2. 第三方库导入  
3. 本地应用导入
4. 使用绝对导入而非相对导入

示例：
```python
import os
import re
from typing import List, Optional

import requests
from PIL import Image

from models import ComicInfo
from utils import sanitize_filename
```

### 命名约定
- **类名**: 使用 PascalCase，如 `ComicInfo`, `HComicParser`
- **函数/方法名**: 使用 snake_case，如 `sanitize_filename`, `get_image_url`
- **变量名**: 使用 snake_case，如 `search_results`, `current_page`
- **常量**: 使用 UPPER_SNAKE_CASE，如 `DEFAULT_USER_AGENT`, `IMAGE_API_BASE`
- **私有方法**: 使用前导下划线，如 `_get_response_text`, `_extract_payload_data`

### 类型注解
- 所有函数和方法必须包含完整的类型注解
- 使用 `Optional[T]` 表示可为 None 的值
- 使用 `List[T]`, `Dict[K, V]`, `Set[T]` 等泛型类型

示例：
```python
def sanitize_filename(name: str) -> str:
    """清理文件名中的非法字符"""
    
@dataclass
class ComicInfo:
    id: str = ""
    title: str = ""
    author: Optional[str] = None
    tags: List[str] = field(default_factory=list)
```

### 文档字符串
- 所有公共函数、类和方法必须有文档字符串
- 使用 Google 风格文档字符串格式
- 包含 Args、Returns、Raises 等部分

示例：
```python
def get_image_url(self, page: int) -> str:
    """根据媒体 ID 和页数生成图片 URL
    
    Args:
        page: 页数（从 1 开始）
        
    Returns:
        完整的图片 URL
    """
```

### 错误处理
- 使用明确的异常类型（ValueError, TypeError, RuntimeError）
- 异常消息应清晰描述问题
- 网络请求使用 try/except 包装，并记录详细错误信息

### 测试约定
- 测试文件以 `test_` 开头，如 `test_models.py`
- 测试类以 `Test` 开头，如 `TestComicInfo`
- 测试方法以 `test_` 开头，如 `test_default_values`
- 使用 pytest fixtures 共享测试数据
- 每个测试都应包含适当的断言

### 代码组织
- 保持文件职责单一，每个文件专注于一个功能模块
- 使用 dataclass 定义数据模型
- 业务逻辑与 GUI 代码分离
- 网络请求、文件操作等耗时操作应异步执行

### 配置文件
- 配置文件位置：`~/.hcomic_downloader/config.json`
- 敏感信息（如 Cookie）不应硬编码在代码中
- 支持环境变量和配置文件两种配置方式

## 架构概览

### 核心模块

| 模块 | 职责 |
|------|------|
| `main.py` | 应用入口，初始化日志和 GUI |
| `search_controller.py` | 搜索/翻页/收藏夹逻辑控制器 |
| `download_controller.py` | 下载/批量下载逻辑控制器 |
| `parser.py` | h-comic.com / moeimg.fan 页面解析，搜索/收藏/详情 |
| `downloader.py` | 多线程图片下载，支持断点续传和重试 |
| `download_manager.py` | 下载队列管理、任务状态机、自动重试 |
| `cbz_builder.py` | CBZ 打包和 ComicInfo.xml 生成 |
| `models.py` | 数据模型（ComicInfo, PaginationInfo, DownloadTask） |
| `config.py` | 配置管理（JSON 持久化） |
| `auth_parser.py` | 从 curl 命令提取 Cookie/User-Agent |
| `auth_manager.py` | 登录状态管理和认证同步 |
| `utils.py` | 工具函数（代理、文件名清理等） |
| `font_config.py` | 跨平台字体检测 |
| `electron/main.ts` | Electron 主进程入口 |
| `electron/preload.ts` | 预加载脚本，暴露 IPC API |
| `electron/python-bridge.ts` | Python 后端桥接 |
| `src/` | React 前端组件和页面 |
| `src/stores/` | Zustand 状态管理 |
| `src/hooks/` | 自定义 React Hooks |

### 数据流

```
用户搜索 → parser.search() → ComicInfo 列表
    ↓
用户选择下载 → downloader.download_comic_resume() → 临时图片目录
    ↓
cbz_builder.build_cbz() → CBZ 文件（含 ComicInfo.xml）
```

### 关键模式

1. **会话复用**: `parser.session` 和 `downloader.session` 共享认证和代理配置
2. **编码处理**: 服务器可能返回错误的 Content-Type，`parser._get_response_text()` 强制 UTF-8
3. **JS 对象解析**: `parser._extract_payload_data()` 用正则提取内嵌 JS 对象，然后转换为 JSON
4. **跨平台滚动**: GUI 同时处理 MouseWheel、TouchpadScroll、Button-4/5 事件
5. **异步图片加载**: 封面使用线程池加载，滚动期间缓存更新避免回调风暴

### 重要实现细节

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

### GUI 状态管理

重要状态变量（定义在 `HComicDownloaderGUI.__init__`）：

| 变量 | 用途 |
|------|------|
| `search_results` | 当前搜索结果列表 |
| `selected_comics` | 批量选择中的漫画集合 |
| `current_page / total_pages` | 分页状态 |
| `current_view_mode` | "search" 或 "favourites" |
| `is_batch_downloading` | 批量下载进行标志 |
| `batch_select_mode_var` | 批量选择模式开关 |

### 完整测试与检查流程

代码变更后，运行以下全部检查确认无回归：

```bash
# 1. Python 单元测试（371 个）
pytest

# 2. TypeScript 类型检查
npx tsc --noEmit

# 3. 前端测试（531 个）
npm test

# 4. Python lint（ruff）
npm run lint:py

# 5. Python 格式检查（black，需从 venv 调用）
#    macOS/Linux: venv/bin/black --check .
#    Windows:     venv\Scripts\black.exe --check .
black --check .

# 6. JS/TS lint（ESLint）
npm run lint
```

6 项全部通过后才可提交。

### 手动测试关键流程

1. 搜索/翻页
2. 单个下载
3. 批量下载
4. 收藏夹（需要登录）
5. 预览图开关
6. 字体切换
7. 代理切换

### 代码质量工具

项目使用以下工具确保代码质量：
- **pytest**: Python 单元测试框架（pytest-mock、pytest-cov、pytest-timeout）
- **vitest**: TypeScript/React 测试框架
- **TypeScript**: 类型检查（`strict: true`, `noUnusedLocals`, `noUnusedParameters`）
- **ESLint**: `src/electron/shared/tests` 目录，封装为 `npm run lint`（`src/` 默认开启 `react-hooks` 规则）
- **ruff**: Python lint（封装为 `npm run lint:py`）
- **black**: Python 格式化（venv 中；修改文件后需 `black --check .` 验证）
- **pyinstaller**: 应用打包

### 开发工作流

1. **环境设置**: 创建虚拟环境并安装依赖
2. **编写代码**: 遵循上述代码风格指南
3. **添加测试**: 为新功能编写测试
4. **运行完整检查**: 执行上述 6 项测试与检查
5. **代码审查**: 检查代码质量和风格
6. **提交代码**: 使用有意义的提交信息
