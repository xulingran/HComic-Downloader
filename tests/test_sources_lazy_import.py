"""Tests for lazy parser module imports in ``sources/__init__.py``.

Verifies that ``import sources`` does not drag in every parser module
(and their heavy dependencies like ``requests``, ``PIL``, ``lxml``).
Only the source that is actually accessed should be imported on demand.
"""

import gc
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))


def _clean():
    """Drop sources modules and cached parser classes so each test starts clean.

    Only clears modules relevant to lazy-loading (sources.* and the heavy deps
    requests/PIL/lxml). Must NOT touch 'asyncio' (pytest infra) or 'ipc.*'
    (unrelated to this test, and shared with cover_cache tests in the same run).
    """
    if "sources" in sys.modules:
        sources_mod = sys.modules["sources"]
        if hasattr(sources_mod, "_PARSER_CLASSES"):
            sources_mod._PARSER_CLASSES.clear()
    for m in list(sys.modules):
        if m.startswith("sources.") or m in ("requests", "PIL", "lxml"):
            del sys.modules[m]
    if "sources" in sys.modules:
        del sys.modules["sources"]
    gc.collect()


def test_import_sources_does_not_load_parser_modules():
    """``import sources`` should load zero parser modules (they are lazy now)."""
    _clean()
    import sources  # noqa: F401 — this is the test: importing sources should NOT load parser modules

    parser_mods = [m for m in sys.modules if m.endswith(".parser") and m.startswith("sources.")]
    assert not parser_mods, f"Expected zero parser modules loaded, got: {parser_mods}"


def test_default_source_parser_loaded_on_instance():
    """``MultiSourceParser(default_source='hcomic')`` loads only hcomic."""
    _clean()
    from sources import MultiSourceParser

    _ = MultiSourceParser(default_source="hcomic")
    # Reset cached class to force fresh import
    _parser_mods = [m for m in sys.modules if m.endswith(".parser") and m.startswith("sources.")]
    assert "sources.hcomic.parser" in sys.modules, "hcomic.parser should be loaded (default)"
    for banned in (
        "sources.bika.parser",
        "sources.jm.parser",
        "sources.moeimg.parser",
        "sources.copymanga.parser",
    ):
        assert banned not in sys.modules, f"{banned} should NOT be loaded at init"


def test_unused_source_stays_lazy():
    """Accessing only jm should not load bika/moeimg/hcomic/copymanga parsers."""
    _clean()
    import sources

    sources._PARSER_CLASSES.clear()
    _ = sources.MultiSourceParser(default_source="jm")
    parser_mods = {m for m in sys.modules if m.endswith(".parser") and m.startswith("sources.")}
    assert "sources.jm.parser" in sys.modules, "jm should be loaded"
    for banned in ("sources.bika.parser", "sources.moeimg.parser", "sources.copymanga.parser"):
        assert banned not in parser_mods, f"{banned} should NOT be loaded"


def test_lazy_source_loaded_on_first_access():
    """Accessing a non-default source loads only that source's module."""
    _clean()
    import sources

    sources._PARSER_CLASSES.clear()
    p = sources.MultiSourceParser(default_source="hcomic")

    _ = p._get_parser("bika")
    assert "sources.bika.parser" in sys.modules, "bika.parser should be loaded after first access"
    for still_lazy in ("sources.jm.parser", "sources.moeimg.parser", "sources.copymanga.parser"):
        assert still_lazy not in sys.modules, f"{still_lazy} should still be lazy"


def test_parser_response_error_lazy_re_export():
    """``ParserResponseError`` re-exported via module __getattr__ from sources.base.

    Accessing it must NOT pull in any parser module (sources.hcomic.parser) or
    heavy deps (requests/lxml), otherwise lazy-loading is partly defeated.
    """
    _clean()
    import sources

    err = sources.ParserResponseError
    from sources.base import ParserResponseError as Base

    assert err is Base, "ParserResponseError should be the same class"
    # Re-export must come from sources.base, not drag in the hcomic parser.
    assert (
        "sources.hcomic.parser" not in sys.modules
    ), "sources.ParserResponseError must not trigger sources.hcomic.parser import"
    for dep in ("requests", "lxml", "PIL"):
        assert dep not in sys.modules, f"'{dep}' should NOT be loaded by ParserResponseError re-export"


def test_parser_response_error_identity_with_parser_after_import():
    """sources.ParserResponseError is the same object as in the hcomic parser."""
    _clean()
    import sources

    base_err = sources.ParserResponseError
    # Now deliberately import the hcomic parser; its ParserResponseError is the
    # same class (re-imported from sources.base), so `except` catches still work.
    from sources.hcomic.parser import ParserResponseError as HcomicErr

    assert base_err is HcomicErr, "ParserResponseError identity must be preserved across re-imports"


def test_import_sources_does_not_load_heavy_deps():
    """Verify that 'import sources' does not load requests or PIL."""
    _clean()
    import sources  # noqa: F401 — guard: we must import sources before checking sys.modules

    for dep in ("requests", "PIL", "lxml"):
        assert dep not in sys.modules, f"'{dep}' should NOT be loaded by 'import sources'"
