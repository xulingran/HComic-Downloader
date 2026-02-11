"""漫画下载模块"""
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
        """下载完整漫画

        Args:
            comic: 漫画信息
            output_dir: 输出目录
            progress_callback: 进度回调函数(current, total, status, comic_info)
            delay_after: 下载完成后延迟的秒数（用于批量下载）
            comic_info: 漫画信息字典，用于批量下载时传递上下文

        Returns:
            临时图片目录路径
        """
        # 创建临时目录
        temp_dir = Path(output_dir) / f"temp_{comic.id}"
        ensure_dir(str(temp_dir))

        # 获取所有图片 URL
        image_urls = comic.get_all_image_urls()
        total = len(image_urls)

        if total == 0:
            raise DownloadError("No images to download")

        logger.info(f"Starting download: {comic.title} ({total} pages)")

        # 多线程下载
        downloaded = 0
        failed_urls = []

        with ThreadPoolExecutor(max_workers=self.concurrent_downloads) as executor:
            # 提交所有任务
            future_to_url = {
                executor.submit(
                    self._download_image_task,
                    url,
                    temp_dir / f"{i+1:03d}.jpg",
                ): url
                for i, url in enumerate(image_urls)
            }

            # 处理完成的任务
            for future in as_completed(future_to_url):
                url = future_to_url[future]
                try:
                    success = future.result()
                    if success:
                        downloaded += 1
                    else:
                        failed_urls.append(url)
                except Exception as e:
                    logger.error(f"Download error for {url}: {e}")
                    failed_urls.append(url)

                # 更新进度
                if progress_callback:
                    progress_callback(downloaded, total, f"下载中... ({downloaded}/{total})", comic_info)

        # 检查失败数量
        if failed_urls:
            failed_count = len(failed_urls)
            logger.warning(f"Download completed with {failed_count} failures")
            if progress_callback:
                progress_callback(downloaded, total, f"完成，{failed_count} 页失败", comic_info)
            # 抛出异常，让调用方知道下载不完整
            raise DownloadError(f"下载不完整: {failed_count}/{total} 页下载失败，请检查网络连接后重试")
        else:
            logger.info(f"Download completed: {comic.title}")
            if progress_callback:
                progress_callback(downloaded, total, "下载完成", comic_info)

        # 批量下载延迟
        if delay_after > 0:
            logger.info(f"Waiting {delay_after}s before next download")
            if progress_callback:
                progress_callback(downloaded, total, f"等待 {delay_after} 秒...", comic_info)
            time.sleep(delay_after)

        return str(temp_dir)

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
