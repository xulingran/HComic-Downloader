"""MultiSourceParser 单元测试"""

from config import AuthSourceData, Config
from models import ComicInfo
from sources import MultiSourceParser


def test_jm_home_reuses_dispatched_parser_instance(monkeypatch):
    """JM 首页分发必须调用 _get_parser('jm') 返回的唯一懒创建实例。"""
    parser = MultiSourceParser.__new__(MultiSourceParser)
    expected = [("最新漫画", [])]

    class FakeJmParser:
        def home(self) -> list[tuple[str, list[ComicInfo]]]:
            return expected

    fake_jm = FakeJmParser()
    requested_sources: list[str] = []
    monkeypatch.setattr(
        parser,
        "_get_parser",
        lambda source: requested_sources.append(source) or fake_jm,
    )

    assert parser.jm_home() is expected
    assert requested_sources == ["jm"]


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


def test_nh_auth_restored_from_reloaded_config(tmp_path):
    """NH API Key 必须跨磁盘重载进入真实懒创建 parser（remove-nh-password-login spec）。

    归一化只保留 API Key；cookie/user_agent/username/password 不会被恢复。
    """
    config_path = str(tmp_path / "config.json")
    config = Config(default_source="nh")
    # set_source_auth 对 NH 只保留 API Key，其余字段被丢弃。
    config.set_source_auth(
        "nh",
        AuthSourceData(bearer_token="nh-api-key"),
    )
    config.save(config_path)
    reloaded = Config.load(config_path)

    parser = MultiSourceParser(
        timeout=5,
        default_source="nh",
        source_auth=reloaded.source_auth,
    )
    nh = parser.parsers["nh"]

    assert nh.session.headers["Authorization"] == "Key nh-api-key"
    # cookie/user_agent 不再作为 NH 认证凭据
    assert "Cookie" not in nh.session.headers
    # NhParser 不再持有 _username/_password（账号密码登录已移除）
    assert not hasattr(nh, "_username")
    assert not hasattr(nh, "_password")


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


def test_moeimg_language_filter_search_delegation(monkeypatch):
    parser = MultiSourceParser(timeout=5)
    called = []

    def fake_search(keyword, page=1, *, tag="", language_filter=""):
        called.append((keyword, page, tag, language_filter))
        return [], None

    monkeypatch.setattr(parser.parsers["moeimg"], "search", fake_search)

    parser.search("abc", page=2, source="moeimg", language_filter="chinese")

    assert called == [("abc", 2, "", "chinese")]


def test_prepare_for_download_uses_moeimg_detail(monkeypatch):
    parser = MultiSourceParser(timeout=5, default_source="moeimg")
    source_comic = ComicInfo(id="100", title="T", source_site="moeimg", pages=0, image_urls=[])
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
        lambda page=1, raise_errors=False: called.append("hcomic") or ([], None, False),
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
        lambda: called.append(True) or (True, "ok"),
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
        lambda comic_id, slug="": called.append(comic_id) or None,
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


def test_prepare_for_download_bika_single_chapter(monkeypatch):
    """bika 单章节时，prepare_for_download 应获取详情并填充图片地址。"""
    from models import ChapterInfo

    parser = MultiSourceParser(timeout=5, default_source="bika")
    source_comic = ComicInfo(id="bk1", title="Bika Comic", source_site="bika", pages=0, image_urls=[])
    detail_comic = ComicInfo(
        id="bk1",
        title="Bika Comic",
        source_site="bika",
        pages=10,
        chapters=[ChapterInfo(id="ep1", name="Ch 1", index=1)],
    )

    monkeypatch.setattr(
        parser.parsers["bika"],
        "get_comic_detail",
        lambda comic_id, slug="": detail_comic,
    )
    monkeypatch.setattr(
        parser.parsers["bika"],
        "get_chapter_images",
        lambda comic_id, order: [f"https://cdn/img/{i}.jpg" for i in range(3)],
    )

    output = parser.prepare_for_download(source_comic)

    assert output.pages == 3
    assert len(output.image_urls) == 3
    assert output.image_urls[0] == "https://cdn/img/0.jpg"


