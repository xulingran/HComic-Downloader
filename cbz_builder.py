"""CBZ 打包和元数据生成模块"""

import logging
import os
import re
import shutil
import tempfile
import zipfile
from typing import TYPE_CHECKING, Optional
from xml.dom import minidom
from xml.etree.ElementTree import Element, SubElement, tostring

from image_formats import PAGE_FILENAME_FORMAT, SUPPORTED_IMAGE_EXTENSIONS
from models import ArchiveBuildOptions, ComicInfo
from utils import sanitize_path_chars

if TYPE_CHECKING:
    from config import Config

logger = logging.getLogger(__name__)


ALLOWED_FILENAME_PLACEHOLDERS = {"author", "title", "id"}

# XML 1.0 不允许的字符：控制字符 (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F) + 代理对 (0xD800-0xDFFF)
_XML_INVALID_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f\ud800-\udfff]")


class CBZBuilder:
    """CBZ 文件构建器"""

    def __init__(
        self,
        filename_template: str = "{author}-{title}.cbz",
        config: Optional["Config"] = None,
    ):
        self.validate_filename_template(filename_template)
        self._filename_template = filename_template
        self._config = config

    @property
    def filename_template(self) -> str:
        return self._filename_template

    @filename_template.setter
    def filename_template(self, value: str) -> None:
        self.validate_filename_template(value)
        self._filename_template = value

    @staticmethod
    def validate_filename_template(template: str) -> None:
        """Validate filename template against allowed placeholders.

        Raises ValueError if the template is invalid.
        """
        if not isinstance(template, str) or len(template) == 0 or len(template) > 256:
            raise ValueError("Filename template must be a non-empty string ≤ 256 characters")
        if "/" in template or "\\" in template or ".." in template:
            raise ValueError("Filename template must not contain path separators")

        # Validate brace syntax: handle {{ and }} escapes
        depth = 0
        i = 0
        while i < len(template):
            ch = template[i]
            if ch == "{":
                if i + 1 < len(template) and template[i + 1] == "{":
                    i += 2
                    continue
                depth += 1
            elif ch == "}":
                if i + 1 < len(template) and template[i + 1] == "}":
                    i += 2
                    continue
                depth -= 1
                if depth < 0:
                    raise ValueError("Filename template has unbalanced braces")
            i += 1
        if depth != 0:
            raise ValueError("Filename template has unbalanced braces")

        # Reject bare {} positional placeholder
        if "{}" in template:
            raise ValueError("Filename template must not contain positional placeholders")

        # Only allow whitelisted placeholders
        parts = re.findall(r"\{[^{}]+\}", template)
        for part in parts:
            name = part[1:-1]  # strip { and }, keep original case
            if name not in ALLOWED_FILENAME_PLACEHOLDERS:
                raise ValueError(
                    f"Unknown placeholder {{{name}}} in filename template. "
                    f"Allowed: {{{', '.join(sorted(ALLOWED_FILENAME_PLACEHOLDERS))}}}"
                )

    def _get_download_dir(self, download_dir: str | None = None) -> str:
        """获取下载目录，优先使用传入值，否则回退到配置。"""
        if download_dir is not None:
            return download_dir
        if self._config:
            return self._config.download_dir
        from config import Config

        return Config.load().download_dir

    @staticmethod
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

    def build_archive(self, options: ArchiveBuildOptions) -> str:
        """创建压缩包的公共逻辑（CBZ / ZIP 共用）。

        Args:
            options: 构建选项

        Returns:
            压缩包路径
        """
        if options.download_dir is not None:
            self._validate_path_in_dir(options.output_path, options.download_dir)

        if not options.overwrite and os.path.exists(options.output_path):
            raise FileExistsError(f"Output already exists: {options.output_path}")

        output_dir_path = os.path.dirname(options.output_path)
        if output_dir_path:
            os.makedirs(output_dir_path, exist_ok=True)

        image_files = self._collect_image_files(options.image_dir)
        if not image_files:
            raise ValueError(f"No images found in {options.image_dir}")

        logger.info("Building %s: %s", options.log_label, options.output_path)

        basename = os.path.basename(options.output_path)
        fd, tmp_path = tempfile.mkstemp(dir=output_dir_path, prefix=f".{basename}.", suffix=".tmp")
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
                if options.include_comic_info_xml:
                    comic_info_xml = self.generate_comic_info_xml(options.comic)
                    zf.writestr("ComicInfo.xml", comic_info_xml)

                for i, img_path in enumerate(image_files, 1):
                    arcname = PAGE_FILENAME_FORMAT.format(page=i, ext=os.path.splitext(img_path)[1])
                    zf.write(img_path, arcname)
                    logger.debug("Added: %s", arcname)

            os.replace(tmp_path, options.output_path)
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

        logger.info("%s created: %s", options.log_label, options.output_path)
        return options.output_path

    def _build_archive_internal(
        self,
        image_dir: str,
        comic: ComicInfo,
        output_path: str | None = None,
        download_dir: str | None = None,
        overwrite: bool = False,
        include_comic_info_xml: bool = True,
    ) -> str:
        if output_path is None:
            output_path = self._generate_output_path(comic)
        options = ArchiveBuildOptions(
            image_dir=image_dir,
            comic=comic,
            output_path=output_path,
            download_dir=self._get_download_dir(download_dir),
            overwrite=overwrite,
            include_comic_info_xml=include_comic_info_xml,
            log_label="CBZ" if include_comic_info_xml else "ZIP",
        )
        return self.build_archive(options)

    def build_cbz(
        self,
        image_dir: str,
        comic: ComicInfo,
        output_path: str | None = None,
        download_dir: str | None = None,
        overwrite: bool = False,
    ) -> str:
        """创建 CBZ 文件

        Args:
            image_dir: 图片目录
            comic: 漫画信息
            output_path: 输出路径（可选，默认使用模板生成）
            download_dir: 下载目录，用于校验路径（可选，默认使用配置中的目录）
            overwrite: 是否覆盖已有文件

        Returns:
            CBZ 文件路径
        """
        return self._build_archive_internal(
            image_dir=image_dir,
            comic=comic,
            output_path=output_path,
            download_dir=download_dir,
            overwrite=overwrite,
            include_comic_info_xml=True,
        )

    def generate_comic_info_xml(self, comic: ComicInfo) -> str:
        """生成 ComicInfo.xml

        Args:
            comic: 漫画信息

        Returns:
            XML 字符串
        """
        root = Element("ComicInfo")
        root.set("xmlns:xsd", "http://www.w3.org/2001/XMLSchema")
        root.set("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance")

        # 标题
        if comic.title:
            self._add_element(root, "Title", comic.title)
            self._add_element(root, "Series", comic.title)

        # 作者 -> Writer
        if comic.author:
            self._add_element(root, "Writer", comic.author)

        # 分类 -> Genre
        if comic.category:
            self._add_element(root, "Genre", comic.category)

        # 标签
        if comic.tags:
            tags_str = ", ".join(str(tag) for tag in comic.tags if tag)
            self._add_element(root, "Tags", tags_str)

        # 页数
        if comic.pages > 0:
            self._add_element(root, "PageCount", str(comic.pages))

        # 发布日期
        if comic.publish_date:
            year, month, day = self._parse_date(comic.publish_date)
            if year:
                self._add_element(root, "Year", year)
            if month:
                self._add_element(root, "Month", month)
            if day:
                self._add_element(root, "Day", day)

        # 预览 URL
        if comic.preview_url:
            self._add_element(root, "Web", comic.preview_url)

        # 页码（固定为1）
        self._add_element(root, "Number", "1")

        # 格式化 XML
        xml_bytes = tostring(root, encoding="utf-8")
        dom = minidom.parseString(xml_bytes)
        pretty_xml = dom.toprettyxml(indent="    ")

        # 移除多余的空行
        lines = [line for line in pretty_xml.split("\n") if line.strip()]
        return "\n".join(lines) + "\n"

    @staticmethod
    def _sanitize_xml_text(text: str) -> str:
        """移除 XML 1.0 不允许的字符（控制字符和非法代理对）"""
        return _XML_INVALID_CHARS_RE.sub("", text)

    def _add_element(self, parent: Element, tag: str, text: str):
        """添加子元素"""
        elem = SubElement(parent, tag)
        elem.text = self._sanitize_xml_text(text)

    def _parse_date(self, date_str: str) -> tuple[str, str, str]:
        """解析日期字符串

        Args:
            date_str: YYYY-MM-DD 格式的日期

        Returns:
            (year, month, day) 元组
        """
        try:
            parts = date_str.split("-")
            if len(parts) >= 3:
                return parts[0], parts[1], parts[2]
            elif len(parts) == 2:
                return parts[0], parts[1], ""
            elif len(parts) == 1:
                return parts[0], "", ""
        except (ValueError, TypeError, AttributeError):
            pass
        return "", "", ""

    def _generate_output_path(self, comic: ComicInfo, download_dir: str | None = None) -> str:
        """生成输出路径

        Args:
            comic: 漫画信息
            download_dir: 下载目录（可选，默认使用配置中的目录）

        Returns:
            输出文件路径
        """
        filename = self.filename_template.format(
            author=comic.safe_author,
            title=comic.safe_title,
            id=comic.safe_id,
        )
        # 确保以 .cbz 结尾
        if not filename.endswith(".cbz"):
            filename += ".cbz"

        download_dir = self._get_download_dir(download_dir)
        return os.path.join(download_dir, filename)

    def get_output_path(self, comic: ComicInfo, download_dir: str | None = None) -> str:
        """获取漫画的输出路径（不创建文件）

        Args:
            comic: 漫画信息
            download_dir: 下载目录（可选，默认使用配置中的目录）

        Returns:
            输出文件路径
        """
        return self._generate_output_path(comic, download_dir)

    def _collect_image_files(self, image_dir: str) -> list[str]:
        """收集目录中的图片文件

        Args:
            image_dir: 图片目录

        Returns:
            排序后的图片路径列表
        """
        image_files = []

        for filename in os.listdir(image_dir):
            ext = os.path.splitext(filename)[1].lower()
            if ext in SUPPORTED_IMAGE_EXTENSIONS:
                image_files.append(os.path.join(image_dir, filename))

        # 按文件名排序
        image_files.sort()
        return image_files

    def build_zip(
        self,
        image_dir: str,
        comic: ComicInfo,
        output_path: str | None = None,
        download_dir: str | None = None,
        overwrite: bool = False,
    ) -> str:
        """创建 ZIP 文件（不含 ComicInfo.xml）

        Args:
            image_dir: 图片目录
            comic: 漫画信息
            output_path: 输出路径（可选，默认使用模板生成）
            download_dir: 下载目录，用于校验路径（可选，默认使用配置中的目录）
            overwrite: 是否覆盖已有文件

        Returns:
            ZIP 文件路径
        """
        if output_path is None:
            output_path = self._generate_output_path_for_format(comic, "zip")
        return self._build_archive_internal(
            image_dir=image_dir,
            comic=comic,
            output_path=output_path,
            download_dir=download_dir,
            overwrite=overwrite,
            include_comic_info_xml=False,
        )

    def save_as_folder(
        self,
        image_dir: str,
        comic: ComicInfo,
        output_dir: str | None = None,
        overwrite: bool = False,
    ) -> str:
        """保存为普通文件夹（移动并重命名临时目录）

        Args:
            image_dir: 图片临时目录
            comic: 漫画信息
            output_dir: 输出目录（可选，默认使用配置中的目录）
            overwrite: 是否覆盖已有目录

        Returns:
            文件夹路径
        """
        # 确定输出路径
        folder_name = self._generate_folder_name(comic)

        output_dir = self._get_download_dir(output_dir)
        output_path = os.path.join(output_dir, folder_name)
        self._validate_path_in_dir(output_path, output_dir)

        # 确保输出目录存在
        os.makedirs(output_dir, exist_ok=True)

        if os.path.exists(output_path):
            if not overwrite:
                raise FileExistsError(f"Output folder already exists: {output_path}")
            # 用唯一临时目录名做备份，避免误删已有的同名 .tmp_old
            backup_path = tempfile.mkdtemp(dir=output_dir, prefix=f".{folder_name}.old.")
            # mkdtemp 会创建目录，但我们需要 move 到它上面，所以先删掉空目录
            os.rmdir(backup_path)
            logger.info("Target folder exists, backing up: %s -> %s", output_path, backup_path)
            shutil.move(output_path, backup_path)
            try:
                logger.info("Moving folder: %s -> %s", image_dir, output_path)
                shutil.move(image_dir, output_path)
                shutil.rmtree(backup_path)
            except Exception:
                # 恢复备份
                if os.path.exists(output_path):
                    shutil.rmtree(output_path, ignore_errors=True)
                if os.path.exists(backup_path):
                    shutil.move(backup_path, output_path)
                raise
        else:
            # 移动临时目录到目标位置
            logger.info("Moving folder: %s -> %s", image_dir, output_path)
            shutil.move(image_dir, output_path)

        logger.info("Folder saved: %s", output_path)
        return output_path

    def _generate_output_path_for_format(
        self,
        comic: ComicInfo,
        format_type: str,
        download_dir: str | None = None,
    ) -> str:
        """根据格式生成输出路径

        Args:
            comic: 漫画信息
            format_type: 格式类型 ("cbz" | "zip")
            download_dir: 下载目录（可选）

        Returns:
            输出文件路径
        """
        ext = ".cbz" if format_type == "cbz" else ".zip"
        filename = self._generate_folder_name(comic) + ext

        download_dir = self._get_download_dir(download_dir)
        return os.path.join(download_dir, filename)

    def _generate_folder_name(self, comic: ComicInfo) -> str:
        """生成文件夹名称"""
        # 使用文件名模板生成文件夹名（去掉扩展名）
        folder_name = self.filename_template.format(
            author=comic.safe_author,
            title=comic.safe_title,
            id=comic.safe_id,
        )
        # 去掉 .cbz / .zip 扩展名
        base, ext = os.path.splitext(folder_name)
        if ext.lower() in (".cbz", ".zip"):
            folder_name = base
        # 清理非法字符
        folder_name = sanitize_path_chars(folder_name)
        folder_name = folder_name.strip(". ")
        if not folder_name:
            folder_name = f"comic_{comic.safe_id}"
        return folder_name

    def get_output_path_for_format(
        self,
        comic: ComicInfo,
        output_format: str,
        download_dir: str | None = None,
    ) -> str:
        """获取漫画的输出路径（不创建文件/文件夹）

        Args:
            comic: 漫画信息
            output_format: 输出格式 ("folder" | "zip" | "cbz")
            download_dir: 下载目录（可选，默认使用配置中的目录）

        Returns:
            输出路径
        """
        if output_format == "folder":
            # 优先使用传入的目录，否则使用配置中的目录
            if download_dir is None:
                if self._config:
                    download_dir = self._config.download_dir
                else:
                    from config import Config

                    download_dir = Config.load().download_dir
            folder_name = self._generate_folder_name(comic)
            output_path = os.path.join(download_dir, folder_name)
        elif output_format == "zip":
            output_path = self._generate_output_path_for_format(comic, "zip", download_dir)
        else:  # cbz
            output_path = self._generate_output_path(comic, download_dir)
        # 校验路径在下载目录内
        actual_download_dir = self._get_download_dir(download_dir)
        self._validate_path_in_dir(output_path, actual_download_dir)
        return output_path


def build_cbz_simple(
    image_dir: str,
    output_path: str,
    comic_info: ComicInfo | None = None,
    overwrite: bool = False,
) -> str:
    """简单方式创建 CBZ

    Args:
        image_dir: 图片目录
        output_path: 输出路径
        comic_info: 漫画信息（可选，为 None 时不写入 ComicInfo.xml）
        overwrite: 是否覆盖已有文件

    Returns:
        CBZ 文件路径
    """
    if not overwrite and os.path.exists(output_path):
        raise FileExistsError(f"Output already exists: {output_path}")

    builder = CBZBuilder()
    comic = comic_info if comic_info else ComicInfo(id="", source_site="", title="")
    options = ArchiveBuildOptions(
        image_dir=image_dir,
        comic=comic,
        output_path=output_path,
        download_dir=None,
        overwrite=overwrite,
        include_comic_info_xml=comic_info is not None,
        log_label="CBZ",
    )
    return builder.build_archive(options)
