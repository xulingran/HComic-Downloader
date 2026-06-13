# CopyManga Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CopyManga (拷贝漫画) as a new source with search, comic detail, chapter listing, and AES-decrypted image URL support.

**Architecture:** Follow existing parser pattern (`ParserContextMixin` + `requests.Session`). New `sources/copymanga/` package with separated concerns: constants, AES crypto, and parser. Integrate into `MultiSourceParser` and IPC layer.

**Tech Stack:** Python 3, `requests`, `lxml`, `cryptography` (new dependency)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `sources/copymanga/__init__.py` | Empty package marker |
| `sources/copymanga/constants.py` | Domain URLs, headers, API paths |
| `sources/copymanga/crypto.py` | AES-128-CBC decryption, AES key extraction from HTML, in-memory key cache |
| `sources/copymanga/parser.py` | `CopyMangaParser` — search, detail, chapters, chapter images |
| `sources/__init__.py` | Register `"copymanga"` in `MultiSourceParser` |
| `python/ipc/search_mixin.py` | Add `"copymanga"` to `_VALID_SOURCES`, add chapter preview branch |
| `requirements.txt` | Add `cryptography` |
| `tests/test_copymanga_parser.py` | Unit tests |
| `tests/fixtures/json/copymanga_search_response.json` | Search API mock data |
| `tests/fixtures/json/copymanga_chapters_response.json` | Chapters API encrypted payload mock (pre-encrypted for test) |
| `tests/fixtures/html/copymanga_aes_key_page.html` | HTML page with AES key in script tag |
| `tests/fixtures/html/copymanga_chapter_page.html` | HTML page with contentKey for image URLs |

---

### Task 1: Add `cryptography` dependency

**Files:**
- Modify: `requirements.txt`

- [ ] **Step 1: Add cryptography to requirements.txt**

Add this line to `requirements.txt` (after the existing entries):

```
cryptography>=43.0.0
```

- [ ] **Step 2: Install the dependency**

Run: `pip install cryptography>=43.0.0`
Expected: Successfully installed

- [ ] **Step 3: Commit**

```bash
git add requirements.txt
git commit -m "chore: add cryptography dependency for copymanga source"
```

---

### Task 2: Create `sources/copymanga/constants.py`

**Files:**
- Create: `sources/copymanga/__init__.py`
- Create: `sources/copymanga/constants.py`

- [ ] **Step 1: Create `__init__.py`**

Create an empty file at `sources/copymanga/__init__.py`.

- [ ] **Step 2: Create `constants.py`**

```python
"""拷贝漫画 (CopyManga) 常量定义。"""

PC_DOMAIN = "www.2026copy.com"
API_DOMAIN = "api.2026copy.com"

# 搜索 API
SEARCH_URL_TEMPLATE = (
    f"https://{API_DOMAIN}/api/v3/search/comic"
    "?platform=1&limit=30&offset={{offset}}&q_type=&_update=false&q={{keyword}}"
)

# 章节详情 API（path_word 占位）
CHAPTERS_URL_TEMPLATE = (
    f"https://{PC_DOMAIN}/comicdetail/{{path_word}}/chapters"
)

# 章节 HTML 页（用于提取图片 URL）
CHAPTER_PAGE_URL_TEMPLATE = (
    f"https://{PC_DOMAIN}/comic/{{path_word}}/chapter/{{chapter_id}}"
)

# AES 密钥提取页面（固定访问一拳超人）
AES_KEY_PAGE_URL = f"https://{PC_DOMAIN}/comic/yiquanchaoren"

# 每页条目数
PAGE_SIZE = 30

# PC 端页面请求 headers
PC_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) "
        "Gecko/20100101 Firefox/145.0"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,*/*;q=0.8"
    ),
    "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
}

# 移动端 API 请求 headers
API_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 "
        "Mobile/15E148 Safari/604.1"
    ),
    "Accept": "application/json",
    "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
    "Origin": f"https://{PC_DOMAIN}",
    "Connection": "keep-alive",
    "Accept-Encoding": "gzip, compress, br",
    "platform": "1",
    "version": "2026.02.02",
    "webp": "1",
    "region": "0",
}
```

- [ ] **Step 3: Commit**

```bash
git add sources/copymanga/__init__.py sources/copymanga/constants.py
git commit -m "feat(copymanga): add package structure and constants"
```

---

### Task 3: Create `sources/copymanga/crypto.py` — AES key cache and extraction

**Files:**
- Create: `sources/copymanga/crypto.py`
- Create: `tests/fixtures/html/copymanga_aes_key_page.html`
- Modify: `tests/conftest.py`
- Create: `tests/test_copymanga_parser.py` (initial)

- [ ] **Step 1: Create HTML fixture for AES key extraction**

Create `tests/fixtures/html/copymanga_aes_key_page.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
<script type="text/javascript">
var someOther = "noise";
</script>
<script type="text/javascript">
var aesKey = "test_aes_key_1234";
console.log("loaded");
</script>
</body>
</html>
```

