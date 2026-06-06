"""下载输出的 staging/commit/cleanup 文件系统操作。"""

from __future__ import annotations

import contextlib
import logging
import os
import shutil
import tempfile

from cbz_builder import CBZBuilder

logger = logging.getLogger(__name__)


class OutputStagingManager:
    """管理下载输出的 staging/commit/cleanup 文件系统操作。"""

    def __init__(
        self, output_dir: str, cbz_builder: CBZBuilder, output_format: str = "cbz"
    ):
        self.output_dir = output_dir
        self.cbz_builder = cbz_builder
        self.output_format = output_format

    @staticmethod
    def _rmtree_onerror(func, path, exc_info):
        logger.warning("Failed to remove %s during rmtree: %s", path, exc_info)

    @staticmethod
    def safe_rmtree(path: str, parent_dir: str) -> None:
        """验证路径在 parent_dir 内后再执行删除。"""
        try:
            real_path = os.path.realpath(path)
            real_parent = os.path.realpath(parent_dir)
        except (TypeError, ValueError, OSError):
            logger.warning("Refusing to rmtree unresolvable path: %s", path)
            return
        if real_path != real_parent and not real_path.startswith(real_parent + os.sep):
            logger.warning("Refusing to rmtree path outside output dir: %s", path)
            return

        shutil.rmtree(
            path, ignore_errors=False, onerror=OutputStagingManager._rmtree_onerror
        )

    def build(self, temp_dir: str, comic) -> tuple[str, str, str | None]:
        """Build the requested output into a staging path.

        Returns:
            (staged_path, final_path, staging_root)
        """
        final_path = self.cbz_builder.get_output_path_for_format(
            comic, self.output_format, self.output_dir
        )

        if self.output_format == "folder":
            staging_root = tempfile.mkdtemp(
                dir=self.output_dir, prefix=".hcomic_stage_"
            )
            try:
                staged_path = self.cbz_builder.save_as_folder(
                    temp_dir, comic, staging_root, overwrite=False
                )
                return staged_path, final_path, staging_root
            except Exception:
                self.safe_rmtree(staging_root, self.output_dir)
                raise

        output_dir = os.path.dirname(final_path)
        os.makedirs(output_dir, exist_ok=True)
        basename = os.path.basename(final_path)
        ext = ".zip" if self.output_format == "zip" else ".cbz"
        fd, staged_path = tempfile.mkstemp(
            dir=output_dir,
            prefix=f".{basename}.stage.",
            suffix=ext,
        )
        os.close(fd)
        os.unlink(staged_path)

        if self.output_format == "zip":
            self.cbz_builder.build_zip(temp_dir, comic, staged_path, overwrite=True)
        else:
            self.cbz_builder.build_cbz(temp_dir, comic, staged_path, overwrite=True)
        return staged_path, final_path, None

    def cleanup(self, staged_path: str | None, staging_root: str | None = None) -> None:
        """Remove a staged output without touching the final destination."""
        if staging_root and os.path.exists(staging_root):
            self.safe_rmtree(staging_root, self.output_dir)
            return
        if not staged_path or not os.path.exists(staged_path):
            return
        if os.path.isdir(staged_path):
            self.safe_rmtree(staged_path, self.output_dir)
        else:
            with contextlib.suppress(FileNotFoundError):
                os.remove(staged_path)

    def commit(
        self,
        staged_path: str,
        final_path: str,
        overwrite: bool = False,
    ) -> str:
        """Atomically commit staged output to the final destination when possible."""
        if os.path.exists(final_path) and not overwrite:
            raise FileExistsError(f"Output already exists: {final_path}")

        if not os.path.isdir(staged_path):
            os.replace(staged_path, final_path)
            return final_path

        output_dir = os.path.dirname(final_path)
        os.makedirs(output_dir, exist_ok=True)
        if not os.path.exists(final_path):
            shutil.move(staged_path, final_path)
            return final_path

        folder_name = os.path.basename(final_path)
        backup_path = tempfile.mkdtemp(dir=output_dir, prefix=f".{folder_name}.old.")
        os.rmdir(backup_path)
        shutil.move(final_path, backup_path)
        try:
            shutil.move(staged_path, final_path)
            self.safe_rmtree(backup_path, self.output_dir)
        except Exception:
            if os.path.exists(final_path):
                self.safe_rmtree(final_path, self.output_dir)
            if os.path.exists(backup_path):
                shutil.move(backup_path, final_path)
            raise
        return final_path
