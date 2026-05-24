"""Tests for PreviewCacheDB — hybrid file-system + SQLite cache for preview images."""
import os
import sys
import time
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from ipc.preview_cache import PreviewCacheDB


@pytest.fixture
def cache(tmp_path):
    """Create a PreviewCacheDB in a temp directory."""
    db_path = str(tmp_path / "preview_cache.db")
    files_dir = str(tmp_path / "preview_cache")
    return PreviewCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=1)


def test_put_and_get(cache):
    url = "https://example.com/images/1.webp"
    raw = b"pretend-webp-bytes"
    cache.put(url, raw)

    path = cache.get(url)
    assert path is not None
    assert os.path.exists(path)
    with open(path, "rb") as f:
        assert f.read() == raw


def test_get_miss_returns_none(cache):
    assert cache.get("https://example.com/not-cached.webp") is None


def test_put_updates_last_access(cache):
    url = "https://example.com/images/2.webp"
    cache.put(url, b"aaa")

    cache.get(url)

    url2 = "https://example.com/images/3.webp"
    cache.put(url2, b"bbb")

    cache.get(url)

    stats = cache.get_stats()
    assert stats["file_count"] == 2


def test_eviction_on_size_limit(cache):
    """When total size exceeds max, oldest-by-last-access entries are evicted."""
    cache.update_max_size(0.0002)  # ~200 bytes

    url1 = "https://example.com/a.webp"
    url2 = "https://example.com/b.webp"
    url3 = "https://example.com/c.webp"

    cache.put(url1, b"x" * 100)
    cache.put(url2, b"y" * 100)
    cache.get(url1)
    cache.put(url3, b"z" * 100)
    # url2 should be evicted (LRU), url1 and url3 remain
    assert cache.get(url2) is None
    assert cache.get(url1) is not None
    assert cache.get(url3) is not None


def test_get_stats(cache):
    cache.put("https://example.com/x.webp", b"12345")
    cache.put("https://example.com/y.webp", b"67890")

    stats = cache.get_stats()
    assert stats["file_count"] == 2
    assert stats["total_size_bytes"] == 10
    assert stats["max_size_bytes"] == 1 * 1024 * 1024


def test_clear_all(cache):
    cache.put("https://example.com/a.webp", b"aaa")
    cache.put("https://example.com/b.webp", b"bbb")
    paths = [cache.get("https://example.com/a.webp"), cache.get("https://example.com/b.webp")]

    cache.clear_all()

    assert cache.get_stats()["file_count"] == 0
    assert cache.get_stats()["total_size_bytes"] == 0
    for p in paths:
        assert not os.path.exists(p)


def test_update_max_size(cache):
    cache.update_max_size(200)
    assert cache.get_stats()["max_size_bytes"] == 200 * 1024 * 1024


def test_same_url_overwrites(cache):
    url = "https://example.com/overwrite.webp"
    cache.put(url, b"short")
    cache.put(url, b"much-longer-content")

    path = cache.get(url)
    assert path is not None
    with open(path, "rb") as f:
        assert f.read() == b"much-longer-content"
    assert cache.get_stats()["file_count"] == 1


def test_close(cache):
    cache.close()
    # Should not raise