- [ ] **Step 2: Write the failing test for AES key extraction**

Append to `tests/test_copymanga_parser.py`:

```python
"""CopyManga 解析器单元测试。"""

import pytest

from sources.copymanga.crypto import AesKeyCache, extract_aes_key


class TestExtractAesKey:
    """测试从 HTML 页面提取 AES 密钥。"""

    def test_extracts_key_from_script_tag(self, html_sample):
        html = html_sample("copymanga_aes_key_page.html")
        key = extract_aes_key(html)
        assert key == "test_aes_key_1234"

    def test_raises_on_missing_key(self):
        with pytest.raises(ValueError, match="aes key script not found"):
            extract_aes_key("<html><body><p>no scripts</p></body></html>")

    def test_raises_on_empty_html(self):
        with pytest.raises(ValueError, match="aes key script not found"):
            extract_aes_key("")
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python -m pytest tests/test_copymanga_parser.py::TestExtractAesKey -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sources.copymanga.crypto'`

- [ ] **Step 4: Implement `crypto.py` with `AesKeyCache` and `extract_aes_key`**

```python
"""拷贝漫画 AES-CBC 解密与密钥管理。"""

from __future__ import annotations

import json
import re

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from lxml import html as lxml_html


class AesKeyCache:
    """内存缓存 AES 密钥。"""

    def __init__(self) -> None:
        self._key: str | None = None

    def get(self) -> str | None:
        return self._key

    def set(self, key: str) -> None:
        self._key = key

    def clear(self) -> None:
        self._key = None


def extract_aes_key(html_text: str) -> str:
    """从 PC 站页面 HTML 提取 AES 密钥。

    在 <script> 标签中查找以 ``var`` 开头的文本，然后从中提取赋值字符串。
    """
    doc = lxml_html.fromstring(html_text)
    script_texts = [
        text.strip().replace(" ", "")
        for text in doc.xpath("//script/text()")
    ]
    real_script = next(
        (text for text in script_texts if text.startswith("var")),
        None,
    )
    if not real_script:
        raise ValueError("kaobei aes key script not found")

    # 取第一行，匹配 = '...' 或 = "..."
    first_line = real_script.split("\n")[0]
    matched = re.search(r"""=['"](.*?)['"]""", first_line)
    if not matched:
        raise ValueError("kaobei aes key value not found")
    return matched.group(1)


def decrypt_aes_cbc(encrypted: str, aes_key: str) -> dict:
    """解密拷贝漫画的加密数据。

    Args:
        encrypted: 加密字符串，格式为 iv(16字符) + cipher_hex
        aes_key: AES 密钥（UTF-8 字符串）

    Returns:
        解密后的 JSON 字典

    Raises:
        ValueError: 解密失败
    """
    if len(encrypted) <= 16:
        raise ValueError(
            f"Encrypted payload too short: len={len(encrypted)}"
        )
    iv = encrypted[:16]
    cipher_hex = encrypted[16:]
    cipher_bytes = bytes.fromhex(cipher_hex)
    key_bytes = aes_key.encode("utf-8")
    iv_bytes = iv.encode("utf-8")

    cipher = Cipher(
        algorithms.AES(key_bytes), modes.CBC(iv_bytes), backend=default_backend()
    )
    decryptor = cipher.decryptor()
    decrypted_padded = decryptor.update(cipher_bytes) + decryptor.finalize()

    unpadder = padding.PKCS7(128).unpadder()
    decrypted = unpadder.update(decrypted_padded) + unpadder.finalize()

    return json.loads(decrypted.decode("utf-8"))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest tests/test_copymanga_parser.py::TestExtractAesKey -v`
Expected: PASS

- [ ] **Step 6: Write tests for `AesKeyCache`**

Append to `tests/test_copymanga_parser.py`:

```python
class TestAesKeyCache:
    """测试 AES 密钥内存缓存。"""

    def test_initial_state_is_none(self):
        cache = AesKeyCache()
        assert cache.get() is None

    def test_set_and_get(self):
        cache = AesKeyCache()
        cache.set("my_key")
        assert cache.get() == "my_key"

    def test_clear_resets_to_none(self):
        cache = AesKeyCache()
        cache.set("my_key")
        cache.clear()
        assert cache.get() is None

    def test_set_overwrites_previous(self):
        cache = AesKeyCache()
        cache.set("old_key")
        cache.set("new_key")
        assert cache.get() == "new_key"
```

- [ ] **Step 7: Run all copymanga tests**

Run: `python -m pytest tests/test_copymanga_parser.py -v`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add sources/copymanga/crypto.py tests/test_copymanga_parser.py tests/fixtures/html/copymanga_aes_key_page.html
git commit -m "feat(copymanga): add AES key cache, extraction, and decrypt functions"
```

---

### Task 4: Test `decrypt_aes_cbc` with real encrypt/decrypt roundtrip

**Files:**
- Modify: `tests/test_copymanga_parser.py`

- [ ] **Step 1: Write roundtrip decrypt test**

Append to `tests/test_copymanga_parser.py`:

```python
import json as _json

