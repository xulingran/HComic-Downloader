"""工具函数模块"""
import os
import re
from typing import Any, Dict, List
from urllib.request import getproxies


def sanitize_filename(name: str) -> str:
    """清理文件名中的非法字符

    Args:
        name: 原始文件名

    Returns:
        清理后的文件名
    """
    if not name:
        return "unknown"
    # Windows 非法字符: < > : " / \ | ? *
    # 同时移除控制字符
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)
    # 移除首尾空格和点
    name = name.strip(' .')
    # 限制长度
    if len(name) > 200:
        name = name[:200]
    # 如果为空，返回默认值
    if not name:
        return "unknown"
    return name


def ensure_dir(path: str):
    """确保目录存在

    Args:
        path: 目录路径
    """
    os.makedirs(path, exist_ok=True)


def format_file_size(size: int) -> str:
    """格式化文件大小

    Args:
        size: 字节数

    Returns:
        格式化后的字符串 (如: 1.5 MB)
    """
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    else:
        return f"{size / (1024 * 1024 * 1024):.1f} GB"


def format_tags(tags: List[str]) -> str:
    """格式化标签列表为逗号分隔的字符串

    Args:
        tags: 标签列表

    Returns:
        逗号分隔的标签字符串
    """
    if not tags:
        return ""
    return ", ".join(str(tag) for tag in tags if tag)


def get_system_proxies() -> Dict[str, str]:
    """获取系统代理配置（跨平台）。

    基于 urllib 的 getproxies()，可从环境变量和系统代理设置中提取代理。
    """
    raw = getproxies() or {}
    proxies: Dict[str, str] = {}

    def _normalize_proxy_url(url: str) -> str:
        value = (url or "").strip()
        if not value:
            return ""
        if "://" not in value:
            # requests 代理 URL 需要 scheme
            return f"http://{value}"
        return value

    for key, value in raw.items():
        lower_key = str(key).lower().strip()
        proxy_url = _normalize_proxy_url(str(value))
        if not proxy_url:
            continue

        if lower_key in ("http", "http_proxy"):
            proxies["http"] = proxy_url
        elif lower_key in ("https", "https_proxy"):
            proxies["https"] = proxy_url
        elif lower_key in ("all", "all_proxy"):
            proxies.setdefault("http", proxy_url)
            proxies.setdefault("https", proxy_url)

    return proxies


def apply_system_proxy_to_session(session: Any) -> Dict[str, str]:
    """将系统代理配置注入 requests.Session。"""
    proxies = get_system_proxies()
    # 保留 requests 默认行为（包括 NO_PROXY 等环境规则）
    if hasattr(session, "trust_env"):
        session.trust_env = True
    if proxies and hasattr(session, "proxies"):
        session.proxies.update(proxies)
    return proxies


def export_system_proxies_to_env() -> Dict[str, str]:
    """将系统代理导出到环境变量（不覆盖用户已显式设置值）。"""
    proxies = get_system_proxies()
    for scheme in ("http", "https"):
        value = proxies.get(scheme)
        if not value:
            continue
        env_name = f"{scheme}_proxy"
        os.environ.setdefault(env_name, value)
        os.environ.setdefault(env_name.upper(), value)
    return proxies
