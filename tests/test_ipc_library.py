"""漫画库 IPC mixin 契约测试。

验证 library_mixin 的方法返回结构符合 shared/types.ts 定义的类型，
以及 handler 注册到 _HANDLER_NAMES 映射。

进程内实例化，不 spawn 子进程。
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from python.ipc_server import IPCServer  # noqa: E402


def _create_test_server(tmp_path) -> IPCServer:
    """实例化 IPCServer，patch 重依赖，使用临时 library.db。"""
    with (
        patch("config.Config.load", return_value=MagicMock(download_dir=str(tmp_path))),
        patch("sources.MultiSourceParser", return_value=MagicMock()),
        patch("downloader.ComicDownloader", return_value=MagicMock()),
        patch("cbz_builder.CBZBuilder", return_value=MagicMock()),
        patch("download_manager.ComicDownloadManager", return_value=MagicMock()),
        patch("download_history.DownloadHistoryDB", return_value=MagicMock()),
        patch("concurrent.futures.ThreadPoolExecutor", MagicMock()),
        patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()),
        patch("album_coordinator.AlbumStagingCoordinator", return_value=MagicMock()),
        patch(
            "python.ipc.library_mixin.get_default_library_db_path",
            return_value=str(tmp_path / "library.db"),
        ),
    ):
        return IPCServer()


# ── Handler 注册测试 ────────────────────────────────────────────────


class TestHandlerRegistration:
    """验证 library handler 已注册到 _HANDLER_NAMES。"""

    def test_all_library_handlers_registered(self):
        expected_methods = [
            "library_list",
            "library_stats",
            "library_detail",
            "library_chapters",
            "library_scan_status",
            "library_start_scan",
            "library_cancel_scan",
            "library_get_reading_progress",
            "library_save_reading_progress",
        ]
        for method in expected_methods:
            assert method in IPCServer._HANDLER_NAMES, f"Missing handler for {method}"
            handler_name = IPCServer._HANDLER_NAMES[method]
            assert hasattr(IPCServer, handler_name), f"Handler method {handler_name} not defined"

    def test_library_mixin_in_inheritance(self):
        # IPCServer 内部以 ipc.library_mixin 导入（python/ 在 sys.path），
        # 测试也必须从同一路径导入以避免模块对象身份差异。
        from ipc.library_mixin import LibraryMixin

        assert issubclass(IPCServer, LibraryMixin)


# ── 返回结构契约测试 ────────────────────────────────────────────────


class TestLibraryListContract:
    """验证 library_list 返回结构匹配 LibraryListResult 类型。"""

    def test_returns_items_and_pagination(self, tmp_path):
        server = _create_test_server(tmp_path)
        result = server.handle_library_list()
        assert "items" in result
        assert isinstance(result["items"], list)
        assert "pagination" in result
        pg = result["pagination"]
        assert "currentPage" in pg
        assert "totalPages" in pg
        assert "totalItems" in pg

    def test_pagination_types(self, tmp_path):
        server = _create_test_server(tmp_path)
        result = server.handle_library_list(page=1, page_size=10)
        pg = result["pagination"]
        assert isinstance(pg["currentPage"], int)
        assert isinstance(pg["totalPages"], int)
        assert isinstance(pg["totalItems"], int)


class TestLibraryStatsContract:
    """验证 library_stats 返回结构匹配 LibraryStats 类型。"""

    def test_stats_structure(self, tmp_path):
        server = _create_test_server(tmp_path)
        result = server.handle_library_stats()
        assert "totalAssets" in result
        assert "totalPages" in result
        assert "totalSizeBytes" in result
        assert "byFormat" in result
        assert isinstance(result["byFormat"], dict)
        assert "bySource" in result
        assert "byHealth" in result


class TestLibraryScanStatusContract:
    """验证 library_scan_status 返回结构匹配 LibraryScanState 类型。"""

    def test_scan_status_structure(self, tmp_path):
        server = _create_test_server(tmp_path)
        result = server.handle_library_scan_status()
        required_keys = [
            "phase",
            "scanId",
            "isScanning",
            "current",
            "total",
            "currentLabel",
            "lastScanCompletedAt",
            "lastScanCancelled",
            "lastScanError",
        ]
        for key in required_keys:
            assert key in result, f"Missing key {key} in scan status"


class TestLibraryReadingProgressContract:
    """验证阅读进度接口契约。"""

    def test_get_progress_returns_none_for_unknown(self, tmp_path):
        server = _create_test_server(tmp_path)
        result = server.handle_library_get_reading_progress("nonexistent-asset")
        assert result is None

    def test_save_and_get_progress(self, tmp_path):
        server = _create_test_server(tmp_path)
        # 先插入一个资产
        asset_id = server._library_db.upsert_item(
            {
                "rel_path": "test.cbz",
                "format": "cbz",
                "title": "Test",
            }
        )
        result = server.handle_library_save_reading_progress(asset_id=asset_id, chapter_id=None, page=5, total_pages=30)
        assert result == {"success": True}
        progress = server.handle_library_get_reading_progress(asset_id)
        assert progress is not None
        assert progress["page"] == 5
        assert progress["totalPages"] == 30
        assert "lastReadAt" in progress


class TestLibraryDetailContract:
    """验证 library_detail 返回结构匹配 LibraryAssetDetail 类型。"""

    def test_detail_for_existing_asset(self, tmp_path):
        server = _create_test_server(tmp_path)
        asset_id = server._library_db.upsert_item(
            {
                "rel_path": "test.cbz",
                "format": "cbz",
                "title": "Test Comic",
                "author": "Author",
                "page_count": 10,
                "size_bytes": 5000,
            }
        )
        result = server.handle_library_detail(asset_id)
        required_keys = [
            "assetId",
            "title",
            "author",
            "tags",
            "sourceSite",
            "format",
            "pageCount",
            "sizeBytes",
            "chapters",
            "version",
        ]
        for key in required_keys:
            assert key in result, f"Missing key {key} in detail"

    def test_detail_raises_for_unknown_asset(self, tmp_path):
        server = _create_test_server(tmp_path)
        with pytest.raises(ValueError):
            server.handle_library_detail("nonexistent")
