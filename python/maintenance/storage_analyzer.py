"""存储空间分析器。"""

from __future__ import annotations

import logging
import os
from collections import defaultdict
from typing import TYPE_CHECKING

from maintenance.orphan_cleaner import _is_temp_dir
from maintenance.scanner import _dir_size, scan_download_dir

if TYPE_CHECKING:
    from download_history import DownloadHistoryDB

logger = logging.getLogger(__name__)

TOP_LIMIT = 20


def analyze_storage(download_dir: str, history_db: DownloadHistoryDB | None = None) -> dict:
    """分析下载目录存储空间。

    语义区分（避免误导用户删除实际需要的资产）：
    - ``orphanFiles``：仅 ``temp_*`` 目录（与「孤儿临时目录清理」面板定义一致，可安全清理）。
    - ``untrackedFiles``：非 ``temp_*`` 但不在 ``download_history.output_path`` 中的合法资产
      （folder / cbz / zip），仅作信息性提示，禁止当作可清理孤儿。

    Returns:
        {
            "totalSizeBytes": int,
            "totalFiles": int,
            "bySource": dict[str, int],
            "byFormat": {"folder": int, "cbz": int, "zip": int},
            "byAuthor": list[dict],
            "topItems": list[dict],
            "orphanFiles": {"count": int, "sizeBytes": int},
            "untrackedFiles": {"count": int, "sizeBytes": int},
        }
    """
    assets = scan_download_dir(download_dir, history_db=history_db)

    total_size = sum(a.size_bytes for a in assets)
    total_files = len(assets)

    by_source: dict[str, int] = defaultdict(int)
    by_format = {"folder": 0, "cbz": 0, "zip": 0}
    by_author: dict[str, dict] = defaultdict(lambda: {"sizeBytes": 0, "itemCount": 0})

    # 用于 untracked 判定（资产是否在历史记录中）
    history_paths: set[str] = set()
    if history_db is not None:
        try:
            for rec in history_db.get_all_records():
                out_path = rec.get("output_path", "")
                if out_path:
                    history_paths.add(out_path)
        except Exception as e:
            logger.warning("Failed to load history paths for storage analysis: %s", e)

    untracked_count = 0
    untracked_size = 0

    for asset in assets:
        source = asset.source_site or "unknown"
        by_source[source] += asset.size_bytes

        if asset.format in by_format:
            by_format[asset.format] += asset.size_bytes

        author = asset.author or "unknown"
        by_author[author]["sizeBytes"] += asset.size_bytes
        by_author[author]["itemCount"] += 1

        # 非 temp 资产但不在历史 → untracked（信息性，非可清理孤儿）
        if asset.path not in history_paths:
            untracked_count += 1
            untracked_size += asset.size_bytes

    # orphanFiles：单独扫描 temp_* 目录（scan_download_dir 会跳过 temp 目录，故需独立统计）
    orphan_count = 0
    orphan_size = 0
    try:
        for entry in os.listdir(download_dir):
            entry_path = os.path.join(download_dir, entry)
            if _is_temp_dir(entry_path):
                try:
                    orphan_size += _dir_size(entry_path)
                    orphan_count += 1
                except OSError as e:
                    logger.debug("Failed to stat temp dir %s: %s", entry_path, e)
    except OSError as e:
        logger.warning("Failed to list download dir for orphan scan: %s", e)

    by_author_list = sorted(
        [{"name": k, **v} for k, v in by_author.items()],
        key=lambda x: x["sizeBytes"],
        reverse=True,
    )[:TOP_LIMIT]

    top_items = sorted(
        [
            {
                "path": a.path,
                "title": a.title or None,
                "author": a.author or None,
                "sourceSite": a.source_site or None,
                "sizeBytes": a.size_bytes,
                "pageCount": a.page_count,
            }
            for a in assets
        ],
        key=lambda x: x["sizeBytes"],
        reverse=True,
    )[:TOP_LIMIT]

    return {
        "totalSizeBytes": total_size,
        "totalFiles": total_files,
        "bySource": dict(by_source),
        "byFormat": by_format,
        "byAuthor": by_author_list,
        "topItems": top_items,
        "orphanFiles": {"count": orphan_count, "sizeBytes": orphan_size},
        "untrackedFiles": {"count": untracked_count, "sizeBytes": untracked_size},
    }
