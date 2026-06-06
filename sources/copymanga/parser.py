"""拷贝漫画 (CopyManga) 解析模块。"""

from __future__ import annotations

import logging
import re

import requests
from lxml import html as lxml_html

from models import ChapterInfo, ComicInfo, PaginationInfo
from sources.base import ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session

from .constants import (
    AES_KEY_PAGE_URL,
    API_HEADERS,
    CHAPTER_PAGE_URL_TEMPLATE,
    CHAPTERS_URL_TEMPLATE,
    PAGE_SIZE,
    PC_HEADERS,
    PREVIEW_URL_TEMPLATE,
    SEARCH_URL_TEMPLATE,
)
from .crypto import AesKeyCache, decrypt_aes_cbc, extract_aes_key

logger = logging.getLogger(__name__)


class CopyMangaParser(ParserContextMixin):
    """拷贝漫画解析器。"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(PC_HEADERS)
        apply_system_proxy_to_session(self.session)
        self._aes_key_cache = AesKeyCache()

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        """配置认证信息。拷贝漫画不需要认证，保留接口兼容。"""

    def verify_login_status(self) -> tuple[bool, str]:
        """拷贝漫画不需要登录，始终返回已就绪。"""
        return True, "拷贝漫画无需登录"

    def favourites(self, page: int = 1, raise_errors: bool = False) -> tuple[list, None, bool]:
        """拷贝漫画不支持收藏夹。"""
        return [], None, False

    def add_to_favourites(self, comic_id: str) -> bool:
        """拷贝漫画不支持收藏夹。"""
        return False

    def check_favourite(self, comic_id: str) -> bool:
        """拷贝漫画不支持收藏夹。"""
        return False

    def remove_from_favourites(self, comic_id: str) -> bool:
        """拷贝漫画不支持收藏夹。"""
        return False

    # ------------------------------------------------------------------
    # 内部请求辅助
    # ------------------------------------------------------------------

    def _request_text(self, url: str, *, headers: dict | None = None) -> str:
        """发起 GET 请求并返回响应文本。"""
        try:
            resp = self.session.get(url, headers=headers, timeout=self.timeout, allow_redirects=True)
            resp.raise_for_status()
            return resp.text
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e

    def _request_json(self, url: str, *, headers: dict | None = None) -> dict:
        """发起 GET 请求并返回解析后的 JSON 字典。"""
        try:
            resp = self.session.get(url, headers=headers, timeout=self.timeout, allow_redirects=True)
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout as e:
            raise ParserResponseError(f"请求超时: {url}") from e
        except requests.ConnectionError as e:
            raise ParserResponseError(f"连接失败: {url}") from e
        except requests.RequestException as e:
            raise ParserResponseError(f"请求失败: {url} ({e})") from e
        except ValueError as e:
            raise ParserResponseError(f"响应解析失败: {url}") from e

    # ------------------------------------------------------------------
    # AES 密钥管理
    # ------------------------------------------------------------------

    def _ensure_aes_key(self) -> str:
        """确保 AES 密钥已缓存，未缓存则从页面提取。"""
        cached = self._aes_key_cache.get()
        if cached:
            return cached
        html_text = self._request_text(AES_KEY_PAGE_URL)
        key = extract_aes_key(html_text)
        self._aes_key_cache.set(key)
        return key

    def _decrypt(self, encrypted: str) -> dict:
        """解密 API 返回的加密数据，失败时清除缓存密钥。"""
        key = self._ensure_aes_key()
        try:
            return decrypt_aes_cbc(encrypted, key)
        except Exception:
            self._aes_key_cache.clear()
            raise

    # ------------------------------------------------------------------
    # 搜索
    # ------------------------------------------------------------------

    def search(self, keyword: str, page: int = 1, *, tag: str = "") -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索漫画。"""
        offset = (page - 1) * PAGE_SIZE
        url = SEARCH_URL_TEMPLATE.format(offset=offset, keyword=keyword)
        try:
            data = self._request_json(url, headers=API_HEADERS)
        except ParserResponseError as e:
            logger.error("CopyManga search failed: %s", e, exc_info=True)
            return [], None

        results = data.get("results") or {}
        items = results.get("list") or []
        total = results.get("total", 0)

        comics = []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                comics.append(self._parse_search_item(item))
            except (KeyError, TypeError, ValueError) as e:
                logger.debug("Parse search item skipped: %s", e)

        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
            limit=PAGE_SIZE,
            total_items=total,
        )
        return comics, pagination

    @staticmethod
    def _parse_search_item(item: dict) -> ComicInfo:
        """解析搜索结果中的单个漫画。"""
        path_word = item.get("path_word", "")
        name = item.get("name", "未知标题")
        authors = item.get("author") or []
        author_names = ", ".join(a.get("name", "") for a in authors if a.get("name"))
        cover = item.get("cover", "")

        # 从 last_chapter_name 提取章节数（如 "第243话" → 243）
        last_ch = item.get("last_chapter_name", "")
        total_chapters = 1
        if m := re.search(r"(\d+)", last_ch):
            total_chapters = int(m.group(1))

        return ComicInfo(
            id=path_word,
            title=name,
            author=author_names or None,
            pages=0,
            cover_url=cover,
            preview_url=PREVIEW_URL_TEMPLATE.format(path_word=path_word),
            source_site="copymanga",
            comic_source="COPYMANGA",
            album_total_chapters=total_chapters,
        )

    # ------------------------------------------------------------------
    # 详情 & 章节列表
    # ------------------------------------------------------------------

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情（含章节列表）。

        Args:
            comic_id: 漫画的 path_word
        """
        try:
            url = CHAPTERS_URL_TEMPLATE.format(path_word=comic_id)
            headers = {
                **API_HEADERS,
                "Referer": PREVIEW_URL_TEMPLATE.format(path_word=comic_id),
            }
            data = self._request_json(url, headers=headers)
            encrypted = data.get("results")
            if not isinstance(encrypted, str):
                raise ValueError("Chapters payload missing encrypted results")
            decrypted = self._decrypt(encrypted)
            return self._parse_chapters_payload(decrypted, comic_id)
        except Exception as e:
            logger.error("CopyManga get_comic_detail failed: %s", e, exc_info=True)
            return None

    def get_chapters(self, path_word: str) -> list[ChapterInfo]:
        """获取漫画章节列表。

        Args:
            path_word: 漫画的 path_word

        Returns:
            章节列表
        """
        try:
            url = CHAPTERS_URL_TEMPLATE.format(path_word=path_word)
            headers = {
                **API_HEADERS,
                "Referer": PREVIEW_URL_TEMPLATE.format(path_word=path_word),
            }
            data = self._request_json(url, headers=headers)
            encrypted = data.get("results")
            if not isinstance(encrypted, str):
                return []
            decrypted = self._decrypt(encrypted)
            return self._extract_chapters(decrypted)
        except Exception as e:
            logger.error("CopyManga get_chapters failed: %s", e, exc_info=True)
            return []

    def _parse_chapters_payload(self, decrypted: dict, path_word: str) -> ComicInfo:
        """解析解密后的章节数据，构建 ComicInfo。"""
        build = decrypted.get("build") or {}
        chapters = self._extract_chapters(decrypted)

        # 从 build 中提取元数据
        comic_name = build.get("name", path_word)
        comic_author = build.get("author") or []
        author_names = ", ".join(a.get("name", "") for a in comic_author if isinstance(a, dict) and a.get("name"))
        cover = build.get("cover", "")

        return ComicInfo(
            id=path_word,
            title=comic_name,
            author=author_names or None,
            pages=0,
            cover_url=cover,
            preview_url=PREVIEW_URL_TEMPLATE.format(path_word=path_word),
            source_site="copymanga",
            comic_source="COPYMANGA",
            chapters=chapters,
            album_id=path_word,
            album_total_chapters=len(chapters) or 1,
        )

    @staticmethod
    def _extract_chapters(decrypted: dict) -> list[ChapterInfo]:
        """从解密数据中提取章节列表。"""
        groups = decrypted.get("groups") or {}
        default_group = groups.get("default") or {}
        chapters_data = default_group.get("chapters") or []

        result = []
        for idx, ch in enumerate(chapters_data, start=1):
            if not isinstance(ch, dict):
                continue
            result.append(
                ChapterInfo(
                    id=ch.get("id", ""),
                    name=ch.get("name", ""),
                    index=idx,
                )
            )
        return result

    # ------------------------------------------------------------------
    # 章节图片
    # ------------------------------------------------------------------

    def get_chapter_images(self, path_word: str, chapter_id: str) -> list[str]:
        """获取章节图片 URL 列表。

        Args:
            path_word: 漫画的 path_word
            chapter_id: 章节 ID

        Returns:
            图片 URL 列表
        """
        try:
            url = CHAPTER_PAGE_URL_TEMPLATE.format(path_word=path_word, chapter_id=chapter_id)
            html_text = self._request_text(url)
            content_key = self._extract_content_key(html_text)
            image_data = self._decrypt(content_key)
            urls = []
            for item in image_data:
                if isinstance(item, dict) and item.get("url"):
                    urls.append(item["url"])
            return urls
        except Exception as e:
            logger.error("CopyManga get_chapter_images failed: %s", e, exc_info=True)
            return []

    @staticmethod
    def _extract_content_key(html_text: str) -> str:
        """从章节 HTML 页面提取 contentKey 变量的值。"""
        doc = lxml_html.fromstring(html_text)
        scripts = doc.xpath('//script[contains(text(), "contentKey")]/text()')
        script = next(iter(scripts), None)
        if not script:
            raise ValueError("contentKey script not found in chapter page")
        match = re.search(r"""var\s+contentKey\s*=\s*["']([^"']+)["']""", script)
        if not match:
            raise ValueError("contentKey value not found")
        key = match.group(1)
        if not key:
            raise ValueError("contentKey is empty")
        return key