def test_prepare_for_download_bika_multi_chapter(monkeypatch):
    """bika 多章节时，返回详情但不调用 get_chapter_images。"""
    from models import ChapterInfo

    parser = MultiSourceParser(timeout=5, default_source="bika")
    source_comic = ComicInfo(id="bk2", title="Multi Ch", source_site="bika", pages=0, image_urls=[])
    detail_comic = ComicInfo(
        id="bk2",
        title="Multi Ch",
        source_site="bika",
        pages=30,
        chapters=[
            ChapterInfo(id="ep1", name="Ch 1", index=1),
            ChapterInfo(id="ep2", name="Ch 2", index=2),
            ChapterInfo(id="ep3", name="Ch 3", index=3),
        ],
    )

    images_called = []
    monkeypatch.setattr(
        parser.parsers["bika"],
        "get_comic_detail",
        lambda comic_id, slug="": detail_comic,
    )
    monkeypatch.setattr(
        parser.parsers["bika"],
        "get_chapter_images",
        lambda *a, **kw: images_called.append(True) or [],
    )

    output = parser.prepare_for_download(source_comic)

    assert output is detail_comic
    assert output.pages == 0  # 多章节 bika 清空 pages，走章节下载流程
    assert output.image_urls == []
    assert images_called == []  # 不应调用 get_chapter_images


def test_prepare_for_download_jm(monkeypatch):
    """jm 通过详情接口补齐图片地址。"""
    parser = MultiSourceParser(timeout=5, default_source="jm")
    source_comic = ComicInfo(id="jm1", title="JM Comic", source_site="jm", pages=0, image_urls=[])
    resolved = ComicInfo(
        id="jm1",
        title="JM Comic",
        source_site="jm",
        pages=5,
        image_urls=["https://jm/img/1.jpg"],
    )

    monkeypatch.setattr(
        parser.parsers["jm"],
        "get_comic_detail",
        lambda comic_id, slug="": resolved,
    )

    output = parser.prepare_for_download(source_comic)

    assert output is resolved
    assert output.pages == 5


def test_random_delegates_to_supported_source(monkeypatch):
    """random() 应分发给 hcomic 和 jm。"""
    parser = MultiSourceParser(timeout=5, default_source="hcomic")

    called = []
    monkeypatch.setattr(
        parser.parsers["hcomic"],
        "random",
        lambda: called.append("hcomic") or ([], None),
    )
    monkeypatch.setattr(
        parser.parsers["jm"],
        "random",
        lambda: called.append("jm") or ([], None),
    )

    parser.random(source="hcomic")
    parser.random(source="jm")

    assert called == ["hcomic", "jm"]


def test_random_raises_for_unsupported_source():
    """random() 对 moeimg 应抛 ValueError。"""
    import pytest

    parser = MultiSourceParser(timeout=5, default_source="moeimg")

    with pytest.raises(ValueError, match="not supported"):
        parser.random(source="moeimg")


def test_random_routes_to_bika(monkeypatch):
    """random(source='bika') 应路由到 bika parser 的 get_random_comics。"""
    from sources.bika.parser import BikaParser

    parser = MultiSourceParser(timeout=5, default_source="bika")
    bika = parser.parsers["bika"]
    assert isinstance(bika, BikaParser)

    called = {}

    def fake_get_random_comics():
        called["ok"] = True
        from models import ComicInfo

        return [ComicInfo(id="r1", title="Random", source_site="bika", comic_source="BIKA")]

    monkeypatch.setattr(bika, "get_random_comics", fake_get_random_comics)
    comics, pagination = parser.random(source="bika")
    assert called.get("ok")
    assert len(comics) == 1
    assert comics[0].id == "r1"
    assert pagination is None


def test_favourites_routes_to_bika(monkeypatch):
    """favourites(source='bika') 应路由到 bika parser。"""
    parser = MultiSourceParser(timeout=5, default_source="hcomic")

    called = []
    monkeypatch.setattr(
        parser.parsers["bika"],
        "favourites",
        lambda page=1, raise_errors=False: called.append(("bika", page)) or ([], None, False),
    )

    parser.favourites(source="bika", page=2)

    assert called == [("bika", 2)]


def test_legacy_jmcomic_source_auth_maps_to_jm():
    parser = MultiSourceParser(
        timeout=5,
        default_source="hcomic",
        source_auth={"jmcomic": {"cookie": "j=1", "user_agent": "J-UA"}},
    )
    assert parser.get_auth("jm") == ("j=1", "J-UA")


