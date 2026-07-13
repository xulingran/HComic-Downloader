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
            "ipc.library_mixin.get_default_library_db_path",
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

    def test_default_chapter_sentinel_is_not_persisted(self, tmp_path):
        server = _create_test_server(tmp_path)
        asset_id = server._library_db.upsert_item(
            {
                "rel_path": "single-folder",
                "format": "folder",
                "title": "Single volume",
                "page_count": 3,
            }
        )

        result = server.handle_library_save_reading_progress(
            asset_id=asset_id,
            chapter_id="default",
            page=9,
            total_pages=99,
        )

        assert result == {"success": True}
        stored = server._library_db.get_reading_progress(asset_id)
        assert stored is not None
        assert stored["chapter_id"] is None
        assert stored["page"] == 3
        assert stored["total_pages"] == 3
        detail = server.handle_library_detail(asset_id)
        assert detail["readingChapterId"] is None
        assert detail["readingPage"] == 3


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


class TestLibraryRenamePathSafety:
    """验证 _rename_library_asset 的路径防御纵深与错误消息收敛。

    直接测试私有方法以隔离 _resolve_asset_path 的 size/mtime 匹配，
    聚焦本次变更引入的 realpath 边界校验、同名拒绝与消息收敛。
    """

    @staticmethod
    def _seed_cbz_asset(server: IPCServer, tmp_path, rel_path: str, content: bytes = b"data") -> str:
        """在 download_dir 下创建真实 CBZ 文件并以匹配的 size/mtime 入库。"""
        cbz_path = tmp_path / rel_path
        cbz_path.parent.mkdir(parents=True, exist_ok=True)
        cbz_path.write_bytes(content)
        stat = os.stat(cbz_path)
        return server._library_db.upsert_item(
            {
                "rel_path": rel_path,
                "format": "cbz",
                "title": rel_path,
                "size_bytes": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
            }
        )

    def test_rename_rejects_target_outside_download_dir(self, tmp_path):
        """清洗后目标经 realpath 落在根目录之外时拒绝，源文件不动。

        正则清洗已剥离路径分隔符，此场景属防御纵深（防止 realpath 解析出逃逸）。
        通过 patch os.path.realpath 使目标解析到根目录之外，确定性触发边界断言。
        """
        server = _create_test_server(tmp_path)
        rel_path = "comic.cbz"
        asset_id = self._seed_cbz_asset(server, tmp_path, rel_path)
        real_path = os.path.join(os.path.realpath(str(tmp_path)), rel_path)
        original_bytes = (tmp_path / rel_path).read_bytes()

        root = os.path.realpath(str(tmp_path))
        outside = os.path.join(os.path.dirname(root), "escape.cbz")
        original_realpath = os.path.realpath

        def fake_realpath(p, *args, **kwargs):  # noqa: ANN002, ANN003
            # 仅对目标路径（newname.cbz 拼接）返回逃逸路径；其余路径保持真实解析。
            if isinstance(p, str) and p.endswith(os.path.join(root, "newname.cbz")):
                return outside
            return original_realpath(p, *args, **kwargs)

        with (
            patch("ipc.library_mixin.os.path.realpath", side_effect=fake_realpath),
            pytest.raises(ValueError) as exc_info,
        ):
            server._rename_library_asset(asset_id, real_path, "newname.cbz", True)
        assert "新名称无效" in str(exc_info.value)

        # 源文件字节未变
        assert (tmp_path / rel_path).read_bytes() == original_bytes

    def test_rename_rejects_same_name_after_normalization(self, tmp_path):
        """清洗+realpath 后等于源路径时返回「新名称与原名相同」。"""
        server = _create_test_server(tmp_path)
        rel_path = "comic.cbz"
        asset_id = self._seed_cbz_asset(server, tmp_path, rel_path)
        real_path = os.path.join(os.path.realpath(str(tmp_path)), rel_path)

        # 提交与原名相同的名称（仅大小写差异在 Windows realpath 下归一为相同路径）
        with pytest.raises(ValueError) as exc_info:
            server._rename_library_asset(asset_id, real_path, "comic.cbz", True)
        assert "新名称与原名相同" in str(exc_info.value)

    def test_rename_failure_message_does_not_leak_download_dir(self, tmp_path):
        """rename 失败时返回给前端的消息不含 download_dir 绝对路径。"""
        server = _create_test_server(tmp_path)
        rel_path = "comic.cbz"
        asset_id = self._seed_cbz_asset(server, tmp_path, rel_path)
        real_path = os.path.join(os.path.realpath(str(tmp_path)), rel_path)

        # 构造一个合法新名，但 patch os.rename 抛 OSError（含模拟路径的内部错误）
        # 验证最终 ValueError 消息不含 download_dir 绝对路径。
        download_dir_abs = os.path.realpath(str(tmp_path))
        with (
            patch("ipc.library_mixin.os.rename", side_effect=OSError(f"mock fail at {download_dir_abs}/x")),
            pytest.raises(ValueError) as exc_info,
        ):
            server._rename_library_asset(asset_id, real_path, "newname.cbz", True)

        message = str(exc_info.value)
        assert download_dir_abs not in message
        assert "重命名失败" in message
