# 来源模块目录结构统一重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三个漫画来源（hcomic、moeimg、jmcomic）统一为 `sources/` 父目录下的独立子模块，消除根目录 `parser.py` 的大文件问题。

**Architecture:** 创建 `sources/` 包，将 HComicParser 和 MoeImgParser 分别拆入 `sources/hcomic/` 和 `sources/moeimg/`，将 `jmcomic/` 目录整体迁入 `sources/jmcomic/`，MultiSourceParser 和 ParserResponseError 放入 `sources/__init__.py`。所有外部文件的 import 路径同步更新。

**Tech Stack:** Python, pytest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `sources/__init__.py` | MultiSourceParser + ParserResponseError，sources 包入口 |
| Create | `sources/hcomic/__init__.py` | re-export HComicParser |
| Create | `sources/hcomic/parser.py` | HComicParser 类 |
| Create | `sources/moeimg/__init__.py` | re-export MoeImgParser |
| Create | `sources/moeimg/parser.py` | MoeImgParser 类 |
| Create | `sources/jmcomic/__init__.py` | jmcomic 模块入口（从 jmcomic/__init__.py 迁入） |
| Create | `sources/jmcomic/parser.py` | JmParser 类（从 jmcomic/parser.py 迁入，改相对引用） |
| Create | `sources/jmcomic/constants.py` | jmcomic 常量（从 jmcomic/constants.py 原样迁入） |
| Create | `sources/jmcomic/domain.py` | 域名解析（从 jmcomic/domain.py 迁入，改相对引用） |
| Create | `sources/jmcomic/session.py` | 会话工厂（从 jmcomic/session.py 迁入，改相对引用） |
| Create | `sources/jmcomic/descrambler.py` | 图片反混淆（从 jmcomic/descrambler.py 原样迁入） |
| Modify | `python/ipc_server.py:48` | 更新 import |
| Modify | `python/ipc/cover_mixin.py:15` | 更新 import |
| Modify | `python/ipc/preview_mixin.py:139` | 更新 import |
| Modify | `python/ipc/search_mixin.py:14,113,140,151,162` | 更新 import |
| Modify | `python/ipc/auth_mixin.py:13` | 更新 import |
| Modify | `python/ipc/config_mixin.py:16` | 更新 import |
| Modify | `downloader.py:169` | 更新 import |
| Modify | `tests/conftest.py:6` | 更新 import |
| Modify | `tests/test_parser.py:5` | 更新 import |
| Modify | `tests/test_parser_moeimg.py:4` | 更新 import |
| Modify | `tests/test_parser_fallback.py:5` | 更新 import |
| Modify | `tests/test_parser_favourites.py:8` | 更新 import |
| Modify | `tests/test_parser_pagination.py:4` | 更新 import |
| Modify | `tests/test_multi_source_parser.py:3` | 更新 import |
| Modify | `tests/test_auth_application.py:5` | 更新 import |
| Modify | `tests/test_jmcomic_parser.py:2-3` | 更新 import |
| Modify | `tests/test_jmcomic_descrambler.py:7` | 更新 import |
| Modify | `tests/test_jmcomic_domain.py:5` | 更新 import |
| Delete | `parser.py` | 删除旧文件 |
| Delete | `jmcomic/` | 删除旧目录（含 __pycache__） |

---

### Task 1: 创建 sources/hcomic/ 模块

**Files:**
- Create: `sources/hcomic/__init__.py`
- Create: `sources/hcomic/parser.py`

- [ ] **Step 1: 创建 sources/hcomic/parser.py**

将 `parser.py` 第 1-667 行（HComicParser 相关部分）写入新文件。调整 import：

```python
"""h-comic 页面解析模块"""
from __future__ import annotations

import contextlib
import json
import logging
import re
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urljoin

import requests

from constants import DEFAULT_USER_AGENT
from models import ComicInfo, PaginationInfo
from utils import apply_system_proxy_to_session, configure_session_auth

logger = logging.getLogger(__name__)


MAX_PAYLOAD_SIZE = 2_000_000


class ParserResponseError(RuntimeError):
    """响应读取/解析相关异常。"""


class HComicParser:
    """h-comic.com 解析器"""
    # ... (原样复制 parser.py 中 HComicParser 类的完整代码，第 30-666 行)
```

注意：去掉了 `from jmcomic.parser import JmParser` 这行 import（这个 import 只在 MultiSourceParser 中需要，不在 HComicParser 中使用）。同时去掉了 `from models import AuthConfig`（只在 MultiSourceParser 中使用）和 `from utils import normalize_source_auth`（同上）。

