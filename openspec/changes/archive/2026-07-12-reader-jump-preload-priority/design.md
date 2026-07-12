## 上下文

在线阅读器（`ComicReaderModal`）的预加载链路：

- 前端：`usePreloadManager` 维护一个 `preloadTarget` 和 worker pool（默认 `concurrency=3`），围绕 target 用 `buildPreloadQueue` 构造 `[target+1..target+forward]` + `[target-1..target-backward]` 的队列，worker 逐页调 `window.hcomic.fetchPreviewImage(url, scrambleId, comicId, imageQuality)` 并把结果写入共享 `imageCacheRef`。
- 后端：`fetch_preview_image` 经 `ipc_server` 分发到 `_preview_executor`（`ThreadPoolExecutor(max_workers=4)`），每个 worker 执行 `_do_fetch_preview_image`（缓存读 / 网络抓图 / jm 反混淆 / 落盘）。

拖动进度条时，`useReaderProgressNavigation` + `useSliderDrag` 通过 `onDragEnd(page) → setPreloadTarget(page)` 仅在松手时更新 target。`usePreloadManager` 的 effect cleanup 把 `cancelled=true`，停止 worker 循环取下一页；effect 重启后以新 target 重建队列。

**问题**：`cancelled=true` 是"前端假中断"——它只阻止 worker 继续取队列下一页，但已通过 IPC 提交的请求在后端继续执行。后端 `_preview_executor` 是 FIFO，首页那批残留请求占满 4 个 worker 槽位，目标页的新请求只能排队等旧请求逐一跑完（每页典型 200ms~2s，8 个残留页可造成 1.5~4 秒可见阻塞）。用户从首页拖到中后段时尤为明显。

现状 IPC 层**无 per-request 取消通道**：`cancel_download`/`cancel_album` 等都是任务级语义取消，无法针对单个 `fetch_preview_image` 请求。本变更需新建一条预加载批次取消通道。

## 目标 / 非目标

**目标：**
- 松手触发 `setPreloadTarget` 后，目标页及其相邻页（由现有 `forward`/`backward` 参数界定的 ±窗口）必须在后端获得优先服务，可见加载延迟接近"无残留"基线。
- 前端 worker pool 在 target 切换时立刻丢弃旧队列、以新 target 为中心整体重排队（不采用"紧急通道绕过 worker pool"的旁路方案）。
- 后端在收到 target 切换信号时，跳过仍排在队列里、尚未被 worker 取走的旧请求，把槽位尽快让给目标页请求；已在执行（worker 正在网络下载）的旧请求按尽力而为处理，不强制中断网络流。
- 拖动过程中 target 保持冻结（现有行为不变），不在拖动中预热目标页。

**非目标：**
- 不改变 `reader-image-cache` 的缓存命中契约——优先级调度产生的结果仍写入共享缓存，切换显示模式时复用。
- 不改变 `reader-progress-navigation` 的进度条交互语义——冻结/释放时序、`freezePageTracking` 行为不变。
- 不为搜索页 `usePaginatedPreloader` 复用本机制（已有独立的 `paginated-preload-interruption` 规范覆盖）。
- 不引入"拖动中跟随预热"（已明确排除）。
- 不强制中断后端已在执行中的网络下载流（Python `ThreadPoolExecutor` + `requests` 无干净的流级取消，强行中断成本高于收益）。
- 不改变 `_PREVIEW_POOL_MAX_WORKERS=4` 的池容量（优先级 + 排队取消已足够解决阻塞）。

## 决策

### 决策 1：前端 worker pool 整体重排队（不引入紧急通道旁路）

**选择**：`preloadTarget` 变化时，现有 effect 的 `cancelled=true` 机制保留（停止旧 worker 取下一页），effect 重启后以新 target 重建队列并启动新 worker pool。这是现有设计的自然延伸，无需新增并行加载通道。

**理由**：用户已明确选择"整个 worker pool 立刻重新排队到目标页"。紧急通道旁路会引入两条加载链路（worker pool + 旁路）的协调复杂度、共享缓存的并发写竞争，且仍受后端 4 槽瓶颈约束——治标不治本。整体重排队 + 后端优先级（决策 2/3）才是端到端解。

**替代方案**：
- *前端紧急通道*：松手时对目标页 ±N 直接发并发请求，绕过 worker pool。否决——两条加载链路协调复杂，且后端 FIFO 仍是瓶颈。
- *拖动中节流跟随 target*：否决——用户已明确排除。

### 决策 2：后端 `_preview_executor` 改为优先级调度（`PriorityQueue` + 自管 worker）

