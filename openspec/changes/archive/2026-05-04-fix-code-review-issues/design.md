## 上下文

代码审查发现多个 Clean Code 问题，集中在函数过长、逻辑重复、魔法数字、命名不清和类型模糊等方面。当前代码虽然功能正确，但关键路径（下载任务处理、漫画详情解析）的函数过长，增加了理解和维护成本。本次设计目标是在不改变任何外部行为的前提下，通过系统性重构提升代码可读性和可测试性。

## 目标 / 非目标

**目标：**
- 将 `_process_task` 和 `get_comic_detail` 分解为职责单一的小函数（≤50 逻辑行）
- 消除 `update_card_colors` 的跨文件重复
- 将分散的魔法数字提取为模块级常量
- 用 Protocol 替代 `Any` 类型提示
- 改进模糊的方法命名

**非目标：**
- 不添加新功能或修改用户可见行为
- 不修改数据模型（`ComicInfo`、`DownloadTask` 等）
- 不引入新的外部依赖
- 不修改 API 接口或配置格式

## 决策

### 决策 1：在 `download_manager.py` 中提取 4 个私有方法
- **选择**：`_execute_download(task)`、`_handle_download_success(task, result)`、`_handle_download_failure(task, exception)`、`_attempt_auto_retry(task)`
- **理由**：`_process_task` 混合了下载执行、成功处理、失败处理、自动重试、临时目录清理等多种职责。按结果路径拆分后，每个方法只有一个退出点和单一职责，且消除了四处重复的重试逻辑。
- **替代方案**：创建独立的策略类（`DownloadResultHandler`）—— 过度设计，当前规模不需要额外的类抽象。

### 决策 2：将 `update_card_colors` 提取到 `theme_bridge.py`
- **选择**：在 `theme_bridge.py` 中创建 `apply_theme_to_card_frame(frame, theme_manager)` 函数
- **理由**：`theme_bridge.py` 已经是主题配置的单一职责模块，且 `gui_app.py` 和 `search_controller.py` 都已经导入或依赖它。集中后避免了“改一处漏一处”的风险。
- **替代方案**：新建 `theme_applier.py` —— 增加了模块数量，而 `theme_bridge.py` 已经承担类似职责。

### 决策 3：合并 `download_comic` 与 `download_comic_resume`
- **选择**：保留 `download_comic_resume` 作为唯一入口（返回 `DownloadResult`），将原 `download_comic` 改为调用它的兼容性别名，或完全移除由调用方处理异常。
- **理由**：原 `download_comic` 唯一的额外行为是 `if not result.success: raise DownloadError(...)`。调用方（`DownloadController._continue_single_download` 和 `ComicDownloadManager._process_task`）都已准备好处理异常或检查 `DownloadResult`。移除薄包装减少了 API 表面积。
- **替代方案**：保留两个方法 —— 保持现状会增加维护负担，且两者签名高度重复。

### 决策 4：用局部 Protocol 替代 `Any`
- **选择**：在 `auth_manager.py` 顶部定义 `ParserAuthLike` 和 `DownloaderAuthLike` 两个 Protocol，各包含实际使用的方法。
- **理由**：`AuthManager` 实际上只依赖 parser 的 `configure_auth`/`verify_login_status` 和 downloader 的 `configure_auth`。Protocol 在不引入实际依赖的情况下恢复类型安全。
- **替代方案**：直接导入 `MultiSourceParser` 和 `ComicDownloader` —— 增加了模块耦合，且 `AuthManager` 的设计意图是解耦的。

## 风险 / 权衡

- [函数拆分引入行为偏差] → 缓解措施：拆分后保持原有的异常处理顺序、锁操作范围、回调触发时机不变；运行现有测试验证。
- [删除 `download_comic` 破坏外部调用者] → 缓解措施：检查仓库内所有调用者（仅 `DownloadController` 和 `ComicDownloadManager`），确认均已适配 `DownloadResult` 模式后再移除。
- [常量提取后命名不一致] → 缓解措施：常量命名遵循 `SCREAMING_SNAKE_CASE`，前缀体现所属领域（`SCROLL_`、`PANEL_`、`COVER_`）。
