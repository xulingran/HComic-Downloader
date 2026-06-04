"""共享的图片格式定义。"""

DEFAULT_IMAGE_EXT = ".jpg"
PAGE_FILENAME_WIDTH = 3
_PAGE_FMT_PAD = f"{{page:0{PAGE_FILENAME_WIDTH}d}}"
PAGE_FILENAME_FORMAT = _PAGE_FMT_PAD + "{ext}"

MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
}

PIL_FORMAT_TO_EXT = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "GIF": ".gif",
    "WEBP": ".webp",
    "BMP": ".bmp",
    "ICO": ".ico",
}

SUPPORTED_IMAGE_EXTENSIONS = frozenset(
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
        ".ico",
    }
)
