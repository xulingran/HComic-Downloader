"""jmcomic 页面解析模块。"""
from __future__ import annotations

import logging
import re
from urllib.parse import quote

import requests
from lxml import etree

from jmcomic.constants import (
    DEFAULT_DOMAIN,
    DETAIL_URL_TEMPLATE,
    HEADERS,
    RANDOM_URL_TEMPLATE,
    RANKING_MAPPINGS,
    RANKING_URL_TEMPLATE,
    SEARCH_URL_TEMPLATE,
)
from jmcomic.domain import JmDomainResolver
from models import ComicInfo, PaginationInfo
from utils import apply_system_proxy_to_session, configure_session_auth

logger = logging.getLogger(__name__)

_RANKING_RE = re.compile(r"^[日周月总](更新|点击|评分|评论|收藏)$")
_INVALID_ID_RE = re.compile(r"album_missing|login")


class JmParser:
    """jmcomic 解析器，实现与 HComicParser 相同的接口。"""

    def __init__(self, timeout: int = 30, cookie: str = "", user_agent: str = ""):
        self.timeout = timeout
        self._cookie = cookie
        self._user_agent = user_agent
        self._domain: str | None = None
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        apply_system_proxy_to_session(self.session)
        self.configure_auth(cookie=cookie, user_agent=user_agent)

    def _ensure_domain(self) -> str:
        if not self._domain:
            resolver = JmDomainResolver()
            self._domain = resolver.resolve()
        return self._domain

    def configure_auth(self, cookie: str = "", user_agent: str = "", bearer_token: str = ""):
        configure_session_auth(self.session, HEADERS, cookie, user_agent, bearer_token)
        self._cookie = cookie
        self._user_agent = user_agent

    def close(self):
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def verify_login_status(self) -> tuple[bool, str]:
        """通过访问需要登录的页面验证 Cookie 有效性。"""
        domain = self._ensure_domain()
        try:
            url = f"https://{domain}/user/favorites"
            resp = self.session.get(url, timeout=self.timeout, allow_redirects=True)
            if resp.url and "/login" in str(resp.url):
                return False, "登录已失效，请重新登录"
            if resp.status_code == 200:
                return True, "登录校验通过"
            return False, "登录已失效，请重新登录"
        except requests.RequestException as e:
            return False, f"登录校验失败: {e}"

    def search(self, keyword: str, page: int = 1, *, tag: str = "") -> tuple[list[ComicInfo], PaginationInfo | None]:
        """搜索漫画。支持关键词、标签和排行模式。"""
        domain = self._ensure_domain()
        if self._is_ranking_keyword(keyword):
            return self._search_ranking(keyword, page=page)

        url = self._build_search_url(keyword, page=page)
        try:
            html = self._request_text(url)
            return self._parse_search_results(html, domain=domain)
        except Exception as e:
            logger.error("jmcomic search failed: %s", e)
            return [], None

    def random(self) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """随机漫画。"""
        domain = self._ensure_domain()
        url = self._build_random_url()
        try:
            html = self._request_text(url)
            return self._parse_search_results(html, domain=domain)
        except Exception as e:
            logger.error("jmcomic random failed: %s", e)
            return [], None

    def get_comic_detail(self, comic_id: str, slug: str = "") -> ComicInfo | None:
        """获取漫画详情，补齐图片 URL 列表。"""
        domain = self._ensure_domain()
        url = f"https://{domain}/album/{comic_id}"
        try:
            html = self._request_text(url)
            return self._parse_detail(html, comic_id=comic_id, domain=domain)
        except Exception as e:
            logger.error("jmcomic get_comic_detail failed: %s", e)
            return None

    def favourites(self, page: int = 1, raise_errors: bool = False) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """jmcomic 收藏夹（暂未实现）。"""
        return [], None, False

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
            logger.error("jmcomic ranking search failed: %s", e)
            return [], None

    @staticmethod
    def _is_ranking_keyword(keyword: str) -> bool:
        return bool(_RANKING_RE.match(keyword or ""))

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
        resp = self.session.get(url, timeout=self.timeout, allow_redirects=True)
        resp.raise_for_status()
        if not resp.encoding or resp.encoding.lower() in ("iso-8859-1", "latin-1"):
            resp.encoding = "utf-8"
        return resp.text

    def _parse_search_results(self, html: str, domain: str) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """解析搜索结果页面。"""
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

    def _parse_search_item(self, item, domain: str) -> ComicInfo | None:
        """解析单个搜索结果项。"""
        link = item.xpath('.//a/@href')
        if not link:
            return None
        href = link[0]
        id_match = re.search(r"/album/(\d+)", href)
        if not id_match:
            return None
        comic_id = id_match.group(1)

        title_el = item.xpath('.//img/@title') or item.xpath('.//img/@alt')
        title = title_el[0].strip() if title_el else ""
        if not title:
            span_title = item.xpath('.//span[contains(@class,"video-title")]/text()')
            title = span_title[0].strip() if span_title else "未知标题"

        img_el = item.xpath('.//img/@data-original') or item.xpath('.//img/@src')
        cover_url = img_el[0] if img_el else ""
        if cover_url and not cover_url.startswith("http"):
            cover_url = f"https://{domain}{cover_url}"
        if cover_url.endswith("blank.jpg"):
            cover_url = ""

        return ComicInfo(
            id=comic_id,
            title=title,
            cover_url=cover_url,
            preview_url=f"https://{domain}/album/{comic_id}",
            source_site="jmcomic",
        )

    def _parse_pagination(self, doc) -> PaginationInfo | None:
        """解析分页信息。"""
        page_links = doc.xpath('//ul[@class="pagination"]/li/a/text()')
        if not page_links:
            return None
        pages = []
        for text in page_links:
            try:
                pages.append(int(text.strip()))
            except ValueError:
                continue
        if not pages:
            return None
        total_pages = max(pages)
        return PaginationInfo(
            current_page=pages[0] if pages else 1,
            total_pages=total_pages,
            total_items=0,
        )

    def _parse_detail(self, html: str, comic_id: str, domain: str) -> ComicInfo:
        """解析漫画详情页面。"""
        doc = etree.HTML(html)
        title_el = doc.xpath("//h1/text()")
        title = title_el[0].strip() if title_el else "未知标题"

        image_urls: list[str] = []
        scramble_id = ""
        img_elements = doc.xpath('.//img[contains(@id,"album_photo_")]')
        for img in img_elements:
            img_url = img.xpath("./@data-original") or img.xpath("./@src")
            if img_url:
                url = img_url[0]
                if not url.startswith("http"):
                    url = f"https://{domain}{url}"
                if url.endswith("blank.jpg"):
                    continue
                image_urls.append(url)
                if not scramble_id:
                    m = re.search(r"/\d+/(\d+)/", url)
                    if m:
                        scramble_id = m.group(1)

        author = None
        artist_el = doc.xpath('.//span[@data-type="author"]/a/text()')
        if artist_el:
            author = artist_el[0].strip()

        tags = doc.xpath('.//span[@data-type="tags"]/a/text()')

        pages = 0
        pages_text = doc.xpath('.//div[contains(text(),"頁數") or contains(text(),"页数")]/text()')
        if pages_text:
            m = re.search(r"\d+", pages_text[0])
            if m:
                pages = int(m.group())

        cover_url = ""
        cover_el = doc.xpath('.//div[@id="album_photo_cover"]//img/@src')
        if cover_el:
            cover_url = cover_el[0]
            if not cover_url.startswith("http"):
                cover_url = f"https://{domain}{cover_url}"

        return ComicInfo(
            id=comic_id,
            title=title,
            author=author,
            pages=max(pages, len(image_urls)),
            tags=tags,
            cover_url=cover_url,
            preview_url=f"https://{domain}/album/{comic_id}",
            media_id=comic_id,
            comic_source="JMCOMIC",
            source_site="jmcomic",
            scramble_id=scramble_id,
            image_urls=image_urls,
        )
