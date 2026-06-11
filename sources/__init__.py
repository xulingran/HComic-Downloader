"""漫画来源子系统。"""

from __future__ import annotations

import logging
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


class MultiSourceParser:
    """多来源解析器分发层。"""

    SOURCE_OPTIONS = (
        ("hcomic", "h-comic"),
        ("moeimg", "moeimg.fan"),
        ("jmcomic", "jmcomic"),
        ("bika", "哔咔"),
        ("copymanga", "拷贝漫画"),
    )

    def __init__(
        self,
        timeout: int = 30,
        default_source: str = "hcomic",
        source_auth: dict[str, dict[str, str]] | None = None,
        auth: AuthConfig | None = None,
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

        self.parsers: dict[str, HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser] = {
            "hcomic": HComicParser(
                timeout=timeout,
                cookie=self.source_auth["hcomic"]["cookie"],
                user_agent=self.source_auth["hcomic"]["user_agent"],
                bearer_token=self.source_auth["hcomic"]["bearer_token"],
            ),
            "moeimg": MoeImgParser(
                timeout=timeout,
                cookie=self.source_auth["moeimg"]["cookie"],
                user_agent=self.source_auth["moeimg"]["user_agent"],
            ),
            "jmcomic": JmParser(
                timeout=timeout,
                cookie=self.source_auth.get("jmcomic", {}).get("cookie", ""),
                user_agent=self.source_auth.get("jmcomic", {}).get("user_agent", ""),
            ),
            "bika": BikaParser(timeout=timeout),
            "copymanga": CopyMangaParser(timeout=timeout),
        }
        # 为 moeimg 恢复存储的用户名密码（用于懒登录）
        moeimg_auth = self.source_auth.get("moeimg", {})
        moeimg_parser = self.parsers["moeimg"]
        if isinstance(moeimg_parser, MoeImgParser):
            moeimg_parser.set_stored_credentials(
                moeimg_auth.get("username", ""),
                moeimg_auth.get("password", ""),
            )
        # 为 bika 恢复存储的 token 和用户名密码
        bika_auth = self.source_auth.get("bika", {})
        bika_parser = self.parsers["bika"]
        if isinstance(bika_parser, BikaParser):
            if bika_auth.get("bearer_token"):
                bika_parser.configure_auth(bearer_token=bika_auth["bearer_token"])
            bika_parser.set_stored_credentials(
                bika_auth.get("username", ""),
                bika_auth.get("password", ""),
            )
        # 为 hcomic 恢复存储的用户名密码（用于懒登录）
        hcomic_auth = self.source_auth.get("hcomic", {})
        hcomic_parser = self.parsers["hcomic"]
        if isinstance(hcomic_parser, HComicParser):
            hcomic_parser.set_stored_credentials(
                hcomic_auth.get("username", ""),
                hcomic_auth.get("password", ""),
            )
        self.current_source = default_source if default_source in self.parsers else "hcomic"

    @staticmethod
    def _normalize_source_auth(source_auth: dict | None) -> dict[str, dict[str, str]]:
        return normalize_source_auth(source_auth)

    def _resolve_source(self, source: str | None = None) -> str:
        """Resolve effective source: explicit argument or current default."""
        return source or self.current_source

    @property
    def session(self) -> Any:
        return self.parsers[self.current_source].session

    def get_sessions(self) -> list[Any]:
        return [
            self.parsers["hcomic"].session,
            self.parsers["moeimg"].session,
            self.parsers["jmcomic"].session,
            self.parsers["bika"].session,
            self.parsers["copymanga"].session,
        ]

    def get_jmcomic_cdn_domain(self) -> str | None:
        """返回 jmcomic 当前解析到的 CDN 域名。"""
        jm_parser = self.parsers.get("jmcomic")
        if jm_parser and hasattr(jm_parser, "cdn_domain"):
            return jm_parser.cdn_domain  # type: ignore[union-attr]
        return None

    def set_jmcomic_domain(self, domain: str) -> None:
        """设置 jmcomic 自定义域名。传空字符串则恢复自动选择。"""
        jm = self.parsers.get("jmcomic")
        if jm and hasattr(jm, "set_custom_domain"):
            jm.set_custom_domain(domain)  # type: ignore[union-attr]

    def get_source_options(self) -> tuple[tuple[str, str], ...]:
        return self.SOURCE_OPTIONS

    def set_source(self, source: str):
        if source in self.parsers:
            self.current_source = source

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
        if current not in self.parsers:
            return
        cookie = (cookie or "").strip()
        user_agent = (user_agent or "").strip()
        bearer_token = (bearer_token or "").strip()
        self.source_auth[current] = {
            "cookie": cookie,
            "user_agent": user_agent,
            "bearer_token": bearer_token,
        }
        self.parsers[current].configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)

    def verify_login_status(self, source: str | None = None) -> tuple[bool, str]:
        src = self._resolve_source(source)
        return self.parsers[src].verify_login_status()

    def search(
        self, keyword: str, page: int = 1, source: str | None = None, *, tag: str = ""
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = self._resolve_source(source)
        return self.parsers[src].search(keyword, page=page, tag=tag)

    def random(self, source: str | None = None) -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = self._resolve_source(source)
        if src == "bika":
            comics = self.parsers["bika"].get_random_comics()
            return comics, None
        if src not in ("hcomic", "jmcomic"):
            raise ValueError(f"Random is not supported for source: {src}")
        return self.parsers[src].random()  # type: ignore[union-attr]

    def favourites(
        self, page: int = 1, raise_errors: bool = False, source: str | None = None
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        src = self._resolve_source(source)
        if not self.source_supports_favourites(src):
            return [], None, False
        return self.parsers[src].favourites(page=page, raise_errors=raise_errors)

    def add_to_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self.parsers[src].add_to_favourites(comic_id)

    def check_favourite(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self.parsers[src].check_favourite(comic_id)

    def remove_from_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self.parsers[src].remove_from_favourites(comic_id)

    def get_comic_detail(self, comic_id: str, slug: str = "", source: str | None = None) -> ComicInfo | None:
        src = self._resolve_source(source)
        return self.parsers[src].get_comic_detail(comic_id, slug=slug)

    def prepare_for_download(self, comic: ComicInfo) -> ComicInfo:
        source = (comic.source_site or self.current_source or "hcomic").lower()
        parser = self.parsers.get(source)
        if not parser:
            return comic

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
                return detail
            order = detail.chapters[0].index if detail.chapters else 1
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
