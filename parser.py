"""h-comic 页面解析模块"""
import json
import logging
import re
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from urllib.parse import quote

import requests

from models import ComicInfo, PaginationInfo
from utils import apply_system_proxy_to_session

logger = logging.getLogger(__name__)


class HComicParser:
    """h-comic.com 解析器"""

    INDEX = "https://h-comic.com"
    IMAGE_SERVER = "https://h-comic.link/api"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,en-US;q=0.5,en;q=0.3",
    }

    # 正则表达式
    PAYLOAD_REGEX = re.compile(r"data:\s*\[null,\s*(\{.*?\})\s*],\s*form:", re.S)

    def __init__(self, timeout: int = 30, cookie: str = "", user_agent: str = ""):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        apply_system_proxy_to_session(self.session)
        self.configure_auth(cookie=cookie, user_agent=user_agent)

    def configure_auth(self, cookie: str = "", user_agent: str = ""):
        """配置登录相关请求头。"""
        ua = (user_agent or "").strip()
        ck = (cookie or "").strip()

        self.session.headers["User-Agent"] = ua or self.HEADERS["User-Agent"]
        if ck:
            self.session.headers["Cookie"] = ck
        else:
            self.session.headers.pop("Cookie", None)

    def verify_login_status(self) -> Tuple[bool, str]:
        """弱校验登录状态。"""
        try:
            response = self.session.get(self.INDEX, timeout=self.timeout)
            response.raise_for_status()
            text = self._get_response_text(response).lower()
            if "logout" in text or "is.authenticated=true" in text:
                return True, "登录校验通过"
            if "login" in text or "sign in" in text:
                return False, "登录疑似失效（检测到登录入口）"
            return True, "登录校验通过（弱判定）"
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
        if not response.encoding or response.encoding.lower() in ('iso-8859-1', 'latin-1'):
            response.encoding = 'utf-8'
        return response.text

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
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            return self.parse_search_page(self._get_response_text(response), requested_page=page)
        except requests.RequestException as e:
            logger.error(f"Search failed: {e}")
            return [], None

    def favourites(self, page: int = 1) -> tuple[List[ComicInfo], Optional[PaginationInfo], bool]:
        """获取收藏夹漫画。

        Returns:
            (漫画信息列表, 分页信息, 是否需要登录)
        """
        url = self._build_favourites_url(page)
        try:
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            return self.parse_favourites_page(self._get_response_text(response), requested_page=page)
        except requests.RequestException as e:
            logger.error(f"Load favourites failed: {e}")
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
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            return self.parse_comic_detail(self._get_response_text(response))
        except requests.RequestException as e:
            logger.error(f"Get comic detail failed: {e}")
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
            logger.warning(f"Parse search payload error: {e}")
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
                logger.debug(f"Parse search item skipped: {e}")
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
            logger.warning(f"Parse favourites payload error: {e}")
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
                logger.debug(f"Parse favourites item skipped: {e}")
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
        m = cls.PAYLOAD_REGEX.search(resp_text)
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
