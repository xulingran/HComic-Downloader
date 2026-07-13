## 为什么

本地库资产重命名（`rename_file=True`）构造目标路径后只依赖正则清洗兜底，缺少「结果仍位于漫画库根目录内」的防御纵深校验，与 reveal/delete 路径使用的 `_resolve_asset_path` 三重校验不一致。同时进度条拖拽 hook 在组件卸载时不释放 `setPointerCapture`，导致 keep-alive 场景重挂载后新滑块元素无法获得 pointer 事件。两者都是安全/交互缺陷，应在推送前修复。

## 变更内容

- 后端 `_rename_library_asset`：构造 `new_abs_path` 后，强制 `os.path.realpath` 解析并断言结果位于 `realpath(download_dir) + os.sep` 之下；并拒绝与原路径相同的重命名。失败时回滚历史，错误消息不透传内部 OS 路径。
- 前端 `useSliderDrag`：新增卸载 cleanup，组件卸载时若有未结束的拖拽则 `releasePointerCapture` 并复位 `isDraggingRef`/`isDragging`，避免 keep-alive 重挂载时遗留的 pointer 捕获。

## 功能 (Capabilities)

### 新增功能
无。

### 修改功能
- `library-asset-management`: 重命名文件路径必须经 realpath 边界校验，与 reveal/delete 的路径验证保持一致；内部错误不得透传渲染进程。
- `reader-progress-navigation`: 进度条拖拽在组件卸载时必须释放 pointer 捕获并复位拖拽态，保证 keep-alive 重挂载可正常交互。

## 影响

- `python/ipc/library_mixin.py`（`_rename_library_asset` realpath 校验 + 错误消息收敛）
- `src/hooks/useSliderDrag.ts`（卸载 cleanup）
- 测试：`tests/test_ipc_library.py` 新增越界/同名 rename 用例；`tests/unit/hooks/useSliderDrag.test.tsx` 新增卸载释放用例
