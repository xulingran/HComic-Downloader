# ipc-startup-async 规范

## 目的

定义 Electron IPC 处理器与 Python 后端启动之间的异步就绪边界，保证窗口加载后调用可以等待后端而不阻塞 handler 注册，并在进程终止时及时解除等待。

## 需求

### 需求:IPC 处理器注册必须不等待 Python 后端就绪

`registerIPCHandlers()` 在注册所有 IPC handler 时，**禁止**阻塞等待 `PythonBridge` 的 `start()` 方法完成（即 Python 子进程启动并输出就绪信号）。IPC handler 的注册（`ipcMain.handle(...)`）必须在 Python 启动完成之前完成。

#### 场景:Python 尚未就绪时注册已完成

- **当** `registerIPCHandlers()` 被调用
- **那么** 所有 `ipcMain.handle(...)` 注册在 Python 子进程输出就绪信号前即可完成
- **且** 渲染进程在 Python 就绪前调用 IPC，调用必须被正确排队或等待

#### 场景:Python 就绪前 IPC 调用正常等待

- **当** 渲染进程在 Python 尚在启动时调用 `window.hcomic.search(...)`
- **那么** 调用不抛出异常，调用方得到 pending Promise
- **且** Python 就绪后，该调用被正常执行并返回结果

### 需求:PythonBridge 必须暴露就绪 Promise

`PythonBridge` 必须提供一个 `ready: Promise<void>`（或等效的 `waitForReady(): Promise<void>`），在 Python 后端首次向 stdout 输出数据（表明 Python 已完成模块导入、初始化 Mixin、并开始响应）时 resolve。IPC handler 内部在调用 `bridge.call()` 前 await 此 Promise。

#### 场景:ready Promise 在首次 stdout 数据时 resolve

- **当** Python 子进程首次向 stdout 输出数据（首个 RPC 响应或任何 stdout 行）
- **那么** `ready` Promise 必须 resolve
- **且** resolve 前的 `await bridge.ready` 被阻塞

#### 场景:ready Promise 只 resolve 一次

- **当** Python 因崩溃重启（`MAX_RESTARTS` 内）
- **那么** 重启后的 `start()` 创建新的 `ready` Promise
- **且** 旧的 `ready` Promise 不得再次 resolve

### 需求:进程终止后 ready gate 必须立即放弃

当 Python 进程因 exit/kill/error 终止时，旧的 ready gate 必须被放弃（`_readyResolve` 置 null，`_readyPromise` 设为 resolved），让等待方收到明确的失败信号而非永久挂起。重启由 `start()` 重入时创建全新的 gate。

#### 场景:进程 exit 后 call 立即抛错

- **当** Python 进程 exit，随后渲染进程发起 `bridge.call()`
- **那么** call 不永久等待 ready（旧 gate 已放弃）
- **且** 抛出 "Python process not running" 错误

#### 场景:kill 后 call 立即抛错

- **当** 主进程调用 `bridge.kill()` 后渲染进程发起 `bridge.call()`
- **那么** call 不永久等待 ready
- **且** 抛出 "Python process not running" 错误
