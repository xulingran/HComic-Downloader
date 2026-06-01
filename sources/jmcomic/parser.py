"""jmcomic 页面解析模块。"""

from __future__ import annotations

import logging
import re
from urllib.parse import quote

import requests
from lxml import etree

from models import ChapterInfo, ComicInfo, PaginationInfo
from utils import configure_session_auth

from .constants import (
    HEADERS,
    RANDOM_URL_TEMPLATE,
    RANKING_MAPPINGS,
    SEARCH_URL_TEMPLATE,
)
from .domain import JmDomainResolver
from .session import create_session

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
        self._cdn_domain: str | None = None
        self._cookie_synced = False
        self.session = create_session()
        self.session.headers.update(HEADERS)
        self.configure_auth(cookie=cookie, user_agent=user_agent)

    def _ensure_domain(self) -> str:
        if not self._domain:
            resolver = JmDomainResolver()
            self._domain = resolver.resolve()
        self._sync_cookies_to_jar()
        return self._domain

    def _sync_cookies_to_jar(self):
        """将 self._cookie 中的 cookies 设置到 session cookie jar 中。

        curl_cffi/libcurl 不认可 session.headers['Cookie']，
        必须通过 cookie jar 设置才能随请求发送。
        """
        if (
            getattr(self, "_cookie_synced", False)
            or not getattr(self, "_cookie", "")
            or not self._domain
        ):
            return
        try:
            for part in self._cookie.split(";"):
                part = part.strip()
                if "=" in part:
                    name, value = part.split("=", 1)
                    self.session.cookies.set(
                        name.strip(), value.strip(), domain=self._domain
                    )
            self._cookie_synced = True
            logger.info(
                "Synced %d cookies to jar for domain %s",
                self._cookie.count(";") + 1,
                self._domain,
            )
        except Exception:
            logger.warning("Failed to sync cookies to jar", exc_info=True)

    def set_custom_domain(self, domain: str) -> None:
        """设置自定义域名。传空字符串则清除自定义值，下次自动解析。"""
        old_domain = self._domain
        self._domain = domain.strip() if domain and domain.strip() else None
        # 域名变更后需要重新将 cookie 同步到新域名的 cookie jar
        if (
            self._domain
            and self._domain != old_domain
            and hasattr(self, "_cookie_synced")
        ):
            self._cookie_synced = False

    @property
    def cdn_domain(self) -> str | None:
        """返回当前解析到的 CDN 域名（如 cdn-msp2.jmcomic-zzz.one）。"""
        return self._cdn_domain

    def configure_auth(
        self, cookie: str = "", user_agent: str = "", bearer_token: str = ""
    ):
        configure_session_auth(self.session, HEADERS, cookie, user_agent, bearer_token)
        # curl_cffi/libcurl 不认可 session.headers['Cookie']，
        # 改用 cookie jar 方式设置 cookies
        self.session.headers.pop("Cookie", None)
        self._cookie = cookie
        self._user_agent = user_agent
        self._cookie_synced = False

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
            # 检测 Cloudflare 拦截
            if resp.status_code == 403 and "Just a moment" in resp.text[:200]:
                return False, "Cookie 中的 cf_clearance 已过期，请重新通过弹窗登录获取"
            if resp.url and "/login" in str(resp.url):
                return False, "登录已失效，请重新登录"
            if resp.status_code == 200:
                return True, "登录校验通过"
            return False, "登录已失效，请重新登录"
        except requests.RequestException as e:
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
                headers={
                    "Referer": f"https://{domain}/album/{comic_id}",
                    "X-Requested-With": "XMLHttpRequest",
                },
            )
            resp.raise_for_status()
            result = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {}
            )
            if result.get("status") == "ok" or result.get("success"):
                return True
            # 如果返回了结果但不是明确的失败，也认为成功（某些站点返回空对象）
            return True
        except requests.RequestException as e:
            logger.error("jmcomic add_to_favourites failed: %s", e)
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
        domain = self._ensure_domain()
        url = f"https://{domain}/ajax/favorite/check"
        try:
            resp = self.session.get(
                url,
                params={"aid": comic_id},
                timeout=self.timeout,
                headers={
                    "Referer": f"https://{domain}/",
                    "X-Requested-With": "XMLHttpRequest",
                },
            )
            resp.raise_for_status()
            result = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {}
            )
            return bool(
                result.get("favorited")
                or result.get("is_favorite")
                or result.get("status") == "ok"
            )
        except requests.RequestException as e:
            logger.error("jmcomic check_favourite failed: %s", e)
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
                headers={
                    "Referer": f"https://{domain}/album/{comic_id}",
                    "X-Requested-With": "XMLHttpRequest",
                },
            )
            resp.raise_for_status()
            return True
        except requests.RequestException as e:
            logger.error("jmcomic remove_from_favourites failed: %s", e)
            raise RuntimeError(f"移除收藏夹失败: {e}") from e

    def search(
        self, keyword: str, page: int = 1, *, tag: str = ""
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
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

    def favourites(
        self, page: int = 1, raise_errors: bool = False
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """获取 jmcomic 收藏夹漫画。

        Args:
            page: 页码
            raise_errors: 如果为 True，异常会向上传播而不是静默返回空列表

        Returns:
            (漫画信息列表, 分页信息, 是否需要登录)
        """
        domain = self._ensure_domain()
        url = f"https://{domain}/user/favorites"
        if page > 1:
            url += f"?page={page}"
        try:
            resp = self.session.get(
                url,
                timeout=self.timeout,
                allow_redirects=True,
                headers={"Referer": f"https://{domain}/"},
            )
            # 检查是否重定向到登录页面
            if resp.url and "/login" in str(resp.url):
                return [], None, True
            if not resp.encoding or resp.encoding.lower() in ("iso-8859-1", "latin-1"):
                resp.encoding = "utf-8"
            html = resp.text
            doc = etree.HTML(html)
            # 检查是否需要登录（页面包含登录提示）
            login_prompt = doc.xpath('//div[contains(text(),"請先登入")]')
            if login_prompt:
                return [], None, True
            comics = self._parse_favourites_items(doc, domain=domain)
            pagination = self._parse_pagination(doc)
            # 部分条目标题由 JS 懒加载，HTML 中不存在；
            # 通过并发获取专辑详情页来补全缺失的标题。
            self._fill_missing_titles(comics, domain)
            return comics, pagination, False
        except Exception as e:
            logger.error("jmcomic favourites failed: %s", e)
            if raise_errors:
                raise
            return [], None, False

    def _parse_favourites_items(self, doc, domain: str) -> list[ComicInfo]:
        """解析收藏夹页面的漫画列表。"""
        items = doc.xpath('//div[contains(@class,"thumb-overlay")]')
        if not items:
            logger.debug(
                "No thumb-overlay items found in favourites page; trying alternate selectors"
            )
            # The favourites page may use a different container structure
            items = doc.xpath(
                '//div[contains(@class,"thumb") and not(contains(@class,"thumb-overlay"))]'
            )
        comics = []
        for item in items:
            try:
                comic = self._parse_search_item(item, domain=domain)
                if comic:
                    comics.append(comic)
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

    def _fill_missing_titles(self, comics: list[ComicInfo], domain: str) -> None:
        """并发获取专辑详情页标题，补全 HTML 中 JS 懒加载导致的缺失标题。

        JMComic 收藏夹页面中，首屏之外条目的 <div class="image-item-text"/>
        为空（标题由 JS 异步填充），需独立请求各专辑页提取 <h1> 标题。
        每个线程创建独立 session 以保证线程安全。
        """
        missing = [c for c in comics if not c.title or c.title == "未知标题"]
        if not missing:
            return

        from concurrent.futures import ThreadPoolExecutor, as_completed

        logger.info(
            "Fetching titles for %d/%d comics without server-rendered titles",
            len(missing),
            len(comics),
        )

        # 将主 session 的 cookies 预先序列化，供各线程独立注入
        main_cookies: list[tuple[str, str]] = []
        try:
            for cookie in self.session.cookies:
                main_cookies.append((cookie.name, cookie.value))
        except Exception:
            pass

        def _fetch_title(cid: str) -> tuple[str, str, str]:
            """线程安全：独立 session + 完整 headers 上下文。
            返回 (cid, title, error_reason)。"""
            import random
            import time

            # 随机延迟避免短时间集中请求触发限流
            time.sleep(random.uniform(0.2, 0.6))
            try:
                url = f"https://{domain}/album/{cid}"
                try:
                    from curl_cffi import requests as cf_requests

                    sess = cf_requests.Session(impersonate="chrome136")
                except ImportError:
                    import requests

                    sess = requests.Session()
                sess.headers.update(HEADERS)
                sess.headers["Referer"] = f"https://{domain}/"
                for name, value in main_cookies:
                    sess.cookies.set(name, value, domain=domain)
                r = sess.get(url, timeout=self.timeout)
                # 检查是否被重定向到登录页（限制级漫画需要登录）
                if r.url and "/login" in str(r.url):
                    return cid, "", "redirected to login (age-restricted?)"
                r.raise_for_status()
                if not r.encoding or r.encoding.lower() in ("iso-8859-1", "latin-1"):
                    r.encoding = "utf-8"
                doc = etree.HTML(r.text)
                title_el = doc.xpath('//h1[@id="book-name"]/text()')
                if title_el:
                    return cid, title_el[0].strip(), ""
                # 页面加载成功但未找到标题元素
                h1_fallback = doc.xpath("//h1/text()")
                if h1_fallback:
                    return cid, h1_fallback[0].strip(), ""
                return cid, "", "h1#book-name not found in page"
            except Exception as e:
                err_msg = str(e)[:120]
                return cid, "", err_msg

        cid_to_idx = {c.id: i for i, c in enumerate(comics)}
        max_workers = min(4, len(missing))
        fetched = 0
        failures: list[tuple[str, str]] = []
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_fetch_title, c.id): c.id for c in missing}
            for future in as_completed(futures):
                cid, title, error = future.result()
                if title and cid in cid_to_idx:
                    comics[cid_to_idx[cid]].title = title
                    fetched += 1
                elif error and cid in cid_to_idx:
                    failures.append((cid, error))

        if fetched:
            logger.info("Filled %d missing titles from album detail pages", fetched)
        if failures:
            # 按错误原因分组统计
            from collections import Counter

            reason_counts = Counter(err for _, err in failures)
            reasons = ", ".join(
                f"{reason}: {cnt}" for reason, cnt in reason_counts.most_common()
            )
            failed_ids = [cid for cid, _ in failures[:5]]
            logger.warning(
                "Failed to fetch %d titles. Reasons: %s. First IDs: %s",
                len(failures),
                reasons,
                failed_ids,
            )

    def _search_ranking(
        self, keyword: str, page: int = 1
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
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
        domain = self._ensure_domain()
        headers = {"Referer": f"https://{domain}/"}
        resp = self.session.get(
            url, timeout=self.timeout, allow_redirects=True, headers=headers
        )
        resp.raise_for_status()
        if not resp.encoding or resp.encoding.lower() in ("iso-8859-1", "latin-1"):
            resp.encoding = "utf-8"
        return resp.text

    def _parse_search_results(
        self, html: str, domain: str
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
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

        # Preferred: jmcomic favourites uses <div class="image-item-text">
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

        img_el = (
            item.xpath(".//img/@data-original")
            or item.xpath(".//img/@data-src")
            or item.xpath(".//img/@src")
        )
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
            tags = self._clean_texts(
                card.xpath('.//div[contains(@class,"tags")]//a[@class="tag"]/text()')
            )
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
            comic_source="JMCOMIC",
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
        """解析漫画详情页面。

        详情页的元信息集中在封面块（#album_photo_cover）之后的兄弟 div 中，
        将作者/标签/作品/登场人物等字段的查询限定在该区块，避免误抓到
        页面下方「猜你喜欢」等推荐区的同名节点。
        """
        doc = etree.HTML(html)
        title_el = doc.xpath('//h1[@id="book-name"]/text()') or doc.xpath("//h1/text()")
        title = title_el[0].strip() if title_el else "未知标题"

        # 定位信息区块：封面块之后的第一个兄弟 div
        info_el = None
        cover_blocks = doc.xpath('//div[@id="album_photo_cover"]')
        if cover_blocks:
            siblings = cover_blocks[-1].xpath("./following-sibling::div")
            if siblings:
                info_el = siblings[0]
        scope = info_el if info_el is not None else doc

        # 从 JavaScript 中提取 scramble_id
        scramble_id = ""
        scramble_match = re.search(r"var scramble_id\s*=\s*(\d+)", html)
        if scramble_match:
            scramble_id = scramble_match.group(1)

        # 解析章节列表（多章节专辑）。参考 ComicGUISpider：取最后一个 episode 块。
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

        # 提取图片 URL（支持 data-src 和 data-original 两种懒加载方式）
        image_urls: list[str] = []
        img_elements = doc.xpath('.//img[contains(@id,"album_photo_")]')
        for img in img_elements:
            img_url = (
                img.xpath("./@data-src")
                or img.xpath("./@data-original")
                or img.xpath("./@src")
            )
            if img_url:
                url = img_url[0]
                if not url.startswith("http"):
                    url = f"https://{domain}{url}"
                if "blank.jpg" in url:
                    continue
                image_urls.append(url)

        # 作者（去重，页面中 author 节点可能因展开/收起重复出现）
        authors = self._clean_texts(
            scope.xpath('.//span[@data-type="author"]/a/text()')
        )
        author = authors[0] if authors else None

        # 标签、作品（原作）、登场人物（角色）
        tags = self._clean_texts(scope.xpath('.//span[@data-type="tags"]/a/text()'))
        works = self._clean_texts(scope.xpath('.//span[@data-type="works"]/a/text()'))
        actors = self._clean_texts(scope.xpath('.//span[@data-type="actor"]/a/text()'))

        # 分类标签合并：作品与登场人物对搜索和展示同样有价值，
        # 合并进 tags 并整体去重，保持「标签 → 作品 → 角色」顺序。
        merged_tags = list(dict.fromkeys([*tags, *works, *actors]))

        # 提取页数（限定在信息区块，避免误读推荐区的数字）
        pages = 0
        pages_text = scope.xpath(
            './/div[contains(text(),"頁數") or contains(text(),"页数")]/text()'
        )
        if pages_text:
            m = re.search(r"\d+", pages_text[0])
            if m:
                pages = int(m.group())

        # 提取发布日期：页面同时有「上架日期」和「更新日期」两个
        # itemprop="datePublished" 节点，优先取上架日期。
        publish_date = None
        for span in scope.xpath('.//span[@itemprop="datePublished"]'):
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
            date_match = re.search(
                r'itemprop="datePublished"\s+content="(\d{4}-\d{2}-\d{2})"', html
            )
            if not date_match:
                date_match = re.search(
                    r"(?:上架日期|上傳日期|上传日期)\s*[:：]\s*(\d{4}-\d{2}-\d{2})",
                    html,
                )
            if date_match:
                publish_date = date_match.group(1)

        # 如果页面上的图片数量少于总页数，使用 URL 模式生成所有图片 URL
        total_pages = max(pages, len(image_urls))
        if len(image_urls) < total_pages and image_urls:
            sample_url = image_urls[0]
            url_match = re.match(
                r"(https://[^/]+)/media/photos/\d+/(\d+)\.(\w+)", sample_url
            )
            if url_match:
                cdn_base = url_match.group(1)
                ext = url_match.group(3)
                image_urls = [
                    f"{cdn_base}/media/photos/{comic_id}/{i:05d}.{ext}"
                    for i in range(1, total_pages + 1)
                ]
                logger.debug(
                    "Generated %d image URLs from pattern (ext=%s)", total_pages, ext
                )
            else:
                logger.warning(
                    "Sample image URL does not match expected pattern: %s", sample_url
                )

        cover_url = ""
        cover_el = doc.xpath('.//div[@id="album_photo_cover"]//img/@src')
        if cover_el:
            cover_url = cover_el[0]
            if not cover_url.startswith("http"):
                cover_url = f"https://{domain}{cover_url}"

        category = works[0] if works else None

        return ComicInfo(
            id=comic_id,
            title=title,
            author=author,
            pages=total_pages,
            tags=merged_tags,
            category=category,
            publish_date=publish_date,
            cover_url=cover_url,
            preview_url=f"https://{domain}/album/{comic_id}",
            media_id=comic_id,
            comic_source="JMCOMIC",
            source_site="jmcomic",
            scramble_id=scramble_id,
            image_urls=image_urls,
            chapters=chapters,
            album_id=comic_id,
            album_total_chapters=len(chapters) if chapters else 1,
        )
