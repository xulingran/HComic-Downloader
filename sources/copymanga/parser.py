"""拷贝漫画 (CopyManga) 解析模块。"""

from __future__ import annotations

import logging
import re
from http.cookiejar import Cookie

import requests
from lxml import html as lxml_html

from models import ChapterInfo, ComicInfo, PaginationInfo
from sources.base import ParserContextMixin, ParserResponseError
from utils import apply_system_proxy_to_session

from .constants import (
    AES_KEY_PAGE_URL,
    API_HEADERS,
    CATEGORY_CONFIG,
    CHAPTER_PAGE_URL_TEMPLATE,
    CHAPTERS_URL_TEMPLATE,
    COMICS_LIST_URL_TEMPLATE,
    PAGE_SIZE,
    PC_DOMAIN,
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
        self._session_warmed_up = False

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        """配置认证信息。将 cookie 注入到 session 以访问章节内容。"""
        if not cookie:
            return
        # 解析 cookie 字符串并注入 session
        jar = self.session.cookies
        jar.clear()
        domain = PC_DOMAIN
        for pair in cookie.split(";"):
            pair = pair.strip()
            if "=" not in pair:
                continue
            name, _, value = pair.partition("=")
            name = name.strip()
            value = value.strip()
            if not name:
                continue
            c = Cookie(
                version=0,
                name=name,
                value=value,
                port=None,
                port_specified=False,
                domain=domain,
                domain_specified=True,
                domain_initial_dot=False,
                path="/",
                path_specified=True,
                secure=True,
                expires=None,
                discard=True,
                comment=None,
                comment_url=None,
                rest={},
            )
            jar.set_cookie(c)
        # 设置 cookie 后需要重新预热
        self._session_warmed_up = False
        logger.debug("CopyManga auth configured with %d cookies", len(jar))

    def verify_login_status(self) -> tuple[bool, str]:
        """检查是否有登录 token cookie。"""
        # 检查 token cookie 是否存在
        token = self.session.cookies.get("token", domain=PC_DOMAIN)
        if token:
            return True, "已登录拷贝漫画"
        # 尝试访问漫画页面看是否有章节内容
        return False, "拷贝漫画需要登录才能查看漫画内容"

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
            # 包含 json.JSONDecodeError 和空响应检查
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

    # ------------------------------------------------------------------
    # Session 预热
    # ------------------------------------------------------------------

    def _warmup_session(self) -> None:
        """确保 session 已访问 PC 域名以获取必要 cookies。"""
        if self._session_warmed_up:
            return
        try:
            self._ensure_aes_key()
        except ParserResponseError:
            logger.debug("Session warmup failed, will proceed anyway")
        self._session_warmed_up = True

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
        """搜索漫画。空关键词时按分类浏览主页内容。"""
        if keyword.strip():
            return self._search_by_keyword(keyword, page)
        category = (tag or "hot").strip().lower()
        category = category if category in CATEGORY_CONFIG else "hot"
        config = CATEGORY_CONFIG[category]
        if "ordering" in config:
            return self._browse_comics_list(config["ordering"], page)
        return self._browse_html_page(config["url"], category)

    def _search_by_keyword(self, keyword: str, page: int = 1) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """关键词搜索。"""
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

    def _browse_comics_list(self, ordering: str, page: int = 1) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """通过漫画列表 API 浏览（热门更新 / 人气排行）。"""
        offset = (page - 1) * PAGE_SIZE
        url = COMICS_LIST_URL_TEMPLATE.format(limit=PAGE_SIZE, offset=offset, ordering=ordering)
        try:
            data = self._request_json(url, headers=API_HEADERS)
        except ParserResponseError as e:
            logger.error("CopyManga browse comics failed: %s", e, exc_info=True)
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
                logger.debug("Parse browse item skipped: %s", e)

        pagination = PaginationInfo(
            current_page=page,
            total_pages=max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
            limit=PAGE_SIZE,
            total_items=total,
        )
        return comics, pagination

    def _browse_html_page(self, url: str, category: str) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """通过爬取 HTML 页面浏览（推荐 / 全新上架）。"""
        try:
            html_text = self._request_text(url)
        except ParserResponseError as e:
            logger.error("CopyManga browse HTML failed: %s", e, exc_info=True)
            return [], None

        doc = lxml_html.fromstring(html_text)
        comics: list[ComicInfo] = []
        seen: set[str] = set()

        for item_el in doc.cssselect(".exemptComic_Item"):
            img_a = item_el.cssselect("a[href^='/comic/']")
            if not img_a:
                continue
            href = img_a[0].get("href", "")
            path_word = href.rsplit("/comic/", 1)[-1] if "/comic/" in href else ""
            if not path_word or path_word in seen:
                continue
            seen.add(path_word)

            img_el = item_el.cssselect("img")
            cover = ""
            if img_el:
                cover = img_el[0].get("data-src") or img_el[0].get("src") or ""

            title_p = item_el.cssselect(".exemptComicItem-txt p[title]")
            title = title_p[0].get("title", "") if title_p else ""

            comics.append(
                ComicInfo(
                    id=path_word,
                    title=title or path_word,
                    pages=0,
                    cover_url=cover,
                    preview_url=PREVIEW_URL_TEMPLATE.format(path_word=path_word),
                    source_site="copymanga",
                    comic_source="COPYMANGA",
                    album_total_chapters=1,
                )
            )

        pagination = PaginationInfo(
            current_page=1,
            total_pages=1,
            limit=len(comics),
            total_items=len(comics),
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
            self._warmup_session()
            return self._fetch_comic_detail(comic_id)
        except Exception as first_error:
            logger.warning("CopyManga get_comic_detail first attempt failed: %s", first_error)
            # 强制重新预热并重试一次
            self._session_warmed_up = False
            try:
                self._warmup_session()
                return self._fetch_comic_detail(comic_id)
            except Exception as e:
                logger.error("CopyManga get_comic_detail failed after retry: %s", e, exc_info=True)
                return None

    def _fetch_comic_detail(self, comic_id: str) -> ComicInfo:
        """获取漫画详情的内部实现，异常由调用方处理。"""
        url = CHAPTERS_URL_TEMPLATE.format(path_word=comic_id)
        headers = {
            "Accept": "application/json",
            "Referer": PREVIEW_URL_TEMPLATE.format(path_word=comic_id),
        }
        data = self._request_json(url, headers=headers)
        encrypted = data.get("results")
        if not isinstance(encrypted, str):
            raise ValueError("Chapters payload missing encrypted results")
        decrypted = self._decrypt(encrypted)
        return self._parse_chapters_payload(decrypted, comic_id)

    def get_chapters(self, path_word: str) -> list[ChapterInfo]:
        """获取漫画章节列表。

        Args:
            path_word: 漫画的 path_word

        Returns:
            章节列表
        """
        try:
            self._warmup_session()
            return self._fetch_chapters(path_word)
        except Exception as first_error:
            logger.warning("CopyManga get_chapters first attempt failed: %s", first_error)
            self._session_warmed_up = False
            try:
                self._warmup_session()
                return self._fetch_chapters(path_word)
            except Exception as e:
                logger.error("CopyManga get_chapters failed after retry: %s", e, exc_info=True)
                return []

    def _fetch_chapters(self, path_word: str) -> list[ChapterInfo]:
        """获取章节列表的内部实现，异常由调用方处理。"""
        url = CHAPTERS_URL_TEMPLATE.format(path_word=path_word)
        headers = {
            "Accept": "application/json",
            "Referer": PREVIEW_URL_TEMPLATE.format(path_word=path_word),
        }
        data = self._request_json(url, headers=headers)
        encrypted = data.get("results")
        if not isinstance(encrypted, str):
            return []
        decrypted = self._decrypt(encrypted)
        return self._extract_chapters(decrypted)

    def _parse_chapters_payload(self, decrypted: dict, path_word: str) -> ComicInfo:
        """解析解密后的章节数据，构建 ComicInfo。"""
        build = decrypted.get("build") or {}
        chapters = self._extract_chapters(decrypted)

        # 从 build 中提取元数据
        comic_name = build.get("name", path_word)
        comic_author = build.get("author") or []
        author_names = ", ".join(a.get("name", "") for a in comic_author if isinstance(a, dict) and a.get("name"))
        cover = build.get("cover", "")

        # API 没有返回章节时，尝试从漫画 HTML 页面获取第一个章节
        if not chapters:
            chapters = self._extract_first_chapter_from_html(path_word)

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
        """从解密数据中提取章节列表。

        支持两种数据结构：
        - 旧格式：groups 在顶层 (groups.default.chapters)
        - 新格式：groups 在 build 内部 (build.groups.default.chapters)
        """
        # 旧格式：顶层 groups
        groups = decrypted.get("groups") or {}
        if not groups:
            # 新格式：build.groups
            build = decrypted.get("build") or {}
            groups = build.get("groups") or {}

        # 遍历所有分组收集章节
        all_chapters: list[ChapterInfo] = []
        idx = 0
        for _group_name, group_data in groups.items():
            if not isinstance(group_data, dict):
                continue
            chapters_data = group_data.get("chapters") or []
            for ch in chapters_data:
                if not isinstance(ch, dict):
                    continue
                idx += 1
                all_chapters.append(
                    ChapterInfo(
                        id=ch.get("id", ""),
                        name=ch.get("name", ""),
                        index=idx,
                    )
                )
        return all_chapters

    def _extract_first_chapter_from_html(self, path_word: str) -> list[ChapterInfo]:
        """从漫画 HTML 页面提取第一个章节链接作为回退。"""
        try:
            url = f"https://{PC_DOMAIN}/comic/{path_word}"
            html_text = self._request_text(url)
            doc = lxml_html.fromstring(html_text)
            chapter_links = doc.xpath("//a[contains(@href, '/chapter/')]")
            if chapter_links:
                href = chapter_links[0].get("href", "")
                if "/chapter/" in href:
                    chapter_id = href.rsplit("/chapter/", 1)[-1]
                    logger.debug(
                        "CopyManga: found first chapter from HTML page: %s",
                        chapter_id,
                    )
                    return [ChapterInfo(id=chapter_id, name="第1话", index=1)]
        except Exception as e:
            logger.debug("CopyManga: failed to extract chapter from HTML: %s", e)
        return []

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
        match = re.search(r"""var\s+contentKey\s*=\s*["']([^"']*)["']""", script)
        if not match:
            raise ValueError("contentKey value not found")
        key = match.group(1)
        if not key:
            raise ValueError("contentKey is empty — 拷贝漫画需要登录才能查看漫画内容，请在设置中配置登录凭证")
        return key
