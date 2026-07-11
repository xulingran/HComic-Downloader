## 为什么

当前主导航 Tab 采用 keep-alive 容器并行播放旧页淡出与新页淡入，两个全尺寸页面在约 150ms 内以大面积半透明状态重叠，导致文字、卡片和控件出现明显重影。现行 `ui-animation` 规范还把这种共存规定为目标行为，因此需要同时修正规范与动画协调机制，才能在保留页面状态和方向感的前提下消除视觉错误。

## 变更内容

- 将 Tab 过渡从新旧页面同步交叉淡化改为总时长不增加的顺序式 fade-through：旧页先退出并完全隐藏，新页随后进入。
- 保留页面 keep-alive、导航方向感、300ms 总时长以及程序化跳转动画，不卸载已访问页面。
- 集中协调 Tab 过渡阶段，确保任意时刻最多只有一个页面的真实内容可见。
- 为快速连续切换引入过渡身份校验，防止已过期动画完成回调隐藏当前页面或恢复错误页面。
- 将 reduced-motion 路径改为不产生内容交叠的瞬时切换。
- 增加动画阶段、首次访问、连续快速切换和 reduced-motion 的行为测试。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `ui-animation`: 修改 Tab 过渡的可见性与时序要求，从同步交叉淡化改为无内容重叠的顺序式 fade-through，并明确快速切换和 reduced-motion 行为。

## 影响

- 前端动画协调：`src/App.tsx`、`src/components/KeepAlivePage.tsx`、`src/lib/anim.ts`。
- 前端测试：`tests/unit/App.test.tsx`、`tests/unit/anim.test.ts`，并可能新增独立的 `KeepAlivePage` 测试。
- OpenSpec：修改 `ui-animation` 能力规范；`page-keep-alive` 的实例存活和状态保留语义保持不变。
- 不涉及 Python 后端、IPC 契约、数据格式、网络请求或新增依赖。
