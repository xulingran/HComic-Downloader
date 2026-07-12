## 1. IPC 协议与类型契约

- [x] 1.1 在 `shared/types.ts` 新增 IPC 通道常量 `CANCEL_PREVIEW_GENERATIONS`（`python:cancel-preview-generations`），并在 `IpcChannelMap` / `PythonNotifications`（如需）中定义其 params（`{ before: number }`）与 result（`{ cancelled_floor: number }`）类型
- [x] 1.2 在 `shared/types.ts` 扩展 `fetch_preview_image` 的 params 类型，新增可选 `generation?: number` 字段（缺省视为当前代，向后兼容）
- [x] 1.3 在 `electron/preload.ts` 暴露 `cancelPreviewGenerations(before: number): Promise<{ cancelledFloor: number }>` API，并让 `fetchPreviewImage` 接收可选 `generation` 参数透传到 IPC

## 2. 后端优先级调度与代数取消

- [x] 2.1 新建 `python/ipc/preview_executor.py`，实现 `PriorityPreviewExecutor` 类：基于 `queue.PriorityQueue` + N 个自管 worker 线程（N=`_PREVIEW_POOL_MAX_WORKERS`=4），任务项为 `(priority, sequence, generation, task_callable)`；提供 `submit(priority, generation, fn, *args, **kwargs)`、`advance_cancelled_floor(before)`、`shutdown(wait, cancel_futures)` 接口，形态对齐 `ThreadPoolExecutor` 以最小化调用方改动
- [x] 2.2 worker 主循环：从 PriorityQueue 取出任务后在锁内读取 `current_cancelled_floor`，若 `task.generation < current_cancelled_floor` 则跳过执行（直接回写空/error 结果或仅丢弃），否则执行 `task_callable`；收到 shutdown sentinel 时退出
- [x] 2.3 在 `python/ipc_server.py` 用 `PriorityPreviewExecutor` 替换 `_preview_executor` 的 `ThreadPoolExecutor`；更新 `shutdown` 路径（sentinel 入队 + worker join）保持优雅关闭语义
- [x] 2.4 在 `python/ipc_server.py` 的 `fetch_preview_image` 分发分支读取 `generation` 参数（缺省置为当前 floor，视为活跃代），按 `priority=0`（当前代）submit 到 `_preview_executor`；注册 `cancel_preview_generations` 方法到 dispatch 表
- [x] 2.5 在 `python/ipc/preview_mixin.py`（或 `python/ipc_server.py`）实现 `handle_cancel_preview_generations`：读取 `params.before`，调 `_preview_executor.advance_cancelled_floor(before)`，回写 `{ cancelled_floor }`

## 3. 前端 generation 推进与取消协调

- [x] 3.1 在 `usePreloadManager` 内新增 `generationRef`（useRef，初始 0）；每次 `preloadTarget` 切换（effect 重启时）+1 并把当前值收入 ref 供 worker 闭包读取（避免 effect 依赖抖动，对齐现有 `paramsRef` 模式）
- [x] 3.2 在 `usePreloadManager` 的 worker 循环中，调用 `window.hcomic.fetchPreviewImage(url, scrambleId, comicId, imageQuality, currentGeneration)` 时携带 generation；在 effect cleanup（`cancelled=true`）旁，于 effect 重启入口处调用 `window.hcomic.cancelPreviewGenerations(newGeneration)`（try/catch 静默）
- [x] 3.3 `clearCache`（换章/关闭 modal）时同步重置 generation 到 0 并调 `cancelPreviewGenerations(1)` 清空后端旧代排队请求
- [x] 3.4 验证 `ComicReaderModal` 的 `onDragEnd → setPreloadTarget` 路径无需额外改动即驱动 generation 推进（target 叇化 → effect 重启 → generation+1）；确认拖动中（`isDragging`）effect 不触发（现有 `if (isDragging) return` 闸门已保证）

## 4. 测试

- [x] 4.1 后端单测：`PriorityPreviewExecutor` 的 PriorityQueue 排序、generation 跳过、advance_cancelled_floor 单调性、shutdown 路径（覆盖 `tests/` 既有 Python 测试风格，用 deferred/slow task 模拟慢下载验证旧代被跳过）
- [x] 4.2 后端单测：`handle_cancel_preview_generations` 正确推进 floor 并回写；`fetch_preview_image` 缺省 generation 的向后兼容行为
- [x] 4.3 前端单测：`usePreloadManager` target 切换时 generation 递增、worker 携带新 generation、`cancelPreviewGenerations` 被调用且失败静默、`clearCache` 重置 generation
- [x] 4.4 跨 IPC 边界集成测试（守护 spec"跳转后目标页先于旧代排队请求完成"场景）：mock `fetchPreviewImage` 与 `cancelPreviewGenerations`（deferred 控制完成时机），模拟首页预加载占用槽位 → 跳转到目标页 → 断言目标页邻居 urlHash 先写入 `imageCacheRef`，旧代排队请求不先完成
- [x] 4.5 回归守护测试：模拟"删除优先级调度还原 FIFO"（如后端测试中临时注入纯 FIFO executor），断言 4.4 场景失败——验证集成测试能捕获核心契约被无声还原
- [x] 4.6 正常翻页回归：无跳转的连续翻页路径预加载不受优先级机制误伤（目标页邻居正常写入缓存、无丢请求）
- [x] 4.7 【故障修复】generation=0 保留代守护：worker 跳过条件改为 `generation > 0 且 generation < floor`，叶子组件当前页加载（缺省 generation=0）永不被取消；新增 `test_generation_zero_is_never_skipped` 回归测试（floor=100 时 gen=0 任务仍执行）

## 5. 验证

- [x] 5.1 `pytest`（含新增测试，`-m 'not smoke'` 加速可选）
- [x] 5.2 `npx tsc --noEmit`
- [x] 5.3 `npm test`
- [x] 5.4 `npm run lint:py` + `npm run format:py`
- [x] 5.5 `npm run lint`
- [x] 5.6 `npm run lint:test-quality`
- [x] 5.7 `openspec-cn validate reader-jump-preload-priority --strict`（确认 spec/产出物合规）
- [x] 5.8 【故障修复后重验】pytest（1285 passed）、tsc、npm test（1747 passed）、lint/format/test-quality 全绿；端到端模拟确认当前页（gen=0）+ 预加载（gen=1）均正确加载
