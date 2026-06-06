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
    if not html_text or not html_text.strip():
        raise ValueError("kaobei aes key script not found")
    try:
        doc = lxml_html.fromstring(html_text)
    except Exception:
        raise ValueError("kaobei aes key script not found")
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
