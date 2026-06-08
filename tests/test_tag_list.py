"""Tests for TagListDB (tag catalog persistence)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python.ipc.favourite_tags_mixin import FavouriteTagsDB
from python.ipc.tag_list_mixin import TagListDB, TagListMixin


def _make_db(tmp_path):
    return TagListDB(str(tmp_path / "tag_list.db"))


def test_upsert_tags_basic(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A", "tag:B", "tag:C"], "hcomic")
    tags, total = db.get_tags("hcomic")
    assert total == 3
    tag_names = {t["tag"] for t in tags}
    assert tag_names == {"tag:A", "tag:B", "tag:C"}


def test_upsert_tags_increments_count(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A", "tag:B"], "hcomic")
    db.upsert_tags(["tag:A", "tag:C"], "hcomic")
    tags, total = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["tag:A"] == 2
    assert tag_map["tag:B"] == 1
    assert tag_map["tag:C"] == 1
    assert total == 3


def test_upsert_tags_empty_strings_ignored(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A", "", "tag:B"], "hcomic")
    tags, total = db.get_tags("hcomic")
    assert total == 2
    tag_names = {t["tag"] for t in tags}
    assert tag_names == {"tag:A", "tag:B"}


def test_get_tags_sorted_by_count_desc(tmp_path):
    db = _make_db(tmp_path)
    # tag:common appears 3 times, tag:medium 2 times, tag:rare 1 time
    db.upsert_tags(["common", "medium", "rare"], "hcomic")
    db.upsert_tags(["common", "medium"], "hcomic")
    db.upsert_tags(["common"], "hcomic")
    tags, _ = db.get_tags("hcomic")
    counts = [t["count"] for t in tags]
    assert counts == sorted(counts, reverse=True)
    assert tags[0]["tag"] == "common"
    assert tags[0]["count"] == 3


def test_get_tags_keyword_filter(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["ab:one", "ab:two", "cd:three"], "hcomic")
    tags, total = db.get_tags("hcomic", keyword="ab")
    assert total == 2
    tag_names = {t["tag"] for t in tags}
    assert tag_names == {"ab:one", "ab:two"}


def test_get_tags_pagination(tmp_path):
    db = _make_db(tmp_path)
    for i in range(10):
        db.upsert_tags([f"tag:{i:02d}"], "hcomic")
    # Page 1, limit 3
    tags_p1, total = db.get_tags("hcomic", page=1, limit=3)
    assert total == 10
    assert len(tags_p1) == 3
    # Page 4, limit 3
    tags_p4, _ = db.get_tags("hcomic", page=4, limit=3)
    assert len(tags_p4) == 1  # Only 1 tag left


def test_get_tag_count(tmp_path):
    db = _make_db(tmp_path)
    assert db.get_tag_count("hcomic") == 0
    db.upsert_tags(["tag:A", "tag:B"], "hcomic")
    assert db.get_tag_count("hcomic") == 2


def test_different_sources_isolated(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A"], "hcomic")
    db.upsert_tags(["tag:X"], "jmcomic")
    hcomic_tags, hcomic_total = db.get_tags("hcomic")
    jmcomic_tags, jmcomic_total = db.get_tags("jmcomic")
    assert hcomic_total == 1
    assert jmcomic_total == 1
    assert hcomic_tags[0]["tag"] == "tag:A"
    assert jmcomic_tags[0]["tag"] == "tag:X"


def test_clear(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A", "tag:B"], "hcomic")
    db.clear("hcomic")
    tags, total = db.get_tags("hcomic")
    assert total == 0
    assert tags == []


def test_clear_only_affects_target_source(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A"], "hcomic")
    db.upsert_tags(["tag:X"], "jmcomic")
    db.clear("hcomic")
    assert db.get_tag_count("hcomic") == 0
    assert db.get_tag_count("jmcomic") == 1


def test_get_tags_empty_db(tmp_path):
    db = _make_db(tmp_path)
    tags, total = db.get_tags("hcomic")
    assert total == 0
    assert tags == []


def test_keyword_filter_case_insensitive(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["NTR", "ntr", "Netorare"], "hcomic")
    tags, total = db.get_tags("hcomic", keyword="ntr")
    # LIKE is case-insensitive by default in SQLite for ASCII
    assert total >= 2  # At least "NTR" and "ntr" match


def test_upsert_empty_list(tmp_path):
    db = _make_db(tmp_path)
    # Should not raise
    db.upsert_tags([], "hcomic")
    assert db.get_tag_count("hcomic") == 0


def test_keyword_no_match(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A", "tag:B"], "hcomic")
    tags, total = db.get_tags("hcomic", keyword="nonexistent")
    assert total == 0
    assert tags == []


def test_upsert_duplicate_tags_in_same_call(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_tags(["tag:A", "tag:A", "tag:A"], "hcomic")
    tags, _ = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["tag:A"] == 3


def test_seed_from_favourite_tags(tmp_path):
    """_seed_tag_list_from_favourites should populate empty TagListDB from FavouriteTagsDB."""
    fav_db = FavouriteTagsDB(str(tmp_path / "fav.db"))
    fav_db.upsert_comic("c1", "hcomic", ["tag:X", "tag:Y"])
    fav_db.upsert_comic("c2", "hcomic", ["tag:Y", "tag:Z"])

    tag_list_db = TagListDB(str(tmp_path / "tl.db"))

    class _Fake(TagListMixin):
        def __init__(self):
            self._tag_list_db = tag_list_db
            self._favourite_tags_db = fav_db

    fake = _Fake()
    fake._seed_tag_list_from_favourites()

    tags, total = tag_list_db.get_tags("hcomic")
    assert total == 3
    tag_names = {t["tag"] for t in tags}
    assert tag_names == {"tag:X", "tag:Y", "tag:Z"}


def test_seed_skips_if_already_has_data(tmp_path):
    """_seed_tag_list_from_favourites should not overwrite existing data."""
    fav_db = FavouriteTagsDB(str(tmp_path / "fav.db"))
    fav_db.upsert_comic("c1", "hcomic", ["fav:tag"])

    tag_list_db = TagListDB(str(tmp_path / "tl.db"))
    tag_list_db.upsert_tags(["existing:tag"], "hcomic")

    class _Fake(TagListMixin):
        def __init__(self):
            self._tag_list_db = tag_list_db
            self._favourite_tags_db = fav_db

    fake = _Fake()
    fake._seed_tag_list_from_favourites()

    tags, total = tag_list_db.get_tags("hcomic")
    assert total == 1
    assert tags[0]["tag"] == "existing:tag"


# ── LIKE wildcard escaping tests ──


def test_keyword_with_percent_wildcard_escaped(tmp_path):
    """The '%' character in keyword must be treated literally, not as LIKE wildcard."""
    db = _make_db(tmp_path)
    db.upsert_tags(["100%", "100abc", "tag:X"], "hcomic")
    tags, total = db.get_tags("hcomic", keyword="100%")
    # Should only match "100%" literally, not "100abc"
    assert total == 1
    assert tags[0]["tag"] == "100%"


def test_keyword_with_underscore_wildcard_escaped(tmp_path):
    """The '_' character in keyword must be treated literally, not as LIKE wildcard."""
    db = _make_db(tmp_path)
    db.upsert_tags(["tag_A", "tagX1", "tag:B"], "hcomic")
    tags, total = db.get_tags("hcomic", keyword="tag_A")
    # Should only match "tag_A" literally, not "tagX1"
    assert total == 1
    assert tags[0]["tag"] == "tag_A"


def test_keyword_with_backslash_escaped(tmp_path):
    """The '\\' character in keyword must be treated literally."""
    db = _make_db(tmp_path)
    db.upsert_tags(["path\\file", "pathXfile"], "hcomic")
    # Searching for "path\file" (one backslash) should match literally
    tags, total = db.get_tags("hcomic", keyword="path\\file")
    assert total == 1
    assert tags[0]["tag"] == "path\\file"


# ── Refresh data safety tests ──


def test_refresh_page1_failure_preserves_existing_data(tmp_path):
    """If refresh fails on page 1, existing data should remain intact."""
    import threading
    from unittest.mock import MagicMock

    tag_list_db = TagListDB(str(tmp_path / "tl.db"))
    tag_list_db.upsert_tags(["existing:A", "existing:B"], "hcomic")

    class _Fake(TagListMixin):
        def __init__(self):
            self._tag_list_db = tag_list_db
            self._favourite_tags_db = MagicMock()
            self.parser = MagicMock()
            self._refresh_lock = threading.Lock()

    fake = _Fake()
    fake.parser.search.side_effect = RuntimeError("network error")

    import contextlib
    with contextlib.suppress(RuntimeError):
        fake.handle_refresh_tag_list("hcomic")

    # Existing data must still be there
    tags, total = tag_list_db.get_tags("hcomic")
    assert total == 2
    tag_names = {t["tag"] for t in tags}
    assert tag_names == {"existing:A", "existing:B"}


def test_refresh_later_page_failure_preserves_partial_data(tmp_path):
    """If later pages fail, the refresh should still commit whatever was collected."""
    import threading
    from unittest.mock import MagicMock

    from models import ComicInfo

    tag_list_db = TagListDB(str(tmp_path / "tl.db"))

    class _Fake(TagListMixin):
        def __init__(self):
            self._tag_list_db = tag_list_db
            self._favourite_tags_db = MagicMock()
            self.parser = MagicMock()
            self._refresh_lock = threading.Lock()

    fake = _Fake()

    page1_comic = ComicInfo(id="c1", title="T1", tags=["new:A", "new:B"])
    fake.parser.search.side_effect = [
        # Page 1 succeeds
        ([page1_comic], MagicMock(total_pages=3)),
        # Page 2 fails
        RuntimeError("timeout"),
        # Page 3 fails
        RuntimeError("timeout"),
    ]

    result = fake.handle_refresh_tag_list("hcomic")
    assert result["totalPages"] == 1

    tags, total = tag_list_db.get_tags("hcomic")
    assert total == 2
    tag_names = {t["tag"] for t in tags}
    assert tag_names == {"new:A", "new:B"}


def test_refresh_concurrent_rejected(tmp_path):
    """Concurrent refresh should be rejected with error message."""
    import threading
    from unittest.mock import MagicMock

    tag_list_db = TagListDB(str(tmp_path / "tl.db"))

    class _Fake(TagListMixin):
        def __init__(self):
            self._tag_list_db = tag_list_db
            self._favourite_tags_db = MagicMock()
            self.parser = MagicMock()
            self._refresh_lock = threading.Lock()

    fake = _Fake()
    # Simulate a long-running search that blocks
    barrier = threading.Barrier(2)

    def slow_search(*args, **kwargs):
        barrier.wait()  # Ensure both threads are inside search
        return [], MagicMock(total_pages=1)

    fake.parser.search = slow_search

    results = []

    def run_refresh():
        results.append(fake.handle_refresh_tag_list("hcomic"))

    t1 = threading.Thread(target=run_refresh)
    t1.start()
    # Wait for first thread to acquire the lock
    barrier.wait()
    # Second call should be rejected
    result = fake.handle_refresh_tag_list("hcomic")
    assert "error" in result
    t1.join()

