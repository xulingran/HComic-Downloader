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


class IPCServer:
    def __init__(self):
        from parser import MultiSourceParser
        from downloader import ComicDownloader
        from config import Config

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
        self.download_tasks: Dict[str, Dict] = {}

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

    def handle_search(self, query: str, mode: str = "keyword", page: int = 1) -> Dict:
        comics, pagination = self.parser.search(query, page=page)
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else page,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }

    def handle_download(self, comic_id: str) -> Dict:
        task_id = str(uuid.uuid4())[:8]
        self.download_tasks[task_id] = {"status": "pending", "progress": 0}
        return {"taskId": task_id}

    def handle_get_favourites(self) -> Dict:
        try:
            comics, _pagination, _has_more = self.parser.favourites()
            return {"comics": [self._comic_to_dict(c) for c in comics]}
        except Exception as e:
            logger.error(f"Get favourites error: {e}")
            return {"comics": []}

    def handle_get_config(self) -> Dict:
        return {
            "config": {
                "themeMode": self.config.theme_mode,
                "cardStyle": "cover",
                "outputFormat": self.config.output_format,
                "proxy": None,
                "cookie": self.config.auth_cookie or None,
                "userAgent": self.config.auth_user_agent or None,
            }
        }

    def handle_set_config(self, key: str, value: Any) -> Dict:
        try:
            if hasattr(self.config, key):
                setattr(self.config, key, value)
                self.config.save(_get_config_path())
            return {"success": True}
        except Exception as e:
            logger.error(f"Set config error: {e}")
            return {"success": False}

    def handle_get_downloads(self) -> Dict:
        return {
            "tasks": [
                {
                    "id": task_id,
                    "comic": {"id": "", "title": "Download Task", "url": "", "coverUrl": "", "source": ""},
                    "status": task["status"],
                    "progress": task["progress"],
                    "totalPages": 0,
                    "downloadedPages": 0,
                }
                for task_id, task in self.download_tasks.items()
            ]
        }

    def handle_cancel_download(self, task_id: str) -> Dict:
        if task_id in self.download_tasks:
            self.download_tasks[task_id]["status"] = "cancelled"
            return {"success": True}
        return {"success": False}

    def handle_get_statistics(self) -> Dict:
        return {
            "totalDownloads": len(self.download_tasks),
            "completedDownloads": sum(1 for t in self.download_tasks.values() if t["status"] == "completed"),
            "failedDownloads": sum(1 for t in self.download_tasks.values() if t["status"] == "error"),
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
