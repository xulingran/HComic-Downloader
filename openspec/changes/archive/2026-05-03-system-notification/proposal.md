## 为什么

当前下载完成通知仅使用 `messagebox.showinfo` 模态弹窗，会阻塞程序且用户必须点击才能继续。如果用户切到其他窗口做别的事，根本不知道下载完成了。需要添加系统级通知，让用户在任何情况下都能及时得知下载状态。

## 变更内容

- 新增系统通知模块 (`notifier.py`)，支持 Windows、macOS、Linux 三平台
- 新增 Windows URI 协议注册模块 (`protocol_register.py`)，支持点击通知后打开应用窗口
- 新增通知图标资源 (`assets/icon.svg`, `assets/icon_48.png`, `assets/icon_64.png`)
- 修改配置模块 (`config.py`)，新增通知相关配置字段
- 修改设置面板 (`panels/settings_panel.py`)，新增通知设置 UI
- 修改下载控制器 (`download_controller.py`)，集成系统通知
- 修改主窗口 (`gui_app.py`)，初始化通知模块
- 修改依赖文件 (`requirements.txt`)，添加通知库依赖

## 功能 (Capabilities)

### 新增功能
- `system-notification`: 系统级通知功能，支持 Windows Toast、macOS Notification Center、Linux D-Bus 通知
- `notification-click-action`: 点击通知后将应用窗口置于前台
- `protocol-registration`: Windows 自定义 URI 协议注册，支持通知点击回调

### 修改功能
<!-- 无修改功能 -->

## 影响

- **代码**: 新增 `notifier.py`、`protocol_register.py`；修改 `config.py`、`panels/settings_panel.py`、`download_controller.py`、`gui_app.py`
- **依赖**: 新增 `winotify` (Windows)、`pyobjc` (macOS)、`jeepney` (Linux)
- **配置**: 新增 `notify_on_complete`、`notify_when_foreground` 配置字段
- **系统**: Windows 需要写入注册表注册 URI 协议；macOS 需要请求通知权限
