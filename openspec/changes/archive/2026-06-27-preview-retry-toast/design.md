## 上下文

漫画预览（阅读器，`ComicReaderModal`）支持两种显示模式：

- **scroll 模式**：一次渲染所有 `<ReaderPage>`，每个组件独立加载图片，失败时本地有重试按钮
- **flip 模式**：通过 `<PageFlipView>` 只渲染当前可见页 `<FlipPage>`，失败时仅显示文字，**无重试入口**

两种模式的失败状态都是**叶子组件本地 state**，父组件不知道"哪些页失败了"。预加载器（`usePreloadManager`）对单页失败静默吞掉（`catch {}`），但当用户翻到该页时 `ReaderPage` 会重新尝试 IPC 获取，因此预加载失败天然被叶子组件兜底——本变更无需改动预加载器。

全局 Toast 基础设施已完备（`useToastStore` + `<Toaster>`），但 store 的 `show()` 不支持 action 按钮与持久模式；只有 `<Toast>` 组件原生支持（`App.tsx` 的 SFW Toast 绕过 store 直接用）。

## 目标 / 非目标

**目标：**
- 让阅读器父组件（`ComicReaderModal`）拥有"失败页索引集合"作为单一数据源
- 当累计失败页数 > 3 时弹出常驻 Toast，提供"全部重试"一键恢复
- 重试后给出恢复反馈（"已恢复 N 页"），并在失败数回落 ≤ 3 时自动隐藏 Toast
- 扩展 Toast store 支持 action 按钮与持久模式，供本功能及其他未来场景复用
- 修复 flip 模式无单页重试入口的遗留

**非目标：**
- 不改动预加载器（`usePreloadManager`）的失败处理逻辑
- 不改动 Python 后端或 IPC 契约
- 不引入失败页的"自动后台重试"（用户主动触发才重试，避免雪崩）
- 不为失败页做指数退避或重试次数限制（保持简单，用户可无限次手动重试）

## 决策

### 决策 1：状态上提到父组件，而非事件聚合

**选择**：新增 `useFailedPages` hook，在 `ComicReaderModal` 层维护 `Set<number>` 失败索引集合；叶子组件通过 `onFailed(idx)` / `onLoaded(idx)` 回调上报，父通过提升 `retryGen` 计数器触发重试。

**理由**：
- "哪些页失败了"本质是阅读器级别状态，父拥有它符合 React 单向数据流
- 阈值判断（`size > 3`）在父层 trivial，无需跨组件事件总线
- `ReaderPage` 已有 `retryTick` 模式，扩展为受控的 `retryGen` 自然
- 命令式 ref 方案（备选 B）需要给两个叶子组件都补 `forwardRef` + 命令式 API，改动反而更大且状态来源模糊

**考虑过的替代方案**：
- **B. 纯事件聚合**：子组件发事件，父维护计数；重试靠 ref 命令式触发。被否：现有组件无 forwardRef/命令式 API，补的代码更多，且状态真理分散。
- **C. Context 下发一个全局 store**：被否：过度工程，阅读器是临时挂载的模态，不需要全局可达。

### 决策 2：重试触发机制——`retryGen` 计数器 + props 下发

**选择**：父维护 `retryGen: number`，`retryAll()` 时 `setRetryGen(g => g + 1)`；该值作为 prop 下发给所有叶子组件，叶子在 `useEffect` 中监听其变化，变化时重置本地 error/dataUri 并重新进入加载流程。

**理由**：
- 单向数据流，无命令式 API，与 `ReaderPage` 现有 `retryTick` 模式一致
- `retryGen` 变化时所有失败页统一重试，非失败页因 `error===false` 被 effect 早返回，不受影响
- 实现简单，易测试

**边界处理**：
- 仅重试失败页：叶子 effect 内部判断 `if (!error) return`，所以 retryGen 变化只影响当前处于 error 态的页
- 已成功页不受打扰：dataUri 已存在的页不会重新请求

### 决策 3：Toast 常驻 + 回落自动隐藏

