"""测试 CopyManga 来源在 MultiSourceParser 中的注册。"""

from sources import MultiSourceParser


class TestCopyMangaRegistration:
    """测试 CopyManga 来源注册。"""

    def test_copymanga_parser_registered(self):
        parser = MultiSourceParser()
        assert "copymanga" in parser.parsers

    def test_copymanga_session_available(self):
        parser = MultiSourceParser()
        sessions = parser.get_sessions()
        assert len(sessions) >= 5

    def test_set_source_copymanga(self):
        parser = MultiSourceParser()
        parser.set_source("copymanga")
        assert parser.current_source == "copymanga"

    def test_search_dispatches_to_copymanga(self):
        parser = MultiSourceParser(default_source="copymanga")
        assert parser.current_source == "copymanga"

    def test_copymanga_does_not_support_favourites(self):
        """copymanga 不支持收藏夹（无 API）。"""
        parser = MultiSourceParser()
        assert parser.source_supports_favourites("copymanga") is False

    def test_copymanga_add_to_favourites_returns_false(self):
        parser = MultiSourceParser()
        assert parser.add_to_favourites("any_id", source="copymanga") is False

    def test_copymanga_verify_login_no_cookie(self):
        parser = MultiSourceParser()
        ok, msg = parser.verify_login_status(source="copymanga")
        assert ok is False
        assert "\u767b\u5f55" in msg

    def test_copymanga_verify_login_with_cookie(self):
        parser = MultiSourceParser()
        parser.configure_auth(cookie="token=abc", source="copymanga")
        ok, msg = parser.verify_login_status(source="copymanga")
        assert ok is True