def test_jm_domain_applies_after_lazy_parser_creation(monkeypatch):
    applied = []

    class FakeHComicParser:
        def __init__(self, **kwargs):
            self.session = object()

        def configure_auth(self, **kwargs):
            pass

        def set_stored_credentials(self, username, password):
            pass

    class FakeJmParser:
        def __init__(self, **kwargs):
            self.session = object()

        def configure_auth(self, **kwargs):
            pass

        def set_custom_domain(self, domain):
            applied.append(domain)

    import sources

    monkeypatch.setattr(
        sources, "_load_parser_class", lambda source: FakeJmParser if source == "jm" else FakeHComicParser
    )
    parser = MultiSourceParser(timeout=5, default_source="hcomic", jm_domain="18comic.vip")
    parser.set_source("jm")
    assert applied == ["18comic.vip"]


def test_jm_runtime_auth_survives_lazy_parser_creation():
    """JM 运行期凭据在 parser 懒创建时必须生效（jm-session-cookie spec 核心 P1 回归）。

    真实 JmParser 链路（不发网络）：运行期 configure_auth 发生在 parser 创建前，
    首次访问 parsers["jm"] 触发懒创建时，注入的 cookie/UA 必须流入实例，
    禁止被持久化 source_auth 残留或硬编码空串覆盖。
    """
    parser = MultiSourceParser(
        timeout=5,
        default_source="hcomic",
        # 持久化残留，必须被忽略
        source_auth={"jm": {"cookie": "remember=PERSISTED", "user_agent": "PERSISTED-UA"}},
    )
    # 运行期登录（parser 尚未创建）
    parser.configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")
    # 首次懒创建
    jm = parser.parsers["jm"]
    assert jm._cookie == "remember=runtime"
    assert jm._user_agent == "RUNTIME-UA"


def test_jm_startup_anonymous_ignores_persisted_cookie():
    """启动时（未运行期登录）即使 source_auth["jm"] 含残留 cookie，
    parser 创建后必须为匿名（jm-session-cookie spec）。"""
    parser = MultiSourceParser(
        timeout=5,
        default_source="hcomic",
        source_auth={"jm": {"cookie": "remember=old-session", "user_agent": "OLD-UA"}},
    )
    jm = parser.parsers["jm"]
    assert jm._cookie == ""
    assert jm._user_agent == ""


def test_jm_configure_auth_does_not_pollute_persisted_source_auth():
    """运行期 configure_auth(source="jm") 禁止写入持久化 source_auth 快照，
    必须存于独立的 _jm_session_auth（jm-session-cookie spec）。"""
    parser = MultiSourceParser(
        timeout=5,
        default_source="hcomic",
        source_auth={"jm": {"cookie": "remember=PERSISTED", "user_agent": "PERSISTED-UA"}},
    )
    parser.configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")
    # 持久化快照保持原残留值，未被运行期注入污染
    assert parser.source_auth["jm"]["cookie"] == "remember=PERSISTED"
    assert parser.source_auth["jm"]["user_agent"] == "PERSISTED-UA"
    # 运行期通道含注入值（bearer_token 默认空串，configure_auth 接收但本次未传）
    assert parser._jm_session_auth == {"cookie": "remember=runtime", "user_agent": "RUNTIME-UA", "bearer_token": ""}


def test_get_runtime_auth_reflects_session_state_for_jm():
    """get_runtime_auth("jm") 反映运行期登录态，不读持久化残留；
    非 JM 来源走 source_auth（jm-session-cookie spec）。"""
    # 未登录：即使有持久化残留，运行期返回空
    parser = MultiSourceParser(
        timeout=5,
        default_source="hcomic",
        source_auth={
            "jm": {"cookie": "remember=old", "user_agent": "OLD-UA"},
            "hcomic": {"cookie": "h=1", "user_agent": "H-UA"},
        },
    )
    assert parser.get_runtime_auth("jm") == ("", "")
    # 非 JM 来源走 source_auth
    assert parser.get_runtime_auth("hcomic") == ("h=1", "H-UA")
    # 运行期登录后返回注入值
    parser.configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")
    assert parser.get_runtime_auth("jm") == ("remember=runtime", "RUNTIME-UA")


