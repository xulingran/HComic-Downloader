"""Shared types, constants, and configuration helpers for IPC mixins."""

import os


class AuthRequiredError(Exception):
    """Raised when an operation requires authentication."""

    pass


def _get_config_path() -> str:
    """Return the path to config.json.

    HCOMIC_CONFIG_DIR overrides the base directory. It is read at call time
    (not import time), so every module's local binding picks up the override
    uniformly — used by tests to redirect config writes to a tmp dir and
    avoid clobbering the real ~/.hcomic_downloader/config.json. When unset or
    empty, falls back to the user's home directory for production use.
    """
    base = os.environ.get("HCOMIC_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
    return os.path.join(base, "config.json")


CONFIG_KEY_MAP = {
    "themeMode": "theme_mode",
    "outputFormat": "output_format",
    "downloadDir": "download_dir",
    "concurrentDownloads": "concurrent_downloads",
    "timeout": "timeout",
    "retryTimes": "retry_times",
    "cbzFilenameTemplate": "cbz_filename_template",
    "batchDownloadDelay": "batch_download_delay",
    "autoRetryMaxAttempts": "auto_retry_max_attempts",
    "notifyOnComplete": "notify_on_complete",
    "notifyWhenForeground": "notify_when_foreground",
    "defaultSource": "default_source",
    "defaultFavouriteSource": "default_favourite_source",
    "fontName": "font_name",
    "fontSize": "font_size",
    "sfwMode": "sfw_mode",
    "cardStyle": "card_style",
    "tagBlacklist": "tag_blacklist",
    "myTags": "my_tags",
    "duplicateBlacklist": "duplicate_blacklist",
    "missingBlacklist": "missing_blacklist",
    "previewCacheSizeLimitMB": "preview_cache_size_limit_mb",
    "jmDomain": "jm_domain",
    "favouriteTagHighlight": "favourite_tag_highlight",
    "favouriteTagMinMatches": "favourite_tag_min_matches",
    "checkUpdateOnStart": "check_update_on_start",
    "bikaImageQuality": "bika_image_quality",
    "previewPreloadForward": "preview_preload_forward",
    "previewPreloadBackward": "preview_preload_backward",
    "previewPreloadConcurrency": "preview_preload_concurrency",
    "previewPreloadAdaptive": "preview_preload_adaptive",
}

_COVER_POOL_MAX_WORKERS = 4
_PREVIEW_POOL_MAX_WORKERS = 4
_REQUEST_POOL_MAX_WORKERS = 8
_PREVIEW_IMAGE_MAX_SIZE = 12 * 1024 * 1024
