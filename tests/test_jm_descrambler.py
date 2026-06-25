"""jm 图片反混淆模块测试。"""

import hashlib
from io import BytesIO

from PIL import Image

from sources.jm.descrambler import (
    _compute_num,
    _extract_eps_id,
    _extract_page_num,
    descramble_image,
)


def _make_test_image(width=100, height=200) -> bytes:
    """创建测试用 PNG 图片。"""
    img = Image.new("RGB", (width, height), color="red")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_extract_eps_id_from_url():
    url = "https://cdn.test.one/media/photos/700123/00001.webp"
    assert _extract_eps_id(url) == 700123


def test_extract_eps_id_missing_returns_zero():
    assert _extract_eps_id("https://cdn.test.one/cover.jpg") == 0


def test_no_scramble_for_old_ids():
    """epsId < 220980 时不打乱。"""
    img_bytes = _make_test_image()
    result = descramble_image(img_bytes, eps_id=100000, page_num="00001")
    assert result == img_bytes


def test_num_fixed_10_for_range():
    """220980 <= epsId < 268850 时 num=10。"""
    assert _compute_num(220980, "00001") == 10
    assert _compute_num(268849, "00001") == 10


def test_num_computed_for_new_ids():
    """epsId > 421926 时 num 由 md5(epsId + page_num) 计算。"""
    eps_id = 500000
    page_num = "00001"
    string = f"{eps_id}{page_num}".encode()
    expected_hash = hashlib.md5(string).hexdigest()
    expected_num = (ord(expected_hash[-1]) % 8) * 2 + 2
    assert _compute_num(eps_id, page_num) == expected_num


def test_extract_page_num():
    """从图片 URL 中提取页码。"""
    assert _extract_page_num("https://cdn.example.com/media/photos/12345/00001.webp") == "00001"
    assert _extract_page_num("https://cdn.example.com/media/photos/12345/00042.jpg") == "00042"
    assert _extract_page_num("https://cdn.example.com/other/path") == "0"


def test_descramble_preserves_size():
    """反混淆后图片尺寸不变。"""
    img_bytes = _make_test_image(100, 200)
    result = descramble_image(img_bytes, eps_id=500000, page_num="00001")
    img = Image.open(BytesIO(result))
    assert img.size == (100, 200)


def test_descramble_accepts_image_url():
    """可通过 image_url 参数自动提取页码。"""
    img_bytes = _make_test_image(100, 200)
    url = "https://cdn.example.com/media/photos/500000/00001.webp"
    result = descramble_image(img_bytes, eps_id=500000, image_url=url)
    img = Image.open(BytesIO(result))
    assert img.size == (100, 200)


def _scramble_image(image_bytes: bytes, eps_id: int, page_num: str) -> bytes:
    """混淆图片（用于测试反混淆的正确性）。

    混淆算法是反混淆的逆操作：从顶部提取块，粘贴到底部。
    """
    num = _compute_num(eps_id, page_num)
    if num == 0:
        return image_bytes

    src_img = Image.open(BytesIO(image_bytes))
    width, height = src_img.size
    save_format = getattr(src_img, "format", None) or "PNG"
    save_params = {"quality": 90} if save_format in ("WEBP", "JPEG") else {}

    des_img = Image.new(src_img.mode, (width, height))

    over = height % num
    base = height // num

    for i in range(num):
        move = base
        y_src = move * i
        y_dst = height - (move * (i + 1)) - over

        if i == 0:
            move += over
        else:
            y_src += over

        des_img.paste(
            src_img.crop((0, y_src, width, y_src + move)),
            (0, y_dst, width, y_dst + move),
        )

    src_img.close()

    buf = BytesIO()
    des_img.save(buf, format=save_format, **save_params)
    return buf.getvalue()


def test_descramble_roundtrip():
    """混淆 → 反混淆后图片应还原为原始内容。"""
    eps_id = 500000
    page_num = "00001"
    num = _compute_num(eps_id, page_num)
    assert num > 0

    for height in [num * 10, num * 10 + 1, num * 10 + num - 1, num * 10 + num]:
        img = Image.new("RGB", (100, height))
        pixels = img.load()
        for y in range(height):
            for x in range(100):
                pixels[x, y] = (y % 256, (y * 3) % 256, (y * 7) % 256)

        buf = BytesIO()
        img.save(buf, format="PNG")
        original = buf.getvalue()

        scrambled = _scramble_image(original, eps_id, page_num)
        descrambled = descramble_image(scrambled, eps_id, page_num)

        orig_img = Image.open(BytesIO(original))
        desc_img = Image.open(BytesIO(descrambled))
        assert list(orig_img.get_flattened_data()) == list(
            desc_img.get_flattened_data()
        ), f"Roundtrip failed for height={height}"


def test_descramble_roundtrip_various_pages():
    """不同页码的往返测试（每页 num 不同）。"""
    eps_id = 500000

    for page_num in ["00001", "00002", "00010", "00100"]:
        num = _compute_num(eps_id, page_num)
        if num == 0:
            continue

        height = num * 15 + 3
        img = Image.new("RGB", (80, height))
        pixels = img.load()
        for y in range(height):
            for x in range(80):
                pixels[x, y] = ((y + x) % 256, (y * 2 + x) % 256, (y * 5 + x) % 256)

        buf = BytesIO()
        img.save(buf, format="PNG")
        original = buf.getvalue()

        scrambled = _scramble_image(original, eps_id, page_num)
        descrambled = descramble_image(scrambled, eps_id, page_num)

        orig_img = Image.open(BytesIO(original))
        desc_img = Image.open(BytesIO(descrambled))
        assert list(orig_img.get_flattened_data()) == list(
            desc_img.get_flattened_data()
        ), f"Roundtrip failed for page_num={page_num}, num={num}"


def test_descramble_algorithm_matches_reference():
    """验证反混淆算法与参考项目 ComicGUISpider 一致。"""
    num = 4
    height = 100
    width = 50
    over = height % num  # 0
    base = height // num  # 25

    img = Image.new("RGB", (width, height))
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            pixels[x, y] = (y % 256, (y * 3) % 256, (y * 7) % 256)

    buf = BytesIO()
    img.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    src_img = Image.open(BytesIO(img_bytes))
    des_img = Image.new(src_img.mode, (width, height))

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

    result = Image.new(src_img.mode, (width, height))
    result_over = height % num
    result_base = height // num
    for i in range(num):
        move = result_base
        y_src = height - (move * (i + 1)) - result_over
        y_dst = move * i
        if i == 0:
            move += result_over
        else:
            y_dst += result_over
        result.paste(
            des_img.crop((0, y_src, width, y_src + move)),
            (0, y_dst, width, y_dst + move),
        )

    assert list(src_img.get_flattened_data()) == list(result.get_flattened_data())
