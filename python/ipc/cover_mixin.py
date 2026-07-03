"""Cover image fetching mixin for IPCServer."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from .image_utils import detect_image_type

if TYPE_CHECKING:
    from ipc.cover_cache import CoverCacheDB
    from sources import MultiSourceParser

logger = logging.getLogger(__name__)

MAX_COVER_SIZE = 10 * 1024 * 1024  # 10MB — high-res manga covers
_COVER_SIZE_MB = MAX_COVER_SIZE // 1024 // 1024


class CoverMixin:
    """Mixin providing cover image fetch and cache methods."""

    parser: MultiSourceParser
    _cover_cache: CoverCacheDB
    _write_response: Callable[[dict], None]

    def _build_cover_session(self, referer_domain: str = ""):
        """Create a thread-safe requests session with auth, cookies, and TLS fingerprinting.

        Uses curl_cffi for TLS fingerprint impersonation (required by jm CDN),
        copies cookies from all parser sessions, and sets a Referer header for
        hotlinking protection bypass.
        """
        # Use curl_cffi for TLS fingerprint impersonation if available
        try:
            from curl_cffi import requests as cf_requests

            from sources.jm.constants import IMPERSONATE_BROWSER

            session = cf_requests.Session(impersonate=IMPERSONATE_BROWSER)
        except ImportError:
            import requests as _requests

            session = _requests.Session()

        # Apply system proxy so covers on foreign CDNs can be reached
        from utils import apply_system_proxy_to_session

        apply_system_proxy_to_session(session)

        # Copy headers from parser (User-Agent, Accept, etc.)
        try:
            src_headers = dict(self.parser.session.headers)
        except (AttributeError, TypeError):
            src_headers = {}
        if src_headers:
            session.headers.update(src_headers)

        # Copy cookies from all parser sessions — critical for jm
        # which relies on cookie jar (not Cookie header) for auth.
        try:
            for ps in self.parser.get_sessions():
                for cookie in ps.cookies:
                    session.cookies.set_cookie(cookie)
        except (AttributeError, KeyError):
            pass

        # Set Referer for hotlinking protection bypass (jm CDN requires this)
        if referer_domain:
            session.headers["Referer"] = f"https://{referer_domain}/"

        return session

    def _validate_cover_url(self, url: str) -> None:
        if not url or not isinstance(url, str):
            raise ValueError("Missing or invalid url")
        if len(url) > 2048:
            raise ValueError("URL too long")
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise ValueError("Only HTTPS URLs are allowed")

    def _do_fetch_cover(self, url: str) -> str:
        """Fetch cover image, persist raw bytes to cache, return url_hash.

        Thread-safe, called from pool. The returned ``url_hash`` (= disk file
        name) is what downstream layers use to build the ``app-image://``
        protocol URL — no base64 / data URI is produced here.
        """
        headers = {"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
        try:
            src_headers = dict(self.parser.session.headers)
            headers.update(src_headers)
        except (AttributeError, KeyError):
            pass

        # Extract domain from cover URL for Referer header (required by jm CDN)
        referer_domain = urlparse(url).hostname or ""

        session = self._build_cover_session(referer_domain=referer_domain)
        response = session.get(url, timeout=10, headers=headers, stream=True)
        response.raise_for_status()

        # Validate final URL after redirects is still HTTPS
        final_parsed = urlparse(response.url)
        if final_parsed.scheme != "https":
            raise ValueError(f"Redirect target must use HTTPS, got: {final_parsed.scheme}")

        # Read up to MAX_COVER_SIZE + 1 byte - if we get more, the image is too large
        max_size = MAX_COVER_SIZE
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=8192):
            total += len(chunk)
            if total > max_size:
                raise ValueError(f"Cover image too large (exceeds {_COVER_SIZE_MB} MB limit)")
            chunks.append(chunk)
        content = b"".join(chunks)

        content_type = detect_image_type(content)
        if not content_type:
            raise ValueError("Response is not a recognized image format")

        # Persist raw bytes; put returns nothing, so compute url_hash directly
        # (deterministic from url) rather than re-reading via get() — avoids a
        # DB round-trip and any eviction race between put and get. The bytes
        # are validated above (detect_image_type) before put, keeping the
        # on-disk cache trustworthy without needing deep probes on get.
        import hashlib

        self._cover_cache.put(url, content)
        return hashlib.sha256(url.encode()).hexdigest()

    def _async_fetch_cover(self, url: str, req_id: str) -> None:
        """Thread-pool target: fetch cover and write response via stdout lock."""
        try:
            # Cache hit returns url_hash directly — no fetch, no base64.
            cached = self._cover_cache.get(url)
            if cached is not None:
                self._write_response(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"urlHash": cached},
                    }
                )
                return

            url_hash = self._do_fetch_cover(url)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"urlHash": url_hash},
                }
            )
        except Exception as e:
            logger.error("Cover fetch error for %s: %s", url, e)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(e)},
                }
            )
