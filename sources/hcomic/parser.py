"""h-comic 页面解析模块"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import logging
import re
import secrets
from datetime import UTC, datetime
from urllib.parse import parse_qs, quote, unquote, urlparse

import requests

from constants import DEFAULT_USER_AGENT
from models import (
    _DEFAULT_IMAGE_URL_SUFFIX,
    _IMAGE_URL_SUFFIX_MAP,
    ComicInfo,
    PaginationInfo,
)
from sources.base import ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session, configure_session_auth

logger = logging.getLogger(__name__)


MAX_PAYLOAD_SIZE = 2_000_000


class HComicParser(ParserContextMixin):
    """h-comic.com 解析器"""

    INDEX = "https://h-comic.com"
    IMAGE_SERVER = "https://h-comic.link/api"
    HEADERS = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,en-US;q=0.5,en;q=0.3",
    }

    # Auth0 配置 (Authorization Code + PKCE)
    AUTH0_DOMAIN = "h-comic.auth0.com"
    AUTH0_CLIENT_ID = "06o2Ynemb0DbDy8RBImlEGbyta1gT7mS"
    AUTH0_AUDIENCE = "https://h-comic.auth0.com/api/v2/"
    AUTH0_SCOPE = "openid profile email offline_access"
    AUTH0_REDIRECT_URI = "https://h-comic.com"

    # 正则表达式
    PAYLOAD_REGEX = re.compile(r"data:\s*\[null,\s*(\{.*?\})\s*],\s*form:", re.S)
    PAYLOAD_FALLBACK_REGEXES = (
        re.compile(r"data:\s*\[null,\s*(\{.*?\})\s*],", re.S),
        re.compile(r"data:\s*\[null,\s*(\{.*?\})\s*](?:\s|$)", re.S),
    )

    def __init__(
        self,
        timeout: int = 30,
        cookie: str = "",
        user_agent: str = "",
        bearer_token: str = "",
    ):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        apply_system_proxy_to_session(self.session)
        self.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)
        self._stored_username: str = ""
        self._stored_password: str = ""
        self._bearer_token: str = bearer_token

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        """配置登录相关请求头。"""
        if bearer_token:
            self._bearer_token = bearer_token.strip()
        configure_session_auth(self.session, self.HEADERS, cookie, user_agent, bearer_token)

    def set_stored_credentials(self, username: str, password: str):
        """存储用户名密码用于懒登录。"""
        self._stored_username = username or ""
        self._stored_password = password or ""

    def login(self, username: str, password: str) -> str:
        """通过 Auth0 Authorization Code + PKCE 流程登录，返回 access_token。

        由于 Auth0 客户端未启用 ROPG (password grant)，改用 PKCE 流程模拟浏览器登录:
        1. 生成 PKCE code_verifier / code_challenge
        2. GET /authorize 获取登录页面和内部 state
        3. POST /u/login/identifier 提交用户名
        4. POST /u/login/password 提交密码
        5. 从回调重定向中捕获 authorization code
        6. POST /oauth/token 用 code + code_verifier 换取 token

        Args:
            username: 用户名或邮箱
            password: 密码

        Returns:
            access_token 字符串

        Raises:
            ParserResponseError: 登录失败
        """
        try:
            return self._login_pkce(username, password)
        except ParserResponseError:
            raise
        except Exception as e:
            raise ParserResponseError(f"登录失败: {e}") from e

    def _login_pkce(self, username: str, password: str) -> str:
        """Auth0 Authorization Code + PKCE 登录实现。"""
        # 使用干净的 session 避免已有的 Cookie/Authorization 头干扰 Auth0 登录流程
        login_session = requests.Session()
        login_session.headers.update(self.HEADERS)
        apply_system_proxy_to_session(login_session)

        # 1. 生成 PKCE 参数
        code_verifier = secrets.token_urlsafe(32)
        challenge_digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        code_challenge = base64.urlsafe_b64encode(challenge_digest).rstrip(b"=").decode("ascii")
        oauth_state = secrets.token_urlsafe(32)

        auth_params = {
            "response_type": "code",
            "client_id": self.AUTH0_CLIENT_ID,
            "redirect_uri": self.AUTH0_REDIRECT_URI,
            "audience": self.AUTH0_AUDIENCE,
            "scope": self.AUTH0_SCOPE,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": oauth_state,
        }

        # 2. GET /authorize — 跟随重定向到登录页
        authorize_url = f"https://{self.AUTH0_DOMAIN}/authorize"
        resp = login_session.get(
            authorize_url,
            params=auth_params,
            timeout=self.timeout,
            allow_redirects=False,
        )
        logger.debug("PKCE authorize: status=%s", resp.status_code)
        if resp.status_code >= 400:
            raise ParserResponseError(f"Auth0 授权页请求失败 (HTTP {resp.status_code})")

        # 从 302 重定向 URL 提取 state 参数
        location = resp.headers.get("Location", "")
        if not location or "state=" not in location:
            raise ParserResponseError("Auth0 授权响应异常，请尝试使用浏览器登录")
        if location.startswith("/"):
            location = f"https://{self.AUTH0_DOMAIN}{location}"

        # 跟随重定向到登录页，获取会话 cookie
        login_page_resp = login_session.get(location, timeout=self.timeout)
        if login_page_resp.status_code >= 400:
            raise ParserResponseError(f"Auth0 登录页请求失败 (HTTP {login_page_resp.status_code})")

        login_page_url = login_page_resp.url
        auth0_origin = f"https://{self.AUTH0_DOMAIN}"
        logger.debug("PKCE login page URL: %s", login_page_url)

        # 从登录页 HTML 表单中提取 state 字段值
        form_state = self._extract_form_state(login_page_resp.text)
        if not form_state:
            raise ParserResponseError("无法从 Auth0 登录页提取表单 state，请尝试使用浏览器登录")

        # 3. 单步登录：POST 用户名+密码到登录页 URL
        # Auth0 新版 Universal Login 使用单步表单（同时包含 username 和 password）
        # 表单无 action 属性，提交到当前页面 URL
        login_data = {
            "state": form_state,
            "username": username,
            "password": password,
            "action": "default",
        }
        resp = login_session.post(
            login_page_url,
            data=login_data,
            headers={
                "Origin": auth0_origin,
                "Referer": login_page_url,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=self.timeout,
            allow_redirects=False,
        )
        post_location = resp.headers.get("Location", "")
        logger.debug("PKCE login POST: status=%s, Location=%s", resp.status_code, post_location)

        # 登录提交可能返回 200（HTML 错误页）或 302（成功/失败重定向）
        if resp.status_code == 200:
            # Auth0 在密码错误时返回 200 + 带错误信息的 HTML
            self._raise_login_error(resp, "登录失败：密码错误或账号不存在")

        if resp.status_code >= 400:
            self._raise_login_error(resp, "登录请求失败")

        # 4. 跟随重定向获取 authorization code
        if not post_location:
            self._raise_login_error(resp, "登录失败：未收到重定向")

        # 处理相对 URL
        if post_location.startswith("/"):
            post_location = f"{auth0_origin}{post_location}"

        # 检查登录后是否被重定向回 Auth0 登录页（密码错误时可能返回 302 到登录页）
        if "auth0.com" in post_location and ("/u/login" in post_location or "error=" in post_location):
            parsed_loc = urlparse(post_location)
            loc_params = parse_qs(parsed_loc.query)
            loc_error = loc_params.get("error", [""])[0]
            loc_error_desc = unquote(loc_params.get("error_description", [""])[0])
            # 尝试获取错误页面 HTML 中的具体错误信息
            err_detail = ""
            try:
                err_resp = login_session.get(post_location, timeout=self.timeout)
                err_detail = self._extract_auth0_error_from_html(err_resp.text)
            except Exception:
                pass
            logger.warning("PKCE login rejected, redirect: %s, html_error: %s", post_location, err_detail)
            if loc_error:
                raise ParserResponseError(f"登录失败: {loc_error_desc or loc_error}")
            if err_detail:
                raise ParserResponseError(f"登录失败: {err_detail}")
            raise ParserResponseError("登录失败：密码错误或账号不存在")

        callback_url = self._follow_redirects_to_callback(post_location, oauth_state, login_session)
        logger.debug("PKCE callback URL: %s", callback_url)

        # 从回调 URL 提取授权码（同时检查 query 和 fragment）
        parsed = urlparse(callback_url)
        params = parse_qs(parsed.query)
        # 某些情况下 Auth0 把参数放在 fragment 中
        if not params.get("code") and not params.get("error"):
            fragment_params = parse_qs(parsed.fragment)
            if fragment_params:
                params = fragment_params
        auth_code = params.get("code", [None])[0]
        if not auth_code:
            error = params.get("error", [""])[0]
            error_desc = unquote(params.get("error_description", [""])[0])
            # 构造有用的错误信息
            if error:
                msg = f"登录失败: {error}"
                if error_desc:
                    msg = f"{msg} — {error_desc}"
            else:
                # 回调 URL 中既无 code 也无 error，记录完整 URL 供调试
                logger.warning("PKCE callback missing auth code, URL: %s", callback_url)
                msg = "登录回调异常：未收到授权码，请尝试使用浏览器登录"
            raise ParserResponseError(msg)

        # 6. POST /oauth/token — 用授权码换取 token
        token_resp = login_session.post(
            f"{auth0_origin}/oauth/token",
            json={
                "grant_type": "authorization_code",
                "client_id": self.AUTH0_CLIENT_ID,
                "code": auth_code,
                "code_verifier": code_verifier,
                "redirect_uri": self.AUTH0_REDIRECT_URI,
            },
            timeout=self.timeout,
        )
        if token_resp.status_code >= 400:
            detail = ""
            with contextlib.suppress(Exception):
                err_body = token_resp.json()
                detail = err_body.get("error_description", "") or err_body.get("error", "")
            raise ParserResponseError(f"Token 交换失败 (HTTP {token_resp.status_code}): {detail}")

        result = token_resp.json()
        access_token = result.get("access_token", "")
        if not access_token:
            error_desc = result.get("error_description", "") or result.get("error", "未知错误")
            raise ParserResponseError(f"登录失败: {error_desc}")

        # 登录成功，将 token 应用到主 session
        self._bearer_token = access_token
        self.session.headers.pop("Cookie", None)
        configure_session_auth(
            self.session,
            self.HEADERS,
            "",
            "",
            bearer_token=access_token,
        )
        return access_token

    @staticmethod
    def _extract_form_state(html: str) -> str:
        """从 Auth0 登录页 HTML 表单中提取 state 隐藏字段的值。"""
        # 匹配 <input type="hidden" name="state" value="..." />
        m = re.search(
            r'<input[^>]+name\s*=\s*["\']state["\'][^>]+value\s*=\s*["\']([^"\']+)["\']',
            html,
            re.IGNORECASE,
        )
        if not m:
            # 尝试 value 在前、name 在后的顺序
            m = re.search(
                r'<input[^>]+value\s*=\s*["\']([^"\']+)["\'][^>]+name\s*=\s*["\']state["\']',
                html,
                re.IGNORECASE,
            )
        return m.group(1) if m else ""

    def _follow_redirects_to_callback(
        self,
        start_url: str,
        oauth_state: str,
        session: requests.Session | None = None,
    ) -> str:
        """跟随 Auth0 重定向链直到回调 URL。

        Args:
            start_url: 重定向链起始 URL
            oauth_state: OAuth state 参数
            session: 用于请求的 session（默认 self.session）

        Returns:
            回调 URL（含 code 参数）
        """
        sess = session or self.session
        current_url = start_url
        for i in range(10):
            if current_url.startswith(self.AUTH0_REDIRECT_URI):
                return current_url
            logger.debug("PKCE redirect step %d: %s", i, current_url)
            resp = sess.get(
                current_url,
                timeout=self.timeout,
                allow_redirects=False,
            )
            logger.debug("PKCE redirect step %d: status=%s", i, resp.status_code)
            next_url = resp.headers.get("Location", "")
            if not next_url:
                # 可能是 200 页面（如 consent 页面），尝试从 HTML 中提取重定向 URL
                if resp.status_code == 200:
                    logger.warning("PKCE redirect chain got 200 page at: %s", current_url)
                    raise ParserResponseError("登录重定向链中断：Auth0 返回了需要交互的页面，请使用浏览器登录")
                raise ParserResponseError("登录重定向链中断")
            if next_url.startswith("/"):
                parsed = urlparse(current_url)
                next_url = f"{parsed.scheme}://{parsed.netloc}{next_url}"
            current_url = next_url
        raise ParserResponseError("登录重定向次数过多")

    @staticmethod
    def _extract_hidden_form_fields(html: str) -> dict[str, str]:
        """从 Auth0 登录页 HTML 中提取隐藏表单字段。

        Auth0 可能要求在密码提交时附带 _csrf、csrf_token 等隐藏字段。

        Returns:
            {field_name: field_value} 字典
        """
        fields: dict[str, str] = {}
        # 匹配 <input type="hidden" name="..." value="..." />
        pattern = re.compile(
            r'<input[^>]+type\s*=\s*["\']hidden["\'][^>]*>',
            re.IGNORECASE,
        )
        for match in pattern.finditer(html):
            tag = match.group(0)
            name_m = re.search(r'name\s*=\s*["\']([^"\']+)["\']', tag, re.IGNORECASE)
            value_m = re.search(r'value\s*=\s*["\']([^"\']*)["\']', tag, re.IGNORECASE)
            if name_m:
                name = name_m.group(1)
                value = value_m.group(1) if value_m else ""
                # 只提取 csrf 类字段，避免引入无关字段
                if name.lower() in ("_csrf", "csrf_token", "_csrf_token", "csrfmiddlewaretoken"):
                    fields[name] = value
        return fields

    @staticmethod
    def _extract_auth0_error_from_html(html: str) -> str:
        """从 Auth0 错误页面 HTML 中提取错误信息。"""
        # 尝试多种选择器提取错误信息
        patterns = [
            re.compile(r'class=["\']ulc-error[^>]*>([^<]+)', re.IGNORECASE),
            re.compile(r'class=["\']error[^>]*>([^<]+)', re.IGNORECASE),
            re.compile(r'class=["\']alert[^>]*>([^<]+)', re.IGNORECASE),
            re.compile(r'<p[^>]*class=["\'][^"\']*(?:error|alert)[^"\']*["\'][^>]*>([^<]+)', re.IGNORECASE),
        ]
        for pat in patterns:
            m = pat.search(html)
            if m:
                text = m.group(1).strip()
                if text:
                    return text
        return ""

    def _raise_login_error(self, resp: requests.Response, prefix: str) -> None:
        """从 Auth0 响应中提取错误信息并抛出。"""
        detail = ""
        with contextlib.suppress(Exception):
            err_body = resp.json()
            detail = err_body.get("error_description", "") or err_body.get("error", "")
            if not detail:
                # 尝试从 HTML 中提取错误
                err_match = re.search(r"class=[\"']error[\"'][^>]*>([^<]+)", resp.text)
                if err_match:
                    detail = err_match.group(1).strip()
        msg = f"{prefix} (HTTP {resp.status_code})"
        if detail:
            msg = f"{msg}: {detail}"
        raise ParserResponseError(msg)

    def _ensure_token(self):
        """确保 token 有效，若不存在则使用存储的凭据自动登录。

        Raises:
            ParserResponseError: 无可用 token 且无存储凭据
        """
        if self._bearer_token:
            return
        if self._stored_username and self._stored_password:
            logger.info(
                "Auto-login hcomic with stored credentials for %s",
                self._stored_username,
            )
            self.login(self._stored_username, self._stored_password)
            return
        raise ParserResponseError("未登录，请先登录 HComic")

    def verify_login_status(self) -> tuple[bool, str]:
        """通过访问收藏夹接口校验登录状态。"""
        try:
            if self._bearer_token:
                # Bearer token 认证：使用 API 端点
                response = self._authenticated_request(
                    "GET",
                    "https://api.h-comic.com/api/favourites?page=1&limit=1",
                    error_prefix="登录校验",
                )
                if response.status_code == 200:
                    data = response.json()
                    if isinstance(data, dict) and "docs" in data:
                        return True, "登录校验通过"
                return False, "登录已失效，请重新登录"
            # Cookie 认证：解析 HTML 页面
            url = self._build_favourites_url(1)
            response = self._request_text(url)
            data = self._extract_payload_data(response)
            favourites_data = data.get("favourites")
            if isinstance(favourites_data, dict) and all(k in favourites_data for k in ("docs", "pages", "total")):
                return True, "登录校验通过"
            return False, "登录已失效，请重新登录"
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError):
            return False, "登录已失效，请重新登录"
        except requests.RequestException as e:
            return False, f"登录校验失败: {e}"

    def _get_response_text(self, response: requests.Response) -> str:
        """
        获取响应文本，自动处理编码问题

        服务器可能返回错误的 Content-Type 编码信息，导致 requests 使用错误的编码解析。
        此方法确保使用 UTF-8 编码解析响应内容。

        Args:
            response: requests 响应对象

        Returns:
            解码后的文本内容
        """
        # 强制使用 UTF-8 编码（服务器返回的编码信息可能不正确）
        # 必须在访问 response.text 之前设置编码
        try:
            if not response.encoding or response.encoding.lower() in (
                "iso-8859-1",
                "latin-1",
            ):
                response.encoding = "utf-8"
            return response.text
        except Exception as e:
            raise ParserResponseError(f"响应文本解码失败: {e}") from e

    def _request_text(self, url: str) -> str:
        """发起请求并返回响应文本，附带结构化错误信息。

        Note: `_request_text` 用于请求 h-comic.com 的网页页面，
        不应携带 `Authorization` 头部（仅 API 请求需要 Bearer token）。
        使用临时 headers 字典避免修改 session 全局 headers，保证线程安全。
        """
        headers = {k: v for k, v in self.session.headers.items() if k.lower() != "authorization"}
        try:
            response = self.session.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            return self._get_response_text(response)
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e

    def search(self, keyword: str, page: int = 1, *, tag: str = "") -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索漫画

        Args:
            keyword: 搜索关键词
            page: 页码 (1-based)
            tag: 标签搜索（逗号分隔多标签）

        Returns:
            (漫画信息列表, 分页信息)
        """
        url = self._build_search_url(keyword, page, tag=tag)
        try:
            return self.parse_search_page(self._request_text(url), requested_page=page)
        except ParserResponseError:
            raise
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Search failed: %s", e, exc_info=True)
            return [], None

    def random(self) -> tuple[list[ComicInfo], PaginationInfo | None]:
        url = self._build_random_url()
        try:
            return self.parse_search_page(self._request_text(url))
        except ParserResponseError:
            raise
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Random failed: %s", e, exc_info=True)
            return [], None

    def favourites(
        self, page: int = 1, raise_errors: bool = False
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """获取收藏夹漫画。

        Args:
            page: 页码
            raise_errors: 如果为 True，异常会向上传播而不是静默返回空列表

        Returns:
            (漫画信息列表, 分页信息, 是否需要登录)
        """
        try:
            if self._bearer_token:
                # Bearer token 认证：使用 API 端点
                return self._favourites_api(page)
            # Cookie 认证：解析 HTML 页面
            url = self._build_favourites_url(page)
            return self.parse_favourites_page(self._request_text(url), requested_page=page)
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Load favourites failed: %s", e, exc_info=True)
            if raise_errors:
                raise
            return [], None, False

    def _favourites_api(
        self,
        page: int = 1,
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """通过 API 端点获取收藏夹数据（Bearer token 认证）。"""
        response = self._authenticated_request(
            "GET",
            f"https://api.h-comic.com/api/favourites?page={page}&limit=20",
            error_prefix="获取收藏夹",
            log_name="favourites_api",
        )
        if response.status_code in (401, 403):
            return [], None, True
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            return [], None, False

        docs = data.get("docs") or []
        comics = []
        for item in docs:
            if not isinstance(item, dict):
                continue
            comic_data = item.get("comic")
            if not isinstance(comic_data, dict):
                continue
            try:
                comics.append(self._parse_comic_item(comic_data))
            except (KeyError, TypeError, ValueError) as e:
                logger.debug("Parse favourites item skipped: %s", e)
                continue

        total_docs, total_pages, limit = self._extract_pagination_fields(data, page, len(comics))
        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(1, total_pages),
            limit=max(1, limit),
            total_items=max(0, total_docs),
        )
        return comics, pagination, False

    @staticmethod
    def _extract_pagination_fields(
        data: dict,
        current_page: int,
        docs_count: int,
    ) -> tuple[int, int, int]:
        """从 API 响应中提取分页字段，兼容多种格式。

        支持的格式:
        - mongoose-paginate 标准: {totalDocs, totalPages, limit}
        - 别名格式: {total, pages, limit}
        - 嵌套格式: {pagination: {totalDocs, totalPages, limit}}

        Returns:
            (total_docs, total_pages, limit)
        """
        # 从顶层或嵌套的 pagination 对象中读取
        nested = data.get("pagination")
        pag: dict = nested if isinstance(nested, dict) else data

        def _int(v: object, default: int) -> int:
            try:
                return max(0, int(v))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return default

        total_docs = _int(pag.get("totalDocs") or pag.get("total"), 0)
        total_pages = _int(pag.get("totalPages") or pag.get("pages"), 0)
        limit = _int(pag.get("limit"), 20)

        # totalPages 缺失时根据 totalDocs 和 limit 推算
        if total_pages <= 0 and total_docs > 0 and limit > 0:
            total_pages = -(-total_docs // limit)  # ceiling division

        # 仍然无法确定时，利用 hasNextPage 推断至少有下一页
        if total_pages <= 0:
            has_next = pag.get("hasNextPage")
            if has_next is True:
                total_pages = current_page + 1
            elif docs_count > 0:
                total_pages = current_page
            else:
                total_pages = 1

        return total_docs, total_pages, max(1, limit)

    _API_HEADERS = {
        "Origin": "https://h-comic.com",
        "Referer": "https://h-comic.com/",
    }

    def _authenticated_request(
        self,
        method: str,
        url: str,
        *,
        error_prefix: str,
        log_name: str = "",
        **kwargs,
    ) -> requests.Response:
        """发送认证相关的 HTTP 请求，统一处理超时、认证失效和网络错误。

        当收到 401 且有存储的账号密码时，自动重新登录并重试一次。
        """
        kwargs.setdefault("timeout", self.timeout)
        kwargs.setdefault("headers", self._API_HEADERS)
        try:
            response = self.session.request(method, url, **kwargs)
            if response.status_code in (401, 403) and self._stored_username and self._stored_password:
                logger.info("Token expired, auto re-login for %s", self._stored_username)
                self._bearer_token = ""
                try:
                    self.login(self._stored_username, self._stored_password)
                except Exception as e:
                    logger.warning("Auto re-login failed: %s", e)
                    raise ParserResponseError(f"认证已失效，自动重新登录失败: {e}") from e
                response = self.session.request(method, url, **kwargs)
                if response.status_code in (401, 403):
                    raise ParserResponseError("认证已失效，请重新登录")
            return response
        except requests.Timeout as e:
            raise ParserResponseError(f"{error_prefix}请求超时") from e
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else None
            if status in (401, 403):
                raise ParserResponseError("认证已失效，请重新登录") from e
            if log_name:
                body = ""
                with contextlib.suppress(Exception):
                    body = e.response.text[:500] if e.response is not None else ""
                logger.error("%s HTTP %s: %s", log_name, status, body, exc_info=True)
            raise ParserResponseError(f"{error_prefix}失败 (HTTP {status})") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"{error_prefix}请求失败: {e}") from e

    def add_to_favourites(self, comic_id: str) -> bool:
        """将漫画加入收藏夹。

        Args:
            comic_id: 漫画 ID

        Returns:
            成功返回 True

        Raises:
            ParserResponseError: 请求失败或认证失效
        """
        response = self._authenticated_request(
            "POST",
            "https://api.h-comic.com/api/favourites",
            error_prefix="加入收藏夹",
            log_name="add_to_favourites",
            json={"comicId": comic_id},
        )
        response.raise_for_status()
        return True

    def check_favourite(self, comic_id: str) -> bool:
        """检查漫画是否在收藏夹中。

        Args:
            comic_id: 漫画 ID

        Returns:
            True 表示已收藏，False 表示未收藏

        Raises:
            ParserResponseError: 请求失败或认证失效
        """
        url = f"https://api.h-comic.com/api/favourites/{comic_id}"
        response = self._authenticated_request(
            "GET",
            url,
            error_prefix="检查收藏状态",
        )
        if response.status_code == 200:
            try:
                return response.json() is not None
            except ValueError:
                return False
        if response.status_code == 404:
            return False
        response.raise_for_status()
        return False

    def remove_from_favourites(self, comic_id: str) -> bool:
        """将漫画从收藏夹移除。

        Args:
            comic_id: 漫画 ID (MongoDB ObjectId)

        Returns:
            成功返回 True

        Raises:
            ParserResponseError: 请求失败或认证失效
        """
        url = f"https://api.h-comic.com/api/favourites/{comic_id}"
        response = self._authenticated_request(
            "DELETE",
            url,
            error_prefix="移除收藏夹",
            log_name="remove_from_favourites",
        )
        response.raise_for_status()
        return True

    def get_comic_detail(self, comic_id: str, slug: str = "", source_url: str = "") -> ComicInfo | None:
        """获取漫画详情

        Args:
            comic_id: 漫画 ID
            slug: URL slug（可选）
            source_url: 来源页面 URL（可选，用于提取 slug）

        Returns:
            漫画信息，失败返回 None
        """
        if not slug and source_url:
            slug = self._extract_slug_from_url(source_url, comic_id)
        url = f"{self.INDEX}/comics/{slug or '1'}/1?id={comic_id}"
        try:
            self._ensure_token()
            raw_html = self._request_text(url)
            try:
                return self.parse_comic_detail(raw_html)
            except (ValueError, json.JSONDecodeError, TypeError):
                # payload 解析失败说明 token 过期导致拿到的是登录页，
                # 清除 token 重登录后再试一次
                if not self._stored_username:
                    raise
                self._bearer_token = ""
                self._ensure_token()
                raw_html = self._request_text(url)
                return self.parse_comic_detail(raw_html)
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Get comic detail failed: %s", e, exc_info=True)
            return None

    @staticmethod
    def _extract_slug_from_url(source_url: str, comic_id: str) -> str:
        """从来源 URL 中提取 slug。

        URL 格式: https://h-comic.com/comics/{slug}?id={comic_id}
        """
        try:
            parsed = urlparse(source_url)
            parts = parsed.path.rstrip("/").split("/")
            # 路径格式: /comics/{slug} 或 /comics/{slug}/{page}
            if len(parts) >= 3 and parts[1] == "comics":
                slug = unquote(parts[2])
                if slug and slug != "1":
                    return slug
        except Exception:
            pass
        return ""

    def parse_search_page(self, html: str, requested_page: int = 1) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """解析搜索页面

        Args:
            html: 页面 HTML
            requested_page: 请求页码 (1-based)

        Returns:
            (漫画信息列表, 分页信息)
        """
        try:
            data = self._extract_payload_data(html)
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.warning("Parse search payload error: %s", e)
            return [], None

        # 解析分页信息
        pagination_info = self._parse_pagination_info(data, requested_page)

        targets = data.get("comics") or []
        if not isinstance(targets, list):
            logger.warning("Parse search payload invalid: `comics` is not a list")
            return [], pagination_info

        comics = []
        for target in targets:
            if not isinstance(target, dict):
                continue
            try:
                comics.append(self._parse_comic_item(target))
            except (KeyError, TypeError, ValueError) as e:
                logger.debug("Parse search item skipped: %s", e)
                continue

        return comics, pagination_info

    def parse_favourites_page(
        self, html: str, requested_page: int = 1
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """解析收藏夹页面。

        Returns:
            (漫画信息列表, 分页信息, 是否需要登录)
        """
        try:
            data = self._extract_payload_data(html)
        except (ValueError, json.JSONDecodeError, TypeError) as e:
            logger.warning("Parse favourites payload error: %s", e)
            return [], None, False

        favourites_data = data.get("favourites")
        if not isinstance(favourites_data, dict):
            return [], None, True

        # 空字典表示 Cookie 过期或收藏夹为空，统一返回 needs_login=True
        if not favourites_data or not all(k in favourites_data for k in ("docs", "pages", "total")):
            return [], None, True

        docs = favourites_data.get("docs")
        if not isinstance(docs, list):
            return [], None, True

        def _safe_int(value, default: int) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return default

        total_pages = max(1, _safe_int(favourites_data.get("pages"), 1))
        total_items = max(0, _safe_int(favourites_data.get("total"), 0))
        limit = max(1, _safe_int(favourites_data.get("limit"), 10))
        current_page = min(max(1, _safe_int(requested_page, 1)), total_pages)
        pagination = PaginationInfo(
            current_page=current_page,
            total_pages=total_pages,
            limit=limit,
            total_items=total_items,
        )

        comics = []
        for item in docs:
            if not isinstance(item, dict):
                continue
            comic_data = item.get("comic")
            if not isinstance(comic_data, dict):
                continue
            try:
                comics.append(self._parse_comic_item(comic_data))
            except (KeyError, TypeError, ValueError) as e:
                logger.debug("Parse favourites item skipped: %s", e)
                continue

        return comics, pagination, False

    def parse_comic_detail(self, html: str) -> ComicInfo:
        """解析漫画详情页

        Args:
            html: 页面 HTML

        Returns:
            漫画信息
        """
        data = self._extract_payload_data(html)
        comic = data.get("comic")
        if not comic:
            raise ValueError("Comic payload missing")
        return self._parse_comic_item(comic)

    def _parse_comic_item(self, data: dict) -> ComicInfo:
        """解析单个漫画数据

        Args:
            data: 漫画数据字典

        Returns:
            ComicInfo 对象
        """
        title_info = data.get("title") or {}
        tags = data.get("tags") or []

        # 提取作者
        artist = next((t.get("name") for t in tags if t.get("type") == "artist"), None)

        # 提取分类
        category = next(
            (t.get("name_zh") or t.get("name") for t in tags if t.get("type") == "category"),
            None,
        )

        # 提取标签
        tag_names = [t.get("name_zh") or t.get("name") for t in tags if t.get("type") == "tag"]

        # 提取原著
        parody_names = [t.get("name_zh") or t.get("name") for t in tags if t.get("type") == "parody"]

        # 提取角色
        character_names = [t.get("name_zh") or t.get("name") for t in tags if t.get("type") == "character"]

        # 构建 URL
        preview_url, _ = self._build_book_urls(data)

        # 获取页数
        pages = data.get("num_pages") or len((data.get("images") or {}).get("pages") or [])

        # 构建封面 URL
        cover_url = self._build_cover_url(data)

        return ComicInfo(
            id=str(data.get("_id") or data.get("id") or ""),
            title=title_info.get("display") or title_info.get("japanese") or title_info.get("english") or "未知标题",
            author=artist,
            pages=pages,
            category=category,
            tags=[tag for tag in tag_names if tag],
            parodies=[p for p in parody_names if p],
            characters=[c for c in character_names if c],
            publish_date=self._format_public_date(data.get("upload_date")),
            cover_url=cover_url,
            preview_url=preview_url,
            media_id=str(data.get("media_id") or ""),
            comic_source=data.get("comic_source", ""),
            source_site="hcomic",
        )

    @classmethod
    def _build_search_url(cls, keyword: str, page: int = 1, *, tag: str = "") -> str:
        """构建搜索 URL

        Args:
            keyword: 搜索关键词
            page: 页码 (1-based)
            tag: 标签搜索（逗号分隔多标签）

        Returns:
            搜索 URL
        """
        if tag:
            q = quote(keyword) if keyword else ""
            return cls._build_paginated_url(f"{cls.INDEX}/?q={q}&tag={quote(tag)}", page)
        return cls._build_paginated_url(f"{cls.INDEX}/?q={quote(keyword)}", page)

    @classmethod
    def _build_random_url(cls) -> str:
        return f"{cls.INDEX}/random?q=&tag="

    @classmethod
    def _build_favourites_url(cls, page: int = 1) -> str:
        """构建收藏夹 URL。"""
        return cls._build_paginated_url(f"{cls.INDEX}/favourites", page)

    @classmethod
    def _build_paginated_url(cls, base: str, page: int = 1) -> str:
        """为基 URL 附加分页查询参数。

        Args:
            base: 基础 URL（不带 ?page= 参数）
            page: 页码 (1-based)，page <= 1 时不附加参数

        Returns:
            完整的分页 URL
        """
        if page <= 1:
            return base
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}page={page}"

    @classmethod
    def _parse_pagination_info(cls, data: dict, requested_page: int = 1) -> PaginationInfo | None:
        """解析分页信息

        Args:
            data: payload data 字典
            requested_page: 请求页码 (1-based)

        Returns:
            分页信息对象
        """
        pages_data = data.get("pages")
        if not isinstance(pages_data, dict):
            return None

        total_pages = max(1, int(pages_data.get("pages", 1)))
        total_items = max(0, int(pages_data.get("total", 0)))
        limit = max(1, int(pages_data.get("limit", 10)))
        current_page = min(max(1, int(requested_page)), total_pages)

        return PaginationInfo(
            current_page=current_page,
            total_pages=total_pages,
            limit=limit,
            total_items=total_items,
        )

    @classmethod
    def _build_book_urls(cls, comic: dict) -> tuple:
        """构建漫画 URL

        Returns:
            (preview_url, reader_url) 元组
        """
        title_info = comic.get("title") or {}
        comic_id = comic.get("id")
        slug_source = title_info.get("japanese") or title_info.get("english") or str(comic_id)
        slug = quote(slug_source, safe="")
        preview_url = f"{cls.INDEX}/comics/{slug}?id={comic_id}"
        reader_url = f"{cls.INDEX}/comics/{slug}/1?id={comic_id}"
        return preview_url, reader_url

    @classmethod
    def _build_cover_url(cls, comic: dict) -> str | None:
        """构建封面 URL"""
        media_id = comic.get("media_id")
        if not media_id:
            return None
        return f"{cls._get_image_prefix(comic.get('comic_source') or '')}/{media_id}"

    @classmethod
    def _get_image_prefix(cls, comic_source: str) -> str:
        """获取图片前缀"""
        suffix = _IMAGE_URL_SUFFIX_MAP.get((comic_source or "").upper(), _DEFAULT_IMAGE_URL_SUFFIX)
        return f"{cls.IMAGE_SERVER}/{suffix}"

    @classmethod
    def _format_public_date(cls, unix_ts) -> str | None:
        """格式化发布日期"""
        try:
            return datetime.fromtimestamp(int(unix_ts), tz=UTC).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            return None

    @classmethod
    def _extract_payload_data(cls, resp_text: str) -> dict:
        """从页面中提取 payload 数据"""
        resp_bytes = len(resp_text.encode("utf-8"))
        if resp_bytes > MAX_PAYLOAD_SIZE:
            raise ValueError(f"Response too large ({resp_bytes} bytes), limit is 2MB")
        m = cls.PAYLOAD_REGEX.search(resp_text)
        if not m:
            for fallback in cls.PAYLOAD_FALLBACK_REGEXES:
                m = fallback.search(resp_text)
                if m:
                    logger.warning("Primary payload regex failed, using fallback regex")
                    break
        if not m:
            raise ValueError("h-comic payload not found")
        payload_obj = cls._jsobj_to_dict(m.group(1))
        if not isinstance(payload_obj, dict):
            raise ValueError("h-comic payload root is not an object")
        data = payload_obj.get("data")
        if not isinstance(data, dict):
            raise ValueError("h-comic payload missing `data` object")
        return data

    @classmethod
    def _scan_string_literal(cls, text: str, i: int, quote_char: str, out: list[str]) -> tuple[int, bool]:
        """处理字符串字面量内部内容，返回 (新的位置索引, 是否仍在字符串内)。"""
        while i < len(text):
            ch = text[i]
            out.append(ch)
            if ch == "\\" and i + 1 < len(text):
                i += 1
                out.append(text[i])
            elif ch == quote_char:
                i += 1
                return i, False
            i += 1
        return i, True

    @classmethod
    def _try_quote_object_key(cls, text: str, i: int, out: list[str]) -> int:
        """在 `{` 或 `,` 后尝试为未加引号的对象键补双引号。返回新的位置索引。"""
        n = len(text)
        while i < n and text[i].isspace():
            out.append(text[i])
            i += 1

        start = i
        if i < n and (text[i].isalpha() or text[i] == "_"):
            i += 1
            while i < n and (text[i].isalnum() or text[i] == "_"):
                i += 1

            end = i
            j = i
            while j < n and text[j].isspace():
                j += 1

            if j < n and text[j] == ":":
                out.append(f'"{text[start:end]}"')
                out.append(text[end:j])
                out.append(":")
                return j + 1

            out.append(text[start:end])
        return i

    @classmethod
    def _quote_unquoted_js_keys(cls, js_obj_text: str) -> str:
        """仅在字符串外侧，为未加引号的对象键补双引号。"""
        out: list[str] = []
        pos = 0
        n = len(js_obj_text)
        in_string = False
        quote_char = ""

        while pos < n:
            ch = js_obj_text[pos]

            if in_string:
                pos, in_string = cls._scan_string_literal(js_obj_text, pos, quote_char, out)
                if not in_string:
                    quote_char = ""
                continue

            if ch in ('"', "'"):
                in_string = True
                quote_char = ch
                out.append(ch)
                pos += 1
                continue

            if ch in "{,":
                out.append(ch)
                pos = cls._try_quote_object_key(js_obj_text, pos + 1, out)
                continue

            out.append(ch)
            pos += 1

        return "".join(out)

    @classmethod
    def _jsobj_to_dict(cls, js_obj_text: str) -> dict:
        """将 JavaScript 对象文本转换为 Python 字典"""
        json_ready = cls._quote_unquoted_js_keys(js_obj_text)
        return json.loads(json_ready)
