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


def calculate_grid_columns(window_width: int, min_card_width: int, padding: int) -> int:
    """计算结果网格列数（最少 1 列）。"""
    safe_min_width = max(1, min_card_width)
    safe_padding = max(0, padding)
    available = max(1, window_width - safe_padding)
    return max(1, available // safe_min_width)


def format_download_speed(pages_per_sec: float) -> str:
    """格式化下载速度显示。"""
    if pages_per_sec <= 0:
        return "0.0 页/秒"
    return f"{pages_per_sec:.1f} 页/秒"


def build_batch_summary(stats: dict) -> str:
    """构建批量下载汇总文本。"""
    success = int(stats.get("completed", 0))
    failed = int(stats.get("failed", 0))
    cancelled = int(stats.get("cancelled", 0))
    return f"批量下载完成\n\n成功: {success} 本\n失败: {failed} 本\n取消: {cancelled} 本"
