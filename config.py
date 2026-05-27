"""配置管理模块"""
import json
import logging
import os
from pathlib import Path
from dataclasses import dataclass, field, fields as dc_fields
from typing import Optional

from utils import normalize_source_auth

logger = logging.getLogger(__name__)


@dataclass
class Config:
    """应用配置"""
    CONCURRENT_RANGE = (1, 10)
    TIMEOUT_RANGE = (5, 300)
    RETRY_RANGE = (0, 10)

    download_dir: str = field(default_factory=lambda: str(Path.home() / "Downloads" / "hcomic"))
    concurrent_downloads: int = 4
    timeout: int = 30
    retry_times: int = 3
    cbz_filename_template: str = "{author}-{title}.cbz"
    # 输出格式: folder | zip | cbz
    output_format: str = "cbz"
    # 字体配置（空字符串表示自动检测）
    font_name: str = ""  # 留空则自动选择最佳中文字体
    font_size: int = 12  # 基础字体大小
    # 预览图设置
    show_preview: bool = False  # 是否显示封面预览图（默认不显示）
    # 登录配置
    auth_cookie: str = ""  # 从 curl 提取的 Cookie
    auth_user_agent: str = ""  # 从 curl 提取的 User-Agent
    # 默认来源
    default_source: str = "hcomic"  # "hcomic" | "moeimg"
    # 多来源认证信息
    source_auth: dict[str, dict[str, str]] = field(default_factory=dict)
    # 批量下载延迟（秒）
    batch_download_delay: int = 1  # 每本漫画下载间隔，默认1秒
    # 主题模式
    theme_mode: str = "auto"  # "auto" | "light" | "dark"
    # 自动重试配置
    auto_retry_max_attempts: int = 2  # 下载失败时自动重试次数（0-5，0表示禁用）
    # 通知配置
    notify_on_complete: bool = True  # 是否发送系统通知
    notify_when_foreground: str = "inactive"  # "inactive" | "always"
    sfw_mode: bool = True  # SFW 模式：开启后将所有漫画封面替换为占位符（默认开启）
    tag_blacklist: dict[str, list[str]] = field(default_factory=lambda: {"hcomic": [], "moeimg": []})
    # 预览页面缓存大小上限（MB）
    preview_cache_size_limit_mb: int = 500

    def __post_init__(self):
        self.source_auth = self._normalize_source_auth(self.source_auth)
        if self.default_source not in ("hcomic", "moeimg"):
            self.default_source = "hcomic"
        # 验证输出格式
        if self.output_format not in ("folder", "zip", "cbz"):
            self.output_format = "cbz"
        # 归一化主题模式
        if self.theme_mode not in ("auto", "light", "dark"):
            self.theme_mode = "auto"
        hcomic_auth = self.get_source_auth("hcomic")
        if (
            not hcomic_auth.get("cookie")
            and not hcomic_auth.get("user_agent")
            and (self.auth_cookie or self.auth_user_agent)
        ):
            # 旧字段迁移：auth_cookie/auth_user_agent → source_auth["hcomic"]
            self.set_source_auth("hcomic", self.auth_cookie, self.auth_user_agent)
            self.auth_cookie = ""
            self.auth_user_agent = ""
            hcomic_auth = self.get_source_auth("hcomic")
        # 保持 auth_cookie/auth_user_agent 与 source_auth["hcomic"] 同步
        self.auth_cookie = hcomic_auth.get("cookie", "")
        self.auth_user_agent = hcomic_auth.get("user_agent", "")

        try:
            lo, hi = self.CONCURRENT_RANGE
            self.concurrent_downloads = max(lo, min(hi, int(self.concurrent_downloads)))
        except (ValueError, TypeError):
            self.concurrent_downloads = 4
        try:
            lo, hi = self.TIMEOUT_RANGE
            self.timeout = max(lo, min(hi, int(self.timeout)))
        except (ValueError, TypeError):
            self.timeout = 30
        try:
            lo, hi = self.RETRY_RANGE
            self.retry_times = max(lo, min(hi, int(self.retry_times)))
        except (ValueError, TypeError):
            self.retry_times = 3
        # 验证缓存上限范围
        try:
            self.preview_cache_size_limit_mb = max(100, min(2048, int(self.preview_cache_size_limit_mb)))
        except (ValueError, TypeError):
            self.preview_cache_size_limit_mb = 500

    @staticmethod
    def _normalize_source_auth(source_auth: dict | None) -> dict[str, dict[str, str]]:
        return normalize_source_auth(source_auth)

    def get_source_auth(self, source: str) -> dict[str, str]:
        """获取来源认证信息。"""
        auth = self.source_auth.get(source)
        if not isinstance(auth, dict):
            auth = {"cookie": "", "user_agent": ""}
            self.source_auth[source] = auth
        auth.setdefault("cookie", "")
        auth.setdefault("user_agent", "")
        auth.setdefault("bearer_token", "")
        return auth

    def set_source_auth(self, source: str, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        """设置来源认证信息。"""
        self.source_auth[source] = {
            "cookie": (cookie or "").strip(),
            "user_agent": (user_agent or "").strip(),
            "bearer_token": (bearer_token or "").strip(),
        }
        if source == "hcomic":
            self.auth_cookie = self.source_auth[source]["cookie"]
            self.auth_user_agent = self.source_auth[source]["user_agent"]

    @classmethod
    def load(cls, config_path: Optional[str] = None) -> "Config":
        """从文件加载配置，如果不存在则返回默认配置"""
        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(
                    "Config file %s is corrupted (%s); backing up and using defaults",
                    config_path, e,
                )
                try:
                    backup_path = config_path + ".corrupted"
                    if os.path.exists(backup_path):
                        idx = 1
                        # 最多尝试 1000 个序号，防止极端情况下磁盘被大量损坏配置占满
                        while os.path.exists(f"{backup_path}.{idx}"):
                            idx += 1
                            if idx > 1000:
                                import tempfile
                                fd, backup_path = tempfile.mkstemp(
                                    dir=os.path.dirname(config_path),
                                    prefix=".config_corrupted_",
                                    suffix=".json",
                                )
                                os.close(fd)
                                break
                        else:
                            backup_path = f"{backup_path}.{idx}"
                    os.replace(config_path, backup_path)
                    logger.info("Corrupted config backed up to %s", backup_path)
                except OSError:
                    pass
                return cls()
            if not isinstance(data, dict):
                return cls()
            # 迁移旧配置：auth_cookie/auth_user_agent -> source_auth.hcomic
            data.setdefault("source_auth", {})
            hcomic_auth = data["source_auth"].setdefault("hcomic", {"cookie": "", "user_agent": ""})
            data["source_auth"].setdefault("moeimg", {"cookie": "", "user_agent": ""})
            # 如果旧的顶层字段有值而 hcomic 条目缺失，则填充之
            old_cookie = str(data.get("auth_cookie", "") or "").strip()
            old_ua = str(data.get("auth_user_agent", "") or "").strip()
            if old_cookie and not hcomic_auth.get("cookie"):
                hcomic_auth["cookie"] = old_cookie
            if old_ua and not hcomic_auth.get("user_agent"):
                hcomic_auth["user_agent"] = old_ua
            if "default_source" not in data:
                data["default_source"] = "hcomic"
            # 兼容旧配置：通知配置
            if "notify_when_foreground" not in data:
                data["notify_when_foreground"] = "inactive"
            # 只保留 Config 已知字段，忽略未知 key
            known_fields = {f.name for f in dc_fields(cls)}
            unknown = [k for k in data if k not in known_fields]
            if unknown:
                logger.warning("Ignoring unknown config keys in %s: %s", config_path, unknown)
            data = {k: v for k, v in data.items() if k in known_fields}
            return cls(**data)
        return cls()

    def save(self, config_path: str):
        """保存配置到文件"""
        import sys
        import tempfile
        from dataclasses import asdict

        # 兼容旧字段，保持为 hcomic 认证
        hcomic_auth = self.get_source_auth("hcomic")
        self.auth_cookie = hcomic_auth.get("cookie", "")
        self.auth_user_agent = hcomic_auth.get("user_agent", "")

        os.makedirs(os.path.dirname(config_path), exist_ok=True)

        # 先写临时文件，再原子替换
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=os.path.dirname(config_path),
            prefix=".config_tmp_",
            suffix=".json",
        )
        try:
            with os.fdopen(tmp_fd, 'w', encoding='utf-8') as f:
                json.dump(asdict(self), f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, config_path)
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

        if sys.platform != 'win32':
            os.chmod(config_path, 0o600)
        else:
            _restrict_file_permissions_win32(config_path)


def _restrict_file_permissions_win32(filepath: str) -> None:
    """Restrict file access to the current user on Windows.

    Uses icacls to remove inherited permissions and grant only
    the current user read+write access. Errors are non-fatal.
    """
    import subprocess
    try:
        username = os.environ.get('USERNAME', os.environ.get('USER', 'CURRENT'))
        result = subprocess.run(
            [
                "icacls", filepath,
                "/inheritance:r",
                "/grant", f"{username}:(R,W)",
            ],
            capture_output=True,
            check=False,
            timeout=5,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode('utf-8', errors='replace').strip() if result.stderr else ""
            logger.warning(
                "Failed to restrict file permissions for %s (exit code %d): %s",
                filepath, result.returncode, stderr,
            )
    except FileNotFoundError:
        logger.warning("icacls not found on PATH; cannot restrict file permissions for %s", filepath)
    except subprocess.TimeoutExpired:
        logger.warning("icacls timed out while restricting permissions for %s", filepath)
    except Exception as e:
        logger.warning("Unexpected error restricting file permissions for %s: %s", filepath, e)
