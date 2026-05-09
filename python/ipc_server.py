import os
import sys
import json
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import logging
import uuid
import base64
import mimetypes
from typing import Any, Dict
from urllib.parse import urlparse

# Add project root to sys.path so we can import existing modules
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class AuthRequiredError(Exception):
    """Raised when an operation requires authentication."""
    pass


def _get_config_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "config.json")


CONFIG_KEY_MAP = {
    'themeMode': 'theme_mode',
    'outputFormat': 'output_format',
    'downloadDir': 'download_dir',
    'concurrentDownloads': 'concurrent_downloads',
    'timeout': 'timeout',
    'retryTimes': 'retry_times',
    'cbzFilenameTemplate': 'cbz_filename_template',
    'batchDownloadDelay': 'batch_download_delay',
    'autoRetryMaxAttempts': 'auto_retry_max_attempts',
    'notifyOnComplete': 'notify_on_complete',
    'notifyWhenForeground': 'notify_when_foreground',
    'defaultSource': 'default_source',
    'fontName': 'font_name',
    'fontSize': 'font_size',
}

_COVER_CACHE_MAX_SIZE = 200
_COVER_POOL_MAX_WORKERS = 4


class IPCServer:
    ALLOWED_COVER_DOMAINS = {
        "h-comic.link",
        "moeimg.fan",
        "moeimg.net",
    }

    def __init__(self):
        from parser import MultiSourceParser
        from downloader import ComicDownloader
        from config import Config
        from download_manager import ComicDownloadManager
        from cbz_builder import CBZBuilder

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

        # Thread pool for async cover fetches — keeps main loop responsive
        self._cover_executor = ThreadPoolExecutor(
            max_workers=_COVER_POOL_MAX_WORKERS, thread_name_prefix="cover"
        )
        self._stdout_lock = threading.Lock()
        self._cover_cache: OrderedDict[str, str] = OrderedDict()

    # ── thread-safe stdout ────────────────────────────────────────────────

    def _write_response(self, response: dict) -> None:
        """Write a JSON-RPC response/notification to stdout atomically."""
        with self._stdout_lock:
            print(json.dumps(response), flush=True)

    # ── cover helpers ─────────────────────────────────────────────────────

    def _build_cover_session(self):
        """Create a thread-safe requests session with auth headers copied from parser."""
        import requests as _requests
        session = _requests.Session()
        try:
            src_headers = dict(self.parser.session.headers)
        except Exception:
            src_headers = {}
        if src_headers:
            session.headers.update(src_headers)
        return session

    @staticmethod
    def _detect_image_type(data: bytes) -> str:
        """Detect image MIME type from magic bytes."""
        if len(data) < 12:
            return ''
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return 'image/png'
        if data[:3] == b'\xff\xd8\xff':
            return 'image/jpeg'
        if data[:6] in (b'GIF87a', b'GIF89a'):
            return 'image/gif'
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return 'image/webp'
        return ''

    def _validate_cover_url(self, url: str) -> None:
        if not url or not isinstance(url, str):
            raise ValueError("Missing or invalid url")
        if len(url) > 2048:
            raise ValueError("URL too long")
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise ValueError("Only HTTPS URLs are allowed")
        hostname = parsed.hostname or ""
        if not any(
            hostname == d or hostname.endswith("." + d)
            for d in self.ALLOWED_COVER_DOMAINS
        ):
            raise ValueError(f"Domain not allowed: {hostname}")

    def _do_fetch_cover(self, url: str) -> str:
        """Fetch cover image and return base64 data URI (thread-safe, called from pool)."""
        parsed = urlparse(url)

        headers = {"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
        try:
            src_headers = dict(self.parser.session.headers)
            headers.update(src_headers)
        except Exception:
            pass

        session = self._build_cover_session()
        response = session.get(url, timeout=10, headers=headers, stream=True)
        response.raise_for_status()

        # Validate final URL after redirects is still on an allowed domain and HTTPS
        final_parsed = urlparse(response.url)
        if final_parsed.scheme != "https":
            raise ValueError(f"Redirect target must use HTTPS, got: {final_parsed.scheme}")
        final_hostname = final_parsed.hostname or ""
        if not any(
            final_hostname == d or final_hostname.endswith("." + d)
            for d in self.ALLOWED_COVER_DOMAINS
        ):
            raise ValueError(f"Redirect target domain not allowed: {final_hostname}")

        # Read up to 500KB + 1 byte — if we get more, the image is too large
        max_size = 500 * 1024
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=8192):
            total += len(chunk)
            if total > max_size:
                raise ValueError("Image too large")
            chunks.append(chunk)
        content = b"".join(chunks)

        content_type = self._detect_image_type(content)
        if not content_type:
            raise ValueError("Response is not a recognized image format")

        b64 = base64.b64encode(content).decode("ascii")
        return f"data:{content_type};base64,{b64}"

    def _async_fetch_cover(self, url: str, req_id: str) -> None:
        """Thread-pool target: fetch cover and write response via stdout lock."""
        try:
            # Check cache (under lock to prevent duplicate fetches)
            with self._stdout_lock:
                if url in self._cover_cache:
                    data_uri = self._cover_cache[url]
                    self._cover_cache.move_to_end(url)
                    cached = data_uri
                else:
                    cached = None

            if cached is not None:
                self._write_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"dataUri": cached},
                })
                return

            data_uri = self._do_fetch_cover(url)

            with self._stdout_lock:
                if len(self._cover_cache) >= _COVER_CACHE_MAX_SIZE:
                    self._cover_cache.popitem(last=False)
                self._cover_cache[url] = data_uri

            self._write_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"dataUri": data_uri},
            })
        except Exception as e:
            logger.error("Cover fetch error for %s: %s", url, e)
            self._write_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)},
            })

    # ── handlers ──────────────────────────────────────────────────────────

    def _on_download_update(self, task):
        """Send download progress as JSON-RPC notification to stdout."""
        notification = {
            "jsonrpc": "2.0",
            "method": "download_progress",
            "params": {
                "taskId": task.task_id,
                "status": task.status.value,
                "progress": task.progress_percentage,
                "current": task.progress_current,
                "total": task.progress_total,
                "title": task.comic.title,
            },
        }
        self._write_response(notification)

    def _comic_to_dict(self, comic) -> Dict:
        cover_url = comic.cover_url or ""
        if not cover_url:
            try:
                cover_url = comic.get_image_url(1)
            except Exception:
                cover_url = ""

        return {
            "id": comic.id,
            "title": comic.title,
            "url": comic.preview_url or "",
            "coverUrl": cover_url,
            "source": comic.comic_source or "default",
            "sourceSite": comic.source_site or "hcomic",
            "mediaId": comic.media_id or "",
            "tags": comic.tags if hasattr(comic, 'tags') else [],
            "author": comic.author if hasattr(comic, 'author') else None,
            "pages": comic.pages if hasattr(comic, 'pages') else None,
        }

    def _build_and_prepare_comic(self, data: dict, comic_id: str = None) -> "ComicInfo":
        """Build a ComicInfo from frontend data and prepare it for download.

        Ensures the comic has full metadata (author, title, pages, etc.)
        fetched from the API so that output path computation matches the
        actual download path exactly.
        """
        from models import ComicInfo
        comic = ComicInfo(
            id=comic_id or data.get("id", ""),
            title=data.get("title", "Unknown"),
            preview_url=data.get("url", ""),
            cover_url=data.get("coverUrl", ""),
            source_site=data.get("sourceSite") or data.get("source", "hcomic"),
            comic_source=data.get("source", ""),
            media_id=data.get("mediaId", ""),
            pages=data.get("pages") or 0,
            tags=data.get("tags") or [],
            author=data.get("author"),
        )
        if self._download_manager.prepare_comic:
            prepared = self._download_manager.prepare_comic(comic)
            if prepared is not None:
                comic = prepared
        return comic

    def handle_search(self, query: str, mode: str = "keyword", page: int = 1, source: str = None) -> Dict:
        effective_source = source if source in ("hcomic", "moeimg") else self.config.default_source
        effective_query = query
        if effective_source == "moeimg" and mode in ("author", "tag"):
            effective_query = f"{mode}:{query}"
        comics, pagination = self.parser.search(effective_query, page=page, source=effective_source)
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else page,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }

    def handle_download(self, comic_id: str, comic_data: dict = None, overwrite: bool = False) -> Dict:
        comic = self._build_and_prepare_comic(comic_data or {}, comic_id=comic_id)

        if not overwrite:
            output_path = self.cbz_builder.get_output_path_for_format(
                comic, self.config.output_format, self.config.download_dir
            )
            if os.path.exists(output_path):
                return {"taskId": None, "status": "conflict", "conflictPath": output_path}

        task_id = self._download_manager.add_task(comic, overwrite=overwrite)
        task = self._download_manager.tasks.get(task_id)
        return {
            "taskId": task_id,
            "status": task.status.value if task else "queued",
        }

    def handle_check_download_conflict(self, comic_data: dict) -> Dict:
        comic = self._build_and_prepare_comic(comic_data or {})
        output_path = self.cbz_builder.get_output_path_for_format(
            comic, self.config.output_format, self.config.download_dir
        )
        return {
            "hasConflict": os.path.exists(output_path),
            "path": output_path,
        }

    def handle_get_favourites(self, page: int = 1) -> Dict:
        from parser import ParserResponseError
        try:
            comics, pagination, needs_login = self.parser.favourites(
                page=page, raise_errors=True, source="hcomic"
            )
            return {
                "comics": [self._comic_to_dict(c) for c in comics],
                "pagination": {
                    "currentPage": pagination.current_page if pagination else page,
                    "totalPages": pagination.total_pages if pagination else 1,
                    "totalItems": pagination.total_items if pagination else 0,
                },
                "needsLogin": needs_login,
            }
        except ParserResponseError as e:
            msg = str(e)
            if any(kw in msg.lower() for kw in ("401", "403", "unauthorized", "forbidden", "login", "auth")):
                raise AuthRequiredError(msg)
            raise RuntimeError(msg)
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error(f"Get favourites parse error: {e}")
            raise RuntimeError(f"Parse error: {e}")
        except Exception as e:
            logger.error(f"Get favourites unexpected error: {e}")
            raise

    def handle_apply_auth(self, curl_text: str) -> Dict:
        if not curl_text or not curl_text.strip():
            raise ValueError("请粘贴 curl 命令")

        from auth_parser import extract_auth_from_curl

        cookie, user_agent = extract_auth_from_curl(curl_text.strip())
        self.config.set_source_auth("hcomic", cookie=cookie, user_agent=user_agent)
        self.config.save(_get_config_path())

        self.parser.configure_auth(cookie=cookie, user_agent=user_agent, source="hcomic")
        self.downloader.configure_auth(cookie=cookie, user_agent=user_agent)

        logger.info(f"Auth applied: cookie length={len(cookie)}, ua length={len(user_agent)}")
        return {"success": True}

    def handle_verify_auth(self) -> Dict:
        is_valid, message = self.parser.verify_login_status(source="hcomic")
        return {"valid": is_valid, "message": message}

    def handle_get_config(self) -> Dict:
        reverse_map = {v: k for k, v in CONFIG_KEY_MAP.items()}
        raw = {
            'theme_mode': self.config.theme_mode,
            'output_format': self.config.output_format,
            'download_dir': self.config.download_dir,
            'concurrent_downloads': self.config.concurrent_downloads,
            'timeout': self.config.timeout,
            'retry_times': self.config.retry_times,
            'cbz_filename_template': self.config.cbz_filename_template,
            'batch_download_delay': self.config.batch_download_delay,
            'auto_retry_max_attempts': self.config.auto_retry_max_attempts,
            'notify_on_complete': self.config.notify_on_complete,
            'notify_when_foreground': self.config.notify_when_foreground,
            'default_source': self.config.default_source,
            'font_name': getattr(self.config, 'font_name', ''),
            'font_size': getattr(self.config, 'font_size', 14),
        }
        config = {}
        for snake_key, value in raw.items():
            camel_key = reverse_map.get(snake_key, snake_key)
            config[camel_key] = value
        config['hasAuth'] = bool(
            self.config.source_auth.get('hcomic', {}).get('cookie')
        )
        return {"config": config}

    def handle_set_config(self, key: str, value: Any) -> Dict:
        python_key = CONFIG_KEY_MAP.get(key)
        if not python_key:
            raise ValueError(f"Unknown config key: {key}")
        if not hasattr(self.config, python_key):
            raise ValueError(f"Unknown config key: {key}")

        old_value = getattr(self.config, python_key)
        try:
            setattr(self.config, python_key, value)
            self.config.save(_get_config_path())
        except Exception as e:
            setattr(self.config, python_key, old_value)
            logger.error(f"Set config save error for {key}: {e}")
            raise

        try:
            if key == 'downloadDir':
                self._download_manager.set_output_dir(value)
            elif key == 'outputFormat':
                self._download_manager.set_output_format(value)
            elif key == 'batchDownloadDelay':
                self._download_manager.set_delay_after(value)
            elif key == 'autoRetryMaxAttempts':
                self._download_manager.set_auto_retry_max_attempts(value)
            elif key == 'concurrentDownloads':
                self.downloader.concurrent_downloads = value
            elif key == 'timeout':
                self.downloader.timeout = value
            elif key == 'retryTimes':
                self.downloader.retry_times = value
                self.downloader.rebuild_session()
            elif key == 'cbzFilenameTemplate':
                self.cbz_builder.filename_template = value
            elif key == 'defaultSource':
                self.parser.set_source(value)
        except Exception as e:
            setattr(self.config, python_key, old_value)
            try:
                self.config.save(_get_config_path())
            except Exception as rollback_err:
                logger.error(f"Failed to rollback config file for {key}: {rollback_err}")
            logger.error(f"Set config runtime error for {key}: {e}")
            raise

        return {"success": True}

    def handle_get_downloads(self) -> Dict:
        tasks = []
        for task_id, task in self._download_manager.tasks.items():
            tasks.append({
                "id": task_id,
                "comic": self._comic_to_dict(task.comic),
                "status": task.status.value,
                "progress": task.progress_percentage,
                "totalPages": task.progress_total,
                "downloadedPages": task.progress_current,
                "error": task.error_message,
            })
        return {"tasks": tasks}

    def handle_cancel_download(self, task_id: str) -> Dict:
        success = self._download_manager.cancel_task(task_id)
        return {"success": success}

    def handle_get_statistics(self) -> Dict:
        stats = self._download_manager.get_stats()
        return {
            "totalDownloads": stats.get("total", 0),
            "completedDownloads": stats.get("completed", 0),
            "failedDownloads": stats.get("failed", 0),
            "totalSize": 0,
            "downloadsByDay": [],
        }

    def handle_shutdown(self) -> Dict:
        """Gracefully shut down: cancel active tasks, wait for completion, stop the queue."""
        active_statuses = {"queued", "downloading", "paused"}
        cancelled_count = 0
        for task_id in list(self._download_manager.tasks.keys()):
            task = self._download_manager.tasks.get(task_id)
            if task and task.status.value in active_statuses:
                self._download_manager.cancel_task(task_id)
                cancelled_count += 1
        self._download_manager.stop()
        if cancelled_count > 0:
            self._download_manager.wait_active_downloads(timeout=10.0)
        self._cover_executor.shutdown(cancel_futures=True, wait=False)
        logger.info(f"Shutdown: cancelled {cancelled_count} active tasks")
        return {"success": True, "cancelledTasks": cancelled_count}

    # ── Phase 1: Download Manager task controls ──

    def handle_pause_task(self, task_id: str) -> Dict:
        """Pause a specific download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.pause_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be paused: {task_id}")
        return {"success": True}

    def handle_resume_task(self, task_id: str) -> Dict:
        """Resume a paused download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.resume_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be resumed: {task_id}")
        return {"success": True}

    def handle_retry_task(self, task_id: str) -> Dict:
        """Retry a failed download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.retry_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be retried: {task_id}")
        return {"success": True}

    def handle_toggle_global_pause(self) -> Dict:
        """Toggle global pause on the download queue."""
        is_paused = self._download_manager.toggle_global_pause()
        return {"isPaused": is_paused}

    # ── Phase 1: System info ──

    def handle_get_proxy_status(self) -> Dict:
        """Return current system proxy configuration."""
        try:
            from utils import get_system_proxies
            proxies = get_system_proxies()
            return {
                "http": proxies.get("http", ""),
                "https": proxies.get("https", ""),
                "noProxy": "",
            }
        except Exception as e:
            logger.error(f"Get proxy status error: {e}")
            return {"http": "", "https": "", "noProxy": ""}

    def handle_get_available_fonts(self) -> Dict:
        """Return platform-aware CJK font recommendations."""
        import platform
        system = platform.system()
        if system == "Darwin":
            fonts = [
                {"name": "Hiragino Sans, PingFang SC, sans-serif", "label": "Hiragino Sans (macOS default)"},
                {"name": "PingFang SC, sans-serif", "label": "PingFang SC"},
                {"name": "Hiragino Sans GB, sans-serif", "label": "Hiragino Sans GB"},
                {"name": "Apple LiGothic, sans-serif", "label": "Apple LiGothic"},
                {"name": "sans-serif", "label": "System Default"},
            ]
        elif system == "Windows":
            fonts = [
                {"name": "Microsoft YaHei, sans-serif", "label": "Microsoft YaHei (微软雅黑)"},
                {"name": "Microsoft JhengHei, sans-serif", "label": "Microsoft JhengHei (微軟正黑體)"},
                {"name": "Meiryo, sans-serif", "label": "Meiryo (メイリオ)"},
                {"name": "MS PGothic, sans-serif", "label": "MS PGothic"},
                {"name": "SimHei, sans-serif", "label": "SimHei (黑体)"},
                {"name": "sans-serif", "label": "System Default"},
            ]
        else:
            fonts = [
                {"name": "Noto Sans CJK SC, sans-serif", "label": "Noto Sans CJK SC"},
                {"name": "WenQuanYi Micro Hei, sans-serif", "label": "WenQuanYi Micro Hei"},
                {"name": "Noto Sans CJK JP, sans-serif", "label": "Noto Sans CJK JP"},
                {"name": "sans-serif", "label": "System Default"},
            ]
        return {"fonts": fonts}

    # ── Phase 1: Download directory ──

    def handle_open_download_dir(self) -> Dict:
        """Open the download directory in the OS file manager."""
        import platform
        import subprocess
        directory = self.config.download_dir
        if not directory or not os.path.isdir(directory):
            raise ValueError(f"Download directory does not exist: {directory}")
        try:
            system = platform.system()
            if system == "Windows":
                os.startfile(directory)
            elif system == "Darwin":
                subprocess.Popen(["open", directory])
            else:
                subprocess.Popen(["xdg-open", directory])
            return {"success": True}
        except Exception as e:
            logger.error(f"Open download dir error: {e}")
            raise RuntimeError(f"Failed to open directory: {e}")

    def handle_get_download_detail(self, task_id: str) -> Dict:
        """Return detailed information about a download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        task = self._download_manager.tasks.get(task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")
        output_path = ""
        try:
            output_path = self.cbz_builder.get_output_path_for_format(
                task.comic, self.config.output_format, self.config.download_dir
            )
        except Exception:
            pass
        return {
            "taskId": task_id,
            "tempDir": getattr(task, 'temp_dir', ''),
            "errorMessage": getattr(task, 'error_message', ''),
            "outputPath": output_path,
        }

    # ── request routing ───────────────────────────────────────────────────

    def handle_request(self, request: Dict) -> Dict:
        method = request.get("method")
        params = request.get("params", {})
        req_id = request.get("id")

        handlers = {
            "search": self.handle_search,
            "download": self.handle_download,
            "check_download_conflict": self.handle_check_download_conflict,
            "get_favourites": self.handle_get_favourites,
            "apply_auth": self.handle_apply_auth,
            "verify_auth": self.handle_verify_auth,
            "get_config": self.handle_get_config,
            "set_config": self.handle_set_config,
            "get_downloads": self.handle_get_downloads,
            "cancel_download": self.handle_cancel_download,
            "get_statistics": self.handle_get_statistics,
            "shutdown": self.handle_shutdown,
            "pause_task": self.handle_pause_task,
            "resume_task": self.handle_resume_task,
            "retry_task": self.handle_retry_task,
            "toggle_global_pause": self.handle_toggle_global_pause,
            "get_proxy_status": self.handle_get_proxy_status,
            "get_available_fonts": self.handle_get_available_fonts,
            "open_download_dir": self.handle_open_download_dir,
            "get_download_detail": self.handle_get_download_detail,
        }

        handler = handlers.get(method)
        if handler:
            try:
                result = handler(**params)
                return {"jsonrpc": "2.0", "id": req_id, "result": result}
            except AuthRequiredError as e:
                return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32001, "message": str(e)}}
            except Exception as e:
                logger.error(f"Handler error for {method}: {e}")
                return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}
        else:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}

    def run(self):
        logger.info(
            "IPC Server started (cover fetches: thread pool, %d workers, cache max %d)",
            _COVER_POOL_MAX_WORKERS, _COVER_CACHE_MAX_SIZE,
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
                    self._write_response({
                        "jsonrpc": "2.0", "id": req_id,
                        "error": {"code": -32602, "message": "Invalid params: must be an object"},
                    })
                    continue

                # ── fetch_cover: dispatch to thread pool, don't block main loop ──
                if method == "fetch_cover":
                    url = params.get("url", "")
                    try:
                        self._validate_cover_url(url)
                    except ValueError as e:
                        self._write_response({
                            "jsonrpc": "2.0", "id": req_id,
                            "error": {"code": -32602, "message": str(e)},
                        })
                        continue
                    self._cover_executor.submit(self._async_fetch_cover, url, req_id)
                    continue

                response = self.handle_request(request)
                self._write_response(response)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error: {e}")
                self._write_response({
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {e}"},
                })
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                self._write_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32603, "message": f"Internal error: {e}"},
                })


if __name__ == "__main__":
    server = IPCServer()
    server.run()
