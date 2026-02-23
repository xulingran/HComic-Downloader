"""测试 models.py 数据模型"""
import pytest
from models import ComicInfo, PaginationInfo


class TestComicInfo:
    def test_default_values(self):
        comic = ComicInfo()
        assert comic.id == ""
        assert comic.title == ""
        assert comic.pages == 0
        assert comic.tags == []
        assert comic.source_site == "hcomic"
        assert comic.image_urls == []

    def test_safe_title_property(self):
        comic = ComicInfo(title="正常标题")
        assert comic.safe_title == "正常标题"

        comic = ComicInfo(title="标题<>:with|非法?字符")
        assert comic.safe_title == "标题___with_非法_字符"  # sanitize_filename 处理

    def test_safe_author_property(self):
        comic = ComicInfo(author="作者名")
        assert comic.safe_author == "作者名"

        comic = ComicInfo(author=None)
        assert comic.safe_author == "unknown"

    def test_get_image_url_mmcg_short(self):
        comic = ComicInfo(id="12345", media_id="abcde", comic_source="MMCG_SHORT")
        assert comic.get_image_url(1) == "https://h-comic.link/api/mms/abcde/pages/1"
        assert comic.get_image_url(5) == "https://h-comic.link/api/mms/abcde/pages/5"

    def test_get_image_url_mmcg_long(self):
        comic = ComicInfo(id="12345", media_id="abcde", comic_source="MMCG_LONG")
        assert comic.get_image_url(1) == "https://h-comic.link/api/mml/abcde/pages/1"

    def test_get_image_url_default_source(self):
        comic = ComicInfo(id="12345", media_id="abcde", comic_source="UNKNOWN")
        assert comic.get_image_url(1) == "https://h-comic.link/api/nh/abcde/pages/1"

    def test_get_all_image_urls(self):
        comic = ComicInfo(id="12345", media_id="abcde", comic_source="MMCG_SHORT", pages=3)
        urls = comic.get_all_image_urls()
        assert len(urls) == 3
        assert urls[0] == "https://h-comic.link/api/mms/abcde/pages/1"
        assert urls[2] == "https://h-comic.link/api/mms/abcde/pages/3"

    def test_get_all_image_urls_prefers_explicit_urls(self):
        comic = ComicInfo(
            id="12345",
            media_id="abcde",
            comic_source="MMCG_SHORT",
            pages=3,
            image_urls=["https://example.com/1.webp", "https://example.com/2.webp"],
        )
        urls = comic.get_all_image_urls()
        assert urls == ["https://example.com/1.webp", "https://example.com/2.webp"]

    def test_hashable_and_equality(self):
        comic1 = ComicInfo(id="1", comic_source="MMCG_SHORT")
        comic2 = ComicInfo(id="1", comic_source="MMCG_SHORT")
        comic3 = ComicInfo(id="2", comic_source="MMCG_SHORT")

        assert comic1 == comic2
        assert comic1 != comic3
        assert hash(comic1) == hash(comic2)
        assert len({comic1, comic2, comic3}) == 2

    def test_hashable_and_equality_include_source_site(self):
        comic1 = ComicInfo(id="1", comic_source="MMCG_SHORT", source_site="hcomic")
        comic2 = ComicInfo(id="1", comic_source="MMCG_SHORT", source_site="moeimg")
        assert comic1 != comic2
        assert len({comic1, comic2}) == 2


class TestPaginationInfo:
    def test_default_values(self):
        pagination = PaginationInfo()
        assert pagination.current_page == 1
        assert pagination.total_pages == 1
        assert pagination.limit == 10
        assert pagination.total_items == 0

    def test_has_previous(self):
        pagination = PaginationInfo(current_page=1, total_pages=5)
        assert not pagination.has_previous

        pagination = PaginationInfo(current_page=3, total_pages=5)
        assert pagination.has_previous

    def test_has_next(self):
        pagination = PaginationInfo(current_page=5, total_pages=5)
        assert not pagination.has_next

        pagination = PaginationInfo(current_page=3, total_pages=5)
        assert pagination.has_next

    def test_single_page(self):
        pagination = PaginationInfo(current_page=1, total_pages=1)
        assert not pagination.has_previous
        assert not pagination.has_next
