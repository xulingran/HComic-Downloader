"""Shared types, constants, and configuration helpers for IPC mixins."""

import os


class AuthRequiredError(Exception):
    """Raised when an operation requires authentication."""

    pass


def _get_config_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "config.json")


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
    "fontName": "font_name",
    "fontSize": "font_size",
    "sfwMode": "sfw_mode",
    "tagBlacklist": "tag_blacklist",
    "previewCacheSizeLimitMB": "preview_cache_size_limit_mb",
    "jmcomicDomain": "jmcomic_domain",
    "favouriteTagHighlight": "favourite_tag_highlight",
    "favouriteTagMinMatches": "favourite_tag_min_matches",
    "checkUpdateOnStart": "check_update_on_start",
}

_COVER_POOL_MAX_WORKERS = 4
_PREVIEW_POOL_MAX_WORKERS = 4
_PREVIEW_IMAGE_MAX_SIZE = 12 * 1024 * 1024
