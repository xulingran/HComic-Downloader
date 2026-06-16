"""IPC 契约运行时测试。

验证 Python 后端关键方法的返回结构符合前端 TypeScript 类型定义（shared/types.ts），
防止前后端契约漂移。进程内实例化 IPCServer（解析器以 fixture 注入），不 spawn 子进程。
对应 behavior-integration-tests spec。

契约真相源：shared/types.ts 的 AppConfig / SearchResult / ComicInfo / PaginationInfo。
若 Python 端返回结构与前端类型不一致，此处必须失败。
"""

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from config import Config  # noqa: E402
from python.ipc_server import IPCServer  # noqa: E402

# ── 契约真相源（从 shared/types.ts AppConfig 必需字段提取）────────────────
# 这些是前端 AppConfig 中非可选（非 ?）的字段，Python get_config 必须全部返回。
# 若前端类型新增必需字段而 Python 未跟上，此处失败，提示补齐。
APP_CONFIG_REQUIRED_KEYS: dict[str, type] = {
    "themeMode": str,
    "outputFormat": str,
    "downloadDir": str,
    "concurrentDownloads": int,
    "timeout": int,
    "retryTimes": int,
    "cbzFilenameTemplate": str,
    "batchDownloadDelay": int,
    "autoRetryMaxAttempts": int,
    "notifyOnComplete": bool,
    "notifyWhenForeground": str,
    "defaultSource": str,
    "fontName": str,
    "fontSize": int,
    "sfwMode": bool,
    "cardStyle": str,
    "tagBlacklist": dict,
    "duplicateBlacklist": dict,
    "previewCacheSizeLimitMB": int,
}

# ComicInfo 必需字段（shared/types.ts:8-26 非 ? 字段）
COMIC_INFO_REQUIRED_KEYS: dict[str, type] = {
    "id": str,
    "title": str,
    "url": str,
    "coverUrl": str,
    "source": str,
}

# PaginationInfo 必需字段（shared/types.ts:28-32）
PAGINATION_REQUIRED_KEYS: dict[str, type] = {
    "currentPage": int,
    "totalPages": int,
    "totalItems": int,
}


def _create_test_server() -> IPCServer:
    """实例化 IPCServer，patch 掉重网络/重 IO 依赖，仅保留配置与契约逻辑。

    每个测试调用一次新建实例，故测试内可就地修改 server.parser / server.config
    而不会跨用例泄漏。若未来改为 fixture 复用，需用 monkeypatch 改属性以自动还原。
    """
    with (
        patch("config.Config.load", return_value=Config()),
        patch("sources.MultiSourceParser", return_value=MagicMock()),
        patch("downloader.ComicDownloader", return_value=MagicMock()),
        patch("cbz_builder.CBZBuilder", return_value=MagicMock()),
        patch("download_manager.ComicDownloadManager", return_value=MagicMock()),
        patch("download_history.DownloadHistoryDB", return_value=MagicMock()),
        patch("concurrent.futures.ThreadPoolExecutor", MagicMock()),
        patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()),
        patch("album_coordinator.AlbumStagingCoordinator", return_value=MagicMock()),
    ):
        return IPCServer()


# ── 场景：get_config 返回结构匹配前端 AppConfig 类型 ──────────────────────


