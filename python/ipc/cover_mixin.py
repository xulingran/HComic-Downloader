"""Cover image fetching mixin for IPCServer."""

from __future__ import annotations

import base64
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


class CoverMixin:
    """Mixin providing cover image fetch and cache methods."""

    parser: MultiSourceParser
    _cover_cache: CoverCacheDB
    _write_response: Callable[[dict], None]

    ALLOWED_COVER_DOMAINS = {
        "h-comic.link",
        "moeimg.fan",
        "moeimg.net",
        "jmcomic-zzz.one",
    }

    def _build_cover_session(self, referer_domain: str = ""):
        """Create a thread-safe requests session with auth, cookies, and TLS fingerprinting.

        Uses curl_cffi for TLS fingerprint impersonation (required by jmcomic CDN),
        copies cookies from all parser sessions, and sets a Referer header for
        hotlinking protection bypass.
        """
        # Use curl_cffi for TLS fingerprint impersonation if available
        try:
            from curl_cffi import requests as cf_requests

            session = cf_requests.Session(impersonate="chrome136")
        except ImportError:
            import requests as _requests

            session = _requests.Session()

        # Copy headers from parser (User-Agent, Accept, etc.)
        try:
            src_headers = dict(self.parser.session.headers)
        except Exception:
            src_headers = {}
        if src_headers:
            session.headers.update(src_headers)

        # Copy cookies from all parser sessions — critical for jmcomic
        # which relies on cookie jar (not Cookie header) for auth.
        try:
            for ps in self.parser.get_sessions():
                for cookie in ps.cookies:
                    session.cookies.set_cookie(cookie)
        except Exception:
            pass

        # Set Referer for hotlinking protection bypass (jmcomic CDN requires this)
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
        hostname = parsed.hostname or ""
        if not any(
            hostname == d or hostname.endswith("." + d)
            for d in self.ALLOWED_COVER_DOMAINS
        ):
            raise ValueError(f"Domain not allowed: {hostname}")

    def _do_fetch_cover(self, url: str) -> str:
        """Fetch cover image and return base64 data URI (thread-safe, called from pool)."""
        headers = {"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
        try:
            src_headers = dict(self.parser.session.headers)
            headers.update(src_headers)
        except Exception:
            pass

        # Extract domain from cover URL for Referer header (required by jmcomic CDN)
        referer_domain = urlparse(url).hostname or ""

        session = self._build_cover_session(referer_domain=referer_domain)
        response = session.get(url, timeout=10, headers=headers, stream=True)
        response.raise_for_status()

        # Validate final URL after redirects is still on an allowed domain and HTTPS
        final_parsed = urlparse(response.url)
        if final_parsed.scheme != "https":
            raise ValueError(
                f"Redirect target must use HTTPS, got: {final_parsed.scheme}"
            )
        final_hostname = final_parsed.hostname or ""
        if not any(
            final_hostname == d or final_hostname.endswith("." + d)
            for d in self.ALLOWED_COVER_DOMAINS
        ):
            raise ValueError(f"Redirect target domain not allowed: {final_hostname}")

        # Read up to MAX_COVER_SIZE + 1 byte - if we get more, the image is too large
        max_size = MAX_COVER_SIZE
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=8192):
            total += len(chunk)
            if total > max_size:
                raise ValueError("Image too large")
            chunks.append(chunk)
        content = b"".join(chunks)

        content_type = detect_image_type(content)
        if not content_type:
            raise ValueError("Response is not a recognized image format")

        b64 = base64.b64encode(content).decode("ascii")
        return f"data:{content_type};base64,{b64}"

    def _async_fetch_cover(self, url: str, req_id: str) -> None:
        """Thread-pool target: fetch cover and write response via stdout lock."""
        try:
            cached = self._cover_cache.get(url)
            if cached is not None:
                self._write_response(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"dataUri": cached},
                    }
                )
                return

            data_uri = self._do_fetch_cover(url)
            self._cover_cache.put(url, data_uri)

            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"dataUri": data_uri},
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
