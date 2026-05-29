"""jmcomic 常量定义。"""

DEFAULT_DOMAIN = "18comic.vip"

PUBLISH_URL = "https://jm365.work/mJ8rWd"

# curl_cffi 浏览器指纹模拟标识
# 需要定期更新以匹配当前主流浏览器版本，过旧版本可能被反爬识别
IMPERSONATE_BROWSER = "chrome136"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Sec-Ch-Ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Priority": "u=0, i",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
}

# 排行榜时间周期映射
TIME_MAP = {
    "日": "t",
    "周": "w",
    "月": "m",
    "总": "a",
}

# 排行榜排序方式映射
ORDER_MAP = {
    "更新": "mr",
    "点击": "mv",
    "评分": "tr",
    "评论": "md",
    "收藏": "tf",
}

# 排行榜关键词 → URL 参数映射（16 种组合）
RANKING_MAPPINGS: dict[str, dict[str, str]] = {}
for _time_label, _time_val in TIME_MAP.items():
    for _order_label, _order_val in ORDER_MAP.items():
        RANKING_MAPPINGS[f"{_time_label}{_order_label}"] = {"t": _time_val, "o": _order_val}

# 搜索 URL 模板
SEARCH_URL_TEMPLATE = "https://{domain}/search/photos?main_tag=0&search_query={query}"
RANDOM_URL_TEMPLATE = "https://{domain}/random"
