"""数据模型"""

import time
from dataclasses import dataclass, field
from enum import Enum

from constants import IMAGE_API_BASE
from utils import sanitize_filename

# 图片 URL 后缀映射（基于 comic_source 类型）
_IMAGE_URL_SUFFIX_MAP = {
    "MMCG_SHORT": "mms",
    "MMCG_LONG": "mml",
}
_DEFAULT_IMAGE_URL_SUFFIX = "nh"


@dataclass
class ChapterInfo:
    """jmcomic 章节信息。

    Attributes:
        id: 章节(photo) id，用于请求 /photo/{id} 及反混淆
        name: 章节名，如 "第 1 話"
        index: 1-based 顺序
        pages: 页数（可选，懒填充）
    """

    id: str = ""
    name: str = ""
    index: int = 0
    pages: int = 0


@dataclass
class ComicInfo:
    """漫画信息数据类

    Attributes:
        id: 漫画 ID
        title: 标题
        author: 作者
        pages: 页数
        category: 分类
        tags: 标签列表
        publish_date: 发布日期 (YYYY-MM-DD)
        cover_url: 封面图 URL
        preview_url: 详情页 URL
        media_id: 媒体 ID (用于图片 URL)
        comic_source: 图源 (MMCG_SHORT, MMCG_LONG, NH)
        source_site: 来源站点标识 (hcomic/moeimg)
        image_urls: 直接可下载的图片链接列表（可选，优先于 media_id 规则）
    """

    id: str = ""
    title: str = ""
    author: str | None = None
    pages: int = 0
    category: str | None = None
    tags: list[str] = field(default_factory=list)
    publish_date: str | None = None
    cover_url: str | None = None
    preview_url: str = ""
    media_id: str = ""
    comic_source: str = ""
    source_site: str = "hcomic"
    scramble_id: str = ""
    image_urls: list[str] = field(default_factory=list)
    chapters: list[ChapterInfo] = field(default_factory=list)
    album_id: str = ""  # 多章节时为专辑 id；单本时等于 id
    album_total_chapters: int = 1  # 专辑总章数；单本/其他来源为 1

    @property
    def safe_title(self) -> str:
        """获取安全的标题（用于文件名）"""
        return sanitize_filename(self.title)

    @property
    def safe_author(self) -> str:
        """获取安全的作者名（用于文件名）"""
        return sanitize_filename(self.author or "unknown")

    @property
    def safe_id(self) -> str:
        """获取安全的 ID（用于文件名）"""
        return sanitize_filename(str(self.id))

    def get_image_url(self, page: int) -> str:
        """获取指定页面的图片 URL

        Args:
            page: 页码 (1-based)

        Returns:
            图片 URL
        """
        suffix = _IMAGE_URL_SUFFIX_MAP.get(
            self.comic_source.upper(), _DEFAULT_IMAGE_URL_SUFFIX
        )
        return f"{IMAGE_API_BASE}/{suffix}/{self.media_id}/pages/{page}"

    def get_all_image_urls(self) -> list[str]:
        """获取所有页面的图片 URL"""
        if self.image_urls:
            return list(self.image_urls)
        return [self.get_image_url(page) for page in range(1, self.pages + 1)]

    def __hash__(self) -> int:
        """使 ComicInfo 可哈希，用于存储在 set 中。

        Warning: hash 基于 (source_site, id, comic_source)。将 ComicInfo
        加入 set 后修改这三个字段中的任何一个，会导致 set 查找失败。
        """
        return hash((self.source_site, self.id, self.comic_source))

    def __eq__(self, other) -> bool:
        """比较两个 ComicInfo 是否相等。

        Warning: 与 __hash__ 保持一致，仅比较 (source_site, id, comic_source)。
        """
        if not isinstance(other, ComicInfo):
            return False
        return (
            self.source_site == other.source_site
            and self.id == other.id
            and self.comic_source == other.comic_source
        )


@dataclass
class PaginationInfo:
    """分页信息数据类

    Attributes:
        current_page: 当前页码 (1-based)
        total_pages: 总页数
        limit: 每页限制
        total_items: 总结果数
    """

    current_page: int = 1
    total_pages: int = 1
    limit: int = 10
    total_items: int = 0

    @property
    def has_previous(self) -> bool:
        """是否有上一页"""
        return self.current_page > 1

    @property
    def has_next(self) -> bool:
        """是否有下一页"""
        return self.current_page < self.total_pages


class DownloadCancelledError(Exception):
    """下载被用户取消。

    Attributes:
        temp_dir: 下载时使用的临时目录，用于取消后清理
    """

    def __init__(
        self, message: str = "Download cancelled", temp_dir: str | None = None
    ):
        super().__init__(message)
        self.temp_dir = temp_dir


class DownloadStatus(Enum):
    """下载任务状态"""

    QUEUED = "queued"  # 等待中
    DOWNLOADING = "downloading"  # 下载中
    PAUSING = "pausing"  # 暂停中（已请求暂停，等待当前批次完成）
    PAUSED = "paused"  # 已暂停
    COMPLETED = "completed"  # 已完成
    FAILED = "failed"  # 失败
    CANCELLED = "cancelled"  # 已取消


@dataclass
class DownloadTask:
    """单个漫画的下载任务

    Attributes:
        comic: 漫画信息
        status: 当前状态
        progress_current: 当前已下载页数
        progress_total: 总页数
        temp_dir: 临时目录路径
        error_message: 错误信息
        created_at: 创建时间戳
        started_at: 开始下载时间戳
        _pause_requested: 暂停请求标志（内部使用）
        _cancel_requested: 取消请求标志（内部使用）
    """

    comic: ComicInfo
    status: DownloadStatus
    progress_current: int = 0
    progress_total: int = 0
    temp_dir: str | None = None
    error_message: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    _pause_requested: bool = False
    _cancel_requested: bool = False
    failed_pages: list[int] = field(default_factory=list)
    completed_pages: list[int] = field(default_factory=list)
    download_speed: float = 0.0
    current_downloading_page: int = 0
    retry_count: int = 0
    last_failed_at: float | None = None
    overwrite: bool = False

    @property
    def task_id(self) -> str:
        """生成唯一任务 ID"""
        return f"{self.comic.source_site}_{self.comic.comic_source}_{self.comic.id}"

    @property
    def progress_percentage(self) -> float:
        """获取进度百分比"""
        if self.progress_total == 0:
            return 0.0
        return float(round((self.progress_current / self.progress_total) * 100))

    @property
    def is_cancel_requested(self) -> bool:
        return self._cancel_requested

    @property
    def is_pause_requested(self) -> bool:
        return self._pause_requested

    def request_cancel(self) -> None:
        self._cancel_requested = True

    def request_pause(self) -> None:
        self._pause_requested = True

    def clear_pause_request(self) -> None:
        self._pause_requested = False


@dataclass
class AuthConfig:
    """认证配置，封装 cookie 和 user_agent。"""

    cookie: str = ""
    user_agent: str = ""


@dataclass
class ArchiveBuildOptions:
    """压缩包构建选项，封装 build_archive 的所有参数。"""

    image_dir: str
    comic: "ComicInfo"
    output_path: str
    download_dir: str | None = None
    overwrite: bool = False
    include_comic_info_xml: bool = True
    log_label: str = "Archive"
