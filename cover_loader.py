import logging
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

import tkinter as tk
from PIL import Image, ImageTk
from io import BytesIO
from tkinter import ttk

logger = logging.getLogger(__name__)

COVER_LOAD_FLUSH_MS = 120
MAX_CACHE_SIZE = 100


class CoverLoader:
    def __init__(
        self,
        root: tk.Tk,
        session_get_fn: Callable,
        get_cover_headers_fn: Callable[[], dict],
        is_scrolling_fn: Callable[[], bool],
    ):
        self._root = root
        self._session_get = session_get_fn
        self._get_cover_headers = get_cover_headers_fn
        self._is_scrolling = is_scrolling_fn

        self.image_cache: OrderedDict = OrderedDict()
        self.cover_executor = ThreadPoolExecutor(max_workers=4)
        self.cover_load_generation: int = 0
        self.cover_loading_keys: set[str] = set()
        self.cover_loading_lock = threading.Lock()

        self._pending_image_updates: dict = {}
        self._pending_image_flush_after_id: Optional[str] = None

    def increment_generation(self):
        self.cover_load_generation += 1
        self.clear_pending()

    def clear_pending(self):
        self._pending_image_updates.clear()
        if self._pending_image_flush_after_id:
            self._root.after_cancel(self._pending_image_flush_after_id)
            self._pending_image_flush_after_id = None
        with self.cover_loading_lock:
            self.cover_loading_keys.clear()

    def clear_all(self):
        self.increment_generation()
        with self.cover_loading_lock:
            self.image_cache.clear()

    def schedule_cover_load(self, url: str, label: ttk.Label, card_width: int = 200):
        cover_width = min(200, max(120, card_width - 20))
        cover_height = int(cover_width * 1.4)
        cache_key = f"{url}_{cover_width}x{cover_height}"

        with self.cover_loading_lock:
            if cache_key in self.image_cache:
                photo = self.image_cache[cache_key]
                self._root.after(0, lambda l=label, p=photo: self._safe_update_image(l, p))
                return

            if cache_key in self.cover_loading_keys:
                return
            self.cover_loading_keys.add(cache_key)

        generation = self.cover_load_generation
        self.cover_executor.submit(self._load_cover, url, label, card_width, generation)

    def _load_cover(self, url: str, label: ttk.Label, card_width: int = 200, generation: int = 0):
        cache_key = ""
        try:
            if generation != self.cover_load_generation:
                return

            cover_width = min(200, max(120, card_width - 20))
            cover_height = int(cover_width * 1.4)
            cache_key = f"{url}_{cover_width}x{cover_height}"

            with self.cover_loading_lock:
                if cache_key in self.image_cache:
                    photo = self.image_cache[cache_key]
                    self._root.after(0, lambda l=label, p=photo: self._safe_update_image(l, p))
                    return

            response = self._session_get(
                url,
                timeout=10,
                headers=self._get_cover_headers(),
            )
            response.raise_for_status()

            img = Image.open(BytesIO(response.content))
            img.thumbnail((cover_width, cover_height), Image.Resampling.LANCZOS)
            photo = ImageTk.PhotoImage(img)

            if generation != self.cover_load_generation:
                return

            with self.cover_loading_lock:
                self.image_cache[cache_key] = photo
                # LRU eviction: keep cache bounded
                while len(self.image_cache) > MAX_CACHE_SIZE:
                    self.image_cache.popitem(last=False)
            self._root.after(0, lambda l=label, p=photo: self._safe_update_image(l, p))
        except Exception as e:
            logger.debug(f"Failed to load cover: {e}")
            if generation == self.cover_load_generation:
                self._root.after(
                    0,
                    lambda l=label, u=url, w=card_width, g=generation: self._show_cover_retry_icon(l, u, w, g),
                )
        finally:
            if cache_key:
                with self.cover_loading_lock:
                    self.cover_loading_keys.discard(cache_key)

    def _show_cover_retry_icon(self, label: ttk.Label, url: str, card_width: int, generation: int):
        if generation != self.cover_load_generation:
            return
        try:
            if not label.winfo_exists():
                return
            label._cover_url = url
            label._cover_card_width = card_width
            label.config(image="", text="⚠\n重试", cursor="hand2")
            label.image = None
            label.bind("<Button-1>", lambda e, l=label: self._retry_cover_load(l))
        except tk.TclError:
            logger.debug("封面标签已销毁，跳过失败图标更新")

    def _retry_cover_load(self, label: ttk.Label):
        url = getattr(label, "_cover_url", "")
        card_width = getattr(label, "_cover_card_width", 200)
        if not url:
            return "break"
        try:
            if not label.winfo_exists():
                return "break"
            label.config(image="", text="加载中...", cursor="")
            label.image = None
        except tk.TclError:
            return "break"

        self.schedule_cover_load(url, label, card_width)
        return "break"

    def _safe_update_image(self, label: ttk.Label, photo):
        try:
            if self._is_scrolling():
                self._queue_pending_image_update(label, photo)
                return

            if label.winfo_exists():
                self._restore_cover_click_binding(label)
                label.config(image=photo, text="", cursor="")
                label.image = photo
        except tk.TclError:
            logger.debug("Label已被销毁，跳过图片更新")

    def _queue_pending_image_update(self, label: ttk.Label, photo):
        self._pending_image_updates[label] = photo
        if self._pending_image_flush_after_id is None:
            self._pending_image_flush_after_id = self._root.after(COVER_LOAD_FLUSH_MS, self._flush_pending_image_updates)

    def _flush_pending_image_updates(self):
        self._pending_image_flush_after_id = None
        if self._is_scrolling():
            if self._pending_image_updates:
                self._pending_image_flush_after_id = self._root.after(COVER_LOAD_FLUSH_MS, self._flush_pending_image_updates)
            return

        if not self._pending_image_updates:
            return

        pending_updates = list(self._pending_image_updates.items())
        self._pending_image_updates.clear()
        for label, photo in pending_updates:
            try:
                if label.winfo_exists():
                    self._restore_cover_click_binding(label)
                    label.config(image=photo, text="", cursor="")
                    label.image = photo
            except tk.TclError:
                logger.debug("Label已被销毁，跳过图片更新")

    def flush_pending_on_idle(self):
        self._flush_pending_image_updates()

    @staticmethod
    def _restore_cover_click_binding(label: ttk.Label):
        label_dict = getattr(label, "__dict__", {})
        if "_card_click_handler" not in label_dict:
            return
        handler = label_dict.get("_card_click_handler")
        if callable(handler):
            label.bind("<Button-1>", handler)

    def shutdown(self):
        try:
            self.cover_executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            self.cover_executor.shutdown(wait=False)
