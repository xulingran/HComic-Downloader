"""Preview image fetching mixin for IPCServer."""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Callable
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from .image_utils import detect_image_type, referer_for_image_url
from .types import _PREVIEW_IMAGE_MAX_SIZE

_PREVIEW_SIZE_MB = _PREVIEW_IMAGE_MAX_SIZE // 1024 // 1024

if TYPE_CHECKING:
    from downloader import ComicDownloader
    from sources import MultiSourceParser

logger = logging.getLogger(__name__)


def _resolve_eps_id(image_url: str, comic_id: str = "") -> int:
    """解析反混淆所需的 eps_id。

    优先从图片 URL 路径提取（多章节专辑每章有独立 eps_id，这是正确值），
    URL 无法提取时回退到传入的 comic_id。两者皆无则返回 0。
    """
    from sources.jm.descrambler import _extract_eps_id

    eps_id = _extract_eps_id(image_url)
    if eps_id:
        return eps_id
    try:
        return int(comic_id)
    except (ValueError, TypeError):
        return 0


class PreviewMixin:
    """Mixin providing preview page image fetch methods."""

    downloader: ComicDownloader
    parser: MultiSourceParser
    _write_response: Callable[[dict], None]

    # 静态基础白名单，jm 动态域名在校验时从 parser 实时获取
    _BASE_PREVIEW_IMAGE_DOMAINS = frozenset(
        {
            "h-comic.com",
            "h-comic.link",
            "moeimg.fan",
            "moeimg.net",
            "cdndelivers.cloud",
            "bunnyssd.com",
            "picacomic.com",
            "i.nhentai.net",
            "t.nhentai.net",
        }
    )

    def _get_allowed_preview_domains(self) -> set[str]:
        """合并静态白名单与 jm 动态域名（主域名 + CDN 域名）。

        jm 镜像域名频繁变更，CDN 子域名在解析漫画详情时才被
        发现（如 cdn-msp.18comic.vip），硬编码无法覆盖所有情况。
        """
        domains = set(self._BASE_PREVIEW_IMAGE_DOMAINS)
        # 默认域名始终允许
        from sources.jm.constants import DEFAULT_DOMAIN

        domains.add(DEFAULT_DOMAIN)
        jm = self.parser.parsers.get("jm")
        if jm:
            domain = getattr(jm, "_domain", None)
            if isinstance(domain, str):
                domains.add(domain)
            cdn = getattr(jm, "cdn_domain", None)
            if isinstance(cdn, str):
                domains.add(cdn)
        return domains

    def _validate_preview_image_url(self, url: str) -> None:
        if not url or not isinstance(url, str):
            raise ValueError("Missing or invalid image_url")
        if len(url) > 2048:
            raise ValueError("URL too long")
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise ValueError("Only HTTPS URLs are allowed")
        hostname = parsed.hostname or ""
        allowed = self._get_allowed_preview_domains()
        if not any(hostname == d or hostname.endswith("." + d) for d in allowed):
            raise ValueError(f"Domain not allowed: {hostname}")

    def _fetch_image_bytes(self, url: str, max_size: int, *, image_quality: str = "") -> bytes:
        """Fetch a preview image and return its raw bytes (no base64 / data URI)."""
        self._validate_preview_image_url(url)
        session = self.downloader.create_isolated_session()
        try:
            for key in ("Cookie", "User-Agent"):
                if key in self.downloader.session.headers:
                    session.headers[key] = self.downloader.session.headers[key]

            final_url, session = self.downloader.url_validator.resolve_redirects(url, session, self.downloader.timeout)
            final_parsed = urlparse(final_url)
            final_hostname = final_parsed.hostname or ""
            if final_parsed.scheme != "https":
                raise ValueError(f"Redirect target must use HTTPS, got: {final_parsed.scheme}")
            if not any(
                final_hostname == d or final_hostname.endswith("." + d) for d in self._get_allowed_preview_domains()
            ):
                raise ValueError(f"Redirect target domain not allowed: {final_hostname}")

            headers = {
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": referer_for_image_url(url),
            }
            if image_quality:
                headers["image-quality"] = image_quality
            with session.get(
                final_url,
                timeout=self.downloader.timeout,
                headers=headers,
                stream=True,
                allow_redirects=False,
            ) as response:
                response.raise_for_status()

                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_content(chunk_size=8192):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_size:
                        raise ValueError(f"Preview image too large (exceeds {_PREVIEW_SIZE_MB} MB limit)")
                    chunks.append(chunk)
            content = b"".join(chunks)
        finally:
            session.close()

        content_type = detect_image_type(content)
        if not content_type:
            raise ValueError("Response is not a recognized image format")
        return content

    def _read_preview_cache(self, url: str) -> str | None:
        """Return url_hash from persistent cache, or None on miss.

        The url_hash (= disk file name) is returned directly by the cache's
        ``get``; no bytes are read and no base64 encoding happens here.
        """
        if not hasattr(self, "_preview_cache"):
            return None
        try:
            cached_hash = self._preview_cache.get(url)
        except (OSError, sqlite3.Error):
            logger.debug("Preview cache read failed for %s, re-fetching", url, exc_info=True)
            return None
        if cached_hash:
            logger.debug("Preview cache hit for %s", url)
        return cached_hash

    def _apply_descramble(self, raw_bytes: bytes, url: str, comic_id: str) -> bytes:
        """Apply jm descrambling to raw image bytes, returning the result bytes.

        If descrambling is a no-op (bytes unchanged) or unavailable, the input
        bytes are returned as-is. Never raises on descramble failure — logs a
        warning and returns the original bytes so the (un-scrambled-looking)
        image still displays rather than failing the whole fetch.
        """
        try:
            from sources.jm.descrambler import descramble_image

            eps_id = _resolve_eps_id(url, comic_id)
            descrambled = descramble_image(raw_bytes, eps_id, image_url=url)
            if descrambled != raw_bytes:
                logger.debug("Descrambled preview image for %s", url)
                return descrambled
        except (ValueError, OSError) as e:
            logger.warning("Descramble failed for %s: %s", url, e)
        return raw_bytes

    def _write_preview_cache(self, url: str, raw_bytes: bytes) -> str | None:
        """Save raw image bytes to persistent cache; return url_hash or None.

        Best-effort: on failure logs and returns None. The returned url_hash
        (= ``sha256(url).hexdigest()``, = disk file name) lets the caller avoid
        a follow-up ``get`` to retrieve it.
        """
        if not hasattr(self, "_preview_cache"):
            return None
        try:
            self._preview_cache.put(url, raw_bytes)
        except (OSError, sqlite3.Error):
            logger.debug("Failed to write preview cache for %s", url, exc_info=True)
            return None
        # url_hash is deterministic from the url; compute it directly rather
        # than re-reading via get() (avoids a DB round-trip and any eviction
        # race between put and get).
        import hashlib

        return hashlib.sha256(url.encode()).hexdigest()

    def _do_fetch_preview_image(
        self,
        url: str,
        *,
        scramble_id: str = "",
        comic_id: str = "",
        image_quality: str = "",
    ) -> str:
        """Fetch a preview page image, persist it, and return its url_hash.

        Uses cache when available — including for jm (the on-disk bytes are
        already descrambled, since descrambling happens before ``put``, so a
        cache hit is safe to reuse). When *scramble_id* and *comic_id* are
        provided (jm source), a freshly-fetched image is descrambled before
        caching. Returns the ``url_hash`` (= disk file name) downstream layers
        use to build the ``app-image://`` protocol URL.

        Write-failure policy: if ``_write_preview_cache`` returns ``None``
        (disk write failure / SQLite error / permission error, or no
        ``_preview_cache`` attribute), this method **must** raise. The
        ``app-image://`` protocol handler only streams on-disk files and has no
        on-demand re-fetch fallback — so a url_hash without a backing file is a
        guaranteed 404. Returning such a hash would surface as a silent image
        load failure while masking the real (recoverable) write error. Raising
        lets the existing preview error-recovery / retry path engage instead.
        """
        self._validate_preview_image_url(url)

        needs_descramble = bool(scramble_id and comic_id)

        # Cache hit returns url_hash directly for ALL sources (incl. jm — the
        # stored bytes are post-descramble, deterministic per url).
        cached = self._read_preview_cache(url)
        if cached:
            return cached

        raw_bytes = self._fetch_image_bytes(url, _PREVIEW_IMAGE_MAX_SIZE, image_quality=image_quality)

        if needs_descramble:
            raw_bytes = self._apply_descramble(raw_bytes, url, comic_id)

        url_hash = self._write_preview_cache(url, raw_bytes)
        if url_hash is None:
            raise RuntimeError(f"Failed to persist preview image to cache for {url}")
        return url_hash

    def _async_fetch_preview_image(
        self,
        url: str,
        req_id: str,
        *,
        scramble_id: str = "",
        comic_id: str = "",
        image_quality: str = "",
    ) -> None:
        """Thread-pool target: fetch a reader page image and write response."""
        try:
            url_hash = self._do_fetch_preview_image(
                url, scramble_id=scramble_id, comic_id=comic_id, image_quality=image_quality
            )
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"urlHash": url_hash},
                }
            )
        except Exception as e:
            logger.error("Preview image fetch error for %s: %s", url, e)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(e)},
                }
            )
