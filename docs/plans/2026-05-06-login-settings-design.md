# Electron 设置页面 - 登录信息设置功能设计

## 概述

在 Electron 前端设置页面新增"登录"设置卡片，支持用户粘贴浏览器 cURL 命令来自动配置 hcomic 的登录认证信息，并自动验证登录状态。

## 需求

- 仅支持 hcomic 来源的登录设置
- 用户粘贴 curl 命令，系统自动解析 Cookie 和 User-Agent
- 应用后自动验证登录状态，显示有效/失效
- 遵循现有设置页面的 UI 风格和交互模式

## 方案

采用后端解析方案：复用 Python 端已有的 `auth_parser.extract_auth_from_curl` 和 `parser.verify_login_status`，通过新增 IPC 接口暴露给 Electron 前端。

## UI 设计

在 SettingsPage 的"来源"卡片之后新增"登录"卡片：

1. **来源标识** — 显示 "HComic"，右侧状态徽标（未配置/有效/失效）
2. **curl 输入区** — textarea 用于粘贴 curl 命令，placeholder 提示操作步骤
3. **应用按钮** — "应用登录信息"，点击后解析、保存、验证
4. **状态反馈** — 按钮下方显示验证结果

## 后端 IPC 接口

### `apply_auth`
- 入参: `{ curl_text: string }`
- 流程: 调用 `extract_auth_from_curl` 解析 → 保存到 config
- 返回: `{ cookie: string, user_agent: string }`

### `verify_auth`
- 入参: `{}`
- 流程: 调用 parser 的 `verify_login_status`
- 返回: `{ valid: boolean, message: string }`

### Electron IPC 注册

在 `electron/main.ts` 注册:
- `python:apply-auth` → `bridge.call('apply_auth', ...)`
- `python:verify-auth` → `bridge.call('verify_auth', ...)`

## 数据流

1. 用户粘贴 curl → 点击"应用登录信息"
2. 前端调用 `python:apply-auth`
3. Python 解析 curl，保存 cookie/UA 到 config，返回结果
4. 前端自动调用 `python:verify-auth`
5. 前端显示验证状态徽标

## 错误处理

- curl 为空 → 前端提示"请粘贴 curl 命令"
- curl 解析失败 → 显示后端错误信息
- 验证失败 → 显示"登录已失效"并提供操作指引
- 网络/超时 → 显示"验证失败，请检查网络"

## 状态管理

在 SettingsPage 内用 useState 管理登录状态：
- `idle` — 初始/未配置
- `verifying` — 验证中
- `valid` — 登录有效
- `invalid` — 登录失效
- `error` — 验证失败

不引入额外全局 store。

## 涉及文件

- `src/pages/SettingsPage.tsx` — 新增登录设置卡片
- `electron/main.ts` — 注册新 IPC handler
- `python/ipc_server.py` — 新增 apply_auth / verify_auth 方法
