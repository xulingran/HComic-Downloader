"""配置管理模块"""

import json
import logging
import os
from dataclasses import dataclass, field
from dataclasses import fields as dc_fields
from pathlib import Path

from utils import normalize_source_auth, normalize_source_key

logger = logging.getLogger(__name__)

DEFAULT_OUTPUT_FORMAT = "folder"
VALID_SOURCE_KEYS = ("hcomic", "moeimg", "jm", "bika", "copymanga")


def _default_source_list_map() -> dict[str, list]:
    return {source: [] for source in VALID_SOURCE_KEYS}


def _migrate_blacklist_entries(entries: list) -> list[dict]:
    migrated = []
    for entry in entries:
        if isinstance(entry, str):
            migrated.append({"fingerprint": entry, "memberCount": None})
        elif isinstance(entry, dict) and "fingerprint" in entry:
            migrated.append(
                {
                    "fingerprint": str(entry["fingerprint"]),
                    "memberCount": entry.get("memberCount"),
                }
            )
    return migrated


def _normalize_source_list_map(value: dict | None, *, structured_entries: bool = False) -> dict[str, list]:
    normalized = _default_source_list_map()
    if not isinstance(value, dict):
        return normalized
    for raw_source, entries in value.items():
        source = normalize_source_key(raw_source)
        if source not in normalized or not isinstance(entries, list):
            continue
        migrated_entries = _migrate_blacklist_entries(entries) if structured_entries else list(entries)
        normalized[source].extend(migrated_entries)
    return normalized


