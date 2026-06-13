# ComicReaderModal 滑入滑出动画

## 目标

为漫画阅读器模态窗口（ComicReaderModal）添加打开/关闭动画：
- 打开时从屏幕底部向上滑入
- 关闭时整体向下滑出屏幕
- 带半透明遮罩层淡入淡出

## 方案

复用项目中 ComicInfoDrawer 已验证的动画模式：`mounted` + `visible` 双状态 + CSS transition + `onTransitionEnd`。零新依赖。

## 动画流程

### 打开

1. `open` prop 从 false → true
2. `setMounted(true)` 挂载 DOM
3. `requestAnimationFrame` 后 `setVisible(true)` 触发 CSS transition
4. 遮罩层：`opacity 0` → `opacity 1`（300ms）
5. 模态窗口：`translateY(100%)` → `translateY(0)`（300ms ease-out）

### 关闭

1. `open` prop 从 true → false
2. `setVisible(false)` 触发反向 CSS transition
3. 遮罩层：`opacity 1` → `opacity 0`
4. 模态窗口：`translateY(0)` → `translateY(100%)`
5. `onTransitionEnd` 检测动画结束且 `!visible` → `setMounted(false)` 卸载 DOM

## 状态管理

在 ComicReaderModal 组件内新增两个本地 state：

- `mounted`（boolean）：控制 DOM 节点是否存在
- `visible`（boolean）：控制动画阶段

原来的 `if (!open) return null` 替换为 `if (!mounted) return null`。`open` prop 作为触发信号，不再直接控制渲染。

## CSS 结构变更

当前外层是 `fixed inset-0 z-50` 的单个 div。改造为双层结构：

- **外层**（遮罩层）：`fixed inset-0 z-50`，opacity transition（0 ↔ 1），点击可关闭
- **内层**（模态内容）：`w-full h-full flex flex-col bg-[#1a1a2e]`，translateY transition（100% ↔ 0）

动画参数：`duration-300 ease-out`，与 ComicInfoDrawer 保持一致。

## 改动范围

仅修改 `src/components/ComicReaderModal.tsx`。不涉及 store、路由或其他组件。
