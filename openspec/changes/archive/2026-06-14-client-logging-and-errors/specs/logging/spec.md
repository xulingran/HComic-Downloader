## ADDED Requirements

### 需求: Electron 主进程必须将所有日志写入文件

系统必须使用 electron-log 在主进程建立文件日志，将现有的 `console.log/error/warn` 调用（约 17 处）自动转发到日志文件，并捕获未处理的异常与 Promise rejection。

#### 场景: 现有 console 调用自动落盘

- **当** 主进程代码调用 `console.error('Failed to start Python process:', err)`
- **那么** 该消息同时写入终端和 `~/.hcomic_downloader/logs/main.log`，无需修改原调用代码

#### 场景: 未捕获异常被记录

- **当** 主进程发生未捕获的异常或未处理的 Promise rejection
- **那么** 异常堆栈被写入 `main.log`，不会静默丢失

#### 场景: 日志文件按大小轮转

- **当** `main.log` 超过配置的最大尺寸（默认 5MB）
- **那么** 日志按 electron-log 内置规则轮转，旧日志归档，新日志继续写入

### 需求: Python 后端必须同时输出日志到 stderr 和文件

系统必须为 Python 后端配置日志处理器，将日志同时写入 stderr（供 Electron 捕获）和 `~/.hcomic_downloader/logs/python.log` 文件，确保后端崩溃时日志不丢失。

#### 场景: Python 日志双写

- **当** Python 后端通过 `logging.getLogger(__name__).error(...)` 输出错误
- **那么** 该日志同时出现在 stderr 和 `python.log` 文件中

#### 场景: Python 进程崩溃前仍有日志

- **当** Python 后端在写入 stderr 前崩溃
- **那么** 已通过 FileHandler 刷入 `python.log` 的日志仍然保留

### 需求: 日志必须统一写入固定目录并包含时间戳

系统必须将 Electron 和 Python 的日志文件统一存放在 `~/.hcomic_downloader/logs/` 目录下，且每条日志必须包含精确到毫秒的时间戳和日志级别。

#### 场景: 跨平台路径解析

- **当** 应用在 Windows / macOS / Linux 上运行
- **那么** 日志目录解析为 `<用户 home>/.hcomic_downloader/logs/`，Electron 用 `os.homedir()`，Python 用 `os.path.expanduser("~")`

#### 场景: 目录自动创建

- **当** 日志目录不存在
- **那么** 系统在首次写入前自动创建该目录
