## 1. 资源与依赖准备

- [x] 1.1 创建 SVG 图标文件 (assets/icon.svg)，包含字母 H 的设计
- [x] 1.2 使用 Pillow 将 SVG 转换为 PNG 图标 (icon_48.png, icon_64.png)
- [x] 1.3 修改 requirements.txt，添加条件依赖（winotify, pyobjc, jeepney）

## 2. 核心通知模块

- [x] 2.1 创建 notifier.py，实现 SystemNotifier 统一接口
- [x] 2.2 实现 _WindowsNotifier 类（winotify + fallback 链路）
- [x] 2.3 实现 _MacNotifier 类（pyobjc UNUserNotificationCenter）
- [x] 2.4 实现 _MacOsascriptNotifier 类（osascript fallback）
- [x] 2.5 实现 _LinuxNotifier 类（jeepney D-Bus + ActionInvoked 监听）
- [x] 2.6 实现 _LinuxNotifySend 类（notify-send fallback）
- [x] 2.7 实现通知内容构建逻辑（成功/失败格式、超长截断）
- [x] 2.8 实现窗口提升逻辑（bring_to_front，各平台适配）

## 3. Windows 协议注册

- [x] 3.1 创建 protocol_register.py，实现注册表读写
- [x] 3.2 实现 register_protocol 函数（写入 hcomic:// 协议）
- [x] 3.3 实现 is_protocol_registered 函数（检测协议状态）

## 4. 配置模块修改

- [x] 4.1 修改 config.py，新增 notify_on_complete 字段
- [x] 4.2 修改 config.py，新增 notify_when_foreground 字段
- [x] 4.3 修改 config.py 的 save 方法，保存新字段
- [x] 4.4 修改 config.py 的 load 方法，兼容旧配置

## 5. 设置面板 UI

- [x] 5.1 修改 settings_panel.py，新增通知设置区块（Row 6）
- [x] 5.2 添加 "下载完成时发送系统通知" 开关
- [x] 5.3 添加 "通知时机" 单选按钮（非焦点/始终）
- [x] 5.4 添加 "注册通知协议" 按钮和状态显示（仅 Windows）
- [x] 5.5 实现开关交互逻辑（开启时请求 macOS 权限）
- [x] 5.6 实现注册协议按钮点击事件

## 6. 下载控制器集成

- [x] 6.1 修改 download_controller.py，初始化 SystemNotifier
- [x] 6.2 实现 should_notify 判断逻辑（检查配置和窗口状态）
- [x] 6.3 修改 on_download_queue_complete，调用系统通知
- [x] 6.4 保留 messagebox 作为应用内通知（不阻塞时可并存）

## 7. 主窗口集成

- [x] 7.1 修改 gui_app.py，初始化通知模块
- [x] 7.2 将 notifier 实例传递给 download_controller

## 8. 测试与验证

- [x] 8.1 创建 notifier_test.py 独立测试脚本
- [x] 8.2 测试 Windows 通知发送和点击回调
- [x] 8.3 测试 macOS 通知发送和点击回调
- [x] 8.4 测试 Linux 通知发送和点击回调
- [x] 8.5 测试通知时机配置（inactive/always）
- [x] 8.6 测试超长内容截断
- [x] 8.7 测试平台降级逻辑
