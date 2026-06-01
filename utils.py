"""工具函数模块"""

import os
import re
from typing import Any
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
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    # 移除首尾空格和点
    name = name.strip(" .")
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


def get_system_proxies() -> dict[str, str]:
    """获取系统代理配置（跨平台）。

    基于 urllib 的 getproxies()，可从环境变量和系统代理设置中提取代理。
    """
    raw = getproxies() or {}
    proxies: dict[str, str] = {}

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


def apply_system_proxy_to_session(session: Any) -> dict[str, str]:
    """将系统代理配置注入 requests.Session。"""
    proxies = get_system_proxies()
    # 保留 requests 默认行为（包括 NO_PROXY 等环境规则）
    if hasattr(session, "trust_env"):
        session.trust_env = True
    if proxies and hasattr(session, "proxies"):
        session.proxies.update(proxies)
    return proxies


def sanitize_path_chars(name: str) -> str:
    """替换路径中的非法字符（不截断长度、不移除控制字符）。

    用于需要替换非法字符但不需要完整 sanitize_filename 行为的场景。
    """
    if not name:
        return "unknown"
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)


def normalize_source_auth(source_auth: dict | None) -> dict[str, dict[str, str]]:
    """规范化多来源认证字典。

    Args:
        source_auth: 原始来源认证字典，可能为 None 或包含部分条目

    Returns:
        规范化的认证字典，至少包含 hcomic、moeimg 和 jmcomic 的默认条目
    """
    normalized: dict[str, dict[str, str]] = {
        "hcomic": {"cookie": "", "user_agent": "", "bearer_token": ""},
        "moeimg": {"cookie": "", "user_agent": "", "bearer_token": ""},
        "jmcomic": {"cookie": "", "user_agent": "", "bearer_token": ""},
    }
    if not isinstance(source_auth, dict):
        return normalized
    for source, auth in source_auth.items():
        if source not in normalized or not isinstance(auth, dict):
            continue
        normalized[source]["cookie"] = str(auth.get("cookie", "") or "").strip()
        normalized[source]["user_agent"] = str(
            auth.get("user_agent", auth.get("ua", "")) or ""
        ).strip()
        normalized[source]["bearer_token"] = str(
            auth.get("bearer_token", "") or ""
        ).strip()
    return normalized


def configure_session_auth(
    session: Any,
    default_headers: dict,
    cookie: str = "",
    user_agent: str = "",
    bearer_token: str = "",
):
    """配置 requests.Session 的认证请求头。

    Args:
        session: requests.Session 实例
        default_headers: 默认请求头字典（含默认 User-Agent）
        cookie: Cookie 字符串
        user_agent: User-Agent 字符串
        bearer_token: Bearer token 字符串
    """
    ua = (user_agent or "").strip()
    ck = (cookie or "").strip()
    bt = (bearer_token or "").strip()

    session.headers["User-Agent"] = ua or default_headers.get("User-Agent", "")
    if ck:
        session.headers["Cookie"] = ck
    else:
        session.headers.pop("Cookie", None)
    if bt:
        session.headers["Authorization"] = f"Bearer {bt}"
    else:
        session.headers.pop("Authorization", None)
