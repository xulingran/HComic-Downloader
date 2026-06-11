"""Bika 漫画解析模块。"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Any

import requests

from models import ChapterInfo, ComicInfo, PaginationInfo
from sources.base import ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session

from .constants import (
    API_BASE_URL,
    API_KEY,
    DEFAULT_HEADERS,
    NONCE,
    SECRET_KEY,
    Method,
)

logger = logging.getLogger(__name__)


class BikaParser(ParserContextMixin):
    """Bika (哔咔/Picacomic) 解析器。"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        apply_system_proxy_to_session(self.session)
        self._token: str = ""
        self._stored_username: str = ""
        self._stored_password: str = ""
        self._favourites_total_pages: int = 0

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        """配置认证信息。Bika 使用 bearer_token。"""
        if bearer_token:
            self._token = bearer_token.strip()
            self.session.headers["authorization"] = self._token

    def set_stored_credentials(self, username: str, password: str):
        """保存用户名密码到内存，用于 token 过期后自动重登录。"""
        self._stored_username = username or ""
        self._stored_password = password or ""

    def _ensure_token(self):
        """确保 token 有效，若过期或不存在则使用存储的凭据自动重登录。

        Raises:
            ParserResponseError: 无可用 token 且无存储凭据
        """
        if self._token:
            return
        if self._stored_username and self._stored_password:
            logger.info("Auto-login bika with stored credentials for %s", self._stored_username)
            self.login(self._stored_username, self._stored_password)
            return
        raise ParserResponseError("未登录，请先登录 Bika")

    @staticmethod
    def _get_signature(url: str, timestamp: str, nonce: str, method: str) -> str:
        """计算 HMAC-SHA256 签名。

        Args:
            url: 请求路径（不含基础 URL）
            timestamp: Unix 时间戳（秒）
            nonce: 固定 nonce
            method: HTTP 方法

        Returns:
            签名字符串
        """
        key = (url + timestamp + nonce + method + API_KEY).lower()
        h = hmac.new(
            SECRET_KEY.encode("utf-8"),
            key.encode("utf-8"),
            hashlib.sha256,
        )
        return h.hexdigest()

    def _get_headers(self, url: str, method: str) -> dict[str, str]:
        """构建包含签名的请求头。"""
        timestamp = str(int(time.time()))
        signature = self._get_signature(url, timestamp, NONCE, method)
        headers = {
            **DEFAULT_HEADERS,
            "time": timestamp,
            "signature": signature,
        }
        if self._token:
            headers["authorization"] = self._token
        return headers

    def _request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        """发起 API 请求。

        Args:
            method: HTTP 方法
            path: API 路径（不含基础 URL）
            **kwargs: 传递给 requests 的参数

        Returns:
            响应 JSON 数据

        Raises:
            ParserResponseError: 请求失败
        """
        url = path
        headers = self._get_headers(url, method)
        full_url = f"{API_BASE_URL}{path}"

        try:
            response = self.session.request(
                method,
                full_url,
                headers=headers,
                timeout=self.timeout,
                **kwargs,
            )
            response.raise_for_status()
            return response.json()
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {path}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {path}") from e
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else None
            if status in (401, 403):
                raise ParserResponseError("认证已失效，请重新登录") from e
            raise ParserResponseError(f"请求失败: {path} (HTTP {status})") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {path}") from e
        except ValueError as e:
            raise ParserResponseError(f"响应解析失败: {path}") from e

    def login(self, username: str, password: str) -> str:
        """使用 username/password 登录，获取 JWT token。

        Args:
            username: 用户名（邮箱）
            password: 密码

        Returns:
            JWT token

        Raises:
            ParserResponseError: 登录失败
        """
        data = {"email": username, "password": password}
        result = self._request(Method.POST, "auth/sign-in", json=data)

        token = result.get("data", {}).get("token") if isinstance(result.get("data"), dict) else None
        if not token:
            raise ParserResponseError(
                f"登录失败：API 返回 code={result.get('code')}, "
                f"message={result.get('message')}, data={result.get('data')!r}"
            )

        self._token = token
        return token

    def verify_login_status(self) -> tuple[bool, str]:
        """验证登录状态。

        Returns:
            (是否已登录, 状态消息)
        """
        try:
            self._ensure_token()
        except ParserResponseError as e:
            return False, str(e)

        def _check_profile() -> tuple[bool, str]:
            result = self._request(Method.GET, "users/profile")
            user = result.get("data", {}).get("user", {})
            name = user.get("name", "")
            return True, f"已登录为 {name}" if name else "登录校验通过"

        try:
            return _check_profile()
        except ParserResponseError as e:
            error_msg = str(e)
            if "认证已失效" in error_msg and self._stored_username and self._stored_password:
                logger.info("Bika token expired, re-login with stored credentials")
                try:
                    self.login(self._stored_username, self._stored_password)
                    return _check_profile()
                except ParserResponseError as e2:
                    return False, f"自动重新登录失败: {e2}"
            return False, error_msg

    def search(self, keyword: str, page: int = 1, *, tag: str = "") -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索漫画。

        Args:
            keyword: 搜索关键词
            page: 页码 (1-based)
            tag: 标签（暂不支持）

        Returns:
            (漫画信息列表, 分页信息)
        """
        try:
            data = {"keyword": keyword, "sort": "dd"}
            result = self._request(Method.POST, f"comics/advanced-search?page={page}", json=data)
            return self._parse_comics_response(result)
        except ParserResponseError:
            raise

    def list_comics(
        self,
        page: int = 1,
        *,
        category: str = "",
        tag: str = "",
        author: str = "",
        sort: str = "dd",
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """浏览漫画列表（最新/分类/标签/作者）。

        Args:
            page: 页码 (1-based)
            category: 分类名称
            tag: 标签名称
            author: 作者名称
            sort: 排序方式 (dd=新→旧, da=旧→新, ld=最多喜欢, vd=最多观看)

        Returns:
            (漫画信息列表, 分页信息)
        """
        from urllib.parse import urlencode

        params: dict[str, str | int] = {"page": page, "s": sort}
        if category:
            params["c"] = category
        if tag:
            params["t"] = tag
        if author:
            params["a"] = author
        try:
            result = self._request(Method.GET, f"comics?{urlencode(params)}")
            return self._parse_comics_response(result)
        except ParserResponseError:
            raise

    def get_categories(self) -> list[dict[str, str]]:
        """获取漫画分类列表。

        Returns:
            分类列表，每项含 "id"、"title"、"thumb" 字段
        """
        try:
            result = self._request(Method.GET, "categories")
            categories = result.get("data", {}).get("categories", [])
            items = []
            for c in categories:
                if c.get("isWeb") or not c.get("title"):
                    continue
                thumb = c.get("thumb", {})
                file_server = thumb.get("fileServer", "")
                path = thumb.get("path", "")
                thumb_url = self._build_file_url(file_server, path) if file_server and path else ""
                items.append(
                    {
                        "id": c.get("_id", ""),
                        "title": c.get("title", ""),
                        "thumb": thumb_url,
                    }
                )
            return items
        except ParserResponseError:
            raise

    def get_leaderboard(self, rank_type: str = "H24") -> list[ComicInfo]:
        """获取漫画排行榜。

        Args:
            rank_type: 排行类型 (H24=日榜, D7=周榜, D30=月榜)

        Returns:
            漫画信息列表
        """
        try:
            result = self._request(Method.GET, f"comics/leaderboard?tt={rank_type}&ct=VC")
            docs = result.get("data", {}).get("comics", [])
            comics = []
            for doc in docs:
                try:
                    comics.append(self._parse_comic_item(doc))
                except Exception as e:
                    logger.debug("Parse leaderboard comic item skipped: %s", e)
            return comics
        except ParserResponseError:
            raise

    def get_random_comics(self) -> list[ComicInfo]:
        """获取随机推荐漫画。

        Returns:
            漫画信息列表
        """
        try:
            result = self._request(Method.GET, "comics/random")
            docs = result.get("data", {}).get("comics", [])
            comics = []
            for doc in docs:
                try:
                    comics.append(self._parse_comic_item(doc))
                except Exception as e:
                    logger.debug("Parse random comic item skipped: %s", e)
            return comics
        except ParserResponseError:
            raise

    def get_keywords(self) -> list[str]:
        """获取热搜关键词列表。

        Returns:
            关键词字符串列表
        """
        try:
            result = self._request(Method.GET, "keywords")
            keywords = result.get("data", {}).get("keywords", [])
            if isinstance(keywords, list):
                return [k for k in keywords if isinstance(k, str)]
            return []
        except ParserResponseError:
            raise

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情。

        Args:
            comic_id: 漫画 ID
            slug: URL slug（未使用）

        Returns:
            漫画信息，失败返回 None
        """
        try:
            result = self._request(Method.GET, f"comics/{comic_id}")
            comic_data = result.get("data", {}).get("comic", {})
            if not comic_data:
                return None
            comic = self._parse_comic_item(comic_data)
            chapters = self.get_chapters(comic_id)
            if chapters:
                comic.chapters = chapters
            return comic
        except ParserResponseError as e:
            logger.error("Bika get_comic_detail failed: %s", e, exc_info=True)
            return None

    def get_chapters(self, comic_id: str) -> list[ChapterInfo]:
        """获取漫画章节列表。

        Args:
            comic_id: 漫画 ID

        Returns:
            章节信息列表
        """
        chapters: list[ChapterInfo] = []
        page = 1

        try:
            while True:
                result = self._request(Method.GET, f"comics/{comic_id}/eps?page={page}")
                eps_data = result.get("data", {}).get("eps", {})
                docs = eps_data.get("docs", [])

                for doc in docs:
                    chapters.append(
                        ChapterInfo(
                            id=doc.get("_id", ""),
                            name=doc.get("title", ""),
                            index=doc.get("order", len(chapters) + 1),
                        )
                    )

                total_pages = eps_data.get("pages", 1)
                if page >= total_pages:
                    break
                page += 1

        except ParserResponseError as e:
            logger.error("Bika get_chapters failed: %s", e, exc_info=True)

        return chapters

    @staticmethod
    def _build_file_url(file_server: str, path: str) -> str:
        """Build a file URL handling trailing slash on file_server."""
        if file_server.endswith("/"):
            return f"{file_server}static/{path}"
        return f"{file_server}/static/{path}"

    def get_chapter_images(self, comic_id: str, order: int) -> list[str]:
        """获取章节图片列表。

        Args:
            comic_id: 漫画 ID
            order: 章节序号 (1-based)

        Returns:
            图片 URL 列表
        """
        images: list[str] = []
        page = 1

        try:
            while True:
                result = self._request(
                    Method.GET,
                    f"comics/{comic_id}/order/{order}/pages?page={page}",
                )
                pages_data = result.get("data", {}).get("pages", {})
                docs = pages_data.get("docs", [])

                for doc in docs:
                    media = doc.get("media", {})
                    file_server = media.get("fileServer", "")
                    path = media.get("path", "")
                    if file_server and path:
                        url = self._build_file_url(file_server, path)
                        images.append(url)

                total_pages = pages_data.get("pages", 1)
                if page >= total_pages:
                    break
                page += 1

        except ParserResponseError as e:
            logger.error("Bika get_chapter_images failed: %s", e, exc_info=True)

        return images

    def favourites(
        self, page: int = 1, raise_errors: bool = False
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """获取收藏夹漫画（按新→旧排序）。

        Bika API 默认返回老→新排序，此方法通过镜像页码实现全局反转。

        Args:
            page: 页码
            raise_errors: 是否抛出异常

        Returns:
            (漫画信息列表, 分页信息, 是否需要登录)
        """
        try:
            self._ensure_token()
        except ParserResponseError:
            return [], None, True

        try:
            if self._favourites_total_pages == 0:
                probe = self._request(Method.GET, "users/favourite?page=1")
                _, probe_pagination = self._parse_comics_response(probe)
                if probe_pagination and probe_pagination.total_pages > 0:
                    self._favourites_total_pages = probe_pagination.total_pages
                else:
                    comics, pagination = self._parse_comics_response(probe)
                    comics.reverse()
                    if pagination:
                        pagination.current_page = page
                    return comics, pagination, False

            total = self._favourites_total_pages
            api_page = max(1, min(total - page + 1, total))

            result = self._request(Method.GET, f"users/favourite?page={api_page}")
            comics, pagination = self._parse_comics_response(result)
            comics.reverse()

            if pagination:
                pagination.current_page = page

            return comics, pagination, False
        except ParserResponseError as e:
            logger.error("Bika favourites failed: %s", e, exc_info=True)
            if raise_errors:
                raise
            return [], None, False

    def add_to_favourites(self, comic_id: str) -> bool:
        """添加漫画到收藏夹。

        Args:
            comic_id: 漫画 ID

        Returns:
            成功返回 True
        """
        try:
            self._request(Method.POST, f"comics/{comic_id}/favourite")
            self._favourites_total_pages = 0
            return True
        except ParserResponseError as e:
            logger.error("Bika add_to_favourites failed: %s", e, exc_info=True)
            return False

    def check_favourite(self, comic_id: str) -> bool:
        """检查漫画是否已收藏。

        Args:
            comic_id: 漫画 ID

        Returns:
            已收藏返回 True
        """
        try:
            result = self._request(Method.GET, f"comics/{comic_id}")
            comic_data = result.get("data", {}).get("comic", {})
            return comic_data.get("isFavourite", False)
        except ParserResponseError:
            return False

    def remove_from_favourites(self, comic_id: str) -> bool:
        """从收藏夹移除漫画。

        Args:
            comic_id: 漫画 ID

        Returns:
            成功返回 True
        """
        try:
            self._request(Method.POST, f"comics/{comic_id}/favourite")
            self._favourites_total_pages = 0
            return True
        except ParserResponseError as e:
            logger.error("Bika remove_from_favourites failed: %s", e, exc_info=True)
            return False

    def _parse_comics_response(self, result: dict[str, Any]) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """解析漫画列表响应。

        Args:
            result: API 响应数据

        Returns:
            (漫画信息列表, 分页信息)
        """
        comics_data = result.get("data", {}).get("comics", {})
        docs = comics_data.get("docs", [])

        comics = []
        for doc in docs:
            try:
                comics.append(self._parse_comic_item(doc))
            except Exception as e:
                logger.debug("Parse comic item skipped: %s", e)

        pagination = self._parse_pagination(comics_data)
        return comics, pagination

    def _parse_comic_item(self, data: dict[str, Any]) -> ComicInfo:
        """解析单个漫画数据。

        Args:
            data: 漫画数据字典

        Returns:
            ComicInfo 对象
        """
        comic_id = data.get("_id", "")

        # 封面 URL
        thumb = data.get("thumb", {})
        file_server = thumb.get("fileServer", "")
        path = thumb.get("path", "")
        cover_url = ""
        if file_server and path:
            cover_url = self._build_file_url(file_server, path)

        # 标签和分类
        categories = data.get("categories", [])
        tags = data.get("tags", [])
        all_tags = list(dict.fromkeys(categories + tags))

        return ComicInfo(
            id=comic_id,
            title=data.get("title", "未知标题"),
            author=data.get("author"),
            pages=data.get("pagesCount", 0),
            category=categories[0] if categories else None,
            tags=all_tags,
            publish_date=(data.get("updated_at", "")[:10] if data.get("updated_at") else None),
            cover_url=cover_url,
            preview_url=f"{API_BASE_URL}comics/{comic_id}",
            media_id=comic_id,
            comic_source="BIKA",
            source_site="bika",
            album_id=comic_id,
            album_total_chapters=data.get("epsCount", 1),
        )

    def _parse_pagination(self, data: dict[str, Any]) -> PaginationInfo | None:
        """解析分页信息。

        Args:
            data: 分页数据字典

        Returns:
            PaginationInfo 对象
        """
        if not data:
            return None

        return PaginationInfo(
            current_page=data.get("page", 1),
            total_pages=data.get("pages", 1),
            limit=data.get("limit", 20),
            total_items=data.get("total", 0),
        )
