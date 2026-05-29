"""漫画来源子系统。"""
from __future__ import annotations

import logging

import requests

from models import AuthConfig, ComicInfo, PaginationInfo
from sources.hcomic.parser import HComicParser, ParserResponseError
from sources.jmcomic.parser import JmParser
from sources.moeimg.parser import MoeImgParser
from utils import normalize_source_auth

logger = logging.getLogger(__name__)

__all__ = ["MultiSourceParser", "ParserResponseError"]


class MultiSourceParser:
    """多来源解析器分发层。"""

    SOURCE_OPTIONS = (
        ("hcomic", "h-comic"),
        ("moeimg", "moeimg.fan"),
        ("jmcomic", "禁漫天堂"),
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

        self.parsers: dict[str, HComicParser | MoeImgParser | JmParser] = {
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
        }
        self.current_source = default_source if default_source in self.parsers else "hcomic"

    @staticmethod
    def _normalize_source_auth(source_auth: dict | None) -> dict[str, dict[str, str]]:
        return normalize_source_auth(source_auth)

    @property
    def session(self) -> requests.Session:
        return self.parsers[self.current_source].session

    def get_sessions(self) -> list[requests.Session]:
        return [self.parsers["hcomic"].session, self.parsers["moeimg"].session, self.parsers["jmcomic"].session]

    def get_jmcomic_cdn_domain(self) -> str | None:
        """返回 jmcomic 当前解析到的 CDN 域名。"""
        jm_parser = self.parsers.get("jmcomic")
        if jm_parser and hasattr(jm_parser, 'cdn_domain'):
            return jm_parser.cdn_domain
        return None

    def get_source_options(self) -> tuple[tuple[str, str], ...]:
        return self.SOURCE_OPTIONS

    def set_source(self, source: str):
        if source in self.parsers:
            self.current_source = source

    def source_supports_favourites(self, source: str | None = None) -> bool:
        current = source or self.current_source
        return current == "hcomic"

    def get_auth(self, source: str | None = None) -> tuple[str, str]:
        current = source or self.current_source
        auth = self.source_auth.get(current, {"cookie": "", "user_agent": ""})
        return auth.get("cookie", ""), auth.get("user_agent", "")

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = "", source: str | None = None):
        current = source or self.current_source
        if current not in self.parsers:
            return
        cookie = (cookie or "").strip()
        user_agent = (user_agent or "").strip()
        bearer_token = (bearer_token or "").strip()
        self.source_auth[current] = {"cookie": cookie, "user_agent": user_agent, "bearer_token": bearer_token}
        self.parsers[current].configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)

    def verify_login_status(self, source: str | None = None) -> tuple[bool, str]:
        src = source or self.current_source
        return self.parsers[src].verify_login_status()

    def search(self, keyword: str, page: int = 1, source: str | None = None, *, tag: str = "") -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = source or self.current_source
        return self.parsers[src].search(keyword, page=page, tag=tag)

    def random(self, source: str | None = None) -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = source or self.current_source
        if src not in ("hcomic", "jmcomic"):
            raise ValueError(f"Random is not supported for source: {src}")
        return self.parsers[src].random()

    def favourites(self, page: int = 1, raise_errors: bool = False, source: str | None = None) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        src = source or self.current_source
        if not self.source_supports_favourites(src):
            return [], None, False
        return self.parsers[src].favourites(page=page, raise_errors=raise_errors)

    def add_to_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = source or self.current_source
        if src != "hcomic":
            return False
        return self.parsers[src].add_to_favourites(comic_id)

    def check_favourite(self, comic_id: str, source: str | None = None) -> bool:
        src = source or self.current_source
        if src != "hcomic":
            return False
        return self.parsers[src].check_favourite(comic_id)

    def remove_from_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = source or self.current_source
        if src != "hcomic":
            return False
        return self.parsers[src].remove_from_favourites(comic_id)

    def get_comic_detail(self, comic_id: str, slug: str = "", source: str | None = None) -> ComicInfo | None:
        src = source or self.current_source
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
        detail = parser.get_comic_detail(comic.id)
        return detail or comic
