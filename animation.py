"""通用面板动画工具。"""

from __future__ import annotations

import tkinter as tk
from enum import Enum
from typing import Callable, Optional


class Easing(Enum):
    """缓动函数类型。"""
    LINEAR = "linear"
    EASE_OUT_CUBIC = "ease_out_cubic"
    EASE_IN_OUT_CUBIC = "ease_in_out_cubic"


def _apply_easing(progress: float, easing: Easing) -> float:
    """应用缓动函数。"""
    if easing == Easing.LINEAR:
        return progress
    elif easing == Easing.EASE_OUT_CUBIC:
        return 1 - (1 - progress) ** 3
    elif easing == Easing.EASE_IN_OUT_CUBIC:
        if progress < 0.5:
            return 4 * progress ** 3
        else:
            return 1 - (-2 * progress + 2) ** 3 / 2
    return progress


PANEL_ANIMATION_DEFAULT_MS = 180
ANIMATION_FPS_INTERVAL_MS = 16  # ~60 FPS，降低频率避免 tkinter 事件队列堆积导致花屏


class PanelAnimator:
    """面板高度动画器。

    用于展开/折叠面板时的平滑动画效果。

    使用示例:
        animator = PanelAnimator(root, panel_container)
        animator.expand(full_height=400)  # 展开
        animator.collapse()                # 折叠
        animator.animate_to(200)           # 动画到指定高度
    """

    def __init__(
        self,
        root: tk.Tk,
        target: tk.Widget,
        duration_ms: int = PANEL_ANIMATION_DEFAULT_MS,
        easing: Easing = Easing.EASE_OUT_CUBIC,
        on_complete: Optional[Callable[[int], None]] = None,
    ):
        """初始化动画器。

        Args:
            root: Tk 根窗口（用于 after 调度）
            target: 要动画的目标 widget
            duration_ms: 动画时长（毫秒）
            easing: 缓动函数
            on_complete: 动画完成回调，参数为最终高度
        """
        self._root = root
        self._target = target
        self._duration_ms = duration_ms
        self._easing = easing
        self._on_complete = on_complete

        # 动画状态
        self._after_id: Optional[str] = None
        self._start_height: int = 0
        self._end_height: int = 0
        self._current_height: int = 0
        self._step: int = 0
        self._total_steps: int = 1
        self._interval_ms: int = ANIMATION_FPS_INTERVAL_MS

    @property
    def is_animating(self) -> bool:
        """是否正在动画中。"""
        return self._after_id is not None

    @property
    def current_height(self) -> int:
        """当前高度。"""
        return self._current_height

    def cancel(self):
        """取消当前动画。"""
        if self._after_id:
            self._root.after_cancel(self._after_id)
            self._after_id = None

    def animate_to(self, target_height: int):
        """动画到指定高度。

        Args:
            target_height: 目标高度（像素）
        """
        self.cancel()

        self._start_height = self._current_height
        self._end_height = max(0, target_height)
        self._step = 0
        self._total_steps = max(1, self._duration_ms // self._interval_ms)

        # 如果起始高度不同，先设置
        self._target.configure(height=self._start_height)

        self._run_step()

    def expand(self, full_height: int):
        """展开面板到指定高度。

        Args:
            full_height: 完全展开的高度
        """
        self._target.grid()
        self.animate_to(full_height)

    def collapse(self):
        """折叠面板到高度 0。"""
        original_callback = self._on_complete

        def _on_collapse_complete(height: int):
            if height == 0:
                self._target.grid_remove()
            self._on_complete = original_callback
            if original_callback:
                original_callback(height)

        self._on_complete = _on_collapse_complete
        self.animate_to(0)

    def set_height_immediate(self, height: int):
        """立即设置高度（无动画）。"""
        self.cancel()
        self._current_height = max(0, height)
        self._target.configure(height=self._current_height)
        if self._current_height == 0:
            self._target.grid_remove()
        else:
            self._target.grid()

    def _run_step(self):
        """执行动画单帧。"""
        progress = min(1.0, (self._step + 1) / self._total_steps)
        eased = _apply_easing(progress, self._easing)

        new_height = int(
            self._start_height +
            (self._end_height - self._start_height) * eased
        )

        self._current_height = new_height
        self._target.configure(height=new_height)
        # 强制立即完成本帧布局与绘制，避免多帧堆积导致视觉撕裂/花屏
        self._root.update_idletasks()

        if self._step + 1 < self._total_steps:
            self._step += 1
            self._after_id = self._root.after(self._interval_ms, self._run_step)
            return

        # 动画完成
        self._current_height = self._end_height
        self._target.configure(height=self._end_height)
        self._after_id = None

        if self._on_complete:
            self._on_complete(self._end_height)
