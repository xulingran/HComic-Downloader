"""jm 标题补全模块 — 并发获取专辑详情页标题。"""

from __future__ import annotations

import contextlib
import json
import logging
import random
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from lxml import etree

from models import ComicInfo
from utils import apply_system_proxy_to_session

from .constants import HEADERS

logger = logging.getLogger(__name__)


def _create_thread_session():
    """创建线程安全的 HTTP session（curl_cffi 优先，回退到 requests）。"""
    try:
        from curl_cffi import requests as cf_requests

        return cf_requests.Session(impersonate="chrome136")
    except ImportError:
        import requests

        return requests.Session()


def _extract_title_from_doc(doc) -> str:
    """5 策略标题提取：h1 → og:title → twitter:title → page title → 未知标题"""
    title_el = doc.xpath('//h1[@id="book-name"]/text()') or doc.xpath("//h1/text()")
    title_from_h1 = title_el[0].strip() if title_el else ""
    if not title_from_h1:
        og_title = doc.xpath('//meta[@property="og:title"]/@content')
        if og_title and og_title[0].strip():
            title_from_h1 = og_title[0].strip()
    if not title_from_h1:
        twitter_title = doc.xpath('//meta[@name="twitter:title"]/@content')
        if twitter_title and twitter_title[0].strip():
            title_from_h1 = twitter_title[0].strip()
    if not title_from_h1:
        page_title = doc.xpath("//title/text()")
        if page_title and page_title[0].strip():
            raw = page_title[0].strip()
            for sep in (" | ", " - ", " – ", " — "):
                if sep in raw:
                    raw = raw.split(sep, 1)[0].strip()
            if raw and raw.lower() not in (
                "jmcomic",
                "18comic",
                "jmcomic",
                "18comic.vip",
                "jmcomic-zzz.one",
            ):
                title_from_h1 = raw
    return title_from_h1 or "未知标题"


def fill_missing_titles(
    comics: list[ComicInfo],
    domain: str,
    session_cookies: list[tuple[str, str]],
    timeout: int,
) -> None:
    """并发获取专辑详情页标题，补全 HTML 中 JS 懒加载导致的缺失标题。

    JMComic 收藏夹页面中，首屏之外条目的 <div class="image-item-text"/>
    为空（标题由 JS 异步填充），需独立请求各专辑页提取 <h1> 标题。
    每个线程创建独立 session 以保证线程安全。
    """
    missing = [c for c in comics if not c.title or c.title == "未知标题"]
    if not missing:
        return

    logger.info(
        "Fetching titles for %d/%d comics without server-rendered titles",
        len(missing),
        len(comics),
    )

    if not session_cookies:
        logger.warning("No cookies available for title-fetch threads; age-restricted albums may redirect to login")

    def _fetch_title(cid: str) -> tuple[str, str, str]:
        """线程安全：独立 session + 完整 headers 上下文。
        返回 (cid, title, error_reason)。"""
        # 随机延迟避免短时间集中请求触发限流
        time.sleep(random.uniform(0.2, 0.6))
        sess = None
        try:
            url = f"https://{domain}/album/{cid}"
            sess = _create_thread_session()
            # 注入系统代理，与主 session 保持一致。
            # 未注入时依赖代理的用户会在此处 DNS 解析失败或连接超时。
            apply_system_proxy_to_session(sess)
            sess.headers.update(HEADERS)
            sess.headers["Referer"] = f"https://{domain}/"
            for name, value in session_cookies:
                sess.cookies.set(name, value, domain=domain)
            r = sess.get(url, timeout=timeout)
            # 检查是否被重定向到登录页（限制级漫画需要登录）
            if r.url and "/login" in str(r.url):
                return cid, "", "redirected to login (age-restricted?)"
            # 检查是否被重定向到错误页（专辑已下架/不存在）
            if r.url and "/error/" in str(r.url):
                return cid, "", "album error page (missing/removed)"
            r.raise_for_status()
            _fix_encoding(r)
            doc = etree.HTML(r.text)
            title = _extract_title_from_doc(doc)
            if title != "未知标题":
                return cid, title, ""
            # JSON-LD 结构化数据（如 ComicSeries / Book 等 schema）
            for script in doc.xpath('//script[@type="application/ld+json"]/text()'):
                try:
                    data = json.loads(script)
                    if isinstance(data, dict):
                        name = data.get("name", "")
                        if name and name.strip():
                            return cid, name.strip(), ""
                        headline = data.get("headline", "")
                        if headline and headline.strip():
                            return cid, headline.strip(), ""
                    if isinstance(data, list):
                        for item in data:
                            name = item.get("name", "") if isinstance(item, dict) else ""
                            if name and name.strip():
                                return cid, name.strip(), ""
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
            body_snippet = (doc.xpath("//body//text()") or [])[:20]
            logger.warning(
                "_fetch_title: h1/og/title not found for %s (body_sample=%s)",
                cid,
                " ".join(t[:60] for t in body_snippet if t.strip()),
            )
            return cid, "", "title not found in page"
        except Exception as e:
            err_msg = str(e)[:120]
            return cid, "", err_msg
        finally:
            if sess is not None:
                with contextlib.suppress(Exception):
                    sess.close()

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
            elif cid in cid_to_idx:
                failures.append((cid, "title not found"))

    if fetched:
        logger.info("Filled %d missing titles from album detail pages", fetched)
    if failures:
        # 按错误原因分组统计
        reason_counts = Counter(err for _, err in failures)
        reasons = ", ".join(f"{reason}: {cnt}" for reason, cnt in reason_counts.most_common())
        failed_ids = [cid for cid, _ in failures[:5]]
        logger.warning(
            "Failed to fetch %d titles. Reasons: %s. First IDs: %s",
            len(failures),
            reasons,
            failed_ids,
        )


def _fix_encoding(resp) -> None:
    """Fix response encoding if server returns wrong charset."""
    enc = (resp.encoding or "").lower()
    if not enc or enc in ("iso-8859-1", "latin-1"):
        resp.encoding = "utf-8"
