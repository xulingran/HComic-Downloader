"""配置管理模块"""
import os
from pathlib import Path
from dataclasses import dataclass, field


@dataclass
class Config:
    """应用配置"""
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

    def __post_init__(self):
        """确保下载目录存在"""
        os.makedirs(self.download_dir, exist_ok=True)
        self.source_auth = self._normalize_source_auth(self.source_auth)
        if self.default_source not in ("hcomic", "moeimg"):
            self.default_source = "hcomic"
        # 验证输出格式
        if self.output_format not in ("folder", "zip", "cbz"):
            self.output_format = "cbz"
        hcomic_auth = self.get_source_auth("hcomic")
        if (
            not hcomic_auth.get("cookie")
            and not hcomic_auth.get("user_agent")
            and (self.auth_cookie or self.auth_user_agent)
        ):
            self.set_source_auth("hcomic", self.auth_cookie, self.auth_user_agent)
            hcomic_auth = self.get_source_auth("hcomic")
        # 兼容旧字段，始终保持与 hcomic 同步
        self.auth_cookie = hcomic_auth.get("cookie", "")
        self.auth_user_agent = hcomic_auth.get("user_agent", "")

    @staticmethod
    def _normalize_source_auth(source_auth: dict | None) -> dict[str, dict[str, str]]:
        normalized: dict[str, dict[str, str]] = {}
        if isinstance(source_auth, dict):
            for source, auth in source_auth.items():
                if not isinstance(source, str) or not isinstance(auth, dict):
                    continue
                cookie = str(auth.get("cookie", "") or "").strip()
                user_agent = str(auth.get("user_agent", auth.get("ua", "")) or "").strip()
                normalized[source] = {
                    "cookie": cookie,
                    "user_agent": user_agent,
                }
        normalized.setdefault("hcomic", {"cookie": "", "user_agent": ""})
        normalized.setdefault("moeimg", {"cookie": "", "user_agent": ""})
        return normalized

    def get_source_auth(self, source: str) -> dict[str, str]:
        """获取来源认证信息。"""
        auth = self.source_auth.get(source)
        if not isinstance(auth, dict):
            auth = {"cookie": "", "user_agent": ""}
            self.source_auth[source] = auth
        auth.setdefault("cookie", "")
        auth.setdefault("user_agent", "")
        return auth

    def set_source_auth(self, source: str, cookie: str = "", user_agent: str = ""):
        """设置来源认证信息。"""
        self.source_auth[source] = {
            "cookie": (cookie or "").strip(),
            "user_agent": (user_agent or "").strip(),
        }
        if source == "hcomic":
            self.auth_cookie = self.source_auth[source]["cookie"]
            self.auth_user_agent = self.source_auth[source]["user_agent"]

    @classmethod
    def load(cls, config_path: str = None) -> "Config":
        """从文件加载配置，如果不存在则返回默认配置"""
        if config_path and os.path.exists(config_path):
            import json
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return cls()
            # 迁移旧配置：auth_cookie/auth_user_agent -> source_auth.hcomic
            if "source_auth" not in data:
                data["source_auth"] = {
                    "hcomic": {
                        "cookie": str(data.get("auth_cookie", "") or "").strip(),
                        "user_agent": str(data.get("auth_user_agent", "") or "").strip(),
                    },
                    "moeimg": {
                        "cookie": "",
                        "user_agent": "",
                    },
                }
            if "default_source" not in data:
                data["default_source"] = "hcomic"
            return cls(**data)
        return cls()

    def save(self, config_path: str):
        """保存配置到文件"""
        import json
        # 兼容旧字段，保持为 hcomic 认证
        hcomic_auth = self.get_source_auth("hcomic")
        self.auth_cookie = hcomic_auth.get("cookie", "")
        self.auth_user_agent = hcomic_auth.get("user_agent", "")
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump({
                'download_dir': self.download_dir,
                'concurrent_downloads': self.concurrent_downloads,
                'timeout': self.timeout,
                'retry_times': self.retry_times,
                'cbz_filename_template': self.cbz_filename_template,
                'output_format': self.output_format,
                'font_name': self.font_name,
                'font_size': self.font_size,
                'show_preview': self.show_preview,
                'auth_cookie': self.auth_cookie,
                'auth_user_agent': self.auth_user_agent,
                'default_source': self.default_source,
                'source_auth': self.source_auth,
                'batch_download_delay': self.batch_download_delay,
                'theme_mode': self.theme_mode,
                'auto_retry_max_attempts': self.auto_retry_max_attempts,
            }, f, ensure_ascii=False, indent=2)
