## 上下文

HComic Downloader 是一个基于 tkinter 的 GUI 应用程序，用于从 h-comic.com 搜索、下载和打包漫画。当前下载完成通知仅使用 `messagebox.showinfo` 模态弹窗，会阻塞程序且用户必须点击才能继续。如果用户切到其他窗口做别的事，根本不知道下载完成了。

项目当前依赖：`requests`、`Pillow`、`urllib3`，非常轻量。

## 目标 / 非目标

**目标：**
- 在下载队列完成后发送系统级通知
- 支持 Windows、macOS、Linux 三平台
- 点击通知后将应用窗口置于前台
- 优先使用库，失败后 fallback 到原生方案
- 保持项目依赖轻量（条件安装）

**非目标：**
- 不支持单个任务完成通知（仅队列全部完成）
- 不支持通知历史记录
- 不支持自定义通知样式

## 决策

### 1. 使用混合方案（优先库 + fallback）

**决策**: 对每个平台，优先使用专用库，失败后 fallback 到原生方案。

**理由**:
- 专用库功能完整、API 友好
- 原生方案作为兜底，确保基本功能可用
- 条件安装避免在不需要的平台上安装多余依赖

**替代方案**:
- 纯原生方案（subprocess）：零依赖，但功能有限
- 统一使用 plyer：跨平台，但 macOS 不支持点击回调

### 2. Windows 使用 winotify + URI 协议

**决策**: 使用 winotify 发送 Toast 通知，通过注册自定义 URI 协议 (`hcomic://`) 实现点击回调。

**理由**:
- winotify 是 Windows 10/11 原生 Toast 通知
- URI 协议是 Windows 标准机制，可靠且无需后台监听
- 注册表写入只需一次，用户可在设置面板中手动触发

**替代方案**:
- win10toast：已停维护，显示的是 TrayIcon 气泡而非原生 Toast
- winsdk：功能强大但复杂，需要 STA 线程

### 3. macOS 使用 pyobjc UNUserNotificationCenter

**决策**: 使用 pyobjc 调用 UNUserNotificationCenter，支持完整的通知回调。

**理由**:
- UNUserNotificationCenter 是 macOS 10.14+ 标准通知 API
- 支持点击回调、权限管理、声音控制
- 用户拒绝权限后静默降级到 osascript

**替代方案**:
- osascript：零依赖，但不支持点击回调
- pync + terminal-notifier：需要额外安装系统工具

### 4. Linux 使用 jeepney D-Bus

**决策**: 使用 jeepney 通过 D-Bus 发送通知，监听 ActionInvoked 信号实现点击回调。

**理由**:
- jeepney 是纯 Python D-Bus 库，零编译依赖
- D-Bus 是 Linux 桌面标准通知机制
- 支持 action 按钮和点击回调

**替代方案**:
- subprocess + notify-send：简单但不支持回调
- dbus-next：async-only，与 tkinter 集成复杂

### 5. 通知时机可配置

**决策**: 提供两种通知时机选项：仅窗口非活动时、始终通知。

**理由**:
- 用户可能在前台盯着进度条，此时通知是多余的
- 用户可能切到其他窗口，此时需要通知
- 让用户根据自己的使用习惯选择

### 6. 超长内容截断

**决策**: 漫画名截断到 20 字符，失败原因截断到 40 字符，超长部分用 "..." 替代。

**理由**:
- 系统通知空间有限，过长内容会被系统截断
- 主动截断可以控制显示效果
- 保留关键信息（前 20/40 字符）

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| winotify 安装失败 | fallback 到 PowerShell BurntToast |
| pyobjc 安装失败 | fallback 到 osascript |
| jeepney 安装失败 | fallback 到 notify-send |
| notify-send 不存在 | fallback 到 tkinter messagebox |
| macOS 权限被拒绝 | 静默降级到 osascript |
| Windows 注册表写入失败 | 提示用户手动注册或忽略 |
| Linux wmctrl/xdotool 不存在 | 检测工具是否存在，不存在则跳过并提示 |
| 中文编码问题 | 使用 UTF-8，osascript 需要转义引号 |
| 子进程超时 | 设置 timeout=5，超时则跳过 |