from sources.copymanga.crypto import decrypt_aes_cbc


class TestDecryptAesCbc:
    """测试 AES-CBC 解密（使用 Python cryptography 加密后解密验证 roundtrip）。"""

    @staticmethod
    def _encrypt(plaintext_dict: dict, aes_key: str, iv: str) -> str:
        """辅助：用相同参数加密，返回 iv + cipher_hex。"""
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import padding
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        raw = _json.dumps(plaintext_dict).encode("utf-8")
        padder = padding.PKCS7(128).padder()
        padded = padder.update(raw) + padder.finalize()

        cipher = Cipher(
            algorithms.AES(aes_key.encode("utf-8")),
            modes.CBC(iv.encode("utf-8")),
            backend=default_backend(),
        )
        encryptor = cipher.encryptor()
        ct = encryptor.update(padded) + encryptor.finalize()
        return iv + ct.hex()

    def test_roundtrip_decrypt(self):
        key = "0123456789abcdef"
        iv = "abcdef0123456789"
        payload = {"name": "test", "id": 42, "items": [1, 2, 3]}
        encrypted = self._encrypt(payload, key, iv)
        result = decrypt_aes_cbc(encrypted, key)
        assert result == payload

    def test_decrypt_empty_dict(self):
        key = "aaaaaaaaaaaaaaaa"
        iv = "bbbbbbbbbbbbbbbb"
        encrypted = self._encrypt({}, key, iv)
        result = decrypt_aes_cbc(encrypted, key)
        assert result == {}

    def test_decrypt_payload_too_short_raises(self):
        with pytest.raises(ValueError, match="too short"):
            decrypt_aes_cbc("short", "key1234567890123")

    def test_decrypt_invalid_hex_raises(self):
        with pytest.raises(Exception):
            decrypt_aes_cbc("0123456789abcdefGG", "key1234567890123")

    def test_decrypt_wrong_key_raises(self):
        key = "correct_key_1234"
        wrong_key = "wrong_key_______"
        iv = "0123456789abcdef"
        encrypted = self._encrypt({"hello": "world"}, key, iv)
        with pytest.raises(Exception):
            decrypt_aes_cbc(encrypted, wrong_key)
```

- [ ] **Step 2: Run the tests**

Run: `python -m pytest tests/test_copymanga_parser.py::TestDecryptAesCbc -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_copymanga_parser.py
git commit -m "test(copymanga): add AES-CBC roundtrip decrypt tests"
```

---

### Task 5: Create `sources/copymanga/parser.py` — search

**Files:**
- Create: `sources/copymanga/parser.py`
- Create: `tests/fixtures/json/copymanga_search_response.json`
- Modify: `tests/conftest.py` (add copymanga_parser fixture)
- Modify: `tests/test_copymanga_parser.py`

- [ ] **Step 1: Create search response JSON fixture**

Create `tests/fixtures/json/copymanga_search_response.json`:

```json
{
  "code": 200,
  "message": "success",
  "results": {
    "list": [
      {
        "path_word": "onepunchman",
        "name": "一拳超人",
        "author": [
          {"name": "ONE", "path_word": "one"},
          {"name": "村田雄介", "path_word": "murata"}
        ],
        "cover": "https://cover.example.com/onepunchman.jpg",
        "popular": 98765,
        "datetime_updated": "2026-06-01",
        "last_chapter_name": "第243话",
        "status": {"value": 0, "display": "连载中"},
        "theme": []
      },
      {
        "path_word": "test-comic",
        "name": "测试漫画",
        "author": [
          {"name": "测试作者", "path_word": "test-author"}
        ],
        "cover": "https://cover.example.com/test.jpg",
        "popular": 1234,
        "datetime_updated": "2026-05-20",
        "last_chapter_name": "第10话",
        "status": {"value": 1, "display": "已完结"},
        "theme": []
      }
    ],
    "total": 2,
    "limit": 30,
    "offset": 0
  }
}
```

- [ ] **Step 2: Add `copymanga_parser` fixture to conftest**

Add to `tests/conftest.py`:

```python
from sources.copymanga.parser import CopyMangaParser


@pytest.fixture
def copymanga_parser():
    """创建 CopyMangaParser 实例用于测试。"""
    return CopyMangaParser(timeout=5)
```

Also add the import at the top of conftest alongside the other parser imports.

- [ ] **Step 3: Write failing test for search**

Append to `tests/test_copymanga_parser.py`:

```python
import requests as _requests

from sources.copymanga.parser import CopyMangaParser
from sources.base import ParserResponseError


def _make_json_response(payload: dict, status_code: int = 200) -> _requests.Response:
    """构建带有 JSON payload 的 requests.Response。"""
    import json
    resp = _requests.Response()
    resp.status_code = status_code
    resp._content = json.dumps(payload).encode("utf-8")
    resp.headers["Content-Type"] = "application/json"
    return resp


