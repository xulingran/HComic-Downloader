"""Tests for cache directory exposure (``db_dir`` property + ``handle_get_cache_dir``).

Covers the cache-directory-access capability:
- ``CoverCacheDB.db_dir`` / ``PreviewCacheDB.db_dir`` return an absolute,
  normalized path derived from the live DB instance (honoring injected paths).
- ``IPCServer.handle_get_cache_dir`` returns ``{dir: <abs path>}`` sourced from
  the cover cache instance, not a re-hardcoded default.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from ipc.cover_cache import CoverCacheDB  # noqa: E402
from ipc.preview_cache import PreviewCacheDB  # noqa: E402

from config import Config  # noqa: E402
from python.ipc_server import IPCServer  # noqa: E402


def test_cover_cache_db_dir_is_absolute_and_matches_injected_path(tmp_path):
    """注入自定义 db_path 时，db_dir 必须返回其规范化绝对路径。"""
    db_path = str(tmp_path / "cover_cache.db")
    cache = CoverCacheDB(db_path=db_path, max_size_mb=1)
    try:
        assert cache.db_dir == os.path.abspath(str(tmp_path))
        assert os.path.isabs(cache.db_dir)
    finally:
        cache.close()


def test_preview_cache_db_dir_is_absolute_and_matches_injected_path(tmp_path):
    """注入自定义 db_path 时，preview db_dir 必须返回其规范化绝对路径。

    封面与预览缓存共享同一根目录，故二者 db_dir 应一致。
    """
    db_path = str(tmp_path / "preview_cache.db")
    files_dir = str(tmp_path / "preview_cache")
    cache = PreviewCacheDB(db_path=db_path, files_dir=files_dir, max_size_mb=1)
    assert cache.db_dir == os.path.abspath(str(tmp_path))
    assert os.path.isabs(cache.db_dir)


def test_cover_cache_db_dir_default_ends_with_app_dir():
    """默认构造时，db_dir 必须以程序数据目录 ``.hcomic_downloader`` 结尾且为绝对路径。"""
    cache = CoverCacheDB(max_size_mb=1)
    try:
        assert os.path.isabs(cache.db_dir)
        assert cache.db_dir.endswith(os.path.join(os.path.expanduser("~"), ".hcomic_downloader"))
    finally:
        cache.close()


def _create_test_server(tmp_path) -> IPCServer:
    """实例化 IPCServer，patch 掉重网络/重 IO 依赖，仅保留缓存逻辑。

    注意：故意**不** patch CoverCacheDB，以便 handle_get_cache_dir 取到真实实例，
    从而验证路径来源于实例而非硬编码默认值。
    """
    from unittest.mock import MagicMock, patch

    with (
        patch("config.Config.load", return_value=Config()),
        patch("sources.MultiSourceParser", return_value=MagicMock()),
        patch("downloader.ComicDownloader", return_value=MagicMock()),
        patch("cbz_builder.CBZBuilder", return_value=MagicMock()),
        patch("download_manager.ComicDownloadManager", return_value=MagicMock()),
        patch("download_history.DownloadHistoryDB", return_value=MagicMock()),
        patch("concurrent.futures.ThreadPoolExecutor", MagicMock()),
        patch("album_coordinator.AlbumStagingCoordinator", return_value=MagicMock()),
        patch("ipc.library_mixin.get_default_library_db_path", return_value=str(tmp_path / "library.db")),
    ):
        return IPCServer()


def test_handle_get_cache_dir_returns_abs_path_from_cover_instance(tmp_path):
    """handle_get_cache_dir 必须返回 {dir: <abs path>}，且路径来自真实 cover 缓存实例。"""
    server = _create_test_server(tmp_path)
    result = server.handle_get_cache_dir()
    assert isinstance(result, dict)
    assert set(result.keys()) == {"dir"}
    assert isinstance(result["dir"], str)
    assert os.path.isabs(result["dir"])
    # 必须等于真实 cover 缓存实例的 db_dir（验证来源是实例而非重硬编码）
    assert result["dir"] == server._cover_cache.db_dir
    server._cover_cache.close()
    server._preview_cache.close()


def test_handle_get_cache_dir_default_dir_ends_with_app_dir(tmp_path):
    """默认部署下，返回的缓存目录必须以 .hcomic_downloader 结尾。"""
    server = _create_test_server(tmp_path)
    result = server.handle_get_cache_dir()
    assert result["dir"].endswith(os.path.join(os.path.expanduser("~"), ".hcomic_downloader"))
    server._cover_cache.close()
    server._preview_cache.close()
