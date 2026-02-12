"""漫画下载模块"""
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional
from io import BytesIO

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from PIL import Image

from models import ComicInfo
from utils import apply_system_proxy_to_session, ensure_dir, format_file_size

# 图片扩展名映射
MIME_TO_EXT = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
}

# Pillow 格式到扩展名映射
PIL_FORMAT_TO_EXT = {
    'JPEG': '.jpg',
    'PNG': '.png',
    'GIF': '.gif',
    'WEBP': '.webp',
    'BMP': '.bmp',
    'ICO': '.ico',
}

logger = logging.getLogger(__name__)


class DownloadError(Exception):
    """下载错误"""
    pass


@dataclass
class DownloadResult:
    success: bool
    completed_pages: List[int]
    failed_pages: List[int]
    temp_dir: str
    error_message: Optional[str] = None


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
        self.session = self._create_session()
        self.configure_auth(cookie=cookie, user_agent=user_agent)

    def _create_session(self) -> requests.Session:
        """创建配置了重试的会话"""
        session = requests.Session()
        apply_system_proxy_to_session(session)
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
            "Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
            "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,en-US;q=0.5,en;q=0.3",
            "Referer": "https://h-comic.com/",
        })

        # 配置重试
        retry_strategy = Retry(
            total=self.retry_times,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=10, pool_maxsize=10)
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        return session

    def configure_auth(self, cookie: str = "", user_agent: str = ""):
        """配置登录相关请求头。"""
        ua = (user_agent or "").strip()
        ck = (cookie or "").strip()

        if ua:
            self.session.headers["User-Agent"] = ua
        if ck:
            self.session.headers["Cookie"] = ck
        else:
            self.session.headers.pop("Cookie", None)

    def download_comic(
        self,
        comic: ComicInfo,
        output_dir: str,
        progress_callback: Optional[Callable[[int, int, str, Optional[dict]], None]] = None,
        delay_after: int = 0,
        comic_info: Optional[dict] = None,
    ) -> str:
        """下载完整漫画（向后兼容，内部调用 download_comic_resume）

        Args:
            comic: 漫画信息
            output_dir: 输出目录
            progress_callback: 进度回调函数(current, total, status, comic_info)
            delay_after: 下载完成后延迟的秒数（用于批量下载）
            comic_info: 漫画信息字典，用于批量下载时传递上下文

        Returns:
            临时图片目录路径

        Raises:
            DownloadError: 当下载不完整时抛出
        """
        result = self.download_comic_resume(
            comic=comic,
            output_dir=output_dir,
            progress_callback=progress_callback,
            delay_after=delay_after,
            comic_info=comic_info,
            completed_pages=None,
            failed_pages=None,
        )

        if not result.success:
            raise DownloadError(result.error_message or "下载失败")

        return result.temp_dir

    def _download_image_task(self, url: str, output_path: Path) -> bool:
        """下载单张图片的任务

        Args:
            url: 图片 URL
            output_path: 输出路径

        Returns:
            是否成功
        """
        try:
            self.download_image(url, str(output_path))
            return True
        except Exception as e:
            logger.error(f"Failed to download {url}: {e}")
            return False

    def download_image(self, url: str, path: str):
        """下载单张图片，自动检测格式

        Args:
            url: 图片 URL
            path: 保存路径
        """
        try:
            response = self.session.get(url, timeout=self.timeout, stream=True)
            response.raise_for_status()

            # 确保目录存在
            ensure_dir(os.path.dirname(path))

            # 下载内容
            content = response.content

            # 检测图片格式
            ext = None
            # 首先尝试从 Content-Type 获取
            content_type = response.headers.get('Content-Type', '')
            ext = MIME_TO_EXT.get(content_type.lower())

            # 如果 Content-Type 不可靠，使用 Pillow 检测
            if not ext:
                try:
                    with Image.open(BytesIO(content)) as img:
                        ext = PIL_FORMAT_TO_EXT.get(img.format, '.jpg')
                except Exception:
                    ext = '.jpg'

            # 确保路径有正确的扩展名
            if not path.endswith(ext):
                path = os.path.splitext(path)[0] + ext

            # 保存文件
            with open(path, 'wb') as f:
                f.write(content)

            logger.debug(f"Downloaded: {url} -> {path}")

        except requests.RequestException as e:
            raise DownloadError(f"Failed to download {url}: {e}")

    def download_with_progress(
        self,
        urls: List[str],
        output_dir: str,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> List[str]:
        """带进度回调的批量下载

        Args:
            urls: 图片 URL 列表
            output_dir: 输出目录
            progress_callback: 进度回调函数(current, total, status)

        Returns:
            成功下载的文件路径列表
        """
        ensure_dir(output_dir)
        total = len(urls)
        completed = 0
        failed = 0
        downloaded_paths = []

        def update_status():
            if progress_callback:
                status = f"下载中... ({completed}/{total}, 失败: {failed})"
                progress_callback(completed, total, status)

        with ThreadPoolExecutor(max_workers=self.concurrent_downloads) as executor:
            future_to_info = {
                executor.submit(
                    self._download_image_task,
                    url,
                    Path(output_dir) / f"{i+1:03d}.jpg",
                ): (i, url, Path(output_dir) / f"{i+1:03d}.jpg")
                for i, url in enumerate(urls)
            }

            for future in as_completed(future_to_info):
                i, url, path = future_to_info[future]
                try:
                    success = future.result()
                    if success:
                        completed += 1
                        downloaded_paths.append(str(path))
                    else:
                        failed += 1
                except Exception as e:
                    logger.error(f"Download error for {url}: {e}")
                    failed += 1

                update_status()

        return downloaded_paths

    def download_comic_resume(
        self,
        comic: ComicInfo,
        output_dir: str,
        progress_callback: Optional[Callable[[int, int, str, Optional[dict]], None]] = None,
        delay_after: int = 0,
        comic_info: Optional[dict] = None,
        completed_pages: Optional[List[int]] = None,
        failed_pages: Optional[List[int]] = None,
    ) -> DownloadResult:
        """断点续传下载漫画

        Args:
            comic: 漫画信息
            output_dir: 输出目录
            progress_callback: 进度回调函数(current, total, status, comic_info)
            delay_after: 下载完成后延迟的秒数（用于批量下载）
            comic_info: 漫画信息字典，用于批量下载时传递上下文
            completed_pages: 已完成的页码列表（1-based），这些页面会被跳过
            failed_pages: 之前失败的页码列表（1-based），会优先重试这些

        Returns:
            DownloadResult 对象，包含下载结果和状态
        """
        # 初始化已完成和失败页面列表
        completed_pages = completed_pages or []
        failed_pages = failed_pages or []
        completed_set = set(completed_pages)

        # 创建或复用临时目录
        temp_dir = Path(output_dir) / f"temp_{comic.id}"
        ensure_dir(str(temp_dir))

        # 获取所有图片 URL
        image_urls = comic.get_all_image_urls()
        total = len(image_urls)

        if total == 0:
            return DownloadResult(
                success=False,
                completed_pages=[],
                failed_pages=[],
                temp_dir=str(temp_dir),
                error_message="No images to download"
            )

        # 计算需要下载的页面
        # 1. 优先重试之前失败的页面
        # 2. 然后下载尚未完成的页面
        pages_to_download = []

        # 添加失败的页面（优先）
        for page_num in failed_pages:
            if 1 <= page_num <= total:
                pages_to_download.append(page_num)

        # 添加未完成的页面
        for page_num in range(1, total + 1):
            if page_num not in completed_set and page_num not in pages_to_download:
                pages_to_download.append(page_num)

        if not pages_to_download:
            logger.info(f"All pages already downloaded: {comic.title}")
            if progress_callback:
                progress_callback(total, total, "所有页面已下载", comic_info)
            return DownloadResult(
                success=True,
                completed_pages=list(range(1, total + 1)),
                failed_pages=[],
                temp_dir=str(temp_dir)
            )

        logger.info(f"Resuming download: {comic.title} ({len(pages_to_download)}/{total} pages remaining)")

        # 跟踪下载状态
        new_completed = []
        new_failed = []
        downloaded_count = len(completed_pages)

        with ThreadPoolExecutor(max_workers=self.concurrent_downloads) as executor:
            # 提交任务
            future_to_page = {}
            for page_num in pages_to_download:
                url = image_urls[page_num - 1]  # 转换为 0-based 索引
                output_path = temp_dir / f"{page_num:03d}.jpg"
                future = executor.submit(
                    self._download_image_task,
                    url,
                    output_path,
                )
                future_to_page[future] = page_num

            # 处理完成的任务
            for future in as_completed(future_to_page):
                page_num = future_to_page[future]
                try:
                    success = future.result()
                    if success:
                        downloaded_count += 1
                        new_completed.append(page_num)
                    else:
                        new_failed.append(page_num)
                except Exception as e:
                    logger.error(f"Download error for page {page_num}: {e}")
                    new_failed.append(page_num)

                # 更新进度
                if progress_callback:
                    status = f"下载中... ({downloaded_count}/{total})"
                    if new_failed:
                        status += f"，失败: {len(new_failed)}"
                    progress_callback(downloaded_count, total, status, comic_info)

        # 合并结果
        all_completed = completed_pages + new_completed
        all_failed = new_failed

        # 判断是否成功
        success = len(all_failed) == 0

        if success:
            logger.info(f"Download completed: {comic.title}")
            if progress_callback:
                progress_callback(downloaded_count, total, "下载完成", comic_info)
        else:
            logger.warning(f"Download completed with {len(all_failed)} failures")
            if progress_callback:
                progress_callback(downloaded_count, total, f"完成，{len(all_failed)} 页失败", comic_info)

        # 批量下载延迟
        if delay_after > 0:
            logger.info(f"Waiting {delay_after}s before next download")
            if progress_callback:
                progress_callback(downloaded_count, total, f"等待 {delay_after} 秒...", comic_info)
            time.sleep(delay_after)

        return DownloadResult(
            success=success,
            completed_pages=all_completed,
            failed_pages=all_failed,
            temp_dir=str(temp_dir),
            error_message=None if success else f"下载不完整: {len(all_failed)}/{total} 页下载失败"
        )

    def cleanup_temp_dir(self, temp_dir: str):
        """清理临时目录

        Args:
            temp_dir: 临时目录路径
        """
        import shutil
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                logger.debug(f"Cleaned up: {temp_dir}")
        except Exception as e:
            logger.warning(f"Failed to cleanup {temp_dir}: {e}")
