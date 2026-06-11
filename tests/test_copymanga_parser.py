"""CopyManga 解析器单元测试。"""

import json as _json

import pytest
import requests as _requests

from sources.base import ParserResponseError
from sources.copymanga.crypto import AesKeyCache, decrypt_aes_cbc, extract_aes_key

# ---------------------------------------------------------------------------
# 辅助工具
# ---------------------------------------------------------------------------


def _make_json_response(payload: dict, status_code: int = 200) -> _requests.Response:
    """构建带有 JSON payload 的 requests.Response。"""
    resp = _requests.Response()
    resp.status_code = status_code
    resp._content = _json.dumps(payload).encode("utf-8")
    resp.headers["Content-Type"] = "application/json"
    return resp


def _encrypt_payload(plaintext_dict: dict, aes_key: str, iv: str) -> str:
    """辅助：加密 JSON 字典，返回 iv + cipher_hex。"""
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
    enc = cipher.encryptor()
    ct = enc.update(padded) + enc.finalize()
    return iv + ct.hex()


# ---------------------------------------------------------------------------
# AES 密钥提取测试
# ---------------------------------------------------------------------------


class TestExtractAesKey:
    """测试从 HTML 页面提取 AES 密钥。"""

    def test_extracts_key_from_script_tag(self, html_sample):
        html = html_sample("copymanga_aes_key_page.html")
        key = extract_aes_key(html)
        assert key == "0123456789abcdef"

    def test_raises_on_missing_key(self):
        with pytest.raises(ValueError, match="aes key script not found"):
            extract_aes_key("<html><body><p>no scripts</p></body></html>")

    def test_raises_on_empty_html(self):
        with pytest.raises(ValueError, match="aes key script not found"):
            extract_aes_key("")


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


class TestDecryptAesCbc:
    """测试 AES-CBC 解密 roundtrip。"""

    def test_roundtrip_decrypt(self):
        key = "0123456789abcdef"
        iv = "abcdef0123456789"
        payload = {"name": "test", "id": 42, "items": [1, 2, 3]}
        encrypted = _encrypt_payload(payload, key, iv)
        result = decrypt_aes_cbc(encrypted, key)
        assert result == payload

    def test_decrypt_empty_dict(self):
        key = "aaaaaaaaaaaaaaaa"
        iv = "bbbbbbbbbbbbbbbb"
        encrypted = _encrypt_payload({}, key, iv)
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
        encrypted = _encrypt_payload({"hello": "world"}, key, iv)
        with pytest.raises(Exception):
            decrypt_aes_cbc(encrypted, wrong_key)


# ---------------------------------------------------------------------------
# 搜索测试
# ---------------------------------------------------------------------------


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
        assert c1.album_total_chapters == 243  # 从 "第243话" 解析

        assert pagination is not None
        assert pagination.total_items == 2
        assert pagination.current_page == 1

    def test_search_offset_calculation(self, copymanga_parser, monkeypatch):
        captured = {}

        def fake_get(url, **kwargs):
            captured["url"] = url
            return _make_json_response(
                {
                    "code": 200,
                    "results": {"list": [], "total": 0, "limit": 30, "offset": 30},
                }
            )

        monkeypatch.setattr(copymanga_parser.session, "get", fake_get)

        copymanga_parser.search("test", page=2)
        assert "offset=30" in captured["url"]

    def test_search_empty_result(self, copymanga_parser, monkeypatch):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: _make_json_response(
                {
                    "code": 200,
                    "results": {"list": [], "total": 0, "limit": 30, "offset": 0},
                }
            ),
        )
        comics, pagination = copymanga_parser.search("不存在")
        assert comics == []
        assert pagination is not None
        assert pagination.total_items == 0

    def test_search_no_last_chapter_defaults_to_1(self, copymanga_parser, monkeypatch):
        """没有 last_chapter_name 时默认 album_total_chapters=1。"""
        payload = {
            "code": 200,
            "results": {
                "list": [
                    {
                        "path_word": "new-comic",
                        "name": "新漫画",
                        "author": [],
                        "cover": "",
                    }
                ],
                "total": 1,
            },
        }
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: _make_json_response(payload),
        )
        comics, _ = copymanga_parser.search("新漫画")
        assert len(comics) == 1
        assert comics[0].album_total_chapters == 1

    def test_search_network_error_returns_empty(self, copymanga_parser, monkeypatch):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        with pytest.raises(ParserResponseError, match="请求超时"):
            copymanga_parser.search("test")


# ---------------------------------------------------------------------------
# 章节列表与漫画详情测试
# ---------------------------------------------------------------------------


