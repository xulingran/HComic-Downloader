## 修改需求

### 需求: 系统必须为操作失败提供全局 Toast 提示

系统必须提供一个全局 Toast 组件和 Zustand store，允许任何页面在捕获到可恢复错误时（如下载失败、收藏失败）弹出短暂的错误提示。Toast 必须支持三种形态：纯文本瞬态提示（默认 4 秒自动消失）、带操作按钮的瞬态提示、以及常驻提示（不自动消失，仅由显式调用或外部条件关闭）。

#### 场景: 操作失败弹出 Toast

- **当** 下载、收藏、历史等操作因网络或解析错误失败
- **那么** 页面在 catch 块中调用 `useToastStore.getState().error('下载失败：网络超时')`，顶部居中弹出 Toast

#### 场景: Toast 自动消失（非持久）

- **当** 一条非 persistent 的 Toast 显示后经过设定时长（默认 4 秒）
- **那么** Toast 自动淡出消失

#### 场景: Toast 不与致命横幅冲突

- **当** 致命横幅与 Toast 同时存在
- **那么** 两者分层显示，致命横幅在内容区顶部，Toast 浮于最顶层

#### 场景: 带 action 按钮的 Toast

- **当** 调用方通过 `show(message, type, { actionLabel, onAction })` 传入操作标签与回调
- **那么** Toast 在文案右侧渲染操作按钮，点击按钮触发 `onAction` 回调；未传入 `actionLabel` 时不渲染按钮

#### 场景: 常驻 Toast 不自动消失

- **当** 调用方通过 `show(message, type, { persistent: true })` 标记为常驻
- **那么** Toaster 不启动 4 秒自动消失定时器，Toast 仅在调用方显式调用 `dismiss()` 或外部条件触发隐藏时才消失

#### 场景: persistent 与 action 可组合

- **当** 调用方同时传入 `persistent: true` 与 `actionLabel` / `onAction`
- **那么** Toast 常驻显示并带操作按钮；用户点击按钮触发回调后，由调用方决定是否调用 `dismiss()` 关闭
