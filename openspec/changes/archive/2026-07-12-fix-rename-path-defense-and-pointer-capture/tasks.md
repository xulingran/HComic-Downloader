## 1. 后端：rename 路径防御纵深

- [x] 1.1 在 `_rename_library_asset`（`python/ipc/library_mixin.py`）构造 `new_abs_path` 后，先 `resolved = os.path.realpath(new_abs_path)`，再断言 `resolved == root or resolved.startswith(root + os.sep)`，否则抛 `ValueError("新名称无效")`；校验在 `os.path.exists` 冲突检查之前
- [x] 1.2 在 realpath 断言后比较 `resolved == os.path.realpath(real_path)`，相等则抛 `ValueError("新名称与原名相同")`，替换原「目标名称已存在」对该场景的误报
- [x] 1.3 将 `_rename_library_asset` 异常分支 `raise ValueError(f"重命名失败，已回滚: {e}")` 改为固定文案 `raise ValueError("重命名失败，已回滚") from e`，原始异常用 `logger.warning("rename failed: %s", e, exc_info=True)` 记录；同样收敛 `handle_library_edit_metadata` 的 `raise ValueError(f"元数据写回失败: {e}")`
- [x] 1.4 `tests/test_ipc_library.py` 新增用例：(a) 目标路径经 realpath 落在 download_dir 之外时拒绝、源文件不动；(b) 清洗后新名称等于原名时返回「新名称与原名相同」；(c) rename 失败时返回给前端的消息不含 download_dir 绝对路径

## 2. 前端：useSliderDrag 卸载释放 pointer capture

- [x] 2.1 在 `src/hooks/useSliderDrag.ts` 新增 `pointerIdRef = useRef<number | null>(null)`，在 `handleSliderPointerDown` 的 `setPointerCapture(e.pointerId)` 处同步记录 `pointerIdRef.current = e.pointerId`，在 `handleSliderPointerUp` 释放后置 `null`
- [x] 2.2 新增卸载 cleanup effect（空依赖数组）：组件卸载时若 `isDraggingRef.current && sliderRef.current && pointerIdRef.current !== null`，则 `try { sliderRef.current.releasePointerCapture(pointerIdRef.current) } catch { /* 元素已脱离 DOM */ }`，随后复位 `isDraggingRef.current = false`、`setIsDragging(false)`、`dragPageRef.current = 0`、`pointerIdRef.current = null`
- [x] 2.3 `tests/unit/hooks/useSliderDrag.test.tsx` 新增用例：触发 pointerdown 进入拖动 → 不触发 pointerup 直接 unmount → 断言 `sliderRef.current.releasePointerCapture` 被以记录的 pointerId 调用一次，且 `isDragging` 复位为 false

## 3. 验证

- [x] 3.1 `pytest tests/test_ipc_library.py -q` 通过
- [x] 3.2 `npm test -- useSliderDrag` 通过
- [x] 3.3 `npm run lint:py && npm run format:py && npx tsc --noEmit && npm run lint && npm run lint:test-quality` 全绿
