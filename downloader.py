"""漫画下载模块"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path

import requests

from image_downloader import ImageDownloader
from image_formats import PAGE_FILENAME_FORMAT
from models import ComicInfo, DownloadCancelledError
from url_validator import UrlValidator
from utils import (
    configure_session_auth,
    create_downloader_session,
    ensure_dir,
    sanitize_filename,
)

logger = logging.getLogger(__name__)

PROGRESS_THROTTLE_SEC = 0.1
DEFAULT_IMAGE_EXT = ".jpg"


@dataclass
class DownloadResult:
    success: bool
    completed_pages: list[int]
    failed_pages: list[int]
    temp_dir: str
    error_message: str | None = None


@dataclass
class DownloadOptions:
    """Optional parameters for download_comic_resume."""

    progress_callback: Callable[[int, int, str, dict | None], None] | None = None
    delay_after: int = 0
    comic_info: dict | None = None
    completed_pages: list[int] | None = None
    failed_pages: list[int] | None = None
    cancel_event: threading.Event | None = None
    pause_event: threading.Event | None = None


@dataclass
class _DownloadRun:
    """Mutable state for an in-progress download batch."""

    future_to_page: dict
    remaining_pages: list
    submitted_idx: int
    image_urls: list
    temp_dir: Path
    download_referer: str
    total: int
    progress_callback: Callable | None
    comic_info: dict | None
    cancel_event: threading.Event | None
    pause_event: threading.Event | None
    downloaded_count: int = 0
    new_completed: list | None = None
    new_failed: list | None = None
    last_progress_ts: float = 0.0

    def __post_init__(self):
        if self.new_completed is None:
            self.new_completed = []
        if self.new_failed is None:
            self.new_failed = []

    def try_report_progress(self) -> None:
        """Throttled progress callback (mutates self.last_progress_ts)."""
        if not self.progress_callback:
            return
        now = time.monotonic()
        status = f"下载中... ({self.downloaded_count}/{self.total})"
        if self.new_failed:
            status += f"，失败: {len(self.new_failed)}"
        if (
            now - self.last_progress_ts
        ) >= PROGRESS_THROTTLE_SEC or self.downloaded_count >= self.total:
            self.progress_callback(
                self.downloaded_count, self.total, status, self.comic_info
            )
            self.last_progress_ts = now


class ComicDownloader:
    """漫画下载器"""

    def __init__(
        self,
        concurrent_downloads: int = 4,
        timeout: int = 30,
        retry_times: int = 3,
        cookie: str = "",
        user_agent: str = "",
    ):
        self.concurrent_downloads = concurrent_downloads
        self.timeout = timeout
        self.retry_times = retry_times
        self.url_validator = UrlValidator()
        self.session = self._create_session()
        self.default_user_agent = self.session.headers.get("User-Agent", "")
        self.image_downloader = ImageDownloader(
            timeout=self.timeout,
            retry_times=self.retry_times,
            cookie=cookie,
            user_agent=user_agent,
            pool_size=self.concurrent_downloads,
        )
        self.configure_auth(cookie=cookie, user_agent=user_agent)

    def _create_session(self) -> requests.Session:
        """创建配置了重试的会话（用于主 Session，与 parser 等共享）"""
        return create_downloader_session(retry_times=self.retry_times)

    def create_isolated_session(self) -> requests.Session:
        """Create an independent session (public wrapper for _create_session)."""
        return self._create_session()

    def configure_auth(
        self, cookie: str = "", user_agent: str = "", bearer_token: str = ""
    ):
        """配置登录相关请求头，同步更新主 Session 和图片下载器池"""
        configure_session_auth(
            self.session,
            {"User-Agent": self.default_user_agent},
            cookie,
            user_agent,
            bearer_token,
        )
        self.image_downloader.configure_auth(cookie=cookie, user_agent=user_agent)

    def rebuild_session(self):
        """重建 HTTP 会话以应用新的重试/超时配置，保留已有认证头。

        同时重建图片下载器会话池。旧 session 不会立即关闭——进行中的下载线程
        可能仍持有引用。它们将在所有引用释放后由 GC 回收。
        """
        old_session = self.session
        self.session = self._create_session()
        for key in ("Cookie", "User-Agent"):
            if key in old_session.headers:
                self.session.headers[key] = old_session.headers[key]
        self.image_downloader.rebuild_pool()
        self.image_downloader.configure_auth(
            cookie=self.session.headers.get("Cookie", ""),
            user_agent=self.session.headers.get("User-Agent", ""),
        )

    def close(self):
        """关闭底层会话连接及图片下载器池"""
        self.session.close()
        self.image_downloader.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _build_temp_dir_name(self, comic: ComicInfo) -> str:
        site = self.url_validator.safe_source_site(
            getattr(comic, "source_site", "hcomic")
        )
        raw_id = str(comic.id or "unknown")
        comic_id = sanitize_filename(raw_id)
        return f"temp_{site}_{comic_id}"

    def _build_referer(self, comic: ComicInfo) -> str:
        site = self.url_validator.safe_source_site(
            getattr(comic, "source_site", "hcomic")
        )
        if site == "moeimg":
            return "https://moeimg.fan/"
        if site == "jmcomic":
            return "https://18comic.vip/"
        if site == "bika":
            return "https://picaapi.picacomic.com/"
        return "https://h-comic.com/"

    @staticmethod
    def _maybe_postprocess_images(comic: ComicInfo, temp_dir: Path) -> None:
        """下载完成后对图片进行后处理（如 jmcomic 反混淆）。"""
        if comic.source_site != "jmcomic" or not comic.scramble_id:
            return
        try:
            from sources.jmcomic.descrambler import descramble_image
        except ImportError:
            logger.warning("jmcomic descrambler not available, skipping postprocess")
            return
        try:
            eps_id = int(comic.id)
        except (ValueError, TypeError):
            return
        for img_file in sorted(temp_dir.iterdir()):
            if not img_file.is_file():
                continue
            try:
                original = img_file.read_bytes()
                descrambled = descramble_image(original, eps_id, img_file.stem)
                if descrambled != original:
                    img_file.write_bytes(descrambled)
            except Exception as e:
                logger.warning("Descramble failed for %s: %s", img_file.name, e)

    @staticmethod
    def _compute_pages_to_download(
        total: int, completed_pages: list[int], failed_pages: list[int]
    ) -> list[int]:
        """计算需要下载的页面列表。

        排序策略：失败页面优先重试（保持原顺序），然后按页码顺序追加未完成页面。
        调用者依赖此排序来控制下载优先级——修改排序逻辑会影响断点续传行为。
        """
        completed_set = set(completed_pages)
        pages_to_download = []
        for page_num in failed_pages:
            if 1 <= page_num <= total:
                pages_to_download.append(page_num)
        for page_num in range(1, total + 1):
            if page_num not in completed_set and page_num not in pages_to_download:
                pages_to_download.append(page_num)
        return pages_to_download

    @staticmethod
    def _apply_delay_after(
        delay_after: int,
        downloaded_count: int,
        total: int,
        cancel_event: threading.Event | None,
        options: DownloadOptions,
    ) -> None:
        """批量下载完成后等待指定秒数。"""
        if delay_after <= 0:
            return
        logger.info("Waiting %ds before next download", delay_after)
        if options.progress_callback:
            options.progress_callback(
                downloaded_count,
                total,
                f"等待 {delay_after} 秒...",
                options.comic_info,
            )
        if cancel_event is not None:
            if cancel_event.wait(delay_after):
                logger.info("Cancel requested during delay after")
                raise DownloadCancelledError("Cancelled during delay after download")
        else:
            time.sleep(delay_after)

    def _submit_download_batch(self, executor, pages, run: _DownloadRun):
        future_to_page = {}
        for page_num in pages:
            if run.cancel_event and run.cancel_event.is_set():
                break
            url = run.image_urls[page_num - 1]
            output_path = str(
                run.temp_dir
                / PAGE_FILENAME_FORMAT.format(page=page_num, ext=DEFAULT_IMAGE_EXT)
            )
            try:
                future = executor.submit(
                    self.image_downloader.download_task,
                    url,
                    output_path,
                    run.download_referer,
                )
            except RuntimeError:
                logger.warning("Executor shut down, cannot submit page %d", page_num)
                break
            future_to_page[future] = page_num
        return future_to_page

    def _collect_and_advance(self, executor, run):
        """从 future pool 收集完成的任务并按需提交下一页。"""
        future_to_page = run.future_to_page
        while future_to_page:
            done, _ = wait(
                future_to_page.keys(),
                return_when=FIRST_COMPLETED,
            )

            if run.cancel_event and run.cancel_event.is_set():
                for f in future_to_page:
                    f.cancel()
                break

            for future in done:
                page_num = future_to_page.pop(future)
                try:
                    success = future.result()
                    if success:
                        run.downloaded_count += 1
                        run.new_completed.append(page_num)
                    else:
                        run.new_failed.append(page_num)
                except Exception as e:
                    logger.error("Download error for page %d: %s", page_num, e)
                    run.new_failed.append(page_num)

                run.try_report_progress()

                is_paused = run.pause_event and run.pause_event.is_set()
                if not is_paused and run.submitted_idx < len(run.remaining_pages):
                    next_page = run.remaining_pages[run.submitted_idx]
                    run.submitted_idx += 1
                    url = run.image_urls[next_page - 1]
                    output_path = str(
                        run.temp_dir
                        / PAGE_FILENAME_FORMAT.format(
                            page=next_page, ext=DEFAULT_IMAGE_EXT
                        )
                    )
                    new_future = executor.submit(
                        self.image_downloader.download_task,
                        url,
                        output_path,
                        run.download_referer,
                    )
                    future_to_page[new_future] = next_page

    def download_comic_resume(
        self,
        comic: ComicInfo,
        output_dir: str,
        options: DownloadOptions | None = None,
    ) -> DownloadResult:
        """断点续传下载漫画

        Args:
            comic: 漫画信息
            output_dir: 输出目录
            options: 可选参数（进度回调、断点状态、控制事件等）

        Returns:
            DownloadResult 对象，包含下载结果和状态
        """
        if options is None:
            options = DownloadOptions()
        progress_callback = options.progress_callback
        delay_after = options.delay_after
        comic_info = options.comic_info
        completed_pages = options.completed_pages or []
        failed_pages = options.failed_pages or []
        cancel_event = options.cancel_event
        pause_event = options.pause_event

        temp_dir = Path(output_dir) / self._build_temp_dir_name(comic)
        ensure_dir(str(temp_dir))

        download_referer = self._build_referer(comic)

        image_urls = comic.get_all_image_urls()
        total = len(image_urls)

        if total == 0:
            return DownloadResult(
                success=False,
                completed_pages=[],
                failed_pages=[],
                temp_dir=str(temp_dir),
                error_message="No images to download",
            )

        pages_to_download = self._compute_pages_to_download(
            total, completed_pages, failed_pages
        )

        if not pages_to_download:
            logger.info("All pages already downloaded: %s", comic.title)
            if progress_callback:
                progress_callback(total, total, "所有页面已下载", comic_info)
            return DownloadResult(
                success=True,
                completed_pages=list(range(1, total + 1)),
                failed_pages=[],
                temp_dir=str(temp_dir),
            )

        logger.info(
            "Resuming download: %s (%d/%d pages remaining)",
            comic.title,
            len(pages_to_download),
            total,
        )

        new_completed: list[int] = []
        new_failed: list[int] = []
        downloaded_count = len(completed_pages)
        last_progress_ts = 0.0

        with ThreadPoolExecutor(max_workers=self.concurrent_downloads) as executor:
            remaining_pages = list(pages_to_download)
            initial_batch = remaining_pages[: self.concurrent_downloads]
            run = _DownloadRun(
                future_to_page={},
                remaining_pages=remaining_pages,
                submitted_idx=0,
                image_urls=image_urls,
                temp_dir=temp_dir,
                download_referer=download_referer,
                total=total,
                progress_callback=progress_callback,
                comic_info=comic_info,
                cancel_event=cancel_event,
                pause_event=pause_event,
                downloaded_count=downloaded_count,
                new_completed=new_completed,
                new_failed=new_failed,
                last_progress_ts=last_progress_ts,
            )
            run.submitted_idx = len(initial_batch)
            run.future_to_page = self._submit_download_batch(
                executor, initial_batch, run
            )

            if run.future_to_page:
                self._collect_and_advance(executor, run)
                downloaded_count = run.downloaded_count
                new_completed = run.new_completed or []
                new_failed = run.new_failed or []

        all_completed = completed_pages + new_completed
        all_failed = list(set(failed_pages + new_failed))

        all_pages_downloaded = len(set(all_completed)) + len(all_failed) == total
        success = len(all_failed) == 0 and all_pages_downloaded

        if success:
            self._maybe_postprocess_images(comic, temp_dir)
            logger.info("Download completed: %s", comic.title)
            if progress_callback:
                progress_callback(downloaded_count, total, "下载完成", comic_info)
        elif pause_event and pause_event.is_set():
            logger.info(
                "Download paused: %s (%d/%d pages)",
                comic.title,
                len(all_completed),
                total,
            )
            if progress_callback:
                progress_callback(
                    downloaded_count,
                    total,
                    f"已暂停 ({len(all_completed)}/{total} 页)",
                    comic_info,
                )
        else:
            logger.warning("Download completed with %d failures", len(all_failed))
            if progress_callback:
                progress_callback(
                    downloaded_count,
                    total,
                    f"完成，{len(all_failed)} 页失败",
                    comic_info,
                )

        self._apply_delay_after(
            delay_after,
            downloaded_count,
            total,
            cancel_event,
            options,
        )

        return DownloadResult(
            success=success,
            completed_pages=all_completed,
            failed_pages=all_failed,
            temp_dir=str(temp_dir),
            error_message=(
                None if success else f"下载不完整: {len(all_failed)}/{total} 页下载失败"
            ),
        )

    def cleanup_temp_dir(self, temp_dir: str):
        """清理临时目录

        Args:
            temp_dir: 临时目录路径
        """
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                logger.debug("Cleaned up: %s", temp_dir)
        except Exception as e:
            logger.warning("Failed to cleanup %s: %s", temp_dir, e)