def test_get_config_returns_structure_matching_app_config_type():
    """get_config 必须返回 {config: {...}}，其中 config 包含前端 AppConfig 的全部必需字段。

    这防止「Python config_mixin 改了字段名/类型，但前端 AppConfig 未同步」的漂移。
    """
    server = _create_test_server()
    result = server.handle_get_config()

    assert isinstance(result, dict)
    assert "config" in result, "get_config 必须返回 {config: ...}"
    config = result["config"]
    assert isinstance(config, dict)

    missing = [k for k in APP_CONFIG_REQUIRED_KEYS if k not in config]
    assert not missing, f"get_config 缺少前端 AppConfig 必需字段: {missing}"

    type_mismatches = []
    for key, expected_type in APP_CONFIG_REQUIRED_KEYS.items():
        value = config[key]
        # bool 是 int 的子类，单独校验 bool 字段不误判为 int
        if expected_type is int and isinstance(value, bool):
            type_mismatches.append(f"{key}: 期望 int，实际 bool")
        elif not isinstance(value, expected_type):
            type_mismatches.append(f"{key}: 期望 {expected_type.__name__}，实际 {type(value).__name__}")
    assert not type_mismatches, f"get_config 字段类型不匹配 AppConfig: {type_mismatches}"

    # outputFormat 受限于前端联合类型 'folder' | 'zip' | 'cbz'
    assert config["outputFormat"] in (
        "folder",
        "zip",
        "cbz",
    ), f"outputFormat 必须 ∈ folder|zip|cbz，实际 {config['outputFormat']!r}"
    # themeMode 受限于 'light' | 'dark' | 'auto'
    assert config["themeMode"] in (
        "light",
        "dark",
        "auto",
    ), f"themeMode 必须 ∈ light|dark|auto，实际 {config['themeMode']!r}"
    # cardStyle 受限于 'cover' | 'detailed'
    assert config["cardStyle"] in (
        "cover",
        "detailed",
    ), f"cardStyle 必须 ∈ cover|detailed，实际 {config['cardStyle']!r}"


# ── 场景：search 返回结构匹配前端 SearchResult 类型 ──────────────────────


def test_search_returns_structure_matching_search_result_type():
    """search 必须返回 {comics: [...], pagination: {...}}，结构匹配前端 SearchResult。

    用注入的假解析器返回构造好的 ComicInfo，验证 _comic_to_dict 序列化后字段匹配前端契约。
    """
    server = _create_test_server()

    # 构造一个完整的 ComicInfo，经 _comic_to_dict 序列化后验证前端必需字段
    from models import ComicInfo

    fake_comic = ComicInfo(
        id="contract_001",
        title="契约测试漫画",
        preview_url="https://example.com/comic/1",  # Python 字段，序列化为前端 url
        cover_url="https://example.com/cover.jpg",  # 序列化为前端 coverUrl
        source_site="hcomic",
        comic_source="MMCG_SHORT",
        author="作者",
        pages=5,
    )

    fake_parser = SimpleNamespace(
        search=lambda *a, **kw: ([fake_comic], SimpleNamespace(current_page=1, total_pages=3, total_items=25)),
    )
    # handle_search 调用 MultiSourceParser.search（分发层），它返回 (comics, pagination)。
    # server 每测试新建（见 _create_test_server），故可就地替换 parser 而无跨用例泄漏。
    server.parser = fake_parser
    server.config.default_source = "hcomic"

    result = server.handle_search(query="测试", mode="keyword", page=1, source="hcomic")

    assert isinstance(result, dict)
    assert "comics" in result and "pagination" in result, "search 必须返回 {comics, pagination}，匹配前端 SearchResult"

    comics = result["comics"]
    assert isinstance(comics, list) and len(comics) == 1
    comic = comics[0]

    missing = [k for k in COMIC_INFO_REQUIRED_KEYS if k not in comic]
    assert not missing, f"search 返回的 comic 缺少前端 ComicInfo 必需字段: {missing}"
    type_mismatches = [
        f"{k}: 期望 {t.__name__}，实际 {type(comic[k]).__name__}"
        for k, t in COMIC_INFO_REQUIRED_KEYS.items()
        if not isinstance(comic[k], t)
    ]
    assert not type_mismatches, f"comic 字段类型不匹配 ComicInfo: {type_mismatches}"

    pagination = result["pagination"]
    assert isinstance(pagination, dict)
    missing_pg = [k for k in PAGINATION_REQUIRED_KEYS if k not in pagination]
    assert not missing_pg, f"pagination 缺少前端 PaginationInfo 必需字段: {missing_pg}"
    pg_type_mismatches = [
        f"{k}: 期望 {t.__name__}，实际 {type(pagination[k]).__name__}"
        for k, t in PAGINATION_REQUIRED_KEYS.items()
        if not isinstance(pagination[k], t) or (t is int and isinstance(pagination[k], bool))
    ]
    assert not pg_type_mismatches, f"pagination 字段类型不匹配: {pg_type_mismatches}"
