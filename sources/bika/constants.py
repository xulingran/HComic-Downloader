"""Bika API 常量定义。"""

# API 密钥（从参考项目 haka_comic 提取）
API_KEY = "C69BAF41DA5ABD1FFEDC6D2FEA56B"

# HMAC-SHA256 签名密钥
SECRET_KEY = r"~d}$Q7$eIni=V)9\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn"

# 固定 nonce
NONCE = "4ce7a7aa759b40f794d189a88b84aba8"

# API 端点
API_BASE_URL = "https://picaapi.picacomic.com/"

# 默认请求头
DEFAULT_HEADERS = {
    "accept": "application/vnd.picacomic.com.v1+json",
    "User-Agent": "okhttp/3.8.1",
    "Content-Type": "application/json; charset=UTF-8",
    "api-key": API_KEY,
    "app-build-version": "45",
    "app-platform": "android",
    "app-uuid": "defaultUuid",
    "app-version": "2.2.1.3.3.4",
    "nonce": NONCE,
    "app-channel": "1",
}


# HTTP 方法枚举
class Method:
    GET = "GET"
    POST = "POST"
