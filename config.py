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
    # 字体配置（空字符串表示自动检测）
    font_name: str = ""  # 留空则自动选择最佳中文字体
    font_size: int = 12  # 基础字体大小
    # 预览图设置
    show_preview: bool = False  # 是否显示封面预览图（默认不显示）
    # 登录配置
    auth_cookie: str = ""  # 从 curl 提取的 Cookie
    auth_user_agent: str = ""  # 从 curl 提取的 User-Agent
    # 批量下载延迟（秒）
    batch_download_delay: int = 1  # 每本漫画下载间隔，默认1秒
    # 主题模式
    theme_mode: str = "auto"  # "auto" | "light" | "dark"

    def __post_init__(self):
        """确保下载目录存在"""
        os.makedirs(self.download_dir, exist_ok=True)

    @classmethod
    def load(cls, config_path: str = None) -> "Config":
        """从文件加载配置，如果不存在则返回默认配置"""
        if config_path and os.path.exists(config_path):
            import json
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return cls(**data)
        return cls()

    def save(self, config_path: str):
        """保存配置到文件"""
        import json
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump({
                'download_dir': self.download_dir,
                'concurrent_downloads': self.concurrent_downloads,
                'timeout': self.timeout,
                'retry_times': self.retry_times,
                'cbz_filename_template': self.cbz_filename_template,
                'font_name': self.font_name,
                'font_size': self.font_size,
                'show_preview': self.show_preview,
                'auth_cookie': self.auth_cookie,
                'auth_user_agent': self.auth_user_agent,
                'batch_download_delay': self.batch_download_delay,
                'theme_mode': self.theme_mode,
            }, f, ensure_ascii=False, indent=2)
