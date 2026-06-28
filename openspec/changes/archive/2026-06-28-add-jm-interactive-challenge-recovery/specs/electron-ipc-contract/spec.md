## 新增需求

### 需求:反爬挑战错误必须跨 PythonBridge 保留结构化数据

Python JSON-RPC 返回专用反爬挑战错误时，Electron `PythonBridge` 必须在主进程 Error 上保留数值 `code` 和经过类型检查的 `data`；禁止仅保留 message 后依靠字符串匹配恢复类型。

#### 场景:保留合法挑战错误
- **当** Python 返回反爬挑战错误码及 `{ source: "jm", challengeUrl, message }`
- **那么** 主进程捕获的错误必须含相同错误码和合法数据字段
- **且** 该错误可被收藏夹主进程 handler 精确识别

#### 场景:拒绝异常数据载荷
- **当** Python 错误的 `data` 不是对象、来源不是 `jm`、URL 超长或字段类型不符
- **那么** PythonBridge 或消费 handler 必须将其视为无可信上下文的普通错误
- **且** 禁止用该载荷打开 BrowserWindow

### 需求:收藏夹交互标志必须逐层验证并默认关闭

前端到 Electron 主进程的收藏夹调用可携带可选 `allowInteractiveChallenge` 布尔值；preload 和主进程必须验证其类型，缺省时必须视为 `false`，并禁止将该 UI 控制参数转发给 Python handler。

#### 场景:缺省为非交互
- **当** 调用 `getFavourites` 未提供交互标志
- **那么** 主进程按 `allowInteractiveChallenge=false` 处理
- **且** 挑战错误不得打开窗口

#### 场景:非法交互参数
- **当** renderer 为交互标志传入非布尔值
- **那么** preload 在调用主进程前拒绝请求

#### 场景:主进程消费控制参数
- **当** 合法请求携带 `allowInteractiveChallenge=true`
- **那么** 主进程可用它决定是否运行挑战编排
- **且** 发给 Python `get_favourites` 的参数只包含其支持的页码和来源字段

