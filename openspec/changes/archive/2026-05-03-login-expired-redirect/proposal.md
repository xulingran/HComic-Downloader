## 为什么

当登录失效时（Cookie 过期），用户只能看到"登录信息已过期"的警告，需要手动打开浏览器、登录、复制 curl 命令再粘贴回来。这个流程繁琐且不直观，用户容易迷失方向。

## 变更内容

- 在登录失效时提供"打开网站登录"按钮，一键跳转到 h-comic.com
- 在多处添加此按钮：设置面板登录状态旁、收藏夹登录失效弹窗中
- 提供清晰的操作指引，告诉用户下一步该做什么

## 功能 (Capabilities)

### 新增功能

- `login-redirect`: 登录失效时提供跳转到网站的按钮和操作指引

### 修改功能

（无）

## 影响

- `panels/settings_panel.py`: 登录状态区域添加按钮
- `gui_app.py`: `_handle_favourites_login_required()` 和 `_verify_login_async()` 需要支持跳转功能