class TestCopyMangaSearch:
    """测试搜索功能。"""

    def test_search_parses_results(self, copymanga_parser, monkeypatch, json_fixture):
        payload = json_fixture("copymanga_search_response.json")
        captured = {}

        def fake_get(url, **kwargs):
            captured["url"] = url
            return _make_json_response(payload)

        monkeypatch.setattr(copymanga_parser.session, "get", fake_get)

        comics, pagination = copymanga_parser.search("一拳超人", page=1)

        assert len(comics) == 2

        c1 = comics[0]
        assert c1.id == "onepunchman"
        assert c1.title == "一拳超人"
        assert c1.author == "ONE, 村田雄介"
        assert c1.cover_url == "https://cover.example.com/onepunchman.jpg"
        assert c1.source_site == "copymanga"
        assert c1.album_total_chapters == 1

        assert pagination is not None
        assert pagination.total_items == 2
        assert pagination.current_page == 1

    def test_search_offset_calculation(self, copymanga_parser, monkeypatch):
        captured = {}

        def fake_get(url, **kwargs):
            captured["url"] = url
            return _make_json_response({
                "code": 200,
                "results": {"list": [], "total": 0, "limit": 30, "offset": 30},
            })

        monkeypatch.setattr(copymanga_parser.session, "get", fake_get)

        copymanga_parser.search("test", page=2)
        assert "offset=30" in captured["url"]

    def test_search_empty_result(self, copymanga_parser, monkeypatch):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: _make_json_response({
                "code": 200,
                "results": {"list": [], "total": 0, "limit": 30, "offset": 0},
            }),
        )
        comics, pagination = copymanga_parser.search("不存在")
        assert comics == []
        assert pagination is not None
        assert pagination.total_items == 0

    def test_search_network_error_returns_empty(self, copymanga_parser, monkeypatch):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        comics, pagination = copymanga_parser.search("test")
        assert comics == []
        assert pagination is None
```

- [ ] **Step 4: Run test to verify it fails**

Run: `python -m pytest tests/test_copymanga_parser.py::TestCopyMangaSearch -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sources.copymanga.parser'`

- [ ] **Step 5: Create `parser.py` with search support**

