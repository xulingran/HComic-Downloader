"""jmcomic 图片反混淆模块。

禁漫天堂的图片会根据漫画 ID 和页码进行分块打乱。
本模块实现逆变换算法，将打乱的图片还原为正确排列。
"""

from __future__ import annotations

import hashlib
import re
from io import BytesIO

from PIL import Image


def _compute_num(eps_id: int, page_num: str) -> int:
    """计算图片分块数量。返回 0 表示无需反混淆。

    Args:
        eps_id: 漫画/章节 ID
        page_num: 页码字符串（如 "00001"），从图片 URL 中提取
    """
    if eps_id < 220980:
        return 0
    if eps_id < 268850:
        return 10
    string = f"{eps_id}{page_num}".encode()
    digest = hashlib.md5(string).hexdigest()
    ret = ord(digest[-1])
    if eps_id > 421926:
        return (ret % 8) * 2 + 2
    return (ret % 10) * 2 + 2


def _extract_page_num(image_url: str) -> str:
    """从 jmcomic 图片 URL 中提取页码。

    URL 格式: https://cdn.xxx/media/photos/{album_id}/{page_num}.{ext}
    例如: https://cdn.xxx/media/photos/12345/00001.webp → "00001"
    """
    m = re.search(r"/(\d+)\.\w+$", image_url)
    return m.group(1) if m else "0"


def _extract_eps_id(image_url: str) -> int:
    """从 jmcomic 图片 URL 路径提取章节(photo) id。

    URL 格式: https://cdn.xxx/media/photos/{eps_id}/{page_num}.{ext}
    多章节专辑每章有独立 eps_id；这是反混淆所需的正确 id（而非专辑 id）。
    无法提取时返回 0（调用方据此跳过反混淆或回退）。
    """
    m = re.search(r"/media/photos/(\d+)/", image_url)
    return int(m.group(1)) if m else 0


def _get_image_format(img: Image.Image, original_bytes: bytes) -> tuple[str, dict]:
    """检测图片格式并返回适合保存的格式和参数。

    优先保留原始格式（webp），对于不支持的格式回退到 PNG。
    """
    fmt = getattr(img, "format", None)
    if fmt == "WEBP":
        return "WEBP", {"quality": 90}
    if fmt == "JPEG":
        return "JPEG", {"quality": 95}
    if fmt == "PNG":
        return "PNG", {}
    # 尝试从原始字节检测
    if original_bytes[:4] == b"RIFF" and original_bytes[8:12] == b"WEBP":
        return "WEBP", {"quality": 90}
    if original_bytes[:2] == b"\xff\xd8":
        return "JPEG", {"quality": 95}
    if original_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG", {}
    # 默认 PNG
    return "PNG", {}


def descramble_image(
    image_bytes: bytes,
    eps_id: int,
    page_num: str = "",
    *,
    image_url: str = "",
) -> bytes:
    """对 jmcomic 图片进行反混淆。

    Args:
        image_bytes: 原始图片数据
        eps_id: 漫画 ID
        page_num: 页码字符串（如 "00001"）。如未提供则从 image_url 提取。
        image_url: 图片 URL，用于自动提取页码（当 page_num 为空时）

    Returns:
        处理后的图片 bytes。如果无需反混淆，返回原始 bytes。
    """
    if not page_num:
        page_num = _extract_page_num(image_url) if image_url else "0"

    num = _compute_num(eps_id, page_num)
    if num == 0:
        return image_bytes

    with Image.open(BytesIO(image_bytes)) as src_img:
        width, height = src_img.size

        # 检测原始格式
        save_format, save_params = _get_image_format(src_img, image_bytes)

        # 对于 WEBP 格式，需要转换为 RGB 模式以确保兼容性
        if save_format == "WEBP" and src_img.mode not in ("RGB", "RGBA"):
            src_img = src_img.convert("RGB")

        des_img = Image.new(src_img.mode, (width, height))

        over = height % num
        base = height // num

        for i in range(num):
            move = base
            y_src = height - (move * (i + 1)) - over
            y_dst = move * i

            if i == 0:
                move += over
            else:
                y_dst += over

            des_img.paste(
                src_img.crop((0, y_src, width, y_src + move)),
                (0, y_dst, width, y_dst + move),
            )

    buf = BytesIO()
    des_img.save(buf, format=save_format, **save_params)
    return buf.getvalue()
