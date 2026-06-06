"""CopyManga 解析器单元测试。"""

import json as _json

import pytest
import requests as _requests

from sources.copymanga.crypto import AesKeyCache, decrypt_aes_cbc, extract_aes_key


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
