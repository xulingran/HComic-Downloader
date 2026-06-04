"""Shared base classes for source parsers."""


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
