import inspect
import json
import logging
import os
import sys
import threading
from concurrent.futures import Future as _ConcurrentFuture
from concurrent.futures import ThreadPoolExecutor
from logging.handlers import RotatingFileHandler
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import asyncio

# Add project root to sys.path so we can import existing modules
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# 日志配置：stderr（供 Electron 捕获）+ 文件双写（方案 A1）。
# 文件副本确保后端崩溃时已刷盘的日志不丢失；与 Electron 日志共用同一目录。
_CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
LOG_DIR = os.path.join(_CONFIG_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

_LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
_file_handler = RotatingFileHandler(
    os.path.join(LOG_DIR, "python.log"),
    maxBytes=5 * 1024 * 1024,
    backupCount=2,
    encoding="utf-8",
)
_file_handler.setFormatter(logging.Formatter(_LOG_FORMAT))

logging.basicConfig(
    level=logging.INFO,
    format=_LOG_FORMAT,
    handlers=[logging.StreamHandler(), _file_handler],
)
logger = logging.getLogger(__name__)

# 会话起始标记：诊断报告据此截取本次启动后的日志，避免历史累积干扰
logger.info("[session-start] python backend started")

# Re-export names used by test files:
#   tests/test_ipc_config_mapping.py -> CONFIG_KEY_MAP
#   tests/test_ipc_download_conflict.py -> _get_config_path
from ipc.auth_mixin import AuthMixin  # noqa: E402
from ipc.config_mixin import ConfigMixin  # noqa: E402
from ipc.cover_cache import CoverCacheDB  # noqa: E402
from ipc.cover_mixin import CoverMixin  # noqa: E402
from ipc.download_mixin import DownloadMixin  # noqa: E402
from ipc.favourite_tags_mixin import FavouriteTagsMixin  # noqa: E402
from ipc.history_mixin import HistoryMixin  # noqa: E402
from ipc.maintenance_mixin import MaintenanceMixin  # noqa: E402
from ipc.migration_mixin import MigrationMixin  # noqa: E402
from ipc.preview_mixin import PreviewMixin  # noqa: E402
from ipc.search_mixin import SearchMixin  # noqa: E402
from ipc.tag_list_mixin import TagListMixin  # noqa: E402
from ipc.types import (  # noqa: E402,F401
    _COVER_POOL_MAX_WORKERS,
    _PREVIEW_IMAGE_MAX_SIZE,
    _PREVIEW_POOL_MAX_WORKERS,
    _REQUEST_POOL_MAX_WORKERS,
    CONFIG_KEY_MAP,
    AuthRequiredError,
    _get_config_path,
)

from sources.base import AntiBotChallengeError  # noqa: E402


class IPCServer(
    SearchMixin,
    CoverMixin,
    PreviewMixin,
    DownloadMixin,
    ConfigMixin,
    AuthMixin,
    MigrationMixin,
    HistoryMixin,
    FavouriteTagsMixin,
    TagListMixin,
    MaintenanceMixin,
):
    def __init__(self):
        import time as _time

        # Startup phase timing. Enabled via HCOMIC_PROFILE_STARTUP=1 so it is
        # zero-cost in production and available on demand for regression checks.
        _profile = os.environ.get("HCOMIC_PROFILE_STARTUP") == "1"
        _t0 = _time.perf_counter()
        _last = {"t": _t0}  # mutable closure holding the timestamp of the previous mark

        def _mark(label: str) -> None:
            if _profile:
                now = _time.perf_counter()
                logger.info(
                    "[startup-timing] %-28s %6.1f ms (Δ%6.1f)",
                    label,
                    (now - _t0) * 1000,
                    (now - _last["t"]) * 1000,
                )
                _last["t"] = now

        _mark("init-start")

        from cbz_builder import CBZBuilder
        from config import Config
        from download_manager import ComicDownloadManager
        from downloader import ComicDownloader
        from sources import MultiSourceParser

        _mark("imports (lazy)")

        try:
            self.config = Config.load(_get_config_path())
        except Exception as e:
            logger.warning("Config load failed, using defaults: %s", e)
            self.config = Config()
        self._emit_progress(25, "配置已加载")
        _mark("config-loaded")
        self.parser = MultiSourceParser(
            default_source=self.config.default_source,
            source_auth=self.config.source_auth,
            bika_image_quality=self.config.bika_image_quality,
            jm_domain=self.config.jm_domain,
        )
        self._emit_progress(35, "解析器已就绪")
        _mark("parser-ready")
        self.downloader = ComicDownloader(
            concurrent_downloads=self.config.concurrent_downloads,
            timeout=self.config.timeout,
            retry_times=self.config.retry_times,
        )
        saved_auth = self.config.source_auth.get("hcomic", {})
        if saved_auth:
            self.downloader.configure_auth(
                cookie=saved_auth.get("cookie", ""),
                user_agent=saved_auth.get("user_agent", ""),
            )
        self.cbz_builder = CBZBuilder(
            filename_template=self.config.cbz_filename_template,
            config=self.config,
        )
        self._download_manager = ComicDownloadManager(
            downloader=self.downloader,
            cbz_builder=self.cbz_builder,
            output_dir=self.config.download_dir,
            prepare_comic=self.parser.prepare_for_download,
            output_format=self.config.output_format,
        )
        self._download_manager.set_auto_retry_max_attempts(self.config.auto_retry_max_attempts)
        self._download_manager.set_delay_after(self.config.batch_download_delay)
        self._download_manager.set_callbacks(on_task_update=self._on_download_update)
        self._download_manager.start()
        self._emit_progress(50, "下载引擎已就绪")
        _mark("download-engine-ready")

        # Download history database
        from download_history import DownloadHistoryDB

        self._history_db = DownloadHistoryDB(
            os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "download_history.db")
        )
        self._download_manager.on_download_success = self._on_download_success_record

        # Album staging coordinator for multi-chapter comics
        from album_coordinator import AlbumStagingCoordinator

        self._album_coordinator = AlbumStagingCoordinator(
            download_dir_provider=lambda: self.config.download_dir,
            output_format_provider=lambda: self.config.output_format,
            cbz_builder=self.cbz_builder,
            history_db=self._history_db,
            on_album_event=self._on_album_event,
        )
        self._download_manager.set_album_coordinator(self._album_coordinator)

        # Thread pool for async cover fetches — keeps main loop responsive
        self._cover_executor = ThreadPoolExecutor(max_workers=_COVER_POOL_MAX_WORKERS, thread_name_prefix="cover")
        try:
            # Reader page fetches must not queue behind cover thumbnails.
            self._preview_executor = ThreadPoolExecutor(
                max_workers=_PREVIEW_POOL_MAX_WORKERS, thread_name_prefix="preview"
            )
        except Exception:
            self._cover_executor.shutdown(cancel_futures=True, wait=False)
            raise
        try:
            # General-purpose request pool for all non-cover/non-preview handlers.
            # See docs/superpowers/specs/2026-06-13-ipc-async-main-loop-design.md
            self._request_executor = ThreadPoolExecutor(
                max_workers=_REQUEST_POOL_MAX_WORKERS, thread_name_prefix="request"
            )
        except Exception:
            self._cover_executor.shutdown(cancel_futures=True, wait=False)
            self._preview_executor.shutdown(cancel_futures=True, wait=False)
            raise
        self._emit_progress(65, "线程池已就绪")
        _mark("thread-pools-ready")
        self._stdout_lock = threading.Lock()
        # 序列化 config 写入：避免并发 set_config 同时 os.replace 同一文件导致 WinError 5
        self._config_write_lock = threading.Lock()
        self._cover_cache = CoverCacheDB(
            max_size_mb=getattr(self.config, "preview_cache_size_limit_mb", 500),
        )
        _mark("cover-cache-ready")

        from ipc.preview_cache import PreviewCacheDB

        self._preview_cache = PreviewCacheDB(
            max_size_mb=getattr(self.config, "preview_cache_size_limit_mb", 500),
        )
        _mark("preview-cache-ready")

        # Migration engine
        self._init_migration()

        # Reading history database
        self._init_reading_history()

        # Favourite tags index database
        self._init_favourite_tags()

        # Tag list catalog database
        self._init_tag_list()
        self._emit_progress(85, "数据库已就绪")
        _mark("all-dbs-ready")

        # Pre-compute handler parameter sets for request routing
        self._handler_param_keys: dict[str, set[str] | None] = {}
        for _method_name, attr_name in self._HANDLER_NAMES.items():
            handler = getattr(self, attr_name)
            sig = inspect.signature(handler)
            has_var_keyword = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
            self._handler_param_keys[attr_name] = None if has_var_keyword else set(sig.parameters.keys())
        self._emit_progress(95, "准备就绪")
        _mark("handler-params-ready")
        if _profile:
            logger.info("[startup-timing] init total: %.1f ms", (_time.perf_counter() - _t0) * 1000)

    def _emit_progress(self, percent: int, label: str) -> None:
        """向 Electron 主进程输出启动进度信号。

        格式：PROGRESS:<percent>:<label>（单行，写入 stderr，立即 flush）。
        Electron 的 PythonBridge 解析此行后通过 STARTUP_PROGRESS IPC 通道转发到渲染进程。
        走 stderr 而非 stdout：stdout 仅用于 JSON-RPC 响应，ready gate 契约不受影响。

        Args:
            percent: 进度百分比 0-100，调用方必须保证单调递增。
            label: 当前阶段中文文案，禁止含冒号（避免解析歧义）。
        """
        # 开发期断言：percent 必须单调递增。生产路径无开销（assert 在 -O 下被移除）。
        # 调用方顺序错误时尽早暴露，避免前端靠单调保护静默吞掉回退。
        # 用 getattr 兜底：测试用 __new__ 绕过 __init__ 时 _last_progress 未初始化。
        last = getattr(self, "_last_progress", None)
        assert last is None or percent >= last, f"进度回退：{last} -> {percent}（label={label}）"
        self._last_progress = percent
        print(f"PROGRESS:{percent}:{label}", file=sys.stderr, flush=True)

    # ── album event notification ─────────────────────────────────────────

    def _on_album_event(self, album_key, event, **kwargs):
        """推送 album_progress JSON-RPC 通知到 stdout。"""
        notification = {
            "jsonrpc": "2.0",
            "method": "album_progress",
            "params": {
                "sourceSite": album_key[0],
                "albumId": album_key[1],
                "event": event,
                **kwargs,
            },
        }
        self._write_response(notification)

    # ── thread-safe stdout ────────────────────────────────────────────────

    def _write_response(self, response: dict) -> None:
        """Write a JSON-RPC response/notification to stdout atomically."""
        with self._stdout_lock:
            print(json.dumps(response), flush=True)

    # ── request routing ───────────────────────────────────────────────────

    _HANDLER_NAMES: dict[str, str] = {
        "search": "handle_search",
        "random": "handle_random",
        "download": "handle_download",
        "check_download_conflict": "handle_check_download_conflict",
        "get_favourites": "handle_get_favourites",
        "parse_jm_favourites_snapshot": "handle_parse_jm_favourites_snapshot",
        "parse_jm_search_snapshot": "handle_parse_jm_search_snapshot",
        "parse_jm_home_snapshot": "handle_parse_jm_home_snapshot",
        "add_to_favourites": "handle_add_to_favourites",
        "check_favourite": "handle_check_favourite",
        "remove_from_favourites": "handle_remove_from_favourites",
        "apply_auth": "handle_apply_auth",
        "verify_auth": "handle_verify_auth",
        "moeimg_login": "handle_moeimg_login",
        "bika_login": "handle_bika_login",
        "bika_categories": "handle_bika_categories",
        "hcomic_login": "handle_hcomic_login",
        "nh_login": "handle_nh_login",
        "get_config": "handle_get_config",
        "set_config": "handle_set_config",
        "get_downloads": "handle_get_downloads",
        "cancel_download": "handle_cancel_download",
        "shutdown": "handle_shutdown",
        "pause_task": "handle_pause_task",
        "resume_task": "handle_resume_task",
        "retry_task": "handle_retry_task",
        "toggle_global_pause": "handle_toggle_global_pause",
        "get_proxy_status": "handle_get_proxy_status",
        "get_available_fonts": "handle_get_available_fonts",
        "get_jm_domains": "handle_get_jm_domains",
        "open_download_dir": "handle_open_download_dir",
        "get_download_detail": "handle_get_download_detail",
        "get_preview_urls": "handle_get_preview_urls",
        "get_chapter_preview_urls": "handle_get_chapter_preview_urls",
        "fetch_preview_image": "handle_fetch_preview_image",
        "check_downloaded_status": "handle_check_downloaded_status",
        "get_comic_detail": "handle_get_comic_detail",
        "start_migration": "handle_start_migration",
        "confirm_migration": "handle_confirm_migration",
        "pause_migration": "handle_pause_migration",
        "resume_migration": "handle_resume_migration",
        "cancel_migration": "handle_cancel_migration",
        "get_migration_status": "handle_get_migration_status",
        "resolve_unmatched": "handle_resolve_unmatched",
        "get_cache_stats": "handle_get_cache_stats",
        "get_cache_dir": "handle_get_cache_dir",
        "get_image_cache_dirs": "handle_get_image_cache_dirs",
        "open_cache_dir": "handle_open_cache_dir",
        "clear_preview_cache": "handle_clear_preview_cache",
        "clear_all_cache": "handle_clear_all_cache",
        "get_history": "handle_get_history",
        "add_history": "handle_add_history",
        "delete_history": "handle_delete_history",
        "clear_history": "handle_clear_history",
        "get_favourite_tags": "handle_get_favourite_tags",
        "clear_favourite_tags": "handle_clear_favourite_tags",
        "remove_favourite_tag": "handle_remove_favourite_tag",
        "sync_favourite_tags": "handle_sync_favourite_tags",
        "get_tag_list": "handle_get_tag_list",
        "refresh_tag_list": "handle_refresh_tag_list",
        "force_pack_album": "handle_force_pack_album",
        "get_album_progress": "handle_get_album_progress",
        "pause_album": "handle_pause_album",
        "resume_album": "handle_resume_album",
        "cancel_album": "handle_cancel_album",
        "download_batch_as_album": "handle_download_batch_as_album",
        "run_health_check": "handle_run_health_check",
        "scan_orphan_temps": "handle_scan_orphan_temps",
        "cleanup_orphan_temps": "handle_cleanup_orphan_temps",
        "get_storage_stats": "handle_get_storage_stats",
    }

    async def _dispatch_request(self, request: dict) -> None:
        """Asyncio dispatch path: route a request to its handler.

        - For ``async def`` handlers, await directly on the running loop
          (Stage B back-door).
        - For sync handlers, submit to ``_request_executor`` via
          ``loop.run_in_executor`` so the main loop stays responsive.
        """
        import asyncio  # delayed: only the running server needs it (~58ms saved at import)

        method = request.get("method")
        req_id = request.get("id")
        params = request.get("params", {})

        if not method or not isinstance(method, str):
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32600, "message": "Missing or invalid method"},
                }
            )
            return

        attr_name = self._HANDLER_NAMES.get(method)
        if not attr_name:
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                }
            )
            return

        handler = getattr(self, attr_name)
        param_keys = self._handler_param_keys.get(attr_name)
        valid_params = {k: v for k, v in params.items() if k in param_keys} if param_keys is not None else params

        loop = asyncio.get_running_loop()
        try:
            if inspect.iscoroutinefunction(handler):
                # Stage B back-door: async handlers run directly on the loop.
                result = await handler(**valid_params)
            else:
                # NOTE: lambda must capture `handler` and `valid_params` from
                # this call's local scope. Do not refactor to reuse variables
                # across iterations without re-checking closure semantics.
                result = await loop.run_in_executor(
                    self._request_executor,
                    lambda: handler(**valid_params),
                )
            self._write_response({"jsonrpc": "2.0", "id": req_id, "result": result})
        except AntiBotChallengeError as e:
            message = str(e)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32002,
                        "message": message,
                        "data": {
                            "source": "jm",
                            "challengeUrl": e.challenge_url,
                            "message": message,
                        },
                    },
                }
            )
        except AuthRequiredError as e:
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32001, "message": str(e)},
                }
            )
        except TypeError as e:
            logger.warning("Handler %s received invalid params: %s", method, e)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": f"Invalid params: {e}"},
                }
            )
        except Exception as e:
            logger.error("Handler error for %s: %s", method, e, exc_info=True)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(e)},
                }
            )

    async def _handle_line(self, line: str) -> None:
        """Async entry point for a single stdin line.

        Reproduces the special-case routing previously done by run() for
        cover/preview fetches, then delegates everything else to
        _dispatch_request.
        """
        req_id = None
        try:
            request = json.loads(line)
            method = request.get("method")
            req_id = request.get("id")
            params = request.get("params", {})

            if not isinstance(params, dict):
                self._write_response(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32602,
                            "message": "Invalid params: must be an object",
                        },
                    }
                )
                return

            if method == "fetch_cover":
                url = params.get("url", "")
                try:
                    self._validate_cover_url(url)
                except ValueError as e:
                    self._write_response(
                        {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": {"code": -32602, "message": str(e)},
                        }
                    )
                    return
                self._cover_executor.submit(self._async_fetch_cover, url, req_id)
                return

            if method == "fetch_preview_image":
                image_url = params.get("image_url", "")
                scramble_id = params.get("scramble_id", "")
                comic_id = params.get("comic_id", "")
                image_quality = params.get("image_quality", "")
                if not isinstance(image_quality, str) or image_quality not in ("", "low", "medium", "high", "original"):
                    self._write_response(
                        {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": {"code": -32602, "message": "Invalid image_quality"},
                        }
                    )
                    return
                try:
                    self._validate_preview_image_url(image_url)
                except ValueError as e:
                    self._write_response(
                        {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": {"code": -32602, "message": str(e)},
                        }
                    )
                    return
                self._preview_executor.submit(
                    self._async_fetch_preview_image,
                    image_url,
                    req_id,
                    scramble_id=scramble_id,
                    comic_id=comic_id,
                    image_quality=image_quality,
                )
                return

            await self._dispatch_request(request)
        except json.JSONDecodeError as e:
            logger.error("JSON parse error: %s", e, exc_info=True)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {e}"},
                }
            )
        except Exception as e:
            logger.error("Unexpected error: %s", e, exc_info=True)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32603, "message": f"Internal error: {e}"},
                }
            )

    @staticmethod
    def _on_dispatch_done(future: _ConcurrentFuture) -> None:
        """Log scheduling-layer failures (e.g. event loop already closed).

        _handle_line owns its own try/except for normal handler errors;
        this callback only catches exceptions raised before _handle_line ran.
        """
        exc = future.exception()
        if exc is not None:
            logger.error("dispatch failed: %s", exc, exc_info=exc)

    def _stdin_reader_loop(self, loop: "asyncio.AbstractEventLoop") -> None:
        """Daemon reader thread: pump stdin lines into the event loop.

        Uses a blocking ``for raw_line in sys.stdin`` exactly like the old
        synchronous run(); this keeps Windows pipe behaviour identical.
        On EOF the function signals _stop_event so _async_main returns.
        """
        import asyncio  # delayed: only reached when the server is running

        try:
            for raw_line in sys.stdin:
                line = raw_line.strip()
                if not line:
                    continue
                future = asyncio.run_coroutine_threadsafe(self._handle_line(line), loop)
                future.add_done_callback(self._on_dispatch_done)
        except Exception:
            logger.exception("stdin reader crashed")
        finally:
            logger.info("stdin closed, shutting down executors...")
            loop.call_soon_threadsafe(self._stop_event.set)

    async def _async_main(self) -> None:
        import asyncio  # delayed: only the running server needs it

        self._stop_event = asyncio.Event()
        loop = asyncio.get_running_loop()
        reader_thread = threading.Thread(
            target=self._stdin_reader_loop,
            args=(loop,),
            name="stdin-reader",
            daemon=True,
        )
        reader_thread.start()
        logger.info(
            "IPC Server started (asyncio main loop, request pool %d, "
            "cover pool %d, preview pool %d, cache max %d MB)",
            _REQUEST_POOL_MAX_WORKERS,
            _COVER_POOL_MAX_WORKERS,
            _PREVIEW_POOL_MAX_WORKERS,
            getattr(self.config, "preview_cache_size_limit_mb", 500),
        )
        await self._stop_event.wait()
        self._shutdown_executors()

    def _shutdown_executors(self) -> None:
        self._cover_executor.shutdown(wait=False, cancel_futures=True)
        self._preview_executor.shutdown(wait=False, cancel_futures=True)
        self._request_executor.shutdown(wait=False, cancel_futures=True)

    def handle_get_cache_stats(self) -> dict:
        """Return combined cache statistics for cover and preview caches."""
        cover_stats = self._cover_cache.get_stats()
        preview_stats = self._preview_cache.get_stats()
        total_file_count = cover_stats["file_count"] + preview_stats["file_count"]
        total_size_bytes = cover_stats["total_size_bytes"] + preview_stats["total_size_bytes"]
        return {
            "cover": cover_stats,
            "preview": preview_stats,
            "total": {
                "file_count": total_file_count,
                "total_size_bytes": total_size_bytes,
            },
        }

    def handle_get_cache_dir(self) -> dict:
        """Return the absolute path of the directory holding cache files.

        Cover and preview caches share the same root directory; derived from
        the live cache instances so injected test paths are honored.
        """
        return {"dir": self._cover_cache.db_dir}

    def handle_get_image_cache_dirs(self) -> dict:
        """Return absolute files_dir paths for cover and preview image caches.

        Used by the Electron main process to register the ``app-image://``
        protocol handler — it must know where to find raw image byte files
        keyed by url_hash. Derived from live cache instances so injected test
        paths are honored (see cache-directory-access spec).
        """
        return {
            "cover": self._cover_cache.files_dir,
            "preview": self._preview_cache.files_dir,
        }

    def handle_clear_preview_cache(self) -> dict:
        """Clear only the preview image cache (keep cover cache)."""
        self._preview_cache.clear_all()
        return {"success": True}

    def handle_clear_all_cache(self) -> dict:
        """Clear both cover and preview caches."""
        self._cover_cache.clear_all()
        self._preview_cache.clear_all()
        return {"success": True}

    def run(self):
        import asyncio  # delayed: only the running server needs it

        asyncio.run(self._async_main())


if __name__ == "__main__":
    server = IPCServer()
    server.run()
