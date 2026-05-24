"""Search, favourites, and preview URL mixin for IPCServer."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any, Callable, Dict, Optional

from .types import AuthRequiredError

if TYPE_CHECKING:
    from config import Config
    from parser import MultiSourceParser

logger = logging.getLogger(__name__)


class SearchMixin:
    """Mixin providing search, favourites, and preview URL handler methods."""

    config: Config
    parser: MultiSourceParser
    _validate_preview_image_url: Callable[[str], bool]
    _do_fetch_preview_image: Callable[..., Any]

    def _comic_to_dict(self, comic) -> Dict:
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
            "tags": comic.tags if hasattr(comic, 'tags') else [],
            "author": comic.author if hasattr(comic, 'author') else None,
            "pages": comic.pages if hasattr(comic, 'pages') else None,
        }

    def _build_and_prepare_comic(self, data: dict, comic_id: Optional[str] = None):
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

    def handle_search(self, query: str, mode: str = "keyword", page: int = 1, source: Optional[str] = None, tag: str = "") -> Dict:
        effective_source = source if source in ("hcomic", "moeimg") else self.config.default_source
        effective_query = query
        effective_tag = tag
        if effective_source == "hcomic" and mode == "tag":
            all_tags = [t for t in [query, tag] if t]
            effective_tag = ",".join(all_tags)
            effective_query = ""
        elif effective_source == "moeimg" and mode in ("author", "tag"):
            effective_query = f"{mode}:{query}"
            effective_tag = ""
        comics, pagination = self.parser.search(effective_query, page=page, source=effective_source, tag=effective_tag)
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else page,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }

    def handle_random(self) -> Dict:
        comics, pagination = self.parser.random(source="hcomic")
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else 1,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }

    def handle_get_favourites(self, page: int = 1) -> Dict:
        from parser import ParserResponseError
        try:
            comics, pagination, needs_login = self.parser.favourites(
                page=page, raise_errors=True, source="hcomic"
            )
            return {
                "comics": [self._comic_to_dict(c) for c in comics],
                "pagination": {
                    "currentPage": pagination.current_page if pagination else page,
                    "totalPages": pagination.total_pages if pagination else 1,
                    "totalItems": pagination.total_items if pagination else 0,
                },
                "needsLogin": needs_login,
            }
        except ParserResponseError as e:
            msg = str(e)
            if any(kw in msg.lower() for kw in ("401", "403", "unauthorized", "forbidden", "login", "auth")):
                raise AuthRequiredError(msg)
            raise RuntimeError(msg)
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Get favourites parse error: %s", e)
            raise RuntimeError(f"Parse error: {e}")
        except Exception as e:
            logger.error("Get favourites unexpected error: %s", e)
            raise

    def handle_get_preview_urls(self, comic_data: dict) -> Dict:
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
        return {
            "imageUrls": image_urls,
            "totalPages": total_pages,
        }

    def handle_fetch_preview_image(self, image_url: str) -> Dict:
        self._validate_preview_image_url(image_url)
        logger.info("fetch_preview_image: url=%s", image_url)
        data_uri = self._do_fetch_preview_image(image_url)
        return {"dataUri": data_uri}
