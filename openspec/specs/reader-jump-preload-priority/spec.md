# reader-jump-preload-priority 规范

## 目的

在线阅读器中，用户通过底部进度条快速跳转（如从首页拖到中后段）后，目标页及其相邻页必须获得预加载优先级——目标页应立刻被加载，而不是肉眼可见地"仍在按从首页开始的顺序加载"。

本规范定义跨前端 worker pool 重排队 → IPC 取消信号 → 后端优先级调度三层的契约：前端 `usePreloadManager` 在进度条跳转（松手触发的 `onDragEnd`）切换 `preloadTarget` 时，必须立刻以目标页为中心整体重排队并推进 generation；后端预览线程池必须按优先级服务请求并跳过已被前端抛弃的旧代排队请求；generation=0 是保留的"当前页加载"代，永不被取消下界跳过。

本规范源自归档变更 `reader-jump-preload-priority`。与 `paginated-preload-interruption`（搜索页中断）形成对称但独立的阅读器侧跳转优先级语义；与 `reader-image-cache`（缓存契约）协同——优先级调度产生的结果仍走共享缓存。
## 需求

### 需求:进度条跳转后预加载目标必须立刻重排队到目标页

当用户通过进度条拖动触发跳转（松手时 `onDragEnd` 调用 `setPreloadTarget(target)`），在线阅读器的预加载 worker pool **必须**立刻以 `target` 为中心整体重排队——丢弃旧 target 驱动的剩余队列、以 `buildPreloadQueue(target, forward, backward)` 重建队列并驱动新一批 worker。旧 worker 循环**必须**停止向旧队列继续取页发请求（现有 `cancelled=true` 语义），**禁止**让旧 target 的页继续占用前端发请求的窗口。

#### 场景:松手后 worker pool 以新 target 为中心重建队列

- **当** 用户拖动进度条从首页到第 N 页并在松手时触发 `onDragEnd(N)`，使 `preloadTarget` 从旧值切换为 N
- **那么** `usePreloadManager` 的 worker pool **必须**丢弃围绕旧 target 构造的剩余队列，并围绕 N 重新构造 `[N+1..N+forward]` + `[N-1..N-backward]` 队列驱动新 worker
- **且** 旧 worker 循环**必须**因 `cancelled=true` 停止取下一页，**禁止**继续为旧 target 的页发新的 `fetchPreviewImage` 请求

#### 场景:拖动过程中 target 保持冻结

- **当** 用户正在拖动进度条（`isDragging === true`），手指/指针经过中间页号
- **那么** `preloadTarget` **必须**保持不变（现有冻结行为）
- **且** **禁止**在拖动过程中为经过的中间页发起预加载或更新 `preloadTarget`
- **且** 只有松手（`onDragEnd`）才触发 target 切换

### 需求:预加载请求必须携带 generation 标识供后端判定新旧代

`usePreloadManager` **必须**维护一个单调递增的 generation（代）计数器。每次 `preloadTarget` 切换时 generation **必须** +1。前端调用 `fetchPreviewImage` 时**必须**携带当前 generation 值。后端**必须**据此判定该请求是否属于已被前端抛弃的旧代。

#### 场景:每次 target 切换推进 generation

- **当** `preloadTarget` 从旧值切换为新值（由 `onDragEnd` 触发）
- **那么** generation 计数器**必须**递增（旧值 + 1）
- **且** 此后所有新发出的 `fetchPreviewImage` 请求**必须**携带新的 generation 值

#### 场景:旧代请求携带旧 generation 值

- **当** `preloadTarget` 切换为第 3 代后，前端在第 1 代时已发出但尚未被 worker 循环取消的请求到达后端
- **那么** 这些请求携带的 generation 值为 1（小于当前代 3）
- **且** 后端据此可判定其为旧代请求

### 需求:后端预览线程池必须按优先级服务请求并跳过旧代排队请求

后端 `_preview_executor` **必须**从纯 FIFO 的 `ThreadPoolExecutor` 改为优先级调度——当前代（与前端最新 active generation 一致）的请求优先于旧代请求被 worker 取出执行。后端在收到前端 target 切换信号时，**必须**把"已取消代数下界"推进到新代，使仍排在队列里、尚未被 worker 取走的旧代请求在 worker 取出时被直接跳过、**禁止**执行真实图片下载。

#### 场景:目标页新代请求优先于旧代排队请求被服务

- **当** 后端预览线程池队列中同时存在旧代（generation=1）的排队请求与新代（generation=3，由跳转到目标页触发）的排队请求，且 worker 槽位有空闲
- **那么** worker **必须**优先取出并执行新代（generation=3）的请求
- **且** 旧代排队请求在 worker 取出时因 `generation < current_cancelled_floor` 被**直接跳过**，**禁止**执行其图片下载

#### 场景:已执行中的旧代请求不强制中断

- **当** 某旧代请求已被 worker 取出并开始执行网络下载（`_do_fetch_preview_image` 已进入 `_fetch_image_bytes`），随后前端推进 generation 使该请求成为旧代
- **那么** 后端**禁止**强制中断该请求的网络下载流（按尽力而为让其跑完释放槽位）
- **且** 该请求完成后释放的 worker 槽位**必须**被优先级队列中的新代请求立即占用

