"""h-comic 页面解析模块"""

from __future__ import annotations

import contextlib
import json
import logging
import re
from datetime import UTC, datetime
from urllib.parse import quote

import requests

from constants import DEFAULT_USER_AGENT
from models import ComicInfo, PaginationInfo
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
        self.configure_auth(
            cookie=cookie, user_agent=user_agent, bearer_token=bearer_token
        )

    def configure_auth(
        self, cookie: str = "", user_agent: str = "", bearer_token: str = ""
    ):
        """配置登录相关请求头。"""
        configure_session_auth(
            self.session, self.HEADERS, cookie, user_agent, bearer_token
        )

    def verify_login_status(self) -> tuple[bool, str]:
        """通过访问收藏夹接口校验登录状态。"""
        try:
            url = self._build_favourites_url(1)
            response = self._request_text(url)
            data = self._extract_payload_data(response)
            favourites_data = data.get("favourites")
            if isinstance(favourites_data, dict) and all(
                k in favourites_data for k in ("docs", "pages", "total")
            ):
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
        """发起请求并返回响应文本，附带结构化错误信息。"""
        try:
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            return self._get_response_text(response)
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e

    def search(
        self, keyword: str, page: int = 1, *, tag: str = ""
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
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
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Search failed: %s", e)
            return [], None

    def random(self) -> tuple[list[ComicInfo], PaginationInfo | None]:
        url = self._build_random_url()
        try:
            return self.parse_search_page(self._request_text(url))
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Random failed: %s", e)
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
        url = self._build_favourites_url(page)
        try:
            return self.parse_favourites_page(
                self._request_text(url), requested_page=page
            )
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Load favourites failed: %s", e)
            if raise_errors:
                raise
            return [], None, False

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
        """发送认证相关的 HTTP 请求，统一处理超时、认证失效和网络错误。"""
        kwargs.setdefault("timeout", self.timeout)
        kwargs.setdefault("headers", self._API_HEADERS)
        try:
            return self.session.request(method, url, **kwargs)
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
                logger.error("%s HTTP %s: %s", log_name, status, body)
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

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情

        Args:
            comic_id: 漫画 ID
            slug: URL slug（可选）

        Returns:
            漫画信息，失败返回 None
        """
        url = f"{self.INDEX}/comics/{slug or '1'}?id={comic_id}"
        try:
            return self.parse_comic_detail(self._request_text(url))
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Get comic detail failed: %s", e)
            return None

    def parse_search_page(
        self, html: str, requested_page: int = 1
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
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
        if not favourites_data or not all(
            k in favourites_data for k in ("docs", "pages", "total")
        ):
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
            (
                t.get("name_zh") or t.get("name")
                for t in tags
                if t.get("type") == "category"
            ),
            None,
        )

        # 提取标签
        tag_names = [
            t.get("name_zh") or t.get("name") for t in tags if t.get("type") == "tag"
        ]

        # 构建 URL
        preview_url, _ = self._build_book_urls(data)

        # 获取页数
        pages = data.get("num_pages") or len(
            (data.get("images") or {}).get("pages") or []
        )

        # 构建封面 URL
        cover_url = self._build_cover_url(data)

        return ComicInfo(
            id=str(data.get("_id") or data.get("id") or ""),
            title=title_info.get("display")
            or title_info.get("japanese")
            or title_info.get("english")
            or "未知标题",
            author=artist,
            pages=pages,
            category=category,
            tags=[tag for tag in tag_names if tag],
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
            return cls._build_paginated_url(
                f"{cls.INDEX}/?q={q}&tag={quote(tag)}", page
            )
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
    def _parse_pagination_info(
        cls, data: dict, requested_page: int = 1
    ) -> PaginationInfo | None:
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
        slug_source = (
            title_info.get("japanese") or title_info.get("english") or str(comic_id)
        )
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
        source_upper = (comic_source or "").upper()
        if source_upper == "MMCG_SHORT":
            suffix = "mms"
        elif source_upper == "MMCG_LONG":
            suffix = "mml"
        else:
            suffix = "nh"
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
    def _scan_string_literal(
        cls, text: str, i: int, quote_char: str, out: list[str]
    ) -> tuple[int, bool]:
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
                pos, in_string = cls._scan_string_literal(
                    js_obj_text, pos, quote_char, out
                )
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
