"""漫画来源子系统。"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from models import AuthConfig, ComicInfo, PaginationInfo
from sources.bika.parser import BikaParser
from sources.copymanga.parser import CopyMangaParser
from sources.hcomic.parser import HComicParser, ParserResponseError
from sources.jmcomic.parser import JmParser
from sources.moeimg.parser import MoeImgParser
from utils import normalize_source_auth

logger = logging.getLogger(__name__)

_VALID_SOURCES = ("hcomic", "jmcomic", "moeimg", "bika", "copymanga")
_SOURCES_WITH_FAVOURITES = ("hcomic", "jmcomic", "moeimg", "bika")

__all__ = ["MultiSourceParser", "ParserResponseError"]


class _ParserDict:
    """字典代理：通过 __getitem__ 触发懒创建解析器。

    保持 ``parser.parsers["source"]`` 向后兼容。
    """

    def __init__(self, owner: MultiSourceParser):
        self._owner = owner

    def __getitem__(self, key: str) -> HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser:
        return self._owner._get_parser(key)  # type: ignore[return-value]

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self.__getitem__(key)
        except (KeyError, ValueError):
            return default

    def keys(self) -> set[str]:
        return set(self._owner._factory.keys())

    def __contains__(self, key: str) -> bool:
        return key in self._owner._factory

    def __iter__(self):
        return iter(self._owner._factory)

    def __len__(self) -> int:
        return len(self._owner._factory)


class MultiSourceParser:
    """多来源解析器分发层。

    解析器实例按需懒创建 —— 首次访问指定 source 时构造，避免启动时预创建全部 5 个解析器。
    """

    def __init__(
        self,
        timeout: int = 30,
        default_source: str = "hcomic",
        source_auth: dict[str, dict[str, str]] | None = None,
        auth: AuthConfig | None = None,
        bika_image_quality: str = "original",
    ):
        self.timeout = timeout
        self.source_auth: dict[str, dict[str, str]] = self._normalize_source_auth(source_auth)
        # 兼容旧调用：若传了全局 auth，作为 hcomic 默认认证。
        _cookie = auth.cookie if auth else ""
        _user_agent = auth.user_agent if auth else ""
        if _cookie or _user_agent:
            self.source_auth["hcomic"] = {
                "cookie": (_cookie or "").strip(),
                "user_agent": (_user_agent or "").strip(),
                "bearer_token": self.source_auth["hcomic"].get("bearer_token", ""),
            }

        self._bika_image_quality = bika_image_quality

        # 工厂函数映射：解析器首次访问时调用对应工厂创建实例
        self._factory: dict[
            str, Callable[[], HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser]
        ] = {
            "hcomic": lambda: HComicParser(
                timeout=timeout,
                cookie=self.source_auth["hcomic"]["cookie"],
                user_agent=self.source_auth["hcomic"]["user_agent"],
                bearer_token=self.source_auth["hcomic"]["bearer_token"],
            ),
            "moeimg": lambda: MoeImgParser(
                timeout=timeout,
                cookie=self.source_auth["moeimg"]["cookie"],
                user_agent=self.source_auth["moeimg"]["user_agent"],
            ),
            "jmcomic": lambda: JmParser(
                timeout=timeout,
                cookie=self.source_auth.get("jmcomic", {}).get("cookie", ""),
                user_agent=self.source_auth.get("jmcomic", {}).get("user_agent", ""),
            ),
            "bika": lambda: BikaParser(timeout=timeout),
            "copymanga": lambda: CopyMangaParser(timeout=timeout),
        }

        # 缓存字典 —— 已创建的解析器实例
        self._parsers: dict[str, HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser] = {}

        # 只创建 default_source 的解析器，其余等待首次访问时创建
        self.current_source = default_source if default_source in self._factory else "hcomic"
        self._get_parser(self.current_source)

    @property
    def parsers(self) -> _ParserDict:
        """向后兼容：``parser.parsers["source"]`` 触发懒创建。"""
        return _ParserDict(self)

    def _get_parser(self, name: str) -> HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser:
        """按需获取（或创建）指定来源的解析器实例。"""
        if name not in self._parsers:
            factory = self._factory.get(name)
            if factory is None:
                raise ValueError(f"Unknown source: {name}")
            parser = factory()
            self._parsers[name] = parser
            # 创建后执行凭据恢复等后处理
            self._apply_post_init(name, parser)
        return self._parsers[name]

    def _apply_post_init(
        self,
        name: str,
        parser: HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser,
    ) -> None:
        """解析器创建后的后处理 —— 恢复存储的凭据、token、图片质量等。"""
        # 通用：对所有解析器恢复已存储的 cookie/user_agent/bearer_token
        auth = self.source_auth.get(name, {})
        cookie = auth.get("cookie", "")
        user_agent = auth.get("user_agent", "")
        bearer_token = auth.get("bearer_token", "")
        if cookie or user_agent or bearer_token:
            parser.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)
        # 为 moeimg 恢复存储的用户名密码（用于懒登录）
        if name == "moeimg" and isinstance(parser, MoeImgParser):
            moeimg_auth = self.source_auth.get("moeimg", {})
            parser.set_stored_credentials(
                moeimg_auth.get("username", ""),
                moeimg_auth.get("password", ""),
            )
        # 为 bika 恢复存储的用户名密码和图片质量（configure_auth 已由通用逻辑执行）
        if name == "bika" and isinstance(parser, BikaParser):
            bika_auth = self.source_auth.get("bika", {})
            parser.set_stored_credentials(
                bika_auth.get("username", ""),
                bika_auth.get("password", ""),
            )
            parser.set_image_quality(self._bika_image_quality)
        # 为 hcomic 恢复存储的用户名密码（用于懒登录）
        if name == "hcomic" and isinstance(parser, HComicParser):
            hcomic_auth = self.source_auth.get("hcomic", {})
            parser.set_stored_credentials(
                hcomic_auth.get("username", ""),
                hcomic_auth.get("password", ""),
            )

    @staticmethod
    def _normalize_source_auth(source_auth: dict | None) -> dict[str, dict[str, str]]:
        return normalize_source_auth(source_auth)

    def _resolve_source(self, source: str | None = None) -> str:
        """Resolve effective source: explicit argument or current default."""
        return source or self.current_source

    @property
    def session(self) -> Any:
        return self._get_parser(self.current_source).session

    def get_sessions(self) -> list[Any]:
        return [p.session for p in self._parsers.values()]

    def get_jmcomic_cdn_domain(self) -> str | None:
        """返回 jmcomic 当前解析到的 CDN 域名。"""
        jm_parser = self._parsers.get("jmcomic")
        if jm_parser and hasattr(jm_parser, "cdn_domain"):
            return jm_parser.cdn_domain  # type: ignore[union-attr]
        return None

    def set_jmcomic_domain(self, domain: str) -> None:
        """设置 jmcomic 自定义域名。传空字符串则恢复自动选择。"""
        jm = self._parsers.get("jmcomic")
        if jm and hasattr(jm, "set_custom_domain"):
            jm.set_custom_domain(domain)  # type: ignore[union-attr]

    def set_source(self, source: str):
        if source in self._factory:
            self.current_source = source
        # 确保当前 source 的解析器已创建
        self._get_parser(source)

    def source_supports_favourites(self, source: str | None = None) -> bool:
        current = self._resolve_source(source)
        return current in _SOURCES_WITH_FAVOURITES

    def get_auth(self, source: str | None = None) -> tuple[str, str]:
        current = self._resolve_source(source)
        auth = self.source_auth.get(current, {"cookie": "", "user_agent": ""})
        return auth.get("cookie", ""), auth.get("user_agent", "")

    def configure_auth(
        self,
        cookie: str = "",
        user_agent: str = "",
        bearer_token: str = "",
        source: str | None = None,
    ):
        current = self._resolve_source(source)
        if current not in self._factory:
            return
        cookie = (cookie or "").strip()
        user_agent = (user_agent or "").strip()
        bearer_token = (bearer_token or "").strip()
        self.source_auth[current] = {
            "cookie": cookie,
            "user_agent": user_agent,
            "bearer_token": bearer_token,
        }
        # 如果解析器已创建，即时应用；否则待懒创建时使用最新认证参数
        parser = self._parsers.get(current)
        if parser is not None:
            parser.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)

    def verify_login_status(self, source: str | None = None) -> tuple[bool, str]:
        src = self._resolve_source(source)
        return self._get_parser(src).verify_login_status()

    def search(
        self, keyword: str, page: int = 1, source: str | None = None, *, tag: str = ""
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = self._resolve_source(source)
        return self._get_parser(src).search(keyword, page=page, tag=tag)

    def random(self, source: str | None = None) -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = self._resolve_source(source)
        if src == "bika":
            comics = self._get_parser("bika").get_random_comics()
            return comics, None
        if src not in ("hcomic", "jmcomic"):
            raise ValueError(f"Random is not supported for source: {src}")
        return self._get_parser(src).random()  # type: ignore[union-attr]

    def favourites(
        self, page: int = 1, raise_errors: bool = False, source: str | None = None
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        src = self._resolve_source(source)
        if not self.source_supports_favourites(src):
            return [], None, False
        return self._get_parser(src).favourites(page=page, raise_errors=raise_errors)

    def add_to_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self._get_parser(src).add_to_favourites(comic_id)

    def check_favourite(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self._get_parser(src).check_favourite(comic_id)

    def remove_from_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self._get_parser(src).remove_from_favourites(comic_id)

    def get_comic_detail(
        self, comic_id: str, slug: str = "", source: str | None = None, source_url: str = ""
    ) -> ComicInfo | None:
        src = self._resolve_source(source)
        parser = self._get_parser(src)
        if src == "hcomic":
            return parser.get_comic_detail(comic_id, slug=slug, source_url=source_url)
        return parser.get_comic_detail(comic_id, slug=slug)

    def prepare_for_download(self, comic: ComicInfo) -> ComicInfo:
        source = (comic.source_site or self.current_source or "hcomic").lower()
        # 未知来源（如脏数据/历史记录字段异常）静默降级，保持原有行为
        if source not in self._factory:
            return comic
        parser = self._get_parser(source)

        # 对已有下载地址且页数有效的条目，不再重复请求详情。
        if comic.image_urls and comic.pages > 0:
            return comic

        # hcomic 默认搜索结果已足够下载，仅在关键字段缺失时补详情。
        if source == "hcomic":
            if comic.media_id and comic.pages > 0:
                return comic
            detail = parser.get_comic_detail(comic.id)
            return detail or comic

        # moeimg 和 jmcomic 需要通过详情接口补齐图片地址。
        # bika 也需要通过详情接口补齐章节和图片地址。
        if source == "bika":
            detail = parser.get_comic_detail(comic.id)
            if detail is None:
                return comic
            if detail.chapters and len(detail.chapters) > 1:
                # 多章节 = 专辑，不需要单章图片 URL；
                # 清空后直接返回，跳过下方 get_chapter_images 单章逻辑。
                detail.image_urls = []
                detail.pages = 0
                # epsCount 可能不准确，以实际章节数为准
                if detail.album_total_chapters != len(detail.chapters):
                    detail.album_total_chapters = len(detail.chapters)
                # 保留原始专辑元数据（prepare_comic 可能被章节任务调用）
                if not detail.album_title and comic.album_title:
                    detail.album_title = comic.album_title
                if not detail.album_id and comic.album_id:
                    detail.album_id = comic.album_id
                return detail
            order = detail.chapters[0].index if detail.chapters else 1
            with parser._with_quality("original"):
                detail.image_urls = parser.get_chapter_images(comic.id, order)  # type: ignore[union-attr]
            detail.pages = len(detail.image_urls)
            return detail
        if source == "copymanga":
            detail = parser.get_comic_detail(comic.id)
            if detail is None:
                return comic
            chapters = getattr(detail, "chapters", None) or []
            if len(chapters) > 1:
                return detail
            chapter_id = chapters[0].id if chapters else ""
            if chapter_id:
                detail.image_urls = parser.get_chapter_images(comic.id, chapter_id)  # type: ignore[union-attr]
                detail.pages = len(detail.image_urls)
            return detail
        detail = parser.get_comic_detail(comic.id)
        return detail or comic
