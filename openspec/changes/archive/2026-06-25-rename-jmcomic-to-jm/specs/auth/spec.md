## 修改需求

### 需求:认证相关标识符使用 `jm` 前缀
认证流程中与 JMComic 来源相关的 IPC 方法名、参数名、类型字段从 `jmcomic` 变更为 `jm`。

#### 场景:IPC 方法名变更
- **当** 前端调用后端以获取 JM 域名列表时
- **那么** IPC 方法名必须为 `get_jm_domains`（而非 `get_jmcomic_domains`）

#### 场景:认证状态类型字段
- **当** 前端从后端获取认证状态时
- **那么** 返回的 auth map 中与 JM 来源相关的字段名必须为 `hasJmAuth`（而非 `hasJmcomicAuth`）

#### 场景:登录窗口参数
- **当** Electron 主进程打开 JM 来源的登录窗口时
- **那么** 登录相关变量和参数名必须使用 `jm` 前缀

#### 场景:IPC 通道名变更
- **当** 前端通过 IPC 获取 JM 域名列表时
- **那么** IPC 通道名必须为 `python:get-jm-domains`（而非 `python:get-jmcomic-domains`）
