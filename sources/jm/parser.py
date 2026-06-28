"""jm 页面解析模块。"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

import requests
from lxml import etree

from models import ChapterInfo, ComicInfo, PaginationInfo
from sources.base import AntiBotChallengeError, ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session, configure_session_auth

from .constants import (
    DEFAULT_DOMAIN,
    HEADERS,
    RANDOM_URL_TEMPLATE,
    RANKING_MAPPINGS,
    SEARCH_URL_TEMPLATE,
)
from .session import create_session


@dataclass
class _DetailMetadata:
    """Parsed metadata from comic detail page."""

    author: str | None
    tags: list[str]
    category: str | None
    pages: int
    publish_date: str | None


logger = logging.getLogger(__name__)

_RANKING_RE = re.compile(r"^[日周月总](更新|点击|评分|评论|收藏)$")
_INVALID_ID_RE = re.compile(r"album_missing|login")
_COMIC_ID_RE = re.compile(r"^\d+$")
_CHALLENGE_KEYWORDS = (
    "just a moment",
    "captcha",
    "/cdn-cgi/challenge-platform/",
    "challenge-platform",
    "cf-chl-",
    "cf-challenge",
)
_FAVOURITES_CHALLENGE_RETRIES = 2
_FAVOURITES_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024
_FAVOURITES_PATH_RE = re.compile(r"^/user/[^/?#]+/favorite/albums/?$")


class JmParser(ParserContextMixin):
    """jm 解析器，实现与 HComicParser 相同的接口。"""

    def __init__(self, timeout: int = 30, cookie: str = "", user_agent: str = ""):
        self.timeout = timeout
        self._cookie = cookie
        self._user_agent = user_agent
        self._domain: str | None = None
        self._cdn_domain: str | None = None
        self._username: str | None = None  # 从收藏夹页面发现，用于构造规范 URL
        self._known_favourite_ids: set[str] = set()
        self._cookie_synced = False
        self.session = create_session()
        self.session.headers.update(HEADERS)
        # 注入系统代理，与 hcomic/moeimg parser 保持一致。
        # 未注入时 curl_cffi 直连网络，若本机依赖代理访问外网则 DNS 解析失败。
        apply_system_proxy_to_session(self.session)
        self.configure_auth(cookie=cookie, user_agent=user_agent)

    def _ensure_domain(self) -> str:
        # jm 始终使用 18comic.vip 作为默认域名（DEFAULT_DOMAIN）。
        # 发布页自动发现的镜像域名仅用于设置页的手动切换选项，
        # 不自动替换默认值，避免解析到不可达域名导致请求失败。
        if not self._domain:
            self._domain = DEFAULT_DOMAIN
        self._sync_cookies_to_jar()
        return self._domain

    def _iter_cookie_pairs(self) -> list[tuple[str, str]]:
        """Parse the stored Cookie header into name/value pairs."""
        raw_cookie = getattr(self, "_cookie", "") or ""
        if not raw_cookie.strip():
            return []
        try:
            parsed = SimpleCookie()
            parsed.load(raw_cookie)
            pairs = [(name, morsel.value) for name, morsel in parsed.items()]
            if pairs:
                return pairs
        except CookieError:
            logger.debug("SimpleCookie failed to parse jm cookie header; falling back to split parser", exc_info=True)

        pairs = []
        for part in raw_cookie.split(";"):
            part = part.strip()
            if "=" not in part:
                continue
            name, value = part.split("=", 1)
            name = name.strip()
            if name:
                pairs.append((name, value.strip()))
        return pairs

    def _auth_headers(self, headers: dict[str, str] | None = None) -> dict[str, str]:
        """Build per-request headers with an explicit Cookie fallback."""
        merged = dict(headers or {})
        if self._cookie:
            merged["Cookie"] = self._cookie
        return merged

    def _sync_cookies_to_jar(self):
        """将 self._cookie 中的 cookies 设置到 session cookie jar 中。

        使用 http.cookiejar.Cookie 对象 + set_cookie() 方式设置，
        确保与 curl_cffi/libcurl 的 cookie engine 兼容。
        """
        if getattr(self, "_cookie_synced", False) or not getattr(self, "_cookie", "") or not self._domain:
            return
        try:
            from http.cookiejar import Cookie

            # 兼容 curl_cffi 与 requests 两种 cookie 容器：
            # - requests.RequestsCookieJar 直接提供 set_cookie()
            # - curl_cffi.requests.cookies.Cookies 不提供 set_cookie()，
            #   但其底层 .jar 是标准 http.cookiejar.CookieJar，提供 set_cookie()
            cookies_obj = self.session.cookies
            if hasattr(cookies_obj, "set_cookie"):
                jar = cookies_obj
            elif hasattr(cookies_obj, "jar") and hasattr(cookies_obj.jar, "set_cookie"):
                jar = cookies_obj.jar
            else:
                raise AttributeError("session.cookies 不支持 set_cookie，无法同步认证 cookie")

            count = 0
            jar_entries = 0
            domains = [
                (self._domain, False, False),
                (f".{self._domain}", True, True),
            ]
            for name, value in self._iter_cookie_pairs():
                count += 1
                for domain, domain_specified, domain_initial_dot in domains:
                    cookie = Cookie(
                        version=0,
                        name=name,
                        value=value,
                        port=None,
                        port_specified=False,
                        domain=domain,
                        domain_specified=domain_specified,
                        domain_initial_dot=domain_initial_dot,
                        path="/",
                        path_specified=True,
                        secure=True,
                        expires=None,
                        discard=False,
                        comment=None,
                        comment_url=None,
                        rest={},
                        rfc2109=False,
                    )
                    jar.set_cookie(cookie)
                    jar_entries += 1
            self._cookie_synced = True
            logger.info(
                "Synced %d cookies to jar for domain %s (%d jar entries)",
                count,
                self._domain,
                jar_entries,
            )
        except Exception:
            logger.warning("Failed to sync cookies to jar", exc_info=True)

    def set_custom_domain(self, domain: str) -> None:
        """设置自定义域名。传空字符串则清除自定义值，下次自动解析。"""
        old_domain = self._domain
        self._domain = domain.strip() if domain and domain.strip() else None
        # 域名变更后需要重新将 cookie 同步到新域名的 cookie jar
        if self._domain and self._domain != old_domain and hasattr(self, "_cookie_synced"):
            self._cookie_synced = False

    def set_username(self, username: str) -> None:
        """直接设置用户名（由 Electron 登录窗口从 DOM 提取后传入）。

        避免 Python 后端因 Cloudflare 403 无法从首页发现用户名。
        """
        if username and username.strip():
            self._username = username.strip()
            logger.info("Username set from login window: %s", self._username)

    @property
    def cdn_domain(self) -> str | None:
        """返回当前解析到的 CDN 域名（如 cdn-msp2.jmcomic-zzz.one）。"""
        return self._cdn_domain

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        configure_session_auth(self.session, HEADERS, cookie, user_agent, bearer_token)
        # curl_cffi/libcurl 不认可 session.headers['Cookie']，
        # 改用 cookie jar 方式设置 cookies
        self.session.headers.pop("Cookie", None)
        self._cookie = cookie
        self._user_agent = user_agent
        self._cookie_synced = False

    def verify_login_status(self) -> tuple[bool, str]:
        """通过访问首页导航栏验证 Cookie 有效性并提取用户名。

        /user/favorites 旧路径已被服务端废弃（直接返回 403），
        改为请求首页并从导航栏判断是否已登录。已登录时导航栏包含
        /user/{username}/favorite 形式的链接，可同时发现用户名。
        """
        domain = self._ensure_domain()
        try:
            url = f"https://{domain}/"
            resp = self.session.get(
                url,
                timeout=self.timeout,
                allow_redirects=True,
                headers=self._auth_headers({"Referer": f"https://{domain}/"}),
            )
            # Cloudflare 挑战只表示本次服务端校验受阻，不能据此判定 Cookie 失效。
            if self._is_challenge_response(resp):
                logger.debug(
                    "jm verify_login: challenge detected at status %d (first 500 chars): %s",
                    resp.status_code,
                    resp.text[:500],
                )
                return False, "登录校验被站点人机验证阻断，请稍后重试或检查网络与域名设置"
            if resp.status_code != 200:
                logger.warning(
                    "jm verify_login: unexpected status=%d url=%s",
                    resp.status_code,
                    resp.url,
                )
                return False, "登录校验失败，请确认 Cookie 是否有效"
            self._fix_encoding(resp)
            html = resp.text
            doc = etree.HTML(html)
            # 已登录：导航栏含 /user/{username}/favorite 链接
            fav_links = doc.xpath('//a[contains(@href,"/favorite")]/@href')
            for href in fav_links:
                m = re.search(r"/user/([^/?#]+)/favorite", href)
                if m:
                    username = m.group(1)
                    if self._username != username:
                        self._username = username
                        logger.info("Discovered jm username from navbar: %s", username)
                    return True, "登录校验通过"
            # 次级检测：导航栏含登出链接也表示已登录
            logout_links = doc.xpath('//a[contains(@href,"logout") or contains(@href,"sign_out")]')
            if logout_links:
                # 尝试从 /user/{username} 链接补充用户名
                for href in doc.xpath('//a[contains(@href,"/user/")]/@href'):
                    m = re.search(r"/user/([^/?#]+)", href)
                    if m and m.group(1) not in ("profile", "favorites", "setting"):
                        self._username = self._username or m.group(1)
                        break
                return True, "登录校验通过"
            # 页面含「登入」链接，说明未登录
            login_links = doc.xpath(
                '//a[contains(@href,"/login") or contains(text(),"登入") or contains(text(),"登录")]'
            )
            if login_links:
                return False, "登录已失效，请重新登录"
            logger.debug(
                "jm verify_login response HTML (first 500 chars): %s",
                html[:500],
            )
            logger.warning(
                "jm verify_login: cannot determine login state (status=%d, fav_links=%d, login_links=%d)",
                resp.status_code,
                len(fav_links),
                len(login_links),
            )
            return False, "登录校验失败，请确认 Cookie 是否有效"
        except Exception as e:
            # curl_cffi 的网络异常不继承 requests.RequestException，
            # 需用 Exception 基类捕获（如 DNS 解析失败、连接超时等）
            logger.warning("jm verify_login request failed: %s", e)
            return False, f"登录校验失败: {e}"

    def add_to_favourites(self, comic_id: str) -> bool:
        """将漫画加入收藏夹。

        Args:
            comic_id: 漫画 ID

        Returns:
            成功返回 True

        Raises:
            RuntimeError: 请求失败或认证失效
        """
        domain = self._ensure_domain()
        url = f"https://{domain}/ajax/favorite/add"
        try:
            resp = self.session.post(
                url,
                data={"aid": comic_id},
                timeout=self.timeout,
                headers=self._auth_headers(
                    {
                        "Referer": f"https://{domain}/album/{comic_id}",
                        "X-Requested-With": "XMLHttpRequest",
                    }
                ),
            )
            resp.raise_for_status()
            result = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            if result.get("status") == "ok" or result.get("success"):
                return True
            # 如果返回了结果但不是明确的失败，也认为成功（某些站点返回空对象）
            return True
        except requests.RequestException as e:
            logger.error("jm add_to_favourites failed: %s", e, exc_info=True)
            raise RuntimeError(f"加入收藏夹失败: {e}") from e

    def check_favourite(self, comic_id: str) -> bool:
        """检查漫画是否在收藏夹中。

        Args:
            comic_id: 漫画 ID

        Returns:
            True 表示已收藏，False 表示未收藏

        Raises:
            RuntimeError: 请求失败或认证失效
        """
        if comic_id in self._known_favourite_ids:
            return True
        domain = self._ensure_domain()
        url = f"https://{domain}/ajax/favorite/check"
        try:
            resp = self.session.get(
                url,
                params={"aid": comic_id},
                timeout=self.timeout,
                headers=self._auth_headers(
                    {
                        "Referer": f"https://{domain}/",
                        "X-Requested-With": "XMLHttpRequest",
                    }
                ),
            )
            if resp.status_code == 404:
                logger.warning("jm check_favourite endpoint returned 404; falling back to not favourited")
                return False
            resp.raise_for_status()
            result = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            return bool(result.get("favorited") or result.get("is_favorite") or result.get("status") == "ok")
        except requests.RequestException as e:
            logger.error("jm check_favourite failed: %s", e, exc_info=True)
            raise RuntimeError(f"检查收藏状态失败: {e}") from e

    def remove_from_favourites(self, comic_id: str) -> bool:
        """将漫画从收藏夹移除。

        Args:
            comic_id: 漫画 ID

        Returns:
            成功返回 True

        Raises:
            RuntimeError: 请求失败或认证失效
        """
        domain = self._ensure_domain()
        url = f"https://{domain}/ajax/favorite/remove"
        try:
            resp = self.session.post(
                url,
                data={"aid": comic_id},
                timeout=self.timeout,
                headers=self._auth_headers(
                    {
                        "Referer": f"https://{domain}/album/{comic_id}",
                        "X-Requested-With": "XMLHttpRequest",
                    }
                ),
            )
            resp.raise_for_status()
            return True
        except requests.RequestException as e:
            logger.error("jm remove_from_favourites failed: %s", e, exc_info=True)
            raise RuntimeError(f"移除收藏夹失败: {e}") from e

    def search(self, keyword: str, page: int = 1, *, tag: str = "") -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索漫画。支持关键词、标签、排行模式和漫画 ID 直搜。"""
        domain = self._ensure_domain()
        if self._is_ranking_keyword(keyword):
            return self._search_ranking(keyword, page=page)

        # 漫画 ID 优先路径：纯数字 keyword 直接请求详情页
        if self._is_comic_id(keyword):
            try:
                comic = self.get_comic_detail(keyword)
                if comic:
                    return [comic], PaginationInfo(current_page=1, total_pages=1, total_items=1)
            except ParserResponseError:
                raise
            except Exception as e:
                logger.warning("jm id search fallback to keyword search: %s", e)

        url = self._build_search_url(keyword, page=page)
        try:
            html = self._request_text(url)
            return self._parse_search_results(html, domain=domain)
        except ParserResponseError:
            raise
        except Exception as e:
            logger.error("jm search failed: %s", e, exc_info=True)
            return [], None

    def random(self) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """随机漫画。"""
        domain = self._ensure_domain()
        url = self._build_random_url()
        try:
            html = self._request_text(url)
            return self._parse_search_results(html, domain=domain)
        except ParserResponseError:
            raise
        except Exception as e:
            logger.error("jm random failed: %s", e, exc_info=True)
            return [], None

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情，补齐图片 URL 列表。"""
        domain = self._ensure_domain()
        url = f"https://{domain}/album/{comic_id}"
        try:
            html = self._request_text(url)
            return self._parse_detail(html, comic_id=comic_id, domain=domain)
        except Exception as e:
            logger.error("jm get_comic_detail failed: %s", e, exc_info=True)
            return None

    def get_chapter_images(self, chapter_id: str) -> tuple[list[str], str]:
        """获取单个章节的图片 URL 列表与 scramble_id。

        章节图片在 /photo/{chapter_id} 页面，页面结构与专辑详情页一致，
        复用 _parse_detail 的图片提取逻辑（传入 chapter_id 作为 comic_id）。
        """
        domain = self._ensure_domain()
        url = f"https://{domain}/photo/{chapter_id}"
        html = self._request_text(url)
        detail = self._parse_detail(html, comic_id=chapter_id, domain=domain)
        return detail.image_urls, detail.scramble_id

    def _build_favourites_url(self, domain: str, page: int) -> str:
        """构造收藏夹请求 URL。

        jm 真实收藏夹 URL 格式为：
            https://{domain}/user/{username}/favorite/albums?page=N

        /user/favorites 旧路径已被服务端废弃，直接返回 403，不再使用。
        用户名必须在调用前通过 _ensure_username() 先行发现。
        """
        if not self._username:
            raise RuntimeError(
                "jm 用户名未知，无法构造收藏夹 URL。" "请先确保 verify_login_status() 或 _ensure_username() 已被调用。"
            )
        base = f"https://{domain}/user/{self._username}/favorite/albums"
        return base if page <= 1 else f"{base}?page={page}"

    def _ensure_username(self, domain: str) -> bool:
        """确保 _username 已被发现。若未知则请求首页提取。

        返回 True 表示成功发现用户名，False 表示未登录或发现失败。
        """
        if self._username:
            return True
        try:
            resp = self.session.get(
                f"https://{domain}/",
                timeout=self.timeout,
                allow_redirects=True,
                headers=self._auth_headers({"Referer": f"https://{domain}/"}),
            )
            if self._is_challenge_response(resp):
                logger.warning(
                    "_ensure_username: got anti-bot challenge (status=%d, %d bytes)",
                    resp.status_code,
                    len(resp.text or ""),
                )
                return False
            if resp.status_code != 200:
                logger.warning(
                    "_ensure_username: unexpected status=%d url=%s",
                    resp.status_code,
                    resp.url,
                )
                return False
            self._fix_encoding(resp)
            html = resp.text
            doc = etree.HTML(html)
            for href in doc.xpath('//a[contains(@href,"/favorite")]/@href'):
                m = re.search(r"/user/([^/?#]+)/favorite", href)
                if m:
                    self._username = m.group(1)
                    logger.info(
                        "Discovered jm username from homepage navbar: %s",
                        self._username,
                    )
                    return True
            _GENERIC = {"profile", "favorites", "setting", "my_favourite"}
            for href in doc.xpath('//a[contains(@href,"/user/")]/@href'):
                m = re.search(r"/user/([^/?#]+)", href)
                if m and m.group(1) not in _GENERIC:
                    self._username = m.group(1)
                    logger.info(
                        "Discovered jm username from user link: %s",
                        self._username,
                    )
                    return True
            logger.warning(
                "Could not discover jm username from homepage "
                "(not logged in or navbar structure changed). "
                "Response URL: %s, HTML length: %d, first 200 chars: %s",
                resp.url,
                len(html),
                html[:200],
            )
            return False
        except Exception as e:
            logger.warning("_ensure_username request failed: %s", e)
            return False

    def _request_favourites_page(self, url: str, domain: str) -> Any:
        """请求收藏夹页面，并对明确的反爬挑战执行有界恢复。"""
        headers = self._auth_headers({"Referer": f"https://{domain}/"})
        for attempt in range(_FAVOURITES_CHALLENGE_RETRIES + 1):
            resp = self.session.get(
                url,
                timeout=self.timeout,
                allow_redirects=True,
                headers=headers,
            )
            if resp.url and "/login" in str(resp.url):
                return resp
            if not self._is_challenge_response(resp):
                return resp

            logger.warning(
                "jm favourites anti-bot challenge (attempt=%d/%d, status=%d, bytes=%d)",
                attempt + 1,
                _FAVOURITES_CHALLENGE_RETRIES + 1,
                resp.status_code,
                len(resp.text or ""),
            )
            if attempt >= _FAVOURITES_CHALLENGE_RETRIES:
                raise AntiBotChallengeError(
                    "JM 站点人机验证持续阻断收藏夹请求，请完成站点人机验证后重试",
                    challenge_url=url,
                )

            if attempt == 0:
                try:
                    self.session.get(
                        f"https://{domain}/",
                        timeout=self.timeout,
                        allow_redirects=True,
                        headers=headers,
                    )
                except Exception as e:
                    logger.debug("jm favourites challenge warm-up failed: %s", e)

        raise AssertionError("unreachable")

    def favourites(
        self, page: int = 1, raise_errors: bool = False
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """获取 jm 收藏夹漫画。

        Args:
            page: 页码
            raise_errors: 如果为 True，异常会向上传播而不是静默返回空列表

        Returns:
            (漫画信息列表, 分页信息, 是否需要登录)
        """
        domain = self._ensure_domain()
        # 用户名未知时，先从首页导航栏发现（verify_login_status 通常已完成此步骤）
        if not self._username and not self._ensure_username(domain):
            logger.warning("jm favourites: username unknown and homepage discovery failed (not logged in?)")
            return [], None, True
        try:
            url = self._build_favourites_url(domain, page)
            resp = self._request_favourites_page(url, domain)
            # 检查是否重定向到登录页面
            if resp.url and "/login" in str(resp.url):
                return [], None, True
            resp.raise_for_status()
            self._fix_encoding(resp)
            html = resp.text
            if self._is_challenge_page(html):
                raise AntiBotChallengeError(
                    "JM 站点人机验证持续阻断收藏夹请求，请完成站点人机验证后重试",
                    challenge_url=url,
                )
            return self._parse_favourites_html(html, domain=domain, enrich_missing_titles=True)
        except Exception as e:
            logger.error("jm favourites failed: %s", e, exc_info=True)
            if raise_errors:
                raise
            return [], None, False

    def parse_favourites_snapshot(
        self,
        html: str,
        source_url: str,
        page: int = 1,
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """解析 Electron 已验证窗口捕获的收藏夹 DOM，不发起收藏夹网络请求。"""
        domain = self._validate_favourites_snapshot(html, source_url, page)
        if self._is_challenge_page(html):
            raise AntiBotChallengeError(
                "浏览器页面仍处于 JM 人机验证状态，请完成验证后重试",
                challenge_url=source_url,
            )
        return self._parse_favourites_html(html, domain=domain, enrich_missing_titles=False)

    def _validate_favourites_snapshot(self, html: str, source_url: str, page: int) -> str:
        if not isinstance(html, str) or not html.strip():
            raise ValueError("JM 收藏夹页面快照为空")
        if len(html.encode("utf-8")) > _FAVOURITES_SNAPSHOT_MAX_BYTES:
            raise ValueError("JM 收藏夹页面快照超过 5 MiB 限制")
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 1000:
            raise ValueError("JM 收藏夹页面快照页码无效")
        if not isinstance(source_url, str) or len(source_url) > 2048:
            raise ValueError("JM 收藏夹页面快照 URL 无效")

        parsed = urlparse(source_url)
        expected_domain = self._ensure_domain().lower()
        if (
            parsed.scheme != "https"
            or bool(parsed.username or parsed.password)
            or parsed.port not in (None, 443)
            or (parsed.hostname or "").lower() != expected_domain
            or not _FAVOURITES_PATH_RE.fullmatch(parsed.path)
            or parsed.fragment
        ):
            raise ValueError("JM 收藏夹页面快照 URL 不受信任")

        query = parse_qs(parsed.query, keep_blank_values=True)
        if any(key != "page" for key in query) or any(len(values) != 1 for values in query.values()):
            raise ValueError("JM 收藏夹页面快照查询参数无效")
        expected_page = str(page)
        if page == 1:
            if query.get("page", ["1"])[0] != expected_page:
                raise ValueError("JM 收藏夹页面快照页码不匹配")
        elif query.get("page") != [expected_page]:
            raise ValueError("JM 收藏夹页面快照页码不匹配")
        return expected_domain

    def _parse_favourites_html(
        self,
        html: str,
        *,
        domain: str,
        enrich_missing_titles: bool,
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """解析收藏夹 HTML；网络响应与浏览器 DOM 快照共用此入口。"""
        if not html or not html.strip():
            logger.warning("jm favourites returned empty HTML")
            return [], None, False
        doc = etree.HTML(html)
        if doc is None:
            raise ParserResponseError("JM 收藏夹页面无法解析")
        if doc.xpath('//div[contains(text(),"請先登入")]'):
            return [], None, True
        try:
            comics = self._parse_favourites_items(doc, domain=domain)
        except Exception as e:
            raise ParserResponseError(f"JM 收藏夹条目解析失败: {e}") from e
        self._known_favourite_ids.update(comic.id for comic in comics if comic.id)
        try:
            pagination = self._parse_pagination(doc)
        except Exception:
            pagination = None
            logger.warning("Failed to parse favourites pagination", exc_info=True)
        if enrich_missing_titles:
            try:
                self._fill_missing_titles(comics, domain)
            except Exception:
                logger.warning("Failed to enrich jm favourites titles", exc_info=True)
        return comics, pagination, False

    def _parse_favourites_items(self, doc, domain: str) -> list[ComicInfo]:
        """解析收藏夹页面的漫画列表。"""
        items = doc.xpath('//div[contains(@class,"thumb-overlay")]')
        if not items:
            logger.debug("No thumb-overlay items found in favourites page; trying alternate selectors")
            # The favourites page may use a different container structure
            items = doc.xpath('//div[contains(@class,"thumb") and not(contains(@class,"thumb-overlay"))]')
        comics = []
        seen: set[str] = set()
        for item in items:
            try:
                comic = self._parse_search_item(item, domain=domain)
                if comic and comic.id not in seen:
                    seen.add(comic.id)
                    comics.append(comic)
                elif comic:
                    logger.debug("Skipped duplicate favourites item: id=%s", comic.id)
            except Exception as e:
                logger.debug("Parse favourites item skipped: %s", e)
        if comics:
            first = comics[0]
            logger.info(
                "Parsed %d favourites items. First: id=%s title=%s cover=%s",
                len(comics),
                first.id,
                first.title[:50] if first.title else "(empty)",
                first.cover_url[:60] if first.cover_url else "(empty)",
            )
        elif items:
            # Items found but none parsed — log raw HTML for diagnosis
            raw_html = etree.tostring(items[0], encoding="unicode")
            logger.warning(
                "No comics parsed from %d thumb-overlay items. First item HTML (truncated 2KB):\n%s",
                len(items),
                raw_html[:2048],
            )
        else:
            logger.warning("No thumb-overlay or thumb items found in favourites page")
        return comics

    def _serialize_cookies_for_title_fetch(self) -> list[tuple[str, str]]:
        """将主 session 的 cookies 序列化为 (name, value) 元组列表。"""
        try:
            cookie_dict = self.session.cookies.get_dict()
            return list(cookie_dict.items())
        except Exception:
            logger.warning(
                "Failed to serialize main session cookies for title fetch",
                exc_info=True,
            )
            return []

    def _fill_missing_titles(self, comics: list[ComicInfo], domain: str) -> None:
        """并发获取专辑详情页标题，补全 HTML 中 JS 懒加载导致的缺失标题。"""
        from .title_resolver import fill_missing_titles

        main_cookies = self._serialize_cookies_for_title_fetch()
        fill_missing_titles(comics, domain, main_cookies, self.timeout)

    def _search_ranking(self, keyword: str, page: int = 1) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """排行搜索。"""
        domain = self._ensure_domain()
        params = RANKING_MAPPINGS.get(keyword, {"t": "w", "o": "mr"})
        url = f"https://{domain}/albums?t={params['t']}&o={params['o']}"
        if page > 1:
            url += f"&page={page}"
        try:
            html = self._request_text(url)
            return self._parse_search_results(html, domain=domain)
        except Exception as e:
            logger.error("jm ranking search failed: %s", e, exc_info=True)
            return [], None

    @staticmethod
    def _is_ranking_keyword(keyword: str) -> bool:
        return bool(_RANKING_RE.match(keyword or ""))

    @staticmethod
    def _is_comic_id(keyword: str) -> bool:
        """判断 keyword 是否为纯数字漫画专辑 ID。"""
        return bool(_COMIC_ID_RE.match(keyword or ""))

    @staticmethod
    def _is_challenge_page(html: str) -> bool:
        """检测 Cloudflare/反爬挑战页面。"""
        lower = (html or "").lower()
        return any(kw in lower for kw in _CHALLENGE_KEYWORDS)

    @classmethod
    def _is_challenge_response(cls, resp: Any) -> bool:
        """结合响应头和正文识别 Cloudflare/反爬挑战。"""
        headers = getattr(resp, "headers", None)
        if headers:
            for name, value in headers.items():
                if str(name).lower().strip() == "cf-mitigated" and str(value).lower().strip() == "challenge":
                    return True
        text = getattr(resp, "text", "")
        return isinstance(text, str) and cls._is_challenge_page(text)

    @staticmethod
    def _fix_encoding(resp) -> None:
        """Fix response encoding if server returns wrong charset."""
        enc = (resp.encoding or "").lower()
        if not enc or enc in ("iso-8859-1", "latin-1"):
            resp.encoding = "utf-8"

    def _build_search_url(self, keyword: str, page: int = 1) -> str:
        domain = self._ensure_domain()
        url = SEARCH_URL_TEMPLATE.format(domain=domain, query=quote(keyword))
        if page > 1:
            url += f"&page={page}"
        return url

    def _build_random_url(self) -> str:
        domain = self._ensure_domain()
        return RANDOM_URL_TEMPLATE.format(domain=domain)

    def _request_text(self, url: str) -> str:
        domain = self._ensure_domain()
        headers = self._auth_headers({"Referer": f"https://{domain}/"})
        resp = self.session.get(url, timeout=self.timeout, allow_redirects=True, headers=headers)
        resp.raise_for_status()
        self._fix_encoding(resp)
        return resp.text

    def _parse_search_results(self, html: str, domain: str) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """解析搜索结果页面。若响应为详情页则返回单条结果。"""
        # 详情页兜底识别：服务端可能对数字/特殊关键词直接返回详情页
        if "album_photo_cover" in html:
            id_match = re.search(r"var\s+aid\s*=\s*(\d+);", html)
            if id_match:
                comic_id = id_match.group(1)
                try:
                    comic = self._parse_detail(html, comic_id=comic_id, domain=domain)
                    return [comic], PaginationInfo(current_page=1, total_pages=1, total_items=1)
                except Exception as e:
                    logger.warning("jm parse detail page from search response failed: %s", e)

        doc = etree.HTML(html)
        items = doc.xpath('//div[contains(@class,"thumb-overlay")]')
        comics = []
        for item in items:
            try:
                comic = self._parse_search_item(item, domain=domain)
                if comic:
                    comics.append(comic)
            except Exception as e:
                logger.debug("Parse search item skipped: %s", e)
        pagination = self._parse_pagination(doc)
        return comics, pagination

    @staticmethod
    def _clean_texts(values) -> list[str]:
        """清洗并去重文本列表，保持原始顺序。"""
        return list(dict.fromkeys(v.strip() for v in (values or []) if v and v.strip()))

    def _parse_search_item(self, item, domain: str) -> ComicInfo | None:
        """解析单个搜索结果项。

        除 id/标题/封面外，搜索卡片还携带作者、标签和分类，
        一并提取以便卡片直接显示并参与标签黑名单过滤。
        """
        link = item.xpath(".//a/@href")
        if not link:
            return None
        href = link[0]
        id_match = re.search(r"/album/(\d+)", href)
        if not id_match:
            return None
        comic_id = id_match.group(1)

        # Preferred: jm favourites uses <div class="image-item-text">
        text_div = item.xpath('.//div[contains(@class,"image-item-text")]/text()')
        title = text_div[0].strip() if text_div else ""
        if not title:
            title_el = item.xpath(".//img/@title") or item.xpath(".//img/@alt")
            title = title_el[0].strip() if title_el else ""
        if not title:
            span_title = item.xpath('.//span[contains(@class,"video-title")]/text()')
            title = span_title[0].strip() if span_title else ""
        if not title:
            div_title = item.xpath('.//div[contains(@class,"video-title")]/text()')
            title = div_title[0].strip() if div_title else ""
        if not title:
            link_text = item.xpath(".//a/text()")
            title = link_text[0].strip() if link_text else ""
        if not title:
            link_title = item.xpath(".//a/@title")
            title = link_title[0].strip() if link_title else ""
        if not title:
            title = "未知标题"

        img_el = item.xpath(".//img/@data-original") or item.xpath(".//img/@data-src") or item.xpath(".//img/@src")
        cover_url = img_el[0] if img_el else ""
        if cover_url and not cover_url.startswith("http"):
            cover_url = f"https://{domain}{cover_url}"
        if cover_url.endswith("blank.jpg"):
            cover_url = ""

        # 追踪 CDN 域名
        if cover_url and not self._cdn_domain:
            cdn_match = re.match(r"https://([^/]+)/", cover_url)
            if cdn_match:
                self._cdn_domain = cdn_match.group(1)

        # 从卡片容器（封面外两层 div）提取作者/标签/分类
        author: str | None = None
        tags: list[str] = []
        category: str | None = None
        parent_card = item.xpath("./parent::*/parent::div")
        if parent_card:
            card = parent_card[0]
            artist_el = card.xpath('.//div//a[contains(@href,"main_tag=2")]/text()')
            if artist_el and artist_el[0].strip():
                author = artist_el[0].strip()
            tags = self._clean_texts(card.xpath('.//div[contains(@class,"tags")]//a[@class="tag"]/text()'))
        cat_el = item.xpath('.//div[@class="category-icon"]/div/text()')
        if cat_el:
            category = " ".join(t.strip() for t in cat_el if t.strip()).strip() or None

        return ComicInfo(
            id=comic_id,
            title=title,
            author=author,
            tags=tags,
            category=category,
            cover_url=cover_url,
            preview_url=f"https://{domain}/album/{comic_id}",
            media_id=comic_id,
            comic_source="JM",
            source_site="jm",
        )

    def _parse_pagination(self, doc) -> PaginationInfo | None:
        """解析分页信息。

        jm 分页结构（实测）：
          <ul class="pagination">
            <li><a href="...?page=1">«</a></li>   <!-- 上一页 -->
            <li class=""><a href="...?page=1">1</a></li>
            <li class="active">2</li>              <!-- 当前页：只有文本，无 <a> -->
            <li class=""><a href="...?page=3">3</a></li>
            ...
            <li class="hidden-xs"><a href="...?page=125">125</a></li>
            <li><a href="...?page=3">»</a></li>   <!-- 下一页 -->
          </ul>

        当前页在 class="active" 的 <li> 文本中，其余页码从 <a href> 中的
        ?page=N 提取，因此不能依赖链接文本（«/» 等非数字文本会干扰）。
        """
        pag_uls = doc.xpath('//ul[contains(@class,"pagination")]')
        if not pag_uls:
            return None
        ul = pag_uls[0]

        # 从 href 中提取所有数字页码
        pages: set[int] = set()
        for href in ul.xpath(".//a/@href"):
            m = re.search(r"[?&]page=(\d+)", href)
            if m:
                pages.add(int(m.group(1)))

        # 当前页：class="active" 的 <li> 的文本内容
        current_page = 1
        for li in ul.xpath('./li[contains(@class,"active")]'):
            raw = "".join(li.itertext()).strip()
            try:
                current_page = int(raw)
                break
            except ValueError:
                continue

        if not pages and current_page == 1:
            # 只有一页，pagination 存在但无翻页链接
            return PaginationInfo(current_page=1, total_pages=1, total_items=0)

        # total_pages = max(href 中的页码, current_page)
        total_pages = max(max(pages, default=1), current_page)
        return PaginationInfo(
            current_page=current_page,
            total_pages=total_pages,
            total_items=0,
        )

    def _parse_detail(self, html: str, comic_id: str, domain: str) -> ComicInfo:
        """解析漫画详情页面 — 编排器。"""
        doc = etree.HTML(html)
        title = self._extract_title_from_doc(doc)
        scope = self._locate_info_block(doc)
        scramble_id = self._extract_scramble_id(html)
        chapters = self._parse_detail_chapters(doc)
        image_urls = self._parse_detail_images(doc, domain)

        metadata = self._parse_detail_metadata(scope, html, domain)
        total_pages = max(metadata.pages, len(image_urls))
        image_urls = self._expand_image_urls(image_urls, total_pages, comic_id)

        cover_url = self._extract_cover_url(doc, domain)

        return ComicInfo(
            id=comic_id,
            title=title,
            author=metadata.author,
            pages=total_pages,
            tags=metadata.tags,
            category=metadata.category,
            publish_date=metadata.publish_date,
            cover_url=cover_url,
            preview_url=f"https://{domain}/album/{comic_id}",
            media_id=comic_id,
            comic_source="JM",
            source_site="jm",
            scramble_id=scramble_id,
            image_urls=image_urls,
            chapters=chapters,
            album_id=comic_id,
            album_total_chapters=len(chapters) if chapters else 1,
        )

    def _extract_title_from_doc(self, doc) -> str:
        """5 策略标题提取：h1 → og:title → twitter:title → page title → 未知标题"""
        title_el = doc.xpath('//h1[@id="book-name"]/text()') or doc.xpath("//h1/text()")
        title_from_h1 = title_el[0].strip() if title_el else ""
        if not title_from_h1:
            og_title = doc.xpath('//meta[@property="og:title"]/@content')
            if og_title and og_title[0].strip():
                title_from_h1 = og_title[0].strip()
        if not title_from_h1:
            twitter_title = doc.xpath('//meta[@name="twitter:title"]/@content')
            if twitter_title and twitter_title[0].strip():
                title_from_h1 = twitter_title[0].strip()
        if not title_from_h1:
            page_title = doc.xpath("//title/text()")
            if page_title and page_title[0].strip():
                raw = page_title[0].strip()
                for sep in (" | ", " - ", " – ", " — "):
                    if sep in raw:
                        raw = raw.split(sep, 1)[0].strip()
                if raw and raw.lower() not in (
                    "jm",
                    "18comic",
                    "jm",
                    "18comic.vip",
                    "jmcomic-zzz.one",
                ):
                    title_from_h1 = raw
        return title_from_h1 or "未知标题"

    @staticmethod
    def _locate_info_block(doc):
        """定位信息区块：封面块之后的第一个兄弟 div"""
        cover_blocks = doc.xpath('//div[@id="album_photo_cover"]')
        if cover_blocks:
            siblings = cover_blocks[-1].xpath("./following-sibling::div")
            if siblings:
                return siblings[0]
        return None

    @staticmethod
    def _extract_scramble_id(html: str) -> str:
        """从 JavaScript 中提取 scramble_id"""
        scramble_match = re.search(r"var scramble_id\s*=\s*(\d+)", html)
        return scramble_match.group(1) if scramble_match else ""

    def _parse_detail_chapters(self, doc) -> list[ChapterInfo]:
        """解析章节列表（多章节专辑），取最后一个 episode 块"""
        chapters: list[ChapterInfo] = []
        episode_blocks = doc.xpath('//div[@class="episode"]')
        if episode_blocks:
            for a in episode_blocks[-1].xpath("./ul/a"):
                chap_id = (a.xpath("./@data-album") or [""])[0]
                data_index = (a.xpath("./@data-index") or ["0"])[0]
                name_nodes = self._clean_texts(a.xpath(".//h3/text()"))
                if not chap_id:
                    continue
                try:
                    idx = int(data_index) + 1
                except (ValueError, TypeError):
                    idx = len(chapters) + 1
                chapters.append(
                    ChapterInfo(
                        id=chap_id,
                        name=name_nodes[0] if name_nodes else f"第 {idx} 話",
                        index=idx,
                    )
                )
        return chapters

    @staticmethod
    def _parse_detail_images(doc, domain: str) -> list[str]:
        """提取图片 URL（支持 data-src 和 data-original 两种懒加载）"""
        image_urls: list[str] = []
        img_elements = doc.xpath('.//img[contains(@id,"album_photo_")]')
        for img in img_elements:
            img_url = img.xpath("./@data-src") or img.xpath("./@data-original") or img.xpath("./@src")
            if img_url:
                url = img_url[0]
                if not url.startswith("http"):
                    url = f"https://{domain}{url}"
                if "blank.jpg" in url:
                    continue
                image_urls.append(url)
        return image_urls

    def _parse_detail_metadata(self, scope, html: str, domain: str) -> _DetailMetadata:
        """提取作者、标签、页数、发布日期"""
        effective_scope = scope if scope is not None else etree.HTML(html)

        authors = self._clean_texts(effective_scope.xpath('.//span[@data-type="author"]/a/text()'))
        author = authors[0] if authors else None

        tags = self._clean_texts(effective_scope.xpath('.//span[@data-type="tags"]/a/text()'))
        works = self._clean_texts(effective_scope.xpath('.//span[@data-type="works"]/a/text()'))
        actors = self._clean_texts(effective_scope.xpath('.//span[@data-type="actor"]/a/text()'))
        merged_tags = list(dict.fromkeys([*tags, *works, *actors]))
        category = works[0] if works else None

        pages = 0
        pages_text = effective_scope.xpath('.//div[contains(text(),"頁數") or contains(text(),"页数")]/text()')
        if pages_text:
            m = re.search(r"\d+", pages_text[0])
            if m:
                pages = int(m.group())

        publish_date = None
        for span in effective_scope.xpath('.//span[@itemprop="datePublished"]'):
            text = "".join(span.itertext())
            content = span.get("content")
            if not content:
                continue
            if "上架" in text or "上傳" in text or "上传" in text:
                publish_date = content
                break
            if publish_date is None:
                publish_date = content
        if not publish_date:
            date_match = re.search(r'itemprop="datePublished"\s+content="(\d{4}-\d{2}-\d{2})"', html)
            if not date_match:
                date_match = re.search(
                    r"(?:上架日期|上傳日期|上传日期)\s*[:：]\s*(\d{4}-\d{2}-\d{2})",
                    html,
                )
            if date_match:
                publish_date = date_match.group(1)

        return _DetailMetadata(
            author=author,
            tags=merged_tags,
            category=category,
            pages=pages,
            publish_date=publish_date,
        )

    @staticmethod
    def _expand_image_urls(image_urls: list[str], total_pages: int, comic_id: str) -> list[str]:
        """若页面上的图片数少于总页数，用 URL 模式生成所有图片 URL"""
        if len(image_urls) >= total_pages or not image_urls:
            return image_urls
        sample_url = image_urls[0]
        url_match = re.match(r"(https://[^/]+)/media/photos/\d+/(\d+)\.(\w+)", sample_url)
        if url_match:
            cdn_base = url_match.group(1)
            ext = url_match.group(3)
            logger.debug("Generated %d image URLs from pattern (ext=%s)", total_pages, ext)
            return [f"{cdn_base}/media/photos/{comic_id}/{i:05d}.{ext}" for i in range(1, total_pages + 1)]
        logger.warning("Sample image URL does not match expected pattern: %s", sample_url)
        return image_urls

    @staticmethod
    def _extract_cover_url(doc, domain: str) -> str:
        """提取封面图片 URL"""
        cover_el = doc.xpath('.//div[@id="album_photo_cover"]//img/@src')
        if cover_el:
            url = cover_el[0]
            if not url.startswith("http"):
                url = f"https://{domain}{url}"
            return url
        return ""
