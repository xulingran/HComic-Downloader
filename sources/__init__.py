"""漫画来源子系统。"""

from __future__ import annotations

import importlib
import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from models import AuthConfig, ComicInfo, PaginationInfo
from utils import normalize_source_auth

if TYPE_CHECKING:
    # Parser classes are imported lazily at first use via importlib (see
    # _PARSER_MODULES); these imports exist only for static type checking.
    from sources.bika.parser import BikaParser
    from sources.copymanga.parser import CopyMangaParser
    from sources.hcomic.parser import HComicParser, ParserResponseError
    from sources.jm.parser import JmParser
    from sources.moeimg.parser import MoeImgParser
    from sources.nh.parser import NhParser

logger = logging.getLogger(__name__)

_VALID_SOURCES = ("hcomic", "jm", "moeimg", "bika", "copymanga", "nh")
_SOURCES_WITH_FAVOURITES = ("hcomic", "jm", "moeimg", "bika", "nh")

# Map source name -> (module path, class name). Loaded lazily by _load_parser_class
# so that ``import sources`` does not drag in every parser module (and their
# heavy deps: requests/urllib3, PIL, lxml). Only the actually-requested source's
# module is imported, on first access.
_PARSER_MODULES: dict[str, tuple[str, str]] = {
    "hcomic": ("sources.hcomic.parser", "HComicParser"),
    "jm": ("sources.jm.parser", "JmParser"),
    "moeimg": ("sources.moeimg.parser", "MoeImgParser"),
    "bika": ("sources.bika.parser", "BikaParser"),
    "copymanga": ("sources.copymanga.parser", "CopyMangaParser"),
    "nh": ("sources.nh.parser", "NhParser"),
}

# Cache of already-imported parser classes: source name -> class object.
_PARSER_CLASSES: dict[str, type] = {}
# 守卫 _PARSER_CLASSES 与解析器实例的懒创建。IPC server 用 8-worker
# ThreadPoolExecutor 并发跑通用请求处理器（search/favourites/...），它们都会
# 调 _get_parser —— 不加锁时并发线程会各自跑一次工厂，重复构造 Session+代理，
# 浪费资源且非确定性决定哪个实例被复用。
_PARSER_INIT_LOCK = threading.Lock()


def _load_parser_class(source: str) -> type:
    """Import (once) and return the parser class for *source*.

    Uses importlib so that modules are pulled in on demand rather than at
    ``import sources`` time. Results are cached in ``_PARSER_CLASSES``.

    加锁守卫 check-then-act：importlib 自带导入锁可防真正重复导入，但两个
    线程仍可能同时通过 ``cls is None`` 判断，各自 getattr 后以 last-writer-wins
    覆盖缓存。锁确保只构造一次缓存条目。
    """
    cls = _PARSER_CLASSES.get(source)
    if cls is None:
        with _PARSER_INIT_LOCK:
            cls = _PARSER_CLASSES.get(source)
            if cls is None:
                module_path, class_name = _PARSER_MODULES[source]
                module = importlib.import_module(module_path)
                cls = getattr(module, class_name)
                _PARSER_CLASSES[source] = cls
    return cls


# Re-export ParserResponseError for backward compatibility (``from sources
# import ParserResponseError``). Lazy: import on first attribute access from
# the lightweight sources.base (where the class is defined) rather than a
# parser module, so accessing it does NOT drag in requests/lxml/PIL.
def __getattr__(name: str) -> Any:
    if name == "ParserResponseError":
        from sources.base import ParserResponseError as _Err

        return _Err
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["MultiSourceParser", "ParserResponseError"]


class _ParserDict:
    """字典代理：通过 __getitem__ 触发懒创建解析器。

    保持 ``parser.parsers["source"]`` 向后兼容。
    """

    def __init__(self, owner: MultiSourceParser):
        self._owner = owner

    def __getitem__(self, key: str) -> HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser:
        return self._owner._get_parser(key)  # type: ignore[return-value]

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self.__getitem__(key)
        except (KeyError, ValueError):
            return default

    def keys(self) -> set[str]:
        return set(self._owner._factory.keys())

    def __contains__(self, key: str) -> bool:
        return key in self._owner._factory

    def __iter__(self):
        return iter(self._owner._factory)

    def __len__(self) -> int:
        return len(self._owner._factory)


