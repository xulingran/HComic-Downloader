import inspect
import json
import logging
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

# Add project root to sys.path so we can import existing modules
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Re-export names used by test files:
#   tests/test_ipc_config_mapping.py -> CONFIG_KEY_MAP
#   tests/test_ipc_download_conflict.py -> _get_config_path
#   tests/test_ipc_preview.py -> IPCServer._detect_image_type
from ipc.auth_mixin import AuthMixin  # noqa: E402
from ipc.config_mixin import ConfigMixin  # noqa: E402
from ipc.cover_cache import CoverCacheDB  # noqa: E402
from ipc.cover_mixin import CoverMixin  # noqa: E402
from ipc.download_mixin import DownloadMixin  # noqa: E402
from ipc.favourite_tags_mixin import FavouriteTagsMixin  # noqa: E402
from ipc.history_mixin import HistoryMixin  # noqa: E402
from ipc.image_utils import detect_image_type, referer_for_image_url  # noqa: E402,F401
from ipc.migration_mixin import MigrationMixin  # noqa: E402
from ipc.preview_mixin import PreviewMixin  # noqa: E402
from ipc.search_mixin import SearchMixin  # noqa: E402
from ipc.tag_list_mixin import TagListMixin  # noqa: E402
from ipc.types import (  # noqa: E402,F401
    _COVER_POOL_MAX_WORKERS,
    _PREVIEW_IMAGE_MAX_SIZE,
    _PREVIEW_POOL_MAX_WORKERS,
    CONFIG_KEY_MAP,
    AuthRequiredError,
    _get_config_path,
)


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
):
    def __init__(self):
        from cbz_builder import CBZBuilder
        from config import Config
        from download_manager import ComicDownloadManager
        from downloader import ComicDownloader
        from sources import MultiSourceParser

        try:
            self.config = Config.load(_get_config_path())
        except Exception as e:
            logger.warning("Config load failed, using defaults: %s", e)
            self.config = Config()
        self.parser = MultiSourceParser(
            default_source=self.config.default_source,
            source_auth=self.config.source_auth,
        )
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

        # Download history database
        from download_history import DownloadHistoryDB

        self._history_db = DownloadHistoryDB(
            os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "download_history.db")
        )
        self._download_manager.on_download_success = self._on_download_success_record

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
        self._stdout_lock = threading.Lock()
        self._cover_cache = CoverCacheDB(
            max_size_mb=getattr(self.config, "preview_cache_size_limit_mb", 500),
        )

        from ipc.preview_cache import PreviewCacheDB

        self._preview_cache = PreviewCacheDB(
            max_size_mb=getattr(self.config, "preview_cache_size_limit_mb", 500),
        )

        # Migration engine
        self._init_migration()

        # Reading history database
        self._init_reading_history()

        # Favourite tags index database
        self._init_favourite_tags()

        # Tag list catalog database
        self._init_tag_list()

        # Pre-compute handler parameter sets for request routing
        self._handler_param_keys: dict[str, set[str] | None] = {}
        for _method_name, attr_name in self._HANDLER_NAMES.items():
            handler = getattr(self, attr_name)
            sig = inspect.signature(handler)
            has_var_keyword = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
            self._handler_param_keys[attr_name] = None if has_var_keyword else set(sig.parameters.keys())

    # ── backward-compatible static helpers (delegated to image_utils) ─────

    @staticmethod
    def _detect_image_type(data: bytes) -> str:
        return detect_image_type(data)

    @staticmethod
    def _referer_for_image_url(url: str) -> str:
        return referer_for_image_url(url)

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
        "add_to_favourites": "handle_add_to_favourites",
        "check_favourite": "handle_check_favourite",
        "remove_from_favourites": "handle_remove_from_favourites",
        "apply_auth": "handle_apply_auth",
        "verify_auth": "handle_verify_auth",
        "moeimg_login": "handle_moeimg_login",
        "bika_login": "handle_bika_login",
        "hcomic_login": "handle_hcomic_login",
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
        "get_jmcomic_domains": "handle_get_jmcomic_domains",
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
    }

    def handle_request(self, request: dict) -> dict:
        method = request.get("method")
        params = request.get("params", {})
        req_id = request.get("id")

        if not method or not isinstance(method, str):
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32600, "message": "Missing or invalid method"},
            }

        attr_name = self._HANDLER_NAMES.get(method)
        if attr_name:
            handler = getattr(self, attr_name)
            try:
                # 过滤 params 到 handler 实际接受的参数，防止客户端注入未预期参数
                param_keys = self._handler_param_keys.get(attr_name)
                if param_keys is not None:
                    valid_params = {k: v for k, v in params.items() if k in param_keys}
                else:
                    valid_params = params
                result = handler(**valid_params)
                return {"jsonrpc": "2.0", "id": req_id, "result": result}
            except AuthRequiredError as e:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32001, "message": str(e)},
                }
            except TypeError as e:
                logger.warning("Handler %s received invalid params: %s", method, e)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": f"Invalid params: {e}"},
                }
            except Exception as e:
                logger.error("Handler error for %s: %s", method, e, exc_info=True)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(e)},
                }
        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }

    def _async_sync_favourite_tags(self, params: dict, req_id: str | None) -> None:
        """Thread-pool target: run sync_favourite_tags without blocking the main loop."""
        try:
            param_keys = self._handler_param_keys.get("handle_sync_favourite_tags")
            valid_params = {k: v for k, v in params.items() if k in param_keys} if param_keys is not None else params
            result = self.handle_sync_favourite_tags(**valid_params)
            self._write_response({"jsonrpc": "2.0", "id": req_id, "result": result})
        except Exception as e:
            logger.error("async sync_favourite_tags failed: %s", e, exc_info=True)
            self._write_response(
                {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}
            )

    def _async_refresh_tag_list(self, params: dict, req_id: str | None) -> None:
        """Thread-pool target: run refresh_tag_list without blocking the main loop."""
        try:
            param_keys = self._handler_param_keys.get("handle_refresh_tag_list")
            valid_params = {k: v for k, v in params.items() if k in param_keys} if param_keys is not None else params
            result = self.handle_refresh_tag_list(**valid_params)
            self._write_response({"jsonrpc": "2.0", "id": req_id, "result": result})
        except Exception as e:
            logger.error("async refresh_tag_list failed: %s", e, exc_info=True)
            self._write_response(
                {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}
            )

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
        logger.info(
            "IPC Server started (cover fetches: thread pool, %d workers, cache max %d MB)",
            _COVER_POOL_MAX_WORKERS,
            getattr(self.config, "preview_cache_size_limit_mb", 500),
        )
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
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
                    continue

                # ── fetch_cover: dispatch to thread pool, don't block main loop ──
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
                        continue
                    self._cover_executor.submit(self._async_fetch_cover, url, req_id)
                    continue

                # ── fetch_preview_image: authenticated image proxy for reader pages ──
                if method == "fetch_preview_image":
                    image_url = params.get("image_url", "")
                    scramble_id = params.get("scramble_id", "")
                    comic_id = params.get("comic_id", "")
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
                        continue
                    self._preview_executor.submit(
                        self._async_fetch_preview_image,
                        image_url,
                        req_id,
                        scramble_id=scramble_id,
                        comic_id=comic_id,
                    )
                    continue

                # ── sync_favourite_tags: long-running sync dispatched to thread pool ──
                if method == "sync_favourite_tags":
                    self._cover_executor.submit(self._async_sync_favourite_tags, params, req_id)
                    continue

                # ── refresh_tag_list: long-running sync dispatched to thread pool ──
                if method == "refresh_tag_list":
                    self._cover_executor.submit(self._async_refresh_tag_list, params, req_id)
                    continue

                response = self.handle_request(request)
                self._write_response(response)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error: {e}", exc_info=True)
                self._write_response(
                    {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": {"code": -32700, "message": f"Parse error: {e}"},
                    }
                )
            except Exception as e:
                logger.error(f"Unexpected error: {e}", exc_info=True)
                self._write_response(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32603, "message": f"Internal error: {e}"},
                    }
                )


if __name__ == "__main__":
    server = IPCServer()
    server.run()
