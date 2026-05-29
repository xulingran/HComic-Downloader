"""jmcomic 图片反混淆模块测试。"""
import hashlib
from io import BytesIO

from PIL import Image

from sources.jmcomic.descrambler import _compute_num, descramble_image


def _make_test_image(width=100, height=200) -> bytes:
    """创建测试用 PNG 图片。"""
    img = Image.new("RGB", (width, height), color="red")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_no_scramble_for_old_ids():
    """epsId < 220980 时不打乱。"""
    img_bytes = _make_test_image()
    result = descramble_image(img_bytes, eps_id=100000, scramble_id="0")
    assert result == img_bytes


def test_num_fixed_10_for_range():
    """220980 <= epsId < 268850 时 num=10。"""
    assert _compute_num(220980, "0") == 10
    assert _compute_num(268849, "0") == 10


def test_num_computed_for_new_ids():
    """epsId > 421926 时 num 由 md5 计算。"""
    eps_id = 500000
    scramble_id = "12345"
    string = f"{eps_id}{scramble_id}".encode()
    expected_hash = hashlib.md5(string).hexdigest()
    expected_num = (ord(expected_hash[-1]) % 8) * 2 + 2
    assert _compute_num(eps_id, scramble_id) == expected_num


def test_descramble_preserves_size():
    """反混淆后图片尺寸不变。"""
    img_bytes = _make_test_image(100, 200)
    result = descramble_image(img_bytes, eps_id=500000, scramble_id="12345")
    img = Image.open(BytesIO(result))
    assert img.size == (100, 200)
