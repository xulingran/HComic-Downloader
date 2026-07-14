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

# NH API Key 校验上限（remove-nh-password-login spec）：拒绝异常长度输入。
_NH_API_KEY_MAX_LENGTH = 1024
# 控制字符（C0 + DEL）：API Key 不得包含。
_NH_API_KEY_CONTROL_CHARS = "".join(chr(c) for c in range(0x20)) + "\x7f"


class NhApiKeyError(ValueError):
    """NH API Key 输入校验失败。"""


def _validate_nh_api_key(api_key: str) -> str:
    """校验并归一化 NH API Key 原始输入。

    - 去首尾空白；
    - 拒绝空值；
    - 拒绝控制字符；
    - 拒绝异常长度；
    - 拒绝 ``User `` / ``Token `` / ``Bearer `` 等旧认证前缀（保留无前缀 / ``Key ``）。

    返回不含 ``Key `` 前缀的纯 API Key。
    """
    raw = "" if api_key is None else str(api_key)
    stripped = raw.strip()
    if not stripped:
        raise NhApiKeyError("请输入 NH API Key")
    if any(ch in _NH_API_KEY_CONTROL_CHARS for ch in stripped):
        raise NhApiKeyError("NH API Key 不得包含控制字符")
    if len(stripped) > _NH_API_KEY_MAX_LENGTH:
        raise NhApiKeyError("NH API Key 长度异常")
    prefix, separator, value = stripped.partition(" ")
    if separator:
        prefix_lower = prefix.lower()
        if prefix_lower == "key":
            normalized = value.strip()
            if not normalized:
                raise NhApiKeyError("请输入 NH API Key")
            return normalized
        if prefix_lower in ("user", "token", "bearer"):
            raise NhApiKeyError("NH 不再支持 User/Token/Bearer 凭据，请使用 API Key")
        raise NhApiKeyError("NH API Key 格式不正确")
    return stripped


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
        # NH 收敛为仅 API Key（remove-nh-password-login spec）：必须走专用
        # handle_nh_apply_api_key，禁止通过通用 curl/cookie apply_auth 写入 NH 认证。
        if source == "nh":
            raise ValueError("NH 认证请使用 API Key，前往设置页应用")
        # JM 会话凭据不持久化（jm-session-cookie spec）：cookie/UA 与 Cloudflare 挑战态绑定，
        # 跨进程复用常失效。仅注入内存 parser（下方 configure_auth），禁止落盘 config.json。
        # 其他来源仍走 set_source_auth + save 持久化路径（credential-persistence spec）。
        if source != "jm":
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

    def _do_password_login(
        self,
        source: str,
        username: str,
        password: str,
        *,
        credential_kind: str,
        apply_to_downloader: bool = False,
    ) -> dict:
        """Shared body for moeimg/bika/hcomic password login handlers.

        Validates credentials, persists them, calls ``parser.login()``, then
        writes ``source_auth`` under the config lock. Returns a uniform
        success dict. ``credential_kind`` selects whether the login secret is
        stored as ``cookie`` (moeimg) or ``bearer_token`` (bika/hcomic);
        ``apply_to_downloader`` additionally syncs the secret to the downloader
        (hcomic only).
        """
        from config import AuthSourceData

        if not username or not username.strip():
            raise ValueError("请输入用户名")
        if not password or not password.strip():
            raise ValueError("请输入密码")
        username = username.strip()
        password = password.strip()

        parser = self.parser.parsers.get(source)
        if not parser:
            raise ValueError(f"{source} 来源不可用")

        # 凭据持久化解耦：登录前先把账号密码落盘 + 注入懒登录，
        # 这样网络/密码错误导致 parser.login() 抛异常时凭据仍被保留（credential-persistence spec）。
        # 失败也注入 set_stored_credentials 是预期行为：网络恢复后下次请求可自动重试登录。
        self._persist_credentials(source, username, password)
        parser.set_stored_credentials(username, password)
        secret = parser.login(username, password)

        # 成功路径：落 secret。网络 login() 留锁外；仅 set_source_auth + save 进临界区。
        auth_kwargs = {credential_kind: secret, "username": username, "password": password}
        with self._config_write_lock:
            self.config.set_source_auth(source, AuthSourceData(**auth_kwargs))
            self.config.save(_get_config_path())

        configure_kwargs = {credential_kind: secret, "source": source}
        self.parser.configure_auth(**configure_kwargs)
        if apply_to_downloader:
            # 仅 hcomic：下载器需要同步 bearer_token
            self.downloader.configure_auth(**{credential_kind: secret})

        logger.info("%s login successful for user %s", source, username)
        return {"success": True, "message": "登录成功"}

    def handle_moeimg_login(self, username: str, password: str) -> dict:
        return self._do_password_login("moeimg", username, password, credential_kind="cookie")

    def handle_bika_login(self, username: str, password: str) -> dict:
        return self._do_password_login("bika", username, password, credential_kind="bearer_token")

    def handle_bika_check_in(self) -> dict:
        """检查并按需完成 Bika 每日签到。"""
        parser = self.parser.parsers.get("bika")
        if not parser:
            raise ValueError("bika 来源不可用")
        return parser.check_in()

    def handle_hcomic_login(self, username: str, password: str) -> dict:
        return self._do_password_login(
            "hcomic",
            username,
            password,
            credential_kind="bearer_token",
            apply_to_downloader=True,
        )

    def handle_nh_apply_api_key(self, api_key: str) -> dict:
        """应用 NH API Key（remove-nh-password-login spec）。

        校验 → 持久化纯 API Key 到 ``source_auth.nh.bearer_token``（同时清空其他
        NH 认证字段） → 立即注入 parser。``source_auth.nh`` 的 username/password/
        cookie/user_agent 必须保持为空。
        """
        from config import AuthSourceData

        normalized = _validate_nh_api_key(api_key)

        with self._config_write_lock:
            self.config.set_source_auth(
                "nh",
                AuthSourceData(bearer_token=normalized),
            )
            self.config.save(_get_config_path())

        # 立即注入已创建的 parser；未创建则等懒创建时由 factory 读取 source_auth。
        self.parser.configure_auth(bearer_token=normalized, source="nh")

        logger.info("NH API Key applied")
        return {"success": True}

    def handle_clear_source_auth(self, source: str) -> dict:
        """清除指定来源的持久化认证凭证与内存会话状态。"""
        from config import VALID_SOURCE_KEYS, AuthSourceData

        if not source or source not in VALID_SOURCE_KEYS:
            raise ValueError(f"无效的来源: {source}")

        with self._config_write_lock:
            self.config.set_source_auth(
                source,
                AuthSourceData(
                    cookie="",
                    user_agent="",
                    bearer_token="",
                    username="",
                    password="",
                ),
            )
            self.config.save(_get_config_path())

        # 清除运行期鉴权态必须走与登录/应用相同的通道（MultiSourceParser.configure_auth），
        # 该方法会同时归零 JM 的 _jm_session_auth 与非 JM 的 source_auth 字典（get_runtime_auth
        # 的真值来源），并把空值传播到活动 parser 实例。禁止只调 per-source parser.configure_auth
        # ——它碰不到 MultiSourceParser 级别的运行期字典，会导致"持久化已清但鉴权仍判已登录"的幽灵态
        # （auth-clear-runtime-state spec）。与 handle_apply_auth/_do_password_login 的写法对称。
        self.parser.configure_auth(cookie="", user_agent="", bearer_token="", source=source)

        if source == "hcomic":
            self.downloader.configure_auth(cookie="", user_agent="", bearer_token="")

        logger.info("Cleared auth for %s", source)
        return {"success": True}
