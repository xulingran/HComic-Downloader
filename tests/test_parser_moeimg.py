"""MoeImgParser 单元测试"""
from typing import Any

from sources.moeimg import MoeImgParser


class _MockResponse:
    def __init__(self, payload: Any, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_search_success_maps_comic_fields(monkeypatch):
    parser = MoeImgParser(timeout=5)
    payload = {
        "manga_list": [
            {
                "manga_name": "测试漫画",
                "manga_cover_img": "https://moeimg.fan/img/thumb/1.webp",
                "manga_id": 123,
                "language": "chinese",
            }
        ],
        "pagi": {
            "cur_page": 2,
            "pages": [{"page": 1}, {"page": 2}, {"page": 3}],
            "offset": 40,
        },
    }

    monkeypatch.setattr(parser.session, "get", lambda *args, **kwargs: _MockResponse(payload))

    comics, pagination = parser.search("test", page=2)
    assert len(comics) == 1
    comic = comics[0]
    assert comic.id == "123"
    assert comic.title == "测试漫画"
    assert comic.source_site == "moeimg"
    assert comic.preview_url.endswith("/post/fa123")
    assert comic.cover_url == "https://moeimg.fan/img/thumb/1.webp"
    assert comic.tags == ["chinese"]
    assert pagination is not None
    assert pagination.current_page == 2
    assert pagination.total_pages == 3


def test_search_empty_keyword_uses_latest_manga_endpoint(monkeypatch):
    parser = MoeImgParser(timeout=5)
    payload = {
        "manga_list": [
            {
                "manga_name": "最新漫画",
                "manga_cover_img": "https://moeimg.fan/img/thumb/latest.webp",
                "manga_id": 555,
                "language": "japanese",
            }
        ],
        "pagi": {
            "cur_page": 1,
            "pages": [{"page": 1}, {"page": 2}],
            "offset": 0,
        },
    }
    called_urls = []
    called_params = []

    def fake_get(url, params=None, timeout=30):
        called_urls.append(url)
        called_params.append(params)
        return _MockResponse(payload)

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, pagination = parser.search("   ", page=1)
    assert len(comics) == 1
    assert comics[0].id == "555"
    assert comics[0].author is None
    assert comics[0].category is None
    assert comics[0].publish_date is None
    assert comics[0].tags == ["japanese"]
    assert pagination is not None
    assert pagination.total_pages == 2
    assert called_urls == [f"{parser.BASE_URL}/spa/latest-manga"]
    assert called_params == [{"page": 1}]


def test_search_does_not_request_detail_immediately(monkeypatch):
    parser = MoeImgParser(timeout=5)
    search_payload = {
        "manga_list": [
            {
                "manga_name": "补全测试",
                "manga_cover_img": "https://moeimg.fan/img/thumb/e.webp",
                "manga_id": 666,
                "language": "chinese",
            }
        ],
        "pagi": {"cur_page": 1, "pages": [{"page": 1}], "offset": 0},
    }
    called_urls = []

    def fake_get(url, params=None, timeout=30):
        called_urls.append(url)
        if url.endswith("/spa/search"):
            return _MockResponse(search_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, _ = parser.search("补全", page=1)
    assert len(comics) == 1
    comic = comics[0]
    assert comic.author is None
    assert comic.category is None
    assert comic.publish_date is None
    assert comic.pages == 0
    assert comic.tags == ["chinese"]
    assert called_urls == [f"{parser.BASE_URL}/spa/search"]


def test_search_author_mode_resolves_id_and_uses_author_endpoint(monkeypatch):
    parser = MoeImgParser(timeout=5)
    lookup_payload = {
        "manga_list": [
            {"manga_id": 11, "manga_name": "候选1", "manga_cover_img": "", "language": "japanese"},
        ],
        "pagi": {"cur_page": 1, "pages": [{"page": 1}], "offset": 0},
    }
    detail_payload = {
        "authors": [{"author_name": "horn-wood", "author_id": 1963}],
        "tags": [],
    }
    author_payload = {
        "manga_list": [
            {"manga_id": 123, "manga_name": "作者结果", "manga_cover_img": "https://moeimg.fan/a.webp", "language": "chinese"},
        ],
        "pagi": {"cur_page": 2, "pages": [{"page": 1}, {"page": 2}], "offset": 40},
    }
    called = []

    def fake_get(url, params=None, timeout=30):
        called.append((url, params))
        if url.endswith("/spa/search"):
            assert params == {"query": "horn-wood", "page": 1}
            return _MockResponse(lookup_payload)
        if url.endswith("/spa/manga/11"):
            return _MockResponse(detail_payload)
        if url.endswith("/spa/author/1963"):
            assert params == {"page": 2}
            return _MockResponse(author_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, pagination = parser.search("Author: horn-wood", page=2)
    assert len(comics) == 1
    assert comics[0].id == "123"
    assert comics[0].title == "作者结果"
    assert pagination is not None
    assert pagination.current_page == 2
    assert called == [
        (f"{parser.BASE_URL}/spa/search", {"query": "horn-wood", "page": 1}),
        (f"{parser.BASE_URL}/spa/manga/11", None),
        (f"{parser.BASE_URL}/spa/author/1963", {"page": 2}),
    ]


def test_search_tag_mode_resolves_id_and_uses_genre_endpoint(monkeypatch):
    parser = MoeImgParser(timeout=5)
    lookup_payload = {
        "manga_list": [
            {"manga_id": 22, "manga_name": "候选2", "manga_cover_img": "", "language": "english"},
        ],
        "pagi": {"cur_page": 1, "pages": [{"page": 1}], "offset": 0},
    }
    detail_payload = {
        "authors": [],
        "tags": [{"tag_name": "big breasts", "tag_id": 145}],
    }
    genre_payload = {
        "manga_list": [
            {"manga_id": 456, "manga_name": "标签结果", "manga_cover_img": "https://moeimg.fan/t.webp", "language": "japanese"},
        ],
        "pagi": {"cur_page": 3, "pages": [{"page": 1}, {"page": 2}, {"page": 3}], "offset": 80},
    }

    def fake_get(url, params=None, timeout=30):
        if url.endswith("/spa/search"):
            assert params == {"query": "big breasts", "page": 1}
            return _MockResponse(lookup_payload)
        if url.endswith("/spa/manga/22"):
            return _MockResponse(detail_payload)
        if url.endswith("/spa/genre/145"):
            assert params == {"page": 3}
            return _MockResponse(genre_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, pagination = parser.search("Tag: big breasts", page=3)
    assert len(comics) == 1
    assert comics[0].id == "456"
    assert comics[0].title == "标签结果"
    assert pagination is not None
    assert pagination.current_page == 3


def test_get_comic_detail_builds_download_urls(monkeypatch):
    parser = MoeImgParser(timeout=5)
    detail_payload = {
        "detail": {
            "manga_id": 187476,
            "manga_name": "标题A",
            "manga_cover_img": "https://moeimg.fan/img/thumb/a.webp",
            "category": "doujinshi",
            "manga_date_published": "2025-10-18T03:02:56.000Z",
        },
        "authors": [{"author_name": "作者A"}],
        "tags": [{"tag_name": "tag1"}, {"tag_name": "tag2"}],
        "parody": [{"tag_name": "parody1"}],
        "characters": [{"tag_name": "char1"}],
    }
    read_payload = {
        "chapter_detail": {
            "manga_id": 187476,
            "chapter_id": "189904",
            "chapter_date_published": "2025-10-18T03:03:13.000Z",
            "total": 2,
            "server": "https://nvme1.cdndelivers.cloud/",
            "tags": [{"tag_name": "chapter-tag"}],
            "chapter_content": (
                '<img data-url="data/a5/0c/187476/189904/000-979x1331.webp">'
                '<img data-url="data/a5/0c/187476/189904/001-979x1331.webp">'
            ),
        }
    }

    def fake_get(url, params=None, timeout=30):
        if url.endswith("/spa/manga/187476/read"):
            return _MockResponse(read_payload)
        if url.endswith("/spa/manga/187476"):
            return _MockResponse(detail_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comic = parser.get_comic_detail("187476")
    assert comic is not None
    assert comic.id == "187476"
    assert comic.title == "标题A"
    assert comic.author == "作者A"
    assert comic.category == "doujinshi"
    assert comic.pages == 2
    assert comic.publish_date == "2025-10-18"
    assert comic.source_site == "moeimg"
    assert comic.tags == ["tag1", "tag2", "parody1", "char1", "chapter-tag"]
    assert len(comic.image_urls) == 2
    assert comic.image_urls[0] == "https://nvme1.cdndelivers.cloud/data/a5/0c/187476/189904/000-979x1331.webp"


def test_get_comic_detail_supports_single_quote_data_url_and_preview_count(monkeypatch):
    parser = MoeImgParser(timeout=5)
    detail_payload = {
        "detail": {
            "manga_id": 9,
            "manga_name": "标题B",
        },
        "authors": [{"author_name": "作者B"}],
        "preview_imgs": {
            "pages": {
                "1": [
                    "https://moeimg.fan/preview/1.webp",
                    "https://moeimg.fan/preview/2.webp",
                    "https://moeimg.fan/preview/3.webp",
                ]
            }
        },
    }
    read_payload = {
        "chapter_detail": {
            "total": "invalid",
            "server": "https://cdn.example/",
            "chapter_content": (
                "<img data-url='data/path/001.webp'>"
                "<img data-url='data/path/002.webp'>"
            ),
        }
    }

    def fake_get(url, params=None, timeout=30):
        if url.endswith("/spa/manga/9/read"):
            return _MockResponse(read_payload)
        if url.endswith("/spa/manga/9"):
            return _MockResponse(detail_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comic = parser.get_comic_detail("9")
    assert comic is not None
    assert comic.author == "作者B"
    assert comic.pages == 3
    assert comic.image_urls == [
        "https://cdn.example/data/path/001.webp",
        "https://cdn.example/data/path/002.webp",
    ]
