"""Authentication and favourites mixin for IPCServer."""

from __future__ import annotations

import logging
import threading
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
    # 与 ConfigMixin 共享同一 IPCServer 实例属性，串行化所有 config.save() 临界区，
    # 避免并发 os.replace (WinError 5) 与 source_auth 字典读改写竞态。
    _config_write_lock: threading.Lock

    def _persist_credentials(self, source: str, username: str, password: str) -> None:
        """仅持久化账号密码，保留该来源已存的 cookie/user_agent/bearer_token。

        登录失败场景下用户输入的凭据也必须落盘（见 credential-persistence spec），
        因此 handler 在调用 parser.login() 之前先调用本方法。读改写 + 原子 save 必须
        在 _config_write_lock 内整体串行化；本方法不涉及任何网络请求。
        """
        from config import AuthSourceData

        existing = self.config.get_source_auth(source)
        with self._config_write_lock:
            self.config.set_source_auth(
                source,
                AuthSourceData(
                    cookie=existing.get("cookie", ""),
                    user_agent=existing.get("user_agent", ""),
                    bearer_token=existing.get("bearer_token", ""),
                    username=username,
                    password=password,
                ),
            )
            self.config.save(_get_config_path())

    def handle_apply_auth(self, curl_text: str, source: str = "hcomic", jm_username: str = "") -> dict:
        if not curl_text or not curl_text.strip():
            raise ValueError("\u8bf7\u7c08\u8d34 curl \u547d\u4ee4")

        from auth_parser import extract_auth_from_curl
        from config import AuthSourceData

        cookie, user_agent, bearer_token, domain = extract_auth_from_curl(curl_text.strip())
        # set_source_auth (字典读改写) + save (原子 os.replace) 必须作为临界区整体串行化，
        # 网络解析 (extract_auth_from_curl) 留锁外避免长事务。
        # 合并写：curl 登录不得覆盖既有 username/password（credential-persistence spec）。
        # 对 jm/copymanga 等无账号密码字段的来源，get_source_auth 不 setdefault 这两键，
        # 回填值为空串，行为与原实现一致。
        existing = self.config.get_source_auth(source)
        with self._config_write_lock:
            self.config.set_source_auth(
                source,
                AuthSourceData(
                    cookie=cookie,
                    user_agent=user_agent,
                    bearer_token=bearer_token,
                    username=existing.get("username", ""),
                    password=existing.get("password", ""),
                ),
            )
            self.config.save(_get_config_path())

        self.parser.configure_auth(
            cookie=cookie,
            user_agent=user_agent,
            bearer_token=bearer_token,
            source=source,
        )

        # jm 使用多镜像域名，必须将 parser 域名锁定为登录时获取 cookie 的域名，
        # 否则 JmDomainResolver 自动解析可能返回不同域名，导致 cookie 不匹配。
        if source == "jm" and domain:
            self.parser.set_jm_domain(domain)

        # Electron 登录窗口从 DOM 提取的用户名，直接设置到 parser。
        # 避免 Python 后端因 Cloudflare 403 无法从首页发现用户名。
        if source == "jm" and jm_username:
            jm_parser = self.parser.parsers.get("jm")
            if jm_parser and hasattr(jm_parser, "set_username"):
                jm_parser.set_username(jm_username)

        if source == "hcomic":
            self.downloader.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)

        logger.info("Auth applied for %s", source)
        return {"success": True}

    def handle_verify_auth(self, source: str = "hcomic") -> dict:
        is_valid, message = self.parser.verify_login_status(source=source)
        return {"valid": is_valid, "message": message}

    def handle_moeimg_login(self, username: str, password: str) -> dict:
        from config import AuthSourceData

        if not username or not username.strip():
            raise ValueError("请输入用户名")
        if not password or not password.strip():
            raise ValueError("请输入密码")
        username = username.strip()
        password = password.strip()
        moeimg_parser = self.parser.parsers.get("moeimg")
        if not moeimg_parser:
            raise ValueError("moeimg 来源不可用")
        # 凭据持久化解耦：登录前先把账号密码落盘 + 注入懒登录，
        # 这样网络/密码错误导致 parser.login() 抛异常时凭据仍被保留（credential-persistence spec）。
        # 失败也注入 set_stored_credentials 是预期行为：网络恢复后下次请求可自动重试登录。
        self._persist_credentials("moeimg", username, password)
        moeimg_parser.set_stored_credentials(username, password)
        cookie = moeimg_parser.login(username, password)
        # 成功路径：落 cookie。网络 login() 留锁外；仅 set_source_auth + save 进临界区。
        with self._config_write_lock:
            self.config.set_source_auth(
                "moeimg",
                AuthSourceData(cookie=cookie, username=username, password=password),
            )
            self.config.save(_get_config_path())
        self.parser.configure_auth(cookie=cookie, source="moeimg")
        logger.info("moeimg login successful for user %s", username)
        return {"success": True, "message": "登录成功"}

    def handle_bika_login(self, username: str, password: str) -> dict:
        from config import AuthSourceData

        if not username or not username.strip():
            raise ValueError("请输入用户名")
        if not password or not password.strip():
            raise ValueError("请输入密码")
        username = username.strip()
        password = password.strip()
        bika_parser = self.parser.parsers.get("bika")
        if not bika_parser:
            raise ValueError("bika 来源不可用")
        # 凭据持久化解耦：登录前先把账号密码落盘 + 注入懒登录，
        # 这样网络/密码错误导致 parser.login() 抛异常时凭据仍被保留（credential-persistence spec）。
        # 失败也注入 set_stored_credentials 是预期行为：网络恢复后下次请求可自动重试登录。
        self._persist_credentials("bika", username, password)
        bika_parser.set_stored_credentials(username, password)
        token = bika_parser.login(username, password)
        # 成功路径：落 bearer_token。网络 login() 留锁外；仅 set_source_auth + save 进临界区。
        with self._config_write_lock:
            self.config.set_source_auth(
                "bika",
                AuthSourceData(bearer_token=token, username=username, password=password),
            )
            self.config.save(_get_config_path())
        self.parser.configure_auth(bearer_token=token, source="bika")
        logger.info("bika login successful for user %s", username)
        return {"success": True, "message": "登录成功"}

    def handle_hcomic_login(self, username: str, password: str) -> dict:
        from config import AuthSourceData

        if not username or not username.strip():
            raise ValueError("请输入用户名")
        if not password or not password.strip():
            raise ValueError("请输入密码")
        username = username.strip()
        password = password.strip()
        hcomic_parser = self.parser.parsers.get("hcomic")
        if not hcomic_parser:
            raise ValueError("hcomic 来源不可用")
        # 凭据持久化解耦：登录前先把账号密码落盘 + 注入懒登录，
        # 这样网络/密码错误导致 parser.login() 抛异常时凭据仍被保留（credential-persistence spec）。
        # 失败也注入 set_stored_credentials 是预期行为：网络恢复后下次请求可自动重试登录。
        self._persist_credentials("hcomic", username, password)
        hcomic_parser.set_stored_credentials(username, password)
        token = hcomic_parser.login(username, password)
        # 成功路径：落 bearer_token。网络 login() 留锁外；仅 set_source_auth + save 进临界区。
        with self._config_write_lock:
            self.config.set_source_auth(
                "hcomic",
                AuthSourceData(bearer_token=token, username=username, password=password),
            )
            self.config.save(_get_config_path())
        self.parser.configure_auth(bearer_token=token, source="hcomic")
        self.downloader.configure_auth(bearer_token=token)
        logger.info("hcomic login successful for user %s", username)
        return {"success": True, "message": "登录成功"}