#### 场景:跳转后目标页邻居先于远端旧请求获得槽位

- **当** 用户从首页拖到第 50 页触发 target 切换，后端 4 个 worker 槽位中部分被首页代（generation=1）的残留请求占用，队列中已有目标页邻居请求（generation=2，第 51~58 页）
- **那么** 首页残留请求跑完释放的每个槽位**必须**立即被 generation=2 的目标页邻居请求占用
- **且** **禁止**让仍排队的 generation=1 旧请求先于 generation=2 请求被服务

### 需求:generation=0 是保留的"当前页加载"代，永不被取消下界跳过

叶子组件（`ReaderPage` / `PageFlipView`）加载用户正在看的当前页时调用 `fetchPreviewImage` **不携带 generation 参数**，后端 fast-path **必须**把缺省 generation 解析为 `0`。generation=0 是保留代——代表"未参与优先级机制的最高优先级当前页加载"。后端 worker 的跳过条件**必须**为 `generation > 0 且 generation < cancelled_floor`，**禁止**把 generation=0 的请求纳入取消范围。这一约束保证：即使前端 `usePreloadManager` 在首次 target 设置时推进 `cancelled_floor`，用户当前正在看的页面请求仍**必须**正常执行——否则会导致整本漫画当前页无法加载。

#### 场景:叶子组件当前页请求（generation=0）在 floor 推进后仍执行

- **当** `ReaderPage` 或 `PageFlipView` 为用户当前页发起 `fetchPreviewImage`（4 参数，不传 generation），后端缺省解析 generation=0 并 submit 到 `_preview_executor`；同时前端 `usePreloadManager` 首次 target 设置推进 `cancelled_floor` 到 1
- **那么** worker 取出该 generation=0 任务时**必须**执行（跳过条件 `generation > 0` 不满足）
- **且** **禁止**因 `0 < floor(1)` 而跳过——否则用户当前页永远加载不出来

#### 场景:删除 generation=0 守护时回归测试必须失败

- **当** 有人把 worker 跳过条件改回 `generation < floor`（移除 `generation > 0` 守护），运行本需求的回归测试
- **那么** "generation=0 任务在 floor 推进后仍执行"场景**必须**失败——这是该守护存在的根本理由：防止"当前页加载被预加载取消机制误伤"的故障无声复现

### 需求:前端必须在 target 切换时通知后端推进取消代数下界

`usePreloadManager` 在 `preloadTarget` 切换推进 generation 时，**必须**通过新增的 `cancel_preview_generations(before)` IPC 通知后端"所有 generation < before 的请求前端已不关心"。后端**必须**据此更新 `current_cancelled_floor`。该 IPC 调用**必须**容错——失败时静默忽略（不阻塞前端预加载流程）。

#### 场景:target 切换时推送取消信号

- **当** `preloadTarget` 切换使 generation 从 g 推进到 g+1
- **那么** 前端**必须**调用 `cancel_preview_generations(before=g+1)`（即取消所有 generation < g+1 的请求）
- **且** 后端收到后**必须**把 `current_cancelled_floor` 更新为 `max(current_cancelled_floor, g+1)`

#### 场景:取消 IPC 失败不阻塞预加载

- **当** `cancel_preview_generations` IPC 调用失败（后端版本不兼容、IPC 异常等）
- **那么** 前端**必须**静默忽略错误（try/catch）
- **且** 预加载流程**禁止**因此中断——新代请求仍正常发出，仅旧代清理退化为"尽力而为"

### 需求:跳转优先级机制必须有跨 IPC 边界的集成测试守护

跳转优先级的核心契约（"旧代排队请求不堵新代目标页请求"）跨越前端 generation 推进 → IPC 取消信号 → 后端优先级调度三层。该契约**必须**有跨 IPC 边界的集成测试守护，用真实的前端 generation 推进逻辑 + mock 后端下载（deferred 控制完成时机）组合验证。集成测试**禁止**仅断言 mock 被调用——**必须**断言真实可观察的行为：新代目标页请求先于旧代排队请求获得服务。

#### 场景:跳转后目标页先于旧代排队请求完成

- **当** 集成测试模拟首页预加载已占用后端 worker 槽位（旧代请求 in-flight 或排队中），随后触发跳转到第 N 页（推进 generation），新代目标页邻居请求入队
- **那么** 目标页邻居请求**必须**先于仍排队的旧代请求被服务（可观察为：目标页 urlHash 先写入共享缓存）
- **且** 旧代排队请求**禁止**先于目标页请求完成（即使它们先入队）

#### 场景:删除优先级调度时集成测试必须失败

- **当** 有人把后端 `_preview_executor` 还原为纯 FIFO（移除优先级与 generation 跳过逻辑），运行本需求的集成测试
- **那么** "跳转后目标页先于旧代排队请求完成"场景**必须**失败——这是集成测试存在的根本理由：守护优先级调度这一核心契约不被无声还原

#### 场景:正常预加载（无跳转）不受优先级机制误伤

- **当** 用户正常翻页（非进度条跳转），连续推进 target 但每次推进时前一批请求已完成、无旧代排队残留
- **那么** 预加载**必须**正常工作，目标页邻居请求正常写入共享缓存
- **且** 优先级与 generation 机制**禁止**对无竞争的正常路径产生可见延迟或丢请求