class MultiSourceParser:
    """多来源解析器分发层。

    解析器实例按需懒创建 —— 首次访问指定 source 时构造，避免启动时预创建全部 5 个解析器。
    """

    def __init__(
        self,
        timeout: int = 30,
        default_source: str = "hcomic",
        source_auth: dict[str, dict[str, str]] | None = None,
        auth: AuthConfig | None = None,
        bika_image_quality: str = "original",
        jm_domain: str = "",
    ):
        self.timeout = timeout
        self.source_auth: dict[str, dict[str, str]] = self._normalize_source_auth(source_auth)
        # 兼容旧调用：若传了全局 auth，作为 hcomic 默认认证。
        _cookie = auth.cookie if auth else ""
        _user_agent = auth.user_agent if auth else ""
        if _cookie or _user_agent:
            self.source_auth["hcomic"] = {
                "cookie": (_cookie or "").strip(),
                "user_agent": (_user_agent or "").strip(),
                "bearer_token": self.source_auth["hcomic"].get("bearer_token", ""),
            }

        self._bika_image_quality = bika_image_quality
        self._jm_custom_domain = (jm_domain or "").strip()
        # JM 会话级内存凭据（jm-session-cookie spec）：与持久化 source_auth 彻底分离。
        # 启动时为空（匿名）；运行期 configure_auth(source="jm") 写入；进程退出即失效。
        # factory lambda 读此字段注入 JmParser，使运行期登录在懒创建时生效；
        # 持久化 source_auth["jm"] 的存量残留永不被 factory/post_init 读取。
        self._jm_session_auth: dict[str, str] = {"cookie": "", "user_agent": ""}

        # 工厂函数映射：解析器首次访问时调用对应工厂创建实例。
        # 工厂内部通过 _load_parser_class 按需 import 解析器模块，避免
        # ``import sources`` 时强制加载全部 5 个来源及其重依赖。
        self._factory: dict[
            str, Callable[[], HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser | NhParser]
        ] = {
            "hcomic": lambda: _load_parser_class("hcomic")(
                timeout=timeout,
                cookie=self.source_auth["hcomic"]["cookie"],
                user_agent=self.source_auth["hcomic"]["user_agent"],
                bearer_token=self.source_auth["hcomic"]["bearer_token"],
            ),
            "moeimg": lambda: _load_parser_class("moeimg")(
                timeout=timeout,
                cookie=self.source_auth["moeimg"]["cookie"],
                user_agent=self.source_auth["moeimg"]["user_agent"],
            ),
            # JM 会话凭据读运行期内存通道（_jm_session_auth），不读持久化 source_auth（jm-session-cookie spec）：
            # 启动时为空 → 匿名创建；运行期 configure_auth 写入 → 懒创建时注入生效。
            # jm_domain 配置在 _apply_post_init 中独立恢复，与认证态正交。
            "jm": lambda: _load_parser_class("jm")(
                timeout=timeout,
                cookie=self._jm_session_auth["cookie"],
                user_agent=self._jm_session_auth["user_agent"],
            ),
            "bika": lambda: _load_parser_class("bika")(timeout=timeout),
            "copymanga": lambda: _load_parser_class("copymanga")(timeout=timeout),
            # NH 仅恢复 API Key（remove-nh-password-login spec）：cookie/user_agent
            # 不再作为 NH 认证凭据，仅传 bearer_token。
            "nh": lambda: _load_parser_class("nh")(
                timeout=timeout,
                bearer_token=self.source_auth["nh"]["bearer_token"],
            ),
        }

        # 缓存字典 —— 已创建的解析器实例
        self._parsers: dict[str, HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser | NhParser] = {}
        # 守卫 _parsers 的懒创建（见 _get_parser 的 double-checked locking）。
        # 与模块级 _PARSER_INIT_LOCK 分离：模块级锁守卫类导入，实例锁守卫实例创建，
        # 避免不同 MultiSourceParser 实例（如测试）互相阻塞。
        self._parser_lock = threading.Lock()

        # 只创建 default_source 的解析器，其余等待首次访问时创建
        self.current_source = default_source if default_source in self._factory else "hcomic"
        self._get_parser(self.current_source)

    @property
    def parsers(self) -> _ParserDict:
        """向后兼容：``parser.parsers["source"]`` 触发懒创建。"""
        return _ParserDict(self)

    def _get_parser(
        self, name: str
    ) -> HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser | NhParser:
        """按需获取（或创建）指定来源的解析器实例。"""
        # 并发安全：IPC server 用 8-worker 线程池并发跑请求处理器，多个线程可能
        # 同时首次访问同一 source。用 double-checked locking 守卫懒创建 ——
        # 已有实例时无锁快路径返回，仅首次创建时持锁，确保每个 source 只构造一次
        # 解析器（含其 requests.Session + 代理注入）。
        parser = self._parsers.get(name)
        if parser is not None:
            return parser
        with self._parser_lock:
            parser = self._parsers.get(name)
            if parser is not None:
                return parser
            factory = self._factory.get(name)
            if factory is None:
                raise ValueError(f"Unknown source: {name}")
            parser = factory()
            self._parsers[name] = parser
            # 创建后执行凭据恢复等后处理（仍在锁内，确保只对胜出的实例应用一次）
            self._apply_post_init(name, parser)
        return parser

    def _apply_post_init(
        self,
        name: str,
        parser: HComicParser | MoeImgParser | JmParser | BikaParser | CopyMangaParser | NhParser,
    ) -> None:
        """解析器创建后的后处理 —— 恢复存储的凭据、token、图片质量等。"""
        # JM 会话凭据不持久化、不恢复持久化 source_auth（jm-session-cookie spec）。
        # factory 已从 _jm_session_auth 把 cookie/UA 注入构造参数；此处必须用**完整三元组**
        # 调 configure_auth 补 bearer_token（JmParser.__init__ 不接受 bearer_token）。
        # 禁止只传 bearer_token —— JmParser.configure_auth 的 cookie/UA 默认空串会覆盖
        # factory 刚注入的值，导致实例只剩 Authorization 而 cookie/UA 被清空。
        # configure_session_auth 是幂等覆盖写，重设 cookie/UA 无副作用。
        if name == "jm":
            session_auth = self._jm_session_auth
            parser.configure_auth(
                cookie=session_auth["cookie"],
                user_agent=session_auth["user_agent"],
                bearer_token=session_auth.get("bearer_token", ""),
            )
            if self._jm_custom_domain and hasattr(parser, "set_custom_domain"):
                parser.set_custom_domain(self._jm_custom_domain)
            return
        # 通用：对非 JM 解析器恢复已存储的 cookie/user_agent/bearer_token
        auth = self.source_auth.get(name, {})
        cookie = auth.get("cookie", "")
        user_agent = auth.get("user_agent", "")
        bearer_token = auth.get("bearer_token", "")
        if cookie or user_agent or bearer_token:
            parser.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)
        # 为 moeimg 恢复存储的用户名密码（用于懒登录）
        # 注：name 即来源标识，factory 保证 name 与 parser 类型一一对应，
        # 故无需 isinstance 运行时检查（也避免了强制导入 parser 类）。
        if name == "moeimg":
            moeimg_auth = self.source_auth.get("moeimg", {})
            parser.set_stored_credentials(
                moeimg_auth.get("username", ""),
                moeimg_auth.get("password", ""),
            )
        # 为 bika 恢复存储的用户名密码和图片质量（configure_auth 已由通用逻辑执行）
        elif name == "bika":
            bika_auth = self.source_auth.get("bika", {})
            parser.set_stored_credentials(
                bika_auth.get("username", ""),
                bika_auth.get("password", ""),
            )
            parser.set_image_quality(self._bika_image_quality)
        # 为 hcomic 恢复存储的用户名密码（用于懒登录）
        elif name == "hcomic":
            hcomic_auth = self.source_auth.get("hcomic", {})
            parser.set_stored_credentials(
                hcomic_auth.get("username", ""),
                hcomic_auth.get("password", ""),
            )
        # NH 仅恢复 API Key（remove-nh-password-login spec）：factory 已通过
        # bearer_token 注入 API Key；此处不恢复 username/password/cookie/user_agent。

    @staticmethod
    def _normalize_source_auth(source_auth: dict | None) -> dict[str, dict[str, str]]:
        return normalize_source_auth(source_auth)

    def _resolve_source(self, source: str | None = None) -> str:
        """Resolve effective source: explicit argument or current default."""
        return source or self.current_source

    @property
    def session(self) -> Any:
        return self._get_parser(self.current_source).session

    def get_sessions(self) -> list[Any]:
        return [p.session for p in self._parsers.values()]

    def get_jm_cdn_domain(self) -> str | None:
        """返回 jm 当前解析到的 CDN 域名。"""
        jm_parser = self._parsers.get("jm")
        if jm_parser and hasattr(jm_parser, "cdn_domain"):
            return jm_parser.cdn_domain  # type: ignore[union-attr]
        return None

    def set_jm_domain(self, domain: str) -> None:
        """设置 jm 自定义域名。传空字符串则恢复自动选择。"""
        self._jm_custom_domain = (domain or "").strip()
        jm = self._parsers.get("jm")
        if jm and hasattr(jm, "set_custom_domain"):
            jm.set_custom_domain(self._jm_custom_domain)  # type: ignore[union-attr]

    def set_source(self, source: str):
        if source in self._factory:
            self.current_source = source
        # 确保当前 source 的解析器已创建
        self._get_parser(source)

    def source_supports_favourites(self, source: str | None = None) -> bool:
        current = self._resolve_source(source)
        return current in _SOURCES_WITH_FAVOURITES

    def get_auth(self, source: str | None = None) -> tuple[str, str]:
        current = self._resolve_source(source)
        auth = self.source_auth.get(current, {"cookie": "", "user_agent": ""})
        return auth.get("cookie", ""), auth.get("user_agent", "")

    def get_runtime_auth(self, source: str | None = None) -> tuple[str, str]:
        """返回来源的**运行期**有效凭据（jm-session-cookie spec）。

        用于鉴权判定（"现在能否发起已认证请求"）：JM 走会话级 _jm_session_auth，
        其他来源走 source_auth（其持久化即运行期）。区别于 get_auth（读持久化
        source_auth，用于 settings 回显等非鉴权场景）——JM 在 get_auth 返回空
        （匿名），在 get_runtime_auth 返回运行期登录值。
        """
        current = self._resolve_source(source)
        if current == "jm":
            return self._jm_session_auth["cookie"], self._jm_session_auth["user_agent"]
        auth = self.source_auth.get(current, {})
        return auth.get("cookie", ""), auth.get("user_agent", "")

    def configure_auth(
        self,
        cookie: str = "",
        user_agent: str = "",
        bearer_token: str = "",
        source: str | None = None,
    ):
        current = self._resolve_source(source)
        if current not in self._factory:
            return
        cookie = (cookie or "").strip()
        user_agent = (user_agent or "").strip()
        bearer_token = (bearer_token or "").strip()
        # JM 会话凭据走独立内存通道（jm-session-cookie spec）：不写持久化 source_auth，
        # 不触发 config.save；factory 懒创建时读 _jm_session_auth 注入 parser。
        # 并发安全：状态更新 + 实例查询 + 即时注入必须与 _get_parser 的创建临界区互斥，
        # 否则 configure_auth 可能在 _get_parser 持锁创建（已读旧空凭据、未写 _parsers）
        # 期间读到 _parsers=None 而 return，导致运行期状态非空但真实 parser 无凭据。
        if current == "jm":
            with self._parser_lock:
                self._jm_session_auth = {"cookie": cookie, "user_agent": user_agent, "bearer_token": bearer_token}
                parser = self._parsers.get(current)
                if parser is not None:
                    parser.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)
            return
        self.source_auth[current] = {
            "cookie": cookie,
            "user_agent": user_agent,
            "bearer_token": bearer_token,
        }
        # 如果解析器已创建，即时应用；否则待懒创建时使用最新认证参数
        parser = self._parsers.get(current)
        if parser is not None:
            parser.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)

    def verify_login_status(self, source: str | None = None) -> tuple[bool, str]:
        src = self._resolve_source(source)
        return self._get_parser(src).verify_login_status()

    def search(
        self, keyword: str, page: int = 1, source: str | None = None, *, tag: str = ""
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = self._resolve_source(source)
        return self._get_parser(src).search(keyword, page=page, tag=tag)

    def jm_home(self) -> list[tuple[str, list[ComicInfo]]]:
        """返回 JM 首页的分组漫画栏目，复用唯一的懒创建 parser 实例。"""
        return self._get_parser("jm").home()  # type: ignore[union-attr]

    def random(self, source: str | None = None) -> tuple[list[ComicInfo], PaginationInfo | None]:
        src = self._resolve_source(source)
        if src == "bika":
            comics = self._get_parser("bika").get_random_comics()
            return comics, None
        if src not in ("hcomic", "jm"):
            raise ValueError(f"Random is not supported for source: {src}")
        return self._get_parser(src).random()  # type: ignore[union-attr]

    def favourites(
        self, page: int = 1, raise_errors: bool = False, source: str | None = None
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        src = self._resolve_source(source)
        if not self.source_supports_favourites(src):
            return [], None, False
        return self._get_parser(src).favourites(page=page, raise_errors=raise_errors)

    def parse_jm_favourites_snapshot(
        self,
        html: str,
        source_url: str,
        page: int = 1,
    ) -> tuple[list[ComicInfo], PaginationInfo | None, bool]:
        """解析 Electron 捕获的 JM 收藏夹 DOM 快照。"""
        parser = self._get_parser("jm")
        return parser.parse_favourites_snapshot(html=html, source_url=source_url, page=page)  # type: ignore[union-attr]

    def parse_jm_search_snapshot(
        self,
        html: str,
        source_url: str,
        *,
        query: str = "",
        page: int = 1,
    ) -> tuple[list[ComicInfo], PaginationInfo | None]:
        """解析 Electron 捕获的 JM 搜索结果页 DOM 快照。"""
        parser = self._get_parser("jm")
        return parser.parse_search_snapshot(html=html, source_url=source_url, query=query, page=page)  # type: ignore[union-attr]

    def parse_jm_home_snapshot(
        self,
        html: str,
        source_url: str,
    ) -> list[tuple[str, list[ComicInfo]]]:
        """解析 Electron 捕获的 JM 首页 DOM 快照。"""
        parser = self._get_parser("jm")
        return parser.parse_home_snapshot(html=html, source_url=source_url)  # type: ignore[union-attr]

    def add_to_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self._get_parser(src).add_to_favourites(comic_id)

    def check_favourite(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self._get_parser(src).check_favourite(comic_id)

    def remove_from_favourites(self, comic_id: str, source: str | None = None) -> bool:
        src = self._resolve_source(source)
        if src not in _SOURCES_WITH_FAVOURITES:
            return False
        return self._get_parser(src).remove_from_favourites(comic_id)

    def get_comic_detail(
        self, comic_id: str, slug: str = "", source: str | None = None, source_url: str = ""
    ) -> ComicInfo | None:
        src = self._resolve_source(source)
        parser = self._get_parser(src)
        if src == "hcomic":
            return parser.get_comic_detail(comic_id, slug=slug, source_url=source_url)
        return parser.get_comic_detail(comic_id, slug=slug)

    def prepare_for_download(self, comic: ComicInfo) -> ComicInfo:
        source = (comic.source_site or self.current_source or "hcomic").lower()
        # 未知来源（如脏数据/历史记录字段异常）静默降级，保持原有行为
        if source not in self._factory:
            return comic
        parser = self._get_parser(source)

        # 对已有下载地址且页数有效的条目，不再重复请求详情。
        if comic.image_urls and comic.pages > 0:
            return comic

        # hcomic 默认搜索结果已足够下载，仅在关键字段缺失时补详情。
        if source == "hcomic":
            if comic.media_id and comic.pages > 0:
                return comic
            detail = parser.get_comic_detail(comic.id)
            return detail or comic

        # moeimg 和 jm 需要通过详情接口补齐图片地址。
        # bika 也需要通过详情接口补齐章节和图片地址。
        if source == "bika":
            detail = parser.get_comic_detail(comic.id)
            if detail is None:
                return comic
            if detail.chapters and len(detail.chapters) > 1:
                # 多章节 = 专辑，不需要单章图片 URL；
                # 清空后直接返回，跳过下方 get_chapter_images 单章逻辑。
                detail.image_urls = []
                detail.pages = 0
                # epsCount 可能不准确，以实际章节数为准
                if detail.album_total_chapters != len(detail.chapters):
                    detail.album_total_chapters = len(detail.chapters)
                # 保留原始专辑元数据（prepare_comic 可能被章节任务调用）
                if not detail.album_title and comic.album_title:
                    detail.album_title = comic.album_title
                if not detail.album_id and comic.album_id:
                    detail.album_id = comic.album_id
                return detail
            order = detail.chapters[0].index if detail.chapters else 1
            with parser._with_quality("original"):
                detail.image_urls = parser.get_chapter_images(comic.id, order)  # type: ignore[union-attr]
            detail.pages = len(detail.image_urls)
            return detail
        if source == "copymanga":
            detail = parser.get_comic_detail(comic.id)
            if detail is None:
                return comic
            chapters = getattr(detail, "chapters", None) or []
            if len(chapters) > 1:
                return detail
            chapter_id = chapters[0].id if chapters else ""
            if chapter_id:
                detail.image_urls = parser.get_chapter_images(comic.id, chapter_id)  # type: ignore[union-attr]
                detail.pages = len(detail.image_urls)
            return detail
        detail = parser.get_comic_detail(comic.id)
        return detail or comic