- [ ] **Step 2: 创建 sources/hcomic/__init__.py**

```python
"""hcomic 来源模块。"""
from .parser import HComicParser, ParserResponseError

__all__ = ["HComicParser", "ParserResponseError"]
```

- [ ] **Step 3: 提交**

```bash
git add sources/hcomic/__init__.py sources/hcomic/parser.py
git commit -m "refactor: create sources/hcomic module with HComicParser"
```

---

### Task 2: 创建 sources/moeimg/ 模块

**Files:**
- Create: `sources/moeimg/__init__.py`
- Create: `sources/moeimg/parser.py`

- [ ] **Step 1: 创建 sources/moeimg/parser.py**

将 `parser.py` 第 669-1151 行（MoeImgParser 类）写入新文件。调整 import：

```python
"""moeimg.fan 页面解析模块"""
from __future__ import annotations

import logging
import re
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin

import requests

from constants import DEFAULT_USER_AGENT
from models import ComicInfo, PaginationInfo
from utils import apply_system_proxy_to_session, configure_session_auth

logger = logging.getLogger(__name__)


class ParserResponseError(RuntimeError):
    """响应读取/解析相关异常。"""


class MoeImgParser:
    """moeimg.fan 解析器。"""
    # ... (原样复制 parser.py 中 MoeImgParser 类的完整代码，第 669-1151 行)
```

注意：MoeImgParser 引用了 `ParserResponseError`（在自己模块的 `_request_json` 方法中 raise），所以需要在 moeimg/parser.py 中也定义 `ParserResponseError`。实际上这个异常类应该在 `sources/__init__.py` 中统一定义一次，但为了让每个子模块可以独立使用，在各自的 parser.py 中各保留一份定义（后续如果需要可以改为从 sources 导入）。

- [ ] **Step 2: 创建 sources/moeimg/__init__.py**

```python
"""moeimg 来源模块。"""
from .parser import MoeImgParser, ParserResponseError

__all__ = ["MoeImgParser", "ParserResponseError"]
```

- [ ] **Step 3: 提交**

```bash
git add sources/moeimg/__init__.py sources/moeimg/parser.py
git commit -m "refactor: create sources/moeimg module with MoeImgParser"
```

---

### Task 3: 迁移 jmcomic 到 sources/jmcomic/ 并改相对引用

**Files:**
- Create: `sources/jmcomic/__init__.py`（原 `jmcomic/__init__.py` 内容）
- Create: `sources/jmcomic/constants.py`（原样复制）
- Create: `sources/jmcomic/parser.py`（改相对引用）
- Create: `sources/jmcomic/domain.py`（改相对引用）
- Create: `sources/jmcomic/session.py`（改相对引用）
- Create: `sources/jmcomic/descrambler.py`（原样复制）

- [ ] **Step 1: 创建 sources/jmcomic/constants.py**

原样复制 `jmcomic/constants.py` 的内容，无需修改 import（该文件不引用其他 jmcomic 模块）。

- [ ] **Step 2: 创建 sources/jmcomic/session.py**

将 `jmcomic/session.py` 内容复制，将绝对引用改为相对引用：

```python
"""jmcomic 共享会话工厂。"""
from __future__ import annotations

import logging

from .constants import IMPERSONATE_BROWSER

logger = logging.getLogger(__name__)


def create_session():
    """创建支持浏览器指纹模拟的 HTTP 会话。

    优先使用 curl_cffi（支持 TLS 指纹模拟），
    不可用时回退到标准 requests 库。
    """
    try:
        from curl_cffi import requests as cf_requests
        return cf_requests.Session(impersonate=IMPERSONATE_BROWSER)
    except ImportError:
        logger.warning("curl_cffi not available, falling back to requests (may get 403)")
        import requests
        return requests.Session()
```

变更：`from jmcomic.constants import ...` → `from .constants import ...`

- [ ] **Step 3: 创建 sources/jmcomic/domain.py**

将 `jmcomic/domain.py` 内容复制，将绝对引用改为相对引用：

变更：
- `from jmcomic.constants import ...` → `from .constants import ...`
- `from jmcomic.session import ...` → `from .session import ...`

- [ ] **Step 4: 创建 sources/jmcomic/parser.py**

将 `jmcomic/parser.py` 内容复制，将绝对引用改为相对引用：

变更：
- `from jmcomic.constants import (...)` → `from .constants import (...)`
- `from jmcomic.domain import JmDomainResolver` → `from .domain import JmDomainResolver`
- `from jmcomic.session import create_session` → `from .session import create_session`

