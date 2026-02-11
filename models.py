"""数据模型"""
from dataclasses import dataclass, field
from typing import List, Optional


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
    """
    id: str = ""
    title: str = ""
    author: Optional[str] = None
    pages: int = 0
    category: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    publish_date: Optional[str] = None
    cover_url: Optional[str] = None
    preview_url: str = ""
    media_id: str = ""
    comic_source: str = ""

    @property
    def safe_title(self) -> str:
        """获取安全的标题（用于文件名）"""
        from utils import sanitize_filename
        return sanitize_filename(self.title)

    @property
    def safe_author(self) -> str:
        """获取安全的作者名（用于文件名）"""
        from utils import sanitize_filename
        return sanitize_filename(self.author or "unknown")

    def get_image_url(self, page: int) -> str:
        """获取指定页面的图片 URL

        Args:
            page: 页码 (1-based)

        Returns:
            图片 URL
        """
        source_map = {
            "MMCG_SHORT": "mms",
            "MMCG_LONG": "mml",
        }
        suffix = source_map.get(self.comic_source.upper(), "nh")
        return f"https://h-comic.link/api/{suffix}/{self.media_id}/pages/{page}"

    def get_all_image_urls(self) -> List[str]:
        """获取所有页面的图片 URL"""
        return [self.get_image_url(page) for page in range(1, self.pages + 1)]

    def __hash__(self) -> int:
        """使 ComicInfo 可哈希，用于存储在 set 中"""
        return hash((self.id, self.comic_source))

    def __eq__(self, other) -> bool:
        """比较两个 ComicInfo 是否相等"""
        if not isinstance(other, ComicInfo):
            return False
        return self.id == other.id and self.comic_source == other.comic_source


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
