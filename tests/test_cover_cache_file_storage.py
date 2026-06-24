"""Tests for CoverCacheDB file-storage architecture.

Covers the core contract after the ``data_uri``-inline → file-system migration:
- put / get round-trip byte consistency
- miss returns None
- LRU eviction deletes disk files
- clear_all deletes everything
- get_stats accuracy
- file deleted externally → get returns None
- reopen is idempotent and fast
"""

import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from ipc.cover_cache import CoverCacheDB  # noqa: E402

# 1×1 PNG bytes (valid image for detect_image_type)
_PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" "0000000d49444154789c63000100000005000100"
)
_PNG_DATA_URI = "data:image/png;base64," + base64.b64encode(_PNG_1x1).decode()


def _fresh_cache(tmp_path) -> CoverCacheDB:
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    return CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)


def test_put_get_roundtrip_byte_consistency(tmp_path):
    """put(data_uri) → get(url) returns identical decoded bytes."""
    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/1.jpg"
    cache.put(url, _PNG_DATA_URI)
    got = cache.get(url)
    assert got is not None
    _, b64 = got.split(",", 1)
    assert base64.b64decode(b64) == _PNG_1x1


def test_get_missing_returns_none(tmp_path):
    cache = _fresh_cache(tmp_path)
    assert cache.get("https://h-comic.com/cover/missing") is None


def test_put_get_mime_type_preserved(tmp_path):
    """MIME type (image/png) must be preserved in returned data URI."""
    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/png-test"
    cache.put(url, _PNG_DATA_URI)
    got = cache.get(url)
    assert got is not None
    assert got.startswith("data:image/png;base64,")


def test_lru_eviction_deletes_disk_file_and_record(tmp_path):
    """When cache exceeds max_size_mb, oldest entries' files are removed."""
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    # ~300 bytes holds ~3 entries. Putting 10 entries will evict ~7 of them.
    cache = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=300 / 1024 / 1024)
    urls = []
    for i in range(10):
        url = f"https://h-comic.com/cover/{i}.jpg"
        cache.put(url, _PNG_DATA_URI)
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
        cache.put(f"https://h-comic.com/cover/{i}.jpg", _PNG_DATA_URI)
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
    cache.put("https://h-comic.com/cover/a.jpg", _PNG_DATA_URI)
    stats = cache.get_stats()
    assert stats["file_count"] == 1
    # size is the decoded raw byte count (matches PreviewCacheDB / true disk
    # usage), NOT the base64 data-uri string length.
    assert stats["total_size_bytes"] == len(_PNG_1x1)


def test_external_file_deletion_returns_none(tmp_path):
    """When the backing file is removed externally, get returns None and cleans up."""
    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/ext-del"
    cache.put(url, _PNG_DATA_URI)
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
    cache.put("https://h-comic.com/cover/persist", _PNG_DATA_URI)
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
    cache.put("https://h-comic.com/cover/a", _PNG_DATA_URI)
    cache.clear_all()
    assert cache.get("https://h-comic.com/cover/a") is None
    cache.put("https://h-comic.com/cover/b", _PNG_DATA_URI)
    assert cache.get("https://h-comic.com/cover/b") is not None


def test_get_unrecognized_bytes_cleans_entry(tmp_path):
    """Bytes that are not a recognized image are purged: file + record + LRU.

    We bypass ``put`` (which would reject such bytes via detect_image_type on
    the get path only) and inject a corrupt file + record directly, then verify
    that ``get`` cleans it up symmetrically with the "file vanished externally"
    branch.
    """
    import hashlib

    cache = _fresh_cache(tmp_path)
    url = "https://h-comic.com/cover/corrupt"
    url_hash = hashlib.sha256(url.encode()).hexdigest()
    file_name = url_hash

    # Inject a backing file whose bytes are NOT a recognized image type
    # (detect_image_type returns "" for this magic).
    corrupt_bytes = b"\x00" * 64
    with open(os.path.join(cache._files_dir, file_name), "wb") as f:
        f.write(corrupt_bytes)
    cache._conn.execute(
        """INSERT OR REPLACE INTO cover_cache
           (url_hash, url, file_path, size, fetched_at, last_access)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (url_hash, url, file_name, len(corrupt_bytes), 0.0, 0.0),
    )
    cache._conn.commit()
    cache._lru[url] = None
    file_path = os.path.join(cache._files_dir, file_name)
    assert os.path.exists(file_path), "precondition: corrupt file present"

    # get() must return None and purge the entry.
    assert cache.get(url) is None, "unrecognized bytes should yield None and be purged"

    # File, record and LRU entry all gone.
    assert not os.path.exists(file_path), "corrupt file should be deleted after get"
    row = cache._conn.execute("SELECT 1 FROM cover_cache WHERE url = ?", (url,)).fetchone()
    assert row is None, "corrupt record should be deleted after get"
    assert url not in cache._lru, "corrupt entry should be removed from LRU"

    # A subsequent get is a clean miss (no decode retry).
    assert cache.get(url) is None
