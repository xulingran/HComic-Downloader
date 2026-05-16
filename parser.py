"""h-comic 页面解析模块"""
import json
import logging
import re
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urljoin

import requests

from constants import DEFAULT_USER_AGENT
from models import AuthConfig, ComicInfo, PaginationInfo
from utils import apply_system_proxy_to_session, configure_session_auth

logger = logging.getLogger(__name__)


MAX_PAYLOAD_SIZE = 2_000_000


class ParserResponseError(RuntimeError):
    """响应读取/解析相关异常。"""


class HComicParser:
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

    def __init__(self, timeout: int = 30, cookie: str = "", user_agent: str = ""):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        apply_system_proxy_to_session(self.session)
        self.configure_auth(cookie=cookie, user_agent=user_agent)

    def configure_auth(self, cookie: str = "", user_agent: str = ""):
        """配置登录相关请求头。"""
        configure_session_auth(self.session, self.HEADERS, cookie, user_agent)

    def close(self):
        """关闭底层会话连接。"""
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def verify_login_status(self) -> Tuple[bool, str]:
        """通过访问收藏夹接口校验登录状态。"""
        try:
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
            if not response.encoding or response.encoding.lower() in ('iso-8859-1', 'latin-1'):
                response.encoding = 'utf-8'
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

    def search(self, keyword: str, page: int = 1) -> tuple[List[ComicInfo], Optional[PaginationInfo]]:
        """搜索漫画

        Args:
            keyword: 搜索关键词
            page: 页码 (1-based)

        Returns:
            (漫画信息列表, 分页信息)
        """
        url = self._build_search_url(keyword, page)
        try:
            return self.parse_search_page(self._request_text(url), requested_page=page)
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Search failed: %s", e)
            return [], None

    def favourites(self, page: int = 1, raise_errors: bool = False) -> tuple[List[ComicInfo], Optional[PaginationInfo], bool]:
        """获取收藏夹漫画。

        Args:
            page: 页码
            raise_errors: 如果为 True，异常会向上传播而不是静默返回空列表

        Returns:
            (漫画信息列表, 分页信息, 是否需要登录)
        """
        url = self._build_favourites_url(page)
        try:
            return self.parse_favourites_page(self._request_text(url), requested_page=page)
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Load favourites failed: %s", e)
            if raise_errors:
                raise
            return [], None, False

    def get_comic_detail(self, comic_id: str, slug: str = "") -> Optional[ComicInfo]:
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

    def parse_search_page(self, html: str, requested_page: int = 1) -> tuple[List[ComicInfo], Optional[PaginationInfo]]:
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
    ) -> tuple[List[ComicInfo], Optional[PaginationInfo], bool]:
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
        artist = next(
            (t.get("name") for t in tags if t.get("type") == "artist"),
            None
        )

        # 提取分类
        category = next(
            (t.get("name_zh") or t.get("name") for t in tags if t.get("type") == "category"),
            None
        )

        # 提取标签
        tag_names = [
            t.get("name_zh") or t.get("name")
            for t in tags
            if t.get("type") == "tag"
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
            id=str(data.get("id") or ""),
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
    def _build_search_url(cls, keyword: str, page: int = 1) -> str:
        """构建搜索 URL

        Args:
            keyword: 搜索关键词
            page: 页码 (1-based)

        Returns:
            搜索 URL
        """
        if page <= 1:
            return f"{cls.INDEX}/?q={quote(keyword)}"
        return f"{cls.INDEX}/?q={quote(keyword)}&page={page}"

    @classmethod
    def _build_favourites_url(cls, page: int = 1) -> str:
        """构建收藏夹 URL。"""
        if page <= 1:
            return f"{cls.INDEX}/favourites"
        return f"{cls.INDEX}/favourites?page={page}"

    @classmethod
    def _parse_pagination_info(cls, data: dict, requested_page: int = 1) -> Optional[PaginationInfo]:
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
            title_info.get("japanese")
            or title_info.get("english")
            or str(comic_id)
        )
        slug = quote(slug_source, safe="")
        preview_url = f"{cls.INDEX}/comics/{slug}?id={comic_id}"
        reader_url = f"{cls.INDEX}/comics/{slug}/1?id={comic_id}"
        return preview_url, reader_url

    @classmethod
    def _build_cover_url(cls, comic: dict) -> Optional[str]:
        """构建封面 URL"""
        media_id = comic.get("media_id")
        if not media_id:
            return None
        return f"{cls._get_image_prefix(comic.get('comic_source'))}/{media_id}"

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
    def _format_public_date(cls, unix_ts) -> Optional[str]:
        """格式化发布日期"""
        try:
            return datetime.fromtimestamp(
                int(unix_ts), tz=timezone.utc
            ).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            return None

    @classmethod
    def _extract_payload_data(cls, resp_text: str) -> dict:
        """从页面中提取 payload 数据"""
        if len(resp_text) > MAX_PAYLOAD_SIZE:
            raise ValueError(f"Response too large ({len(resp_text)} bytes), limit is 2MB")
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
    def _quote_unquoted_js_keys(cls, js_obj_text: str) -> str:
        """仅在字符串外侧，为未加引号的对象键补双引号。"""
        out = []
        i = 0
        n = len(js_obj_text)
        in_string = False
        quote_char = ""

        while i < n:
            ch = js_obj_text[i]

            if in_string:
                out.append(ch)
                if ch == "\\" and i + 1 < n:
                    i += 1
                    out.append(js_obj_text[i])
                elif ch == quote_char:
                    in_string = False
                    quote_char = ""
                i += 1
                continue

            if ch in ('"', "'"):
                in_string = True
                quote_char = ch
                out.append(ch)
                i += 1
                continue

            if ch in "{,":
                out.append(ch)
                i += 1

                while i < n and js_obj_text[i].isspace():
                    out.append(js_obj_text[i])
                    i += 1

                start = i
                if i < n and (js_obj_text[i].isalpha() or js_obj_text[i] == "_"):
                    i += 1
                    while i < n and (js_obj_text[i].isalnum() or js_obj_text[i] == "_"):
                        i += 1

                    end = i
                    j = i
                    while j < n and js_obj_text[j].isspace():
                        j += 1

                    if j < n and js_obj_text[j] == ":":
                        out.append(f'"{js_obj_text[start:end]}"')
                        out.append(js_obj_text[end:j])
                        out.append(":")
                        i = j + 1
                        continue

                    out.append(js_obj_text[start:end])
                continue

            out.append(ch)
            i += 1

        return "".join(out)

    @classmethod
    def _jsobj_to_dict(cls, js_obj_text: str) -> dict:
        """将 JavaScript 对象文本转换为 Python 字典"""
        json_ready = cls._quote_unquoted_js_keys(js_obj_text)
        return json.loads(json_ready)

    def extract_image_urls(self, comic: ComicInfo) -> List[str]:
        """提取漫画的所有图片 URL

        Args:
            comic: 漫画信息

        Returns:
            图片 URL 列表
        """
        return comic.get_all_image_urls()


