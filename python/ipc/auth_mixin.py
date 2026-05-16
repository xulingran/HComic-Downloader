"""Authentication and favourites mixin for IPCServer."""

import json
import logging
from typing import Dict

from .types import _get_config_path

logger = logging.getLogger(__name__)


class AuthMixin:
    """Mixin providing authentication handler methods."""

    def handle_apply_auth(self, curl_text: str) -> Dict:
        if not curl_text or not curl_text.strip():
            raise ValueError("\u8bf7\u7c98\u8d34 curl \u547d\u4ee4")

        from auth_parser import extract_auth_from_curl

        cookie, user_agent = extract_auth_from_curl(curl_text.strip())
        self.config.set_source_auth("hcomic", cookie=cookie, user_agent=user_agent)
        self.config.save(_get_config_path())

        self.parser.configure_auth(cookie=cookie, user_agent=user_agent, source="hcomic")
        self.downloader.configure_auth(cookie=cookie, user_agent=user_agent)

        logger.info("Auth applied: cookie length=%d, ua length=%d", len(cookie), len(user_agent))
        return {"success": True}

    def handle_verify_auth(self) -> Dict:
        is_valid, message = self.parser.verify_login_status(source="hcomic")
        return {"valid": is_valid, "message": message}
