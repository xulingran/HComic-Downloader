"""测试 utils.py 工具函数"""
import pytest
from utils import sanitize_filename, format_file_size, format_tags


class TestSanitizeFilename:
    @pytest.mark.parametrize("input_name,expected", [
        ("正常文件名", "正常文件名"),
        ("test_file.txt", "test_file.txt"),
        ("file<>name", "file__name"),
        ("file:name", "file_name"),
        ("file\"name", "file_name"),
        ("file|name", "file_name"),
        ("file?name", "file_name"),
        ("file*name", "file_name"),
        ("file/name", "file_name"),
        ("file\\name", "file_name"),
        ("file\x00name", "file_name"),
        ("  file  ", "file"),
        ("...file...", "file"),
        (" .file. ", "file"),
        ("a" * 250, "a" * 200),
        ("", "unknown"),
        (None, "unknown"),
        ("<>:\"/\\|?*test", "_________test"),
    ])
    def test_sanitize_filename_various_inputs(self, input_name, expected):
        assert sanitize_filename(input_name) == expected


class TestFormatFileSize:
    @pytest.mark.parametrize("size,expected", [
        (0, "0 B"),
        (512, "512 B"),
        (1024, "1.0 KB"),
        (1536, "1.5 KB"),
        (1024 * 1024, "1.0 MB"),
        (1024 * 1024 * 1.5, "1.5 MB"),
        (1024 * 1024 * 1024, "1.0 GB"),
        (1024 * 1024 * 1024 * 2.5, "2.5 GB"),
    ])
    def test_format_file_size(self, size, expected):
        assert format_file_size(size) == expected


class TestFormatTags:
    def test_format_tags_empty(self):
        assert format_tags([]) == ""

    def test_format_tags_single(self):
        assert format_tags(["tag1"]) == "tag1"

    def test_format_tags_multiple(self):
        assert format_tags(["tag1", "tag2", "tag3"]) == "tag1, tag2, tag3"

    def test_format_tags_with_none(self):
        assert format_tags(["tag1", None, "tag2"]) == "tag1, tag2"

    def test_format_tags_with_empty_string(self):
        assert format_tags(["tag1", "", "tag2"]) == "tag1, tag2"
