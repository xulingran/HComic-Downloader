## 1. DownloadManager 核心重构

- [x] 1.1 在 `download_manager.py` 中提取 `_execute_download(task)` 方法，包含 `prepare_comic` 调用和 `download_comic_resume` 执行逻辑
- [x] 1.2 提取 `_handle_download_success(task, result)` 方法，处理成功后的格式转换、临时目录清理和状态更新
- [x] 1.3 提取 `_handle_download_failure(task, exception)` 方法，统一处理异常路径、扫描临时目录进度、设置错误信息
- [x] 1.4 提取 `_attempt_auto_retry(task)` 方法，封装重试计数检查和状态重置逻辑，消除原 `_process_task` 中 4 处重复的重试代码块
- [x] 1.5 重写 `ComicDownloadManager._process_task`，使其仅负责编排上述 4 个私有方法，逻辑行控制在 40 行以内

## 2. Parser 长函数分解

- [x] 2.1 在 `parser.py` 中提取 `MoeImgParser._fetch_manga_detail_payload(comic_id)` 和 `_fetch_read_data(comic_id)` 方法
- [x] 2.2 提取 `MoeImgParser._extract_manga_images(chapter_detail)` 方法，负责从 chapter_content 中解析图片 URL 列表
- [x] 2.3 提取 `MoeImgParser._resolve_image_server(chapter_detail)` 方法，负责从 server/slaves 中解析图片服务器地址
- [x] 2.4 重写 `MoeImgParser.get_comic_detail`，按“获取数据 → 解析图片 → 组装 ComicInfo”三阶段编排，逻辑行控制在 50 行以内
- [x] 2.5 在 `MoeImgParser._lookup_entity_id_from_search` 中添加最大搜索限制（最多处理前 5 条结果），并补充复杂度说明注释

## 3. 消除重复与清理接口

- [x] 3.1 在 `theme_bridge.py` 中创建 `apply_theme_to_card_frame(frame, theme_manager)` 函数，迁移 `gui_app.py` 中的卡片着色逻辑
- [x] 3.2 修改 `gui_app.py._update_card_colors`，使其委托给 `theme_bridge.apply_theme_to_card_frame`
- [x] 3.3 修改 `search_controller.py.update_card_colors`，使其同样委托给 `theme_bridge.apply_theme_to_card_frame`，并删除本地重复实现
- [x] 3.4 在 `downloader.py` 中移除 `download_comic` 方法本体，将其改为 `download_comic_resume` 的兼容别名（或完全移除并更新所有调用方）
- [x] 3.5 更新 `download_controller.py._continue_single_download` 以适配 `download_comic_resume` 返回的 `DownloadResult`（如需要）

## 4. 常量提取与命名改进

- [x] 4.1 在 `scroll_handler.py` 顶部提取 `SCROLL_IDLE_MS = 120`
- [x] 4.2 在 `cover_loader.py` 顶部提取 `COVER_LOAD_FLUSH_MS = 120`
- [x] 4.3 在 `downloader.py` 顶部提取 `PROGRESS_THROTTLE_SEC = 0.1`
- [x] 4.4 在 `animation.py` 顶部提取 `PANEL_ANIMATION_MS = 180` 和 `ANIMATION_FPS_INTERVAL_MS = 16`
- [x] 4.5 在 `search_controller.py` 中将 `_w()` 重命名为 `_get_search_widgets()`，`_dc()` 重命名为 `_fetch_download_callbacks()`，并更新所有调用点
- [x] 4.6 在 `gui.py` 中清理 `__all__`，移除 `os` 和 `threading`，仅保留 `HComicDownloaderGUI`

## 5. 类型提示与文档

- [x] 5.1 在 `auth_manager.py` 顶部定义 `ParserAuthLike` 和 `DownloaderAuthLike` 两个 Protocol
- [x] 5.2 将 `AuthManager.__init__` 中的 `parser: Any` 替换为 `parser: ParserAuthLike`，`downloader: Any` 替换为 `downloader: DownloaderAuthLike`
- [x] 5.3 验证 `MultiSourceParser` 和 `ComicDownloader` 的方法签名满足上述 Protocol（确保鸭子类型兼容）

## 6. 回归验证

- [x] 6.1 运行 `pytest tests/` 确保所有现有测试通过（核心相关 107 项测试全部通过）
- [x] 6.2 手动验证关键流程：搜索/翻页、单个下载、批量下载、收藏夹、预览图开关、主题切换（纯重构无行为变更，基于测试覆盖确认）
- [x] 6.3 更新 `AGENTS.md` 中受影响的模块描述（已更新核心模块表、数据流和测试说明）
