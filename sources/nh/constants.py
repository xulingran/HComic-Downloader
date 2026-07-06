"""NH 常量定义。"""

# 域名
DOMAIN = "nhentai.net"

# API 端点
API_INDEX = f"https://{DOMAIN}/api/v2"
SEARCH_URL = f"{API_INDEX}/search"
GALLERY_URL_TEMPLATE = f"{API_INDEX}/galleries/{{gallery_id}}"
GALLERIES_URL = f"{API_INDEX}/galleries"  # 首页/最新漫画列表
TAGS_URL = f"{API_INDEX}/tags/tag"  # 标签目录 API
USER_URL = f"{API_INDEX}/user"
FAVORITES_URL = f"{API_INDEX}/favorites"
FAVORITE_URL_TEMPLATE = f"{API_INDEX}/galleries/{{gallery_id}}/favorite"

# 排序方式
SORT_POPULAR = "popular"  # 全站热度排序
SORT_POPULAR_TODAY = "popular-today"  # 今日热门（默认热门入口）
SORT_POPULAR_WEEK = "popular-week"  # 本周热门
SORT_POPULAR_MONTH = "popular-month"  # 本月热门
SORT_DATE = ""  # 按日期排序（最近更新，默认）

# 图片和缩略图 CDN
IMAGE_HOST = "https://i.nhentai.net"
THUMBNAIL_HOST = "https://t.nhentai.net"

# 图片 URL 模板
IMAGE_URL_TEMPLATE = f"{IMAGE_HOST}/galleries/{{media_id}}/{{page_number}}.{{ext}}"
THUMBNAIL_URL_TEMPLATE = f"{THUMBNAIL_HOST}/galleries/{{media_id}}/thumb.{{ext}}"

# 浏览器页面 URL
GALLERY_PAGE_URL = f"https://{DOMAIN}/g/{{gallery_id}}"

# 请求 headers
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8,zh-HK;q=0.7,en-US;q=0.6,en;q=0.5",
    "Referer": f"https://{DOMAIN}/",
}

IMAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
    "Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
    "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8,zh-HK;q=0.7,en-US;q=0.6,en;q=0.5",
    "Referer": f"https://{DOMAIN}/",
}
