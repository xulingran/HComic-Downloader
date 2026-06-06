"""moeimg.fan 页面解析模块"""

from __future__ import annotations

import logging
import re
from collections import OrderedDict
from datetime import datetime
from typing import Any
from urllib.parse import urljoin

import requests

from constants import DEFAULT_USER_AGENT
from models import ComicInfo, PaginationInfo
from sources.base import ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session, configure_session_auth

logger = logging.getLogger(__name__)


class AuthRequiredError(RuntimeError):
    """需要登录但未提供凭据。"""


class MoeImgParser(ParserContextMixin):
    """moeimg.fan 解析器。"""

    BASE_URL = "https://moeimg.fan"
    _MAX_CACHE_SIZE = 500
    _MAX_SEARCH_ITEMS = 5
    QUERY_MODE_REGEX = re.compile(
        r"^\s*(author|artist|tag)\s*:\s*(.*?)\s*$", re.IGNORECASE
    )
    ENTITY_ID_IN_TEXT_REGEX = re.compile(r"(?:^|/)(?:fa)?(\d+)(?:/|$)")
    HEADERS = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,en-US;q=0.5,en;q=0.3",
        "Referer": f"{BASE_URL}/",
    }
    CHAPTER_IMAGE_REGEX = re.compile(r'data-url=["\']([^"\']+)["\']')

    def __init__(self, timeout: int = 30, cookie: str = "", user_agent: str = ""):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        apply_system_proxy_to_session(self.session)
        self.configure_auth(cookie=cookie, user_agent=user_agent)
        self._manga_detail_cache: dict[str, dict] = OrderedDict()
        self._author_id_cache: dict[str, str] = OrderedDict()
        self._tag_id_cache: dict[str, str] = OrderedDict()
        self._stored_username: str = ""
        self._stored_password: str = ""

    def configure_auth(
        self, cookie: str = "", user_agent: str = "", bearer_token: str = ""
    ):
        """配置登录相关请求头。"""
        configure_session_auth(
            self.session, self.HEADERS, cookie, user_agent, bearer_token
        )

    def verify_login_status(self) -> tuple[bool, str]:
        """验证 moeimg 登录状态。"""
        try:
            self._ensure_session()
        except AuthRequiredError:
            return False, "未登录，请输入用户名密码或粘贴 curl"
        try:
            resp = self.session.get(
                f"{self.BASE_URL}/member/bookmarks",
                timeout=self.timeout,
                allow_redirects=False,
            )
            if resp.status_code == 200 and "u-fav-item" in resp.text:
                return True, "已登录"
            return False, "登录已过期，请重新登录"
        except requests.RequestException:
            return False, "网络错误，无法验证登录状态"

    def login(self, username: str, password: str) -> str:
        """通过 API 登录 moeimg，返回 session cookie 字符串。"""
        resp = self.session.post(
            f"{self.BASE_URL}/auth/login",
            files={"username": (None, username), "password": (None, password)},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise ValueError("登录失败，请检查用户名和密码")
        session_value = self.session.cookies.get("__SESSION")
        if not session_value:
            raise ValueError("登录成功但未获取到 session cookie")
        return f"__SESSION={session_value}"

    def _ensure_session(self):
        """懒登录：确保 session cookie 存在，否则自动登录。"""
        if self.session.cookies.get("__SESSION"):
            return
        cookie_header = (self.session.headers.get("Cookie") or "").strip()
        if cookie_header and "__SESSION" in cookie_header:
            from http.cookies import SimpleCookie

            parsed = SimpleCookie(cookie_header)
            for key, morsel in parsed.items():
                self.session.cookies.set(
                    key, morsel.value, domain="moeimg.fan", path="/"
                )
            if self.session.cookies.get("__SESSION"):
                logger.info("Restored __SESSION cookie from header into jar")
                return
        if self._stored_username and self._stored_password:
            self.login(self._stored_username, self._stored_password)
            return
        raise AuthRequiredError("需要登录 moeimg")

    def set_stored_credentials(self, username: str, password: str):
        """存储用户名密码用于懒登录。"""
        self._stored_username = username or ""
        self._stored_password = password or ""

    def search(
        self, keyword: str, page: int = 1, *, tag: str = ""
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索漫画。"""
        mode, keyword = self._parse_query_mode(keyword)
        try:
            page_num = max(1, int(page))
        except (TypeError, ValueError):
            page_num = 1

        try:
            data: dict | None = None
            if mode == "keyword" and not keyword:
                data = self._request_json(
                    "/spa/latest-manga", params={"page": page_num}
                )
            elif mode == "keyword":
                data = self._request_json(
                    "/spa/search", params={"query": keyword, "page": page_num}
                )
            else:
                data = self._search_entity(mode=mode, keyword=keyword, page=page_num)
        except ParserResponseError:
            return [], None

        if not data:
            return [], None

        comics = self._parse_search_manga_list(data)

        pagination = self._parse_pagination(
            data.get("pagi"),
            requested_page=page_num,
            current_count=len(comics),
        )
        return comics, pagination

    def favourites(
        self, page: int = 1, raise_errors: bool = False
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """获取 moeimg 收藏夹漫画列表。

        Returns:
            (漫画列表, 分页信息, 是否需要登录)
        """
        try:
            self._ensure_session()
        except AuthRequiredError:
            return [], None, True
        try:
            page_num = max(1, int(page))
            resp = self.session.get(
                f"{self.BASE_URL}/member/bookmarks",
                params={"page": page_num},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            html = resp.text
            if not html or "u-fav-item" not in html:
                if page_num > 1:
                    return [], None, False
                return [], None, False
            comics = self._parse_bookmarks_html(html)
            pagination = self._parse_bookmarks_pagination(html, page_num, len(comics))
            return comics, pagination, False
        except Exception as e:
            logger.error("moeimg favourites failed: %s", e, exc_info=True)
            if raise_errors:
                raise
            return [], None, False

    def _parse_bookmarks_html(self, html: str) -> list[ComicInfo]:
        """解析收藏夹页面 HTML，提取漫画列表。"""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        comics: list[ComicInfo] = []
        for item in soup.select(".u-fav-item"):
            try:
                btn = item.select_one(".u-fav-btn a[data-manga-id]")
                if not btn:
                    continue
                manga_id = btn.get("data-manga-id", "")
                if not manga_id:
                    continue
                link_el = item.select_one(".u-img-holder a")
                title_el = item.select_one(".u-manga-title a")
                img_el = item.select_one(".u-img-holder img")
                title = (
                    (
                        title_el.get("title") or title_el.get_text(strip=True) or ""
                    ).strip()
                    if title_el
                    else "未知标题"
                )
                cover_url = (img_el.get("src") or "").strip() if img_el else None
                preview_url = (
                    f"{self.BASE_URL}{link_el['href']}"
                    if link_el and link_el.get("href")
                    else f"{self.BASE_URL}/post/fa{manga_id}"
                )
                comics.append(
                    ComicInfo(
                        id=str(manga_id),
                        title=title,
                        author=None,
                        pages=0,
                        category=None,
                        tags=[],
                        publish_date=None,
                        cover_url=cover_url,
                        preview_url=preview_url,
                        media_id=str(manga_id),
                        comic_source="MOEIMG",
                        source_site="moeimg",
                    )
                )
            except Exception as e:
                logger.debug("Failed to parse bookmark item: %s", e)
                continue
        return comics

    @staticmethod
    def _parse_bookmarks_pagination(
        html: str, requested_page: int, current_count: int
    ) -> PaginationInfo | None:
        """解析收藏夹分页信息。"""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        page_links = soup.select(".pagination a")
        if not page_links:
            if current_count == 0 and requested_page > 1:
                return None
            return PaginationInfo(
                current_page=requested_page,
                total_pages=requested_page,
                limit=current_count or 20,
                total_items=current_count,
            )
        max_page = requested_page
        for link in page_links:
            try:
                num = int(link.get_text(strip=True))
                max_page = max(max_page, num)
            except ValueError:
                continue
        return PaginationInfo(
            current_page=requested_page,
            total_pages=max_page,
            limit=current_count or 20,
            total_items=max(current_count, (max_page - 1) * 20 + current_count),
        )

    def check_favourite(self, manga_id: str) -> bool:
        """检查指定漫画是否已收藏。"""
        try:
            self._ensure_session()
        except AuthRequiredError:
            return False
        try:
            resp = self.session.get(
                f"{self.BASE_URL}/ajax/bookmark-status/{manga_id}",
                timeout=self.timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("status") == 1
        except Exception as e:
            logger.error(
                "moeimg check_favourite failed for %s: %s", manga_id, e, exc_info=True
            )
            return False

    def add_to_favourites(self, manga_id: str) -> bool:
        """添加漫画到收藏夹。toggle 模式，先检查状态避免重复。"""
        try:
            self._ensure_session()
        except AuthRequiredError:
            return False
        try:
            if self.check_favourite(manga_id):
                return True
            resp = self.session.get(
                f"{self.BASE_URL}/ajax/bookmark/{manga_id}",
                timeout=self.timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("status") == 1
        except Exception as e:
            logger.error(
                "moeimg add_to_favourites failed for %s: %s", manga_id, e, exc_info=True
            )
            return False

    def remove_from_favourites(self, manga_id: str) -> bool:
        """从收藏夹移除漫画。toggle 模式，先检查状态避免误添加。"""
        try:
            self._ensure_session()
        except AuthRequiredError:
            return False
        try:
            if not self.check_favourite(manga_id):
                return True
            resp = self.session.get(
                f"{self.BASE_URL}/ajax/bookmark/{manga_id}",
                timeout=self.timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("status") == -1
        except Exception as e:
            logger.error(
                "moeimg remove_from_favourites failed for %s: %s",
                manga_id,
                e,
                exc_info=True,
            )
            return False

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情并补全可下载图片地址。

        优先使用 SPA API，失败时回退到 HTML 页面解析。
        """
        try:
            detail_data = self._get_manga_detail_payload(comic_id)
        except ParserResponseError:
            detail_data = None

        if not isinstance(detail_data, dict):
            return self._get_comic_detail_from_html(comic_id)

        detail = detail_data.get("detail") or {}
        if not isinstance(detail, dict):
            detail = {}

        try:
            chapter_detail = self._fetch_read_data(comic_id)
        except ParserResponseError:
            chapter_detail = {}

        tags = self._extract_manga_tags(
            detail_data, detail, chapter_detail=chapter_detail
        )

        has_images = bool(chapter_detail.get("chapter_content"))
        has_title = bool((detail.get("manga_name") or "").strip())

        if not has_title and not has_images:
            return self._get_comic_detail_from_html(comic_id)

        title = (
            (detail.get("manga_name") or "").strip()
            or (detail.get("ja_manga_name") or "").strip()
            or "未知标题"
        )

        authors_data = (
            detail_data.get("authors")
            or detail.get("authors")
            or detail_data.get("author")
            or []
        )
        author = self._extract_first_name(authors_data, "author_name")
        category = (detail.get("category") or "").strip() or None

        publish_date = self._format_iso_date(
            chapter_detail.get("chapter_date_published")
            or detail.get("manga_date_published")
        )

        cover_url = detail.get("manga_cover_img") or detail.get("manga_cover_img_full")
        preview_url = f"{self.BASE_URL}/post/fa{comic_id}"

        image_urls = self._extract_manga_images(chapter_detail)
        preview_pages = self._count_preview_images(detail_data.get("preview_imgs"))
        pages = self._resolve_total_pages(chapter_detail, image_urls, preview_pages)

        return ComicInfo(
            id=str(detail.get("manga_id") or comic_id),
            title=title,
            author=author,
            pages=pages,
            category=category,
            tags=tags,
            publish_date=publish_date,
            cover_url=cover_url,
            preview_url=preview_url,
            media_id=str(detail.get("manga_id") or comic_id),
            comic_source="MOEIMG",
            source_site="moeimg",
            image_urls=image_urls,
        )

    def _get_comic_detail_from_html(
        self,
        comic_id: str,
        fallback_tags: list[str] | None = None,
        fallback_images: list[str] | None = None,
    ) -> ComicInfo | None:
        """通过解析 HTML 详情页获取漫画信息。

        当 SPA API 不可用或返回数据不完整时作为回退方案。

        Args:
            comic_id: 漫画 ID
            fallback_tags: SPA API 已获取的标签（可为空）
            fallback_images: SPA API 已获取的图片地址（可为空）
        """
        from bs4 import BeautifulSoup

        url = f"{self.BASE_URL}/post/fa{comic_id}"
        try:
            resp = self.session.get(url, timeout=self.timeout)
            resp.raise_for_status()
            html = resp.text
        except requests.RequestException as e:
            logger.error(
                "MoeImg HTML detail fetch failed: %s (%s)", url, e, exc_info=True
            )
            return None

        soup = BeautifulSoup(html, "html.parser")

        title_el = soup.select_one("h1.manga-title")
        title = (
            (title_el.get_text(strip=True) or "未知标题") if title_el else "未知标题"
        )

        author: str | None = None
        category: str | None = None
        tags: list[str] = list(fallback_tags) if fallback_tags else []
        cover_url: str | None = None

        for li in soup.select(".manga-detail li"):
            md_title_el = li.select_one(".md-title")
            if not md_title_el:
                continue
            md_title = md_title_el.get_text(strip=True).rstrip(":")
            md_content_el = li.select_one(".md-content")
            if not md_content_el:
                continue

            if md_title == "Category":
                a = md_content_el.select_one("a")
                category = (
                    a.get_text(strip=True) if a else md_content_el.get_text(strip=True)
                ) or None
            elif md_title == "Author":
                a = md_content_el.select_one("a")
                author = (
                    a.get_text(strip=True) if a else md_content_el.get_text(strip=True)
                ) or None
            elif md_title == "Tags":
                if not tags:
                    for a in md_content_el.select("a"):
                        tag_text = a.get_text(strip=True)
                        if tag_text:
                            tags.append(tag_text)

        img_el = soup.select_one(".manga-img img")
        if img_el:
            cover_url = (img_el.get("src") or "").strip() or None

        time_el = soup.select_one(".manga-detail time")
        publish_date = None
        if time_el and time_el.get("datetime"):
            publish_date = self._format_iso_date(time_el["datetime"])

        image_urls = list(fallback_images) if fallback_images else []
        preview_count = len(soup.select(".preview-imgs img[data-src]"))
        pages = max(preview_count, len(image_urls))

        return ComicInfo(
            id=str(comic_id),
            title=title,
            author=author,
            pages=pages,
            category=category,
            tags=tags,
            publish_date=publish_date,
            cover_url=cover_url,
            preview_url=url,
            media_id=str(comic_id),
            comic_source="MOEIMG",
            source_site="moeimg",
            image_urls=image_urls,
        )

    def _fetch_read_data(self, comic_id: str) -> dict[str, Any]:
        """获取漫画阅读数据并返回 chapter_detail 字典。"""
        read_data = self._request_json(f"/spa/manga/{comic_id}/read")
        if not isinstance(read_data, dict):
            return {}
        chapter_detail = read_data.get("chapter_detail") or {}
        return chapter_detail if isinstance(chapter_detail, dict) else {}

    @staticmethod
    def _resolve_image_server(chapter_detail: dict[str, Any]) -> str:
        """从 chapter_detail 中解析图片服务器地址。"""
        server = chapter_detail.get("server") or ""
        if server:
            return server
        slaves = chapter_detail.get("slaves")
        if isinstance(slaves, list):
            for candidate in slaves:
                if isinstance(candidate, str) and candidate.strip():
                    return candidate.strip()
        return ""

    def _extract_manga_images(self, chapter_detail: dict[str, Any]) -> list[str]:
        """从 chapter_detail 中提取去重后的图片 URL 列表。"""
        server = self._resolve_image_server(chapter_detail)
        chapter_content = chapter_detail.get("chapter_content") or ""
        image_paths = self.CHAPTER_IMAGE_REGEX.findall(chapter_content)
        if not image_paths and chapter_content:
            image_paths = re.findall(
                r'(?:data-url|data-src|src)=["\']([^"\']+)["\']', chapter_content
            )

        image_urls: list[str] = []
        seen: set[str] = set()
        for raw_path in image_paths:
            path = (raw_path or "").strip()
            if not path or path.startswith(("data:", "javascript:")):
                continue
            image_url = (
                path
                if path.startswith(("http://", "https://"))
                else urljoin(server, path)
            )
            if not image_url or image_url in seen:
                continue
            seen.add(image_url)
            image_urls.append(image_url)
        return image_urls

    @staticmethod
    def _resolve_total_pages(
        chapter_detail: dict[str, Any], image_urls: list[str], preview_pages: int
    ) -> int:
        """根据多种来源计算总页数。"""
        try:
            total_pages = int(chapter_detail.get("total") or 0)
        except (TypeError, ValueError):
            total_pages = 0
        return max(total_pages, len(image_urls), preview_pages)

    def _request_json(self, path: str, params: dict[str, Any] | None = None) -> dict:
        url = f"{self.BASE_URL}{path}"
        try:
            response = self.session.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as e:
            logger.error("MoeImg request failed: %s (%s)", url, e, exc_info=True)
            raise ParserResponseError(f"MoeImg request failed: {url} ({e})") from e

    def _search_entity(self, mode: str, keyword: str, page: int) -> dict | None:
        entity_id = self._resolve_entity_id(mode=mode, keyword=keyword)
        if not entity_id:
            return None
        path = "/spa/author" if mode == "author" else "/spa/genre"
        return self._request_json(f"{path}/{entity_id}", params={"page": page})

    def _resolve_entity_id(self, mode: str, keyword: str) -> str | None:
        token = (keyword or "").strip()
        if not token:
            return None

        direct_id = self._extract_entity_id(token)
        if direct_id:
            return direct_id

        normalized = self._normalize_lookup_text(token)
        if not normalized:
            return None

        cache = self._author_id_cache if mode == "author" else self._tag_id_cache
        cached = cache.get(normalized)
        if cached:
            return cached

        resolved = self._lookup_entity_id_from_search(mode=mode, keyword=token)
        if resolved:
            cache[normalized] = resolved
            if len(cache) > self._MAX_CACHE_SIZE:
                cache.popitem(last=False)  # type: ignore[call-arg]
        return resolved

    def _match_entity_item(
        self, entity_item: dict, target: str, name_key: str, id_key: str
    ) -> str | None:
        """Match a single entity item against target name, returning its id or None."""
        if not isinstance(entity_item, dict):
            return None
        candidate_id = entity_item.get(id_key)
        if candidate_id is None:
            return None
        candidate_name = self._normalize_lookup_text(entity_item.get(name_key))
        if candidate_name == target:
            return str(candidate_id)
        return None

    def _lookup_entity_id_from_search(self, mode: str, keyword: str) -> str | None:
        """通过搜索结果反查实体 ID。

        复杂度注意：对每个搜索结果都会发起一次详情请求，最坏情况下
        时间复杂度为 O(n*m*k)。为避免无限制搜索，最多处理前 5 条结果。
        """
        try:
            search_data = self._request_json(
                "/spa/search", params={"query": keyword, "page": 1}
            )
        except ParserResponseError:
            return None
        if not isinstance(search_data, dict):
            return None

        manga_list = search_data.get("manga_list")
        if not isinstance(manga_list, list):
            return None

        if not manga_list:
            return None

        target = self._normalize_lookup_text(keyword)
        if not target:
            return None

        name_key = "author_name" if mode == "author" else "tag_name"
        id_key = "author_id" if mode == "author" else "tag_id"

        # 限制搜索范围，避免对大量结果逐个请求详情
        for item in manga_list[: self._MAX_SEARCH_ITEMS]:
            if not isinstance(item, dict):
                continue
            manga_id = item.get("manga_id")
            if manga_id is None:
                continue
            try:
                detail = self._get_manga_detail_payload(str(manga_id))
            except ParserResponseError:
                continue
            if not isinstance(detail, dict):
                continue
            entity_items = (
                detail.get("authors") if mode == "author" else detail.get("tags")
            )
            if not isinstance(entity_items, list):
                continue

            for entity_item in entity_items:
                result = self._match_entity_item(entity_item, target, name_key, id_key)
                if result is not None:
                    return result
        return None

    @classmethod
    def _parse_query_mode(cls, keyword: str) -> tuple[str, str]:
        text = (keyword or "").strip()
        if not text:
            return "keyword", ""
        match = cls.QUERY_MODE_REGEX.match(text)
        if not match:
            return "keyword", text

        mode = (match.group(1) or "").strip().lower()
        value = (match.group(2) or "").strip()
        if mode in ("author", "artist"):
            return "author", value
        if mode == "tag":
            return "tag", value
        return "keyword", text

    @classmethod
    def _extract_entity_id(cls, text: str) -> str | None:
        raw = (text or "").strip()
        if not raw:
            return None

        path_match = cls.ENTITY_ID_IN_TEXT_REGEX.search(raw)
        if path_match:
            return path_match.group(1)

        return None

    @staticmethod
    def _normalize_lookup_text(text: Any) -> str:
        value = str(text or "").strip().lower()
        value = re.sub(r"[_\-]+", " ", value)
        value = re.sub(r"\s+", " ", value)
        return value

    def _parse_search_manga_list(self, data: dict[str, Any]) -> list[ComicInfo]:
        items = data.get("manga_list") or []
        if not isinstance(items, list):
            return []

        comics: list[ComicInfo] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            manga_id = item.get("manga_id")
            if manga_id is None:
                continue

            title = (item.get("manga_name") or "").strip() or "未知标题"
            cover_url = item.get("manga_cover_img")
            preview_url = f"{self.BASE_URL}/post/fa{manga_id}"
            comics.append(
                ComicInfo(
                    id=str(manga_id),
                    title=title,
                    author=None,
                    pages=0,
                    category=None,
                    tags=[],
                    publish_date=None,
                    cover_url=cover_url,
                    preview_url=preview_url,
                    media_id=str(manga_id),
                    comic_source="MOEIMG",
                    source_site="moeimg",
                )
            )
        return comics

    def _get_manga_detail_payload(self, comic_id: str) -> dict | None:
        key = str(comic_id)
        cached = self._manga_detail_cache.get(key)
        if isinstance(cached, dict):
            return cached

        payload = self._request_json(f"/spa/manga/{comic_id}")
        if isinstance(payload, dict):
            self._manga_detail_cache[key] = payload
            if len(self._manga_detail_cache) > self._MAX_CACHE_SIZE:
                self._manga_detail_cache.popitem(last=False)  # type: ignore[call-arg]
            return payload
        return None

    @classmethod
    def _extract_manga_tags(
        cls,
        detail_data: dict[str, Any],
        detail: dict[str, Any],
        chapter_detail: dict[str, Any] | None = None,
    ) -> list[str]:
        tag_values: list[str] = []
        tag_values.extend(cls._extract_names(detail_data.get("tags"), "tag_name"))
        tag_values.extend(cls._extract_names(detail.get("tags"), "tag_name"))
        tag_values.extend(cls._extract_names(detail_data.get("parody"), "tag_name"))
        tag_values.extend(cls._extract_names(detail.get("parody"), "tag_name"))
        tag_values.extend(cls._extract_names(detail_data.get("characters"), "tag_name"))
        tag_values.extend(cls._extract_names(detail.get("characters"), "tag_name"))

        if isinstance(chapter_detail, dict):
            tag_values.extend(
                cls._extract_names(chapter_detail.get("tags"), "tag_name")
            )

        return cls._dedupe_keep_order(tag_values)

    @staticmethod
    def _extract_names(items: Any, key: str) -> list[str]:
        names: list[str] = []
        if isinstance(items, str):
            text = items.strip()
            return [text] if text else names

        if isinstance(items, dict):
            items = [items]

        if not isinstance(items, list):
            return names

        for item in items:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    names.append(text)
                continue
            if not isinstance(item, dict):
                continue
            name = (
                item.get(key)
                or item.get("name")
                or item.get("tag_name")
                or item.get("author_name")
                or ""
            ).strip()
            if name:
                names.append(name)
        return MoeImgParser._dedupe_keep_order(names)

    @classmethod
    def _extract_first_name(cls, items: list, key: str) -> str | None:
        names = cls._extract_names(items, key)
        return names[0] if names else None

    @staticmethod
    def _dedupe_keep_order(values: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for value in values:
            text = (value or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            deduped.append(text)
        return deduped

    @staticmethod
    def _count_preview_images(preview_data: Any) -> int:
        if isinstance(preview_data, list):
            return sum(
                1 for item in preview_data if isinstance(item, str) and item.strip()
            )
        if not isinstance(preview_data, dict):
            return 0

        pages = preview_data.get("pages")
        if not isinstance(pages, dict):
            return 0

        total = 0
        for value in pages.values():
            if isinstance(value, list):
                total += sum(
                    1 for item in value if isinstance(item, str) and item.strip()
                )
        return total

    @staticmethod
    def _format_iso_date(date_text: Any) -> str | None:
        if not date_text:
            return None
        text = str(date_text).strip()
        if not text:
            return None
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            return datetime.fromisoformat(text).strftime("%Y-%m-%d")
        except ValueError:
            return None

    @staticmethod
    def _parse_pagination(
        pagi: Any,
        requested_page: int,
        current_count: int,
    ) -> PaginationInfo | None:
        if not isinstance(pagi, dict):
            return None
        cur_page = max(1, int(pagi.get("cur_page") or requested_page or 1))
        pages_data = pagi.get("pages") or []
        total_pages = max(
            1, len(pages_data) if isinstance(pages_data, list) else cur_page
        )
        limit = max(1, int(pagi.get("limit") or current_count or 1))
        offset = max(0, int(pagi.get("offset") or 0))
        total_items = max(current_count, offset + current_count)
        return PaginationInfo(
            current_page=min(cur_page, total_pages),
            total_pages=total_pages,
            limit=limit,
            total_items=total_items,
        )
