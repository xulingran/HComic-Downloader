# 来源模块目录结构统一重构

## 背景

当前项目中三个漫画来源的组织方式不一致：
- `parser.py`（49KB，约1307行）一个大文件包含 `HComicParser`、`MoeImgParser`、`MultiSourceParser` 三个类
- `jmcomic/` 文件夹是独立的模块化结构

目标：将三个来源统一为相同的目录组织方式，各自拥有独立文件夹，放在 `sources/` 父目录下。

## 目标目录结构

```
sources/
  __init__.py              # MultiSourceParser + ParserResponseError
  hcomic/
    __init__.py            # re-export HComicParser
    parser.py              # HComicParser 类（从 parser.py 搬入）
  moeimg/
    __init__.py            # re-export MoeImgParser
    parser.py              # MoeImgParser 类（从 parser.py 搬入）
  jmcomic/
    __init__.py            # 保持现有内容
    parser.py              # 保持现有内容
    constants.py           # 保持现有内容
    domain.py              # 保持现有内容
    session.py             # 保持现有内容
    descrambler.py         # 保持现有内容
```

## 文件职责

- `sources/__init__.py`：包含 `MultiSourceParser` 类和 `ParserResponseError` 异常类，作为整个来源子系统的入口
- `sources/hcomic/__init__.py`：单行 re-export `from .parser import HComicParser`
- `sources/moeimg/__init__.py`：单行 re-export `from .parser import MoeImgParser`
- 各来源的 `parser.py`：代码内容基本原样搬运，只调整内部 import 路径
- `sources/jmcomic/` 目录整体从根目录移入，内部文件不做修改

## Import 路径变更

### 外部文件的 import 映射

| 原 import | 新 import |
|-----------|-----------|
| `from parser import HComicParser` | `from sources.hcomic import HComicParser` |
| `from parser import MoeImgParser` | `from sources.moeimg import MoeImgParser` |
| `from parser import MultiSourceParser` | `from sources import MultiSourceParser` |
| `from parser import ParserResponseError` | `from sources import ParserResponseError` |
| `from jmcomic.parser import JmParser` | `from sources.jmcomic.parser import JmParser` |
| `from jmcomic.descrambler import descramble_image` | `from sources.jmcomic.descrambler import descramble_image` |
| `from jmcomic.constants import ...` | `from sources.jmcomic.constants import ...` |
| `from jmcomic.domain import ...` | `from sources.jmcomic.domain import ...` |

### jmcomic 内部互相引用

jmcomic 目录移入 `sources/` 后，内部统一改为**相对引用**：
- `from jmcomic.constants import ...` → `from .constants import ...`
- `from jmcomic.domain import ...` → `from .domain import ...`
- `from jmcomic.session import ...` → `from .session import ...`

这样做的好处是 sources 目录整体改名或移动时，内部引用不会断。

### 引用根目录共享模块的路径（不变）

各来源 parser.py 中引用 `constants`、`utils`、`models` 等根目录模块的路径不变，因为项目根目录在 Python 模块搜索路径中。

### 受影响的外部文件

- `python/ipc_server.py`
- `python/ipc/cover_mixin.py`
- `python/ipc/preview_mixin.py`
- `python/ipc/search_mixin.py`
- `python/ipc/auth_mixin.py`
- `python/ipc/config_mixin.py`
- `downloader.py`
- `tests/conftest.py`
- `tests/test_parser.py`
- `tests/test_parser_moeimg.py`
- `tests/test_parser_fallback.py`
- `tests/test_parser_favourites.py`
- `tests/test_parser_pagination.py`
- `tests/test_multi_source_parser.py`
- `tests/test_auth_application.py`
- `tests/test_jmcomic_parser.py`
- `tests/test_jmcomic_descrambler.py`
- `tests/test_jmcomic_domain.py`

## 迁移执行顺序

每步完成后项目保持可运行状态：

1. 创建 `sources/` 目录，写入 `sources/__init__.py`（包含 MultiSourceParser 和 ParserResponseError）
2. 创建 `sources/hcomic/`，将 HComicParser 写入 `parser.py`，创建 `__init__.py`
3. 创建 `sources/moeimg/`，将 MoeImgParser 写入 `parser.py`，创建 `__init__.py`
4. 将 `jmcomic/` 整体移入 `sources/jmcomic/`，内部引用改为相对引用
5. 更新 `sources/__init__.py` 中 MultiSourceParser 的 import，从三个子模块引入
6. 批量更新所有外部文件的 import 路径
7. 删除根目录 `parser.py`
8. 运行测试验证

## 约束

- 纯结构搬迁，不做任何功能变更
- 不修改 `models.py`、`utils.py`、`constants.py` 等根目录共享模块
- 旧 `jmcomic/__pycache__/` 在迁移后需要清理
- 消除了 `parser.py` 与 Python 标准库 `parser` 模块的命名冲突风险