保持不变：
- `from models import ComicInfo, PaginationInfo`（引用根目录共享模块）
- `from utils import configure_session_auth`（引用根目录共享模块）

- [ ] **Step 5: 创建 sources/jmcomic/descrambler.py**

原样复制 `jmcomic/descrambler.py` 的内容，无需修改 import（该文件不引用其他 jmcomic 模块）。

- [ ] **Step 6: 创建 sources/jmcomic/__init__.py**

```python
"""jmcomic 来源模块。"""
```

（与原 `jmcomic/__init__.py` 内容一致）

- [ ] **Step 7: 提交**

```bash
git add sources/jmcomic/
git commit -m "refactor: migrate jmcomic module into sources/jmcomic with relative imports"
```

---

### Task 4: 创建 sources/__init__.py（MultiSourceParser + ParserResponseError）

**Files:**
- Create: `sources/__init__.py`

- [ ] **Step 1: 创建 sources/__init__.py**

将 `parser.py` 第 1153-1307 行（MultiSourceParser 类）和 `ParserResponseError` 异常类写入新文件。调整 import：

```python
"""漫画来源子系统。"""
from __future__ import annotations

import logging

import requests

from models import AuthConfig, ComicInfo, PaginationInfo
from sources.hcomic.parser import HComicParser, ParserResponseError
from sources.moeimg.parser import MoeImgParser
from sources.jmcomic.parser import JmParser
from utils import normalize_source_auth

logger = logging.getLogger(__name__)

__all__ = ["MultiSourceParser", "ParserResponseError"]


class MultiSourceParser:
    """多来源解析器分发层。"""
    # ... (原样复制 parser.py 中 MultiSourceParser 类的完整代码，第 1153-1307 行)
```

注意：MultiSourceParser 内部引用了 `requests.Session`（`session` 属性和 `get_sessions` 方法），所以需要 `import requests`。

- [ ] **Step 2: 提交**

```bash
git add sources/__init__.py
git commit -m "refactor: create sources package with MultiSourceParser"
```

---

### Task 5: 更新外部文件的 import 路径

**Files:**
- Modify: `python/ipc_server.py`
- Modify: `python/ipc/cover_mixin.py`
- Modify: `python/ipc/preview_mixin.py`
- Modify: `python/ipc/search_mixin.py`
- Modify: `python/ipc/auth_mixin.py`
- Modify: `python/ipc/config_mixin.py`
- Modify: `downloader.py`

- [ ] **Step 1: 更新 python/ipc_server.py**

```python
# 第 48 行，将:
from parser import MultiSourceParser
# 改为:
from sources import MultiSourceParser
```

- [ ] **Step 2: 更新 python/ipc/cover_mixin.py**

```python
# 第 15 行，将:
from parser import MultiSourceParser
# 改为:
from sources import MultiSourceParser
```

- [ ] **Step 3: 更新 python/ipc/preview_mixin.py**

```python
# 第 139 行，将:
from jmcomic.descrambler import descramble_image
# 改为:
from sources.jmcomic.descrambler import descramble_image
```

- [ ] **Step 4: 更新 python/ipc/search_mixin.py**

```python
# 第 14 行，将:
from parser import MultiSourceParser
# 改为:
from sources import MultiSourceParser

# 第 113, 140, 151, 162 行，将:
from parser import ParserResponseError
# 改为:
from sources import ParserResponseError
```

- [ ] **Step 5: 更新 python/ipc/auth_mixin.py**

```python
# 第 13 行，将:
from parser import MultiSourceParser
# 改为:
from sources import MultiSourceParser
```

- [ ] **Step 6: 更新 python/ipc/config_mixin.py**

```python
# 第 16 行，将:
from parser import MultiSourceParser
# 改为:
from sources import MultiSourceParser
```

- [ ] **Step 7: 更新 downloader.py**

```python
# 第 169 行，将:
from jmcomic.descrambler import descramble_image
# 改为:
from sources.jmcomic.descrambler import descramble_image
```

- [ ] **Step 8: 提交**

```bash
git add python/ipc_server.py python/ipc/cover_mixin.py python/ipc/preview_mixin.py python/ipc/search_mixin.py python/ipc/auth_mixin.py python/ipc/config_mixin.py downloader.py
git commit -m "refactor: update import paths in ipc and downloader to use sources package"
```

---

### Task 6: 更新测试文件的 import 路径

