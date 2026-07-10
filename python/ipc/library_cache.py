"""漫画库图片缓存——封面提取与页面物化。

按需从 CBZ/ZIP/文件夹读取图片并写入有界 LRU 缓存。
图片字节存储在受控缓存目录，文件名使用内容哈希（SHA-256），
由 Electron ``app-image://library/<sha256>`` 协议流式交付。

设计约束（见 design.md §5）：
- 控制面 IPC 只返回内容哈希、媒体类型和资产版本。
- 图片字节不进入 JSON-RPC 或渲染进程 JS 堆。
- 不一次性解压整本漫画。
- 缓存键包含资产 ID、版本、章、页和条目校验信息。
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import tempfile
import threading
import zipfile
from typing import TYPE_CHECKING

from image_formats import SUPPORTED_IMAGE_EXTENSIONS
from library_indexer import natural_sorted
from python.maintenance.scanner import _collect_image_files, _validate_path_in_dir

if TYPE_CHECKING:
    from library_db import LibraryDB

logger = logging.getLogger(__name__)

_DEFAULT_DIR = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
_DEFAULT_CACHE_DIR_NAME = "library_image_cache"
_DEFAULT_MAX_SIZE_MB = 500


def _get_media_type(filename: str) -> str:
    """根据扩展名返回 MIME 类型。"""
    ext = os.path.splitext(filename)[1].lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
    }.get(ext, "application/octet-stream")


class LibraryImageCache:
    """有界 LRU 图片缓存。

    文件以 ``<sha256>.<ext>`` 命名存储在受控缓存目录。
    线程安全（内部 threading.Lock），支持并发提取。
    """

    def __init__(
        self,
        cache_dir: str | None = None,
        max_size_mb: int = _DEFAULT_MAX_SIZE_MB,
    ) -> None:
        self._cache_dir = cache_dir or os.path.join(_DEFAULT_DIR, _DEFAULT_CACHE_DIR_NAME)
        self._max_size_bytes = max_size_mb * 1024 * 1024
        self._lock = threading.Lock()
        self._current_size = 0
        os.makedirs(self._cache_dir, exist_ok=True)
        self._scan_existing_files()

    @property
    def cache_dir(self) -> str:
        return self._cache_dir

    def _scan_existing_files(self) -> None:
        """启动时扫描已有缓存文件，计算总大小用于 LRU 管理。"""
        total = 0
        try:
            for entry in os.listdir(self._cache_dir):
                fp = os.path.join(self._cache_dir, entry)
                if os.path.isfile(fp):
                    total += os.path.getsize(fp)
        except OSError:
            pass
        self._current_size = total

    def _content_hash(self, data: bytes) -> str:
        """计算内容哈希（SHA-256 hex）。"""
        return hashlib.sha256(data).hexdigest()

    def _cache_file_path(self, content_hash: str) -> str:
        """返回缓存文件路径。文件名只允许 hex 字符。"""
        return os.path.join(self._cache_dir, content_hash)

    def _atomic_write(self, content_hash: str, data: bytes) -> str:
        """同目录临时文件原子写入缓存。"""
        cache_path = self._cache_file_path(content_hash)
        if os.path.exists(cache_path):
            # 已缓存，仅更新访问时间
            os.utime(cache_path, None)
            return cache_path

        # 同目录临时文件 → os.replace 原子替换
        tmp_fd, tmp_path = tempfile.mkstemp(dir=self._cache_dir, prefix="tmp_", suffix=".img")
        try:
            with os.fdopen(tmp_fd, "wb") as f:
                f.write(data)
            os.replace(tmp_path, cache_path)
        except Exception:
            with contextlib.suppress(OSError):
                os.remove(tmp_path)
            raise

        with self._lock:
            self._current_size += len(data)
        return cache_path

    def _lru_evict(self) -> None:
        """LRU 清理：删除最久未访问的缓存文件直到低于上限。"""
        with self._lock:
            if self._current_size <= self._max_size_bytes:
                return

            # 收集所有缓存文件及其访问时间
            files: list[tuple[float, str, int]] = []
            try:
                for entry in os.listdir(self._cache_dir):
                    if entry.startswith("tmp_"):
                        continue
                    fp = os.path.join(self._cache_dir, entry)
                    if os.path.isfile(fp):
                        stat = os.stat(fp)
                        files.append((stat.st_atime, fp, stat.st_size))
            except OSError:
                return

            # 按 atime 升序（最旧先删）
            files.sort()
            for _atime, fp, size in files:
                if self._current_size <= self._max_size_bytes:
                    break
                try:
                    os.remove(fp)
                    self._current_size -= size
                except OSError:
                    pass

    def invalidate_for_asset(self, asset_id: str, version: int) -> None:
        """资产版本变化时失效旧缓存。

        由于使用内容哈希命名，旧 URL 自然失效。
        这里只做后台 LRU 清理，不需要精确删除。
        """
        self._lru_evict()

    def clear(self) -> int:
        """清空全部缓存，返回删除的文件数。"""
        count = 0
        with self._lock:
            try:
                for entry in os.listdir(self._cache_dir):
                    fp = os.path.join(self._cache_dir, entry)
                    if os.path.isfile(fp):
                        try:
                            os.remove(fp)
                            count += 1
                        except OSError:
                            pass
            except OSError:
                pass
            self._current_size = 0
        return count

    def has(self, content_hash: str) -> bool:
        """检查缓存文件是否存在。"""
        return os.path.exists(self._cache_file_path(content_hash))


class LibraryPageReader:
    """漫画库页面和封面读取器。

    从 CBZ/ZIP/文件夹安全读取指定页或封面图片，
    写入 ``LibraryImageCache`` 并返回缓存键。
    """

    def __init__(
        self,
        db: LibraryDB,
        download_dir: str,
        cache: LibraryImageCache,
    ) -> None:
        self._db = db
        self._download_dir = os.path.realpath(download_dir)
        self._cache = cache

    def _resolve_asset_path(self, asset_id: str) -> tuple[str, dict] | None:
        """解析资产路径并验证根目录包含关系。返回 (abs_path, item_dict)。"""
        item = self._db.get_item(asset_id)
        if not item:
            return None
        if item["root_generation"] != self._db.get_root_generation():
            return None
        abs_path = os.path.join(self._download_dir, item["rel_path"])
        try:
            _validate_path_in_dir(abs_path, self._download_dir)
        except ValueError:
            return None
        if not os.path.exists(abs_path):
            return None
        real_path = os.path.realpath(abs_path)
        try:
            stat = os.stat(real_path)
        except OSError:
            return None
        if item["format"] in ("cbz", "zip") and (
            stat.st_size != item["size_bytes"] or stat.st_mtime_ns != item["mtime_ns"]
        ):
            return None
        if item["format"] == "folder" and stat.st_mtime_ns != item["mtime_ns"]:
            return None
        return real_path, item

    def extract_cover(self, asset_id: str) -> dict | None:
        """从资产生成封面（第一张有效图片）。

        返回 ``{cover_key, media_type}`` 或 None（无法提取）。
        """
        resolved = self._resolve_asset_path(asset_id)
        if not resolved:
            return None
        abs_path, item = resolved

        try:
            data, media_type = self._read_first_image(abs_path, item["format"])
        except Exception as e:
            logger.warning("Failed to extract cover for %s: %s", asset_id, e)
            return None

        if not data:
            return None

        cover_key = self._cache._content_hash(data)
        self._cache._atomic_write(cover_key, data)
        self._cache._lru_evict()

        # 更新索引中的 cover_key
        self._db.update_item_cover(asset_id, cover_key)

        return {"cover_key": cover_key, "media_type": media_type}

    def materialize_page(
        self,
        asset_id: str,
        chapter_id: str | None,
        page: int,
        version: int,
    ) -> dict | None:
        """物化单页图片到缓存。

        验证资产版本、页码有效性，读取指定页图片并写入缓存。
        返回 ``{imageUrl, version, media_type}`` 或 None。
        """
        item = self._db.get_item(asset_id)
        if not item:
            return None
        if item["version"] != version:
            return None
        if item["root_generation"] != self._db.get_root_generation():
            return None

        resolved = self._resolve_asset_path(asset_id)
        if not resolved:
            return None
        abs_path = resolved[0]

        try:
            if chapter_id:
                # 多章节资产
                data, media_type = self._read_chapter_page(abs_path, item, chapter_id, page)
            else:
                # 单本
                data, media_type = self._read_single_page(abs_path, item["format"], page)
        except Exception as e:
            logger.warning("Failed to materialize page %s/%s: %s", asset_id, page, e)
            return None

        if not data:
            return None

        page_key = self._cache._content_hash(data)
        self._cache._atomic_write(page_key, data)
        self._cache._lru_evict()

        return {
            "imageUrl": f"app-image://library/{page_key}",
            "version": version,
            "mediaType": media_type,
        }

    def get_page_manifest(self, asset_id: str, chapter_id: str | None = None) -> dict | None:
        """生成或获取章节页面 manifest。"""
        item = self._db.get_item(asset_id)
        if not item:
            return None

        resolved = self._resolve_asset_path(asset_id)
        if not resolved:
            return None
        abs_path = resolved[0]

        try:
            if chapter_id:
                chapter = self._db.get_chapter(asset_id, chapter_id)
                if not chapter:
                    return None
                images = self._list_chapter_images(abs_path, item, chapter)
            else:
                images = self._list_images(abs_path, item["format"])
        except Exception as e:
            logger.warning("Failed to get page manifest for %s: %s", asset_id, e)
            return None

        pages = [{"index": idx, "mediaType": _get_media_type(img_name)} for idx, img_name in enumerate(images)]

        ch_id = chapter_id or "default"
        return {
            "chapterId": ch_id,
            "version": item["version"],
            "pages": pages,
        }

    # ── 图片读取 ───────────────────────────────────────────────────

    def _read_first_image(self, abs_path: str, fmt: str) -> tuple[bytes, str]:
        """从资产读取第一张有效图片。"""
        if fmt in ("cbz", "zip"):
            return self._read_archive_page_by_index(abs_path, 0)
        else:
            images = self._list_images(abs_path, "folder")
            if not images:
                return b"", ""
            with open(images[0], "rb") as f:
                data = f.read()
            return data, _get_media_type(images[0])

    def _read_single_page(self, abs_path: str, fmt: str, page: int) -> tuple[bytes, str]:
        """读取单本资产的第 N 页（0-indexed）。"""
        if fmt in ("cbz", "zip"):
            return self._read_archive_page_by_index(abs_path, page - 1)
        else:
            images = self._list_images(abs_path, "folder")
            if page < 1 or page > len(images):
                return b"", ""
            with open(images[page - 1], "rb") as f:
                data = f.read()
            return data, _get_media_type(images[page - 1])

    def _read_chapter_page(
        self,
        abs_path: str,
        item: dict,
        chapter_id: str,
        page: int,
    ) -> tuple[bytes, str]:
        """读取多章节资产的指定章节页面。"""
        chapter = self._db.get_chapter(item["asset_id"], chapter_id)
        if not chapter:
            return b"", ""

        if item["format"] in ("cbz", "zip"):
            # 压缩包内的章节前缀
            prefix = chapter.get("archive_prefix", "")
            images = self._list_archive_images(abs_path, prefix=prefix)
            if page < 1 or page > len(images):
                return b"", ""
            entry = images[page - 1]
            with zipfile.ZipFile(abs_path, "r") as zf:
                data = zf.read(entry)
            return data, _get_media_type(entry)
        else:
            # 文件夹中的章节子目录
            ch_dir = os.path.join(abs_path, chapter["rel_path"])
            images = self._list_images(ch_dir, "folder")
            if page < 1 or page > len(images):
                return b"", ""
            with open(images[page - 1], "rb") as f:
                data = f.read()
            return data, _get_media_type(images[page - 1])

    def _read_archive_page_by_index(self, abs_path: str, index: int) -> tuple[bytes, str]:
        """读取压缩包中第 index 个图片条目（0-indexed）。"""
        images = self._list_archive_images(abs_path)
        if index < 0 or index >= len(images):
            return b"", ""
        entry = images[index]
        with zipfile.ZipFile(abs_path, "r") as zf:
            data = zf.read(entry)
        return data, _get_media_type(entry)

    def _list_archive_images(self, abs_path: str, prefix: str = "") -> list[str]:
        """列出压缩包内按自然排序的图片条目名。"""
        with zipfile.ZipFile(abs_path, "r") as zf:
            names = [
                n
                for n in zf.namelist()
                if not n.endswith("/")
                and os.path.splitext(n)[1].lower() in SUPPORTED_IMAGE_EXTENSIONS
                and (not prefix or n.startswith(prefix))
            ]
        return natural_sorted(names)

    def _list_images(self, abs_path: str, fmt: str) -> list[str]:
        """列出资产内按自然排序的图片文件名/路径。

        对于 CBZ/ZIP 返回压缩包内条目名；对于文件夹返回文件系统路径。
        """
        if fmt in ("cbz", "zip"):
            return self._list_archive_images(abs_path)
        files = _collect_image_files(abs_path)
        return natural_sorted(files)

    def _list_chapter_images(self, abs_path: str, item: dict, chapter: dict) -> list[str]:
        """列出章节内的图片文件名。"""
        if item["format"] in ("cbz", "zip"):
            prefix = chapter.get("archive_prefix", "")
            return self._list_archive_images(abs_path, prefix=prefix)
        else:
            ch_dir = os.path.join(abs_path, chapter["rel_path"])
            return [_get_media_type(f) and os.path.basename(f) for f in self._list_images(ch_dir, "folder")]


def get_default_library_cache_dir() -> str:
    """获取默认漫画库图片缓存目录。"""
    return os.path.join(_DEFAULT_DIR, _DEFAULT_CACHE_DIR_NAME)
