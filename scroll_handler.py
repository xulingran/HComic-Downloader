import logging
import platform
from typing import Callable, List, Tuple

import tkinter as tk
from tkinter import scrolledtext

logger = logging.getLogger(__name__)

SCROLL_IDLE_MS = 120


class ScrollHandler:
    def __init__(
        self,
        root: tk.Tk,
        canvas: tk.Canvas,
        scrollable_frame: tk.Frame,
        on_scroll_idle: Callable[[], None],
        on_scrollable_frame_configure: Callable[[int], None],
    ):
        self._root = root
        self._canvas = canvas
        self._scrollable_frame = scrollable_frame
        self._on_scroll_idle = on_scroll_idle
        self._on_scrollable_frame_configure = on_scrollable_frame_configure

        self._is_scrolling = False
        self._scroll_reset_after_id = None
        self._wheel_delta_remainder = 0.0
        self._touchpad_scroll_scale = 3.0
        self._platform_system = platform.system()
        self._content_height = 1

        self._bind_scroll_events()

    @property
    def is_scrolling(self) -> bool:
        return self._is_scrolling

    def update_content_height(self, height: int):
        self._content_height = max(1, height)

    def on_scrollable_frame_configure_event(self, event):
        height = max(1, int(getattr(event, "height", 1)))
        self._content_height = height
        self._on_scrollable_frame_configure(height)
        canvas_width = max(1, self._canvas.winfo_width())
        self._canvas.configure(scrollregion=(0, 0, canvas_width, self._content_height))

    def destroy(self):
        if self._scroll_reset_after_id:
            self._root.after_cancel(self._scroll_reset_after_id)
            self._scroll_reset_after_id = None
        self._is_scrolling = False

    def _bind_scroll_events(self):
        for widget in (self._canvas, self._scrollable_frame):
            widget.bind("<MouseWheel>", self._on_mousewheel, add="+")
            if platform.system() == "Darwin":
                widget.bind("<TouchpadScroll>", self._on_touchpad_scroll, add="+")
            widget.bind("<Button-4>", self._on_mousewheel_linux_button, add="+")
            widget.bind("<Button-5>", self._on_mousewheel_linux_button, add="+")
        self._root.bind_all("<MouseWheel>", self._on_mousewheel, add="+")
        if platform.system() == "Darwin":
            self._root.bind_all("<TouchpadScroll>", self._on_touchpad_scroll, add="+")
        self._root.bind_all("<Button-4>", self._on_mousewheel_linux_button, add="+")
        self._root.bind_all("<Button-5>", self._on_mousewheel_linux_button, add="+")

    def _on_mousewheel(self, event):
        if not self._is_scroll_event_for_results(event):
            return

        delta = getattr(event, "delta", 0)
        if delta == 0:
            return

        self._mark_scroll_active()

        if self._platform_system == "Darwin":
            self._scroll_canvas_smooth(delta)
            return "break"

        threshold = 120
        self._wheel_delta_remainder += -delta
        units = int(self._wheel_delta_remainder / threshold)
        if units == 0:
            return

        self._wheel_delta_remainder -= units * threshold
        self._canvas.yview_scroll(units, "units")
        return "break"

    def _on_mousewheel_linux_button(self, event):
        if not self._is_scroll_event_for_results(event):
            return

        self._mark_scroll_active()
        if event.num == 4:
            self._canvas.yview_scroll(-1, "units")
        elif event.num == 5:
            self._canvas.yview_scroll(1, "units")
        return "break"

    def _on_touchpad_scroll(self, event):
        if not self._is_scroll_event_for_results(event):
            return

        packed_delta = getattr(event, "delta", 0)
        if packed_delta == 0:
            return

        _, delta_y = self._unpack_touchpad_scroll_delta(packed_delta)
        if delta_y == 0:
            return "break"

        self._mark_scroll_active()
        self._scroll_canvas_smooth(-delta_y)
        return "break"

    def _scroll_canvas_smooth(self, delta_y: float):
        total_height = max(1, self._content_height)
        viewport_height = max(1, self._canvas.winfo_height())
        if total_height <= viewport_height:
            return

        scrollable_height = total_height - viewport_height
        first, _ = self._canvas.yview()
        delta_fraction = (delta_y * self._touchpad_scroll_scale) / scrollable_height
        new_first = min(1.0, max(0.0, first + delta_fraction))
        if new_first != first:
            self._canvas.yview_moveto(new_first)

    def _is_scroll_event_for_results(self, event) -> bool:
        widget = getattr(event, "widget", None)
        original_widget = widget
        while widget is not None:
            if widget == self._canvas or widget == self._scrollable_frame:
                return True
            widget = widget.master

        x_root = getattr(event, "x_root", None)
        y_root = getattr(event, "y_root", None)
        if x_root is not None and y_root is not None:
            hovered = self._root.winfo_containing(x_root, y_root)
            while hovered is not None:
                if hovered == self._canvas or hovered == self._scrollable_frame:
                    return True
                hovered = hovered.master

        if isinstance(original_widget, (tk.Text, scrolledtext.ScrolledText, tk.Entry, ttk_entry_class())):
            return False
        return True

    def _mark_scroll_active(self):
        self._is_scrolling = True
        if self._scroll_reset_after_id:
            self._root.after_cancel(self._scroll_reset_after_id)
        self._scroll_reset_after_id = self._root.after(SCROLL_IDLE_MS, self._mark_scroll_idle)

    def _mark_scroll_idle(self):
        self._is_scrolling = False
        self._scroll_reset_after_id = None
        self._on_scroll_idle()

    @staticmethod
    def _unpack_touchpad_scroll_delta(packed_delta: int) -> Tuple[int, int]:
        packed = packed_delta & 0xFFFFFFFF
        delta_x = (packed >> 16) & 0xFFFF
        delta_y = packed & 0xFFFF
        if delta_x >= 0x8000:
            delta_x -= 0x10000
        if delta_y >= 0x8000:
            delta_y -= 0x10000
        return delta_x, delta_y


def ttk_entry_class():
    from tkinter import ttk
    return ttk.Entry