class MoeImgParser:
    """moeimg.fan 解析器。"""

    BASE_URL = "https://moeimg.fan"
    _MAX_CACHE_SIZE = 500
    _MAX_SEARCH_ITEMS = 5
    QUERY_MODE_REGEX = re.compile(r"^\s*(author|artist|tag)\s*:\s*(.*?)\s*$", re.IGNORECASE)
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
        self._manga_detail_cache: Dict[str, dict] = OrderedDict()
        self._author_id_cache: Dict[str, str] = OrderedDict()
        self._tag_id_cache: Dict[str, str] = OrderedDict()

    def configure_auth(self, cookie: str = "", user_agent: str = ""):
        """配置登录相关请求头。"""
        configure_session_auth(self.session, self.HEADERS, cookie, user_agent)

    def close(self):
        """关闭底层会话连接。"""
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def verify_login_status(self) -> Tuple[bool, str]:
        """moeimg 当前接入范围不依赖登录。"""
        return True, "当前来源无需登录校验"

    def search(self, keyword: str, page: int = 1) -> tuple[List[ComicInfo], Optional[PaginationInfo]]:
        """搜索漫画。"""
        mode, keyword = self._parse_query_mode(keyword)
        try:
            page_num = max(1, int(page))
        except (TypeError, ValueError):
            page_num = 1

        try:
            if mode == "keyword" and not keyword:
                data = self._request_json("/spa/latest-manga", params={"page": page_num})
            elif mode == "keyword":
                data = self._request_json("/spa/search", params={"query": keyword, "page": page_num})
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

    def favourites(self, page: int = 1, raise_errors: bool = False) -> tuple[List[ComicInfo], Optional[PaginationInfo], bool]:
        """moeimg 当前版本不支持收藏夹。"""
        return [], None, False

    def get_comic_detail(self, comic_id: str, slug: str = "") -> Optional[ComicInfo]:
        """获取漫画详情并补全可下载图片地址。"""
        try:
            detail_data = self._get_manga_detail_payload(comic_id)
            if not isinstance(detail_data, dict):
                return None

            detail = detail_data.get("detail") or {}
            if not isinstance(detail, dict):
                detail = {}

            chapter_detail = self._fetch_read_data(comic_id)
        except ParserResponseError:
            return None

        title = (
            (detail.get("manga_name") or "").strip()
            or (detail.get("ja_manga_name") or "").strip()
            or "未知标题"
        )

        authors_data = detail_data.get("authors") or detail.get("authors") or detail_data.get("author") or []
        author = self._extract_first_name(authors_data, "author_name")
        tags = self._extract_manga_tags(detail_data, detail, chapter_detail=chapter_detail)
        category = (detail.get("category") or "").strip() or None

        publish_date = self._format_iso_date(
            chapter_detail.get("chapter_date_published") or detail.get("manga_date_published")
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

    def _fetch_read_data(self, comic_id: str) -> Dict[str, Any]:
        """获取漫画阅读数据并返回 chapter_detail 字典。"""
        read_data = self._request_json(f"/spa/manga/{comic_id}/read")
        if not isinstance(read_data, dict):
            return {}
        chapter_detail = read_data.get("chapter_detail") or {}
        return chapter_detail if isinstance(chapter_detail, dict) else {}

    @staticmethod
    def _resolve_image_server(chapter_detail: Dict[str, Any]) -> str:
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

    def _extract_manga_images(self, chapter_detail: Dict[str, Any]) -> List[str]:
        """从 chapter_detail 中提取去重后的图片 URL 列表。"""
        server = self._resolve_image_server(chapter_detail)
        chapter_content = chapter_detail.get("chapter_content") or ""
        image_paths = self.CHAPTER_IMAGE_REGEX.findall(chapter_content)
        if not image_paths and chapter_content:
            image_paths = re.findall(r'(?:data-url|data-src|src)=["\']([^"\']+)["\']', chapter_content)

        image_urls: List[str] = []
        seen: set[str] = set()
        for raw_path in image_paths:
            path = (raw_path or "").strip()
            if not path or path.startswith(("data:", "javascript:")):
                continue
            image_url = path if path.startswith(("http://", "https://")) else urljoin(server, path)
            if not image_url or image_url in seen:
                continue
            seen.add(image_url)
            image_urls.append(image_url)
        return image_urls

    @staticmethod
    def _resolve_total_pages(chapter_detail: Dict[str, Any], image_urls: List[str], preview_pages: int) -> int:
        """根据多种来源计算总页数。"""
        try:
            total_pages = int(chapter_detail.get("total") or 0)
        except (TypeError, ValueError):
            total_pages = 0
        return max(total_pages, len(image_urls), preview_pages)

    def _request_json(self, path: str, params: Optional[Dict[str, Any]] = None) -> dict:
        url = f"{self.BASE_URL}{path}"
        try:
            response = self.session.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as e:
            logger.error("MoeImg request failed: %s (%s)", url, e)
            raise ParserResponseError(f"MoeImg request failed: {url} ({e})") from e

    def _search_entity(self, mode: str, keyword: str, page: int) -> Optional[dict]:
        entity_id = self._resolve_entity_id(mode=mode, keyword=keyword)
        if not entity_id:
            return None
        path = "/spa/author" if mode == "author" else "/spa/genre"
        return self._request_json(f"{path}/{entity_id}", params={"page": page})

    def _resolve_entity_id(self, mode: str, keyword: str) -> Optional[str]:
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
                cache.popitem(last=False)
        return resolved

    def _lookup_entity_id_from_search(self, mode: str, keyword: str) -> Optional[str]:
        """通过搜索结果反查实体 ID。

        复杂度注意：对每个搜索结果都会发起一次详情请求，最坏情况下
        时间复杂度为 O(n*m*k)。为避免无限制搜索，最多处理前 5 条结果。
        """
        try:
            search_data = self._request_json("/spa/search", params={"query": keyword, "page": 1})
        except ParserResponseError:
            return None
        if not isinstance(search_data, dict):
            return None

        manga_list = search_data.get("manga_list")
        if not isinstance(manga_list, list):
            return None

        target = self._normalize_lookup_text(keyword)
        if not target:
            return None

        name_key = "author_name" if mode == "author" else "tag_name"
        id_key = "author_id" if mode == "author" else "tag_id"

        # 限制搜索范围，避免对大量结果逐个请求详情
        for item in manga_list[:self._MAX_SEARCH_ITEMS]:
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
            entity_items = detail.get("authors") if mode == "author" else detail.get("tags")
            if not isinstance(entity_items, list):
                continue

            for entity_item in entity_items:
                if not isinstance(entity_item, dict):
                    continue
                candidate_id = entity_item.get(id_key)
                if candidate_id is None:
                    continue
                candidate_name = self._normalize_lookup_text(entity_item.get(name_key))
                if candidate_name == target:
                    return str(candidate_id)
        return None

    @classmethod
    def _parse_query_mode(cls, keyword: str) -> Tuple[str, str]:
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
    def _extract_entity_id(cls, text: str) -> Optional[str]:
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

    def _parse_search_manga_list(self, data: Dict[str, Any]) -> List[ComicInfo]:
        items = data.get("manga_list") or []
        if not isinstance(items, list):
            return []

        comics: List[ComicInfo] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            manga_id = item.get("manga_id")
            if manga_id is None:
                continue

            title = (item.get("manga_name") or "").strip() or "未知标题"
            cover_url = item.get("manga_cover_img")
            preview_url = f"{self.BASE_URL}/post/fa{manga_id}"
            language = (item.get("language") or "").strip()
            tags = [language] if language else []

            comics.append(
                ComicInfo(
                    id=str(manga_id),
                    title=title,
                    author=None,
                    pages=0,
                    category=None,
                    tags=tags,
                    publish_date=None,
                    cover_url=cover_url,
                    preview_url=preview_url,
                    media_id=str(manga_id),
                    comic_source="MOEIMG",
                    source_site="moeimg",
                )
            )
        return comics

    def _get_manga_detail_payload(self, comic_id: str) -> Optional[dict]:
        key = str(comic_id)
        cached = self._manga_detail_cache.get(key)
        if isinstance(cached, dict):
            return cached

        payload = self._request_json(f"/spa/manga/{comic_id}")
        if isinstance(payload, dict):
            self._manga_detail_cache[key] = payload
            if len(self._manga_detail_cache) > self._MAX_CACHE_SIZE:
                self._manga_detail_cache.popitem(last=False)
            return payload
        return None

    @classmethod
    def _extract_manga_tags(
        cls,
        detail_data: Dict[str, Any],
        detail: Dict[str, Any],
        chapter_detail: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        tag_values: List[str] = []
        tag_values.extend(cls._extract_names(detail_data.get("tags"), "tag_name"))
        tag_values.extend(cls._extract_names(detail.get("tags"), "tag_name"))
        tag_values.extend(cls._extract_names(detail_data.get("parody"), "tag_name"))
        tag_values.extend(cls._extract_names(detail.get("parody"), "tag_name"))
        tag_values.extend(cls._extract_names(detail_data.get("characters"), "tag_name"))
        tag_values.extend(cls._extract_names(detail.get("characters"), "tag_name"))

        if isinstance(chapter_detail, dict):
            tag_values.extend(cls._extract_names(chapter_detail.get("tags"), "tag_name"))

        language = (detail.get("language") or detail_data.get("language") or "").strip()
        if language:
            tag_values.append(language)

        return cls._dedupe_keep_order(tag_values)

    @staticmethod
    def _extract_names(items: Any, key: str) -> List[str]:
        names: List[str] = []
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
            name = (item.get(key) or item.get("name") or item.get("tag_name") or item.get("author_name") or "").strip()
            if name:
                names.append(name)
        return MoeImgParser._dedupe_keep_order(names)

    @classmethod
    def _extract_first_name(cls, items: list, key: str) -> Optional[str]:
        names = cls._extract_names(items, key)
        return names[0] if names else None

    @staticmethod
    def _dedupe_keep_order(values: List[str]) -> List[str]:
        deduped: List[str] = []
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
            return sum(1 for item in preview_data if isinstance(item, str) and item.strip())
        if not isinstance(preview_data, dict):
            return 0

        pages = preview_data.get("pages")
        if not isinstance(pages, dict):
            return 0

        total = 0
        for value in pages.values():
            if isinstance(value, list):
                total += sum(1 for item in value if isinstance(item, str) and item.strip())
        return total

    @staticmethod
    def _format_iso_date(date_text: Any) -> Optional[str]:
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
    ) -> Optional[PaginationInfo]:
        if not isinstance(pagi, dict):
            return None
        cur_page = max(1, int(pagi.get("cur_page") or requested_page or 1))
        pages_data = pagi.get("pages") or []
        total_pages = max(1, len(pages_data) if isinstance(pages_data, list) else cur_page)
        limit = max(1, int(pagi.get("limit") or current_count or 1))
        offset = max(0, int(pagi.get("offset") or 0))
        total_items = max(current_count, offset + current_count)
        return PaginationInfo(
            current_page=min(cur_page, total_pages),
            total_pages=total_pages,
            limit=limit,
            total_items=total_items,
        )


class MultiSourceParser:
    """多来源解析器分发层。"""

    SOURCE_OPTIONS = (
        ("hcomic", "h-comic"),
        ("moeimg", "moeimg.fan"),
    )

    def __init__(
        self,
        timeout: int = 30,
        default_source: str = "hcomic",
        source_auth: Optional[dict[str, dict[str, str]]] = None,
        auth: AuthConfig = None,
    ):
        self.timeout = timeout
        self.source_auth: dict[str, dict[str, str]] = self._normalize_source_auth(source_auth)
        # 兼容旧调用：若传了全局 auth，作为 hcomic 默认认证。
        _cookie = auth.cookie if auth else ""
        _user_agent = auth.user_agent if auth else ""
        if _cookie or _user_agent:
            self.source_auth["hcomic"] = {
                "cookie": (_cookie or "").strip(),
                "user_agent": (_user_agent or "").strip(),
            }

        self.parsers = {
            "hcomic": HComicParser(
                timeout=timeout,
                cookie=self.source_auth["hcomic"]["cookie"],
                user_agent=self.source_auth["hcomic"]["user_agent"],
            ),
            "moeimg": MoeImgParser(
                timeout=timeout,
                cookie=self.source_auth["moeimg"]["cookie"],
                user_agent=self.source_auth["moeimg"]["user_agent"],
            ),
        }
        self.current_source = default_source if default_source in self.parsers else "hcomic"

    @staticmethod
    def _normalize_source_auth(source_auth: Optional[dict]) -> dict[str, dict[str, str]]:
        normalized = {
            "hcomic": {"cookie": "", "user_agent": ""},
            "moeimg": {"cookie": "", "user_agent": ""},
        }
        if not isinstance(source_auth, dict):
            return normalized

        for source, auth in source_auth.items():
            if source not in normalized or not isinstance(auth, dict):
                continue
            normalized[source]["cookie"] = str(auth.get("cookie", "") or "").strip()
            normalized[source]["user_agent"] = str(auth.get("user_agent", auth.get("ua", "")) or "").strip()

        return normalized

    @property
    def session(self) -> requests.Session:
        return self.parsers[self.current_source].session

    def get_sessions(self) -> list[requests.Session]:
        return [self.parsers["hcomic"].session, self.parsers["moeimg"].session]

    def get_source_options(self) -> tuple[tuple[str, str], ...]:
        return self.SOURCE_OPTIONS

    def set_source(self, source: str):
        if source in self.parsers:
            self.current_source = source

    def source_supports_favourites(self, source: Optional[str] = None) -> bool:
        current = source or self.current_source
        return current == "hcomic"

    def get_auth(self, source: Optional[str] = None) -> tuple[str, str]:
        current = source or self.current_source
        auth = self.source_auth.get(current, {"cookie": "", "user_agent": ""})
        return auth.get("cookie", ""), auth.get("user_agent", "")

    def configure_auth(self, cookie: str = "", user_agent: str = "", source: Optional[str] = None):
        current = source or self.current_source
        if current not in self.parsers:
            return
        cookie = (cookie or "").strip()
        user_agent = (user_agent or "").strip()
        self.source_auth[current] = {"cookie": cookie, "user_agent": user_agent}
        self.parsers[current].configure_auth(cookie=cookie, user_agent=user_agent)

    def verify_login_status(self, source: Optional[str] = None) -> Tuple[bool, str]:
        src = source or self.current_source
        return self.parsers[src].verify_login_status()

    def search(self, keyword: str, page: int = 1, source: Optional[str] = None) -> tuple[List[ComicInfo], Optional[PaginationInfo]]:
        src = source or self.current_source
        return self.parsers[src].search(keyword, page=page)

    def favourites(self, page: int = 1, raise_errors: bool = False, source: Optional[str] = None) -> tuple[List[ComicInfo], Optional[PaginationInfo], bool]:
        src = source or self.current_source
        if not self.source_supports_favourites(src):
            return [], None, False
        return self.parsers[src].favourites(page=page, raise_errors=raise_errors)

    def get_comic_detail(self, comic_id: str, slug: str = "", source: Optional[str] = None) -> Optional[ComicInfo]:
        src = source or self.current_source
        return self.parsers[src].get_comic_detail(comic_id, slug=slug)

    def prepare_for_download(self, comic: ComicInfo) -> ComicInfo:
        source = (comic.source_site or self.current_source or "hcomic").lower()
        parser = self.parsers.get(source)
        if not parser:
            return comic

        # 对已有下载地址且页数有效的条目，不再重复请求详情。
        if comic.image_urls and comic.pages > 0:
            return comic

        # hcomic 默认搜索结果已足够下载，仅在关键字段缺失时补详情。
        if source == "hcomic":
            if comic.media_id and comic.pages > 0:
                return comic
            detail = parser.get_comic_detail(comic.id)
            return detail or comic

        # moeimg 需要通过详情接口补齐章节图片地址。
        detail = parser.get_comic_detail(comic.id)
        return detail or comic