class TestCopyMangaChapters:
    """测试漫画详情和章节列表。"""

    def test_get_chapters_decrypts_and_parses(self, copymanga_parser, monkeypatch, json_fixture):
        aes_key = "0123456789abcdef"
        iv = "0123456789abcdef"
        chapters_data = json_fixture("copymanga_chapters_response.json")
        encrypted = _encrypt_payload(chapters_data, aes_key, iv)

        # 预设 AES key，跳过页面提取
        copymanga_parser._aes_key_cache.set(aes_key)

        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda url, **kw: _make_json_response({"code": 200, "results": encrypted}),
        )

        chapters = copymanga_parser.get_chapters("onepunchman")

        assert len(chapters) == 3
        assert chapters[0].id == "ch001"
        assert chapters[0].name == "第1话"
        assert chapters[0].index == 1
        assert chapters[2].index == 3

    def test_get_comic_detail_returns_comic_with_chapters(self, copymanga_parser, monkeypatch, json_fixture):
        aes_key = "0123456789abcdef"
        iv = "0123456789abcdef"
        chapters_data = json_fixture("copymanga_chapters_response.json")
        encrypted = _encrypt_payload(chapters_data, aes_key, iv)

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

    def test_get_comic_detail_error_returns_none(self, copymanga_parser, monkeypatch):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        assert copymanga_parser.get_comic_detail("bad") is None

    def test_get_chapters_error_returns_empty(self, copymanga_parser, monkeypatch):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        assert copymanga_parser.get_chapters("bad") == []

    def test_decrypt_failure_clears_aes_key(self, copymanga_parser, monkeypatch):
        copymanga_parser._aes_key_cache.set("wrong_key")
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda url, **kw: _make_json_response({"code": 200, "results": "0123456789abcdef" + "ff" * 16}),
        )
        chapters = copymanga_parser.get_chapters("test")
        assert chapters == []
        # 密钥应被清除
        assert copymanga_parser._aes_key_cache.get() is None


# ---------------------------------------------------------------------------
# 章节图片测试
# ---------------------------------------------------------------------------


class TestCopyMangaChapterImages:
    """测试章节图片 URL 提取。"""

    def test_get_chapter_images_decrypts_urls(self, copymanga_parser, monkeypatch):
        aes_key = "0123456789abcdef"
        iv = "abcdef0123456789"
        image_payload = [
            {"url": "https://img.example.com/p1.jpg"},
            {"url": "https://img.example.com/p2.jpg"},
        ]
        encrypted_images = _encrypt_payload(image_payload, aes_key, iv)
        copymanga_parser._aes_key_cache.set(aes_key)

        def fake_get(url, **kwargs):
            # Chapter HTML page
            html = f'<html><body><script>var contentKey = "{encrypted_images}";</script></body></html>'
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

    def test_get_chapter_images_error_returns_empty(self, copymanga_parser, monkeypatch):
        monkeypatch.setattr(
            copymanga_parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(_requests.Timeout("t")),
        )
        assert copymanga_parser.get_chapter_images("test", "ch1") == []

    def test_get_chapter_images_no_content_key_returns_empty(self, copymanga_parser, monkeypatch):
        copymanga_parser._aes_key_cache.set("test_aes_key_1234")

        def fake_get(url, **kwargs):
            resp = _requests.Response()
            resp.status_code = 200
            resp._content = b"<html><body><p>no script</p></body></html>"
            resp.encoding = "utf-8"
            return resp

        monkeypatch.setattr(copymanga_parser.session, "get", fake_get)

        images = copymanga_parser.get_chapter_images("test", "ch1")
        assert images == []


# ---------------------------------------------------------------------------
# 收藏夹 & 登录状态 stub 测试
# ---------------------------------------------------------------------------


class TestCopyMangaStubMethods:
    """测试拷贝漫画不支持的功能返回安全默认值。"""

    def test_verify_login_status_no_cookie(self, copymanga_parser):
        """未配置 cookie 时返回未登录。"""
        ok, msg = copymanga_parser.verify_login_status()
        assert ok is False
        assert "\u767b\u5f55" in msg

    def test_verify_login_status_with_token_cookie(self, copymanga_parser):
        """配置了 token cookie 时返回已登录。"""
        copymanga_parser.configure_auth(cookie="token=abc123; sessionid=xyz")
        ok, msg = copymanga_parser.verify_login_status()
        assert ok is True

    def test_favourites_returns_empty(self, copymanga_parser):
        comics, pagination, needs_login = copymanga_parser.favourites()
        assert comics == []
        assert pagination is None
        assert needs_login is False

    def test_add_to_favourites_returns_false(self, copymanga_parser):
        assert copymanga_parser.add_to_favourites("any_id") is False

    def test_check_favourite_returns_false(self, copymanga_parser):
        assert copymanga_parser.check_favourite("any_id") is False

    def test_remove_from_favourites_returns_false(self, copymanga_parser):
        assert copymanga_parser.remove_from_favourites("any_id") is False
