"""jmcomic 图片反混淆模块。

禁漫天堂的图片会根据漫画 ID 和 scramble_id 进行分块打乱。
本模块实现逆变换算法，将打乱的图片还原为正确排列。
"""
from __future__ import annotations

import hashlib
import math
from io import BytesIO

from PIL import Image


def _compute_num(eps_id: int, scramble_id: str) -> int:
    """计算图片分块数量。返回 0 表示无需反混淆。"""
    if eps_id < 220980:
        return 0
    if eps_id < 268850:
        return 10
    string = f"{eps_id}{scramble_id}".encode()
    digest = hashlib.md5(string).hexdigest()
    ret = ord(digest[-1])
    if eps_id > 421926:
        return (ret % 8) * 2 + 2
    return (ret % 10) * 2 + 2


def descramble_image(image_bytes: bytes, eps_id: int, scramble_id: str) -> bytes:
    """对 jmcomic 图片进行反混淆。

    Args:
        image_bytes: 原始图片数据
        eps_id: 漫画 ID
        scramble_id: scramble 标识（从图片 URL 中提取）

    Returns:
        处理后的图片 bytes。如果无需反混淆，返回原始 bytes。
    """
    num = _compute_num(eps_id, scramble_id)
    if num == 0:
        return image_bytes

    src_img = Image.open(BytesIO(image_bytes))
    width, height = src_img.size
    des_img = Image.new(src_img.mode, (width, height))

    rem = height % num
    copy_height = math.floor(height / num)

    blocks = []
    total_h = 0
    for i in range(num):
        h = copy_height * (i + 1)
        if i == num - 1:
            h += rem
        blocks.append((total_h, h))
        total_h = h

    h = 0
    for start, end in reversed(blocks):
        co_h = end - start
        temp_img = src_img.crop((0, start, width, end))
        des_img.paste(temp_img, (0, h, width, h + co_h))
        h += co_h

    src_img.close()

    buf = BytesIO()
    des_img.save(buf, format="PNG")
    return buf.getvalue()
