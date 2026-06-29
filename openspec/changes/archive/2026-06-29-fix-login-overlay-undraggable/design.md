## 上下文

登录弹窗与人机验证弹窗共用同一个 preload 叠层（`electron/login-preload.ts`，通过 `--hcomic-window-mode` 区分模式）。当前实现里，收起态圆点与展开态卡片顶栏都绑定了 `bindDrag(host, dragHandle)`：用 pointer 事件 + 位移阈值（`DRAG_THRESHOLD_PX = 4`）区分「点击」与「拖动」，拖动时改写 `host.style.left/top`（清掉 `right`）让整个叠层跟随指针。

问题：用户拖动后叠层偏离默认右上角锚点，后续状态切换时卡片在偏移位置展开，视觉上「错位」，反而干扰登录/验证。用户要求该组件固定不可拖动。

变更范围极小、单文件、无跨模块影响、无新依赖、无数据迁移。本设计仅记录一个有实质意义的技术决策。

## 目标 / 非目标

**目标：**
- 移除拖动机制，叠层永久固定 `position:fixed; top:12px; right:12px`。
- 移除暗示可拖动的 `cursor: grab/grabbing` 视觉提示。
- 收起态圆点点击直接展开，不受拖动吞咽逻辑干扰。

**非目标：**
- 不改变四态状态机（idle/expanded/extracting/counting）的转换逻辑。
- 不改变 Shadow DOM 隔离、配色、z-index、IPC 通道。
- 不持久化任何位置（本就未持久化）。
- 不调整挑战模式与登录模式的文案/提交流程。

## 决策

### 决策 1：彻底移除 `bindDrag`，而非「保留代码但禁用」

移除 `bindDrag` 函数、`DRAG_THRESHOLD_PX` 常量、`renderDot`/`renderCard` 内的两处 `bindDrag(...)` 调用，以及 `OVERLAY_STYLES` 中 `.head { cursor: grab }` / `.head:active { cursor: grabbing }` 两条规则。

**为什么不用「保留代码 + 加开关」**：拖动是纯客户端 dead code，没有「未来可能重新启用」的现实需求；保留只会增加维护面、让读者误以为可拖。直接删除最清晰。

**替代方案（否决）**：在 `bindDrag` 开头 `return` 使其空操作 —— 会留下误导性的函数名和无用的事件绑定代码。

### 决策 2：点击展开不再需要位移阈值吞咽逻辑

当前 `endDrag` 在发生过拖动时注册一次性 `click` 捕获监听吞咽 click，防止「拖动结束误触展开」。移除 `bindDrag` 后，圆点上不再有 pointer 监听，`dot.addEventListener('click', ...)`（`renderDot` 内已有的展开逻辑）直接生效。

**含义**：`pointerdown → 指针轻微移动 → pointerup` 这种「手指/鼠标抖动」现在会被浏览器正常派发为 click（只要没超出浏览器自身的 click 判定），叠层展开。这是期望行为 —— 不可拖动的按钮本来就应「点了就展开」。

**替代方案（否决）**：保留一个独立的「位移阈值吞咽 click」机制（无拖动逻辑）——会给一个固定按钮加上不必要的复杂度，且与「点击即响应」直觉相悖。

### 决策 3：卡片顶栏 `.head` 光标改为默认

`.head` 容器（标题 + ✕ 关闭）原本 `cursor: grab` 提示「可拖」。移除拖动后保留该光标会误导用户尝试拖动。✕ 关闭按钮本身已是 `cursor: pointer`（`.close` 规则），不受影响。`.head` 不显式设 `cursor`，回退到默认。

## 风险 / 权衡

- **[风险] 用户曾依赖拖动把浮标挪开以看清被遮挡的登录表单** → 缓解：浮标固定在右上角 28px 圆点（收起态）体积很小，且用户可点 ✕ 收起回圆点；登录表单区域通常不在视口右上角。可接受。
- **[风险] 现有拖动测试断言 `host.style.left` 非空会失败** → 缓解：重写为「固定不可移动」断言（见 tasks）。这是预期内的测试更新，非回归。
- **[权衡] 抖动点击现在直接展开** → 属期望行为，非缺陷。

## 迁移计划

无数据/配置迁移。改动为纯前端 preload 代码删除，下次 `npm run dev` 即生效。回滚 = `git revert`。
