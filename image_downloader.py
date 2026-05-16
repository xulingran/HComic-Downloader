"""图片下载模块 - 会话池管理和图片下载逻辑"""
import logging
import os
import queue
import shutil
import tempfile
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from PIL import Image

from constants import DEFAULT_USER_AGENT
from image_formats import MIME_TO_EXT, PIL_FORMAT_TO_EXT
from url_validator import DownloadError, UrlValidator
from utils import apply_system_proxy_to_session, ensure_dir

logger = logging.getLogger(__name__)


class ImageDownloader:
    """图片下载器 - 管理会话池并下载图片"""

    MAX_IMAGE_SIZE = 100 * 1024 * 1024
    CHUNK_SIZE = 8192
    POOL_CONNECTIONS = 10
    POOL_MAX_SIZE = 10
    DEFAULT_UA = DEFAULT_USER_AGENT

    def __init__(
        self,
        timeout: int = 30,
        retry_times: int = 3,
        cookie: str = "",
        user_agent: str = "",
        pool_size: int = 4,
    ):
        self.timeout = timeout
        self.retry_times = retry_times
        self.url_validator = UrlValidator()
        self._pool_size = pool_size
        self._session_pool: queue.Queue[requests.Session] = queue.Queue()
        self._pending_cookie = ""
        self._pending_ua = ""
        self._checked_out: set[requests.Session] = set()
        self._stale_sessions: set[requests.Session] = set()
        self._init_session_pool()

    def _create_session(self) -> requests.Session:
        """创建配置了重试和代理的会话"""
        session = requests.Session()
        apply_system_proxy_to_session(session)
        session.headers.update({
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
            "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,en-US;q=0.5,en;q=0.3",
            "Referer": "https://h-comic.com/",
        })

        retry_strategy = Retry(
            total=self.retry_times,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=self.POOL_CONNECTIONS,
            pool_maxsize=self.POOL_MAX_SIZE,
        )
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        return session

    def _init_session_pool(self) -> None:
        """预创建 pool_size 个 Session 放入池中"""
        while not self._session_pool.empty():
            try:
                self._session_pool.get_nowait().close()
            except queue.Empty:
                break
        for _ in range(self._pool_size):
            self._session_pool.put(self._create_session())

    def _acquire_session(self) -> requests.Session:
        """从池中获取一个 Session（阻塞等待），自动应用最新认证头"""
        session = self._session_pool.get()
        self._checked_out.add(session)
        self._apply_pending_auth(session)
        return session

    def _release_session(self, session: requests.Session) -> None:
        """将 Session 归还到池中；若 session 已过期则直接关闭"""
        self._checked_out.discard(session)
        if session in self._stale_sessions:
            self._stale_sessions.discard(session)
            session.close()
            return
        self._session_pool.put(session)

    def configure_auth(self, cookie: str = "", user_agent: str = ""):
        """记录待应用认证信息，不阻塞正在使用的 Session。

        认证头会在每次 _acquire_session 时延迟应用到取出的 Session，
        避免排空池导致的死锁风险。
        """
        self._pending_cookie = (cookie or "").strip()
        self._pending_ua = (user_agent or "").strip() or self.DEFAULT_UA

    def _apply_pending_auth(self, session: requests.Session) -> None:
        """将待处理的认证头应用到单个 Session（由 _acquire_session 调用）。"""
        session.headers["User-Agent"] = self._pending_ua
        if self._pending_cookie:
            session.headers["Cookie"] = self._pending_cookie
        else:
            session.headers.pop("Cookie", None)

    def rebuild_pool(self):
        """重建会话池，继承当前认证头。

        当前正在使用中的 Session（checked-out）会被标记为过期，归还时自动关闭
        而不是回到新池中，避免新旧 Session 混用。
        """
        saved_ua = self.DEFAULT_UA
        saved_cookie = ""

        # 关闭池中空闲 Session
        while not self._session_pool.empty():
            try:
                s = self._session_pool.get_nowait()
                saved_ua = s.headers.get("User-Agent", saved_ua)
                saved_cookie = s.headers.get("Cookie", saved_cookie)
                s.close()
            except queue.Empty:
                break

        # 标记 checked-out Session 为过期，归还时自动关闭
        for s in self._checked_out:
            self._stale_sessions.add(s)

        self._init_session_pool()
        self.configure_auth(cookie=saved_cookie, user_agent=saved_ua)

    def download(self, url: str, path: str, referer: str = "", session: Optional[requests.Session] = None):
        """下载单张图片，自动检测格式

        使用流式下载，设置单张图片大小上限（100MB），避免内存暴涨。

        Args:
            url: 图片 URL
            path: 保存路径
            referer: 可选的 Referer 请求头
            session: 可选的独立 session，默认从池中获取

        Raises:
            DownloadError: 下载失败或图片过大
        """
        self.url_validator.validate_url(url)

        pooled_session = None

        try:
            headers = {}
            if referer:
                headers["Referer"] = referer
            if session is not None:
                s = session
            else:
                s = self._acquire_session()
                pooled_session = s

            final_url, s = self.url_validator.resolve_redirects(url, s, self.timeout)

            with s.get(final_url, timeout=self.timeout, stream=True, headers=headers, allow_redirects=False) as response:
                response.raise_for_status()

                ensure_dir(os.path.dirname(path))

                fd, tmp_path = tempfile.mkstemp(suffix='.tmp', dir=os.path.dirname(path))
                try:
                    total = 0
                    with os.fdopen(fd, 'wb') as f:
                        for chunk in response.iter_content(chunk_size=self.CHUNK_SIZE):
                            if chunk:
                                total += len(chunk)
                                if total > self.MAX_IMAGE_SIZE:
                                    raise DownloadError(
                                        "Image too large (exceeded 100MB): %s" % url
                                    )
                                f.write(chunk)

                    ext = None
                    content_type = response.headers.get('Content-Type', '')
                    ext = MIME_TO_EXT.get(content_type.lower())

                    if not ext:
                        try:
                            with Image.open(tmp_path) as img:
                                ext = PIL_FORMAT_TO_EXT.get(img.format, '.jpg')
                        except (IOError, SyntaxError, ValueError):
                            logger.debug("Image format detection failed for %s, defaulting to .jpg", url)
                            ext = '.jpg'

                    if not path.endswith(ext):
                        path = os.path.splitext(path)[0] + ext

                    shutil.move(tmp_path, path)
                    tmp_path = None

                finally:
                    if tmp_path is not None and os.path.exists(tmp_path):
                        os.unlink(tmp_path)

            logger.debug("Downloaded: %s -> %s", url, path)

        except requests.RequestException as e:
            raise DownloadError(f"Failed to download {url}: {e}")
        finally:
            if pooled_session is not None:
                self._release_session(pooled_session)

    def download_task(self, url: str, output_path: str, referer: str = "") -> bool:
        """从会话池获取 Session 下载单张图片，用完归还

        Args:
            url: 图片 URL
            output_path: 输出路径
            referer: 可选的 Referer 请求头

        Returns:
            是否成功
        """
        session = None
        try:
            session = self._acquire_session()
            self.download(url, output_path, referer=referer, session=session)
            return True
        except Exception as e:
            logger.error("Failed to download %s: %s", url, e)
            return False
        finally:
            if session is not None:
                self._release_session(session)

    def close(self):
        """关闭池中所有 Session"""
        while not self._session_pool.empty():
            try:
                self._session_pool.get_nowait().close()
            except queue.Empty:
                break