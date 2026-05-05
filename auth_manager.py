"""登录和认证管理模块。"""

from __future__ import annotations

import logging
import threading
import webbrowser
from typing import Any, Callable, Optional, Protocol

import tkinter as tk
from tkinter import ttk, messagebox

from auth_parser import extract_auth_from_curl
from config import Config

logger = logging.getLogger(__name__)


class ParserAuthLike(Protocol):
    """解析器认证协议（最小接口）。"""

    current_source: str

    def configure_auth(self, cookie: str = "", user_agent: str = "", source: Optional[str] = None) -> None:
        ...

    def verify_login_status(self) -> tuple[bool, str]:
        ...


class DownloaderAuthLike(Protocol):
    """下载器认证协议（最小接口）。"""

    def configure_auth(self, cookie: str = "", user_agent: str = "") -> None:
        ...


class LoginExpiredDialog(tk.Toplevel):
    """登录失效提示对话框，提供跳转到网站登录的按钮和操作指引。"""

    def __init__(self, parent: tk.Tk):
        super().__init__(parent)
        self.title("登录信息已过期")
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()

        self._build_ui()
        self._center_on_parent(parent)

    def _build_ui(self):
        main_frame = ttk.Frame(self, padding=20)
        main_frame.pack(fill=tk.BOTH, expand=True)

        ttk.Label(main_frame, text="登录信息已过期", font=("", 14, "bold")).pack(anchor=tk.W)
        ttk.Label(main_frame, text="Cookie 已失效，需要重新登录网站并获取新的登录信息。").pack(anchor=tk.W, pady=(10, 0))

        steps_frame = ttk.LabelFrame(main_frame, text="操作步骤", padding=10)
        steps_frame.pack(fill=tk.X, pady=(15, 0))

        steps = [
            "1. 点击下方按钮打开 h-comic.com",
            "2. 在网站上登录你的账号",
            "3. 登录后，按 F12 打开开发者工具",
            "4. 在 Network 标签页找到任意请求，右键复制 cURL 命令",
            "5. 回到本程序，粘贴到设置面板的\"登录 curl\"输入框",
            "6. 点击\"应用登录信息\"按钮",
        ]
        for step in steps:
            ttk.Label(steps_frame, text=step).pack(anchor=tk.W, pady=1)

        btn_frame = ttk.Frame(main_frame)
        btn_frame.pack(fill=tk.X, pady=(20, 0))

        ttk.Button(btn_frame, text="打开网站登录", command=self._open_website).pack(side=tk.LEFT)
        ttk.Button(btn_frame, text="关闭", command=self.destroy).pack(side=tk.RIGHT)

    def _open_website(self):
        webbrowser.open("https://h-comic.com")

    def _center_on_parent(self, parent):
        self.update_idletasks()
        parent_x = parent.winfo_x()
        parent_y = parent.winfo_y()
        parent_w = parent.winfo_width()
        parent_h = parent.winfo_height()
        w = self.winfo_width()
        h = self.winfo_height()
        x = parent_x + (parent_w - w) // 2
        y = parent_y + (parent_h - h) // 2
        self.geometry(f"+{x}+{y}")


class AuthManager:
    """登录和认证管理器。"""

    def __init__(
        self,
        root: tk.Tk,
        config: Config,
        parser: ParserAuthLike,
        downloader: DownloaderAuthLike,
        login_status_var: tk.StringVar,
        go_login_btn: ttk.Button,
        on_status_update: Callable[[str], None],
    ):
        self._root = root
        self._config = config
        self._parser = parser
        self._downloader = downloader
        self._login_status_var = login_status_var
        self._go_login_btn = go_login_btn
        self._on_status_update = on_status_update

    def get_current_source(self) -> str:
        """获取当前来源。"""
        if hasattr(self._root, "source_var") and hasattr(self._root, "source_label_to_key"):
            selected = self._root.source_label_to_key.get(self._root.source_var.get())
            if selected:
                return selected
        return self._parser.current_source

    def source_requires_login(self, source: Optional[str] = None) -> bool:
        """检查来源是否需要登录。"""
        current = source or self.get_current_source()
        return current == "hcomic"

    def sync_auth_for_source(self, source: str):
        """为指定来源同步认证信息。"""
        auth = self._config.get_source_auth(source)
        self._parser.configure_auth(
            cookie=auth.get("cookie", ""),
            user_agent=auth.get("user_agent", ""),
            source=source,
        )
        if source == self.get_current_source():
            self._downloader.configure_auth(
                cookie=auth.get("cookie", ""),
                user_agent=auth.get("user_agent", ""),
            )

    def update_login_status(self, auto_verify: bool = False):
        """更新登录状态显示。"""
        source = self.get_current_source()
        if not self.source_requires_login(source):
            self._login_status_var.set("当前来源无需登录信息")
            self._go_login_btn.config(state=tk.DISABLED)
            return

        auth = self._config.get_source_auth(source)
        if auth.get("cookie") and auth.get("user_agent"):
            self._login_status_var.set("已加载登录配置（待校验）")
            self._go_login_btn.config(state=tk.DISABLED)
            if auto_verify:
                self.verify_login_async()
        else:
            self._login_status_var.set("未配置登录信息")
            self._go_login_btn.config(state=tk.NORMAL)

    def apply_login_from_curl(self, curl_text_widget: tk.Text):
        """从 curl 命令应用登录信息。"""
        curl_text = curl_text_widget.get("1.0", tk.END).strip()
        if not curl_text:
            messagebox.showwarning("提示", "请先粘贴 curl 命令")
            return

        try:
            cookie, user_agent = extract_auth_from_curl(curl_text)
        except Exception as e:
            messagebox.showerror("解析失败", f"无法解析 curl 命令: {e}")
            return

        if not cookie:
            messagebox.showwarning("解析结果", "未找到有效的 Cookie 信息")
            return

        # 保存到当前来源配置
        source = self.get_current_source()
        self._config.set_source_auth(source, cookie=cookie, user_agent=user_agent)

        # 立即应用
        self.sync_auth_for_source(source)
        self.update_login_status()
        self._on_status_update(f"已更新 {source} 的登录信息")

        # 异步验证
        self.verify_login_async()

    def verify_login_async(self):
        """异步验证登录状态。"""
        source = self.get_current_source()
        auth = self._config.get_source_auth(source)

        if not auth.get("cookie"):
            self._login_status_var.set("未配置登录信息")
            return

        self._login_status_var.set("正在验证登录状态...")

        def do_verify():
            try:
                is_valid, _msg = self._parser.verify_login_status()
                self._root.after(0, lambda: self._on_verify_complete(is_valid, source))
            except Exception as e:
                logger.error(f"登录验证失败: {e}")
                self._root.after(0, lambda: self._login_status_var.set("验证失败"))

        threading.Thread(target=do_verify, daemon=True).start()

    def _on_verify_complete(self, is_valid: bool, source: str):
        """验证完成回调。"""
        if is_valid:
            self._login_status_var.set("登录有效")
            self._on_status_update(f"{source} 登录验证通过")
        else:
            self._login_status_var.set("登录已失效")
            self._go_login_btn.config(state=tk.NORMAL)
            self._show_login_expired_dialog()

    def _show_login_expired_dialog(self):
        """显示登录失效对话框。"""
        LoginExpiredDialog(self._root)
