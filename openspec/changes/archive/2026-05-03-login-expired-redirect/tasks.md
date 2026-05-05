## 1. 设置面板登录状态按钮

- [x] 1.1 在 `panels/settings_panel.py` 的登录状态旁添加"去登录"按钮
- [x] 1.2 添加按钮状态控制逻辑（登录失效时启用，登录成功时禁用）
- [x] 1.3 实现按钮点击事件：调用 `webbrowser.open("https://h-comic.com")`

## 2. 收藏夹登录失效弹窗

- [x] 2.1 在 `gui_app.py` 中创建 `LoginExpiredDialog(tk.Toplevel)` 自定义对话框类
- [x] 2.2 对话框包含：标题、说明文字、操作步骤指引、"打开网站登录"按钮、"关闭"按钮
- [x] 2.3 修改 `_handle_favourites_login_required()` 使用新的自定义对话框

## 3. 登录校验失败处理

- [x] 3.1 修改 `_verify_login_async()` 的 `poll_result()`，校验失败时启用设置面板的"去登录"按钮
- [x] 3.2 确保 `_update_login_status_for_current_source()` 正确更新按钮状态

## 4. 测试验证

- [x] 4.1 测试设置面板"去登录"按钮：点击后打开浏览器
- [x] 4.2 测试收藏夹登录失效弹窗：显示正确、按钮可用
- [x] 4.3 测试按钮状态联动：登录成功后按钮禁用
