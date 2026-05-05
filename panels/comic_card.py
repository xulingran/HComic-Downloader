"""漫画卡片组件与纯渲染工具。"""

from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from tkinter import font as tkfont
from tkinter import ttk
from typing import Any, Callable, List, Optional, Protocol, cast

from models import ComicInfo


class CardEventHandler(Protocol):
    """卡片事件处理器协议。"""

    def on_card_click(self, event: tk.Event, comic: ComicInfo, frame: tk.Frame) -> None:
        """卡片点击事件。"""
        ...

    def on_download_click(self, comic: ComicInfo) -> None:
        """下载按钮点击事件。"""
        ...

    def on_schedule_cover_load(self, url: str, label: ttk.Label, card_width: int) -> None:
        """调度封面加载。"""
        ...

    def on_render_title(self, title_widget: tk.Text, comic: ComicInfo, card_width: int) -> None:
        """渲染标题。"""
        ...

    def on_copy_selected_text(self, event: tk.Event) -> None:
        """复制选中文本。"""
        ...

    def on_title_click_press(self, event: tk.Event) -> None:
        """标题点击按下事件。"""
        ...

    def on_title_drag(self, event: tk.Event) -> None:
        """标题拖拽事件。"""
        ...

    def on_title_click_release(self, event: tk.Event, comic: ComicInfo, title_widget: tk.Text, card_width: int) -> str:
        """标题点击释放事件。"""
        ...

    def on_set_text_widget_content(self, widget: tk.Text, text: str, height: int) -> None:
        """设置文本组件内容。"""
        ...


@dataclass
class CardContext:
    """卡片上下文配置。"""
    theme_manager: Any
    get_font_fn: Callable[..., Any]
    card_padding: int = 10
    show_preview: bool = False


def get_card_key(comic: ComicInfo) -> str:
    """生成卡片唯一键。"""
    return f"{comic.comic_source}:{comic.id}"


def is_title_expanded(card_title_expanded: dict[str, bool], comic: ComicInfo) -> bool:
    """标题是否已展开。"""
    return card_title_expanded.get(get_card_key(comic), False)


def wrap_text_lines(text: str, font_obj: tkfont.Font, max_width: int) -> List[str]:
    """按像素宽度换行。"""
    safe_width = max(40, max_width)
    lines: List[str] = []
    current = ""

    for ch in text:
        if ch == "\n":
            lines.append(current)
            current = ""
            continue

        test_line = current + ch
        if current and font_obj.measure(test_line) > safe_width:
            lines.append(current)
            current = ch
        else:
            current = test_line

    lines.append(current)
    return lines or [""]


def truncate_text_to_lines(
    text: str,
    font_obj: tkfont.Font,
    max_width: int,
    max_lines: int = 3,
) -> tuple[str, bool]:
    """将文本裁剪到指定行数，必要时添加省略号。"""
    lines = wrap_text_lines(text, font_obj, max_width)
    if len(lines) <= max_lines:
        return text, False

    clipped = lines[:max_lines]
    last = clipped[-1]
    ellipsis = "..."
    while last and font_obj.measure(last + ellipsis) > max_width:
        last = last[:-1]
    clipped[-1] = (last + ellipsis) if last else ellipsis
    return "\n".join(clipped), True


def set_text_widget_content(widget: tk.Text, text: str, height: int):
    """更新 Text 内容并保持只读。"""
    widget.config(state=tk.NORMAL)
    widget.delete("1.0", tk.END)
    widget.insert("1.0", text)
    widget.config(height=max(1, height))
    try:
        bg = str(widget.cget("bg"))
        fg = str(widget.cget("fg"))
        widget.config({"disabledbackground": bg, "disabledforeground": fg})
    except tk.TclError:
        pass
    widget.config(state=tk.DISABLED)


