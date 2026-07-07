"""NH 解析模块。"""

from __future__ import annotations

import logging
import re
from urllib.parse import urlencode

import requests
from lxml import html as lxml_html

from models import ComicInfo, PaginationInfo
from sources.base import ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session, normalize_nh_api_key

from .constants import (
    FAVORITE_URL_TEMPLATE,
    FAVORITES_URL,
    GALLERIES_URL,
    GALLERY_URL_TEMPLATE,
    REQUEST_HEADERS,
    SEARCH_URL,
    SORT_POPULAR,
    SORT_POPULAR_MONTH,
    SORT_POPULAR_TODAY,
    SORT_POPULAR_WEEK,
    TAGS_URL,
    USER_URL,
)

logger = logging.getLogger(__name__)


class NhParser(ParserContextMixin):
    """NH 解析器。

    认证收敛为仅 API Key（remove-nh-password-login spec）：解析器只接受 NH API Key，
    并始终发送 ``Authorization: Key <api_key>``。Cookie、User-Agent、User Token、
    Bearer Token 与旧 ``Token`` 值不再是受支持的 NH 认证凭据。
    """

    def __init__(
        self,
        timeout: int = 30,
        cookie: str = "",
        user_agent: str = "",
        bearer_token: str = "",
    ):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(REQUEST_HEADERS)
        apply_system_proxy_to_session(self.session)
        # 仅 API Key（无前缀 / Key 前缀）受支持；其他旧凭据一律忽略。
        self._api_key = normalize_nh_api_key(bearer_token)
        self._apply_authorization_header()
        # cookie/user_agent 参数仅为保留与 MultiSourceParser 通用调用签名兼容，
        # NH 不再使用它们作为认证方式。
        _ = cookie, user_agent

    def _apply_authorization_header(self) -> None:
        """根据当前 API Key 同步 Session 的 ``Authorization`` 头。"""
        self.session.headers.pop("Authorization", None)
        if self._api_key:
            self.session.headers["Authorization"] = f"Key {self._api_key}"

    def _is_auth_configured(self) -> bool:
        """判断是否已配置 API Key。"""
        return bool(self._api_key)

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        """配置 NH 认证信息。

        NH 仅接受 API Key（remove-nh-password-login spec）。``bearer_token`` 中
        无前缀 / ``Key `` 前缀值被归一化为纯 API Key；``User `` / ``Token `` /
        ``Bearer `` 等旧前缀或其他凭据一律清空。``cookie`` / ``user_agent``
        参数仅为保留与 ``MultiSourceParser.configure_auth`` 的通用调用签名兼容，
        对 NH 无效。
        """
        _ = cookie, user_agent
        self._api_key = normalize_nh_api_key(bearer_token)
        self._apply_authorization_header()

    def verify_login_status(self) -> tuple[bool, str]:
        """通过 GET /api/v2/user 校验登录态。"""
        if not self._is_auth_configured():
            return False, "NH 未配置 API Key"
        try:
            data = self._request_json(USER_URL)
        except ParserResponseError as e:
            msg = str(e).lower()
            if "401" in msg or "403" in msg:
                return False, "登录已失效，请重新配置 API Key"
            return False, f"登录校验失败: {e}"
        username = data.get("username") or data.get("name") or ""
        if username:
            return True, f"登录校验通过（{username}）"
        return True, "登录校验通过"

    def favourites(
        self, page: int = 1, raise_errors: bool = False
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """获取 NH 收藏夹列表。"""
        if not self._is_auth_configured():
            if raise_errors:
                raise ParserResponseError("NH 未配置 API Key，请前往设置页配置")
            return [], None, True
        url = f"{FAVORITES_URL}?page={page}"
        try:
            data = self._request_json(url)
        except ParserResponseError as e:
            msg = str(e).lower()
            if raise_errors and ("401" in msg or "403" in msg):
                raise ParserResponseError("NH 登录已失效，请重新配置 API Key") from e
            return [], None, False

        result = data.get("result", [])
        total_pages = int(data.get("num_pages") or data.get("total_pages") or page)
        total_items = int(data.get("total") if data.get("total") is not None else len(result))
        if not result:
            return (
                [],
                PaginationInfo(
                    current_page=page,
                    total_pages=max(total_pages, page),
                    limit=0,
                    total_items=total_items,
                ),
                False,
            )

        comics = []
        for item in result:
            try:
                comic = self._parse_search_item(item)
                comics.append(comic)
            except (KeyError, ValueError) as e:
                logger.warning("Failed to parse favourite item: %s", e)
                continue

        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(total_pages, page),
            limit=len(result),
            total_items=total_items,
        )
        return comics, pagination, False

    def add_to_favourites(self, comic_id: str) -> bool:
        """将漫画加入 NH 收藏夹。"""
        if not self._is_auth_configured():
            return False
        return self._request_favourite_state("POST", comic_id) is True

    def check_favourite(self, comic_id: str) -> bool:
        """检查指定漫画是否在 NH 收藏夹中。"""
        if not self._is_auth_configured():
            return False
        return self._request_favourite_state("GET", comic_id) is True

    def remove_from_favourites(self, comic_id: str) -> bool:
        """将漫画从 NH 收藏夹移除。"""
        if not self._is_auth_configured():
            return False
        return self._request_favourite_state("DELETE", comic_id) is False

    def _request_favourite_state(self, method: str, comic_id: str) -> bool | None:
        """执行收藏状态请求并返回官方 ``FavoriteResponse.favorited``。"""
        url = FAVORITE_URL_TEMPLATE.format(gallery_id=comic_id)
        try:
            resp = self.session.request(method, url, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            value = data.get("favorited") if isinstance(data, dict) else None
            return value if isinstance(value, bool) else None
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else None
            if status in (401, 403):
                raise ParserResponseError(f"NH 认证已失效（HTTP {status}），请重新配置 API Key") from e
            raise ParserResponseError(f"NH 收藏操作失败（HTTP {status}）") from e
        except ValueError as e:
            raise ParserResponseError("NH 收藏响应解析失败") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"NH 收藏请求失败: {e}") from e

    # ------------------------------------------------------------------
    # 内部请求辅助
    # ------------------------------------------------------------------

    def _request_json(self, url: str, *, headers: dict | None = None) -> dict:
        """发起 GET 请求并返回解析后的 JSON 字典。"""
        resp = None
        try:
            resp = self.session.get(url, headers=headers, timeout=self.timeout, allow_redirects=True)
            resp.raise_for_status()
            if not resp.content or not resp.content.strip():
                raise ValueError(f"Empty response body (status={resp.status_code}, len={len(resp.content)})")
            return resp.json()
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except ValueError as e:
            if resp is not None:
                logger.debug(
                    "JSON parse error for %s: status=%s len=%s snippet=%.200s",
                    url,
                    resp.status_code,
                    len(resp.content),
                    resp.text[:200] if resp.text else "(empty)",
                )
            raise ParserResponseError(f"响应解析失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e

    def _request_text(self, url: str, *, headers: dict | None = None) -> str:
        """发起 GET 请求并返回 UTF-8 HTML 文本。"""
        try:
            resp = self.session.get(url, headers=headers, timeout=self.timeout, allow_redirects=True)
            resp.raise_for_status()
            if not resp.content or not resp.content.strip():
                raise ParserResponseError(f"空响应: {url}")
            resp.encoding = "utf-8"
            return resp.text
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e

    # ------------------------------------------------------------------
    # 图片 URL 构建
    # ------------------------------------------------------------------

    @staticmethod
    def _build_image_url(media_id: str, page_path: str) -> str:
        """构建完整的图片 URL。

        Args:
            media_id: 媒体 ID
            page_path: 页面路径，如 "galleries/12345/1.jpg"

        Returns:
            完整的图片 URL
        """
        if not page_path.startswith("galleries/"):
            raise ValueError(f"Invalid page path format: {page_path}")
        # page_path 格式: "galleries/{media_id}/{page_number}.{ext}"
        # 需要提取页码和扩展名
        parts = page_path.split("/")
        if len(parts) < 3:
            raise ValueError(f"Invalid page path format: {page_path}")
        filename = parts[-1]  # "1.jpg"
        return f"https://i.nhentai.net/galleries/{media_id}/{filename}"

    @staticmethod
    def _build_thumbnail_url(media_id: str, thumbnail_path: str) -> str:
        """构建缩略图 URL。

        Args:
            media_id: 媒体 ID
            thumbnail_path: 缩略图路径，如 "galleries/12345/thumb."

        Returns:
            完整的缩略图 URL
        """
        if not thumbnail_path.startswith("galleries/"):
            raise ValueError(f"Invalid thumbnail path format: {thumbnail_path}")
        # thumbnail_path 格式: "galleries/{media_id}/thumb."
        # 需要补全扩展名（默认 jpg）
        if thumbnail_path.endswith("."):
            thumbnail_path += "jpg"
        return f"https://t.nhentai.net/{thumbnail_path}"

    # ------------------------------------------------------------------
    # 标签目录
    # ------------------------------------------------------------------

    def get_tag_list(self, page: int = 1, *, sort: str = SORT_POPULAR) -> tuple[list[dict], PaginationInfo | None]:
        """获取 NH 原始标签目录。"""
        page = max(1, int(page or 1))
        sort_value = sort if sort in (SORT_POPULAR, "name") else SORT_POPULAR
        query = urlencode({"sort": sort_value, "page": page, "per_page": 100})
        data = self._request_json(f"{TAGS_URL}?{query}")
        tags = self._parse_tags_api_response(data)
        total_pages = int(data.get("num_pages") or data.get("total_pages") or page)
        total_items = int(data.get("total") or len(tags))
        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(total_pages, page),
            limit=len(tags),
            total_items=total_items,
        )
        return tags, pagination

    @staticmethod
    def _parse_tags_api_response(data: dict) -> list[dict]:
        """解析官方 tags API 响应。"""
        result = data.get("result", []) if isinstance(data, dict) else []
        tags: list[dict] = []
        seen: set[str] = set()
        for item in result:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            tags.append({"tag": name, "count": int(item.get("count") or 0)})
        return tags

    @classmethod
    def _parse_tags_page(cls, html_text: str) -> list[dict]:
        """解析 tags 页面中的 tagchip 列表。"""
        if not html_text or not html_text.strip():
            return []
        doc = lxml_html.fromstring(html_text)
        tags: list[dict] = []
        seen: set[str] = set()
        for tag_el in doc.xpath("//a[contains(concat(' ', normalize-space(@class), ' '), ' tagchip ')]"):
            name_text = cls._first_text(
                tag_el.xpath(".//*[contains(concat(' ', normalize-space(@class), ' '), ' name ')]//text()")
            )
            if not name_text:
                continue
            count_el = tag_el.xpath(".//*[contains(concat(' ', normalize-space(@class), ' '), ' count ')]")
            count = cls._parse_tag_count(count_el[0] if count_el else None)
            key = name_text.lower()
            if key in seen:
                continue
            seen.add(key)
            tags.append({"tag": name_text, "count": count})
        return tags

    @staticmethod
    def _first_text(parts: list) -> str:
        text = " ".join(str(p).strip() for p in parts if str(p).strip())
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def _parse_tag_count(count_el) -> int:
        if count_el is None:
            return 0
        title = count_el.get("title", "") if hasattr(count_el, "get") else ""
        match = re.search(r"([\d,]+)\s+galleries", title)
        if match:
            return int(match.group(1).replace(",", ""))
        text = "".join(count_el.itertext()).strip() if hasattr(count_el, "itertext") else str(count_el)
        return NhParser._parse_compact_count(text)

    @staticmethod
    def _parse_compact_count(text: str) -> int:
        value = (text or "").strip().lower().replace(",", "")
        if not value:
            return 0
        match = re.fullmatch(r"(\d+(?:\.\d+)?)([km]?)", value)
        if not match:
            return 0
        number = float(match.group(1))
        suffix = match.group(2)
        if suffix == "m":
            number *= 1_000_000
        elif suffix == "k":
            number *= 1_000
        return int(round(number))

    @staticmethod
    def _parse_tags_total_pages(html_text: str) -> int:
        if not html_text or not html_text.strip():
            return 1
        doc = lxml_html.fromstring(html_text)
        pages = [1]
        for href in doc.xpath("//a[contains(@href, '/tags/')]/@href"):
            match = re.search(r"[?&]page=(\d+)", href)
            if match:
                pages.append(int(match.group(1)))
        return max(pages)

    # ------------------------------------------------------------------
    # 搜索
    # ------------------------------------------------------------------

    def search(
        self,
        keyword: str,
        page: int = 1,
        *,
        tag: str = "",
        language_filter: str = "",
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索 NH 漫画。

        Args:
            keyword: 搜索关键词（为空时返回首页漫画）
            page: 页码 (1-based)
            tag: 排序方式标签（"popular" 表示按热度排序，其他值或空表示按日期排序）
            language_filter: 受限的语言筛选枚举，当前仅支持 ``"chinese"``；
                其他值或空字符串视为未启用筛选。开启后会以 NH 搜索语法
                ``language:"chinese"`` 限定服务端查询（add-nh-chinese-language-filter spec）。

        Returns:
            (漫画列表, 分页信息) 元组
        """
        chinese_only = self._is_chinese_filter(language_filter)
        # 空关键词时获取首页漫画列表
        if not keyword or not keyword.strip():
            sort_by = (tag or "").strip().lower()
            return self._get_homepage_galleries(
                page, sort_by=sort_by, language_filter="chinese" if chinese_only else ""
            )

        # 有关键词时使用搜索 API；中文筛选需合并进同一 query
        query = keyword if not chinese_only else f'{keyword} language:"chinese"'
        url = f"{SEARCH_URL}?{urlencode({'query': query, 'page': page})}"
        data = self._request_json(url)

        result = data.get("result", [])
        if not result:
            return [], None

        comics = []
        for item in result:
            try:
                comic = self._parse_search_item(item, chinese_only=chinese_only)
                comics.append(comic)
            except (KeyError, ValueError) as e:
                logger.warning("Failed to parse search item: %s", e)
                continue

        # 解析分页信息
        total_pages = int(data.get("num_pages") or data.get("total_pages") or page)
        total_items = int(data.get("total") if data.get("total") is not None else len(result))
        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(total_pages, page),
            limit=len(result),
            total_items=total_items,
        )

        return comics, pagination

    @staticmethod
    def _is_chinese_filter(language_filter: str) -> bool:
        """归一化语言筛选枚举：仅 ``chinese`` 视为启用，其余一律视为未启用。"""
        return (language_filter or "").strip().lower() == "chinese"

    def _get_homepage_galleries(
        self,
        page: int = 1,
        *,
        sort_by: str = "",
        language_filter: str = "",
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """获取首页漫画列表。

        Args:
            page: 页码 (1-based)
            sort_by: 排序方式（"popular"/"popular-today"/"popular-week"/"popular-month"，空字符串表示按日期排序）
            language_filter: 受限的语言筛选枚举，当前仅支持 ``"chinese"``；
                开启后最近更新会改走 search 端点并以 ``language:"chinese"`` 限定，
                且与 ``sort_by`` 排行组合使用（add-nh-chinese-language-filter spec）。

        Returns:
            (漫画列表, 分页信息) 元组
        """
        chinese_only = self._is_chinese_filter(language_filter)
        popular_sorts = (SORT_POPULAR, SORT_POPULAR_TODAY, SORT_POPULAR_WEEK, SORT_POPULAR_MONTH)
        # 构建 URL：popular 排序或中文筛选使用 search API 的 sort/query 参数；
        # 未筛选且按日期排序保持原行为走 galleries 端点。
        if chinese_only and sort_by in popular_sorts:
            params = {"query": 'language:"chinese"', "sort": sort_by, "page": page}
            url = f"{SEARCH_URL}?{urlencode(params)}"
        elif chinese_only:
            params = {"query": 'language:"chinese"', "page": page}
            url = f"{SEARCH_URL}?{urlencode(params)}"
        elif sort_by in popular_sorts:
            url = f"{SEARCH_URL}?query=*&sort={sort_by}&page={page}"
        else:
            url = f"{GALLERIES_URL}?page={page}"

        data = self._request_json(url)

        result = data.get("result", [])
        if not result:
            return [], None

        comics = []
        for item in result:
            try:
                comic = self._parse_search_item(item, chinese_only=chinese_only)
                comics.append(comic)
            except (KeyError, ValueError) as e:
                logger.warning("Failed to parse gallery item: %s", e)
                continue

        # 解析分页信息
        total_pages = int(data.get("num_pages") or data.get("total_pages") or page)
        total_items = int(data.get("total") if data.get("total") is not None else len(result))
        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(total_pages, page),
            limit=len(result),
            total_items=total_items,
        )

        return comics, pagination

    def _parse_search_item(self, item: dict, *, chinese_only: bool = False) -> ComicInfo:
        """解析搜索结果条目。

        Args:
            item: API 返回的漫画条目
            chinese_only: 当且仅当请求由 ``language:"chinese"`` 服务端谓词限定时为 True，
                此时返回项的 ``language`` 直接置为 ``chinese``——这是由服务端过滤谓词保证的
                来源信息，不依赖可能缺失的 ``tags``。未筛选时维持现有解析结果。

        Returns:
            ComicInfo 对象
        """
        gallery_id = str(item.get("id", ""))
        if not gallery_id:
            raise ValueError("Missing gallery id")

        media_id = str(item.get("media_id", ""))
        if not media_id:
            raise ValueError("Missing media_id")

        # 标题优先级：japanese > english > "未知标题"
        title = item.get("japanese_title") or item.get("english_title") or "未知标题"

        pages = item.get("num_pages", 0)
        thumbnail_path = item.get("thumbnail", "")
        thumbnail_url = self._build_thumbnail_url(media_id, thumbnail_path) if thumbnail_path else ""

        # 从 tags 提取语言和标签（响应可能显式返回 null）
        tags = item.get("tags") or []
        # chinese_only 来自服务端 language:"chinese" 谓词，因此其查询语义是列表语言
        # 的可信来源；即使响应恢复 tags、缺少 language tag 或标签顺序异常，也必须稳定
        # 输出 chinese。未筛选时才从响应 tags 提取实际语言。
        language: str | None = "chinese" if chinese_only else self._extract_language(tags)
        tag_names = [t.get("name", "") for t in tags if t.get("type") != "language"]

        return ComicInfo(
            id=gallery_id,
            title=title,
            pages=pages,
            media_id=media_id,
            cover_url=thumbnail_url,
            preview_url=f"https://nhentai.net/g/{gallery_id}/",
            comic_source="NH",
            source_site="nh",
            language=language,
            tags=tag_names,
        )

    # ------------------------------------------------------------------
    # 详情
    # ------------------------------------------------------------------

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情。

        Args:
            comic_id: 漫画 ID
            slug: 未使用

        Returns:
            ComicInfo 对象，或 None（如果获取失败）
        """
        url = GALLERY_URL_TEMPLATE.format(gallery_id=comic_id)
        try:
            data = self._request_json(url)
        except ParserResponseError:
            logger.exception("Failed to get comic detail for %s", comic_id)
            return None

        return self._parse_detail(data)

    def _parse_detail(self, data: dict) -> ComicInfo:
        """解析漫画详情。

        Args:
            data: API 返回的漫画详情数据

        Returns:
            ComicInfo 对象
        """
        gallery_id = str(data.get("id", ""))
        if not gallery_id:
            raise ValueError("Missing gallery id")

        media_id = str(data.get("media_id", ""))
        if not media_id:
            raise ValueError("Missing media_id")

        # 标题优先级：japanese > pretty > english > "未知标题"
        title_obj = data.get("title", {})
        title = title_obj.get("japanese") or title_obj.get("pretty") or title_obj.get("english") or "未知标题"

        pages_count = data.get("num_pages", 0)
        tags = data.get("tags", [])
        language = self._extract_language(tags)
        tag_names = [t.get("name", "") for t in tags if t.get("type") != "language"]

        # 提取作者
        author = None
        for tag in tags:
            if tag.get("type") == "artist":
                author = tag.get("name", "")
                break

        # 提取封面
        thumbnail = data.get("thumbnail", {})
        thumbnail_path = thumbnail.get("path", "")
        cover_url = self._build_thumbnail_url(media_id, thumbnail_path) if thumbnail_path else ""

        # 构建图片 URL 列表
        pages_data = data.get("pages", [])
        image_urls = []
        for page_info in pages_data:
            page_path = page_info.get("path", "")
            if page_path:
                try:
                    image_url = self._build_image_url(media_id, page_path)
                    image_urls.append(image_url)
                except ValueError as e:
                    logger.warning("Failed to build image URL: %s", e)

        return ComicInfo(
            id=gallery_id,
            title=title,
            author=author,
            pages=pages_count,
            media_id=media_id,
            cover_url=cover_url,
            preview_url=f"https://nhentai.net/g/{gallery_id}/",
            comic_source="NH",
            source_site="nh",
            language=language,
            tags=tag_names,
            image_urls=image_urls,
        )

    # ------------------------------------------------------------------
    # 下载准备
    # ------------------------------------------------------------------

    def prepare_for_download(self, comic: ComicInfo) -> ComicInfo:
        """准备下载，填充图片 URL 列表。

        如果 comic.image_urls 已填充（从详情页获取），则直接返回。
        否则调用 get_comic_detail 获取完整的图片列表。

        Args:
            comic: 漫画信息

        Returns:
            填充了 image_urls 的 ComicInfo 对象
        """
        if comic.image_urls:
            return comic

        detail = self.get_comic_detail(comic.id)
        if detail and detail.image_urls:
            comic.image_urls = detail.image_urls
            comic.pages = detail.pages
        return comic

    # ------------------------------------------------------------------
    # 辅助方法
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_language(tags: list[dict]) -> str | None:
        """从标签列表中提取语言。

        Args:
            tags: 标签列表，每个标签包含 type 和 name

        Returns:
            语言名称，或 None
        """
        for tag in tags:
            if tag.get("type") == "language":
                name = tag.get("name", "")
                # 排除 "translated" 标签
                if name and name.lower() != "translated":
                    return name
        return None
