"""Tests for CoverCacheDB file-storage architecture.

Covers the core contract after the ``data_uri``-inline → file-system migration
and the subsequent ``get → url_hash`` / ``put → raw_bytes`` contract change
(optimize-image-memory-pipeline):
- put(raw_bytes) / get(url) round-trip (get returns url_hash, not data URI)
- miss returns None
- LRU eviction deletes disk files
- clear_all deletes everything
- get_stats accuracy
- file deleted externally → get returns None
- reopen is idempotent and fast
"""

import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from ipc.cover_cache import CoverCacheDB  # noqa: E402

# 1×1 PNG bytes (valid image for detect_image_type)
_PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" "0000000d49444154789c63000100000005000100"
)


def _fresh_cache(tmp_path) -> CoverCacheDB:
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    return CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)


def _file_path(cache, url_or_hash: str) -> str:
    return os.path.join(cache._files_dir, url_or_hash)


def test_put_get_returns_url_hash(tmp_path):
    """put(raw_bytes) → get(url) returns the url_hash (= disk file name)."""
    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/1.jpg"
    cache.put(url, _PNG_1x1)
    got = cache.get(url)
    assert got is not None
    # url_hash is sha256(url).hexdigest(), also the disk file name
    expected_hash = hashlib.sha256(url.encode()).hexdigest()
    assert got == expected_hash
    # The backing file holds the original raw bytes
    with open(_file_path(cache, got), "rb") as f:
        assert f.read() == _PNG_1x1


def test_get_missing_returns_none(tmp_path):
    cache = _fresh_cache(tmp_path)
    assert cache.get("https://h-comic.com/cover/missing") is None


def test_put_get_returns_filename_not_data_uri(tmp_path):
    """get() must NOT return a base64 data URI — it returns the bare url_hash."""
    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/png-test"
    cache.put(url, _PNG_1x1)
    got = cache.get(url)
    assert got is not None
    assert not got.startswith("data:"), "get must return url_hash, not a data URI"
    assert got == hashlib.sha256(url.encode()).hexdigest()


def test_lru_eviction_deletes_disk_file_and_record(tmp_path):
    """When cache exceeds max_size_mb, oldest entries' files are removed."""
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    # ~300 bytes holds ~3 entries. Putting 10 entries will evict ~7 of them.
    cache = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=300 / 1024 / 1024)
    urls = []
    for i in range(10):
        url = f"https://h-comic.com/cover/{i}.jpg"
        cache.put(url, _PNG_1x1)
        urls.append(url)

    # At least some entries should have been evicted
    stats = cache.get_stats()
    assert stats["file_count"] < 10, f"Expected eviction, got {stats['file_count']} entries"
    # Evicted entries should return None
    evicted_count = sum(1 for u in urls if cache.get(u) is None)
    assert evicted_count > 0, "No evicted entries found"


def test_clear_all_deletes_files_and_records(tmp_path):
    cache = _fresh_cache(tmp_path)
    for i in range(5):
        cache.put(f"https://h-comic.com/cover/{i}.jpg", _PNG_1x1)
    assert cache.get_stats()["file_count"] == 5
    cache.clear_all()
    stats = cache.get_stats()
    assert stats["file_count"] == 0
    assert stats["total_size_bytes"] == 0
    # Disk files should be gone
    files_dir = cache._files_dir
    assert not os.listdir(files_dir) or all(
        not os.path.isfile(os.path.join(files_dir, f)) for f in os.listdir(files_dir)
    )


def test_get_stats_accuracy(tmp_path):
    cache = _fresh_cache(tmp_path)
    assert cache.get_stats() == {"file_count": 0, "total_size_bytes": 0}
    cache.put("https://h-comic.com/cover/a.jpg", _PNG_1x1)
    stats = cache.get_stats()
    assert stats["file_count"] == 1
    # size is the raw byte count (matches PreviewCacheDB / true disk usage)
    assert stats["total_size_bytes"] == len(_PNG_1x1)


def test_external_file_deletion_returns_none(tmp_path):
    """When the backing file is removed externally, get returns None and cleans up."""
    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/ext-del"
    cache.put(url, _PNG_1x1)
    assert cache.get(url) is not None

    # Delete the backing file externally
    for f in os.listdir(cache._files_dir):
        os.remove(os.path.join(cache._files_dir, f))

    assert cache.get(url) is None, "get should return None after file deletion"


def test_reopen_idempotent_and_fast(tmp_path):
    """Reopening the same DB should be fast (no migration) and data intact."""
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    cache = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)
    cache.put("https://h-comic.com/cover/persist", _PNG_1x1)
    cache.close()

    import time

    t0 = time.perf_counter()
    cache2 = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)
    elapsed = (time.perf_counter() - t0) * 1000

    assert cache2.get("https://h-comic.com/cover/persist") is not None
    assert elapsed < 50, f"Reopen took {elapsed:.1f}ms, expected < 50ms"
    cache2.close()


def test_get_after_clear_then_put(tmp_path):
    """Clear then put + get should work as a fresh cache."""
    cache = _fresh_cache(tmp_path)
    cache.put("https://h-comic.com/cover/a", _PNG_1x1)
    cache.clear_all()
    assert cache.get("https://h-comic.com/cover/a") is None
    cache.put("https://h-comic.com/cover/b", _PNG_1x1)
    assert cache.get("https://h-comic.com/cover/b") is not None


def test_external_file_deletion_cleans_entry(tmp_path):
    """When get() hits but the backing file vanished externally, the record is purged.

    Note: after optimize-image-memory-pipeline, get() no longer deep-probes
    bytes (no detect_image_type). It only checks os.path.exists. So a file
    containing "unrecognized" bytes is still a hit — only a *missing* file
    triggers cleanup. This test pins the missing-file cleanup branch.
    """
    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/vanished"
    cache.put(url, _PNG_1x1)
    file_path = _file_path(cache, cache.get(url))
    assert os.path.exists(file_path)

    os.remove(file_path)  # simulate external deletion

    assert cache.get(url) is None
    row = cache._conn.execute("SELECT 1 FROM cover_cache WHERE url = ?", (url,)).fetchone()
    assert row is None, "record should be deleted after file vanished"
    assert url not in cache._lru
