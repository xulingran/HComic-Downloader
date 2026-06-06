"""curl 认证信息提取模块"""

import re
import shlex


def _normalize_curl_text(curl_text: str) -> str:
    """规范化 curl 文本，处理反斜杠换行续行。"""
    text = (curl_text or "").strip()
    text = text.replace("\\\r\n", " ").replace("\\\n", " ")
    return text


def _split_header(header_value: str) -> tuple[str, str]:
    """拆分 header 行为 (name, value)。"""
    if ":" not in header_value:
        return header_value.strip(), ""
    name, value = header_value.split(":", 1)
    return name.strip(), value.strip()


def extract_auth_from_curl(curl_text: str) -> tuple[str, str, str, str]:
    """从 curl 命令中提取 Cookie、User-Agent、Bearer Token 和域名。

    支持:
    - `-b '...'` / `--cookie '...'`
    - `-H 'Cookie: ...'`
    - `-H 'User-Agent: ...'`
    - `-A '...'` / `--user-agent '...'`
    - `-H 'Authorization: Bearer ...'`
    - 从 URL 中提取域名
    """
    text = _normalize_curl_text(curl_text)
    if not text:
        raise ValueError("curl 内容为空，请粘贴完整请求")

    try:
        tokens = shlex.split(text, posix=True)
    except ValueError as e:
        raise ValueError(f"curl 解析失败: {e}") from e

    cookie = ""
    user_agent = ""
    bearer_token = ""
    domain = ""
    i = 0
    total = len(tokens)

    while i < total:
        token = tokens[i]

        # 提取 URL 中的域名
        if not domain and token.startswith("http"):
            match = re.search(r"https?://([^/]+)", token)
            if match:
                domain = match.group(1)

        if token in ("-b", "--cookie"):
            if i + 1 < total:
                cookie = tokens[i + 1].strip()
                i += 2
                continue
        elif token.startswith("--cookie="):
            cookie = token.split("=", 1)[1].strip()
        elif token in ("-A", "--user-agent"):
            if i + 1 < total:
                user_agent = tokens[i + 1].strip()
                i += 2
                continue
        elif token.startswith("--user-agent="):
            user_agent = token.split("=", 1)[1].strip()
        elif token in ("-H", "--header"):
            if i + 1 < total:
                header_name, header_val = _split_header(tokens[i + 1])
                if header_name.lower() == "cookie":
                    cookie = header_val
                elif header_name.lower() == "user-agent":
                    user_agent = header_val
                elif header_name.lower() == "authorization" and header_val.lower().startswith("bearer "):
                    bearer_token = header_val[7:].strip()
                i += 2
                continue
        elif token.startswith("--header="):
            header_name, header_val = _split_header(token.split("=", 1)[1])
            if header_name.lower() == "cookie":
                cookie = header_val
            elif header_name.lower() == "user-agent":
                user_agent = header_val
            elif header_name.lower() == "authorization" and header_val.lower().startswith("bearer "):
                bearer_token = header_val[7:].strip()

        i += 1

    # 从 Cookie 中自动提取 auth0_token 作为 Bearer token
    if not bearer_token and cookie:
        bearer_token = _extract_auth0_token(cookie)

    missing = []
    if not cookie:
        missing.append("Cookie")
    if not user_agent:
        missing.append("User-Agent")
    if missing:
        raise ValueError(f"curl 中缺少: {', '.join(missing)}")

    return cookie, user_agent, bearer_token, domain


def _extract_auth0_token(cookie: str) -> str:
    """从 Cookie 字符串中提取 auth0_token 值。"""
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith("auth0_token="):
            return part[len("auth0_token=") :].strip()
    return ""
