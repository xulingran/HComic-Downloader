"""Configuration management mixin for IPCServer."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from config import _default_source_list_map

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
    _config_write_lock: threading.Lock

    def _apply_download_dir_change(self, new_dir: str) -> dict | None:
        """变更下载目录时联动迁移已记录文件。

        - 新旧目录相同或旧目录为空（首次设置）→ 直接 set_output_dir（快速路径）
        - 新旧不同 → 触发 trigger_download_dir_migration，返回迁移信息 dict
          （migrationId/totalItems/skipped），落库由迁移完成回调负责，本方法不落库

        返回 None 表示快速路径（调用方正常落库）；返回 dict 表示触发了迁移
        （调用方须跳过自身落库，交给 _migration_complete_callback）。

        已有迁移进行中（含 ready 等待前端确认态）时，trigger_download_dir_migration
        会抛 RuntimeError，本方法不 catch——让其向上冒泡到 handle_set_config，
        由后者透传给前端展示"请等待当前迁移完成"。禁止退化为"只改运行时目录 +
        落库新 download_dir"的脱节路径（旧目录文件此时未迁移，会复现目录变更
        不联动的根因问题）。
        """
        import os

        old_dir = self.config.download_dir
        new_dir_normalized = os.path.normpath(os.path.realpath(new_dir))
        old_dir_normalized = os.path.normpath(os.path.realpath(old_dir)) if old_dir else ""

        # 快速路径：新旧相同、或旧目录为空（首次设置）
        if not old_dir or new_dir_normalized == old_dir_normalized:
            self._download_manager.set_output_dir(new_dir)
            return None

        # 联动迁移：落库交给迁移完成回调，此处只触发并返回信息。
        # 已有迁移进行中时此处会抛 RuntimeError，由调用方拒绝本次配置变更。
        migration_info = self.trigger_download_dir_migration(new_dir)

        if migration_info.get("skipped"):
            # 旧目录无可迁移记录，走快速路径落库
            self._download_manager.set_output_dir(new_dir)
            return None

        # 预检查发现需迁移文件：返回迁移计划供前端弹窗确认。
        # 落库责任移交给 _migration_complete_callback（用户确认并执行迁移后）。
        logger.info(
            "Download dir change pending migration confirmation: %s items %s -> %s",
            migration_info.get("totalItems"),
            old_dir,
            new_dir,
        )
        return {
            "migrationTriggered": True,
            "migrationId": migration_info["migrationId"],
            "migrationTotalItems": migration_info["totalItems"],
        }

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

    def _apply_jm_domain(self, v: str) -> None:
        """Apply jm custom domain with availability test."""
        v = v.strip()
        if v:
            # Format validation (v 已 strip 且非空，故 not v 永假，省略)
            if " " in v or "/" in v or len(v) > 256:
                raise ValueError(f"域名格式不正确: {v}")
            # Availability test
            try:
                from sources.jm.domain import JmDomainResolver

                resolver = JmDomainResolver()
                if not resolver._test_domain(v):
                    raise ValueError(f"域名 {v} 无法访问，请检查是否正确")
            except ValueError:
                raise
            except Exception as e:
                raise ValueError(f"测试域名 {v} 失败: {e}") from e
        self.parser.set_jm_domain(v)

    def _apply_runtime(self, key: str, value: Any) -> dict | None:
        """Apply a config value to the live runtime objects.

        返回值：对于触发异步迁移的配置项（downloadDir），返回迁移信息 dict
        供 handle_set_config 透传给前端；其他配置项返回 None。
        """
        _RUNTIME_APPLIERS = {
            "downloadDir": self._apply_download_dir_change,
            "outputFormat": lambda v: self._download_manager.set_output_format(v),
            "batchDownloadDelay": lambda v: self._download_manager.set_delay_after(v),
            "autoRetryMaxAttempts": lambda v: self._download_manager.set_auto_retry_max_attempts(v),
            "concurrentDownloads": self._apply_concurrent_downloads,
            "timeout": self._apply_timeout,
            "retryTimes": self._apply_retry_times,
            "cbzFilenameTemplate": lambda v: setattr(self.cbz_builder, "filename_template", v),
            "defaultSource": lambda v: self.parser.set_source(v),
            "jmDomain": self._apply_jm_domain,
            "bikaImageQuality": lambda v: (
                self.parser.parsers["bika"].set_image_quality(v)
                if hasattr(self.parser.parsers.get("bika"), "set_image_quality")
                else None
            ),
            "previewCacheSizeLimitMB": lambda v: (
                (self._preview_cache.update_max_size(v) if hasattr(self, "_preview_cache") else None),
                (self._cover_cache.update_max_size(v) if hasattr(self, "_cover_cache") else None),
            ),
        }
        applier = _RUNTIME_APPLIERS.get(key)
        if applier:
            return applier(value)
        return None

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
            "default_favourite_source": getattr(self.config, "default_favourite_source", ""),
            "font_name": getattr(self.config, "font_name", ""),
            "font_size": getattr(self.config, "font_size", 14),
            "sfw_mode": getattr(self.config, "sfw_mode", True),
            "card_style": getattr(self.config, "card_style", "cover"),
            "tag_blacklist": getattr(self.config, "tag_blacklist", {"hcomic": [], "moeimg": []}),
            "my_tags": getattr(self.config, "my_tags", _default_source_list_map()),
            "duplicate_blacklist": getattr(self.config, "duplicate_blacklist", {"hcomic": [], "moeimg": [], "jm": []}),
            # 与 duplicate_blacklist 同构但独立存储：查缺补漏的忽略黑名单。
            # 读路径必须返回，否则前端 useInitConfig 拿不到值，重启后忽略列表全部丢失。
            "missing_blacklist": getattr(self.config, "missing_blacklist", {"hcomic": [], "moeimg": [], "jm": []}),
            "preview_cache_size_limit_mb": getattr(self.config, "preview_cache_size_limit_mb", 500),
            "jm_domain": getattr(self.config, "jm_domain", ""),
            "favourite_tag_highlight": getattr(self.config, "favourite_tag_highlight", False),
            "favourite_tag_min_matches": getattr(self.config, "favourite_tag_min_matches", 1),
            "check_update_on_start": getattr(self.config, "check_update_on_start", True),
            "bika_image_quality": getattr(self.config, "bika_image_quality", "original"),
            "preview_preload_forward": getattr(self.config, "preview_preload_forward", 8),
            "preview_preload_backward": getattr(self.config, "preview_preload_backward", 2),
            "preview_preload_concurrency": getattr(self.config, "preview_preload_concurrency", 3),
            "preview_preload_adaptive": getattr(self.config, "preview_preload_adaptive", False),
        }
        config = {}
        for snake_key, value in raw.items():
            camel_key = reverse_map.get(snake_key, snake_key)
            config[camel_key] = value
        hcomic_auth = self.config.source_auth.get("hcomic", {})
        config["hasAuth"] = bool(hcomic_auth.get("cookie") or hcomic_auth.get("bearer_token"))
        config["hcomicUsername"] = hcomic_auth.get("username", "")
        config["hcomicPassword"] = hcomic_auth.get("password", "")
        # JM 鉴权走运行期凭据（jm-session-cookie spec）：不读持久化 source_auth，
        # 反映本次进程内是否已通过登录窗口获取 cookie。
        config["hasJmAuth"] = bool(self.parser.get_runtime_auth("jm")[0])
        config["hasMoeimgAuth"] = bool(self.config.source_auth.get("moeimg", {}).get("cookie"))
        config["moeimgUsername"] = self.config.source_auth.get("moeimg", {}).get("username", "")
        config["moeimgPassword"] = self.config.source_auth.get("moeimg", {}).get("password", "")
        bika_auth = self.config.source_auth.get("bika", {})
        config["hasBikaAuth"] = bool(
            bika_auth.get("bearer_token") or (bika_auth.get("username") and bika_auth.get("password"))
        )
        config["bikaUsername"] = self.config.source_auth.get("bika", {}).get("username", "")
        config["bikaPassword"] = bika_auth.get("password", "")
        config["hasCopymangaAuth"] = bool(self.config.source_auth.get("copymanga", {}).get("cookie"))
        # NH 收敛为仅 API Key（remove-nh-password-login spec）：hasNhAuth 仅由有效
        # bearer_token（纯 API Key）决定，禁止回显完整 Key 或账号密码字段。
        nh_auth = self.config.source_auth.get("nh", {})
        config["hasNhAuth"] = bool(nh_auth.get("bearer_token"))
        # 返回 jm CDN 域名，供前端动态更新白名单
        jm_cdn = self.parser.get_jm_cdn_domain()
        if jm_cdn:
            config["jmCdnDomain"] = jm_cdn
        return {"config": config}

    def handle_set_config(self, key: str, value: Any) -> dict:
        python_key = CONFIG_KEY_MAP.get(key)
        if not python_key:
            raise ValueError(f"Unknown config key: {key}")
        if not hasattr(self.config, python_key):
            raise ValueError(f"Unknown config key: {key}")

        old_value = getattr(self.config, python_key)

        migration_info = None
        try:
            # _apply_runtime 返回迁移信息 dict（仅 downloadDir 变更且需迁移时），否则 None
            migration_info = self._apply_runtime(key, value)
        except Exception as e:
            logger.error("Set config runtime error for %s: %s", key, e)
            raise

        # 若触发了下载目录迁移，落库责任移交给 _migration_complete_callback，
        # 此处跳过 config.save（迁移成功后回调中统一落库 download_dir）。
        if migration_info and migration_info.get("migrationTriggered"):
            return {"success": True, **migration_info}

        try:
            # 序列化 config 写入：并发 set_config 同时 os.replace 会触发 WinError 5
            with self._config_write_lock:
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

    def handle_get_jm_domains(self) -> dict:
        """从发布页获取 jm 可用域名列表，供设置页展示。"""
        try:
            from sources.jm.domain import get_jm_domain_list

            domains = get_jm_domain_list()
            return {"domains": domains}
        except Exception as e:
            logger.error("Get jm domains error: %s", e)
            return {"domains": ["18comic.vip"]}

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
