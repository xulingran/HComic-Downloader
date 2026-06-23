"""下载目录扫描器 — 识别漫画资产并提取元数据。"""

from __future__ import annotations

import logging
import os
import re
import zipfile
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from xml.etree import ElementTree as ET

from image_formats import SUPPORTED_IMAGE_EXTENSIONS

from . import MaintenanceError

if TYPE_CHECKING:
    from download_history import DownloadHistoryDB

logger = logging.getLogger(__name__)


@dataclass
class ComicAsset:
    """下载目录中识别出的漫画资产。"""

    path: str
    format: str  # "folder" | "cbz" | "zip"
    size_bytes: int = 0
    page_count: int | None = None
    title: str = ""
    author: str = ""
    source_site: str = ""
    comic_id: str = ""
    comic_source: str = ""
    album_id: str = ""
    album_total_chapters: int = 1
    metadata: dict = field(default_factory=dict)


def _validate_path_in_dir(path: str, parent_dir: str) -> str:
    """Resolve and validate that *path* is inside *parent_dir*.

    Returns the resolved absolute path on success.
    Raises ValueError if the path escapes the parent directory.
    """
    real_path = os.path.realpath(path)
    real_parent = os.path.realpath(parent_dir)
    if real_path != real_parent and not real_path.startswith(real_parent + os.sep):
        raise ValueError(f"Path {path!r} escapes download directory {parent_dir!r}")
    return real_path


def _collect_image_files(image_dir: str) -> list[str]:
    """收集目录中的图片文件（按文件名排序）。"""
    image_files = []
    for filename in os.listdir(image_dir):
        ext = os.path.splitext(filename)[1].lower()
        if ext in SUPPORTED_IMAGE_EXTENSIONS:
            image_files.append(os.path.join(image_dir, filename))
    image_files.sort()
    return image_files


def _dir_size(path: str) -> int:
    """递归计算目录大小（不跟随符号链接）。"""
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            if os.path.islink(fp):
                continue
            total += os.path.getsize(fp)
    return total


def _parse_cbz_comic_info(path: str) -> dict:
    """从 CBZ 中读取 ComicInfo.xml，返回解析后的字段字典。"""
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if "ComicInfo.xml" not in zf.namelist():
                return {}
            data = zf.read("ComicInfo.xml")
            root = ET.fromstring(data)
            result = {}
            for child in root:
                if child.text:
                    result[child.tag] = child.text.strip()
            return result
    except Exception as e:
        logger.debug("Failed to parse ComicInfo.xml from %s: %s", path, e)
        return {}


def _count_archive_image_pages(path: str) -> int:
    """统计压缩包内图片条目数量。"""
    try:
        with zipfile.ZipFile(path, "r") as zf:
            return sum(1 for name in zf.namelist() if os.path.splitext(name)[1].lower() in SUPPORTED_IMAGE_EXTENSIONS)
    except Exception as e:
        logger.debug("Failed to count archive pages for %s: %s", path, e)
        return 0


def _count_folder_pages(path: str) -> int:
    """统计 folder 格式下的图片页数（支持专辑 chapter 子目录）。"""
    total = 0
    if not os.path.isdir(path):
        return 0

    # 若目录下有章节子文件夹，汇总各章节图片
    has_chapter_dirs = False
    for entry in sorted(os.listdir(path)):
        entry_path = os.path.join(path, entry)
        if os.path.isdir(entry_path) and not entry.startswith("temp_") and not entry.startswith("."):
            has_chapter_dirs = True
            total += len(_collect_image_files(entry_path))

    if has_chapter_dirs:
        return total

    # 否则直接统计根目录图片
    return len(_collect_image_files(path))


def _parse_filename_author_title(filename: str) -> tuple[str, str]:
    """从文件名模板 `{author}-{title}` 中解析作者和标题。

    先剥离前导 ``[...]`` / ``(...)`` 分组（如 ``[Author]`` / ``(Author)``），
    再按第一个 ``-`` 分隔；无法解析时返回 ("", base)。
    """
    base = os.path.splitext(filename)[0]
    # 剥离前导方/圆括号分组（如 "[Author] " / "(Author) "），避免把整段含括号的字符串当作作者
    base = re.sub(r"^\s*[\[(][^\])]*[\])]\s*", "", base)
    # 去掉可能存在的专辑序号前缀等，优先按第一个 "-" 分割
    if "-" not in base:
        return "", base
    author, title = base.split("-", 1)
    return author.strip(), title.strip()


