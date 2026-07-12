## 为什么

在线阅读器中，用户拖动底部进度条快速跳转（如从首页拖到中后段）后，松手时目标页及其相邻页加载明显滞后，肉眼可见地"仍在按从首页开始的顺序加载"，要等数秒目标页才出现。

根因是双层的资源占用无法回收：

1. **前端假中断**：`usePreloadManager` 在 `preloadTarget` 变化时通过 `cancelled = true` 停止 worker 循环取下一页，但已通过 `fetchPreviewImage` IPC 提交的请求无法取消——它们仍占用后端线程槽。
2. **后端 FIFO 无优先级**：`_preview_executor`（`ThreadPoolExecutor(max_workers=4)`）对所有 `fetch_preview_image` 先来先服务。首页那批残留请求堵满 4 个槽位，目标页的新请求只能在后端排队，直到旧请求逐一跑完。

`paginated-preload-interruption` 规范已为搜索页的 `usePaginatedPreloader` 解决了同型问题，但阅读器的 `usePreloadManager` 没有对等机制，且每页是真实大图下载，槽位被占满即为秒级阻塞，用户感知强烈。

## 变更内容

- **前端 worker pool 整体重排队**：`preloadTarget` 变化（松手触发的 `onDragEnd`）时，现有 worker pool 必须立刻丢弃旧队列、以目标页为中心重建队列，并确保前端不再向已被旧 target 驱动的页发新请求。拖动过程**不**改变 target（保持现有冻结行为）。
- **后端预览线程池引入优先级调度**：`_preview_executor` 从纯 `ThreadPoolExecutor` 改为支持优先级的调度——新到的目标页请求必须能排到旧的、已不再被前端 target 驱动的请求之前，而不是在 FIFO 队列尾部等待。
- **后端可取消已排队未开始的请求**：前端在 target 切换时，通过新的取消通道告知后端"这批旧请求前端已不关心"，后端应跳过仍排在队列里、尚未被 worker 取走的请求，尽快把槽位让给目标页请求。已在执行（worker 已取走、正在网络下载）的请求按尽力而为处理。
- **IPC 协议扩展**：`fetch_preview_image` 增加优先级/批次标识参数；新增取消 IPC（或复用现有取消信号机制），供前端在 target 切换时回收后端排队中的请求。

## 功能 (Capabilities)

### 新增功能
- `reader-jump-preload-priority`: 在线阅读器进度条跳转后，目标页及其相邻页必须获得预加载优先级——前端 worker pool 立刻重排队到目标页，后端预览线程池优先服务目标页请求并取消已被前端抛弃的排队请求。

### 修改功能
<!-- 无现有 capability 的需求发生规范级变更。reader-image-cache（缓存契约）与 reader-progress-navigation（进度条导航）的行为契约不变；本变更新增的是预加载优先级维度，此前未被任何 spec 覆盖。 -->

## 影响

- **前端**：`src/hooks/usePreloadManager.ts`（worker pool 重排队 + 取消协调）、`src/components/ComicReaderModal.tsx`（`onDragEnd` → `setPreloadTarget` 路径接入取消通道）、`src/hooks/useReaderProgressNavigation.ts` / `useSliderDrag.ts`（无逻辑变更，仅数据流下游消费）。
- **IPC 协议**：`shared/types.ts`（新增取消通道常量 + `fetchPreviewImage` 优先级参数类型）、`electron/preload.ts`（暴露取消 API + 传递优先级）、`electron/python-bridge.ts`（如有请求 ID 追踪需求）。
- **Python 后端**：`python/ipc_server.py`（`_preview_executor` 改造为优先级调度、新取消方法注册）、`python/ipc/preview_mixin.py`（`_do_fetch_preview_image` / `_async_fetch_preview_image` 接收优先级与批次标识）、`python/ipc/types.py`（池配置常量可能调整）。
- **测试**：新增前端 worker pool 重排队与后端优先级调度的单测 + 跨边界集成测试（守护"旧请求不堵新目标页"的核心契约）。
- **关联规范**：与 `paginated-preload-interruption`（搜索页中断）形成对称但独立的阅读器侧中断/优先级语义；与 `reader-image-cache`（缓存命中）协同——优先级调度产生的结果仍走共享缓存。
