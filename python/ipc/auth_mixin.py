"""Authentication and favourites mixin for IPCServer."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .types import _get_config_path

if TYPE_CHECKING:
    from config import Config
    from downloader import ComicDownloader
    from parser import MultiSourceParser

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

        cookie, user_agent, bearer_token = extract_auth_from_curl(curl_text.strip())
        self.config.set_source_auth(source, cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)
        self.config.save(_get_config_path())

        self.parser.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token, source=source)

        if source == "hcomic":
            self.downloader.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)

        logger.info("Auth applied for %s: cookie length=%d, ua length=%d, bearer length=%d", source, len(cookie), len(user_agent), len(bearer_token))
        return {"success": True}

    def handle_verify_auth(self, source: str = "hcomic") -> dict:
        is_valid, message = self.parser.verify_login_status(source=source)
        return {"valid": is_valid, "message": message}
