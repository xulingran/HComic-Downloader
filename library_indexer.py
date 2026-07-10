"""漫画库资产发现与索引。

复用 ``python/maintenance/scanner.py`` 的格式识别、路径校验和 ComicInfo 解析纯函数，
由 ``LibraryIndexer`` 统一管理扫描生命周期（发现→解析→提交→对账四阶段）。

设计要点（见 openspec/changes/local-comic-library/design.md §3-4）：
- 发现阶段只枚举顶层，拒绝隐藏/temp_/不支持项/符号链接逃逸。
- 解析阶段只对新增或版本变化项读取压缩包/ComicInfo，有界并发。
- 提交阶段短事务批量 upsert。
- 对账阶段仅在未取消且发现完整成功时删除陈旧项。
- 增量判定：规范化相对路径 + 格式 + 大小 + mtime 纳秒。
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from python.maintenance.scanner import (
    _collect_image_files,
    _count_archive_image_pages,
    _count_folder_pages,
    _dir_size,
    _infer_source_site,
    _parse_cbz_comic_info,
    _parse_filename_author_title,
    _validate_path_in_dir,
)

if TYPE_CHECKING:
    from download_history import DownloadHistoryDB
    from library_db import LibraryDB

logger = logging.getLogger(__name__)


# ── 自然排序 ────────────────────────────────────────────────────────

_NATURAL_SORT_RE = re.compile(r"(\d+)")


def natural_sort_key(s: str) -> list:
    """自然排序键：``page1 < page2 < page10`` 而非字典序。

    拆分为非数字和数字段交替序列，数字段转为 int。
    """
    return [int(text) if text.isdigit() else text.lower() for text in _NATURAL_SORT_RE.split(s)]


def natural_sorted(items: list[str]) -> list[str]:
    """对字符串列表执行自然排序。"""
    return sorted(items, key=natural_sort_key)


# ── 数据类 ──────────────────────────────────────────────────────────


@dataclass
class DiscoveredAsset:
    """发现阶段识别的顶层资产。"""

    abs_path: str
    rel_path: str
    format: str  # "cbz" | "zip" | "folder"
    size_bytes: int
    mtime_ns: int
    is_album: bool = False


@dataclass
class ParsedAsset:
    """解析阶段产出的完整资产元数据。"""

    discovered: DiscoveredAsset
    title: str
    author: str
    tags: list[str] = field(default_factory=list)
    source_site: str = ""
    comic_id: str = ""
    comic_source: str = ""
    album_id: str = ""
    album_total_chapters: int = 1
    page_count: int = 0
    chapter_count: int = 1
    chapters: list[dict] = field(default_factory=list)
    metadata_override: dict = field(default_factory=dict)


# ── 扫描取消 ────────────────────────────────────────────────────────


class ScanCancelled(Exception):
    """扫描被用户取消。"""


# ── 索引器 ──────────────────────────────────────────────────────────


class LibraryIndexer:
    """漫画库扫描和索引生命周期管理器。

    四阶段：发现 → 解析 → 提交 → 对账。
    同一时间只允许一个完整扫描（``_scan_lock``）。
    下载完成可调用 ``index_single_path`` 做增量索引。
    """

    def __init__(
        self,
        db: LibraryDB,
        download_dir: str,
        history_db: DownloadHistoryDB | None = None,
        progress_callback: Any | None = None,
    ) -> None:
        self._db = db
        self._download_dir = os.path.realpath(download_dir)
        self._history_db = history_db
        self._progress_callback = progress_callback
        self._scan_lock = threading.Lock()
        self._cancel_event = threading.Event()
        self._current_scan_id: str | None = None

    @property
    def download_dir(self) -> str:
        return self._download_dir

    def is_scanning(self) -> bool:
        state = self._db.get_scan_state()
        return state["isScanning"]

    def start_scan(self) -> str:
        """启动完整扫描。若已有扫描进行中则返回当前 scan_id。"""
        if not self._scan_lock.acquire(blocking=False):
            # 已有扫描进行中
            state = self._db.get_scan_state()
            return state.get("scanId") or self._current_scan_id or ""
        try:
            scan_id = str(uuid.uuid4())
            self._current_scan_id = scan_id
            self._cancel_event.clear()
            self._db.set_scan_state(
                scan_id=scan_id,
                is_scanning=True,
                phase="discovering",
                current=0,
                total=0,
                current_label="",
                last_scan_error=None,
                last_scan_cancelled=False,
            )
            # 在后台线程执行
            executor = ThreadPoolExecutor(max_workers=1)
            executor.submit(self._run_scan, scan_id)
            executor.shutdown(wait=False)
            return scan_id
        except Exception:
            self._scan_lock.release()
            raise

    def cancel_scan(self) -> bool:
        """请求取消当前扫描。返回是否成功请求取消。"""
        if self.is_scanning():
            self._cancel_event.set()
            return True
        return False

    def _run_scan(self, scan_id: str) -> None:
        """执行完整扫描四阶段。"""
        try:
            # ── 阶段 1: 发现 ──
            self._emit_progress("discovering", 0, 0, "正在扫描目录…")
            discovered = self._discover_phase()
            self._check_cancelled()

            # ── 阶段 2: 解析 ──
            root_gen = self._db.get_root_generation()
            self._emit_progress("parsing", 0, len(discovered), "正在解析漫画…")
            parsed = self._parse_phase(discovered, root_gen, scan_id)

            # ── 阶段 3: 提交 ──
            self._emit_progress("committing", 0, len(parsed), "正在提交索引…")
            self._commit_phase(parsed, root_gen)

            # ── 阶段 4: 对账 ──
            if not self._cancel_event.is_set():
                self._emit_progress("reconciling", 0, 0, "正在对账…")
                self._reconcile_phase(discovered, root_gen)
                self._db.set_scan_state(
                    phase="idle",
                    is_scanning=False,
                    scan_id=None,
                    last_scan_completed_at=int(time.time() * 1000),
                    last_scan_cancelled=False,
                )
            else:
                # 取消：不执行对账
                self._db.set_scan_state(
                    phase="idle",
                    is_scanning=False,
                    scan_id=None,
                    last_scan_cancelled=True,
                )
        except ScanCancelled:
            self._db.set_scan_state(
                phase="idle",
                is_scanning=False,
                scan_id=None,
                last_scan_cancelled=True,
            )
        except Exception as e:
            logger.exception("Library scan failed")
            self._db.set_scan_state(
                phase="idle",
                is_scanning=False,
                scan_id=None,
                last_scan_error=str(e),
            )
        finally:
            self._current_scan_id = None
            self._scan_lock.release()

    def _check_cancelled(self) -> None:
        if self._cancel_event.is_set():
            raise ScanCancelled()

    def _emit_progress(self, phase: str, current: int, total: int, label: str) -> None:
        self._db.set_scan_state(phase=phase, current=current, total=total, current_label=label)
        if self._progress_callback:
            self._progress_callback(phase, current, total, label)

    # ── 阶段 1: 发现 ───────────────────────────────────────────────

    def _discover_phase(self) -> list[DiscoveredAsset]:
        """枚举顶层资产，拒绝隐藏/temp_/不支持项/符号链接逃逸。"""
        if not os.path.isdir(self._download_dir):
            return []

        discovered: list[DiscoveredAsset] = []
        for entry in sorted(os.listdir(self._download_dir)):
            # 跳过隐藏项和临时目录
            if entry.startswith(".") or entry.startswith("temp_"):
                continue

            entry_path = os.path.join(self._download_dir, entry)

            # 路径校验：拒绝符号链接逃逸
            try:
                _validate_path_in_dir(entry_path, self._download_dir)
            except ValueError:
                logger.warning("Skipping asset escaping download dir: %s", entry)
                continue

            # 拒绝符号链接
            if os.path.islink(entry_path):
                continue

            rel_path = entry  # 顶层条目名

            if os.path.isfile(entry_path):
                ext = os.path.splitext(entry)[1].lower()
                if ext not in (".cbz", ".zip"):
                    continue
                fmt = "cbz" if ext == ".cbz" else "zip"
                stat = os.stat(entry_path)
                discovered.append(
                    DiscoveredAsset(
                        abs_path=entry_path,
                        rel_path=rel_path,
                        format=fmt,
                        size_bytes=stat.st_size,
                        mtime_ns=stat.st_mtime_ns,
                    )
                )
            elif os.path.isdir(entry_path):
                # 跳过空目录和无图片的目录
                page_count = _count_folder_pages(entry_path)
                if page_count == 0:
                    continue
                stat = os.stat(entry_path)
                is_album = self._detect_album(entry_path)
                discovered.append(
                    DiscoveredAsset(
                        abs_path=entry_path,
                        rel_path=rel_path,
                        format="folder",
                        size_bytes=_dir_size(entry_path),
                        mtime_ns=stat.st_mtime_ns,
                        is_album=is_album,
                    )
                )

        return discovered

    @staticmethod
    def _detect_album(path: str) -> bool:
        """检测目录是否为多章节专辑（含多个各自含图片的子目录）。"""
        chapter_count = 0
        try:
            for sub in os.listdir(path):
                sub_path = os.path.join(path, sub)
                if not os.path.isdir(sub_path):
                    continue
                if sub.startswith("temp_") or sub.startswith("."):
                    continue
                if _collect_image_files(sub_path):
                    chapter_count += 1
        except OSError:
            pass
        return chapter_count >= 2

    # ── 阶段 2: 解析 ───────────────────────────────────────────────

    def _parse_phase(self, discovered: list[DiscoveredAsset], root_gen: int, scan_id: str) -> list[ParsedAsset]:
        """对新增或版本变化项解析元数据，未变化项复用索引。"""
        # 构建 history 路径映射
        path_to_meta = self._build_history_map()

        parsed: list[ParsedAsset] = []
        pending: list[tuple[DiscoveredAsset, dict[str, Any] | None]] = []
        for disc in discovered:
            self._check_cancelled()

            # 增量判定：路径+大小+mtime 未变化则复用
            existing = self._db.find_item_by_path(disc.rel_path, root_gen)
            if existing and self._is_unchanged(existing, disc):
                # 复用现有元数据，但更新 scanned_at
                self._db.upsert_item(
                    {
                        **existing,
                        "scanned_at": int(time.time() * 1000),
                    }
                )
                continue

            pending.append((disc, existing))

        def parse_one(candidate: tuple[DiscoveredAsset, dict[str, Any] | None]) -> ParsedAsset:
            disc, existing = candidate
            try:
                parsed_asset = self._parse_single(disc, path_to_meta)
            except Exception as e:
                logger.warning("Failed to parse asset %s: %s", disc.rel_path, e)
                parsed_asset = ParsedAsset(
                    discovered=disc,
                    title=disc.rel_path,
                    author="未知作者",
                    page_count=0,
                )

            # ZIP/folder metadata overrides are deliberately separate from
            # parsed on-disk metadata and must survive an external file change.
            override = existing.get("metadata_override", {}) if existing else {}
            if override and disc.format != "cbz":
                if isinstance(override.get("title"), str):
                    parsed_asset.title = override["title"]
                if isinstance(override.get("author"), str):
                    parsed_asset.author = override["author"]
                if isinstance(override.get("tags"), list):
                    parsed_asset.tags = override["tags"]
                parsed_asset.metadata_override = override
            return parsed_asset

        # Parsing archives and directory metadata is IO-bound. Keep the pool
        # deliberately small so a large first scan cannot starve downloads.
        with ThreadPoolExecutor(max_workers=min(4, max(1, len(pending)))) as executor:
            for idx, parsed_asset in enumerate(executor.map(parse_one, pending), 1):
                self._check_cancelled()
                parsed.append(parsed_asset)
                self._emit_progress("parsing", idx, len(pending), parsed_asset.discovered.rel_path)

        return parsed

    def _is_unchanged(self, existing: dict[str, Any], disc: DiscoveredAsset) -> bool:
        """增量判定：规范化相对路径、格式、大小和 mtime 是否一致。"""
        return (
            existing.get("format") == disc.format
            and existing.get("size_bytes") == disc.size_bytes
            and existing.get("mtime_ns") == disc.mtime_ns
        )

    def _parse_single(self, disc: DiscoveredAsset, path_to_meta: dict[str, dict]) -> ParsedAsset:
        """解析单个资产的完整元数据。"""
        meta = path_to_meta.get(disc.abs_path, {})

        if disc.format in ("cbz", "zip"):
            return self._parse_archive(disc, meta)
        else:
            return self._parse_folder(disc, meta)

    def _parse_archive(self, disc: DiscoveredAsset, meta: dict) -> ParsedAsset:
        """解析 CBZ/ZIP 压缩包。"""
        comic_info = _parse_cbz_comic_info(disc.abs_path) if disc.format == "cbz" else {}
        page_count = _count_archive_image_pages(disc.abs_path)

        # CBZ: ComicInfo > history > filename > 兜底
        # ZIP: history > filename > 兜底
        if disc.format == "cbz":
            author = comic_info.get("Writer", "")
            title = comic_info.get("Title", "")
        else:
            author = ""
            title = ""

        # history 优先补全标题/作者；文件名只作为最后的结构化回退。
        title = title or meta.get("title", "")
        author = author or meta.get("author", "")

        # 文件名解析补全
        if not author or not title:
            parsed_author, parsed_title = _parse_filename_author_title(disc.rel_path)
            author = author or parsed_author
            title = title or parsed_title

        # history 补全来源
        source_site = _infer_source_site(disc.abs_path) or meta.get("source_site", "")

        tags_str = comic_info.get("Tags", "")
        tags = [t.strip() for t in tags_str.split(",") if t.strip()] if tags_str else []

        return ParsedAsset(
            discovered=disc,
            title=title or disc.rel_path,
            author=author or "未知作者",
            tags=tags,
            source_site=source_site,
            comic_id=meta.get("comic_id", ""),
            comic_source=meta.get("comic_source", ""),
            album_id=meta.get("album_id", ""),
            album_total_chapters=meta.get("album_total_chapters", 1) or 1,
            page_count=page_count,
            chapter_count=1,
            metadata_override={},
        )

    def _parse_folder(self, disc: DiscoveredAsset, meta: dict) -> ParsedAsset:
        """解析图片文件夹（单本或多章节专辑）。"""
        is_album = disc.is_album

        if is_album:
            chapters = self._parse_chapters(disc.abs_path)
            total_pages = sum(ch["page_count"] for ch in chapters)
            page_count = total_pages
            chapter_count = len(chapters)
        else:
            images = _collect_image_files(disc.abs_path)
            total_pages = len(images)
            page_count = total_pages
            chapter_count = 1
            chapters = []

        # 文件夹：history > filename > 兜底
        title = meta.get("title", "")
        author = meta.get("author", "")
        source_site = meta.get("source_site", "") or _infer_source_site(disc.abs_path)

        if not author or not title:
            parsed_author, parsed_title = _parse_filename_author_title(disc.rel_path)
            author = author or parsed_author
            title = title or parsed_title

        pa = ParsedAsset(
            discovered=disc,
            title=title or disc.rel_path,
            author=author or "未知作者",
            source_site=source_site,
            comic_id=meta.get("comic_id", ""),
            comic_source=meta.get("comic_source", ""),
            album_id=meta.get("album_id", ""),
            album_total_chapters=meta.get("album_total_chapters", 1) or 1,
            page_count=page_count,
            chapter_count=chapter_count,
        )
        pa.chapters = chapters
        return pa

    def _parse_chapters(self, album_path: str) -> list[dict]:
        """解析多章节专辑的章节列表。"""
        chapters: list[dict] = []
        try:
            entries = [e for e in os.listdir(album_path) if not e.startswith("temp_") and not e.startswith(".")]
        except OSError:
            return []

        chapter_entries = [
            (e, os.path.join(album_path, e))
            for e in natural_sorted(entries)
            if os.path.isdir(os.path.join(album_path, e)) and _collect_image_files(os.path.join(album_path, e))
        ]

        for idx, (name, ch_path) in enumerate(chapter_entries):
            images = _collect_image_files(ch_path)
            chapters.append(
                {
                    # 真实 ID 在提交阶段按 rel_path 与旧记录对齐；新章节再生成 UUID。
                    "chapter_id": "",
                    "display_name": name,
                    "chapter_index": idx,
                    "rel_path": name,
                    "archive_prefix": "",
                    "page_count": len(images),
                    "page_manifest": [],
                }
            )

        return chapters

    def _build_history_map(self) -> dict[str, dict]:
        """构建 output_path → 历史记录的映射。"""
        path_to_meta: dict[str, dict] = {}
        if self._history_db is None:
            return path_to_meta
        try:
            for rec in self._history_db.get_all_records_with_album():
                out_path = rec.get("output_path", "")
                if out_path:
                    path_to_meta[out_path] = rec
                    # 父目录回填（专辑场景）
                    parent = os.path.dirname(out_path)
                    if parent and parent not in path_to_meta:
                        path_to_meta[parent] = rec
        except Exception as e:
            logger.warning("Failed to build history map: %s", e)
        return path_to_meta

    # ── 阶段 3: 提交 ───────────────────────────────────────────────

    def _commit_phase(self, parsed: list[ParsedAsset], root_gen: int) -> None:
        """批量提交资产到索引。"""
        for idx, pa in enumerate(parsed):
            self._check_cancelled()
            self._emit_progress("committing", idx + 1, len(parsed), pa.discovered.rel_path)

            # 查找是否已有同路径记录（增量更新时复用 ID）
            existing = self._db.find_item_by_path(pa.discovered.rel_path, root_gen)
            asset_id = existing["asset_id"] if existing else str(uuid.uuid4())

            self._db.upsert_item(
                {
                    "asset_id": asset_id,
                    "root_generation": root_gen,
                    "rel_path": pa.discovered.rel_path,
                    "format": pa.discovered.format,
                    "size_bytes": pa.discovered.size_bytes,
                    "mtime_ns": pa.discovered.mtime_ns,
                    "title": pa.title,
                    "author": pa.author,
                    "tags": pa.tags,
                    "source_site": pa.source_site,
                    "comic_id": pa.comic_id,
                    "comic_source": pa.comic_source,
                    "album_id": pa.album_id,
                    "album_total_chapters": pa.album_total_chapters,
                    "page_count": pa.page_count,
                    "is_album": pa.discovered.is_album,
                    "chapter_count": pa.chapter_count,
                    # 进入 parsed 列表说明资产 stat 已变化，旧封面必须失效。
                    "cover_key": None,
                    "health_status": existing.get("health_status", "unknown") if existing else "unknown",
                    "last_read_at": existing.get("last_read_at") if existing else None,
                    "created_at": (
                        existing.get("created_at", int(time.time() * 1000)) if existing else int(time.time() * 1000)
                    ),
                    "scanned_at": int(time.time() * 1000),
                    "metadata_override": pa.metadata_override,
                    "version": existing.get("version", 1) + 1 if existing else 1,
                }
            )

            # 原子替换章节，按相对路径保留稳定 chapter_id 并删除旧章节。
            self._db.replace_chapters(asset_id, pa.chapters)

            self._emit_progress("committing", idx + 1, len(parsed), pa.discovered.rel_path)

    # ── 阶段 4: 对账 ───────────────────────────────────────────────

    def _reconcile_phase(self, discovered: list[DiscoveredAsset], root_gen: int) -> None:
        """删除当前 generation 中未发现的陈旧索引项。"""
        seen_paths = {d.rel_path for d in discovered}
        self._db.delete_items_not_in(seen_paths, root_gen)

    # ── 增量索引（下载完成后单路径）────────────────────────────────

    def index_single_path(self, abs_path: str) -> str | None:
        """对单个路径执行增量索引。返回 asset_id 或 None。

        不与完整扫描并发解析同一资产（``_scan_lock`` 保护）。
        路径必须在下载目录内。
        """
        with self._scan_lock:
            return self._index_single_path_locked(abs_path)

    def _index_single_path_locked(self, abs_path: str) -> str | None:
        """Implementation of :meth:`index_single_path` under scan exclusion."""
        if not os.path.exists(abs_path):
            return None
        try:
            _validate_path_in_dir(abs_path, self._download_dir)
        except ValueError:
            return None

        entry = os.path.basename(abs_path)
        if entry.startswith(".") or entry.startswith("temp_"):
            return None

        root_gen = self._db.get_root_generation()
        stat = os.stat(abs_path)
        ext = os.path.splitext(entry)[1].lower()
        path_to_meta = self._build_history_map()

        if os.path.isfile(abs_path) and ext in (".cbz", ".zip"):
            fmt = "cbz" if ext == ".cbz" else "zip"
            disc = DiscoveredAsset(
                abs_path=abs_path,
                rel_path=entry,
                format=fmt,
                size_bytes=stat.st_size,
                mtime_ns=stat.st_mtime_ns,
            )
        elif os.path.isdir(abs_path):
            if _count_folder_pages(abs_path) == 0:
                return None
            disc = DiscoveredAsset(
                abs_path=abs_path,
                rel_path=entry,
                format="folder",
                size_bytes=_dir_size(abs_path),
                mtime_ns=stat.st_mtime_ns,
                is_album=self._detect_album(abs_path),
            )
        else:
            return None

        existing = self._db.find_item_by_path(entry, root_gen)
        try:
            pa = self._parse_single(disc, path_to_meta)
        except Exception as e:
            logger.warning("Failed to index %s: %s", entry, e)
            return None

        override = existing.get("metadata_override", {}) if existing else {}
        if override and disc.format != "cbz":
            if isinstance(override.get("title"), str):
                pa.title = override["title"]
            if isinstance(override.get("author"), str):
                pa.author = override["author"]
            if isinstance(override.get("tags"), list):
                pa.tags = override["tags"]
            pa.metadata_override = override

        # 复用已有 ID
        asset_id = existing["asset_id"] if existing else str(uuid.uuid4())
        changed = not existing or not self._is_unchanged(existing, disc)

        self._db.upsert_item(
            {
                "asset_id": asset_id,
                "root_generation": root_gen,
                "rel_path": entry,
                "format": disc.format,
                "size_bytes": disc.size_bytes,
                "mtime_ns": disc.mtime_ns,
                "title": pa.title,
                "author": pa.author,
                "tags": pa.tags,
                "source_site": pa.source_site,
                "comic_id": pa.comic_id,
                "comic_source": pa.comic_source,
                "album_id": pa.album_id,
                "album_total_chapters": pa.album_total_chapters,
                "page_count": pa.page_count,
                "is_album": disc.is_album,
                "chapter_count": pa.chapter_count,
                "cover_key": None if changed else existing.get("cover_key"),
                "health_status": existing.get("health_status", "unknown") if existing else "unknown",
                "last_read_at": existing.get("last_read_at") if existing else None,
                "created_at": (
                    existing.get("created_at", int(time.time() * 1000)) if existing else int(time.time() * 1000)
                ),
                "scanned_at": int(time.time() * 1000),
                "metadata_override": pa.metadata_override,
                "version": (existing.get("version", 1) + (1 if changed else 0) if existing else 1),
            }
        )

        self._db.replace_chapters(asset_id, pa.chapters)

        return asset_id
