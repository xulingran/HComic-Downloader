"""MultiSourceParser 单元测试"""

from models import ComicInfo
from sources import MultiSourceParser


def test_default_source_and_auth_mapping():
    parser = MultiSourceParser(
        timeout=5,
        default_source="moeimg",
        source_auth={
            "hcomic": {"cookie": "h=1", "user_agent": "H-UA"},
            "moeimg": {"cookie": "m=2", "user_agent": "M-UA"},
        },
    )
    assert parser.current_source == "moeimg"
    assert parser.get_auth("hcomic") == ("h=1", "H-UA")
    assert parser.get_auth("moeimg") == ("m=2", "M-UA")


def test_set_source_and_search_delegation(monkeypatch):
    parser = MultiSourceParser(timeout=5)
    called = []

    def fake_search(keyword, page=1, *, tag=""):
        called.append((keyword, page, tag))
        return [], None

    monkeypatch.setattr(parser.parsers["moeimg"], "search", fake_search)
    parser.set_source("moeimg")
    parser.search("abc", page=3)
    assert called == [("abc", 3, "")]


def test_prepare_for_download_uses_moeimg_detail(monkeypatch):
    parser = MultiSourceParser(timeout=5, default_source="moeimg")
    source_comic = ComicInfo(
        id="100", title="T", source_site="moeimg", pages=0, image_urls=[]
    )
    resolved_comic = ComicInfo(
        id="100",
        title="T",
        source_site="moeimg",
        pages=2,
        image_urls=["https://x/1.webp", "https://x/2.webp"],
    )
    monkeypatch.setattr(
        parser.parsers["moeimg"],
        "get_comic_detail",
        lambda comic_id, slug="": resolved_comic,
    )

    output = parser.prepare_for_download(source_comic)
    assert output.pages == 2
    assert len(output.image_urls) == 2


def test_prepare_for_download_keeps_ready_hcomic():
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    source_comic = ComicInfo(
        id="100",
        title="T",
        source_site="hcomic",
        media_id="m1",
        comic_source="NH",
        pages=3,
    )
    output = parser.prepare_for_download(source_comic)
    assert output is source_comic


def test_search_with_explicit_source_does_not_mutate_current_source(monkeypatch):
    """Calling search(source='moeimg') must not change current_source."""
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    monkeypatch.setattr(
        parser.parsers["moeimg"],
        "search",
        lambda keyword, page=1, *, tag="": ([], None),
    )
    parser.search("test", page=1, source="moeimg")
    assert parser.current_source == "hcomic"


def test_favourites_with_explicit_source(monkeypatch):
    """favourites(source='hcomic') must route to hcomic even if current_source='moeimg'."""
    parser = MultiSourceParser(timeout=5, default_source="moeimg")
    called = []
    monkeypatch.setattr(
        parser.parsers["hcomic"],
        "favourites",
        lambda page=1, raise_errors=False: (
            called.append("hcomic") or ([], None, False)
        ),
    )
    parser.favourites(source="hcomic")
    assert called == ["hcomic"]


def test_verify_login_status_with_explicit_source(monkeypatch):
    """verify_login_status(source='hcomic') must route to hcomic parser."""
    parser = MultiSourceParser(timeout=5, default_source="moeimg")
    called = []
    monkeypatch.setattr(
        parser.parsers["hcomic"],
        "verify_login_status",
        lambda: (called.append(True) or (True, "ok")),
    )
    parser.verify_login_status(source="hcomic")
    assert called == [True]


def test_get_comic_detail_with_explicit_source(monkeypatch):
    """get_comic_detail(source='moeimg') must route to moeimg parser."""
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    called = []
    monkeypatch.setattr(
        parser.parsers["moeimg"],
        "get_comic_detail",
        lambda comic_id, slug="": (called.append(comic_id) or None),
    )
    parser.get_comic_detail("999", source="moeimg")
    assert called == ["999"]


def test_search_passes_tag_to_hcomic(monkeypatch):
    """tag kwarg must be forwarded to the underlying hcomic parser."""
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    called = []

    def fake_search(keyword, page=1, *, tag=""):
        called.append((keyword, page, tag))
        return [], None

    monkeypatch.setattr(parser.parsers["hcomic"], "search", fake_search)
    parser.search("魔法少女", page=1, tag="触手")
    assert called == [("魔法少女", 1, "触手")]


def test_search_with_empty_tag_does_not_crash_moeimg(monkeypatch):
    """MoeImgParser.search() accepts tag="" without TypeError."""
    parser = MultiSourceParser(timeout=5, default_source="moeimg")
    monkeypatch.setattr(
        parser.parsers["moeimg"],
        "search",
        lambda keyword, page=1, *, tag="": ([], None),
    )
    result = parser.search("test", page=1, source="moeimg", tag="")
    assert result == ([], None)


def test_configure_auth_updates_source_and_delegates(monkeypatch):
    """configure_auth(source=...) must update auth for that source and
    forward to the underlying parser's configure_auth."""
    parser = MultiSourceParser(timeout=5, default_source="moeimg")
    called = {}

    def fake_configure_auth(cookie="", user_agent="", bearer_token=""):
        called.update(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)

    monkeypatch.setattr(parser.parsers["hcomic"], "configure_auth", fake_configure_auth)
    parser.configure_auth(
        cookie="new_cookie",
        user_agent="new_ua",
        bearer_token="new_bearer",
        source="hcomic",
    )

    assert parser.get_auth("hcomic") == ("new_cookie", "new_ua")
    assert called == {
        "cookie": "new_cookie",
        "user_agent": "new_ua",
        "bearer_token": "new_bearer",
    }
    # current_source should remain unchanged
    assert parser.current_source == "moeimg"


def test_configure_auth_on_current_source(monkeypatch):
    """configure_auth without source= uses current_source."""
    parser = MultiSourceParser(timeout=5, default_source="moeimg")
    called = {}

    def fake_configure_auth(cookie="", user_agent="", bearer_token=""):
        called["invoked"] = True

    monkeypatch.setattr(parser.parsers["moeimg"], "configure_auth", fake_configure_auth)
    parser.configure_auth(cookie="c", user_agent="u")

    assert parser.get_auth("moeimg") == ("c", "u")
    assert called.get("invoked") is True