def render_title_widget(
    title_widget: tk.Text,
    comic: ComicInfo,
    card_width: int,
    expanded: bool,
    font_obj: tkfont.Font,
):
    """根据展开状态渲染标题文本。"""
    text = comic.title or "未知标题"
    wrap_px = max(140, card_width - 10)

    if expanded:
        lines = wrap_text_lines(text, font_obj, wrap_px)
        set_text_widget_content(title_widget, text, len(lines))
        return

    clipped, _ = truncate_text_to_lines(text, font_obj, wrap_px, max_lines=3)
    set_text_widget_content(title_widget, clipped, 3)


def on_title_click_press(event) -> None:
    """记录标题点击起始状态。"""
    widget = event.widget
    widget._click_start = (event.x, event.y)
    widget._dragging = False
    widget.focus_set()


def on_title_drag(event) -> None:
    """标题拖拽选择时打标记。"""
    widget = event.widget
    start = getattr(widget, "_click_start", (event.x, event.y))
    if abs(event.x - start[0]) > 3 or abs(event.y - start[1]) > 3:
        widget._dragging = True


def on_title_click_release(
    event,
    comic: ComicInfo,
    title_widget: tk.Text,
    card_width: int,
    card_title_expanded: dict[str, bool],
    render_callback: Callable[[tk.Text, ComicInfo, int], None],
) -> str:
    """标题点击释放：无拖拽无选区时切换展开。"""
    widget = event.widget
    if getattr(widget, "_dragging", False):
        return "break"
    if widget.tag_ranges(tk.SEL):
        return "break"

    key = get_card_key(comic)
    card_title_expanded[key] = not card_title_expanded.get(key, False)
    render_callback(title_widget, comic, card_width)
    return "break"


def copy_selected_text(
    event,
    clipboard_setter: Callable[[str], None],
) -> str:
    """复制 Text 当前选区。"""
    widget = event.widget
    try:
        selected_text = widget.get(tk.SEL_FIRST, tk.SEL_LAST)
    except tk.TclError:
        return "break"
    clipboard_setter(selected_text)
    return "break"


def get_frame_background(theme_manager) -> str:
    """获取与卡片一致的背景色。"""
    return theme_manager.get_color("card_bg")


