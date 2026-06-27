"""Tests for CoverCacheDB legacy schema migration (data_uri inline → file storage).

Covers:
- Migration from old schema (with ``data_uri`` column) to new file-storage schema
- Idempotency: re-opening a migrated DB skips migration
- Interrupt-resume: partial migration (some rows marked migrated=1) continues
- Byte consistency before/after migration
"""

import base64
import hashlib
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from ipc.cover_cache import CoverCacheDB  # noqa: E402

_PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" "0000000d49444154789c63000100000005000100"
)


def _old_data_uri(label: int = 0) -> str:
    """Return a data URI whose base64 encodes the 1x1 PNG."""
    return "data:image/png;base64," + base64.b64encode(_PNG_1x1).decode()


def _create_legacy_db(db_path: str, count: int = 20) -> list[tuple[str, str, str]]:
    """Create a legacy-format cover_cache.db with *count* rows.

    Each data_uri encodes the same 1x1 PNG — this matches real-world usage
    where the base64 represents genuine image bytes.
    """
    conn = sqlite3.connect(db_path)
    conn.execute("""CREATE TABLE cover_cache (
            url_hash TEXT PRIMARY KEY,
            url      TEXT NOT NULL,
            data_uri TEXT NOT NULL,
            size     INTEGER NOT NULL DEFAULT 0,
            fetched_at REAL NOT NULL
        )""")
    du = _old_data_uri()  # same bytes, same data_uri every row
    rows = []
    for i in range(count):
        url = f"https://h-comic.com/cover/legacy-{i}.jpg"
        uh = hashlib.sha256(url.encode()).hexdigest()
        rows.append((uh, url, du))
    conn.executemany(
        "INSERT INTO cover_cache (url_hash, url, data_uri, size, fetched_at) VALUES (?, ?, ?, ?, ?)",
        [(uh, url, du, len(du), float(i)) for uh, url, du in rows],
    )
    conn.commit()
    conn.close()
    return [(url, uh, du) for uh, url, du in rows]


def test_migrate_legacy_db(tmp_path):
    """Full migration from legacy schema: all rows moved to file storage."""
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    refs = _create_legacy_db(db_path)

    cache = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)

    # Schema should be clean (no data_uri / migrated columns)
    conn = sqlite3.connect(db_path)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(cover_cache)").fetchall()}
    conn.close()
    assert "data_uri" not in cols, f"data_uri column should be removed: {cols}"
    assert "migrated" not in cols, f"migrated column should be removed: {cols}"

    # All entries should be retrievable — get returns url_hash (= disk file
    # name); verify byte consistency by reading the backing file.
    for url, uh, _du in refs:
        got = cache.get(url)
        assert got is not None, f"get({url}) returned None after migration"
        assert got == uh, f"get({url}) returned wrong url_hash"
        with open(os.path.join(files_dir, got), "rb") as f:
            assert f.read() == _PNG_1x1, f"byte mismatch for {url}"

    stats = cache.get_stats()
    assert stats["file_count"] == len(refs), stats
    # Migration must record the true decoded byte count per entry (len(_PNG_1x1)),
    # never the legacy base64 string length.
    expected_total = len(_PNG_1x1) * len(refs)
    assert (
        stats["total_size_bytes"] == expected_total
    ), f"expected {expected_total} bytes ({len(_PNG_1x1)} * {len(refs)}), got {stats['total_size_bytes']}"
    cache.close()


def test_migration_idempotent(tmp_path):
    """Re-opening a migrated DB skips migration and data is intact."""
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    refs = _create_legacy_db(db_path)

    # First open — migrates
    cache1 = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)
    v1 = cache1.get(refs[0][0])
    cache1.close()

    # Second open — should skip migration
    import time

    t0 = time.perf_counter()
    cache2 = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)
    elapsed = (time.perf_counter() - t0) * 1000
    v2 = cache2.get(refs[0][0])
    cache2.close()

    assert v1 == v2, "url_hash should survive re-open"
    assert elapsed < 50, f"reopen took {elapsed:.1f}ms (no migration expected)"


def test_migration_interrupt_resume(tmp_path):
    """Simulate a crash mid-migration — remaining rows resume on next open."""
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")
    os.makedirs(files_dir, exist_ok=True)
    refs = _create_legacy_db(db_path, count=24)

    # Simulate partial migration: first 10 rows migrated=1 (files exist), rest pending
    conn = sqlite3.connect(db_path)
    conn.execute("ALTER TABLE cover_cache ADD COLUMN migrated INTEGER DEFAULT 0")
    conn.execute("ALTER TABLE cover_cache ADD COLUMN file_path TEXT")
    conn.execute("ALTER TABLE cover_cache ADD COLUMN last_access REAL DEFAULT 0")
    for i, (url, uh, du) in enumerate(refs):
        if i < 10:
            file_path = os.path.join(files_dir, uh)
            raw = base64.b64decode(du.split(",", 1)[1])
            with open(file_path, "wb") as f:
                f.write(raw)
            conn.execute(
                "UPDATE cover_cache SET file_path = ?, last_access = ?, migrated = 1 WHERE url_hash = ?",
                (uh, float(i), uh),
            )
    conn.commit()
    conn.close()
    assert len(os.listdir(files_dir)) == 10, f"expected 10 migrated files, got {len(os.listdir(files_dir))}"

    # Open — should resume migration for the remaining 14 rows
    cache = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)
    for url, uh, _du in refs:
        got = cache.get(url)
        assert got is not None, f"get({url}) returned None after resume"
        assert got == uh, f"get({url}) returned wrong url_hash after resume"
        with open(os.path.join(files_dir, got), "rb") as f:
            assert f.read() == _PNG_1x1, f"byte mismatch for {url} after resume"
    stats = cache.get_stats()
    assert stats["file_count"] == 24, f"expected 24 entries: {stats}"
    cache.close()

    # Final schema check
    conn = sqlite3.connect(db_path)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(cover_cache)").fetchall()}
    conn.close()
    assert "data_uri" not in cols, "data_uri should be gone after resume + finalize"


def test_fresh_db_no_migration(tmp_path):
    """A brand-new database (no legacy schema) should not attempt migration."""
    db_path = str(tmp_path / "cover_cache.db")
    files_dir = str(tmp_path / "cover_cache")

    import time

    t0 = time.perf_counter()
    cache = CoverCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=10)
    elapsed = (time.perf_counter() - t0) * 1000
    cache.put("https://h-comic.com/cover/fresh", _PNG_1x1)
    assert cache.get_stats()["file_count"] == 1
    cache.close()
    assert elapsed < 100, f"Fresh init took {elapsed:.1f}ms (expected < 100ms)"
