"""专辑下载 staging 协调器 — 管理多章漫画的文件夹组织与打包。"""

from __future__ import annotations

import logging
import os
import shutil
import threading
from dataclasses import dataclass, field

from models import ComicInfo, DownloadTask

logger = logging.getLogger(__name__)

AlbumKey = tuple[str, str]  # (source_site, album_id)


@dataclass
class AlbumState:
    task_ids: set[str] = field(default_factory=set)
    total_chapters: int = 1
    comic: ComicInfo | None = None  # 任一章的 comic，用于提取专辑元数据


@dataclass
class PackResult:
    status: str  # "packed" | "no_chapters" | "conflict" | "error"
    output_path: str | None = None
    packed_chapters: int = 0
    missing_chapters: int = 0
    existing_path: str | None = None
    error_message: str | None = None


@dataclass
class AlbumProgress:
    album_id: str = ""
    album_title: str = ""
    album_folder_path: str = ""
    packed_path: str | None = None
    total_chapters: int = 0
    chapters_on_disk: int = 0
    chapters_in_queue: int = 0
    is_complete: bool = False


class AlbumStagingCoordinator:
    """以 (source_site, album_id) 为单位的专辑下载状态机。"""

    def __init__(
        self,
        download_dir_provider,
        output_format_provider,
        cbz_builder,
        history_db=None,
        on_album_event=None,
    ):
        self._get_download_dir = download_dir_provider
        self._get_output_format = output_format_provider
        self._cbz_builder = cbz_builder
        self._history_db = history_db
        self._on_album_event = on_album_event
        self._tracked: dict[AlbumKey, AlbumState] = {}
        self._pack_lock = threading.Lock()

    def register_album_tasks(
        self,
        album_key: AlbumKey,
        task_ids: list[str],
        album_total_chapters: int,
    ) -> None:
        """_download_chapters 调用：注册本次任务集。"""
        state = self._tracked.get(album_key)
        if state is None:
            state = AlbumState(total_chapters=album_total_chapters)
            self._tracked[album_key] = state
        state.task_ids.update(task_ids)
        state.total_chapters = album_total_chapters

    def set_album_comic(self, album_key: AlbumKey, comic: ComicInfo) -> None:
        """记录专辑的 ComicInfo（用于打包时提取元数据）。"""
        state = self._tracked.get(album_key)
        if state:
            state.comic = comic

    def on_chapter_complete(self, task: DownloadTask, album_work_dir: str) -> None:
        """ComicDownloadManager 在章节成功落盘后调用。"""
        album_key: AlbumKey = (
            task.comic.source_site,
            task.comic.album_id or task.comic.id,
        )
        state = self._tracked.get(album_key)
        if state:
            if state.comic is None:
                state.comic = task.comic
            self._emit_event(album_key, "chapter_done")
            self._check_and_pack(album_key, album_work_dir)

    def force_pack_album(
        self,
        album_key: AlbumKey,
        *,
        overwrite: bool = False,
        comic: ComicInfo | None = None,
    ) -> PackResult:
        """UI「强制打包」入口。"""
        state = self._tracked.get(album_key)
        effective_comic = comic or (state.comic if state else None)

        if effective_comic is None:
            return PackResult(status="no_chapters")

        download_dir = self._get_download_dir()
        work_dir, final_path = self._cbz_builder.get_album_output_path(
            effective_comic, self._get_output_format(), download_dir
        )

        if not os.path.isdir(work_dir):
            return PackResult(status="no_chapters")

        output_format = self._get_output_format()

        if output_format == "cbz":
            with self._pack_lock:
                if os.path.exists(final_path) and not overwrite:
                    return PackResult(
                        status="conflict",
                        existing_path=final_path,
                    )

                chapter_dirs = self._scan_chapter_dirs(work_dir)
                if not chapter_dirs:
                    return PackResult(status="no_chapters")

                self._emit_event(album_key, "force_pack_started")
                try:
                    self._cbz_builder.build_album_cbz(
                        work_dir,
                        effective_comic,
                        final_path,
                        overwrite=overwrite,
                        download_dir=download_dir,
                    )
                    shutil.rmtree(work_dir)
                except Exception as e:
                    logger.error("Force pack failed for %s: %s", album_key, e)
                    self._emit_event(album_key, "force_pack_done", error_message=str(e))
                    return PackResult(status="error", error_message=str(e))

            self._update_history(album_key, final_path)
            self._emit_event(
                album_key,
                "packed",
                output_path=final_path,
                chapters_on_disk=len(chapter_dirs),
            )
            self._tracked.pop(album_key, None)
            return PackResult(
                status="packed",
                output_path=final_path,
                packed_chapters=len(chapter_dirs),
            )
        else:
            # folder 模式：不打包，直接返回当前状态（不清理 _tracked）
            chapter_dirs = self._scan_chapter_dirs(work_dir)
            self._emit_event(
                album_key,
                "packed",
                output_path=work_dir,
                chapters_on_disk=len(chapter_dirs),
            )
            return PackResult(
                status="packed",
                output_path=work_dir,
                packed_chapters=len(chapter_dirs),
            )

    def get_progress(self, album_key: AlbumKey) -> AlbumProgress:
        """供 IPC handle_get_album_progress 调用。"""
        state = self._tracked.get(album_key)
        if state is None:
            return AlbumProgress()

        download_dir = self._get_download_dir()
        comic = state.comic
        if comic is None:
            return AlbumProgress(
                album_id=album_key[1],
                total_chapters=state.total_chapters,
                chapters_in_queue=len(state.task_ids),
            )

        work_dir, final_path = self._cbz_builder.get_album_output_path(comic, self._get_output_format(), download_dir)

        chapters_on_disk = 0
        if os.path.isdir(work_dir):
            chapters_on_disk = len(self._scan_chapter_dirs(work_dir))

        packed_path = final_path if os.path.exists(final_path) else None

        return AlbumProgress(
            album_id=album_key[1],
            album_title=comic.album_title,
            album_folder_path=work_dir,
            packed_path=packed_path,
            total_chapters=state.total_chapters,
            chapters_on_disk=chapters_on_disk,
            chapters_in_queue=len(state.task_ids),
            is_complete=packed_path is not None,
        )

    def _check_and_pack(self, album_key: AlbumKey, album_work_dir: str) -> None:
        """判定是否齐套并自动打包（仅 cbz 模式）。"""
        state = self._tracked.get(album_key)
        if state is None or state.comic is None:
            return

        output_format = self._get_output_format()
        if output_format != "cbz":
            return

        chapter_dirs = self._scan_chapter_dirs(album_work_dir)
        if len(chapter_dirs) < state.total_chapters:
            return

        # 齐套：自动打包
        self.force_pack_album(album_key, overwrite=False, comic=state.comic)

    def _scan_chapter_dirs(self, album_dir: str) -> list[str]:
        """扫描专辑工作目录下的章节子文件夹（排除 temp_* 和隐藏目录）。"""
        if not os.path.isdir(album_dir):
            return []
        return sorted(
            d
            for d in os.listdir(album_dir)
            if os.path.isdir(os.path.join(album_dir, d)) and not d.startswith("temp_") and not d.startswith(".")
        )

    def _update_history(self, album_key: AlbumKey, new_path: str) -> None:
        """更新 download_history 中该专辑所有记录的 output_path。"""
        if self._history_db is None:
            return
        state = self._tracked.get(album_key)
        if state is None or state.comic is None:
            return
        try:
            count = self._history_db.update_output_path_by_album(
                source_site=album_key[0],
                comic_source=state.comic.comic_source,
                album_id=album_key[1],
                new_path=new_path,
            )
            logger.info("Updated %d history records for album %s", count, album_key)
        except Exception:
            logger.warning("Failed to update history for album %s", album_key, exc_info=True)

    def _emit_event(self, album_key: AlbumKey, event: str, **kwargs) -> None:
        if self._on_album_event:
            try:
                self._on_album_event(album_key, event, **kwargs)
            except Exception:
                logger.warning("Album event callback failed", exc_info=True)
