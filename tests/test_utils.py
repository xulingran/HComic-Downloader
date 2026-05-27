"""测试 utils.py 工具函数"""
import pytest

from utils import sanitize_filename


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
