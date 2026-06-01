"""测试 cbz_builder.py CBZ 打包功能"""

import os
import zipfile
from pathlib import Path

import pytest

from cbz_builder import CBZBuilder
from models import ComicInfo


class TestCBZBuilder:
    @pytest.fixture
    def sample_comic(self):
        return ComicInfo(
            id="123",
            title="测试漫画Title",
            author="测试作者Author",
            pages=3,
            category="漫画分类",
            tags=["标签1", "标签2", "标签3"],
            publish_date="2024-01-15",
        )

    @pytest.fixture
    def sample_images(self, tmp_path):
        # 创建最小的 JPEG 文件（1x1 像素）
        minimal_jpeg = (
            b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00C\x00\x03\x02\x02\x03\x02\x02\x03\x03\x03\x03\x04\x03\x03"
            b"\x04\x05\x08\x05\x05\x04\x04\x05\n\x07\x07\x06\x08\x0c\n\x0c\x0c\x0b"
            b"\n\x0b\x0b\r\x0e\x12\x10\r\x0e\x11\x0e\x0b\x0b\x10\x16\x10\x11\x13\x14"
            b"\x15\x15\x15\x0c\x0f\x17\x18\x16\x14\x18\x12\x14\x15\x14\xff\xc0\x00"
            b"\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x14\x00\x01\x00"
            b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\n\xff\xc4\x00"
            b"\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
            b"\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00T\x9f\xff\xd9"
        )
        img_dir = tmp_path / "test_images"
        img_dir.mkdir()
        for i in range(1, 4):
            img_path = img_dir / f"{i:03d}.jpg"
            img_path.write_bytes(minimal_jpeg)
        return str(img_dir)

    def test_build_cbz_creates_valid_zip(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        output_path = tmp_path / "output.cbz"
        result = builder.build_cbz(
            sample_images, sample_comic, str(output_path), download_dir=str(tmp_path)
        )
        assert Path(result).exists()
        assert result == str(output_path)
        with zipfile.ZipFile(result, "r") as zf:
            namelist = zf.namelist()
            assert "ComicInfo.xml" in namelist
            assert len([n for n in namelist if n.endswith(".jpg")]) == 3

    def test_comic_info_xml_content(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(
            sample_images, sample_comic, str(output_path), download_dir=str(tmp_path)
        )
        with zipfile.ZipFile(output_path, "r") as zf:
            xml_content = zf.read("ComicInfo.xml").decode("utf-8")
        assert "<Title>测试漫画Title</Title>" in xml_content
        assert "<Series>测试漫画Title</Series>" in xml_content
        assert "<Writer>测试作者Author</Writer>" in xml_content
        assert "<Genre>漫画分类</Genre>" in xml_content
        assert "<Tags>标签1, 标签2, 标签3</Tags>" in xml_content
        assert "<PageCount>3</PageCount>" in xml_content
        assert "<Year>2024</Year>" in xml_content
        assert "<Month>01</Month>" in xml_content
        assert "<Day>15</Day>" in xml_content
        assert "<Number>1</Number>" in xml_content

    def test_cbz_image_naming(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(
            sample_images, sample_comic, str(output_path), download_dir=str(tmp_path)
        )
        with zipfile.ZipFile(output_path, "r") as zf:
            namelist = zf.namelist()
        assert "001.jpg" in namelist
        assert "002.jpg" in namelist
        assert "003.jpg" in namelist

    def test_build_cbz_with_custom_output_path(
        self, sample_comic, sample_images, tmp_path
    ):
        builder = CBZBuilder()
        custom_path = tmp_path / "custom" / "subdir" / "comic.cbz"
        result = builder.build_cbz(
            sample_images, sample_comic, str(custom_path), download_dir=str(tmp_path)
        )
        assert Path(result).exists()

    def test_collect_image_files(self, tmp_path):
        img_dir = tmp_path / "images"
        img_dir.mkdir()
        sample_bytes = b"image-data"
        (img_dir / "001.jpg").write_bytes(sample_bytes)
        (img_dir / "002.png").write_bytes(sample_bytes)
        (img_dir / "003.webp").write_bytes(b"webp")
        (img_dir / "004.ico").write_bytes(b"ico")
        (img_dir / "005.jpeg").write_bytes(sample_bytes)
        (img_dir / "readme.txt").write_text("not an image")
        (img_dir / ".hidden").write_text("hidden file")
        builder = CBZBuilder()
        files = builder._collect_image_files(str(img_dir))
        assert len(files) == 5
        assert files[0].endswith("001.jpg")
        assert files[1].endswith("002.png")
        assert files[2].endswith("003.webp")
        assert files[3].endswith("004.ico")
        assert files[4].endswith("005.jpeg")

    def test_build_cbz_with_mixed_supported_extensions(self, sample_comic, tmp_path):
        builder = CBZBuilder()
        img_dir = tmp_path / "mixed_images"
        img_dir.mkdir()
        (img_dir / "001.jpg").write_bytes(b"jpg")
        (img_dir / "002.png").write_bytes(b"png")
        (img_dir / "003.webp").write_bytes(b"webp")
        (img_dir / "004.ico").write_bytes(b"ico")
        output_path = tmp_path / "mixed.cbz"

        result = builder.build_cbz(
            str(img_dir), sample_comic, str(output_path), download_dir=str(tmp_path)
        )

        assert Path(result).exists()
        with zipfile.ZipFile(result, "r") as zf:
            namelist = zf.namelist()
            assert "ComicInfo.xml" in namelist
            assert "001.jpg" in namelist
            assert "002.png" in namelist
            assert "003.webp" in namelist
            assert "004.ico" in namelist

    def test_parse_date(self):
        builder = CBZBuilder()
        assert builder._parse_date("2024-01-15") == ("2024", "01", "15")
        assert builder._parse_date("2024-01") == ("2024", "01", "")
        assert builder._parse_date("2024") == ("2024", "", "")
        # For single word inputs without dashes, returns the word as year
        assert builder._parse_date("invalid") == ("invalid", "", "")

    def test_comic_info_xml_with_preview_url(
        self, sample_comic, sample_images, tmp_path
    ):
        builder = CBZBuilder()
        sample_comic.preview_url = "https://h-comic.com/comic/123"
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(
            sample_images, sample_comic, str(output_path), download_dir=str(tmp_path)
        )
        with zipfile.ZipFile(output_path, "r") as zf:
            xml_content = zf.read("ComicInfo.xml").decode("utf-8")
        assert "<Web>https://h-comic.com/comic/123</Web>" in xml_content

    def test_comic_info_xml_with_minimal_fields(self, sample_images, tmp_path):
        """测试 ComicInfo.xml 只包含非空字段"""
        builder = CBZBuilder()
        minimal_comic = ComicInfo(
            id="456",
            title="极简漫画",
            author="",
            pages=0,
            category="",
            tags=[],
            publish_date="",
        )
        output_path = tmp_path / "minimal.cbz"
        builder.build_cbz(
            sample_images, minimal_comic, str(output_path), download_dir=str(tmp_path)
        )
        with zipfile.ZipFile(output_path, "r") as zf:
            xml_content = zf.read("ComicInfo.xml").decode("utf-8")
        assert "<Title>极简漫画</Title>" in xml_content
        assert "<Number>1</Number>" in xml_content
        # 空字段不应出现在 XML 中
        assert "<Writer>" not in xml_content
        assert "<Genre>" not in xml_content
        assert "<PageCount>" not in xml_content
        assert "<Year>" not in xml_content

    def test_build_cbz_no_images_raises_error(self, tmp_path, sample_comic):
        """测试空图片目录抛出 ValueError"""
        builder = CBZBuilder()
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        with pytest.raises(ValueError, match="No images found"):
            builder.build_cbz(
                str(empty_dir),
                sample_comic,
                str(tmp_path / "test.cbz"),
                download_dir=str(tmp_path),
            )

    def test_build_cbz_simple(self, sample_images, tmp_path):
        """测试 build_cbz_simple 函数"""
        from cbz_builder import build_cbz_simple

        output_path = tmp_path / "simple.cbz"
        result = build_cbz_simple(sample_images, str(output_path))
        assert Path(result).exists()
        with zipfile.ZipFile(result, "r") as zf:
            namelist = zf.namelist()
            # 没有 comic_info 时不应包含 ComicInfo.xml
            assert "ComicInfo.xml" not in namelist
            assert len([n for n in namelist if n.endswith(".jpg")]) == 3

    def test_build_cbz_simple_with_comic_info(
        self, sample_comic, sample_images, tmp_path
    ):
        """测试 build_cbz_simple 函数带 comic_info"""
        from cbz_builder import build_cbz_simple

        output_path = tmp_path / "with_info.cbz"
        result = build_cbz_simple(sample_images, str(output_path), sample_comic)
        assert Path(result).exists()
        with zipfile.ZipFile(result, "r") as zf:
            namelist = zf.namelist()
            # 有 comic_info 时应包含 ComicInfo.xml
            assert "ComicInfo.xml" in namelist
            assert len([n for n in namelist if n.endswith(".jpg")]) == 3


class TestGetOutputPath:
    """测试 get_output_path 方法"""

    @pytest.fixture
    def builder(self):
        return CBZBuilder()

    @pytest.fixture
    def sample_comic(self):
        return ComicInfo(
            id="123",
            title="测试漫画",
            author="测试作者",
            pages=10,
        )

    def test_get_output_path_returns_expected_format(self, builder, sample_comic):
        """测试返回正确格式的路径"""
        path = builder.get_output_path(sample_comic)
        assert path.endswith(".cbz")
        assert "测试作者-测试漫画" in path

    def test_get_output_path_does_not_create_file(self, sample_comic, tmp_path):
        """测试不会创建文件"""
        # 使用临时目录作为下载目录
        from config import Config

        # 创建使用临时目录的配置
        test_config = Config(download_dir=str(tmp_path))
        builder_with_config = CBZBuilder(config=test_config)

        path = builder_with_config.get_output_path(sample_comic)
        import os

        assert not os.path.exists(path)

    def test_get_output_path_with_special_characters(self, builder):
        """测试特殊字符被正确处理"""
        comic = ComicInfo(
            id="456",
            title="漫画/测试:标题",
            author="作者<测试>",
            pages=5,
        )
        path = builder.get_output_path(comic)
        # 特殊字符应被 sanitize_filename 处理
        assert "/" not in os.path.basename(path)
        assert ":" not in os.path.basename(path)
        assert "<" not in os.path.basename(path)
        assert ">" not in os.path.basename(path)
