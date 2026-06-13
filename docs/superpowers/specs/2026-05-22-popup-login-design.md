---
name: Popup Login Design
description: 在程序内通过嵌入式弹窗登录 h-comic.com（Auth0），自动提取 Cookie，与现有 cURL 粘贴方式并存
date: 2026-05-22
---

# 弹窗登录功能设计

## 背景

当前用户需要手动在浏览器中打开 h-comic.com → 登录 → F12 开发者工具 → 复制 cURL 命令 → 粘贴到应用设置页。此流程繁琐，用户体验差。

h-comic.com 使用 **Auth0** 作为身份认证提供商。登录流程为：点击页面登录按钮 → 跳转 `h-comic.auth0.com/u/login` → 输入用户名/邮箱 + 密码 → Auth0 认证成功后重定向回 h-comic.com，浏览器获得 Cookie。

## 目标

在设置页内提供"弹窗登录"按钮，用户点击后打开嵌入式 BrowserWindow 加载 h-comic.com，用户在弹窗中完成 Auth0 登录后，自动提取 Cookie 并应用到应用中，无需手动复制 cURL。

## 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 登录方式 | 嵌入式 BrowserWindow 弹窗 | 能完整支持 Auth0 所有认证流程，安全可靠 |
| 与 cURL 方式的关系 | 两种方式并存 | cURL 作为 fallback，应对弹窗登录失败的情况 |
| 触发时机 | 仅在设置页内触发 | 避免在多个页面插入登录逻辑，复杂度可控 |
| 登录后体验 | 弹窗自动关闭 + 状态自动更新 | 用户体验最流畅 |
| 实现方案 | h-comic.com 全页导航 | 不依赖 Auth0 URL 内部格式，稳定性最高 |
| Python 后端改动 | 零改动 | Electron 端构造 cURL 格式，复用现有 apply_auth |

## 整体流程

```
1. 用户在设置页点击"弹窗登录"按钮
2. 前端通过 IPC 通知 Electron 主进程
3. 主进程创建 BrowserWindow 加载 https://h-comic.com
4. 用户在弹窗中点击登录 → Auth0 登录流程
5. 主进程监听 did-navigate，检测从 auth0.com 重定向回 h-comic.com
6. 提取 Cookie（session.cookies.get）和 User-Agent
7. 关闭弹窗，构造 cURL 文本，调用 Python apply_auth
8. 调用 verify_auth 验证登录状态
9. 将结果返回前端，更新登录状态显示
```

时序图：

```
[设置页] --IPC:open-login-window--> [主进程] --BrowserWindow--> [h-comic.com]
                                                              |
                                                         [Auth0 登录]
                                                              |
[设置页] <--IPC:login-result--- [主进程] <--extract cookies-- [重定向回 h-comic.com]
               |                          |
               |                   [构造 cURL 文本]
               |                   [调用 apply_auth]
               |                   [调用 verify_auth]
               |
        [更新登录状态]
```

## Electron 主进程变更

### 新增 IPC 通道

- `open-login-window`：触发弹窗登录

### 新增函数 `openLoginWindow()`

**BrowserWindow 配置**：
- 尺寸：500 x 700，居中显示在主窗口前方
- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- 窗口标题："登录 H-Comic"
- 加载 `https://h-comic.com`

**登录检测逻辑**：
1. 维护状态标志 `_hasVisitedAuth0 = false`
2. 监听 `did-navigate` 事件：
   - URL 包含 `auth0.com` → 设 `_hasVisitedAuth0 = true`
   - `_hasVisitedAuth0` 为 true 且 URL 为 `h-comic.com` → 判定登录成功
3. 登录成功后等待 1 秒让 Cookie 写入完成
4. 调用 `win.webContents.session.cookies.get({ url: 'https://h-comic.com' })` 提取 Cookie（使用 URL 过滤，比 domain 过滤更可靠，能匹配 `h-comic.com` 和 `.h-comic.com` 两种域名的 Cookie）
5. 将 Cookie 数组拼接为标准 Cookie 字符串：`name1=value1; name2=value2`
6. 获取 `win.webContents.userAgent` 作为 User-Agent
7. 构造 cURL 文本：`curl https://h-comic.com -b 'cookie_string' -H 'User-Agent: ua_string'`
8. 调用 Python bridge 的 `apply_auth`（传入构造的 cURL 文本）
9. 调用 `verify_auth` 验证
10. 将结果返回给渲染进程
11. 关闭 BrowserWindow

**错误处理**：
- 用户直接关闭窗口：通知渲染进程登录已取消（`{ success: false, message: '已取消' }`）
- Cookie 提取后验证失败：返回错误信息
- 超时（5 分钟）：自动关闭窗口，返回超时信息

### IPC handler 注册

在 `registerIPCHandlers()` 中新增 `open-login-window` handler，调用 `openLoginWindow()` 并返回 Promise。

## 前端 UI 变更

### `shared/types.ts`

- 新增 `IPC_CHANNELS.OPEN_LOGIN_WINDOW = 'open-login-window'`
- **注意**：此通道是纯 Electron 侧处理（不经过 Python bridge），不应加入 `PYTHON_IPC_CHANNEL_MAP`
- 在 `HcomicAPI` 接口中新增 `openLoginWindow(): Promise<{ success: boolean; message?: string }>`

### `electron/preload.ts`

- 暴露 `openLoginWindow` 方法，通过 `ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOGIN_WINDOW)` 调用

### `AuthSettings.tsx`

在现有 cURL 粘贴区域上方新增：
- "弹窗登录"按钮（accent 样式，主操作按钮）
- 按钮旁简短说明："在弹窗中登录 H-Comic 账号"
- 弹窗登录过程中按钮显示 loading 状态，禁用其他认证操作

新增 props：
- `onOpenLoginWindow: () => Promise<void>`

### `SettingsPage.tsx`

新增 `handleOpenLoginWindow` 处理函数：
1. 设置 `loginStatus` 为 `verifying`
2. 调用 `window.hcomic.openLoginWindow()`
3. 根据结果更新 `loginStatus` 和 `loginMessage`
4. 如果失败，恢复原状态

**状态流转**：
```
idle → verifying(弹窗打开中) → 弹窗操作中
  → 成功: valid + 登录成功消息
  → 取消: 恢复 idle
  → 失败: error + 错误消息
  → 超时: error + 超时消息
```

## 不需要变更的部分

- **`config.py`**：Cookie 存储机制不变
- **`parser.py`**：认证配置方式不变
- **`LoginExpiredDialog.tsx`**：仍引导用户去设置页
- **`auth_parser.py`**：Electron 端构造的 cURL 格式可被正确解析
- **`python/ipc/auth_mixin.py`**：`handle_apply_auth` 不变

## 变更文件清单

| 文件 | 变更类型 |
|------|---------|
| `electron/main.ts` | 新增 `openLoginWindow()` 函数和 IPC handler |
| `electron/preload.ts` | 暴露 `openLoginWindow` API |
| `shared/types.ts` | 新增 IPC 通道常量和 API 类型 |
| `src/components/settings/AuthSettings.tsx` | 新增"弹窗登录"按钮和状态处理 |
| `src/pages/SettingsPage.tsx` | 新增 `handleOpenLoginWindow` 处理函数 |
