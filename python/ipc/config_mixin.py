"""Configuration management mixin for IPCServer."""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from .types import CONFIG_KEY_MAP, _get_config_path

if TYPE_CHECKING:
    from cbz_builder import CBZBuilder
    from config import Config
    from download_manager import ComicDownloadManager
    from downloader import ComicDownloader
    from sources import MultiSourceParser

logger = logging.getLogger(__name__)


class ConfigMixin:
    """Mixin providing all configuration management handler methods."""

    config: Config
    _download_manager: ComicDownloadManager
    downloader: ComicDownloader
    cbz_builder: CBZBuilder
    parser: MultiSourceParser
    _write_response: Callable[[dict], None]

    def _apply_timeout(self, v: int) -> None:
        self.downloader.timeout = v
        self.downloader.image_downloader.timeout = v

    def _apply_concurrent_downloads(self, v: int) -> None:
        self.downloader.concurrent_downloads = v
        self.downloader.image_downloader._pool_size = v
        self.downloader.image_downloader.rebuild_pool()
        self.downloader.image_downloader.configure_auth(
            cookie=self.downloader.session.headers.get("Cookie", ""),
            user_agent=self.downloader.session.headers.get("User-Agent", ""),
        )

    def _apply_retry_times(self, v: int) -> None:
        self.downloader.retry_times = v
        self.downloader.image_downloader.retry_times = v
        self.downloader.rebuild_session()

    def _apply_jmcomic_domain(self, v: str) -> None:
        """Apply jmcomic custom domain with availability test."""
        v = v.strip()
        if v:
            # Format validation
            if " " in v or "/" in v or not v or len(v) > 256:
                raise ValueError(f"域名格式不正确: {v}")
            # Availability test
            try:
                from sources.jmcomic.domain import JmDomainResolver

                resolver = JmDomainResolver()
                if not resolver._test_domain(v):
                    raise ValueError(f"域名 {v} 无法访问，请检查是否正确")
            except ValueError:
                raise
            except Exception as e:
                raise ValueError(f"测试域名 {v} 失败: {e}") from e
        self.parser.set_jmcomic_domain(v)

    def _apply_runtime(self, key: str, value: Any) -> None:
        """Apply a config value to the live runtime objects."""
        _RUNTIME_APPLIERS = {
            "downloadDir": lambda v: self._download_manager.set_output_dir(v),
            "outputFormat": lambda v: self._download_manager.set_output_format(v),
            "batchDownloadDelay": lambda v: self._download_manager.set_delay_after(v),
            "autoRetryMaxAttempts": lambda v: self._download_manager.set_auto_retry_max_attempts(
                v
            ),
            "concurrentDownloads": self._apply_concurrent_downloads,
            "timeout": self._apply_timeout,
            "retryTimes": self._apply_retry_times,
            "cbzFilenameTemplate": lambda v: setattr(
                self.cbz_builder, "filename_template", v
            ),
            "defaultSource": lambda v: self.parser.set_source(v),
            "jmcomicDomain": self._apply_jmcomic_domain,
            "previewCacheSizeLimitMB": lambda v: (
                self._preview_cache.update_max_size(v)
                if hasattr(self, "_preview_cache")
                else None
            ),
        }
        applier = _RUNTIME_APPLIERS.get(key)
        if applier:
            applier(value)

    def handle_get_config(self) -> dict:
        reverse_map = {v: k for k, v in CONFIG_KEY_MAP.items()}
        raw = {
            "theme_mode": self.config.theme_mode,
            "output_format": self.config.output_format,
            "download_dir": self.config.download_dir,
            "concurrent_downloads": self.config.concurrent_downloads,
            "timeout": self.config.timeout,
            "retry_times": self.config.retry_times,
            "cbz_filename_template": self.config.cbz_filename_template,
            "batch_download_delay": self.config.batch_download_delay,
            "auto_retry_max_attempts": self.config.auto_retry_max_attempts,
            "notify_on_complete": self.config.notify_on_complete,
            "notify_when_foreground": self.config.notify_when_foreground,
            "default_source": self.config.default_source,
            "font_name": getattr(self.config, "font_name", ""),
            "font_size": getattr(self.config, "font_size", 14),
            "sfw_mode": getattr(self.config, "sfw_mode", True),
            "tag_blacklist": getattr(
                self.config, "tag_blacklist", {"hcomic": [], "moeimg": []}
            ),
            "preview_cache_size_limit_mb": getattr(
                self.config, "preview_cache_size_limit_mb", 500
            ),
            "jmcomic_domain": getattr(self.config, "jmcomic_domain", ""),
            "favourite_tag_highlight": getattr(
                self.config, "favourite_tag_highlight", False
            ),
        }
        config = {}
        for snake_key, value in raw.items():
            camel_key = reverse_map.get(snake_key, snake_key)
            config[camel_key] = value
        config["hasAuth"] = bool(
            self.config.source_auth.get("hcomic", {}).get("cookie")
        )
        config["hasJmcomicAuth"] = bool(
            self.config.source_auth.get("jmcomic", {}).get("cookie")
        )
        # 返回 jmcomic CDN 域名，供前端动态更新白名单
        jmcomic_cdn = self.parser.get_jmcomic_cdn_domain()
        if jmcomic_cdn:
            config["jmcomicCdnDomain"] = jmcomic_cdn
        # 返回 jmcomic 主域名，供弹窗登录使用
        jm = self.parser.parsers.get("jmcomic")
        if jm and hasattr(jm, "_ensure_domain"):
            with contextlib.suppress(Exception):
                config["jmcomicDomain"] = jm._ensure_domain()
        return {"config": config}

    def handle_set_config(self, key: str, value: Any) -> dict:
        python_key = CONFIG_KEY_MAP.get(key)
        if not python_key:
            raise ValueError(f"Unknown config key: {key}")
        if not hasattr(self.config, python_key):
            raise ValueError(f"Unknown config key: {key}")

        old_value = getattr(self.config, python_key)

        try:
            self._apply_runtime(key, value)
        except Exception as e:
            logger.error("Set config runtime error for %s: %s", key, e)
            raise

        try:
            setattr(self.config, python_key, value)
            self.config.save(_get_config_path())
        except Exception as e:
            try:
                self._apply_runtime(key, old_value)
            except Exception as rollback_err:
                logger.error("Failed to rollback runtime for %s: %s", key, rollback_err)
            logger.error("Set config save error for %s: %s", key, e)
            raise

        return {"success": True}

    def handle_get_proxy_status(self) -> dict:
        """Return current system proxy configuration."""
        try:
            from utils import get_system_proxies

            proxies = get_system_proxies()
            return {
                "http": proxies.get("http", ""),
                "https": proxies.get("https", ""),
                "noProxy": "",
            }
        except Exception as e:
            logger.error("Get proxy status error: %s", e)
            return {"http": "", "https": "", "noProxy": ""}

    def handle_get_available_fonts(self) -> dict:
        """Return platform-aware CJK font recommendations."""
        import platform

        system = platform.system()
        if system == "Darwin":
            fonts = [
                {
                    "name": "Hiragino Sans, PingFang SC, sans-serif",
                    "label": "Hiragino Sans (macOS default)",
                },
                {"name": "PingFang SC, sans-serif", "label": "PingFang SC"},
                {"name": "Hiragino Sans GB, sans-serif", "label": "Hiragino Sans GB"},
                {"name": "Apple LiGothic, sans-serif", "label": "Apple LiGothic"},
                {"name": "sans-serif", "label": "System Default"},
            ]
        elif system == "Windows":
            fonts = [
                {
                    "name": "Microsoft YaHei, sans-serif",
                    "label": "Microsoft YaHei (\u5fae\u8f6f\u96c5\u9ed1)",
                },
                {
                    "name": "Microsoft JhengHei, sans-serif",
                    "label": "Microsoft JhengHei (\u5fae\u8edf\u6b63\u9ed1\u9ad4)",
                },
                {
                    "name": "Meiryo, sans-serif",
                    "label": "Meiryo (\u30e1\u30a4\u30ea\u30aa)",
                },
                {"name": "MS PGothic, sans-serif", "label": "MS PGothic"},
                {"name": "SimHei, sans-serif", "label": "SimHei (\u9ed1\u4f53)"},
                {"name": "sans-serif", "label": "System Default"},
            ]
        else:
            fonts = [
                {"name": "Noto Sans CJK SC, sans-serif", "label": "Noto Sans CJK SC"},
                {
                    "name": "WenQuanYi Micro Hei, sans-serif",
                    "label": "WenQuanYi Micro Hei",
                },
                {"name": "Noto Sans CJK JP, sans-serif", "label": "Noto Sans CJK JP"},
                {"name": "sans-serif", "label": "System Default"},
            ]
        return {"fonts": fonts}