```python
"""拷贝漫画 (CopyManga) 解析模块。"""

from __future__ import annotations

import logging

import requests

from models import ComicInfo, PaginationInfo
from sources.base import ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session

from .constants import (
    API_HEADERS,
    AES_KEY_PAGE_URL,
    CHAPTER_PAGE_URL_TEMPLATE,
    CHAPTERS_URL_TEMPLATE,
    PAGE_SIZE,
    PC_HEADERS,
    SEARCH_URL_TEMPLATE,
)
from .crypto import AesKeyCache, decrypt_aes_cbc, extract_aes_key

logger = logging.getLogger(__name__)


class CopyMangaParser(ParserContextMixin):
    """拷贝漫画解析器。"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(PC_HEADERS)
        apply_system_proxy_to_session(self.session)
        self._aes_key_cache = AesKeyCache()

    def configure_auth(
        self, cookie: str = "", user_agent: str = "", bearer_token: str = ""
    ):
        """配置认证信息。拷贝漫画不需要认证，保留接口兼容。"""

    # ------------------------------------------------------------------
    # 内部请求辅助
    # ------------------------------------------------------------------

    def _request_text(self, url: str, *, headers: dict | None = None) -> str:
        """发起 GET 请求并返回响应文本。"""
        try:
            resp = self.session.get(
                url, headers=headers, timeout=self.timeout, allow_redirects=True
            )
            resp.raise_for_status()
            return resp.text
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e

    def _request_json(self, url: str, *, headers: dict | None = None) -> dict:
        """发起 GET 请求并返回解析后的 JSON 字典。"""
        try:
            resp = self.session.get(
                url, headers=headers, timeout=self.timeout, allow_redirects=True
            )
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e
        except ValueError as e:
            raise ParserResponseError(f"响应解析失败: {url}") from e

    # ------------------------------------------------------------------
    # AES 密钥管理
    # ------------------------------------------------------------------

    def _ensure_aes_key(self) -> str:
        """确保 AES 密钥已缓存，未缓存则从页面提取。"""
        cached = self._aes_key_cache.get()
        if cached:
            return cached
        html_text = self._request_text(AES_KEY_PAGE_URL)
        key = extract_aes_key(html_text)
        self._aes_key_cache.set(key)
        return key

    def _decrypt(self, encrypted: str) -> dict:
        """解密 API 返回的加密数据，失败时清除缓存密钥。"""
        key = self._ensure_aes_key()
        try:
            return decrypt_aes_cbc(encrypted, key)
        except Exception:
            self._aes_key_cache.clear()
            raise

    # ------------------------------------------------------------------
    # 搜索
    # ------------------------------------------------------------------

    def search(
        self, keyword: str, page: int = 1, *, tag: str = ""
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索漫画。"""
        offset = (page - 1) * PAGE_SIZE
        url = SEARCH_URL_TEMPLATE.format(offset=offset, keyword=keyword)
        try:
            data = self._request_json(url, headers=API_HEADERS)
        except ParserResponseError as e:
            logger.error("CopyManga search failed: %s", e, exc_info=True)
            return [], None

        results = data.get("results") or {}
        items = results.get("list") or []
        total = results.get("total", 0)

        comics = []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                comics.append(self._parse_search_item(item))
            except (KeyError, TypeError, ValueError) as e:
                logger.debug("Parse search item skipped: %s", e)

        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
            limit=PAGE_SIZE,
            total_items=total,
        )
        return comics, pagination

    @staticmethod
    def _parse_search_item(item: dict) -> ComicInfo:
        """解析搜索结果中的单个漫画。"""
        path_word = item.get("path_word", "")
        name = item.get("name", "未知标题")
        authors = item.get("author") or []
        author_names = ", ".join(a.get("name", "") for a in authors if a.get("name"))
        cover = item.get("cover", "")
        popular = item.get("popular", 0)

        return ComicInfo(
            id=path_word,
            title=name,
            author=author_names or None,
            pages=0,
            cover_url=cover,
            preview_url=f"https://www.2026copy.com/comic/{path_word}",
            source_site="copymanga",
            comic_source="COPYMANGA",
            album_total_chapters=1,
        )

    # ------------------------------------------------------------------
    # 详情 & 章节列表
    # ------------------------------------------------------------------

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情（含章节列表）。

        Args:
            comic_id: 漫画的 path_word
        """
        try:
            url = CHAPTERS_URL_TEMPLATE.format(path_word=comic_id)
            headers = {
                **API_HEADERS,
                "Referer": f"https://www.2026copy.com/comic/{comic_id}",
            }
            data = self._request_json(url, headers=headers)
            encrypted = data.get("results")
            if not isinstance(encrypted, str):
                raise ValueError("Chapters payload missing encrypted results")
            decrypted = self._decrypt(encrypted)
            return self._parse_chapters_payload(decrypted, comic_id)
        except Exception as e:
            logger.error("CopyManga get_comic_detail failed: %s", e, exc_info=True)
            return None

    def get_chapters(self, path_word: str) -> list[ChapterInfo]:
        """获取漫画章节列表。

        Args:
            path_word: 漫画的 path_word

        Returns:
            章节列表
        """
        from models import ChapterInfo as _CI

        try:
            url = CHAPTERS_URL_TEMPLATE.format(path_word=path_word)
            headers = {
                **API_HEADERS,
                "Referer": f"https://www.2026copy.com/comic/{path_word}",
            }
            data = self._request_json(url, headers=headers)
            encrypted = data.get("results")
            if not isinstance(encrypted, str):
                return []
            decrypted = self._decrypt(encrypted)
            return self._extract_chapters(decrypted)
        except Exception as e:
            logger.error("CopyManga get_chapters failed: %s", e, exc_info=True)
            return []

    def _parse_chapters_payload(
        self, decrypted: dict, path_word: str
    ) -> ComicInfo:
        """解析解密后的章节数据，构建 ComicInfo。"""
        build = decrypted.get("build") or {}
        groups = decrypted.get("groups") or {}
        default_group = groups.get("default") or {}
        chapters_data = default_group.get("chapters") or []

        chapters = self._extract_chapters(decrypted)

        # 从 build 中提取元数据
        comic_name = build.get("name", path_word)
        comic_author = build.get("author") or []
        author_names = ", ".join(
            a.get("name", "") for a in comic_author if isinstance(a, dict) and a.get("name")
        )
        cover = build.get("cover", "")
        status = build.get("status")
        if isinstance(status, dict):
            status_display = status.get("display", "")
        else:
            status_display = ""

        return ComicInfo(
            id=path_word,
            title=comic_name,
            author=author_names or None,
            pages=0,
            cover_url=cover,
            preview_url=f"https://www.2026copy.com/comic/{path_word}",
            source_site="copymanga",
            comic_source="COPYMANGA",
            chapters=chapters,
            album_id=path_word,
            album_total_chapters=len(chapters) if len(chapters) > 1 else 1,
        )

    @staticmethod
    def _extract_chapters(decrypted: dict) -> list:
        """从解密数据中提取章节列表。"""
        from models import ChapterInfo as _CI

        groups = decrypted.get("groups") or {}
        default_group = groups.get("default") or {}
        chapters_data = default_group.get("chapters") or []

        result = []
        for idx, ch in enumerate(chapters_data, start=1):
            if not isinstance(ch, dict):
                continue
            result.append(
                _CI(
                    id=ch.get("id", ""),
                    name=ch.get("name", ""),
                    index=idx,
                )
            )
        return result

    # ------------------------------------------------------------------
    # 章节图片
    # ------------------------------------------------------------------

    def get_chapter_images(
        self, path_word: str, chapter_id: str
    ) -> list[str]:
        """获取章节图片 URL 列表。

        Args:
            path_word: 漫画的 path_word
            chapter_id: 章节 ID

        Returns:
            图片 URL 列表
        """
        try:
            url = CHAPTER_PAGE_URL_TEMPLATE.format(
                path_word=path_word, chapter_id=chapter_id
            )
            html_text = self._request_text(url)
            content_key = self._extract_content_key(html_text, url)
            image_data = self._decrypt(content_key)
            urls = []
            for item in image_data:
                if isinstance(item, dict) and item.get("url"):
                    urls.append(item["url"])
            return urls
        except Exception as e:
            logger.error(
                "CopyManga get_chapter_images failed: %s", e, exc_info=True
            )
            return []

    @staticmethod
    def _extract_content_key(html_text: str, url: str = "") -> str:
        """从章节 HTML 页面提取 contentKey 变量的值。"""
        import re

        from lxml import html as lxml_html

        doc = lxml_html.fromstring(html_text)
        scripts = doc.xpath('//script[contains(text(), "contentKey")]/text()')
        script = next(iter(scripts), None)
        if not script:
            raise ValueError("contentKey script not found in chapter page")
        match = re.search(r"""var\s+contentKey\s*=\s*["']([^"']+)["']""", script)
        if not match:
            raise ValueError("contentKey value not found")
        key = match.group(1)
        if not key:
            raise ValueError("contentKey is empty")
        return key
```

