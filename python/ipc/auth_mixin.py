"""Authentication and favourites mixin for IPCServer."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .types import _get_config_path

if TYPE_CHECKING:
    from config import Config
    from downloader import ComicDownloader
    from sources import MultiSourceParser

logger = logging.getLogger(__name__)


class AuthMixin:
    """Mixin providing authentication handler methods."""

    config: Config
    parser: MultiSourceParser
    downloader: ComicDownloader

    def handle_apply_auth(self, curl_text: str, source: str = "hcomic") -> dict:
        if not curl_text or not curl_text.strip():
            raise ValueError("\u8bf7\u7c98\u8d34 curl \u547d\u4ee4")

        from auth_parser import extract_auth_from_curl

        cookie, user_agent, bearer_token, domain = extract_auth_from_curl(
            curl_text.strip()
        )
        self.config.set_source_auth(
            source, cookie=cookie, user_agent=user_agent, bearer_token=bearer_token
        )
        self.config.save(_get_config_path())

        self.parser.configure_auth(
            cookie=cookie,
            user_agent=user_agent,
            bearer_token=bearer_token,
            source=source,
        )

        # jmcomic 使用多镜像域名，必须将 parser 域名锁定为登录时获取 cookie 的域名，
        # 否则 JmDomainResolver 自动解析可能返回不同域名，导致 cookie 不匹配。
        if source == "jmcomic" and domain:
            self.parser.set_jmcomic_domain(domain)

        if source == "hcomic":
            self.downloader.configure_auth(
                cookie=cookie, user_agent=user_agent, bearer_token=bearer_token
            )

        logger.info(
            "Auth applied for %s: cookie length=%d, ua length=%d, bearer length=%d",
            source,
            len(cookie),
            len(user_agent),
            len(bearer_token),
        )
        return {"success": True}

    def handle_verify_auth(self, source: str = "hcomic") -> dict:
        is_valid, message = self.parser.verify_login_status(source=source)
        return {"valid": is_valid, "message": message}

    def handle_moeimg_login(self, username: str, password: str) -> dict:
        if not username or not username.strip():
            raise ValueError("请输入用户名")
        if not password or not password.strip():
            raise ValueError("请输入密码")
        username = username.strip()
        password = password.strip()
        moeimg_parser = self.parser.parsers.get("moeimg")
        if not moeimg_parser:
            raise ValueError("moeimg 来源不可用")
        cookie = moeimg_parser.login(username, password)
        self.config.set_source_auth(
            "moeimg", cookie=cookie, username=username, password=password
        )
        self.config.save(_get_config_path())
        self.parser.configure_auth(cookie=cookie, source="moeimg")
        moeimg_parser.set_stored_credentials(username, password)
        logger.info("moeimg login successful for user %s", username)
        return {"success": True, "message": "登录成功"}
