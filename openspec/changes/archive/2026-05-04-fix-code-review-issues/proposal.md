## 为什么

Pragmatic Clean Code 审查（L3 Team 级别）发现代码库存在函数过长、逻辑重复、魔法数字泛滥、类型提示缺失等问题。本次变更聚焦 2 个 Critical 和 6 个 Important/Must-Fix 问题，通过提取方法、消除重复、集中常量、改进命名等方式提升可维护性。所有改动均为纯重构，不改变外部行为。

## 变更内容

1. **分解 DownloadManager._process_task**（download_manager.py）：将 ~120 行的巨型方法拆分为 `_execute_download`、`_handle_download_success`、`_handle_download_failure`、`_attempt_auto_retry` 等小函数，消除 4 处重复的重试逻辑。
2. **分解 MoeImgParser.get_comic_detail**（parser.py）：将 ~70 行的详情获取方法拆分为数据获取、图片解析、信息组装三个阶段。
3. **消除 update_card_colors 重复**（gui_app.py + search_controller.py）：将两处完全相同的卡片主题着色逻辑提取到 `theme_bridge.py` 的独立函数中。
4. **合并 download_comic 与 download_comic_resume**（downloader.py）：移除仅有异常包装差异的薄包装方法，统一返回 `DownloadResult`。
5. **提取魔法数字为具名常量**：将滚动延迟（120ms）、进度节流（0.1s）、面板动画时长（180ms）等分散的魔法数字集中到对应模块的常量中。
6. **清理 gui.py __all__ 导出**（gui.py）：移除不应导出的 `os` 和 `threading`。
7. **AuthManager 类型提示精确化**（auth_manager.py）：将 `Any` 替换为自定义 `Protocol`，明确依赖边界。
8. **简化 _lookup_entity_id_from_search 复杂度**（parser.py）：添加搜索上限、提前退出，并添加复杂度说明注释。
9. **命名改进**：`_w()` → `_get_search_widgets()`、`_dc()` → `_get_download_callbacks()`。

## 功能 (Capabilities)

### 新增功能

无。本次变更是纯重构，不引入新功能。

### 修改功能

无。所有改动都是实现层面的清理，不改变规范级行为。

## 影响

- **代码文件**：download_manager.py, parser.py, gui_app.py, search_controller.py, downloader.py, gui.py, auth_manager.py, theme_bridge.py, scroll_handler.py, cover_loader.py, animation.py
- **测试文件**：现有测试应继续通过（纯重构）
- **行为变化**：无
- **依赖**：无新增依赖