@dataclass
class AuthSourceData:
    """认证来源数据。"""

    cookie: str = ""
    user_agent: str = ""
    bearer_token: str = ""
    username: str = ""
    password: str = ""


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
    output_format: str = DEFAULT_OUTPUT_FORMAT
    # 字体配置（空字符串表示自动检测）
    font_name: str = ""  # 留空则自动选择最佳中文字体
    font_size: int = 12  # 基础字体大小
    # 登录配置
    auth_cookie: str = ""  # 从 curl 提取的 Cookie
    auth_user_agent: str = ""  # 从 curl 提取的 User-Agent
    # 默认来源
    default_source: str = "hcomic"
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
    card_style: str = "cover"  # 卡片样式："cover"（封面+标题）| "detailed"（详细列表）
    tag_blacklist: dict[str, list[str]] = field(default_factory=_default_source_list_map)
    # 重复检测已忽略的组（按来源隔离，每项为 {fingerprint, memberCount}）
    duplicate_blacklist: dict[str, list[dict]] = field(default_factory=_default_source_list_map)
    # 查缺补漏已忽略的组（按来源隔离，每项为 {fingerprint, memberCount}）
    # 与 duplicate_blacklist 同构但独立存储，两个功能的忽略状态互不影响
    missing_blacklist: dict[str, list[dict]] = field(default_factory=_default_source_list_map)
    # jm 自定义域名（空字符串表示自动选择）
    jm_domain: str = ""
    # 预览页面缓存大小上限（MB）
    preview_cache_size_limit_mb: int = 500
    # 推荐标签高亮开关
    favourite_tag_highlight: bool = False
    # 推荐标签最少命中数
    favourite_tag_min_matches: int = 1
    # 启动时检查更新
    check_update_on_start: bool = True
    # Bika 图片清晰度（预览用，下载始终使用 original）
    bika_image_quality: str = "original"  # "low" | "medium" | "high" | "original"
    # 预览预加载页数：阅读器在当前页前后提前拉取的图片数量
    preview_preload_forward: int = 8  # 向前（当前页之后）预加载页数，0 表示禁用
    preview_preload_backward: int = 2  # 向后（当前页之前）预加载页数
    preview_preload_concurrency: int = 3  # 预加载并发 worker 数
    # 预览自适应预加载开关：开启后按翻页速度动态调节预加载量
    preview_preload_adaptive: bool = False

    def __post_init__(self):
        self.source_auth = self._normalize_source_auth(self.source_auth)
        self.default_source = normalize_source_key(self.default_source)
        if self.default_source not in VALID_SOURCE_KEYS:
            self.default_source = "hcomic"
        self.tag_blacklist = _normalize_source_list_map(self.tag_blacklist)
        self.duplicate_blacklist = _normalize_source_list_map(self.duplicate_blacklist, structured_entries=True)
        self.missing_blacklist = _normalize_source_list_map(self.missing_blacklist, structured_entries=True)
        # 验证输出格式
        if self.output_format not in ("folder", "zip", "cbz"):
            self.output_format = DEFAULT_OUTPUT_FORMAT
        # 归一化主题模式
        if self.theme_mode not in ("auto", "light", "dark"):
            self.theme_mode = "auto"
        self._sync_legacy_fields()
        self._validate_ranges()
        if self.bika_image_quality not in ("low", "medium", "high", "original"):
            self.bika_image_quality = "original"

    def _sync_legacy_fields(self):
        """将 source_auth["hcomic"] 与旧版 auth_cookie/auth_user_agent 保持同步。

        如果旧字段有值但 source_auth["hcomic"] 为空（直接构造 Config 的场景），
        则将旧字段迁移到 source_auth。否则以 source_auth 为准回写到旧字段。
        Config.load 中也有类似逻辑，但直接构造 Config 时不会经过 load。
        """
        hcomic_auth = self.get_source_auth("hcomic")
        if (
            not hcomic_auth.get("cookie")
            and not hcomic_auth.get("user_agent")
            and (self.auth_cookie or self.auth_user_agent)
        ):
            self.set_source_auth(
                "hcomic",
                AuthSourceData(
                    cookie=self.auth_cookie,
                    user_agent=self.auth_user_agent,
                    username=hcomic_auth.get("username", ""),
                    password=hcomic_auth.get("password", ""),
                ),
            )
        else:
            # 以 source_auth 为准回写到旧字段
            self.auth_cookie = hcomic_auth.get("cookie", "")
            self.auth_user_agent = hcomic_auth.get("user_agent", "")

    def _validate_ranges(self):
        for attr, lo, hi, default in [
            ("concurrent_downloads", *self.CONCURRENT_RANGE, 4),
            ("timeout", *self.TIMEOUT_RANGE, 30),
            ("retry_times", *self.RETRY_RANGE, 3),
            ("preview_cache_size_limit_mb", 100, 2048, 500),
            ("preview_preload_forward", 0, 30, 8),
            ("preview_preload_backward", 0, 10, 2),
            ("preview_preload_concurrency", 1, 6, 3),
        ]:
            try:
                setattr(self, attr, max(lo, min(hi, int(getattr(self, attr)))))
            except (ValueError, TypeError):
                setattr(self, attr, default)

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
        if source in ("moeimg", "bika", "hcomic"):
            auth.setdefault("username", "")
            auth.setdefault("password", "")
        return auth

    def set_source_auth(
        self,
        source: str,
        data: AuthSourceData,
    ):
        """设置来源认证信息。"""
        cookie = (data.cookie or "").strip()
        user_agent = (data.user_agent or "").strip()
        bearer_token = (data.bearer_token or "").strip()
        self.source_auth[source] = {
            "cookie": cookie,
            "user_agent": user_agent,
            "bearer_token": bearer_token,
        }
        if source in ("moeimg", "bika", "hcomic"):
            self.source_auth[source]["username"] = (data.username or "").strip()
            self.source_auth[source]["password"] = (data.password or "").strip()
        if source == "hcomic":
            self.auth_cookie = cookie
            self.auth_user_agent = user_agent

    @classmethod
    def load(cls, config_path: str | None = None) -> "Config":
        """从文件加载配置，如果不存在则返回默认配置"""
        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(
                    "Config file %s is corrupted (%s); backing up and using defaults",
                    config_path,
                    e,
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
            # 迁移 duplicate_blacklist / missing_blacklist：旧版纯字符串列表 -> 结构化对象列表，旧来源 jmcomic -> jm
            data["tag_blacklist"] = _normalize_source_list_map(data.get("tag_blacklist"))
            data["duplicate_blacklist"] = _normalize_source_list_map(
                data.get("duplicate_blacklist"), structured_entries=True
            )
            data["missing_blacklist"] = _normalize_source_list_map(data.get("missing_blacklist"), structured_entries=True)
            # 迁移旧配置：jmcomic_domain -> jm_domain（旧键名本身保留为向后兼容）
            if "jmcomic_domain" in data and "jm_domain" not in data:
                data["jm_domain"] = data.pop("jmcomic_domain")
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
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                json.dump(asdict(self), f, ensure_ascii=False, indent=2)
            try:
                os.replace(tmp_path, config_path)
            except PermissionError:
                # Windows: 之前 _restrict_file_permissions_win32 可能限制了 DELETE 权限，
                # 尝试重置权限后重试
                if sys.platform == "win32" and os.path.exists(config_path):
                    _fix_win32_file_permissions(config_path)
                    os.replace(tmp_path, config_path)
                else:
                    raise
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

        if sys.platform != "win32":
            os.chmod(config_path, 0o600)
        else:
            _restrict_file_permissions_win32(config_path)


def _fix_win32_file_permissions(filepath: str) -> None:
    """Re-grant Modify permission on a Windows file so os.replace can succeed.

    Called as a fallback when os.replace fails with PermissionError, typically
    because a previous save used overly restrictive ACLs.
    """
    import subprocess

    try:
        username = os.environ.get("USERNAME", os.environ.get("USER", "CURRENT"))
        subprocess.run(
            ["icacls", filepath, "/grant", f"{username}:(M)"],
            capture_output=True,
            check=False,
            timeout=5,
        )
    except Exception:
        pass  # best-effort; caller will retry os.replace


def _restrict_file_permissions_win32(filepath: str) -> None:
    """Restrict file access to the current user on Windows.

    Uses icacls to remove inherited permissions and grant only
    the current user Modify access (includes Delete for os.replace).
    Errors are non-fatal.
    """
    import subprocess

    try:
        username = os.environ.get("USERNAME", os.environ.get("USER", "CURRENT"))
        result = subprocess.run(
            [
                "icacls",
                filepath,
                "/inheritance:r",
                "/grant",
                f"{username}:(M)",
            ],
            capture_output=True,
            check=False,
            timeout=5,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip() if result.stderr else ""
            logger.warning(
                "Failed to restrict file permissions for %s (exit code %d): %s",
                filepath,
                result.returncode,
                stderr,
            )
    except FileNotFoundError:
        logger.warning(
            "icacls not found on PATH; cannot restrict file permissions for %s",
            filepath,
        )
    except subprocess.TimeoutExpired:
        logger.warning("icacls timed out while restricting permissions for %s", filepath)
    except Exception as e:
        logger.warning("Unexpected error restricting file permissions for %s: %s", filepath, e)
