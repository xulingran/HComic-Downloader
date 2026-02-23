"""GUI 无关逻辑，便于在无 Tk 环境下测试。"""

from __future__ import annotations

from typing import Optional, Protocol

from models import ComicInfo


class DownloadManagerLike(Protocol):
    """下载管理器最小协议（用于安全停机）。"""

    def set_callbacks(self, on_task_update=None, on_queue_complete=None):
        ...

    def stop(self):
        ...


def is_moeimg_detail_ready(comic: ComicInfo) -> bool:
    """判断条目是否已具备 moeimg 下载所需详情。"""
    source = (comic.source_site or "").strip().lower()
    if source != "moeimg":
        return True
    return bool(comic.image_urls) and comic.pages > 0


def stop_download_manager_for_shutdown(download_manager: Optional[DownloadManagerLike]) -> None:
    """窗口销毁时安全停止下载管理器，避免队列完成回调触发 UI 更新。"""
    if not download_manager:
        return
    download_manager.set_callbacks(on_task_update=None, on_queue_complete=None)
    download_manager.stop()


def should_ignore_gui_callback(is_destroying: bool) -> bool:
    """销毁阶段应忽略所有 UI 回调。"""
    return bool(is_destroying)


def should_block_source_change(
    is_downloading: bool,
    is_batch_downloading: bool,
    is_preparing_details: bool,
) -> bool:
    """下载相关任务进行中时，禁止切换来源。"""
    return bool(is_downloading or is_batch_downloading or is_preparing_details)
