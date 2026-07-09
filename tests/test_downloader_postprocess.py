"""JM 下载反混淆后处理（ComicDownloader._maybe_postprocess_images）测试。

验证后处理从每页原始图片 URL 解析反混淆参数（eps_id 与 5 位 page_num），
与预览路径（PreviewMixin._apply_descramble）行为一致，而非用章节 id 或
3 位填充的文件名 stem。
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from downloader import ComicDownloader
from image_formats import DEFAULT_IMAGE_EXT, PAGE_FILENAME_FORMAT
from models import ComicInfo


def _make_test_image(width: int = 100, height: int = 200) -> bytes:
    """创建测试用 PNG 图片。"""
    img = Image.new("RGB", (width, height), color="red")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _scramble_image(image_bytes: bytes, eps_id: int, page_num: str) -> bytes:
    """混淆图片（反混淆的逆操作），用于制造真实混淆输入。"""
    from sources.jm.descrambler import _compute_num

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
        des_img.paste(src_img.crop((0, y_src, width, y_src + move)), (0, y_dst, width, y_dst + move))
    src_img.close()
    buf = BytesIO()
    des_img.save(buf, format=save_format, **save_params)
    return buf.getvalue()


def _write_page(temp_dir: Path, page_no: int) -> Path:
    """在临时目录写入一页占位图片，返回文件路径。文件名为 3 位填充格式。"""
    name = PAGE_FILENAME_FORMAT.format(page=page_no, ext=DEFAULT_IMAGE_EXT)
    p = temp_dir / name
    p.write_bytes(_make_test_image())
    return p


def test_postprocess_resolves_eps_id_and_page_num_from_image_url(tmp_path, monkeypatch):
    """后处理必须从原始图片 URL 提取 eps_id 与 5 位 page_num，而非 comic.id 或文件名 stem。"""
    # eps_id=421926 在 URL 路径里；comic.id 传一个不同的值以暴露"用错 id"的回归。
    url = "https://cdn.test.one/media/photos/421926/00001.webp"
    comic = ComicInfo(
        id="999001",
        title="t",
        source_site="jm",
        comic_source="JM",
        scramble_id="1",
        image_urls=[url],
    )
    _write_page(tmp_path, 1)

    captured: dict = {}

    def fake_descramble(image_bytes, eps_id, page_num="", *, image_url=""):
        captured["eps_id"] = eps_id
        captured["page_num"] = page_num
        captured["image_url"] = image_url
        return image_bytes

    monkeypatch.setattr("sources.jm.descrambler.descramble_image", fake_descramble)
    monkeypatch.setattr("sources.jm.descrambler._resolve_eps_id", lambda u, c="": 421926 if "421926" in u else 0)

    ComicDownloader._maybe_postprocess_images(comic, tmp_path)

    assert captured["eps_id"] == 421926, "eps_id 必须取自 URL 路径而非 comic.id"
    assert captured["image_url"] == url, "必须把原始 URL 透传给 descrambler 以提取 5 位 page_num"
    # page_num 留空 → descrambler 内部从 image_url 提取 "00001"（5 位），
    # 而非文件名 stem "001"（3 位）。这里 fake 未执行提取，断言 page_num 为空
    # 即可证明调用方没有错误地传入 stem。
    assert captured["page_num"] == "", "调用方不应自行传入文件名 stem，应交由 descrambler 从 URL 提取"


def test_postprocess_skips_file_when_image_urls_out_of_range(tmp_path, monkeypatch, caplog):
    """image_urls 长度与文件数不匹配时跳过越界文件并告警，不抛异常。"""
    comic = ComicInfo(
        id="421926",
        title="t",
        source_site="jm",
        comic_source="JM",
        scramble_id="1",
        image_urls=["https://cdn.test.one/media/photos/421926/00001.webp"],  # 只有 1 个 URL
    )
    _write_page(tmp_path, 1)
    _write_page(tmp_path, 2)  # 第 2 页无对应 URL → 越界

    called: list[int] = []

    def fake_descramble(image_bytes, eps_id, page_num="", *, image_url=""):
        called.append(eps_id)
        return image_bytes

    monkeypatch.setattr("sources.jm.descrambler.descramble_image", fake_descramble)

    # 不得抛异常
    ComicDownloader._maybe_postprocess_images(comic, tmp_path)

    # 只有第 1 页被处理（第 2 页越界跳过）
    assert len(called) == 1
    assert any("out of image_urls range" in r.getMessage() for r in caplog.records), "越界文件应记录告警"


@pytest.mark.parametrize(
    "comic_kwargs",
    [
        {"source_site": "hcomic", "comic_source": "MMCG_SHORT", "scramble_id": "1"},
        {"source_site": "jm", "comic_source": "JM", "scramble_id": ""},
    ],
    ids=["non-jm-source", "jm-without-scramble-id"],
)
def test_postprocess_skips_when_not_jm_or_no_scramble_id(tmp_path, monkeypatch, comic_kwargs):
    """非 JM 来源或无 scramble_id 时不应执行任何反混淆。"""
    comic = ComicInfo(
        id="421926", title="t", image_urls=["https://cdn.test.one/media/photos/421926/00001.webp"], **comic_kwargs
    )
    _write_page(tmp_path, 1)

    called: list[bool] = []
    monkeypatch.setattr(
        "sources.jm.descrambler.descramble_image",
        lambda *a, **k: called.append(True) or a[0],
    )

    ComicDownloader._maybe_postprocess_images(comic, tmp_path)
    assert called == [], "非 JM 或无 scramble_id 时不得调用 descramble_image"


def test_postprocess_output_matches_preview_path(tmp_path, monkeypatch):
    """同一页经下载后处理与预览路径 _apply_descramble 反混淆后产出字节一致。"""
    eps_id = 500000
    page_num = "00001"
    url = f"https://cdn.test.one/media/photos/{eps_id}/{page_num}.webp"
    original = _make_test_image(120, 240)
    scrambled = _scramble_image(original, eps_id, page_num)

    # 下载路径：写一页混淆图片到临时目录
    page_path = tmp_path / PAGE_FILENAME_FORMAT.format(page=1, ext=DEFAULT_IMAGE_EXT)
    page_path.write_bytes(scrambled)
    comic = ComicInfo(id=str(eps_id), title="t", source_site="jm", comic_source="JM", scramble_id="1", image_urls=[url])

    # 用真实的 descramble_image（不 mock），验证下载后处理产出
    ComicDownloader._maybe_postprocess_images(comic, tmp_path)
    download_result = page_path.read_bytes()

    # 预览路径：构造一个最小 PreviewMixin 实例调用 _apply_descramble
    from python.ipc.preview_mixin import PreviewMixin

    class _Stub(PreviewMixin):
        pass

    preview_result = _Stub._apply_descramble(_Stub(), scrambled, url, str(eps_id))

    # 两条路径产出必须一致，且都能还原为原始图片（可被 PIL 解码）
    assert download_result == preview_result, "下载与预览反混淆产出必须一致"
    Image.open(BytesIO(download_result)).verify()
    Image.open(BytesIO(preview_result)).verify()
