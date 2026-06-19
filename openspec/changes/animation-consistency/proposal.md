## 为什么

虽然 `useModalAnimation` 已经抽象了「双层 rAF + mounted/visible + transition」的进出场模式，但代码库里有**三套并存的进出场实现**：

1. `useModalAnimation.ts` —— 抽象的 hook（被 `Modal.tsx`、`ComicInfoDrawer.tsx`、`ComicReaderModal.tsx` 使用）
2. `Toast.tsx` —— 行 22-43 自己重新实现了一遍同样的 mounted/visible 双态 + rAF（且取消逻辑用的是 `rafRef`，与 hook 的清理逻辑不统一）
3. 各组件内的 `transition-opacity duration-300` —— 内联 className 写法

同时，三套实现的**时长与曲线不一致**：Modal 用 `duration-200 ease-out`，Drawer 用 `duration-300 ease-out`，Toast 用 `duration-300 ease-out`，ComicReaderModal 用 `duration-300 ease-out`。视觉上缺乏统一的「弹一下」或「丝滑滑入」的质感，也没有 spring 物理曲线带来的真实感。

本变更借助变更 1 引入的 `framer-motion` + 令牌 + `usePresenceAnimation`，把所有进出场动画**统一到一套 variants**，并引入 spring 物理曲线与轻微的错峰动画（stagger），让整个 UI 的「质感」从「能用」提升到「精致」。

## 变更内容

- **Modal.tsx 迁移到 AnimatePresence**：用 framer-motion 的 `AnimatePresence` 替代手动管理的 mounted/visible。退出动画交给 `AnimatePresence` 自动处理，删除 `handleTransitionEnd` 与 mounted 判空逻辑。保留遮罩安全点击（方案 A）的 mousedown/click 判定不变。
- **Toast.tsx 迁移到 AnimatePresence**：删除自管 `rafRef` 与 `useEffect` 的 mounted/visible 逻辑，改用 `AnimatePresence` + motion.div。**清理被 inline style 覆盖的 className transform 死代码**（变更 1 只删除，本变更重写整个动画路径）。
- **ComicInfoDrawer.tsx 迁移**：抽屉滑入用 motion.div + 共享 spring variant；遮罩 opacity 用 motion.div。tag 列表加入 `staggerChildren` 错峰动画（每个 tag 延迟 30ms 出现）。
- **ComicReaderModal.tsx 迁移**：与 ComicInfoDrawer 同款 spring 曲线，统一阅读器弹窗的进出感。
- **统一进入退出曲线**：所有容器级进出场动画统一使用 `anim.ts` 的 `springTransition`（cubic-bezier(.34,1.56,.64,1)），duration 由令牌 `base` / `slow` 决定。
- **保留 reduced-motion 契约**：所有迁移后的组件在 `useReducedMotion()` 为真时退化为纯 opacity 过渡（无位移、无缩放）。

## 功能 (Capabilities)

### 修改功能
- `ui-animation`: 扩展规范，定义所有容器级进出场动画（Modal / Drawer / Toast / Reader Modal）的统一行为契约：进入用 spring + scale/translate、退出反向、reduced-motion 退化路径、tag 列表 stagger 参数。

## 影响

- 受影响文件：`src/components/common/Modal.tsx`、`src/components/common/Toast.tsx`、`src/components/ComicInfoDrawer.tsx`、`src/components/ComicReaderModal.tsx`。
- 可删除文件：`src/hooks/useModalAnimation.ts`（迁移完成后所有调用方切换到 `usePresenceAnimation`，删除旧 hook）。如担心回归风险，可保留作为内部委托，但建议本变更一并清除。
- 不影响：IPC、Python、store 结构、shared types、用户可见的**功能**（仅改变动画质感与时序）。
- 行为差异（用户可感知）：
  - Modal / Drawer / Toast 进出更「弹」一些（spring 曲线 overshoot）
  - tag 列表展开时有轻微的错峰出现
  - 系统开启「减少动画」时，所有容器动画退化为纯淡入淡出
- 风险：中。涉及 4 个核心弹窗组件的动画路径重写，需要逐个回归测试遮罩点击、ESC 关闭、嵌套 Modal（如 ComicInfoDrawer 内嵌 confirmTag Modal）的 zIndex 层级。
- 依赖：变更 1（`anim.ts` + framer-motion + `usePresenceAnimation`）必须先完成。