**选择**：用一个 `queue.PriorityQueue` 替换 `ThreadPoolExecutor` 的内部 FIFO 队列，配 N 个自管 worker 线程（N=4，保持现有容量）。请求以 `(priority, sequence)` 元组入队：目标页请求 `priority=0`（高），普通预加载请求 `priority=1`（低）。同优先级按入队顺序（`sequence` 递增单调计数器）。

**理由**：Python 标准库 `ThreadPoolExecutor` 的队列为私有 `SimpleQueue`，无法注入优先级。自管 worker + `PriorityQueue` 是标准做法，可控且可测试。元组比较中 `sequence` 保证同优先级 FIFO、避免同优先级页之间的饿死。

**替代方案**：
- *第三方库 `priority-executor`*：否决——引入新依赖，项目当前 Python 依赖克制。
- *增大池容量（max_workers=16）*：否决——治标，残留请求仍会先跑完，且并发抓图可能触发源站限流。
- *保持 FIFO，仅前端发更少请求*：否决——无法解决"已发出的旧请求堵槽位"。

### 决策 3：前端 → 后端的"批次取消"通道

**选择**：引入一个 generation（代）计数器，每次 `preloadTarget` 切换时前端代数 +1。`fetch_preview_image` IPC 增加 `generation` 参数。后端维护"当前活跃 generation"（由前端在 target 切换时通过新增的 `set_preview_generation` IPC 推送，或随每次 `fetch_preview_image` 携带并在入队时比对）。

采用**入队时比对 + worker 取出时二次校验**的轻量方案：
- `fetch_preview_image(generation=g)` 入队时，把 `(priority, seq, generation=g, task)` 放入 `PriorityQueue`。
- worker 从队列取出任务后，先比对 `g` 与后端记录的"最新已取消代数下界"：若 `g < current_cancelled_floor`，说明该请求属于已被前端抛弃的旧代，直接丢弃（回写空结果或 error，前端 worker 因 `cancelled=true` 也会丢弃），不执行真实下载。

**取消信号传递**：新增 `cancel_preview_generations(before: number)` IPC。前端在 `setPreloadTarget` 触发新代时调用它，后端把 `current_cancelled_floor = max(current_cancelled_floor, before)`。worker 取出任务时若 `task.generation < current_cancelled_floor` 则跳过。

**理由**：这是 `paginated-preload-interruption` 规范"signal.aborted 检查"在阅读器侧的对称实现，但适配了线程池模型（Python 端无法对 `ThreadPoolExecutor` future 做 cooperative cancel）。generation 单调递增、worker 取出时校验，是最低成本的"跳过已排队旧请求"——已执行中的请求（worker 已取出并开始下载）不中断，但它们跑完释放的槽位会被优先级队列里的目标页请求立即占用。

**替代方案**：
- *完整 future.cancel() + 网络流中断*：否决——`requests` 流式下载的中断需要把 `session.get` 改成可中断形态，改动面大、风险高，且对已接近完成的下载是浪费。
- *前端不通知后端，纯靠优先级*：部分可行，但目标页请求仍可能排在旧代请求之后（若旧代 priority 也被设为 0）。generation 显式取消让"旧代整体降级"语义清晰。

### 决策 4：优先级如何确定（目标页 vs 目标页邻居 vs 普通预加载）

**选择**：
- 前端 `buildPreloadQueue` 已产出有序队列（target 邻居按距离排序）。前端在调 `fetchPreviewImage` 时根据"页与 target 的距离"传递 `priority`：target±1~2 为 `priority=0`（最高），更远的为 `priority=1`。或简化为：**所有由当前 target 驱动的请求 priority=0，旧代（generation < current）请求在 worker 取出时直接跳过**。
- 采用简化版：优先级只区分"当前代"与"旧代"二态。当前代内仍按 `buildPreloadQueue` 的入队顺序（前端 worker 顺序消费）服务，因为前端 worker 的消费顺序已经是"距离 target 由近及远"。

**理由**：`buildPreloadQueue` 已保证前端发请求的顺序就是"目标页 → 远页"，后端只需保证"旧代不堵新代"即可让目标页先得服务。引入细粒度距离优先级会让优先级队列的比较开销与维护复杂度上升，收益边际。

**替代方案**：
- *细粒度距离优先级（|page-target| 越小 priority 越高）*：否决——前端入队顺序已编码距离，后端细粒度优先级冗余。

### 决策 5：后端代数与取消下界的并发安全

**选择**：`current_cancelled_floor` 用 `threading.Lock` 保护（worker 读、IPC handler 写）。`PriorityQueue` 本身线程安全。worker 取出任务后的 generation 比对在锁内读取 floor 后比对，避免 TOCTOU。

**理由**：锁开销远小于一次图片下载，可接受。

### 决策 6：generation=0 是保留的"当前页加载"代，永不被取消（故障后补）

