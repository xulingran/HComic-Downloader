## 1. 基础设施

- [x] 1.1 创建 `scroll_handler.py`，实现 `ScrollHandler` 类：从 `gui_app.py` 提取 `_on_mousewheel`、`_on_mousewheel_linux_button`、`_on_touchpad_scroll`、`_scroll_canvas_smooth`、`_bind_scroll_events`、`_is_scroll_event_for_results`、`_mark_scroll_active`、`_mark_scroll_idle`、`_on_scrollable_frame_configure`、`_unpack_touchpad_scroll_delta`
- [x] 1.2 创建 `cover_loader.py`，实现 `CoverLoader` 类：从 `gui_app.py` 提取 `_schedule_cover_load`、`load_cover`、`_show_cover_retry_icon`、`_retry_cover_load`、`_safe_update_image`、`_queue_pending_image_update`、`_flush_pending_image_updates`、`_clear_pending_image_updates`，以及相关的状态变量（`image_cache`、`cover_executor`、`cover_load_generation`、`cover_loading_keys`、`cover_loading_lock`、`_pending_image_updates` 等）
- [x] 1.3 在主类中接入 `ScrollHandler` 和 `CoverLoader`：替换原有方法调用为委托调用，删除主类中对应的原方法，运行应用验证搜索和滚动功能正常

## 2. SearchController

- [x] 2.1 创建 `search_controller.py`，实现 `SearchController` 类：提取搜索状态变量（`search_results`、`current_page`、`total_pages`、`current_search_keyword`、`current_search_mode`、`has_search_started`、`current_view_mode`、`result_frames`、`card_title_expanded`、`moeimg_detail_ready_keys`、`detail_prefetch_generation`）
- [x] 2.2 将搜索/导航方法移入 `SearchController`：`search`、`search_error`、`display_results`、`_load_page`、`view_favourites`、`_handle_favourites_login_required`、`go_previous_page`、`go_next_page`、`go_to_page_dialog`、`_scroll_results_to_top`、`update_pagination_controls`
- [x] 2.3 将来源切换方法移入 `SearchController`：`_on_source_changed`、`_clear_results_for_source_switch`、`_build_search_keyword`、`_get_current_source`、`_get_selected_query_mode`、`_get_effective_query_mode`、`_get_request_endpoint_hint`、`_refresh_query_context_hint`、`_source_requires_login`
- [x] 2.4 将布局方法移入 `SearchController`：`_on_window_resize`、`_update_layout`、`_calculate_columns`、`_update_canvas_width`、`_refresh_results_layout`、`create_comic_card`
- [x] 2.5 将详情预取方法移入 `SearchController`：`_start_result_detail_prefetch`、`_on_result_detail_prefetched`、`_update_visible_card_metadata`、`_prepare_single_comic_detail`、`_ensure_comics_detail_ready`、`_merge_prepared_comic`，以及辅助方法（`_is_moeimg_comic`、`_detail_ready_key`、`_dedupe_text_values` 等）
- [x] 2.6 在主类中接入 `SearchController`：替换原有方法调用为委托调用，删除主类中已迁移的方法，移除 `SearchPanel` 的 `_call_host` 代理层，运行应用验证搜索、翻页、来源切换功能正常

## 3. DownloadController

- [x] 3.1 创建 `download_controller.py`，实现 `DownloadController` 类：提取下载状态变量（`is_downloading`、`is_batch_downloading`、`is_preparing_details`、`selected_comics`、`batch_select_mode_var`）
- [x] 3.2 将批量操作方法移入 `DownloadController`：`create_batch_toolbar`、`select_all`、`clear_selection`、`update_toolbar_buttons`、`_on_batch_mode_changed`、`toggle_selection`、`update_card_visual`、`_on_card_click`、`confirm_batch_download`、`batch_download_selected`、`_on_batch_prepare_ready`、`_on_batch_prepare_failed`
- [x] 3.3 将下载执行方法移入 `DownloadController`：`download_comic`、`_on_single_prepare_failed`、`_continue_single_download`、`_progress_callback`、`download_complete`、`download_error`
- [x] 3.4 将队列管理和文件冲突方法移入 `DownloadController`：`execute_batch_download`、`show_batch_download_summary`、`detect_file_conflicts`、`handle_file_conflicts`、`on_download_task_update`、`_update_ui_for_task`、`on_download_queue_complete`、`_toggle_download_manager`
- [x] 3.5 在主类中接入 `DownloadController`：替换原有方法调用为委托调用，删除主类中已迁移的方法，移除 `DownloadPanel` 的 `_call_host` 代理层，运行应用验证单个下载和批量下载功能正常

## 4. 清理主类

- [x] 4.1 将设置面板动画逻辑移入 `SettingsPanel`（或独立模块）：提取 `toggle_settings_panel`、`_animate_settings_panel`、`_run_settings_animation_step`、`_set_settings_button_text` 及相关动画状态变量
- [x] 4.2 消除变量提升：删除主类中对 `self.settings_panel.*_var` 的 15+ 个重复引用，改为通过 `self.settings_panel` 的公共方法访问
- [x] 4.3 清理主类中残留的静态代理方法（如 `_get_card_key`、`_is_title_expanded`、`_wrap_text_lines`、`_set_text_widget_content` 等对 `comic_card.py` 的简单转发）
- [x] 4.4 最终验证：运行完整手动测试流程（搜索/翻页/单个下载/批量下载/收藏夹/设置面板/主题切换/来源切换），确认所有功能正常
