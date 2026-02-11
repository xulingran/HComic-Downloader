"""测试 cbz_builder.py CBZ 打包功能"""
import zipfile
import pytest
from pathlib import Path
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
        minimal_jpeg = (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
            b'\xff\xdb\x00C\x00\x03\x02\x02\x03\x02\x02\x03\x03\x03\x03\x04\x03\x03'
            b'\x04\x05\x08\x05\x05\x04\x04\x05\n\x07\x07\x06\x08\x0c\n\x0c\x0c\x0b'
            b'\n\x0b\x0b\r\x0e\x12\x10\r\x0e\x11\x0e\x0b\x0b\x10\x16\x10\x11\x13\x14'
            b'\x15\x15\x15\x0c\x0f\x17\x18\x16\x14\x18\x12\x14\x15\x14\xff\xc0\x00'
            b'\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x14\x00\x01\x00'
            b'\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\n\xff\xc4\x00'
            b'\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
            b'\x00\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00T\x9f\xff\xd9'
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
        result = builder.build_cbz(sample_images, sample_comic, str(output_path))
        assert Path(result).exists()
        assert result == str(output_path)
        with zipfile.ZipFile(result, 'r') as zf:
            namelist = zf.namelist()
            assert 'ComicInfo.xml' in namelist
            assert len([n for n in namelist if n.endswith('.jpg')]) == 3

    def test_comic_info_xml_content(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(sample_images, sample_comic, str(output_path))
        with zipfile.ZipFile(output_path, 'r') as zf:
            xml_content = zf.read('ComicInfo.xml').decode('utf-8')
        assert '<Title>测试漫画Title</Title>' in xml_content
        assert '<Writer>测试作者Author</Writer>' in xml_content
        assert '<PageCount>3</PageCount>' in xml_content
        assert '<Year>2024</Year>' in xml_content

    def test_cbz_image_naming(self, sample_comic, sample_images, tmp_path):
        builder = CBZBuilder()
        output_path = tmp_path / "output.cbz"
        builder.build_cbz(sample_images, sample_comic, str(output_path))
        with zipfile.ZipFile(output_path, 'r') as zf:
            namelist = zf.namelist()
        assert '001.jpg' in namelist
        assert '002.jpg' in namelist
        assert '003.jpg' in namelist

    def test_collect_image_files(self, tmp_path):
        minimal_jpeg = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9'
        img_dir = tmp_path / "images"
        img_dir.mkdir()
        (img_dir / "001.jpg").write_bytes(minimal_jpeg)
        (img_dir / "002.png").write_bytes(minimal_jpeg)
        (img_dir / "readme.txt").write_text("not an image")
        builder = CBZBuilder()
        files = builder._collect_image_files(str(img_dir))
        assert len(files) == 2

    def test_parse_date(self):
        builder = CBZBuilder()
        assert builder._parse_date("2024-01-15") == ("2024", "01", "15")
        assert builder._parse_date("2024-01") == ("2024", "01", "")
        assert builder._parse_date("2024") == ("2024", "", "")