**Files:**
- Modify: `tests/conftest.py`
- Modify: `tests/test_parser.py`
- Modify: `tests/test_parser_moeimg.py`
- Modify: `tests/test_parser_fallback.py`
- Modify: `tests/test_parser_favourites.py`
- Modify: `tests/test_parser_pagination.py`
- Modify: `tests/test_multi_source_parser.py`
- Modify: `tests/test_auth_application.py`
- Modify: `tests/test_jmcomic_parser.py`
- Modify: `tests/test_jmcomic_descrambler.py`
- Modify: `tests/test_jmcomic_domain.py`

- [ ] **Step 1: 更新 tests/conftest.py**

```python
# 第 6 行，将:
from parser import HComicParser
# 改为:
from sources.hcomic import HComicParser
```

- [ ] **Step 2: 更新 tests/test_parser.py**

```python
# 第 5 行，将:
from parser import HComicParser
# 改为:
from sources.hcomic import HComicParser
```

- [ ] **Step 3: 更新 tests/test_parser_moeimg.py**

```python
# 第 4 行，将:
from parser import MoeImgParser
# 改为:
from sources.moeimg import MoeImgParser
```

- [ ] **Step 4: 更新 tests/test_parser_fallback.py**

```python
# 第 5 行，将:
from parser import HComicParser, ParserResponseError
# 改为:
from sources.hcomic import HComicParser, ParserResponseError
```

- [ ] **Step 5: 更新 tests/test_parser_favourites.py**

```python
# 第 8 行，将:
from parser import HComicParser, ParserResponseError
# 改为:
from sources.hcomic import HComicParser, ParserResponseError
```

- [ ] **Step 6: 更新 tests/test_parser_pagination.py**

```python
# 第 4 行，将:
from parser import HComicParser
# 改为:
from sources.hcomic import HComicParser
```

- [ ] **Step 7: 更新 tests/test_multi_source_parser.py**

```python
# 第 3 行，将:
from parser import MultiSourceParser
# 改为:
from sources import MultiSourceParser
```

- [ ] **Step 8: 更新 tests/test_auth_application.py**

```python
# 第 5 行，将:
from parser import HComicParser
# 改为:
from sources.hcomic import HComicParser
```

- [ ] **Step 9: 更新 tests/test_jmcomic_parser.py**

```python
# 第 2-3 行，将:
from jmcomic.constants import RANKING_MAPPINGS
from jmcomic.parser import JmParser
# 改为:
from sources.jmcomic.constants import RANKING_MAPPINGS
from sources.jmcomic.parser import JmParser
```

- [ ] **Step 10: 更新 tests/test_jmcomic_descrambler.py**

```python
# 第 7 行，将:
from jmcomic.descrambler import _compute_num, descramble_image
# 改为:
from sources.jmcomic.descrambler import _compute_num, descramble_image
```

- [ ] **Step 11: 更新 tests/test_jmcomic_domain.py**

```python
# 第 5 行，将:
from jmcomic.domain import JmDomainResolver
# 改为:
from sources.jmcomic.domain import JmDomainResolver
```

- [ ] **Step 12: 提交**

```bash
git add tests/
git commit -m "refactor: update import paths in tests to use sources package"
```

---

### Task 7: 删除旧文件并清理

**Files:**
- Delete: `parser.py`
- Delete: `jmcomic/` 目录（含 `__pycache__/`）

- [ ] **Step 1: 删除根目录 parser.py**

```bash
git rm parser.py
```

- [ ] **Step 2: 删除旧 jmcomic/ 目录**

```bash
git rm -r jmcomic/
```

注意：需要包含 `jmcomic/__pycache__/` 目录中的 `.pyc` 文件。如果 `.pyc` 文件未被 git 跟踪，额外执行 `rm -rf jmcomic/` 确保 `.pyc` 文件也被清理。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "refactor: remove old parser.py and jmcomic/ directory"
```

---

### Task 8: 验证

- [ ] **Step 1: 运行全部测试**

```bash
cd E:/Developing/hcomic_downloader && python -m pytest tests/ -v --tb=short 2>&1 | head -100
```

Expected: 所有测试通过（PASS）。如果有失败，检查失败测试的 import 路径是否正确。

- [ ] **Step 2: 验证 import 无残留旧路径**

```bash
cd E:/Developing/hcomic_downloader && grep -rn "from parser import\|from jmcomic\.\|import jmcomic\." --include="*.py" --exclude-dir=venv --exclude-dir=sources .
```

Expected: 无输出（所有旧 import 已清理干净）。如果有残留，修复对应的 import。

- [ ] **Step 3: 最终提交（如有修复）**

```bash
git add -A
git commit -m "refactor: source module restructure complete"
```
