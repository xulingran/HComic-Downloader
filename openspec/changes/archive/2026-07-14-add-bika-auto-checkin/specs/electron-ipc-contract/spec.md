## 新增需求

### 需求:Bika 自动签到 IPC 契约必须逐层闭合
系统必须为 Bika 自动签到定义无输入参数的共享契约、preload API、Electron 主进程 handler 与 Python JSON-RPC handler，并在各层返回结构化签到状态。

#### 场景:自动签到调用成功
- **当** renderer 调用 Bika 自动签到 API
- **那么** preload 必须通过专用 IPC 通道调用主进程
- **且** 主进程必须以空参数对象调用 Python `bika_check_in`
- **且** 返回结果必须包含 `status`，其值仅可为 `checked_in` 或 `already_checked_in`

#### 场景:自动签到通道无外部参数
- **当** renderer 调用 Bika 自动签到 API
- **那么** API 禁止接受或转发用户名、密码、token 或任意用户输入
- **且** Python 必须复用运行期 Bika parser 的认证状态

## 修改需求

## 移除需求
