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
            parodies=["原著A"],
            characters=["角色B"],
            groups=["制作组C"],
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
        result = builder.build_cbz(sample_images, sample_comic, str(output_path), download_dir=str(tmp_path))
        assert Path(result).exists()
        assert result == str(output_path)
        with zipfile.ZipFile(result, "r") as zf:
            namelist = zf.namelist()
            assert "ComicInfo.xml" in namelist
            assert len([n for n in namelist if n.endswith(".jpg")]) == 3

    def test_comic_info_xml_content(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(sample_images, sample_comic, str(output_path), download_dir=str(tmp_path))
        with zipfile.ZipFile(output_path, "r") as zf:
            xml_content = zf.read("ComicInfo.xml").decode("utf-8")
        assert "<Title>测试漫画Title</Title>" in xml_content
        assert "<Series>测试漫画Title</Series>" in xml_content
        assert "<Writer>测试作者Author</Writer>" in xml_content
        assert "<Genre>漫画分类</Genre>" in xml_content
        assert "<Tags>标签1, 标签2, 标签3</Tags>" in xml_content
        assert "<Notes>Parodies: 原著A</Notes>" in xml_content
        assert "<Characters>角色B</Characters>" in xml_content
        assert "<Groups>制作组C</Groups>" in xml_content
        assert "<PageCount>3</PageCount>" in xml_content
        assert "<Year>2024</Year>" in xml_content
        assert "<Month>01</Month>" in xml_content
        assert "<Day>15</Day>" in xml_content
        assert "<Number>1</Number>" in xml_content

    def test_cbz_image_naming(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(sample_images, sample_comic, str(output_path), download_dir=str(tmp_path))
        with zipfile.ZipFile(output_path, "r") as zf:
            namelist = zf.namelist()
        assert "001.jpg" in namelist
        assert "002.jpg" in namelist
        assert "003.jpg" in namelist

    def test_build_cbz_with_custom_output_path(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        custom_path = tmp_path / "custom" / "subdir" / "comic.cbz"
        result = builder.build_cbz(sample_images, sample_comic, str(custom_path), download_dir=str(tmp_path))
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

        result = builder.build_cbz(str(img_dir), sample_comic, str(output_path), download_dir=str(tmp_path))

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

    def test_comic_info_xml_with_preview_url(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        sample_comic.preview_url = "https://h-comic.com/comic/123"
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(sample_images, sample_comic, str(output_path), download_dir=str(tmp_path))
        with zipfile.ZipFile(output_path, "r") as zf:
            xml_content = zf.read("ComicInfo.xml").decode("utf-8")
        assert "<Web>https://h-comic.com/comic/123</Web>" in xml_content

    def test_comic_info_xml_writer_falls_back_to_group(self, sample_images, tmp_path):
        """作者缺失时，<Writer> 回退到首个制作组，<Groups> 仍保留全部制作组。"""
        builder = CBZBuilder()
        comic = ComicInfo(
            id="123",
            title="无作者漫画",
            author=None,
            pages=1,
            groups=["制作组A", "制作组B"],
        )
        output_path = tmp_path / "fallback.cbz"
        builder.build_cbz(sample_images, comic, str(output_path), download_dir=str(tmp_path))
        with zipfile.ZipFile(output_path, "r") as zf:
            xml_content = zf.read("ComicInfo.xml").decode("utf-8")
        assert "<Writer>制作组A</Writer>" in xml_content
        assert "<Groups>制作组A, 制作组B</Groups>" in xml_content

    def test_comic_info_xml_writer_prefers_author_over_group(self, sample_images, tmp_path):
        """有作者时不回退，<Writer> 仍为作者。"""
        builder = CBZBuilder()
        comic = ComicInfo(
            id="123",
            title="有作者漫画",
            author="真实作者",
            pages=1,
            groups=["制作组A"],
        )
        output_path = tmp_path / "author.cbz"
        builder.build_cbz(sample_images, comic, str(output_path), download_dir=str(tmp_path))
        with zipfile.ZipFile(output_path, "r") as zf:
            xml_content = zf.read("ComicInfo.xml").decode("utf-8")
        assert "<Writer>真实作者</Writer>" in xml_content

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
        builder.build_cbz(sample_images, minimal_comic, str(output_path), download_dir=str(tmp_path))
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


class TestGetOutputPath:
    """测试输出路径与文件夹名生成"""

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

    def test_get_folder_name_author_falls_back_to_group(self, builder):
        """作者缺失时，文件夹名同样用首个制作组兜底。"""
        comic = ComicInfo(
            id="789",
            title="测试漫画",
            author=None,
            pages=5,
            groups=["制作组Y"],
        )
        folder = builder._generate_folder_name(comic)
        assert folder == "制作组Y-测试漫画"


class TestAlbumCBZ:
    @pytest.fixture
    def album_comic(self):
        return ComicInfo(
            id="100",
            title="Test Album - 第1話",
            author="Author",
            album_id="100",
            album_title="Test Album",
            album_total_chapters=3,
            source_site="jmcomic",
            comic_source="JMCOMIC",
        )

    def test_get_album_folder_name(self, album_comic):
        builder = CBZBuilder()
        name = builder.get_album_folder_name(album_comic)
        assert name == "Author-Test Album"

    def test_get_album_folder_name_sanitizes(self):
        comic = ComicInfo(
            id="1",
            album_title="Bad<>Name",
            author="A/B",
            album_total_chapters=2,
        )
        builder = CBZBuilder()
        name = builder.get_album_folder_name(comic)
        assert "<" not in name
        assert ">" not in name
        assert "/" not in name

    def test_get_album_folder_name_author_falls_back_to_group(self):
        """专辑作者缺失时，文件夹名用首个制作组兜底。"""
        comic = ComicInfo(
            id="1",
            album_title="My Album",
            author=None,
            groups=["制作组Z"],
            album_total_chapters=2,
        )
        builder = CBZBuilder()
        name = builder.get_album_folder_name(comic)
        assert name == "制作组Z-My Album"

    def test_get_album_output_path_folder(self, album_comic, tmp_path):
        builder = CBZBuilder()
        work_dir, final_path = builder.get_album_output_path(album_comic, "folder", str(tmp_path))
        assert work_dir == final_path
        assert work_dir.endswith("Author-Test Album")

    def test_get_album_output_path_cbz(self, album_comic, tmp_path):
        builder = CBZBuilder()
        work_dir, final_path = builder.get_album_output_path(album_comic, "cbz", str(tmp_path))
        assert work_dir.endswith("Author-Test Album")
        assert final_path.endswith("Author-Test Album.cbz")
        assert final_path == work_dir + ".cbz"

    def test_build_album_cbz_arcnames(self, tmp_path):
        comic = ComicInfo(
            id="100",
            title="Album - 第1話",
            author="Auth",
            album_id="100",
            album_title="Album",
            album_total_chapters=2,
            source_site="jmcomic",
            comic_source="JMCOMIC",
            pages=2,
        )
        album_dir = tmp_path / "Auth-Album"
        album_dir.mkdir()
        ch1 = album_dir / "第1話"
        ch1.mkdir()
        (ch1 / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")
        (ch1 / "002.jpg").write_bytes(b"\xff\xd8\xff\xd9")
        ch2 = album_dir / "第2話"
        ch2.mkdir()
        (ch2 / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        builder = CBZBuilder()
        output = tmp_path / "album.cbz"
        result = builder.build_album_cbz(str(album_dir), comic, str(output), download_dir=str(tmp_path))

        assert Path(result).exists()
        with zipfile.ZipFile(result) as zf:
            names = zf.namelist()
            assert "ComicInfo.xml" in names
            assert "第1話/001.jpg" in names
            assert "第1話/002.jpg" in names
            assert "第2話/003.jpg" in names

    def test_build_album_cbz_comic_info_xml(self, tmp_path):
        comic = ComicInfo(
            id="100",
            title="Album - 第1話",
            author="Auth",
            album_id="100",
            album_title="My Album",
            album_total_chapters=2,
            source_site="jmcomic",
            comic_source="JMCOMIC",
            tags=["tag1"],
            category="cat",
        )
        album_dir = tmp_path / "Auth-Album"
        album_dir.mkdir()
        ch1 = album_dir / "Ch1"
        ch1.mkdir()
        (ch1 / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        builder = CBZBuilder()
        output = tmp_path / "album.cbz"
        builder.build_album_cbz(str(album_dir), comic, str(output), download_dir=str(tmp_path))

        with zipfile.ZipFile(str(output)) as zf:
            xml = zf.read("ComicInfo.xml").decode()
            assert "<Title>My Album</Title>" in xml
            assert "<Series>My Album</Series>" in xml
            assert "<Writer>Auth</Writer>" in xml
