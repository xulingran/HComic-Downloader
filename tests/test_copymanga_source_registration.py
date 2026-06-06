"""测试 CopyManga 来源在 MultiSourceParser 中的注册。"""

from sources import MultiSourceParser


class TestCopyMangaRegistration:
    """测试 CopyManga 来源注册。"""

    def test_copymanga_in_source_options(self):
        parser = MultiSourceParser()
        options = parser.get_source_options()
        source_ids = [opt[0] for opt in options]
        assert "copymanga" in source_ids

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