- [ ] **Step 6: Run search tests**

Run: `python -m pytest tests/test_copymanga_parser.py::TestCopyMangaSearch -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add sources/copymanga/parser.py tests/fixtures/json/copymanga_search_response.json tests/conftest.py tests/test_copymanga_parser.py
git commit -m "feat(copymanga): add parser with search support"
```

---

### Task 6: Test `get_comic_detail` and `get_chapters`

**Files:**
- Create: `tests/fixtures/json/copymanga_chapters_response.json`
- Modify: `tests/test_copymanga_parser.py`

- [ ] **Step 1: Create chapters response fixture**

This is a pre-encrypted JSON payload. We'll encrypt it in the test itself using the same key, so the fixture is the **plaintext** response structure. Create `tests/fixtures/json/copymanga_chapters_response.json`:

```json
{
  "build": {
    "path_word": "onepunchman",
    "name": "一拳超人",
    "author": [
      {"name": "ONE", "path_word": "one"},
      {"name": "村田雄介", "path_word": "murata"}
    ],
    "cover": "https://cover.example.com/onepunchman.jpg",
    "status": {"value": 0, "display": "连载中"}
  },
  "groups": {
    "default": {
      "chapters": [
        {"id": "ch001", "name": "第1话"},
        {"id": "ch002", "name": "第2话"},
        {"id": "ch003", "name": "第3话"}
      ]
    }
  }
}
```

- [ ] **Step 2: Write failing tests for get_comic_detail and get_chapters**

Append to `tests/test_copymanga_parser.py`:

```python
class TestCopyMangaChapters:
    """测试漫画详情和章节列表。"""

    @staticmethod
    def _encrypt_payload(plaintext_dict: dict, aes_key: str, iv: str) -> str:
        """辅助：加密 JSON 字典，返回 iv + cipher_hex。"""
        import json
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import padding
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        raw = json.dumps(plaintext_dict).encode("utf-8")
        padder = padding.PKCS7(128).padder()
        padded = padder.update(raw) + padder.finalize()
        cipher = Cipher(
            algorithms.AES(aes_key.encode("utf-8")),
            modes.CBC(iv.encode("utf-8")),
            backend=default_backend(),
        )
        enc = cipher.encryptor()
        ct = enc.update(padded) + enc.finalize()
        return iv + ct.hex()

    def test_get_chapters_decrypts_and_parses(
        self, copymanga_parser, monkeypatch, json_fixture
    ):
        aes_key = "test_aes_key_1234"
        iv = "0123456789abcdef"
        chapters_data = json_fixture("copymanga_chapters_response.json")
        encrypted = self._encrypt_payload(chapters_data, aes_key, iv)

        # 预设 AES key，跳过页面提取
        copymanga_parser._aes_key_cache.set(aes_key)

        captured = {}

        def fake_get(url, **kwargs):
            captured["url"] = url
            return _make_json_response({"code": 200, "results": encrypted})

        monkeypatch.setattr(copymanga_parser.session, "get", fake_get)

        chapters = copymanga_parser.get_chapters("onepunchman")

        assert len(chapters) == 3
        assert chapters[0].id == "ch001"
        assert chapters[0].name == "第1话"
        assert chapters[0].index == 1
        assert chapters[2].index == 3

    def test_get_comic_detail_returns_comic_with_chapters(
        self, copymanga_parser, monkeypatch, json_fixture
    ):
        aes_key = "test_aes_key_1234"
        iv = "0123456789abcdef"
        chapters_data = json_fixture("copymanga_chapters_response.json")
        encrypted = self._encrypt_payload(chapters_data, aes_key, iv)

        copymanga_parser._aes_key_cache.set(aes_key)

        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda url, **kw: _make_json_response({"code": 200, "results": encrypted}),
        )

        comic = copymanga_parser.get_comic_detail("onepunchman")

        assert comic is not None
        assert comic.id == "onepunchman"
        assert comic.title == "一拳超人"
        assert comic.author == "ONE, 村田雄介"
        assert comic.source_site == "copymanga"
        assert len(comic.chapters) == 3
        assert comic.album_total_chapters == 3

    def test_get_comic_detail_error_returns_none(
        self, copymanga_parser, monkeypatch
    ):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        assert copymanga_parser.get_comic_detail("bad") is None

    def test_get_chapters_error_returns_empty(
        self, copymanga_parser, monkeypatch
    ):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        assert copymanga_parser.get_chapters("bad") == []

    def test_decrypt_failure_clears_aes_key(
        self, copymanga_parser, monkeypatch
    ):
        copymanga_parser._aes_key_cache.set("wrong_key")
        # 返回无法解密的数据
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda url, **kw: _make_json_response(
                {"code": 200, "results": "0123456789abcdef" + "ff" * 16}
            ),
        )
        chapters = copymanga_parser.get_chapters("test")
        assert chapters == []
        # 密钥应被清除
        assert copymanga_parser._aes_key_cache.get() is None
```

