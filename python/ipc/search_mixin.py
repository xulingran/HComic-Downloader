"""Search, favourites, and preview URL mixin for IPCServer."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

from sources import _SOURCES_WITH_FAVOURITES, _VALID_SOURCES
from sources.base import AntiBotChallengeError, ParserResponseError

from .types import AuthRequiredError

if TYPE_CHECKING:
    from config import Config
    from models import ComicInfo
    from sources import MultiSourceParser

logger = logging.getLogger(__name__)
_DEFAULT_SOURCE = "hcomic"
_JM_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024
_JM_FAVOURITES_PATH_RE = re.compile(r"^/user/[^/?#]+/favorite/albums/?$")
_AUTH_KEYWORDS = (
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "认证已失效",
    "auth",
    "cloudflare",
    "just a moment",
)


def _matches_auth_keywords(message: str) -> bool:
    """检查错误消息是否命中任一 auth 失效关键字（纯字符串匹配，不含 source 白名单）。

    供 ``_is_source_auth_error``（带 source 白名单）与 ``_auth_error_guard`` 的
    ``ParserResponseError`` 分支（不带白名单）共用，避免字面逻辑重复。两处对 source
    白名单的处理有意不同，故仅抽取字符串匹配部分。
    """
    msg = message.lower()
    return any(kw in msg for kw in _AUTH_KEYWORDS)


def _dedupe_comics(comics: list[ComicInfo]) -> tuple[list[ComicInfo], int]:
    """按 (source_site, id, comic_source) 元组对漫画列表去重。

    返回 ``(deduped_list, original_count)``，调用方据此决定是否记录去重日志。
    同一漫画可能在收藏夹页面 DOM 中重复出现。
    """
    deduped: list[ComicInfo] = []
    seen: set[tuple] = set()
    for c in comics:
        key = (c.source_site, c.id, c.comic_source)
        if key not in seen:
            seen.add(key)
            deduped.append(c)
    return deduped, len(comics)


class SearchMixin:
    """Mixin providing search, favourites, and preview URL handler methods."""

    config: Config
    parser: MultiSourceParser
    _validate_preview_image_url: Callable[[str], bool]
    _do_fetch_preview_image: Callable[..., Any]

    def _comic_to_dict(self, comic) -> dict:
        cover_url = comic.cover_url or ""
        if not cover_url:
            try:
                cover_url = comic.get_image_url(1)
            except (KeyError, TypeError):
                cover_url = ""

        return {
            "id": comic.id,
            "title": comic.title,
            "url": comic.preview_url or "",
            "coverUrl": cover_url,
            "source": comic.comic_source or "default",
            "sourceSite": comic.source_site or "hcomic",
            "mediaId": comic.media_id or "",
            "tags": comic.tags if hasattr(comic, "tags") else [],
            "parodies": comic.parodies if hasattr(comic, "parodies") else [],
            "characters": comic.characters if hasattr(comic, "characters") else [],
            "groups": comic.groups if hasattr(comic, "groups") else [],
            "author": comic.author if hasattr(comic, "author") else None,
            "category": comic.category if hasattr(comic, "category") else None,
            "language": comic.language if hasattr(comic, "language") else None,
            "publishDate": comic.publish_date if hasattr(comic, "publish_date") else None,
            "pages": comic.pages if hasattr(comic, "pages") else None,
            "chapters": [
                {"id": c.id, "name": c.name, "index": c.index, "pages": c.pages}
                for c in (getattr(comic, "chapters", None) or [])
            ],
            "albumId": getattr(comic, "album_id", "") or comic.id,
            "albumTitle": getattr(comic, "album_title", "") or "",
            "albumTotalChapters": getattr(comic, "album_total_chapters", 1) or 1,
        }

    def _build_and_prepare_comic(self, data: dict, comic_id: str | None = None):
        """Build a ComicInfo from frontend data and prepare it for download.

        Ensures the comic has full metadata (author, title, pages, etc.)
        fetched from the API so that output path computation matches the
        actual download path exactly.
        """
        from models import ComicInfo

        comic = ComicInfo(
            id=comic_id or data.get("id", ""),
            title=data.get("title", "Unknown"),
            preview_url=data.get("url", ""),
            cover_url=data.get("coverUrl", ""),
            source_site=data.get("sourceSite", "") or "hcomic",
            comic_source=data.get("source", ""),
            media_id=data.get("mediaId", ""),
            pages=data.get("pages") or 0,
            image_urls=data.get("imageUrls") or data.get("image_urls") or [],
            tags=data.get("tags") or [],
            parodies=data.get("parodies") or [],
            characters=data.get("characters") or [],
            groups=data.get("groups") or [],
            author=data.get("author"),
            album_id=data.get("albumId", ""),
            album_total_chapters=data.get("albumTotalChapters") or 1,
            album_title=data.get("albumTitle", ""),
        )
        download_manager = getattr(self, "_download_manager", None)
        prepare_comic = getattr(download_manager, "prepare_comic", None)
        if prepare_comic:
            prepared = prepare_comic(comic)
            if prepared is not None:
                comic = prepared
                # prepare_comic 可能返回新对象，补充前端传入的专辑字段
                if not comic.album_title and data.get("albumTitle"):
                    comic.album_title = data["albumTitle"]
                if not comic.album_id and data.get("albumId"):
                    comic.album_id = data["albumId"]
                if comic.album_total_chapters <= 1 and (data.get("albumTotalChapters") or 0) > 1:
                    comic.album_total_chapters = data["albumTotalChapters"]
        return comic

    def _check_source_auth(self, source: str) -> None:
        """Raise AuthRequiredError if source credentials are not configured."""
        if source == "jm" and not self.config.source_auth.get("jm", {}).get("cookie"):
            raise AuthRequiredError("jm 未登录，请前往设置页面配置登录凭证")
        if source == "copymanga" and not self.config.source_auth.get("copymanga", {}).get("cookie"):
            raise AuthRequiredError("拷贝漫画未登录，请前往设置页面登录拷贝漫画")

    def _is_source_auth_error(self, source: str, error: Exception) -> bool:
        """Check if an exception indicates auth failure for the given source."""
        if source not in ("jm", "copymanga", "hcomic"):
            return False
        return _matches_auth_keywords(str(error))

    @contextmanager
    def _auth_error_guard(self, source: str):
        """Context manager that converts source auth errors to AuthRequiredError.

        注意：``ParserResponseError`` 分支有意不做 source 白名单检查——任何 source
        匹配关键字都转 ``AuthRequiredError``。这与 ``_is_source_auth_error`` 的白名单
        语义不同，故此处直接调 ``_matches_auth_keywords`` 而非 ``_is_source_auth_error``。
        """
        try:
            yield
        except AntiBotChallengeError as e:
            logger.warning("Anti-bot challenge in %s handler: %s", source, e)
            raise
        except ParserResponseError as e:
            msg = str(e)
            if _matches_auth_keywords(msg):
                raise AuthRequiredError(msg) from e
            raise RuntimeError(msg) from e
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Parse error in %s handler: %s", source, e, exc_info=True)
            raise RuntimeError(f"Parse error: {e}") from e
        except Exception as e:
            logger.error("Unexpected error in %s handler: %s", source, e, exc_info=True)
            if self._is_source_auth_error(source, e):
                raise AuthRequiredError(f"{source} 登录凭证已失效: {e}") from e
            raise

    @staticmethod
    def _pagination_to_dict(pagination, fallback_page: int = 1) -> dict:
        if not pagination:
            return {"currentPage": fallback_page, "totalPages": 1, "totalItems": 0}
        return {
            "currentPage": pagination.current_page,
            "totalPages": pagination.total_pages,
            "totalItems": pagination.total_items,
        }

    @staticmethod
    def _build_nh_tag_query(query: str, tag: str = "") -> str:
        tags: list[str] = []
        for value in (query, tag):
            tags.extend(t.strip() for t in (value or "").split(",") if t.strip())
        seen: set[str] = set()
        parts: list[str] = []
        for item in tags:
            key = item.lower()
            if key in seen:
                continue
            seen.add(key)
            escaped = item.replace('"', r"\"")
            parts.append(f'tag:"{escaped}"')
        return " ".join(parts)

    def handle_search(
        self,
        query: str,
        mode: str = "keyword",
        page: int = 1,
        source: str | None = None,
        tag: str = "",
    ) -> dict:
        effective_source = source if source in _VALID_SOURCES else self.config.default_source
        self._check_source_auth(effective_source)
        effective_query = query
        effective_tag = tag
        if effective_source == "hcomic" and mode == "tag":
            all_tags = [t for t in [query, tag] if t]
            effective_tag = ",".join(all_tags)
            effective_query = ""
        elif effective_source == "moeimg" and mode in ("author", "tag"):
            effective_query = f"{mode}:{query}"
            effective_tag = ""
        elif effective_source == "jm" and mode == "ranking":
            effective_tag = ""
        elif effective_source == "copymanga" and mode == "ranking":
            effective_tag = query
            effective_query = ""
        elif effective_source == "nh" and mode == "ranking":
            effective_query = ""
            _nh_sort = (query or "").strip().lower()
            effective_tag = (
                _nh_sort if _nh_sort in ("popular", "popular-today", "popular-week", "popular-month") else ""
            )
        elif effective_source == "nh" and mode == "tag":
            effective_query = self._build_nh_tag_query(query, tag)
            effective_tag = ""
        elif (
            effective_source == "bika"
            and mode in ("ranking", "tag", "category")
            and (mode in ("ranking", "category") or query)
        ):
            effective_tag = ""
            effective_query = ""
        if effective_source == "bika" and mode == "ranking":
            rank_type = query if query in ("H24", "D7", "D30") else "H24"
            bika_parser = self.parser.parsers.get("bika")
            if bika_parser is None:
                raise ValueError("bika source unavailable")
            with self._auth_error_guard(effective_source):
                comics = bika_parser.get_leaderboard(rank_type)
            return {
                "comics": [self._comic_to_dict(c) for c in comics],
                "pagination": self._pagination_to_dict(None, fallback_page=1),
            }
        if effective_source == "bika" and mode == "tag" and query:
            bika_parser = self.parser.parsers.get("bika")
            if bika_parser is None:
                raise ValueError("bika source unavailable")
            with self._auth_error_guard(effective_source):
                comics, pagination = bika_parser.list_comics(page=page, tag=query)
            self._collect_tags_from_comics(comics, effective_source)
            return {
                "comics": [self._comic_to_dict(c) for c in comics],
                "pagination": self._pagination_to_dict(pagination, fallback_page=page),
            }
        if effective_source == "bika" and mode == "category" and query:
            bika_parser = self.parser.parsers.get("bika")
            if bika_parser is None:
                raise ValueError("bika source unavailable")
            with self._auth_error_guard(effective_source):
                comics, pagination = bika_parser.list_comics(page=page, category=query)
            self._collect_tags_from_comics(comics, effective_source)
            return {
                "comics": [self._comic_to_dict(c) for c in comics],
                "pagination": self._pagination_to_dict(pagination, fallback_page=page),
            }
        try:
            with self._auth_error_guard(effective_source):
                comics, pagination = self.parser.search(
                    effective_query, page=page, source=effective_source, tag=effective_tag
                )
        except AntiBotChallengeError:
            # 反爬挑战：冒泡到 ipc_server 顶层捕获，序列化为 -32002 结构化信号。
            raise

        # Incrementally collect tags for supported sources
        if effective_source in ("hcomic", "moeimg", "bika", "nh") and comics:
            self._collect_tags_from_comics(comics, effective_source)

        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": self._pagination_to_dict(pagination, fallback_page=page),
        }

    def handle_random(self, source: str | None = None) -> dict:
        effective_source = source if source in ("hcomic", "jm", "bika") else _DEFAULT_SOURCE
        self._check_source_auth(effective_source)
        try:
            comics, pagination = self.parser.random(source=effective_source)
        except Exception as e:
            if self._is_source_auth_error(effective_source, e):
                raise AuthRequiredError(f"{effective_source} 登录凭证已失效: {e}") from e
            raise
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": self._pagination_to_dict(pagination),
        }

    def handle_get_favourites(self, page: int = 1, source: str = "hcomic") -> dict:
        valid_sources = _SOURCES_WITH_FAVOURITES
        effective_source = source if source in valid_sources else _DEFAULT_SOURCE
        self._check_source_auth(effective_source)
        with self._auth_error_guard(effective_source):
            comics, pagination, needs_login = self.parser.favourites(
                page=page, raise_errors=True, source=effective_source
            )
            self._update_tags_from_favourites_page(comics, effective_source)
            # 去重：同一漫画可能在页面 DOM 中重复出现
            deduped, original_count = _dedupe_comics(comics)
            if len(deduped) < original_count:
                logger.info(
                    "Deduplicated favourites: %d -> %d",
                    original_count,
                    len(deduped),
                )
            return {
                "comics": [self._comic_to_dict(c) for c in deduped],
                "pagination": self._pagination_to_dict(pagination, fallback_page=page),
                "needsLogin": needs_login,
            }

    def handle_parse_jm_favourites_snapshot(self, html: str, source_url: str, page: int = 1) -> dict:
        """解析来自 Electron 主进程的可信 JM 收藏夹 DOM 快照。"""
        self._validate_jm_favourites_snapshot_input(html, source_url, page)
        with self._auth_error_guard("jm"):
            comics, pagination, needs_login = self.parser.parse_jm_favourites_snapshot(
                html=html,
                source_url=source_url,
                page=page,
            )
            self._update_tags_from_favourites_page(comics, "jm")
            deduped, _ = _dedupe_comics(comics)
            return {
                "comics": [self._comic_to_dict(comic) for comic in deduped],
                "pagination": self._pagination_to_dict(pagination, fallback_page=page),
                "needsLogin": needs_login,
            }

    def _validate_jm_favourites_snapshot_input(self, html: str, source_url: str, page: int) -> None:
        if not isinstance(html, str) or not html.strip():
            raise ValueError("JM favourites snapshot HTML is required")
        if len(html.encode("utf-8")) > _JM_SNAPSHOT_MAX_BYTES:
            raise ValueError("JM favourites snapshot exceeds 5 MiB")
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 1000:
            raise ValueError("Invalid JM favourites snapshot page")
        if not isinstance(source_url, str) or not 1 <= len(source_url) <= 2048:
            raise ValueError("Invalid JM favourites snapshot URL")
        parsed = urlparse(source_url)
        if (
            parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or not parsed.hostname
            or not _JM_FAVOURITES_PATH_RE.fullmatch(parsed.path)
            or parsed.fragment
        ):
            raise ValueError("Untrusted JM favourites snapshot URL")
        query = parse_qs(parsed.query, keep_blank_values=True)
        if any(key != "page" for key in query) or any(len(values) != 1 for values in query.values()):
            raise ValueError("Invalid JM favourites snapshot query")
        if page == 1:
            if query.get("page", ["1"]) != ["1"]:
                raise ValueError("JM favourites snapshot page mismatch")
        elif query.get("page") != [str(page)]:
            raise ValueError("JM favourites snapshot page mismatch")

    def handle_add_to_favourites(self, comic_id: str, source: str = "hcomic") -> dict:
        valid_sources = _SOURCES_WITH_FAVOURITES
        effective_source = source if source in valid_sources else _DEFAULT_SOURCE
        with self._auth_error_guard(effective_source):
            success = self.parser.add_to_favourites(comic_id, source=effective_source)
            if success:
                self._update_tags_on_favourite_add(comic_id, effective_source)
            return {"success": success}

    def handle_check_favourite(self, comic_id: str, source: str = "hcomic") -> dict:
        valid_sources = _SOURCES_WITH_FAVOURITES
        effective_source = source if source in valid_sources else _DEFAULT_SOURCE
        with self._auth_error_guard(effective_source):
            is_favourited = self.parser.check_favourite(comic_id, source=effective_source)
            return {"isFavourited": is_favourited}

    def handle_remove_from_favourites(self, comic_id: str, source: str = "hcomic") -> dict:
        valid_sources = _SOURCES_WITH_FAVOURITES
        effective_source = source if source in valid_sources else _DEFAULT_SOURCE
        with self._auth_error_guard(effective_source):
            success = self.parser.remove_from_favourites(comic_id, source=effective_source)
            if success:
                self._favourite_tags_db.remove_comic(comic_id, effective_source)
            return {"success": success}

    def handle_get_preview_urls(self, comic_data: dict) -> dict:
        """Return all image URLs after applying the same metadata preparation as downloads."""
        if not isinstance(comic_data, dict):
            raise ValueError("Invalid comic data")

        comic_id = comic_data.get("id", "")
        source_site = comic_data.get("sourceSite", "hcomic") or "hcomic"

        if not comic_id or not isinstance(comic_id, str):
            raise ValueError("Missing comic id")

        logger.info(
            "get_preview_urls: id=%s source_site=%s pages=%s media_id=%s source=%s",
            comic_id,
            source_site,
            comic_data.get("pages"),
            comic_data.get("mediaId"),
            comic_data.get("source"),
        )

        # copymanga 需要登录才能获取预览
        if source_site == "copymanga":
            self._check_source_auth(source_site)

        comic = self._build_and_prepare_comic(comic_data, comic_id=comic_id)

        # 多章节专辑：不预取图片，返回章节列表供前端选章。
        if comic.source_site in ("jm", "bika", "copymanga") and len(getattr(comic, "chapters", None) or []) > 1:
            return {
                "imageUrls": [],
                "totalPages": comic.pages or 0,
                "chapters": [{"id": c.id, "name": c.name, "index": c.index, "pages": c.pages} for c in comic.chapters],
                "albumId": comic.album_id or comic.id,
                "albumTotalChapters": comic.album_total_chapters or len(comic.chapters),
            }

        image_urls = comic.get_all_image_urls()
        total_pages = max(comic.pages or 0, len(image_urls))

        logger.info(
            "get_preview_urls result: id=%s source_site=%s media_id=%s urls=%d total=%d",
            comic_id,
            comic.source_site,
            comic.media_id,
            len(image_urls),
            total_pages,
        )
        result = {
            "imageUrls": image_urls,
            "totalPages": total_pages,
        }
        # jm 反混淆需要 scrambleId 和 comicId
        if comic.source_site == "jm" and comic.scramble_id:
            result["scrambleId"] = comic.scramble_id
            result["comicId"] = comic.id
        return result

    def handle_get_chapter_preview_urls(self, chapter_id: str, album_id: str = "", source_site: str = "") -> dict:
        """获取单个章节的图片 URL 列表（支持 jm 和 bika）。"""
        import requests

        from sources import ParserResponseError

        if not chapter_id or not isinstance(chapter_id, str):
            raise ValueError("Missing chapter id")
        site = source_site or "jm"
        if site == "bika":
            parser = self.parser.parsers.get("bika")
            if parser is None:
                raise ValueError("bika source unavailable")
            comic_id = album_id or chapter_id
            order = 1
            try:
                chapters = parser.get_chapters(comic_id)
                for ch in chapters:
                    if ch.id == chapter_id:
                        order = ch.index
                        break
            except (requests.RequestException, ParserResponseError):
                logger.warning("Failed to get chapters for chapter preview: %s", chapter_id)
            image_urls = parser.get_chapter_images(comic_id, order)
            result = {
                "imageUrls": image_urls,
                "totalPages": len(image_urls),
                "comicId": chapter_id,
            }
            return result
        if site == "copymanga":
            cm_parser = self.parser.parsers.get("copymanga")
            if cm_parser is None:
                raise ValueError("copymanga source unavailable")
            comic_id = album_id or chapter_id
            image_urls = cm_parser.get_chapter_images(comic_id, chapter_id)
            return {
                "imageUrls": image_urls,
                "totalPages": len(image_urls),
                "comicId": chapter_id,
            }
        jm = self.parser.parsers.get("jm")
        if jm is None:
            raise ValueError("jm source unavailable")
        image_urls, scramble_id = jm.get_chapter_images(chapter_id)
        result = {
            "imageUrls": image_urls,
            "totalPages": len(image_urls),
            "comicId": chapter_id,
        }
        if scramble_id:
            result["scrambleId"] = scramble_id
        return result

    def handle_get_comic_detail(self, comic_id: str, source: str = "moeimg", source_url: str = "") -> dict:
        valid_sources = _VALID_SOURCES
        effective_source = source if source in valid_sources else _DEFAULT_SOURCE
        if source not in valid_sources:
            logger.warning("get_comic_detail: invalid source %r, falling back to moeimg", source)
        comic = self.parser.get_comic_detail(comic_id, source=effective_source, source_url=source_url)
        if comic is None:
            return {"comic": None}
        return {"comic": self._comic_to_dict(comic)}

    def handle_bika_categories(self) -> dict:
        bika_parser = self.parser.parsers.get("bika")
        if not bika_parser:
            raise ValueError("bika 来源不可用")
        categories = bika_parser.get_categories()
        return {"categories": categories}

    def handle_fetch_preview_image(
        self, image_url: str, scramble_id: str = "", comic_id: str = "", image_quality: str = ""
    ) -> dict:
        self._validate_preview_image_url(image_url)
        logger.info(
            "fetch_preview_image: url=%s scramble_id=%s comic_id=%s",
            image_url,
            scramble_id,
            comic_id,
        )
        url_hash = self._do_fetch_preview_image(
            image_url, scramble_id=scramble_id, comic_id=comic_id, image_quality=image_quality
        )
        return {"urlHash": url_hash}

    def _update_tags_on_favourite_add(self, comic_id: str, source: str) -> None:
        """Attempt to fetch full comic detail and update the tag index after adding to favourites."""
        try:
            comic = self.parser.get_comic_detail(comic_id, source=source)
            if comic and hasattr(comic, "tags") and comic.tags:
                self._favourite_tags_db.upsert_comic(comic_id, source, comic.tags)
                # Also feed tags to tag list catalog
                self._tag_list_db.upsert_tags(comic.tags, source)
        except Exception as e:
            logger.debug("Failed to update tags on favourite add: %s", e)

    def _update_tags_from_favourites_page(self, comics: list, source: str, *, collect_empty: bool = False) -> list:
        """Compare comic tags against stored snapshots and update index if they differ.

        Args:
            comics: 漫画列表
            source: 来源标识
            collect_empty: 如果为 True，收集无标签且未索引的漫画并返回

        Returns:
            当 collect_empty=True 时返回需 enrichment 的漫画列表；否则返回空列表。
        """
        empty_tag_comics: list = []
        all_new_tags: list[str] = []
        for comic in comics:
            tags = getattr(comic, "tags", None) or []
            if tags:
                all_new_tags.extend(tags)
                existing = self._favourite_tags_db.get_comic_tags(comic.id, source)
                if set(existing) != set(tags):
                    self._favourite_tags_db.upsert_comic(comic.id, source, tags)
            elif collect_empty:
                existing = self._favourite_tags_db.get_comic_tags(comic.id, source)
                if not existing:
                    empty_tag_comics.append(comic)
        # Also feed tags to tag list catalog
        if all_new_tags:
            self._tag_list_db.upsert_tags(all_new_tags, source)
        return empty_tag_comics

    def _enrich_tags_for_comics(
        self,
        comics: list,
        source: str,
        *,
        progress_callback: Any | None = None,
    ) -> int:
        """通过 get_comic_detail 为无标签漫画补全标签。

        顺序调用，带随机延迟控制请求频率。

        Args:
            comics: 待补全标签的漫画列表。
            source: 来源标识。
            progress_callback: 可选回调，每处理完一本漫画后以累计已完成数量
                （含失败）调用一次，用于向前端推送 enrichment 进度。默认 None
                时行为与历史调用方完全一致。

        Returns:
            成功补全标签的漫画数量。
        """
        import random
        import time

        if not comics:
            return 0

        enriched = 0
        for i, comic in enumerate(comics):
            if i > 0:
                time.sleep(random.uniform(0.3, 0.6))
            try:
                detail = self.parser.get_comic_detail(comic.id, source=source)
                if detail and hasattr(detail, "tags") and detail.tags:
                    self._favourite_tags_db.upsert_comic(comic.id, source, detail.tags)
                    # Also feed tags to tag list catalog
                    self._tag_list_db.upsert_tags(detail.tags, source)
                    enriched += 1
            except Exception as e:
                logger.debug("Tag enrichment failed for %s (%s): %s", comic.id, source, e)
            if progress_callback is not None:
                try:
                    progress_callback(i + 1)
                except Exception as e:  # noqa: BLE001 - 进度回调失败不应中断补全
                    logger.debug("enrich progress_callback failed: %s", e)

        if enriched:
            logger.info("Enriched tags for %d/%d comics (source=%s)", enriched, len(comics), source)
        return enriched
