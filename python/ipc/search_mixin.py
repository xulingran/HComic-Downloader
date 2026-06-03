"""Search, favourites, and preview URL mixin for IPCServer."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from .types import AuthRequiredError

if TYPE_CHECKING:
    from config import Config
    from sources import MultiSourceParser

logger = logging.getLogger(__name__)


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
            except Exception:
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
            "author": comic.author if hasattr(comic, "author") else None,
            "pages": comic.pages if hasattr(comic, "pages") else None,
            "chapters": [
                {"id": c.id, "name": c.name, "index": c.index, "pages": c.pages}
                for c in (getattr(comic, "chapters", None) or [])
            ],
            "albumId": getattr(comic, "album_id", "") or comic.id,
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
            author=data.get("author"),
        )
        download_manager = getattr(self, "_download_manager", None)
        prepare_comic = getattr(download_manager, "prepare_comic", None)
        if prepare_comic:
            prepared = prepare_comic(comic)
            if prepared is not None:
                comic = prepared
        return comic

    def handle_search(
        self,
        query: str,
        mode: str = "keyword",
        page: int = 1,
        source: str | None = None,
        tag: str = "",
    ) -> dict:
        effective_source = (
            source
            if source in ("hcomic", "moeimg", "jmcomic", "bika")
            else self.config.default_source
        )
        effective_query = query
        effective_tag = tag
        if effective_source == "hcomic" and mode == "tag":
            all_tags = [t for t in [query, tag] if t]
            effective_tag = ",".join(all_tags)
            effective_query = ""
        elif effective_source == "moeimg" and mode in ("author", "tag"):
            effective_query = f"{mode}:{query}"
            effective_tag = ""
        elif effective_source == "jmcomic" and mode == "ranking":
            effective_tag = ""
        comics, pagination = self.parser.search(
            effective_query, page=page, source=effective_source, tag=effective_tag
        )
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else page,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }

    def handle_random(self, source: str | None = None) -> dict:
        effective_source = source if source in ("hcomic", "jmcomic") else "hcomic"
        comics, pagination = self.parser.random(source=effective_source)
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else 1,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }

    def handle_get_favourites(self, page: int = 1, source: str = "hcomic") -> dict:
        from sources import ParserResponseError

        valid_sources = ("hcomic", "jmcomic", "moeimg", "bika")
        effective_source = source if source in valid_sources else "hcomic"
        try:
            comics, pagination, needs_login = self.parser.favourites(
                page=page, raise_errors=True, source=effective_source
            )
            self._update_tags_from_favourites_page(comics, effective_source)
            # 去重：同一漫画可能在页面 DOM 中重复出现
            deduped: list = []
            seen: set[tuple] = set()
            for c in comics:
                key = (c.source_site, c.id, c.comic_source)
                if key not in seen:
                    seen.add(key)
                    deduped.append(c)
            if len(deduped) < len(comics):
                logger.info(
                    "Deduplicated favourites: %d -> %d",
                    len(comics),
                    len(deduped),
                )
            return {
                "comics": [self._comic_to_dict(c) for c in deduped],
                "pagination": {
                    "currentPage": pagination.current_page if pagination else page,
                    "totalPages": pagination.total_pages if pagination else 1,
                    "totalItems": pagination.total_items if pagination else 0,
                },
                "needsLogin": needs_login,
            }
        except ParserResponseError as e:
            msg = str(e)
            if any(
                kw in msg.lower()
                for kw in ("401", "403", "unauthorized", "forbidden", "login", "auth")
            ):
                raise AuthRequiredError(msg) from e
            raise RuntimeError(msg) from e
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Get favourites parse error: %s", e)
            raise RuntimeError(f"Parse error: {e}") from e
        except Exception as e:
            logger.error("Get favourites unexpected error: %s", e)
            raise

    def handle_add_to_favourites(self, comic_id: str, source: str = "hcomic") -> dict:
        from sources import ParserResponseError

        valid_sources = ("hcomic", "jmcomic", "moeimg", "bika")
        effective_source = source if source in valid_sources else "hcomic"
        try:
            success = self.parser.add_to_favourites(comic_id, source=effective_source)
            if success:
                self._update_tags_on_favourite_add(comic_id, effective_source)
            return {"success": success}
        except (ParserResponseError, RuntimeError) as e:
            msg = str(e)
            if any(
                kw in msg.lower()
                for kw in (
                    "401",
                    "403",
                    "unauthorized",
                    "forbidden",
                    "认证已失效",
                    "auth",
                )
            ):
                raise AuthRequiredError(msg) from e
            raise RuntimeError(msg) from e

    def handle_check_favourite(self, comic_id: str, source: str = "hcomic") -> dict:
        from sources import ParserResponseError

        valid_sources = ("hcomic", "jmcomic", "moeimg", "bika")
        effective_source = source if source in valid_sources else "hcomic"
        try:
            is_favourited = self.parser.check_favourite(
                comic_id, source=effective_source
            )
            return {"isFavourited": is_favourited}
        except (ParserResponseError, RuntimeError) as e:
            msg = str(e)
            if any(
                kw in msg.lower()
                for kw in (
                    "401",
                    "403",
                    "unauthorized",
                    "forbidden",
                    "认证已失效",
                    "auth",
                )
            ):
                raise AuthRequiredError(msg) from e
            raise RuntimeError(msg) from e

    def handle_remove_from_favourites(
        self, comic_id: str, source: str = "hcomic"
    ) -> dict:
        from sources import ParserResponseError

        valid_sources = ("hcomic", "jmcomic", "moeimg", "bika")
        effective_source = source if source in valid_sources else "hcomic"
        try:
            success = self.parser.remove_from_favourites(
                comic_id, source=effective_source
            )
            if success:
                self._favourite_tags_db.remove_comic(comic_id, effective_source)
            return {"success": success}
        except (ParserResponseError, RuntimeError) as e:
            msg = str(e)
            if any(
                kw in msg.lower()
                for kw in (
                    "401",
                    "403",
                    "unauthorized",
                    "forbidden",
                    "认证已失效",
                    "auth",
                )
            ):
                raise AuthRequiredError(msg) from e
            raise RuntimeError(msg) from e

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

        comic = self._build_and_prepare_comic(comic_data, comic_id=comic_id)

        # 多章节专辑：不预取图片，返回章节列表供前端选章。
        if (
            comic.source_site in ("jmcomic", "bika")
            and len(getattr(comic, "chapters", None) or []) > 1
        ):
            return {
                "imageUrls": [],
                "totalPages": comic.pages or 0,
                "chapters": [
                    {"id": c.id, "name": c.name, "index": c.index, "pages": c.pages}
                    for c in comic.chapters
                ],
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
        # jmcomic 反混淆需要 scrambleId 和 comicId
        if comic.source_site == "jmcomic" and comic.scramble_id:
            result["scrambleId"] = comic.scramble_id
            result["comicId"] = comic.id
        return result

    def handle_get_chapter_preview_urls(
        self, chapter_id: str, album_id: str = "", source_site: str = ""
    ) -> dict:
        """获取单个章节的图片 URL 列表（支持 jmcomic 和 bika）。"""
        if not chapter_id or not isinstance(chapter_id, str):
            raise ValueError("Missing chapter id")
        site = source_site or "jmcomic"
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
            except Exception:
                pass
            image_urls = parser.get_chapter_images(comic_id, order)
            result = {
                "imageUrls": image_urls,
                "totalPages": len(image_urls),
                "comicId": chapter_id,
            }
            return result
        jm = self.parser.parsers.get("jmcomic")
        if jm is None:
            raise ValueError("jmcomic source unavailable")
        image_urls, scramble_id = jm.get_chapter_images(chapter_id)
        result = {
            "imageUrls": image_urls,
            "totalPages": len(image_urls),
            "comicId": chapter_id,
        }
        if scramble_id:
            result["scrambleId"] = scramble_id
        return result

    def handle_get_comic_detail(self, comic_id: str, source: str = "moeimg") -> dict:
        valid_sources = ("hcomic", "moeimg", "jmcomic", "bika")
        effective_source = source if source in valid_sources else "moeimg"
        if source not in valid_sources:
            logger.warning(
                "get_comic_detail: invalid source %r, falling back to moeimg", source
            )
        comic = self.parser.get_comic_detail(comic_id, source=effective_source)
        if comic is None:
            return {"comic": None}
        return {"comic": self._comic_to_dict(comic)}

    def handle_fetch_preview_image(
        self, image_url: str, scramble_id: str = "", comic_id: str = ""
    ) -> dict:
        self._validate_preview_image_url(image_url)
        logger.info(
            "fetch_preview_image: url=%s scramble_id=%s comic_id=%s",
            image_url,
            scramble_id,
            comic_id,
        )
        data_uri = self._do_fetch_preview_image(
            image_url, scramble_id=scramble_id, comic_id=comic_id
        )
        return {"dataUri": data_uri}

    def _update_tags_on_favourite_add(self, comic_id: str, source: str) -> None:
        """Attempt to fetch full comic detail and update the tag index after adding to favourites."""
        try:
            comic = self.parser.get_comic_detail(comic_id, source=source)
            if comic and hasattr(comic, "tags") and comic.tags:
                self._favourite_tags_db.upsert_comic(comic_id, source, comic.tags)
        except Exception as e:
            logger.debug("Failed to update tags on favourite add: %s", e)

    def _update_tags_from_favourites_page(self, comics: list, source: str) -> None:
        """Compare comic tags against stored snapshots and update index if they differ."""
        for comic in comics:
            tags = getattr(comic, "tags", None) or []
            if not tags:
                continue
            existing = self._favourite_tags_db.get_comic_tags(comic.id, source)
            if set(existing) != set(tags):
                self._favourite_tags_db.upsert_comic(comic.id, source, tags)
