"""手动验证：维护中心三件套在临时下载目录上的端到端检查。"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import zipfile
from io import BytesIO
from pathlib import Path

# 定位项目根目录
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)
sys.path.insert(0, os.path.join(_PROJECT_ROOT, "python"))

from maintenance.health_checker import HealthChecker  # noqa: E402
from maintenance.orphan_cleaner import cleanup_orphan_temp_dirs, scan_orphan_temp_dirs  # noqa: E402
from maintenance.storage_analyzer import analyze_storage  # noqa: E402
from PIL import Image  # noqa: E402


class FakeHistoryDB:
    """最小化的 DownloadHistoryDB 替代，用于本次手动验证。"""

    def __init__(self, records: list[dict]) -> None:
        self._records = records

    def get_all_records(self) -> list[dict]:
        return list(self._records)

    def get_all_records_with_album(self) -> list[dict]:
        return list(self._records)


def make_image(path: Path) -> None:
    """生成一张有效但极小的 PNG 图片。"""
    img = Image.new("RGB", (10, 10), color=(128, 64, 32))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="hcomic_maintenance_verify_") as tmp:
        download_dir = Path(tmp)
        records: list[dict] = []

        # 1. 健康正常的 folder 记录
        good_folder = download_dir / "[Author] Good Title [1]"
        make_image(good_folder / "01.png")
        records.append(
            {
                "source_site": "hcomic",
                "comic_id": "1",
                "comic_source": "NH",
                "title": "Good Title",
                "author": "Author",
                "output_path": str(good_folder),
                "output_format": "folder",
                "pages": 1,
                "album_id": "",
                "album_total_chapters": 1,
            }
        )

        # 2. 页数缺失的 folder 记录
        incomplete_folder = download_dir / "[Author] Incomplete Title [2]"
        make_image(incomplete_folder / "01.png")
        records.append(
            {
                "source_site": "hcomic",
                "comic_id": "2",
                "comic_source": "NH",
                "title": "Incomplete Title",
                "author": "Author",
                "output_path": str(incomplete_folder),
                "output_format": "folder",
                "pages": 5,
                "album_id": "",
                "album_total_chapters": 1,
            }
        )

        # 3. 缺少 ComicInfo.xml 的 CBZ
        missing_info_cbz = download_dir / "missing_info.cbz"
        with zipfile.ZipFile(missing_info_cbz, "w") as zf:
            zf.writestr("01.png", b"")
            # 写入一张有效图片而非空文件，避免 file_not_readable 干扰本次目标检查项
        # 重新写入真实图片
        with zipfile.ZipFile(missing_info_cbz, "w") as zf:
            img = Image.new("RGB", (10, 10))
            buf = BytesIO()
            img.save(buf, "PNG")
            zf.writestr("01.png", buf.getvalue())
        records.append(
            {
                "source_site": "hcomic",
                "comic_id": "3",
                "comic_source": "NH",
                "title": "Missing ComicInfo",
                "author": "",
                "output_path": str(missing_info_cbz),
                "output_format": "cbz",
                "pages": 1,
                "album_id": "",
                "album_total_chapters": 1,
            }
        )

        # 4. 损坏的 zip 文件
        bad_zip = download_dir / "bad.zip"
        bad_zip.write_bytes(b"not a zip")
        records.append(
            {
                "source_site": "hcomic",
                "comic_id": "4",
                "comic_source": "NH",
                "title": "Bad Zip",
                "author": "",
                "output_path": str(bad_zip),
                "output_format": "zip",
                "pages": 1,
                "album_id": "",
                "album_total_chapters": 1,
            }
        )

        # 5. 孤儿临时目录（修改时间超过 24 小时）
        orphan_dir = download_dir / "temp_orphan_123"
        orphan_dir.mkdir()
        (orphan_dir / "junk.bin").write_bytes(b"x" * 1000)
        old_time = time.time() - 48 * 3600
        os.utime(orphan_dir, (old_time, old_time))

        # 6. 活跃临时目录（模拟不应被清理）
        active_dir = download_dir / "temp_active_456"
        active_dir.mkdir()
        (active_dir / "active.bin").write_bytes(b"y" * 1000)
        active_time = time.time() - 48 * 3600
        os.utime(active_dir, (active_time, active_time))
        active_temp_dirs = {str(active_dir)}

        history_db = FakeHistoryDB(records)

        print("=== 健康检查 ===")
        checker = HealthChecker(history_db, str(download_dir))
        health = checker.check_all()
        print(f"扫描 {health['scanned']} 条，发现 {len(health['issues'])} 项异常")
        kinds = set()
        for issue in health["issues"]:
            for c in issue["checks"]:
                kinds.add(c["kind"])
                print(f"  - {c['kind']}: {issue.get('title') or issue['outputPath']}")
        assert "incomplete_pages" in kinds, "期望发现 incomplete_pages"
        assert "missing_comic_info" in kinds, "期望发现 missing_comic_info"
        assert "invalid_archive" in kinds, "期望发现 invalid_archive"

        print("\n=== 孤儿临时目录扫描 ===")
        orphans = scan_orphan_temp_dirs(str(download_dir), history_db=history_db, active_temp_dirs=active_temp_dirs)
        orphan_paths = [o.path for o in orphans]
        print(f"发现 {len(orphans)} 个孤儿目录：")
        for o in orphans:
            print(f"  - {o.path} ({o.size_bytes} bytes)")
        assert str(orphan_dir) in orphan_paths, "期望发现 orphan_dir"
        assert str(active_dir) not in orphan_paths, "活跃目录不应被识别为孤儿"

        print("\n=== 清理孤儿临时目录 ===")
        cleanup_result = cleanup_orphan_temp_dirs(
            str(download_dir),
            orphans=orphans,
            history_db=history_db,
            active_temp_dirs=active_temp_dirs,
        )
        print(
            f"移除 {cleanup_result['removed']} 个，释放 {cleanup_result['freedBytes']} bytes，失败 {len(cleanup_result['failed'])} 个"
        )
        assert cleanup_result["removed"] == 1, "期望清理 1 个孤儿目录"
        assert not orphan_dir.exists(), "孤儿目录应已被删除"
        assert active_dir.exists(), "活跃目录应保留"

        print("\n=== 存储分析 ===")
        stats = analyze_storage(str(download_dir), history_db=history_db)
        print(f"总大小：{stats['totalSizeBytes']} bytes，文件数：{stats['totalFiles']}")
        print(f"按来源：{stats['bySource']}")
        print(f"按格式：{stats['byFormat']}")
        print(f"孤儿文件：{stats['orphanFiles']['count']} 个，{stats['orphanFiles']['sizeBytes']} bytes")
        assert stats["totalFiles"] == 4, "期望识别 4 个资产（3 个记录 + 1 个损坏 zip）"
        assert stats["byFormat"]["folder"] > 0, "期望 folder 格式有占用"
        assert stats["byFormat"]["cbz"] > 0, "期望 cbz 格式有占用"

        print("\n[OK] 手动验证全部通过")
        return 0


if __name__ == "__main__":
    sys.exit(main())
