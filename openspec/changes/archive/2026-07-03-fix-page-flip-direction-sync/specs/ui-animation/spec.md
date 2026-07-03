## 修改需求

### 需求: 翻页方向必须由 PageFlipView 内部根据 currentPage 变化推断

系统**必须**在 PageFlipView 内部维护上一次 currentPage，根据新旧值差值推断方向（forward / backward），**禁止**要求外部调用方传入方向参数。方向推断**必须**在渲染期间同步完成（React「adjust state while rendering」模式：渲染期间比对当前 `currentPage` 与上一次的页码 state 并立即 `setDirection`），**禁止**把方向推断放进 commit 之后的 `useEffect`——否则 `AnimatePresence` 在 `currentPage` 变化的首次提交里会拿到上一帧的 stale direction，导致退出页朝错误方向飞出。

#### 场景: 键盘 ArrowRight 触发向前

- **当** 用户按 ArrowRight，currentPage 从 5 变为 6
- **那么** PageFlipView 在渲染期间推断 direction='forward'，AnimatePresence 在同一提交里用 forward 驱动退出/进入动画，新页从右滑入

#### 场景: 滑块拖动触发向后

- **当** 用户拖动滑块，currentPage 从 10 变为 3
- **那么** PageFlipView 在渲染期间推断 direction='backward'，AnimatePresence 在同一提交里用 backward 驱动退出/进入动画，新页从左滑入

#### 场景: 连续逆向翻页不残留上一帧方向

- **当** 用户先触发向前翻页（currentPage 2→3，direction='forward'），动画进行中或刚完成后再触发向后翻页（currentPage 3→2）
- **那么** PageFlipView 在向后翻页的渲染期间立即把 direction 同步为 'backward'，退出页朝右滑出（而非残留 forward 朝左飞出）；该同步**必须**在同一提交完成，**禁止**依赖 commit 之后的 effect 异步更新 direction