**选择**：扩展 `useToastStore.show()` 支持 `persistent` 选项；失败 Toast 在 `failedPages.size > 3` 时以 persistent 显示，当 size 回落 ≤ 3 时调用 `dismiss()` 自动隐藏。

**理由**：
- 自动消失（4s）的 Toast 在场景 C（翻页途中陆续失败）会反复闪烁，体验差
- 常驻 Toast 让用户不慌，处理完自然消失
- 回落自动隐藏避免"已经全好了还挂着个提示"

**重试后反馈**：`retryAll()` 触发后，不立即改 Toast 文案（因为重试是异步的，结果陆续到达）。改为：监听 `failedPages.size` 变化，当从 >0 变为 0 时，将 Toast 切换为 success 类型、文案"已恢复全部页面"，**取消 persistent**（让它走 4s 自动消失），随后自然淡出。

**考虑过的替代方案**：
- 重试中显示进度条（"2/5 已恢复"）：被否，增加状态机复杂度，且翻页模式下失败页可能不在 DOM 中无法立即重试，计数不准。

### 决策 4：flip 模式失败补单页重试按钮

**选择**：`FlipPage` 失败态在原文字旁加一个小的"重试"按钮，点击调用与"全部重试"相同的本地重置逻辑（依赖 retryGen，但单页重试通过本地 retryTick 实现，不污染父级 retryGen）。

**理由**：
- flip 模式当前完全无重试入口是明确的体验缺陷
- 单页重试只重置该页本地 state，不触发父级 retryGen（避免误伤其他失败页的状态）

**实现细节**：`FlipPage` 需要同时支持两种重试来源：
- 本地 `retryTick`（单页重试按钮触发）
- 父级 `retryGen`（全部重试触发）
- effect 依赖数组包含两者，任一变化都重置本地 error

### 决策 5：阈值口径为累计失败，含未可见页

**选择**：`failedPages` 跟踪所有上报过失败的页索引，无论该页当前是否在 DOM 中。

**理由**：
- scroll 模式所有页都在 DOM，口径天然一致
- flip 模式只有当前页在 DOM，但用户翻到过的失败页会上报过；翻走后该索引仍在集合中（除非重试成功）。这符合用户心智："我刚才看到第 5 页失败了"
- 避免"翻一页失败一下、Toast 闪一下、翻走又消失"的闪烁

**已知限制**：flip 模式下，用户从未翻到的失败页不会被上报（因为组件未挂载），所以集合是"用户接触过的失败页"的子集。这是可接受的——用户没看到的失败页不需要他处理。

## 风险 / 权衡

- **[风险] retryGen 变化导致非失败页不必要的 effect 执行** → 缓解：叶子 effect 内 `if (!error) return` 早返回，开销可忽略；retryGen 只在用户主动点击"全部重试"时变化，频率极低。

- **[风险] flip 模式失败集合不完整（未翻到的页不上报）** → 缓解：明确为可接受限制，写入决策 5；用户看到的失败才需要处理。

- **[风险] 扩展 store show 签名破坏现有调用方** → 缓解：新增参数全部可选（`actionLabel?` / `onAction?` / `persistent?`），现有 `show(msg, type)` 调用零改动；TypeScript 可选参数向后兼容。

- **[权衡] 不做自动后台重试** → 用户必须主动点。换来的是不会在后端限流时雪崩请求，行为可预测。

- **[权衡] 重试无次数限制与退避** → 保持简单。若来源持续故障，用户会看到失败 Toast 反复出现，但这正是"来源有问题"的正确信号。

## 迁移计划

纯前端变更，无数据迁移、无 IPC 变更、无配置项。

- 实施顺序：先扩展 Toast store（底层）→ 新增 useFailedPages hook → 改 ReaderPage/FlipPage 接口 → 在 ComicReaderModal 装配 → 测试
- 回滚：纯代码回退，无副作用。失败页重试功能消失后，ReaderPage 的本地单页重试按钮仍保留（向下兼容）。
