"""Shared base classes for source parsers."""


class ParserResponseError(RuntimeError):
    """响应读取/解析相关异常。"""


class AntiBotChallengeError(ParserResponseError):
    """站点反爬挑战阻断了请求，但不代表用户认证凭证失效。"""

    def __init__(self, message: str, *, challenge_url: str = "") -> None:
        super().__init__(message)
        self._challenge_url = challenge_url

    @property
    def challenge_url(self) -> str:
        """返回触发挑战的内部请求 URL。"""
        return self._challenge_url


class ParserContextMixin:
    """Mixin providing context-manager support (close/__enter__/__exit__).

    Expects the subclass to have a `_session` attribute.
    """

    def close(self):
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