- [ ] **Step 3: Run the tests**

Run: `python -m pytest tests/test_copymanga_parser.py::TestCopyMangaChapters -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/json/copymanga_chapters_response.json tests/test_copymanga_parser.py
git commit -m "test(copymanga): add chapters and detail tests"
```

---

### Task 7: Test `get_chapter_images`

**Files:**
- Create: `tests/fixtures/html/copymanga_chapter_page.html`
- Modify: `tests/test_copymanga_parser.py`

- [ ] **Step 1: Create chapter page HTML fixture**

Create `tests/fixtures/html/copymanga_chapter_page.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Chapter 1</title></head>
<body>
<div id="chapter-reader">loading...</div>
<script>
var contentKey = "REPLACE_WITH_ENCRYPTED";
</script>
</body>
</html>
```

- [ ] **Step 2: Write tests for get_chapter_images**

Append to `tests/test_copymanga_parser.py`:

```python
class TestCopyMangaChapterImages:
    """测试章节图片 URL 提取。"""

    def test_get_chapter_images_decrypts_urls(
        self, copymanga_parser, monkeypatch
    ):
        aes_key = "test_aes_key_1234"
        iv = "abcdef0123456789"
        image_payload = [
            {"url": "https://img.example.com/p1.jpg"},
            {"url": "https://img.example.com/p2.jpg"},
        ]
        encrypted_images = TestCopyMangaChapters._encrypt_payload(
            image_payload, aes_key, iv
        )
        copymanga_parser._aes_key_cache.set(aes_key)

        def fake_get(url, **kwargs):
            # If API call (returns json), return encrypted
            # If HTML page, return page with contentKey
            if "comicdetail" in url or "api" in url:
                return _make_json_response({"code": 200, "results": "encrypted"})
            # Chapter HTML page
            html = (
                '<html><body><script>'
                f'var contentKey = "{encrypted_images}";'
                '</script></body></html>'
            )
            resp = _requests.Response()
            resp.status_code = 200
            resp._content = html.encode("utf-8")
            resp.encoding = "utf-8"
            return resp

        monkeypatch.setattr(copymanga_parser.session, "get", fake_get)

        images = copymanga_parser.get_chapter_images("onepunchman", "ch001")

        assert len(images) == 2
        assert images[0] == "https://img.example.com/p1.jpg"
        assert images[1] == "https://img.example.com/p2.jpg"

    def test_get_chapter_images_error_returns_empty(
        self, copymanga_parser, monkeypatch
    ):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        assert copymanga_parser.get_chapter_images("test", "ch1") == []

    def test_get_chapter_images_no_content_key_returns_empty(
        self, copymanga_parser, monkeypatch
    ):
        copymanga_parser._aes_key_cache.set("test_aes_key_1234")

        def fake_get(url, **kwargs):
            resp = _requests.Response()
            resp.status_code = 200
            resp._content = b'<html><body><p>no script</p></body></html>'
            resp.encoding = "utf-8"
            return resp

        monkeypatch.setattr(copymanga_parser.session, "get", fake_get)

        images = copymanga_parser.get_chapter_images("test", "ch1")
        assert images == []
```

- [ ] **Step 3: Run the tests**

Run: `python -m pytest tests/test_copymanga_parser.py::TestCopyMangaChapterImages -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/html/copymanga_chapter_page.html tests/test_copymanga_parser.py
git commit -m "test(copymanga): add chapter images tests"
```

---

### Task 8: Register CopyManga in `MultiSourceParser`

**Files:**
- Modify: `sources/__init__.py`
- Modify: `utils.py` (add `"copymanga"` default auth entry in `normalize_source_auth`)

- [ ] **Step 1: Write failing test for source registration**

Create `tests/test_copymanga_source_registration.py`:

