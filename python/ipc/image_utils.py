"""Static image utility helpers shared by cover and preview mixins."""

from urllib.parse import urlparse


def detect_image_type(data: bytes) -> str:
    """Detect image MIME type from magic bytes."""
    if len(data) < 12:
        return ''
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[4:8] == b'ftyp' and (b'avif' in data[8:32] or b'avis' in data[8:32]):
        return 'image/avif'
    return ''


def referer_for_image_url(url: str) -> str:
    """Return the appropriate Referer header for a given image URL."""
    hostname = urlparse(url).hostname or ""
    if (
        hostname == "moeimg.fan"
        or hostname.endswith(".moeimg.fan")
        or hostname.endswith(".moeimg.net")
        or hostname.endswith(".cdndelivers.cloud")
        or hostname.endswith(".bunnyssd.com")
    ):
        return "https://moeimg.fan/"
    return "https://h-comic.com/"


def headers_for_image_url(url: str, parser_session_headers: dict) -> dict:
    """Build request headers for fetching an image URL."""
    headers = {
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": referer_for_image_url(url),
    }
    hostname = urlparse(url).hostname or ""
    source = "moeimg" if (
        hostname == "moeimg.fan"
        or hostname.endswith(".moeimg.fan")
        or hostname.endswith(".moeimg.net")
        or hostname.endswith(".cdndelivers.cloud")
    ) else "hcomic"
    headers.update(parser_session_headers)
    headers["Referer"] = referer_for_image_url(url)
    return headers