def test_jm_configure_auth_bearer_token_retained_through_lazy_create():
    """JM 内存通道保留 cookie/user_agent/bearer_token 三元组，懒创建后通过 _apply_post_init
    的**完整三元组** configure_auth 注入 parser（JmParser.__init__ 不接受 bearer_token）。

    回归保护：_apply_post_init 禁止只传 bearer_token —— JmParser.configure_auth 的
    cookie/UA 默认空串会覆盖 factory 刚注入的值，导致实例只剩 Authorization。
    """
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    parser.configure_auth(cookie="remember=COOKIE", user_agent="RUNTIME-UA", bearer_token="bt-jm", source="jm")
    assert parser._jm_session_auth["bearer_token"] == "bt-jm"
    jm = parser.parsers["jm"]
    # 三项必须同时保留（审查 P1：补 bearer 不得清空 cookie/UA）
    assert jm._cookie == "remember=COOKIE", f"cookie cleared by bearer injection: {jm._cookie!r}"
    assert jm._user_agent == "RUNTIME-UA", f"user_agent cleared by bearer injection: {jm._user_agent!r}"
    assert jm.session.headers.get("Authorization", "") == "Bearer bt-jm"


def test_jm_configure_auth_concurrent_with_lazy_create_is_consistent():
    """[并发回归] configure_auth 与首次懒创建并发时，运行期状态与真实 parser 实例必须一致
    （jm-session-cookie spec P1：禁止 configure_auth 在 _get_parser 持锁创建期间读到
    _parsers=None 而 return，导致 runtime 非空但 parser 无凭据）。

    用慢 factory 制造 _get_parser 持锁窗口，期间另一线程调用 configure_auth；
    修复后 configure_auth 持 _parser_lock，与创建临界区互斥，二者最终一致。
    """
    import threading
    import time

    import sources
    from sources.jm.parser import JmParser

    parser = MultiSourceParser(timeout=5, default_source="hcomic")

    def slow_jm_factory(*args, **kwargs):
        time.sleep(0.3)  # 放大 _get_parser 持锁窗口
        return JmParser(*args, **kwargs)

    sources._PARSER_CLASSES["jm"] = slow_jm_factory
    try:
        parser_ref: dict = {}
        login_done = threading.Event()

        def create_jm():
            parser_ref["p"] = parser._get_parser("jm")

        def login():
            time.sleep(0.1)  # 等 _get_parser 进入锁、调起 factory
            parser.configure_auth(cookie="remember=RACE", user_agent="RACE-UA", source="jm")
            login_done.set()

        t1 = threading.Thread(target=create_jm)
        t2 = threading.Thread(target=login)
        t1.start()
        t2.start()
        assert login_done.wait(3), "configure_auth did not complete in time"
        t1.join(timeout=5)
        t2.join(timeout=5)

        jm = parser_ref["p"]
        assert jm is not None
        # 关键断言：真实 parser 实例的凭据必须与运行期状态一致
        assert jm._cookie == parser._jm_session_auth["cookie"], (
            f"race inconsistency: parser._cookie={jm._cookie!r} but runtime=" f"{parser._jm_session_auth['cookie']!r}"
        )
        assert jm._cookie == "remember=RACE"
    finally:
        sources._PARSER_CLASSES.pop("jm", None)


def test_parse_jm_search_snapshot_delegates_to_jm_parser(monkeypatch):
    """parse_jm_search_snapshot 必须委托到 jm parser 实例。"""
    from models import PaginationInfo

    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    called: list[dict] = []
    monkeypatch.setattr(
        parser.parsers["jm"],
        "parse_search_snapshot",
        lambda html="", source_url="", query="", page=1: (
            called.append({"query": query, "page": page})
            or ([], PaginationInfo(current_page=1, total_pages=1, total_items=0)),
        ),
    )
    parser.parse_jm_search_snapshot(
        html="<html></html>",
        source_url="https://18comic.vip/search/photos?main_tag=0&search_query=test",
        query="test",
        page=1,
    )
    assert called == [{"query": "test", "page": 1}]


def test_parse_jm_home_snapshot_delegates_to_jm_parser(monkeypatch):
    """parse_jm_home_snapshot 必须委托到 jm parser 实例。"""
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    called: list[bool] = []
    monkeypatch.setattr(
        parser.parsers["jm"],
        "parse_home_snapshot",
        lambda html="", source_url="": called.append(True) or [],
    )
    parser.parse_jm_home_snapshot(html="<html></html>", source_url="https://18comic.vip/")
    assert called == [True]
