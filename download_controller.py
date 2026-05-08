import logging
import os
import platform
import subprocess
import threading
from typing import Callable, Dict, List, Optional, Set, Tuple

import tkinter as tk
from tkinter import ttk, messagebox

from models import ComicInfo, DownloadTask, DownloadStatus
from downloader import ComicDownloader, DownloadError
from cbz_builder import CBZBuilder
from download_manager import ComicDownloadManager
from config import Config
from theme_manager import ThemeManager
from file_conflict_dialog import show_conflict_dialog
from gui_logic import (
    build_batch_summary,
    should_ignore_gui_callback,
)

logger = logging.getLogger(__name__)


class DownloadController:
    def __init__(
        self,
        root: tk.Tk,
        config: Config,
        downloader: ComicDownloader,
        cbz_builder: CBZBuilder,
        download_manager: ComicDownloadManager,
        theme_manager: ThemeManager,
        app_state: 'AppState',
        get_settings_vars: Callable[[], dict],
        on_status_update: Callable[[str], None],
        on_progress_update: Callable[[float], None],
        on_buttons_restore: Callable[[], None],
        notifier=None,
    ):
        self._root = root
        self.config = config
        self.downloader = downloader
        self.cbz_builder = cbz_builder
        self.download_manager = download_manager
        self.theme_manager = theme_manager
        self._app_state = app_state
        self._get_settings_vars = get_settings_vars
        self._on_status_update = on_status_update
        self._on_progress_update = on_progress_update
        self._on_buttons_restore = on_buttons_restore
        self._notifier = notifier

        self.batch_select_mode_var = tk.BooleanVar(value=False)
        self._is_destroying = False

    # 状态属性代理（访问 app_state）
    @property
    def is_downloading(self) -> bool:
        return self._app_state.download.is_downloading

    @is_downloading.setter
    def is_downloading(self, value: bool):
        self._app_state.download.is_downloading = value

    @property
    def is_batch_downloading(self) -> bool:
        return self._app_state.download.is_batch_downloading

    @is_batch_downloading.setter
    def is_batch_downloading(self, value: bool):
        self._app_state.download.is_batch_downloading = value

    @property
    def is_preparing_details(self) -> bool:
        return self._app_state.download.is_preparing_details

    @is_preparing_details.setter
    def is_preparing_details(self, value: bool):
        self._app_state.download.is_preparing_details = value

    @property
    def selected_comics(self) -> Set[ComicInfo]:
        return self._app_state.download.selected_comics

    def set_destroying(self, value: bool):
        self._is_destroying = value

    def _sv(self) -> dict:
        return self._get_settings_vars()

    def create_batch_toolbar(self, parent: ttk.Frame, search_ctrl, font_fn) -> ttk.Frame:
        toolbar = ttk.Frame(parent, style="Toolbar.TFrame")
        toolbar.grid(row=0, column=0, sticky=(tk.W, tk.E), pady=(0, 5))

        self.batch_mode_check = ttk.Checkbutton(
            toolbar,
            text="批量选择模式",
            variable=self.batch_select_mode_var,
            command=self._on_batch_mode_changed,
        )
        self.batch_mode_check.grid(row=0, column=0, padx=(0, 10))

        self.select_all_btn = ttk.Button(
            toolbar, text="全选", command=self.select_all, width=8,
        )
        self.select_all_btn.grid(row=0, column=1, padx=(0, 5))

        self.clear_selection_btn = ttk.Button(
            toolbar, text="取消", command=self.clear_selection, width=8,
        )
        self.clear_selection_btn.grid(row=0, column=2, padx=(0, 5))

        self.batch_download_btn = ttk.Button(
            toolbar, text="批量下载(0)", command=self.batch_download_selected, width=12,
        )
        self.batch_download_btn.grid(row=0, column=3, padx=(0, 15))

        ttk.Separator(toolbar, orient="vertical").grid(row=0, column=4, sticky=(tk.N, tk.S), padx=5)

        self.prev_page_btn = ttk.Button(
            toolbar, text="上一页", command=search_ctrl.go_previous_page, width=8,
        )
        self.prev_page_btn.grid(row=0, column=5, padx=(10, 5))
        self.prev_page_btn.state(['disabled'])

        self.page_label_var = tk.StringVar(value="1/1")
        self.page_label = ttk.Label(
            toolbar, textvariable=self.page_label_var, font=font_fn("normal"), cursor="hand2",
        )
        self.page_label.grid(row=0, column=6, padx=(0, 5))
        self.page_label.bind("<Button-1>", lambda e: search_ctrl.go_to_page_dialog())

        self.next_page_btn = ttk.Button(
            toolbar, text="下一页", command=search_ctrl.go_next_page, width=8,
        )
        self.next_page_btn.grid(row=0, column=7)
        self.next_page_btn.state(['disabled'])

        self.update_toolbar_buttons()
        return toolbar

    def select_all(self):
        if self.is_batch_downloading or not self.batch_select_mode_var.get():
            return

        search = self._app_state.search
        self.selected_comics.clear()
        for comic in search.results:
            self.selected_comics.add(comic)

        for i, frame in enumerate(search.result_frames):
            if i < len(search.results):
                self.update_card_visual(frame, True)

        self.update_toolbar_buttons()
        logger.info(f"已选中全部 {len(search.results)} 本漫画")

    def clear_selection(self):
        if self.is_batch_downloading:
            return

        self.selected_comics.clear()
        search = self._app_state.search
        for frame in search.result_frames:
            self.update_card_visual(frame, False)

        self.update_toolbar_buttons()
        logger.info("已清空所有选择")

    def update_toolbar_buttons(self):
        if not hasattr(self, 'batch_download_btn'):
            return

        selected_count = len(self.selected_comics)
        in_batch_mode = self.batch_select_mode_var.get()

        self.batch_download_btn.config(text=f"批量下载({selected_count})")

        if in_batch_mode and selected_count > 0 and not self.is_batch_downloading:
            self.batch_download_btn.state(['!disabled'])
        else:
            self.batch_download_btn.state(['disabled'])

        if self.is_batch_downloading or not in_batch_mode:
            self.select_all_btn.state(['disabled'])
            self.clear_selection_btn.state(['disabled'])
        else:
            self.select_all_btn.state(['!disabled'])
            self.clear_selection_btn.state(['!disabled'])

    def _on_batch_mode_changed(self):
        if not self.batch_select_mode_var.get():
            self.clear_selection()
        self.update_toolbar_buttons()

    def confirm_batch_download(self, comics: List[ComicInfo]) -> bool:
        if not comics:
            return False
        comic_list = "\n".join([f"{i+1}. {comic.title}" for i, comic in enumerate(comics)])
        message = f"即将下载以下 {len(comics)} 本漫画：\n\n{comic_list}\n\n是否继续？"
        return messagebox.askyesno("确认批量下载", message)

    def batch_download_selected(self, ensure_detail_ready_fn, search_btn, favourites_btn):
        if not self.batch_select_mode_var.get():
            messagebox.showinfo("提示", "请先开启批量选择模式")
            return
        if not self.selected_comics:
            messagebox.showinfo("提示", "请先选择要下载的漫画")
            return
        if self.is_downloading or self.is_batch_downloading:
            messagebox.showinfo("提示", "已有下载任务进行中，请等待完成")
            return
        if self.is_preparing_details:
            messagebox.showinfo("提示", "正在获取漫画详情，请稍后")
            return

        download_list = list(self.selected_comics)
        self.is_preparing_details = True
        search_btn.config(state=tk.DISABLED)
        favourites_btn.config(state=tk.DISABLED)
        self._on_status_update("正在获取批量下载详情...")

        def update_prepare_progress(current: int, total: int, comic: ComicInfo):
            self._root.after(
                0,
                lambda c=current, t=total, title=comic.title: self._on_status_update(
                    f"正在获取详情 ({c}/{t}): {title}"
                ),
            )

        def do_prepare_and_continue():
            try:
                prepared_list = ensure_detail_ready_fn(download_list, progress_callback=update_prepare_progress)
            except Exception as e:  # TODO: narrow exception type
                error_msg = str(e)
                self._root.after(0, lambda msg=error_msg: self._on_batch_prepare_failed(msg, search_btn, favourites_btn))
                return
            self._root.after(0, lambda: self._on_batch_prepare_ready(prepared_list, search_btn, favourites_btn))

        threading.Thread(target=do_prepare_and_continue, daemon=True).start()

    def _on_batch_prepare_ready(self, comics: List[ComicInfo], search_btn, favourites_btn):
        self.is_preparing_details = False
        search_btn.config(state=tk.NORMAL)
        favourites_btn.config(state=tk.NORMAL)

        if not self.confirm_batch_download(comics):
            self._on_status_update("已取消批量下载")
            return
        self.execute_batch_download(comics)

    def _on_batch_prepare_failed(self, error_msg: str, search_btn, favourites_btn):
        self.is_preparing_details = False
        search_btn.config(state=tk.NORMAL)
        favourites_btn.config(state=tk.NORMAL)
        self._on_status_update(f"获取详情失败: {error_msg}")
        messagebox.showerror("错误", f"批量下载前获取详情失败:\n{error_msg}")

    def detect_file_conflicts(self, comics: List[ComicInfo]) -> Tuple[List[ComicInfo], List[Tuple[int, ComicInfo, str]]]:
        conflicts = []
        no_conflict = []
        sv = self._sv()
        current_dir = sv["download_dir"]
        output_format = self.config.output_format

        for i, comic in enumerate(comics):
            output_path = self.cbz_builder.get_output_path_for_format(comic, output_format, current_dir)
            filename = os.path.basename(output_path)
            if os.path.exists(output_path):
                conflicts.append((i, comic, filename))
            else:
                no_conflict.append(comic)

        return no_conflict, conflicts

    def handle_file_conflicts(self, conflicts: List[Tuple[int, ComicInfo, str]]) -> Tuple[List[ComicInfo], List[ComicInfo]]:
        if not conflicts:
            return [], []

        conflict_comics = [c[1] for c in conflicts]
        conflict_filenames = [c[2] for c in conflicts]

        decisions = show_conflict_dialog(self._root, conflict_comics, conflict_filenames)
        if decisions is None:
            return [], conflict_comics

        overwrite = []
        skip = []
        for i, (orig_idx, comic, filename) in enumerate(conflicts):
            if decisions.get(i, False):
                overwrite.append(comic)
            else:
                skip.append(comic)
        return overwrite, skip

    def execute_batch_download(self, comics: List[ComicInfo]):
        if not comics:
            return

        no_conflict, conflicts = self.detect_file_conflicts(comics)
        if conflicts:
            overwrite, skip = self.handle_file_conflicts(conflicts)
            if not no_conflict and not overwrite:
                messagebox.showinfo("提示", "所有下载任务已取消")
                return
            comics = no_conflict + overwrite
            if not comics:
                messagebox.showinfo("提示", "没有漫画需要下载")
                return
            if len(skip) > 0:
                self._on_status_update(f"已跳过 {len(skip)} 个同名文件")

        sv = self._sv()
        self.download_manager.set_output_dir(sv["download_dir"])
        self.download_manager.set_output_format(self.config.output_format)
        self.download_manager.set_delay_after(sv["batch_delay"])
        self.download_manager.add_tasks(comics)

        dm_ui = sv.get("download_manager_ui")
        if dm_ui and not dm_ui.is_expanded:
            self._toggle_download_manager(sv)

        if dm_ui:
            dm_ui.refresh_task_list()

        self.is_batch_downloading = True
        self.update_toolbar_buttons()
        self.download_manager.start()

    def show_batch_download_summary(self, results: dict):
        self.is_batch_downloading = False
        self.update_toolbar_buttons()

        success_count = len(results["success"])
        failed_count = len(results["failed"])

        message = f"批量下载完成\n\n成功: {success_count} 本"
        if failed_count > 0:
            message += f"\n失败: {failed_count} 本"
            for comic, error in results["failed"]:
                message += f"\n  - {comic.title}: {error}"

        self._on_status_update(f"批量下载完成：成功 {success_count} 本，失败 {failed_count} 本")
        self._on_progress_update(0)

        if failed_count > 0:
            messagebox.showwarning("批量下载完成", message)
        else:
            messagebox.showinfo("批量下载完成", message)

        self.clear_selection()

    def download_comic(self, comic: ComicInfo, ensure_detail_ready_fn, search_btn, favourites_btn):
        if self.is_batch_downloading:
            messagebox.showinfo("提示", "批量下载进行中，请等待完成")
            return
        if self.is_downloading:
            messagebox.showinfo("提示", "已有下载任务进行中，请等待完成")
            return
        if self.is_preparing_details:
            messagebox.showinfo("提示", "正在获取漫画详情，请稍后")
            return

        self.is_preparing_details = True
        search_btn.config(state=tk.DISABLED)
        favourites_btn.config(state=tk.DISABLED)
        self._on_status_update(f"正在确认详情: {comic.title}...")

        def do_prepare():
            try:
                prepared_list = ensure_detail_ready_fn([comic])
                comic_to_download = prepared_list[0] if prepared_list else comic
                self._dispatch_ui_callback(lambda c=comic_to_download, sb=search_btn, fb=favourites_btn: self._continue_single_download(c, sb, fb))
            except Exception as e:  # TODO: narrow exception type
                self._dispatch_ui_callback(
                    lambda err=str(e), title=comic.title, sb=search_btn, fb=favourites_btn: self._on_single_prepare_failed(title, err, sb, fb)
                )

        threading.Thread(target=do_prepare, daemon=True).start()

    def _on_single_prepare_failed(self, comic_title: str, error_msg: str, search_btn, favourites_btn):
        self.is_preparing_details = False
        search_btn.config(state=tk.NORMAL)
        favourites_btn.config(state=tk.NORMAL)
        logger.warning(f"Prepare comic before download failed: {error_msg}")
        self._on_status_update(f"获取详情失败: {comic_title}")
        messagebox.showerror("错误", f"下载前获取详情失败:\n{error_msg}")

    def _continue_single_download(self, comic_to_download: ComicInfo, search_btn, favourites_btn):
        self.is_preparing_details = False
        search_btn.config(state=tk.NORMAL)
        favourites_btn.config(state=tk.NORMAL)

        sv = self._sv()
        current_dir = sv["download_dir"]
        output_format = self.config.output_format
        target_output_path = self.cbz_builder.get_output_path_for_format(comic_to_download, output_format, current_dir)

        if os.path.exists(target_output_path):
            filename = os.path.basename(target_output_path)
            decisions = show_conflict_dialog(self._root, [comic_to_download], [filename])
            if decisions is None or not decisions.get(0, False):
                self._on_status_update("已取消下载")
                return

        format_display = {"folder": "文件夹", "zip": "ZIP格式", "cbz": "CBZ格式"}.get(output_format, "CBZ格式")
        if not messagebox.askyesno(
            "确认下载",
            f"是否下载:\n{comic_to_download.title}\n\n作者: {comic_to_download.author or '未知'}\n页数: {comic_to_download.pages}\n\n输出格式: {format_display}",
        ):
            self._on_status_update("已取消下载")
            return

        self.is_downloading = True
        self._on_status_update(f"准备下载: {comic_to_download.title}...")
        self._on_progress_update(0)

        self.downloader.concurrent_downloads = sv["concurrent"]

        def do_download():
            temp_dir = None
            try:
                result = self.downloader.download_comic_resume(
                    comic_to_download,
                    current_dir,
                    progress_callback=self._progress_callback,
                )
                if not result.success:
                    raise DownloadError(result.error_message or "下载失败")
                temp_dir = result.temp_dir

                if output_format == "folder":
                    self._root.after(0, lambda: self._on_status_update("正在保存文件夹..."))
                    output_path = self.cbz_builder.save_as_folder(temp_dir, comic_to_download, current_dir)
                elif output_format == "zip":
                    self._root.after(0, lambda: self._on_status_update("正在打包 ZIP..."))
                    output_path = self.cbz_builder.build_zip(temp_dir, comic_to_download, target_output_path)
                    self.downloader.cleanup_temp_dir(temp_dir)
                else:
                    self._root.after(0, lambda: self._on_status_update("正在打包 CBZ..."))
                    output_path = self.cbz_builder.build_cbz(temp_dir, comic_to_download, target_output_path)
                    self.downloader.cleanup_temp_dir(temp_dir)

                self._root.after(0, lambda: self.download_complete(output_path))
            except Exception as e:
                error_msg = str(e)
                logger.error("Download error: %s", error_msg, exc_info=True)
                self._root.after(0, lambda: self.download_error(error_msg, temp_dir))

        threading.Thread(target=do_download, daemon=True).start()

    def _progress_callback(self, current: int, total: int, status: str, comic_info: Optional[dict] = None):
        def update():
            progress = (current / total * 100) if total > 0 else 0
            self._on_progress_update(progress)

            if comic_info:
                comic_index = comic_info.get("comic_index", 0)
                total_comics = comic_info.get("total_comics", 1)
                title = comic_info.get("title", "未知")
                full_status = f"[{comic_index}/{total_comics}] [{current}/{total}] {title} - {status}"
            else:
                full_status = status
            self._on_status_update(full_status)

        self._root.after(0, update)

    def download_complete(self, output_path: str):
        self.is_downloading = False
        self._on_progress_update(100)
        self._on_status_update(f"下载完成: {output_path}")
        messagebox.showinfo("完成", f"下载成功!\n保存位置:\n{output_path}")

    def download_error(self, error_msg: str, temp_dir: Optional[str]):
        self.is_downloading = False
        self._on_progress_update(0)
        self._on_status_update(f"下载失败: {error_msg}")

        if temp_dir and os.path.exists(temp_dir):
            msg = f"下载失败: {error_msg}\n\n临时文件保留在:\n{temp_dir}"
        else:
            msg = f"下载失败: {error_msg}"
        messagebox.showerror("错误", msg)

    def on_download_task_update(self, task: DownloadTask):
        if should_ignore_gui_callback(self._is_destroying):
            return
        try:
            self._root.after(0, lambda: self._update_ui_for_task(task))
        except tk.TclError:
            logger.debug("窗口已销毁，忽略下载任务更新")

    def _update_ui_for_task(self, task: DownloadTask):
        sv = self._sv()
        dm_ui = sv.get("download_manager_ui")
        if dm_ui:
            dm_ui.update_task(task)

        if self.download_manager.current_task_id == task.task_id:
            self._on_progress_update(task.progress_percentage)
            self._on_status_update(
                f"[{task.progress_current}/{task.progress_total}] {task.comic.title}"
            )

    def on_download_queue_complete(self):
        if should_ignore_gui_callback(self._is_destroying):
            return

        def on_complete():
            if should_ignore_gui_callback(self._is_destroying):
                return
            self.is_batch_downloading = False
            self.update_toolbar_buttons()

            stats = self.download_manager.get_stats()
            failed = stats["failed"]

            message = build_batch_summary(stats)
            failed_list = []
            if failed > 0:
                failed_tasks = [
                    task for task in self.download_manager.tasks.values()
                    if task.status == DownloadStatus.FAILED
                ]
                for task in failed_tasks:
                    message += f"\n  - {task.comic.title}"
                    if task.error_message:
                        message += f": {task.error_message}"
                    failed_list.append((task.comic.title, task.error_message or ""))

            # 系统通知
            if self._notifier:
                try:
                    self._notifier.notify(
                        completed=stats["completed"],
                        failed=failed,
                        failed_list=failed_list,
                    )
                except Exception as e:  # TODO: narrow exception type
                    logger.error(f"系统通知失败: {e}")

            messagebox.showinfo("完成", message)

            self.download_manager.clear_completed()
            sv = self._sv()
            dm_ui = sv.get("download_manager_ui")
            if dm_ui:
                dm_ui.refresh_task_list()

            self._on_status_update("就绪")
            self._on_progress_update(0)

        try:
            self._root.after(0, on_complete)
        except tk.TclError:
            logger.debug("窗口已销毁，忽略队列完成回调")

    def toggle_download_manager(self):
        sv = self._sv()
        dm_ui = sv.get("download_manager_ui")
        if dm_ui:
            dm_ui.toggle()
            icon = "▼" if dm_ui.is_expanded else "▲"
            expand_btn = sv.get("expand_btn")
            if expand_btn:
                expand_btn.config(text=icon)

    def _toggle_download_manager(self, sv: dict):
        dm_ui = sv.get("download_manager_ui")
        if dm_ui:
            dm_ui.toggle()
            icon = "▼" if dm_ui.is_expanded else "▲"
            expand_btn = sv.get("expand_btn")
            if expand_btn:
                expand_btn.config(text=icon)

    def toggle_selection(self, comic: ComicInfo) -> bool:
        if comic in self.selected_comics:
            self.selected_comics.remove(comic)
            logger.debug(f"取消选中: {comic.title}")
            return False
        else:
            self.selected_comics.add(comic)
            logger.debug(f"选中: {comic.title}")
            return True

    def update_card_visual(self, frame: tk.Frame, is_selected: bool):
        select_label = None
        for child in frame.winfo_children():
            if hasattr(child, 'select_mark'):
                select_label = child
                break

        if is_selected:
            frame.config(relief="solid", borderwidth=2)
            selected_bg = self.theme_manager.get_color("accent")
            try:
                frame.config(bg=selected_bg)
                for child in frame.winfo_children():
                    if isinstance(child, tk.Frame):
                        child.config(bg=selected_bg)
            except (tk.TclError, AttributeError):
                pass

            if select_label is None:
                select_label = tk.Label(
                    frame, text="✓", fg="#ffffff", bg=selected_bg, font=("Arial", 14, "bold"),
                )
                select_label.select_mark = True
                select_label.place(relx=1.0, rely=0.0, anchor="ne", x=-5, y=5)
            else:
                select_label.config(bg=selected_bg, fg="#ffffff")
        else:
            frame.config(relief="solid", borderwidth=1)
            try:
                frame.config(bg="")
                for child in frame.winfo_children():
                    if isinstance(child, tk.Frame):
                        child.config(bg="")
            except (tk.TclError, AttributeError):
                pass

            if select_label is not None:
                select_label.destroy()

    def on_card_click(self, event, comic: ComicInfo, frame: tk.Frame):
        if self.is_batch_downloading:
            return
        if not self.batch_select_mode_var.get():
            return
        is_selected = self.toggle_selection(comic)
        self.update_card_visual(frame, is_selected)
        self.update_toolbar_buttons()

    def _dispatch_ui_callback(self, callback: Callable[[], None]):
        try:
            if threading.current_thread() is threading.main_thread():
                callback()
            else:
                self._root.after(0, callback)
        except tk.TclError:
            logger.debug("窗口已销毁，忽略 UI 回调")

    def browse_download_dir(self):
        from tkinter import filedialog
        sv = self._sv()
        dir_path = filedialog.askdirectory(initialdir=sv["download_dir"])
        if dir_path:
            sv["download_dir_var"].set(dir_path)

    def open_download_dir(self):
        sv = self._sv()
        download_dir = sv["download_dir"]
        if not download_dir or not os.path.exists(download_dir):
            messagebox.showinfo("提示", "下载目录不存在，请先设置有效的下载目录")
            return
        try:
            system = platform.system()
            if system == "Windows":
                os.startfile(download_dir)
            elif system == "Darwin":
                subprocess.run(["open", download_dir], check=True)
            else:
                try:
                    subprocess.run(["xdg-open", download_dir], check=True)
                except (subprocess.CalledProcessError, FileNotFoundError, OSError):
                    try:
                        subprocess.run(["nautilus", download_dir], check=True)
                    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
                        subprocess.run(["xdg-open", "--", download_dir], check=True)
            logger.info(f"已打开下载目录: {download_dir}")
        except Exception as e:  # TODO: narrow exception type
            logger.error(f"打开下载目录失败: {e}")
            messagebox.showerror("错误", f"无法打开目录:\n{e}")
