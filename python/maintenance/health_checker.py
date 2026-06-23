"""健康检查器 — 验证已下载漫画的完整性。"""

from __future__ import annotations

import logging
import os
import zipfile
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from io import BytesIO
from typing import TYPE_CHECKING

from PIL import Image

from image_formats import SUPPORTED_IMAGE_EXTENSIONS
from maintenance.scanner import _collect_image_files, _count_folder_pages, _parse_cbz_comic_info

if TYPE_CHECKING:
    from download_history import DownloadHistoryDB

logger = logging.getLogger(__name__)

HealthCheckKind = str

# 默认仅校验图片头部（verify），成本约为全解码的 1/50；
# 设 HCOMIC_HEALTH_FULL_DECODE=1 时退回逐像素 load()，用于可疑资产的深度校验。
_FULL_DECODE = os.environ.get("HCOMIC_HEALTH_FULL_DECODE") == "1"


@dataclass
class HealthCheckResult:
    """单条漫画的健康检查结果。"""

    key: tuple[str, str, str]
    title: str
    output_path: str
    output_format: str
    expected_pages: int
    actual_pages: int
    checks: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "key": list(self.key),
            "title": self.title,
            "outputPath": self.output_path,
            "outputFormat": self.output_format,
            "expectedPages": self.expected_pages,
            "actualPages": self.actual_pages,
            "checks": self.checks,
        }


