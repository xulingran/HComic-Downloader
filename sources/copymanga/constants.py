"""拷贝漫画 (CopyManga) 常量定义。"""

PC_DOMAIN = "www.2026copy.com"
API_DOMAIN = "api.2026copy.com"

# 漫画预览页 URL 模板
PREVIEW_URL_TEMPLATE = f"https://{PC_DOMAIN}/comic/{{path_word}}"

# 搜索 API
SEARCH_URL_TEMPLATE = (
    f"https://{API_DOMAIN}/api/v3/search/comic"
    f"?platform=1&limit=30&offset={{offset}}&q_type=&_update=false&q={{keyword}}"
)

# 章节详情 API（path_word 占位）
CHAPTERS_URL_TEMPLATE = f"https://{PC_DOMAIN}/comicdetail/{{path_word}}/chapters"

# 章节 HTML 页（用于提取图片 URL）
CHAPTER_PAGE_URL_TEMPLATE = f"https://{PC_DOMAIN}/comic/{{path_word}}/chapter/{{chapter_id}}"

# AES 密钥提取页面（固定访问一拳超人）
AES_KEY_PAGE_URL = f"https://{PC_DOMAIN}/comic/yiquanchaoren"

# 每页条目数
PAGE_SIZE = 30

# PC 端页面请求 headers
PC_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0"),
    "Accept": ("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
}

# 移动端 API 请求 headers
API_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 "
        "Mobile/15E148 Safari/604.1"
    ),
    "Accept": "application/json",
    "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
    "Origin": f"https://{PC_DOMAIN}",
    "Connection": "keep-alive",
    "Accept-Encoding": "gzip, compress, br",
    "platform": "1",
    "version": "2026.02.02",
    "webp": "1",
    "region": "0",
}
