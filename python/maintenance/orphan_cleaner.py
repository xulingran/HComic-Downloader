"""孤儿临时目录清理器。"""

from __future__ import annotations

import logging
import os
import shutil
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from maintenance.scanner import _dir_size, _validate_path_in_dir

if TYPE_CHECKING:
    from download_history import DownloadHistoryDB

logger = logging.getLogger(__name__)

ORPHAN_MIN_AGE_HOURS = 24


@dataclass
class OrphanTempDir:
    """候选孤儿临时目录。"""

    path: str
    size_bytes: int
    modified_at: int


def _is_temp_dir(path: str) -> bool:
    """判断目录名是否以 temp_ 开头。"""
    return os.path.isdir(path) and os.path.basename(path).startswith("temp_")


def _is_active_temp_dir(path: str, active_temp_dirs: set[str]) -> bool:
    """判断路径是否正被活跃下载任务使用。"""
    real_path = os.path.realpath(path)
    return any(os.path.realpath(active) == real_path for active in active_temp_dirs)


def _is_in_history_output_paths(path: str, output_paths: set[str]) -> bool:
    """判断路径是否出现在历史记录 output_path 中。"""
    real_path = os.path.realpath(path)
    return any(os.path.realpath(out) == real_path for out in output_paths if out)


def _is_old_enough(path: str, min_age_hours: int = ORPHAN_MIN_AGE_HOURS) -> bool:
    """判断目录最后修改时间是否超过阈值。"""
    try:
        mtime = os.path.getmtime(path)
        return (time.time() - mtime) > (min_age_hours * 3600)
    except OSError:
        return False


def scan_orphan_temp_dirs(
    download_dir: str,
    history_db: DownloadHistoryDB | None = None,
    active_temp_dirs: set[str] | None = None,
    min_age_hours: int = ORPHAN_MIN_AGE_HOURS,
) -> list[OrphanTempDir]:
    """扫描下载目录中的孤儿临时目录。

    Args:
        download_dir: 下载目录。
        history_db: 历史记录 DB，用于排除已被成功记录引用的目录。
        active_temp_dirs: 活跃任务正在使用的 temp_dir 集合。
        min_age_hours: 最小年龄阈值（小时）。

    Returns:
        孤儿目录列表（按大小降序）。
    """
    if not download_dir or not os.path.isdir(download_dir):
        raise ValueError(f"下载目录不存在: {download_dir}")

    active_temp_dirs = active_temp_dirs or set()

    output_paths: set[str] = set()
    if history_db is not None:
        try:
            for rec in history_db.get_all_records():
                out_path = rec.get("output_path", "")
                if out_path:
                    output_paths.add(out_path)
        except Exception as e:
            logger.warning("Failed to load history output paths: %s", e)

    orphans: list[OrphanTempDir] = []
    for entry in os.listdir(download_dir):
        entry_path = os.path.join(download_dir, entry)
        if not _is_temp_dir(entry_path):
            continue
        try:
            _validate_path_in_dir(entry_path, download_dir)
        except ValueError:
            continue

        if _is_active_temp_dir(entry_path, active_temp_dirs):
            continue
        if not _is_old_enough(entry_path, min_age_hours):
            continue
        if _is_in_history_output_paths(entry_path, output_paths):
            continue

        try:
            size = _dir_size(entry_path)
            mtime = int(os.path.getmtime(entry_path))
            orphans.append(OrphanTempDir(path=entry_path, size_bytes=size, modified_at=mtime))
        except OSError as e:
            logger.debug("Failed to stat orphan candidate %s: %s", entry_path, e)

    orphans.sort(key=lambda x: x.size_bytes, reverse=True)
    return orphans


def cleanup_orphan_temp_dirs(
    download_dir: str,
    orphans: list[OrphanTempDir] | None = None,
    paths: list[str] | None = None,
    history_db: DownloadHistoryDB | None = None,
    active_temp_dirs: set[str] | None = None,
    min_age_hours: int = ORPHAN_MIN_AGE_HOURS,
) -> dict:
    """清理孤儿临时目录。

    Args:
        download_dir: 下载目录。
        orphans: 已扫描到的孤儿列表（与 paths 二选一）。
        paths: 要清理的路径列表（若提供 orphans 则优先使用 orphans）。
        history_db: 用于重新校验。
        active_temp_dirs: 活跃任务目录集合。
        min_age_hours: 最小年龄阈值。

    Returns:
        {"removed": int, "freedBytes": int, "failed": list[dict]}
    """
    if orphans is None:
        if paths is None:
            orphans = scan_orphan_temp_dirs(
                download_dir,
                history_db=history_db,
                active_temp_dirs=active_temp_dirs,
                min_age_hours=min_age_hours,
            )
        else:
            # 构造 OrphanTempDir 占位，后续重新校验
            orphans = [OrphanTempDir(path=p, size_bytes=0, modified_at=0) for p in paths]

    active_temp_dirs = active_temp_dirs or set()

    output_paths: set[str] = set()
    if history_db is not None:
        try:
            for rec in history_db.get_all_records():
                out_path = rec.get("output_path", "")
                if out_path:
                    output_paths.add(out_path)
        except Exception as e:
            logger.warning("Failed to load history output paths for cleanup: %s", e)

    removed = 0
    freed_bytes = 0
    failed: list[dict] = []

    # 以下四项校验必须在删除循环内逐个实时执行，禁止下沉到扫描阶段：
    #   - _validate_path_in_dir：防止 path 越界下载目录
    #   - _is_temp_dir：仅删 temp_* 目录
    #   - _is_active_temp_dir：扫描后新启动的下载任务可能复用同名目录
    #   - _is_old_enough：实时读 os.path.getmtime，防止扫描后被刷新的 mtime 误判
    #   - _is_in_history_output_paths：扫描后历史记录可能新增引用
    # 这是消除扫描-删除 TOCTOU 窗口的关键，active_temp_dirs 由调用方即时重取。
    for orphan in orphans:
        path = orphan.path
        try:
            _validate_path_in_dir(path, download_dir)
        except ValueError as e:
            failed.append({"path": path, "reason": f"路径校验失败: {e}"})
            continue

        if not _is_temp_dir(path):
            failed.append({"path": path, "reason": "不是临时目录"})
            continue
        if _is_active_temp_dir(path, active_temp_dirs):
            failed.append({"path": path, "reason": "目录正被活跃任务使用"})
            continue
        if not _is_old_enough(path, min_age_hours):
            failed.append({"path": path, "reason": "目录修改时间不足 24 小时"})
            continue
        if _is_in_history_output_paths(path, output_paths):
            failed.append({"path": path, "reason": "目录出现在历史记录 output_path 中"})
            continue

        try:
            size = _dir_size(path) if os.path.exists(path) else 0
            shutil.rmtree(path, ignore_errors=False)
            removed += 1
            freed_bytes += size
            logger.info("Cleaned orphan temp dir: %s", path)
        except PermissionError:
            failed.append({"path": path, "reason": "文件被占用，请关闭相关程序后重试"})
        except OSError as e:
            failed.append({"path": path, "reason": f"删除失败: {e}"})

    return {"removed": removed, "freedBytes": freed_bytes, "failed": failed}