**选择**：worker 跳过条件为 `generation > 0 且 generation < cancelled_floor`。叶子组件（`ReaderPage` / `PageFlipView`）加载用户正在看的当前页时不传 generation，后端缺省解析为 0；generation=0 永远不进入跳过判定。

**理由**：首版实现用 `generation < floor` 作跳过条件，导致整本漫画无法加载——`usePreloadManager` 首次 target 设置即推进 floor 到 1，而叶子组件的当前页请求 generation=0 < 1 全部被跳过。当前页加载是最高优先级、不参与预加载代际机制的调用方，必须为其保留安全出口。generation=0 作为缺省值，语义应是"无优先级约束"而非"最旧、最先取消"。

**替代方案**：
- *让叶子组件也传 generation*：否决——`ReaderPage`/`PageFlipView` 不感知 `usePreloadManager` 的代数状态，强耦合违背组件分层；且当前页加载本就不应被任何预加载取消。
- *floor 从 2 起步（跳过 generation=0/1）*：否决——魔数脆弱，不如显式 `generation > 0` 守护语义清晰。

## 风险 / 权衡

**[已排队旧请求被丢弃后，前端 worker 拿不到结果会怎样？]** → 前端 worker pool 在 target 切换时已 `cancelled=true`，旧 worker 循环本就不会处理迟到结果；后端跳过旧代请求只是加速槽位释放，前端语义不变。即使后端"回写空结果"被前端旧 worker 收到，`cancelled=true` 也会丢弃。无脏写风险（共享缓存的写入仍受 `markCached` 去重保护）。

**[generation 计数器的前后端同步偏差]** → generation 仅由前端单点递增（`usePreloadManager` 内），后端只接收并比对。前端发 `fetch_preview_image(g=5)` 后立即发 `cancel_preview_generations(before=5)` 的窗口里，g=5 的请求可能已被 worker 取出并开始下载——这是"已执行中"范畴，按尽力而为不中断，可接受（最多 1 个旧请求跑完）。

**[PriorityQueue 自管 worker 的稳定性]** → 需正确处理 worker 退出信号（进程关闭时 `shutdown`）。现有 `_preview_executor.shutdown(cancel_futures=True)` 需替换为等价的自管 worker 关停（sentinel 入队 + join）。回归测试须覆盖优雅关闭路径。

**[优先级队列的队头阻塞]** → 若目标页请求（priority=0）对应的网络下载很慢，会占住一个 worker 槽，其余 priority=0 请求排在后面。但这正是期望行为（目标页就该先得服务），且 4 槽并发足以覆盖 target±窗口。

**[向后兼容：旧前端 + 新后端 / 新前端 + 旧后端]** → `fetch_preview_image` 的 `generation` 参数可选（缺省解析为 0，即"当前页加载"保留代，priority=0，**永不被取消**——见决策 6）；`cancel_preview_generations` IPC 缺失时前端 try/catch 静默。避免硬性版本耦合（dev 环境前后端可能短暂不一致）。

**[取消机制误伤未参与的调用方（已发生并修复）]** → 首版实现的跳过条件 `generation < floor` 曾导致整本漫画无法加载：叶子组件（`ReaderPage`/`PageFlipView`）加载当前页时不传 generation（后端缺省 0），而 `usePreloadManager` 首次推进 floor 到 1，`0 < 1` 把当前页请求全跳过。修复为 `generation > 0 且 generation < floor`，generation=0 永不取消。回归测试 `test_generation_zero_is_never_skipped` 守护此契约。**教训：优先级/取消机制必须为未参与该机制的调用方（缺省 generation=0）保留安全出口。**

**[测试复杂度上升]** → 后端优先级调度是并发代码，需用 `queue.PriorityQueue` + mock 慢下载（deferred）验证"旧代被跳过、新代先服务"。集成测试须跨 IPC 边界守护核心契约，参考 `paginated-preload-interruption` 的集成测试范式。

## 迁移计划

无数据迁移。变更纯运行时行为：
1. 后端 `_preview_executor` 替换为 `PriorityPreviewExecutor`（自管 worker + PriorityQueue），保持对外 `submit` 接口形态。
2. 新增 `cancel_preview_generations` IPC handler 与 `fetch_preview_image` 的 `generation` 参数。
3. 前端 `usePreloadManager` 维护 generation ref，每次 target 切换 +1，调 `cancel_preview_generations` 并在 `fetchPreviewImage` 传 generation。
4. 前端 `ComicReaderModal` 的 `onDragEnd → setPreloadTarget` 路径接入 generation 推进。

回滚：还原 `_preview_executor` 为 `ThreadPoolExecutor`，移除 generation 参数与 IPC handler，前端调用降级为不传 generation（后端按 FIFO 处理）。无持久状态残留。