def _infer_source_site(path: str) -> str:
    """从路径特征推断来源站点。"""
    basename = os.path.basename(path)
    lower = basename.lower()
    if lower.startswith("temp_hcomic_") or "h-comic" in lower:
        return "hcomic"
    if lower.startswith("temp_moeimg_") or "moeimg" in lower:
        return "moeimg"
    if lower.startswith("temp_jmcomic_") or "18comic" in lower:
        return "jmcomic"
    if lower.startswith("temp_bika_") or "pica" in lower:
        return "bika"
    if lower.startswith("temp_copymanga_") or "copymanga" in lower:
        return "copymanga"
    return ""


def scan_download_dir(download_dir: str, history_db: DownloadHistoryDB | None = None) -> list[ComicAsset]:
    """扫描下载目录，识别所有漫画资产。

    Args:
        download_dir: 下载目录绝对路径。
        history_db: 可选的历史记录 DB，用于补充元数据。

    Returns:
        ComicAsset 列表。
    """
    if not download_dir or not os.path.isdir(download_dir):
        raise MaintenanceError(f"下载目录不存在或不可读: {download_dir}")

    assets: list[ComicAsset] = []

    # 预加载 history 路径到元数据的映射
    path_to_meta: dict[str, dict] = {}
    if history_db is not None:
        try:
            for rec in history_db.get_all_records_with_album():
                out_path = rec.get("output_path", "")
                if out_path:
                    path_to_meta[out_path] = rec
        except Exception as e:
            logger.warning("Failed to load history metadata for scanning: %s", e)

    for entry in sorted(os.listdir(download_dir)):
        if entry.startswith("temp_") or entry.startswith("."):
            continue

        entry_path = os.path.join(download_dir, entry)
        _validate_path_in_dir(entry_path, download_dir)

        if os.path.isfile(entry_path):
            ext = os.path.splitext(entry)[1].lower()
            if ext not in (".cbz", ".zip"):
                continue

            asset_format = "cbz" if ext == ".cbz" else "zip"
            size_bytes = os.path.getsize(entry_path)
            page_count = _count_archive_image_pages(entry_path)
            comic_info = _parse_cbz_comic_info(entry_path) if asset_format == "cbz" else {}

            author = comic_info.get("Writer", "")
            title = comic_info.get("Title", "")
            source_site = _infer_source_site(entry_path)
            page_count_meta = comic_info.get("PageCount", "")

            if not author or not title:
                parsed_author, parsed_title = _parse_filename_author_title(entry)
                author = author or parsed_author
                title = title or parsed_title

            # 尝试用 history 补全来源和标题
            meta = path_to_meta.get(entry_path, {})
            source_site = source_site or meta.get("source_site", "")
            title = title or meta.get("title", "")
            author = author or meta.get("author", "")

            assets.append(
                ComicAsset(
                    path=entry_path,
                    format=asset_format,
                    size_bytes=size_bytes,
                    page_count=page_count or (int(page_count_meta) if page_count_meta.isdigit() else None),
                    title=title,
                    author=author,
                    source_site=source_site,
                    comic_id=meta.get("comic_id", ""),
                    comic_source=meta.get("comic_source", ""),
                    album_id=meta.get("album_id", ""),
                    album_total_chapters=meta.get("album_total_chapters", 1) or 1,
                    metadata=comic_info,
                )
            )

        elif os.path.isdir(entry_path):
            # 跳过空目录和没有图片的目录
            if _count_folder_pages(entry_path) == 0:
                continue

            size_bytes = _dir_size(entry_path)
            page_count = _count_folder_pages(entry_path)

            meta = path_to_meta.get(entry_path, {})
            title = meta.get("title", "")
            author = meta.get("author", "")
            source_site = meta.get("source_site", "") or _infer_source_site(entry_path)

            if not author or not title:
                parsed_author, parsed_title = _parse_filename_author_title(entry)
                author = author or parsed_author
                title = title or parsed_title

            assets.append(
                ComicAsset(
                    path=entry_path,
                    format="folder",
                    size_bytes=size_bytes,
                    page_count=page_count,
                    title=title,
                    author=author,
                    source_site=source_site,
                    comic_id=meta.get("comic_id", ""),
                    comic_source=meta.get("comic_source", ""),
                    album_id=meta.get("album_id", ""),
                    album_total_chapters=meta.get("album_total_chapters", 1) or 1,
                )
            )

    return assets


def is_image_file(path: str) -> bool:
    """判断路径是否为支持的图片文件。"""
    return os.path.splitext(path)[1].lower() in SUPPORTED_IMAGE_EXTENSIONS


# re-export for convenience
__all__ = [
    "ComicAsset",
    "MaintenanceError",
    "scan_download_dir",
    "is_image_file",
    "_collect_image_files",
    "_dir_size",
    "_parse_cbz_comic_info",
    "_count_archive_image_pages",
    "_count_folder_pages",
    "_parse_filename_author_title",
    "_infer_source_site",
]