```python
"""测试 CopyManga 来源在 MultiSourceParser 中的注册。"""

from sources import MultiSourceParser


class TestCopyMangaRegistration:
    """测试 CopyManga 来源注册。"""

    def test_copymanga_in_source_options(self):
        parser = MultiSourceParser()
        options = parser.get_source_options()
        source_ids = [opt[0] for opt in options]
        assert "copymanga" in source_ids

    def test_copymanga_parser_registered(self):
        parser = MultiSourceParser()
        assert "copymanga" in parser.parsers

    def test_copymanga_session_available(self):
        parser = MultiSourceParser()
        sessions = parser.get_sessions()
        assert len(sessions) >= 5  # hcomic + moeimg + jmcomic + bika + copymanga

    def test_set_source_copymanga(self):
        parser = MultiSourceParser()
        parser.set_source("copymanga")
        assert parser.current_source == "copymanga"

    def test_search_dispatches_to_copymanga(self):
        parser = MultiSourceParser(default_source="copymanga")
        assert parser.current_source == "copymanga"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_copymanga_source_registration.py -v`
Expected: FAIL — `assert "copymanga" in source_ids`

- [ ] **Step 3: Register copymanga in `sources/__init__.py`**

Add import at top of `sources/__init__.py`:

```python
from sources.copymanga.parser import CopyMangaParser
```

Add `"copymanga"` to `_VALID_SOURCES`:

```python
_VALID_SOURCES = ("hcomic", "jmcomic", "moeimg", "bika", "copymanga")
```

Add entry to `SOURCE_OPTIONS`:

```python
SOURCE_OPTIONS = (
    ("hcomic", "h-comic"),
    ("moeimg", "moeimg.fan"),
    ("jmcomic", "jmcomic"),
    ("bika", "哔咔"),
    ("copymanga", "拷贝漫画"),
)
```

Add to `self.parsers` dict in `__init__`:

```python
"copymanga": CopyMangaParser(timeout=timeout),
```

Add to `get_sessions()`:

```python
def get_sessions(self) -> list[requests.Session]:
    return [
        self.parsers["hcomic"].session,
        self.parsers["moeimg"].session,
        self.parsers["jmcomic"].session,
        self.parsers["bika"].session,
        self.parsers["copymanga"].session,
    ]
```

Add `prepare_for_download` branch for copymanga. In `prepare_for_download`, add before the final `return detail or comic` line:

```python
if source == "copymanga":
    detail = parser.get_comic_detail(comic.id)
    if detail is None:
        return comic
    if detail.chapters and len(detail.chapters) > 1:
        return detail
    chapter_id = detail.chapters[0].id if detail.chapters else ""
    if chapter_id:
        detail.image_urls = parser.get_chapter_images(comic.id, chapter_id)
        detail.pages = len(detail.image_urls)
    return detail
```

- [ ] **Step 4: Add `"copymanga"` default auth in `utils.py` `normalize_source_auth`**

In the `normalize_source_auth` function, add this entry to the `normalized` dict:

```python
"copymanga": {"cookie": "", "user_agent": "", "bearer_token": ""},
```

- [ ] **Step 5: Run the tests**

Run: `python -m pytest tests/test_copymanga_source_registration.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add sources/__init__.py utils.py tests/test_copymanga_source_registration.py
git commit -m "feat(copymanga): register in MultiSourceParser and normalize_source_auth"
```

---

### Task 9: Update IPC search mixin

**Files:**
- Modify: `python/ipc/search_mixin.py`

- [ ] **Step 1: Update `_VALID_SOURCES` in search_mixin.py**

In `python/ipc/search_mixin.py`, update both occurrences of `_VALID_SOURCES`:

```python
_VALID_SOURCES = ("hcomic", "jmcomic", "moeimg", "bika", "copymanga")
```

- [ ] **Step 2: Add copymanga branch to `handle_get_chapter_preview_urls`**

In the `handle_get_chapter_preview_urls` method, add a copymanga branch after the bika branch. Find the existing `if site == "bika":` block and add after it:

```python
if site == "copymanga":
    cm_parser = self.parser.parsers.get("copymanga")
    if cm_parser is None:
        raise ValueError("copymanga source unavailable")
    comic_id = album_id or chapter_id
    image_urls = cm_parser.get_chapter_images(comic_id, chapter_id)
    return {
        "imageUrls": image_urls,
        "totalPages": len(image_urls),
        "comicId": chapter_id,
    }
```

- [ ] **Step 3: Run existing IPC tests to verify no regressions**

Run: `python -m pytest tests/test_ipc_preview.py tests/test_ipc_download_chapters.py -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add python/ipc/search_mixin.py
git commit -m "feat(copymanga): add to IPC search mixin valid sources and chapter preview"
```

---

### Task 10: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS (including existing tests — no regressions)

- [ ] **Step 2: Verify import chain works**

Run: `python -c "from sources import MultiSourceParser; p = MultiSourceParser(); print(p.get_source_options())"`
Expected: `(('hcomic', 'h-comic'), ('moeimg', 'moeimg.fan'), ('jmcomic', 'jmcomic'), ('bika', '哔咔'), ('copymanga', '拷贝漫画'))`

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(copymanga): test fixes from full suite run"
```
