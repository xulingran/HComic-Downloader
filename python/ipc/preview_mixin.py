"""Preview image fetching mixin for IPCServer."""

from __future__ import annotations

import base64
import logging
from typing import TYPE_CHECKING, Any, Callable, Dict
from urllib.parse import urlparse

from .image_utils import detect_image_type, referer_for_image_url
from .types import _PREVIEW_IMAGE_MAX_SIZE

if TYPE_CHECKING:
    from downloader import ComicDownloader

logger = logging.getLogger(__name__)


class PreviewMixin:
    """Mixin providing preview page image fetch methods."""

    downloader: ComicDownloader
    _write_response: Callable[[Dict], None]

    ALLOWED_PREVIEW_IMAGE_DOMAINS = {
        "h-comic.com",
        "h-comic.link",
        "moeimg.fan",
        "moeimg.net",
        "cdndelivers.cloud",
        "bunnyssd.com",
    }

    def _validate_preview_image_url(self, url: str) -> None:
        if not url or not isinstance(url, str):
            raise ValueError("Missing or invalid image_url")
        if len(url) > 2048:
            raise ValueError("URL too long")
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise ValueError("Only HTTPS URLs are allowed")
        hostname = parsed.hostname or ""
        if not any(
            hostname == d or hostname.endswith("." + d)
            for d in self.ALLOWED_PREVIEW_IMAGE_DOMAINS
        ):
            raise ValueError(f"Domain not allowed: {hostname}")

    def _fetch_image_as_data_uri(self, url: str, max_size: int) -> str:
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
                final_hostname == d or final_hostname.endswith("." + d)
                for d in self.ALLOWED_PREVIEW_IMAGE_DOMAINS
            ):
                raise ValueError(f"Redirect target domain not allowed: {final_hostname}")

            headers = {
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": referer_for_image_url(url),
            }
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
                        raise ValueError("Image too large")
                    chunks.append(chunk)
            content = b"".join(chunks)
        finally:
            session.close()

        content_type = detect_image_type(content)
        if not content_type:
            raise ValueError("Response is not a recognized image format")

        b64 = base64.b64encode(content).decode("ascii")
        return f"data:{content_type};base64,{b64}"

    def _do_fetch_preview_image(self, url: str) -> str:
        """Fetch a preview page image through the authenticated Python session."""
        self._validate_preview_image_url(url)
        return self._fetch_image_as_data_uri(url, _PREVIEW_IMAGE_MAX_SIZE)

    def _async_fetch_preview_image(self, url: str, req_id: str) -> None:
        """Thread-pool target: fetch a reader page image and write response."""
        try:
            data_uri = self._do_fetch_preview_image(url)
            self._write_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"dataUri": data_uri},
            })
        except Exception as e:
            logger.error("Preview image fetch error for %s: %s", url, e)
            self._write_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)},
            })
