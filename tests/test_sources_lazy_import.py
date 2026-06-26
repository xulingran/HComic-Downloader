"""Tests for lazy parser module imports in ``sources/__init__.py``.

Verifies that ``import sources`` does not drag in every parser module
(and their heavy dependencies like ``requests``, ``PIL``, ``lxml``).
Only the source that is actually accessed should be imported on demand.
"""

import gc
import importlib
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))


@pytest.fixture(autouse=True)
def _isolate_parser_classes_cache():
    """每个用例结束后清空模块级 ``_PARSER_CLASSES``，防止跨测试/跨文件泄漏。

    职责与 ``_clean()`` 分离：``_clean()`` 在用例**开始**时清 ``sys.modules``
    以提供干净起点；本 fixture 在用例**结束**（teardown）时清 ``_PARSER_CLASSES``
    类缓存。真实构造解析器的用例（如 ``test_concurrent_*``、
    ``test_lazy_source_loaded_on_first_access``）会填充该缓存，若不复位，会绕过
    其他测试文件（如 ``test_multi_source_parser.py``）的
    ``monkeypatch.setattr(sources, "_load_parser_class", ...)``。
    """
    yield
    sources_mod = sys.modules.get("sources")
    if sources_mod is not None and hasattr(sources_mod, "_PARSER_CLASSES"):
        sources_mod._PARSER_CLASSES.clear()


def _clean():
    """Drop sources modules and cached parser classes so each test starts clean.

    Only clears modules relevant to lazy-loading (sources.* and the heavy deps
    requests/PIL/lxml). Must NOT touch 'asyncio' (pytest infra) or 'ipc.*'
    (unrelated to this test, and shared with cover_cache tests in the same run).

    关键：用 ``importlib.reload`` 原地重载 ``sources`` 而非 ``del sys.modules['sources']``。
    原地重载保持模块对象身份不变（``id()`` 与 ``__dict__`` 不变），使得其他测试文件
    （如 ``test_multi_source_parser.py``）在收集时 ``from sources import MultiSourceParser``
    绑定的类与工厂闭包，其 ``__globals__`` 仍指向当前 ``sources.__dict__`` ——
    ``monkeypatch.setattr(sources, "_load_parser_class", ...)`` 才能真正生效。
    若用 del+重导入，会产生新模块对象，旧类闭包的 ``__globals__`` 指向废弃字典，
    monkeypatch 失效，导致跨文件测试污染。
    """
    if "sources" in sys.modules:
        sources_mod = sys.modules["sources"]
        if hasattr(sources_mod, "_PARSER_CLASSES"):
            sources_mod._PARSER_CLASSES.clear()
    for m in list(sys.modules):
        if m.startswith("sources.") or m in ("requests", "PIL", "lxml"):
            del sys.modules[m]
    # 原地重载 sources：重新执行模块体（重置 _PARSER_CLASSES 为新空 dict），但保持
    # 模块对象身份与 __dict__ 一致，杜绝跨文件模块身份漂移。
    if "sources" in sys.modules:
        importlib.reload(sys.modules["sources"])
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


def test_concurrent_get_parser_constructs_each_source_once():
    """Concurrent _get_parser calls must construct each source's parser exactly once.

    IPC server runs request handlers in an 8-worker ThreadPoolExecutor; multiple
    threads can hit _get_parser for the same non-default source simultaneously.
    Before the lock, the check-then-act let two threads each run the factory,
    wasting a parser/Session. This test instruments the factory to count
    invocations and asserts exactly one per source under concurrency.
    """
    _clean()
    import sources

    sources._PARSER_CLASSES.clear()

    # Track factory invocation counts per source via a wrapper. We rebuild the
    # _factory dict so each call increments its counter before delegating.
    parser = sources.MultiSourceParser(default_source="hcomic")
    call_counts: dict[str, int] = {s: 0 for s in parser._factory}
    call_lock = threading.Lock()
    original_factory = dict(parser._factory)

    def counting(source: str):
        def wrapped():
            with call_lock:
                call_counts[source] += 1
            return original_factory[source]()

        return wrapped

    parser._factory = {s: counting(s) for s in original_factory}

    # Hammer several non-default sources concurrently from many threads.
    targets = ["jm", "bika", "moeimg", "copymanga"] * 16  # 64 threads, 16 per source
    barrier = threading.Barrier(len(targets))

    def worker(source: str):
        barrier.wait()  # release all threads simultaneously to maximize contention
        parser._get_parser(source)

    threads = [threading.Thread(target=worker, args=(s,)) for s in targets]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Each source's factory must have run exactly once despite 16 concurrent calls.
    for source in ("jm", "bika", "moeimg", "copymanga"):
        assert call_counts[source] == 1, (
            f"{source} factory invoked {call_counts[source]} times (expected 1); " "lazy init is not thread-safe"
        )
    # And the cached instance is shared across all callers (identity equality).
    jm_instance = parser._get_parser("jm")
    assert all(parser._get_parser("jm") is jm_instance for _ in range(10))
