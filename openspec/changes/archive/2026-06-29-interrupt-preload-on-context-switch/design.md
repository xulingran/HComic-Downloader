## 上下文

`usePaginatedPreloader`（`src/hooks/usePaginatedPreloader.ts`）是搜索页 / 收藏页 / 历史页共用的相邻页预加载 hook。它在结果侧有两层防脏 commit 的机制：

1. `contextKey` effect：`contextKey` 变化时 `generationRef += 1` + 清空 `inFlightRef` / `pendingPagesRef`。
2. main effect：`contextKey` 在依赖数组中，变化时旧 `state.cancelled = true`，drain 内 `commitPage` / `onPreloadError` 都被 `!state.cancelled && generation === current` 双重门控。

**缺陷点**：上面两层都只 gate **commit**（hook 内部的 `commitPage` 回调），但 `loadPage`（页面传入的 `preloadSearchPage` / `preloadFavouritesPage`）回调体里：

```
await search(...)              // 旧上下文请求仍在网络层挂起
preloadedPagesRef.set(...)     // ← 完成后无条件写入，越过同帧的 preloadedPagesRef.clear()
```

`loadPage` 既不消费任何中断标记，IPC 层（`useIpc.ts` 薄封装）也无 `AbortSignal` 透传。后果：旧上下文迟到完成的请求 (1) 越过 `clear()` 写脏数据；(2) 在网络层继续跑、与新请求争抢带宽。

约束：方案 B 范围——仅 JS 层中断 + 结果丢弃，**不改** Python `ipc_server`、不改 IPC 类型契约、不做端到端 `AbortSignal` 透传。

## 目标 / 非目标

**目标：**
- `contextKey` 变化（切换来源 / 查询词 / 标签 / 模式）或组件卸载时，所有 in-flight 预加载请求在 JS 层被标记为已中断。
- `loadPage` 回调在 IPC `await` 完成后、写入 `preloadedPagesRef` 之前检查中断态，已中断则**丢弃结果**（不写 ref、不 commit）。
- 改动局限在 `usePaginatedPreloader` + 三个调用页的 `loadPage` 适配，无新依赖、不破 IPC 契约。

**非目标：**
- 真正的网络层中断（`ipcRenderer.invoke` 透传 signal、Python 端取消请求）—— 属方案 C，明确排除。
- 阅读器图片预加载（`usePreloadManager`）的中断—— 另一套独立 hook，不在本次范围。
- 修改 `list-loading-feedback` / `page-keep-alive` 规范定义的列表加载态行为。

## 决策

### 决策 1：中断机制用 `AbortController` 而非沿用 generation 计数

**选择**：在 hook 内维护一个按 `contextKey` 生命周期的 `AbortController`（`abortControllerRef`），`contextKey` 变化 / 卸载时 `abort()` 并新建；`loadPage` 签名扩展为 `(page, reason, signal) => Promise<void>`。

**为什么**：
- 现有 `generationRef` 是 hook 内部状态，向 `loadPage` 回调暴露会泄漏 hook 实现细节并要求调用方手写 `if (gen !== currentRef) return`——侵入性大且易写漏。
- `AbortController` 是浏览器原生、零依赖、语义自洽的标准中断原语；`signal.aborted` 是布尔快照，`loadPage` 适配只需 `if (signal.aborted) return` 一行。
- 即便当前 IPC 层不消费 signal（方案 B），未来若升级到方案 C，`signal` 已就位可直接透传给 `invoke`/`fetch`——决策对前向路径友好。

**替代方案**：
- 暴露 generation 给调用方：被否（见上，侵入性 + 易错）。
- 把中断检查移进 hook 的 drain 内（`loadPage` 返回值再二次 gate）：被否——脏写发生在 `loadPage` **内部**的 `preloadedPagesRef.set`，hook 无法 gate 调用方闭包内的写入，必须由调用方在写入前自查。

### 决策 2：AbortController 粒度为「每个 contextKey 一个」，而非每请求一个

**选择**：drain 内所有并发请求共享同一 `signal`；`contextKey` effect 负责销毁旧 controller、创建新 controller。

**为什么**：
- 与现有 `generationRef`（每 `contextKey` 一次自增）的生命周期完全对齐，行为可推理。
- 批量 `abort()` 一次完成，开销 O(1) 命中所有 in-flight；每请求一个 controller 需要 map 管理 + 逐个 abort，复杂度无收益。
- pending 队列由 `pendingPagesRef.current = []` 清空，已 in-flight 的由共享 signal 统一中断——两层覆盖。

**替代方案**：
- 每请求一个 controller：被否（无额外能力，徒增状态管理）。
- 全局单 controller 跨 contextKey：被否——会误中断新 contextKey 的请求。

### 决策 3：保留现有 generation/commit 双层 gate，AbortController 作为补充而非替换

**选择**：不动 hook 现有的 `generationRef` / `state.cancelled` / commit gate 逻辑；AbortController 只负责让 `loadPage` 内部的写入提前终止。

**为什么**：
- commit gate 仍是有价值的安全网（防御 `loadPage` 适配遗漏 / 第三方调用方）；双重防御对 correctness 有利。
- 最小改动原则：只增量加中断通道，不重构已验证的核心循环，降低回归风险。
- `state` 仍需传给 drain，故保留 `state` 形状、仅在其外追加 signal 传递路径。

## 风险 / 权衡

- **[Python 端请求仍跑完浪费带宽]** → 方案 B 明确接受这一权衡；JS 层立即丢弃结果，用户可见响应（新上下文首屏）不再被旧请求阻塞。真正省带宽需方案 C，本次不做。后续若要升级，`signal` 参数已就位可直接透传。
- **[调用方忘记检查 `signal.aborted` 导致脏写]** → 三个调用方（Search / Favourites / History）的 `loadPage` 必须同步适配；tasks.md 将此列为硬性步骤，并由测试覆盖「迟到请求不写入」场景。
- **[AbortController 在旧环境缺失]** → Electron Chromium 内核原生支持，无 polyfill 风险；不涉及 web 浏览器目标。
- **[abort 后 pending/in-flight 状态一致性]** → `contextKey` effect 已清空 `pendingPagesRef` / `inFlightRef`；abort 信号让 drain 内 await 挂起的协程提前 return，finally 块里的 `inFlightRef.delete` 仍会执行但已无害（key 已被 clear）。
