import os
import sys
import json
import logging
import uuid
from typing import Any, Dict

# Add project root to sys.path so we can import existing modules
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


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
}


class IPCServer:
    def __init__(self):
        from parser import MultiSourceParser
        from downloader import ComicDownloader
        from config import Config
        from download_manager import ComicDownloadManager
        from cbz_builder import CBZBuilder

        self.config = Config.load(_get_config_path())
        self.parser = MultiSourceParser(
            default_source=self.config.default_source,
            source_auth=self.config.source_auth,
        )
        self.downloader = ComicDownloader(
            concurrent_downloads=self.config.concurrent_downloads,
            timeout=self.config.timeout,
            retry_times=self.config.retry_times,
        )
        self.cbz_builder = CBZBuilder()
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
        print(json.dumps(notification), flush=True)

    def _comic_to_dict(self, comic) -> Dict:
        cover_url = ""
        try:
            cover_url = comic.get_image_url(1)
        except Exception:
            cover_url = comic.cover_url or ""

        return {
            "id": comic.id,
            "title": comic.title,
            "url": comic.preview_url or "",
            "coverUrl": cover_url,
            "source": comic.comic_source or "default",
            "tags": comic.tags if hasattr(comic, 'tags') else [],
            "author": comic.author if hasattr(comic, 'author') else None,
            "pages": comic.pages if hasattr(comic, 'pages') else None,
        }

    def handle_search(self, query: str, mode: str = "keyword", page: int = 1, source: str = None) -> Dict:
        if source and source in ("hcomic", "moeimg"):
            self.parser.set_source(source)
        comics, pagination = self.parser.search(query, page=page)
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else page,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }

    def handle_download(self, comic_id: str, comic_data: dict = None) -> Dict:
        from models import ComicInfo
        comic = ComicInfo(
            id=comic_id,
            title=(comic_data or {}).get("title", "Unknown"),
            preview_url=(comic_data or {}).get("url", ""),
            cover_url=(comic_data or {}).get("coverUrl", ""),
            source_site=(comic_data or {}).get("source", "hcomic"),
        )
        task_id = self._download_manager.add_task(comic)
        task = self._download_manager.tasks.get(task_id)
        return {
            "taskId": task_id,
            "status": task.status.value if task else "queued",
        }

    def handle_get_favourites(self, page: int = 1) -> Dict:
        try:
            comics, pagination, needs_login = self.parser.favourites(page=page)
            return {
                "comics": [self._comic_to_dict(c) for c in comics],
                "pagination": {
                    "currentPage": pagination.current_page if pagination else page,
                    "totalPages": pagination.total_pages if pagination else 1,
                    "totalItems": pagination.total_items if pagination else 0,
                },
                "needsLogin": needs_login,
            }
        except Exception as e:
            logger.error(f"Get favourites error: {e}")
            return {"comics": [], "pagination": None, "needsLogin": False}

    def handle_apply_auth(self, curl_text: str) -> Dict:
        if not curl_text or not curl_text.strip():
            raise ValueError("请粘贴 curl 命令")

        from auth_parser import extract_auth_from_curl

        cookie, user_agent = extract_auth_from_curl(curl_text.strip())
        self.config.set_source_auth("hcomic", cookie=cookie, user_agent=user_agent)
        self.config.save(_get_config_path())

        self.parser.configure_auth(cookie=cookie, user_agent=user_agent, source="hcomic")

        logger.info(f"Auth applied: cookie length={len(cookie)}, ua length={len(user_agent)}")
        return {"success": True}

    def handle_verify_auth(self) -> Dict:
        is_valid, message = self.parser.verify_login_status()
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
        }
        config = {}
        for snake_key, value in raw.items():
            camel_key = reverse_map.get(snake_key, snake_key)
            config[camel_key] = value
        config['cookie'] = None
        config['userAgent'] = None
        return {"config": config}

    def handle_set_config(self, key: str, value: Any) -> Dict:
        python_key = CONFIG_KEY_MAP.get(key)
        if not python_key:
            return {"success": False, "error": f"Unknown config key: {key}"}
        if not hasattr(self.config, python_key):
            return {"success": False, "error": f"Unknown config key: {key}"}
        try:
            setattr(self.config, python_key, value)
            self.config.save(_get_config_path())
            return {"success": True}
        except Exception as e:
            logger.error(f"Set config error for {key}: {e}")
            return {"success": False, "error": str(e)}

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

    def handle_request(self, request: Dict) -> Dict:
        method = request.get("method")
        params = request.get("params", {})
        req_id = request.get("id")

        handlers = {
            "search": self.handle_search,
            "download": self.handle_download,
            "get_favourites": self.handle_get_favourites,
            "apply_auth": self.handle_apply_auth,
            "verify_auth": self.handle_verify_auth,
            "get_config": self.handle_get_config,
            "set_config": self.handle_set_config,
            "get_downloads": self.handle_get_downloads,
            "cancel_download": self.handle_cancel_download,
            "get_statistics": self.handle_get_statistics,
        }

        handler = handlers.get(method)
        if handler:
            try:
                result = handler(**params)
                return {"jsonrpc": "2.0", "id": req_id, "result": result}
            except Exception as e:
                logger.error(f"Handler error for {method}: {e}")
                return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}
        else:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}

    def run(self):
        logger.info("IPC Server started")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
                response = self.handle_request(request)
                print(json.dumps(response), flush=True)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error: {e}")
            except Exception as e:
                logger.error(f"Unexpected error: {e}")


if __name__ == "__main__":
    server = IPCServer()
    server.run()