class HealthChecker:
    """对 download_history 记录进行只读完整性检查。"""

    def __init__(
        self,
        history_db: DownloadHistoryDB,
        download_dir: str,
        progress_callback: Callable[[int, int, str], None] | None = None,
    ):
        self.history_db = history_db
        self.download_dir = download_dir
        self.progress_callback = progress_callback

    def check_all(
        self,
        scope: str = "all",
        comic_keys: list[tuple[str, str, str]] | None = None,
    ) -> dict:
        """执行健康检查。

        Args:
            scope: 'all' 或 'selected'。
            comic_keys: scope='selected' 时检查的 key 列表。

        Returns:
            {"scanned": int, "issues": list[dict]}
        """
        records = self.history_db.get_all_records_with_album()

        if scope == "selected" and comic_keys:
            key_set = set(comic_keys)
            records = [
                r
                for r in records
                if (r.get("source_site", ""), r.get("comic_id", ""), r.get("comic_source", "")) in key_set
            ]

        # 按专辑聚合期望页数
        album_expected_pages = self._aggregate_album_expected_pages(records)

        issues: list[dict] = []
        total = len(records)

        for idx, record in enumerate(records, 1):
            key = (
                record.get("source_site", ""),
                record.get("comic_id", ""),
                record.get("comic_source", ""),
            )
            title = record.get("title", "")
            output_path = record.get("output_path", "")
            output_format = record.get("output_format", "")

            if self.progress_callback:
                self.progress_callback(idx, total, f"正在检查: {title or os.path.basename(output_path)}")

            try:
                result = self._check_record(record, album_expected_pages)
            except Exception as e:
                logger.warning("Health check failed for %s: %s", key, e)
                result = HealthCheckResult(
                    key=key,
                    title=title,
                    output_path=output_path,
                    output_format=output_format,
                    expected_pages=0,
                    actual_pages=0,
                    checks=[{"kind": "check_error", "detail": f"检查异常: {e}"}],
                )

            if result.checks:
                issues.append(result.to_dict())

        if self.progress_callback:
            self.progress_callback(total, total, "检查完成")

        return {"scanned": total, "issues": issues}

    def _aggregate_album_expected_pages(self, records: list[dict]) -> dict[tuple[str, str, str], int]:
        """按 (source_site, album_id, comic_source) 聚合期望页数。"""
        agg: dict[tuple[str, str, str], int] = defaultdict(int)
        for rec in records:
            album_id = rec.get("album_id", "") or rec.get("comic_id", "")
            if not album_id:
                continue
            key = (
                rec.get("source_site", ""),
                album_id,
                rec.get("comic_source", ""),
            )
            pages = rec.get("pages", 0) or 0
            if isinstance(pages, str):
                try:
                    pages = int(pages)
                except ValueError:
                    pages = 0
            agg[key] += pages
        return agg

    def _check_record(
        self,
        record: dict,
        album_expected_pages: dict[tuple[str, str, str], int],
    ) -> HealthCheckResult:
        """检查单条记录。"""
        key = (
            record.get("source_site", ""),
            record.get("comic_id", ""),
            record.get("comic_source", ""),
        )
        title = record.get("title", "")
        output_path = record.get("output_path", "")
        output_format = record.get("output_format", "")

        checks: list[dict] = []

        # 健康检查是只读操作，不对 output_path 做下载目录越界拒绝。
        # 历史记录可能指向迁移前的旧目录（用户改过下载目录），属正常场景；
        # 路径不存在时由下面的 os.path.exists 兜底报 missing_file。
        # 注：路径遍历/越界防护是删除路径（orphan_cleaner）的安全网，不适用于只读检查。
        if not output_path or not os.path.exists(output_path):
            checks.append({"kind": "missing_file", "detail": f"输出路径不存在: {output_path}"})
            return HealthCheckResult(
                key=key,
                title=title,
                output_path=output_path,
                output_format=output_format,
                expected_pages=0,
                actual_pages=0,
                checks=checks,
            )

        expected_pages = self._resolve_expected_pages(record, album_expected_pages)
        actual_pages = 0

        if output_format == "folder":
            actual_pages, folder_checks = self._check_folder(output_path)
            checks.extend(folder_checks)
        elif output_format in ("cbz", "zip"):
            actual_pages, archive_checks = self._check_archive(output_path, output_format)
            checks.extend(archive_checks)
        else:
            actual_pages, fallback_checks = self._check_unknown_format(output_path)
            checks.extend(fallback_checks)

        if expected_pages > 0:
            if actual_pages < expected_pages:
                checks.append(
                    {
                        "kind": "incomplete_pages",
                        "detail": f"期望 {expected_pages} 页，实际 {actual_pages} 页",
                    }
                )
            elif actual_pages > expected_pages:
                checks.append(
                    {
                        "kind": "unexpected_pages",
                        "detail": f"期望 {expected_pages} 页，实际 {actual_pages} 页",
                    }
                )

        return HealthCheckResult(
            key=key,
            title=title,
            output_path=output_path,
            output_format=output_format,
            expected_pages=expected_pages,
            actual_pages=actual_pages,
            checks=checks,
        )

    def _resolve_expected_pages(
        self,
        record: dict,
        album_expected_pages: dict[tuple[str, str, str], int],
    ) -> int:
        """解析单条记录的期望页数。

        优先级：专辑聚合页数 > 单本 pages 列 > ComicInfo.xml PageCount 回退。
        全部为 0 时返回 0（健康检查跳过该条页数对账，不误报）。
        """
        album_id = record.get("album_id", "") or record.get("comic_id", "")
        album_total = record.get("album_total_chapters", 1) or 1

        # 专辑：聚合所有章节页数
        if album_total > 1 and album_id:
            album_key = (
                record.get("source_site", ""),
                album_id,
                record.get("comic_source", ""),
            )
            aggregated = album_expected_pages.get(album_key, 0)
            if aggregated > 0:
                return aggregated

        # 单本：使用记录中的 pages 列
        pages = record.get("pages", 0) or 0
        if isinstance(pages, str):
            try:
                pages = int(pages)
            except ValueError:
                pages = 0
        if pages > 0:
            return pages

        # 回退：CBZ 的 ComicInfo.xml PageCount（folder 格式无 ComicInfo.xml，跳过）
        output_format = record.get("output_format", "")
        output_path = record.get("output_path", "")
        if output_format == "cbz" and output_path:
            comic_info = _parse_cbz_comic_info(output_path)
            page_count_str = comic_info.get("PageCount", "")
            if page_count_str and page_count_str.isdigit():
                return int(page_count_str)

        return 0

    def _check_folder(self, path: str) -> tuple[int, list[dict]]:
        """检查 folder 格式，返回 (实际页数, 问题列表)。

        页数计数复用 scanner._count_folder_pages（单一真相源，避免与扫描器分叉）；
        本方法仅负责逐页可读性校验。
        """
        checks: list[dict] = []
        if not os.path.isdir(path):
            checks.append({"kind": "missing_file", "detail": f"目录不存在: {path}"})
            return 0, checks

        # 收集所有需校验的图片路径（与 _count_folder_pages 的计数口径保持一致）
        image_files: list[str] = []
        has_chapter_dirs = False
        for entry in sorted(os.listdir(path)):
            entry_path = os.path.join(path, entry)
            if os.path.isdir(entry_path) and not entry.startswith("temp_") and not entry.startswith("."):
                has_chapter_dirs = True
                image_files.extend(_collect_image_files(entry_path))
        if not has_chapter_dirs:
            image_files = _collect_image_files(path)

        total_pages = len(image_files)
        for page_num, img_path in enumerate(image_files, 1):
            if not self._is_image_readable(img_path):
                checks.append(
                    {
                        "kind": "file_not_readable",
                        "detail": f"第 {page_num} 页图片无法打开: {img_path}",
                        "page": page_num,
                    }
                )

        # 与 scanner 的计数对账（防御性：若两者分叉说明启发式漂移，应被发现）
        scanner_count = _count_folder_pages(path)
        if scanner_count != total_pages:
            logger.warning(
                "folder page count mismatch: health_checker=%d scanner=%d path=%s",
                total_pages,
                scanner_count,
                path,
            )

        return total_pages, checks

    def _check_archive(self, path: str, fmt: str) -> tuple[int, list[dict]]:
        """检查 cbz/zip 格式，返回 (实际页数, 问题列表)。"""
        checks: list[dict] = []
        try:
            with zipfile.ZipFile(path, "r") as zf:
                bad_file = zf.testzip()
                if bad_file:
                    checks.append({"kind": "invalid_archive", "detail": f"压缩包损坏: {bad_file}"})

                if fmt == "cbz" and "ComicInfo.xml" not in zf.namelist():
                    checks.append({"kind": "missing_comic_info", "detail": "缺少 ComicInfo.xml 元数据文件"})

                image_names = [
                    name for name in zf.namelist() if os.path.splitext(name)[1].lower() in SUPPORTED_IMAGE_EXTENSIONS
                ]
                image_names.sort()

                for page_num, name in enumerate(image_names, 1):
                    try:
                        data = zf.read(name)
                        if not self._is_image_data_readable(data):
                            checks.append(
                                {
                                    "kind": "file_not_readable",
                                    "detail": f"第 {page_num} 页图片无法打开: {name}",
                                    "page": page_num,
                                }
                            )
                    except Exception as e:
                        checks.append(
                            {
                                "kind": "file_not_readable",
                                "detail": f"第 {page_num} 页读取失败: {name} ({e})",
                                "page": page_num,
                            }
                        )

                return len(image_names), checks
        except zipfile.BadZipFile as e:
            checks.append({"kind": "invalid_archive", "detail": f"压缩包损坏: {e}"})
            return 0, checks
        except Exception as e:
            checks.append({"kind": "invalid_archive", "detail": f"无法打开压缩包: {e}"})
            return 0, checks

    def _check_unknown_format(self, path: str) -> tuple[int, list[dict]]:
        """对未知格式做最佳努力检查。"""
        checks: list[dict] = []
        if os.path.isdir(path):
            return self._check_folder(path)
        checks.append({"kind": "invalid_archive", "detail": f"未知输出格式，无法检查: {path}"})
        return 0, checks

    @staticmethod
    def _is_image_readable(path: str) -> bool:
        """判断本地图片文件能否被 PIL 打开。

        默认仅校验头部（verify）；_FULL_DECODE 为真时解码全部像素（load）。
        """
        try:
            with Image.open(path) as img:
                if _FULL_DECODE:
                    img.load()
                else:
                    img.verify()
            return True
        except Exception:
            return False

    @staticmethod
    def _is_image_data_readable(data: bytes) -> bool:
        """判断内存中的图片数据能否被 PIL 打开。

        默认仅校验头部（verify）；_FULL_DECODE 为真时解码全部像素（load）。
        """
        try:
            with Image.open(BytesIO(data)) as img:  # type: ignore[name-defined]
                if _FULL_DECODE:
                    img.load()
                else:
                    img.verify()
            return True
        except Exception:
            return False