def build_comic_card_frame(
    *,
    parent: tk.Widget,
    comic: ComicInfo,
    row: int,
    col: int,
    columns: int,
    canvas_width: int,
    card_key: str,
    ctx: CardContext,
    handler: CardEventHandler,
) -> tk.Widget:
    """构建单个漫画卡片 UI。

    Args:
        parent: 父容器
        comic: 漫画信息
        row: 行号
        col: 列号
        columns: 总列数
        canvas_width: 画布宽度
        card_key: 卡片唯一键
        ctx: 卡片上下文配置
        handler: 事件处理器
    """
    frame = cast(Any, ttk.Frame(parent, relief="solid", borderwidth=1, padding="5", style="Card.TFrame"))
    frame.comic_ref = comic
    frame.comic_key = card_key
    frame.columnconfigure(0, weight=1)

    for c in range(columns):
        parent.columnconfigure(c, weight=1, uniform="card")

    frame.grid(row=row, column=col, padx=5, pady=5, sticky="wens")

    if canvas_width > 1:
        card_width = (canvas_width - 20) // columns - ctx.card_padding * 2
    else:
        card_width = 200
    card_inner_width = max(140, card_width - 10)
    card_bg = get_frame_background(ctx.theme_manager)

    if ctx.show_preview:
        img_label = cast(Any, ttk.Label(frame))
        img_label.grid(row=0, column=0, pady=(0, 5))
        img_label._cover_url = comic.cover_url or ""
        img_label._cover_card_width = card_width
        img_label._card_click_handler = lambda e, c=comic, f=frame: handler.on_card_click(e, c, f)
        if comic.cover_url:
            img_label.config(text="加载中...")
            handler.on_schedule_cover_load(comic.cover_url, img_label, card_width)
    else:
        placeholder_width = max(12, min(28, int(card_width // 10)))
        placeholder = cast(Any, tk.Label(
            frame,
            text="NSFW",
            bg=ctx.theme_manager.get_color("border"),
            fg=ctx.theme_manager.get_color("text_secondary"),
            font=ctx.get_font_fn("small", bold=True),
            width=placeholder_width,
            height=2,
            relief="flat",
            bd=0,
            anchor="center",
        ))
        placeholder.theme_role = "placeholder"
        placeholder.is_secondary_text = True
        placeholder.grid(row=0, column=0, pady=(0, 5))

    title_widget = cast(Any, tk.Text(
        frame,
        wrap=tk.WORD,
        height=3,
        bd=0,
        relief="flat",
        font=ctx.get_font_fn("normal", bold=True),
        cursor="xterm",
        padx=0,
        pady=0,
        highlightthickness=0,
        bg=card_bg,
        fg=ctx.theme_manager.get_color("text"),
        insertbackground=ctx.theme_manager.get_color("insert"),
        width=max(12, int(card_inner_width / max(7, tkfont.Font(font=ctx.get_font_fn("normal", bold=True)).measure("测")))),
    ))
    title_widget.is_secondary_text = False
    title_widget.grid(row=1, column=0, sticky="we")
    handler.on_render_title(title_widget, comic, card_width)

    author_text = f"作者: {comic.author or '未知'}"
    author_widget = cast(Any, tk.Text(
        frame,
        wrap=tk.WORD,
        height=1,
        bd=0,
        relief="flat",
        font=ctx.get_font_fn("small"),
        fg=ctx.theme_manager.get_color("text_secondary"),
        cursor="xterm",
        padx=0,
        pady=0,
        highlightthickness=0,
        bg=card_bg,
        insertbackground=ctx.theme_manager.get_color("insert"),
        width=max(12, int(card_inner_width / max(7, tkfont.Font(font=ctx.get_font_fn("small")).measure("测")))),
    ))
    author_widget.is_secondary_text = True
    author_widget.grid(row=2, column=0, sticky="we")
    handler.on_set_text_widget_content(author_widget, author_text, 1)
    frame.author_widget = author_widget

    pages_text = f"页数: {comic.pages}"
    pages_label = cast(Any, tk.Label(
        frame,
        text=pages_text,
        foreground=ctx.theme_manager.get_color("text_secondary"),
        bg=card_bg,
        font=ctx.get_font_fn("small"),
    ))
    pages_label.is_secondary_text = True
    pages_label.grid(row=3, column=0, sticky=tk.W)
    frame.pages_label = pages_label

    def _on_download() -> None:
        handler.on_download_click(comic)

    download_btn = ttk.Button(
        frame, text="下载",
        command=_on_download,
    )
    download_btn.grid(row=4, column=0, pady=(5, 0))

    title_widget.bind("<ButtonPress-1>", handler.on_title_click_press)
    title_widget.bind("<B1-Motion>", handler.on_title_drag)
    def _on_title_release(event) -> str:
        return handler.on_title_click_release(event, comic, title_widget, card_width)

    title_widget.bind("<ButtonRelease-1>", _on_title_release)

    for text_widget in (title_widget, author_widget):
        text_widget.bind("<Command-c>", handler.on_copy_selected_text)
        text_widget.bind("<Control-c>", handler.on_copy_selected_text)

    clickable_widgets = [frame, pages_label]
    if not ctx.show_preview:
        clickable_widgets.append(placeholder)
    for widget in clickable_widgets:
        def _on_card_widget_click(event, c=comic, f=frame):
            return handler.on_card_click(event, c, f)
        widget.bind('<Button-1>', _on_card_widget_click)
    if ctx.show_preview and comic.cover_url:
        img_label.bind("<Button-1>", img_label._card_click_handler)

    def _focus_download_btn(_event) -> None:
        download_btn.focus_set()

    download_btn.bind('<Button-1>', _focus_download_btn)
    return frame


