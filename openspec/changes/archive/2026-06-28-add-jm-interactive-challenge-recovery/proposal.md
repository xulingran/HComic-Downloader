## 为什么

JM 收藏夹在后台有界重试后仍可能被 Cloudflare 人机验证持续拦截。当前系统只能返回错误，用户无法在应用内完成验证；同时，单纯再次调用 Python HTTP 客户端也无法解决必须由真实浏览器执行 JavaScript 或用户交互的挑战。

## 变更内容

- 将持续的 JM 反爬挑战提升为带来源、受挑战 URL 和稳定错误码的结构化 IPC 信号，而不是普通运行时错误。
- 当用户主动加载或刷新 JM 收藏夹并收到挑战信号时，打开复用现有安全隔离能力的小型模态浏览器窗口，直接加载受挑战的收藏夹 URL，允许用户完成验证或必要时重新登录。
- 验证完成后从 Electron 浏览器 Session 提取 JM 登录 Cookie、Cloudflare clearance Cookie 和 User-Agent，直接回写 Python 认证配置，并对原收藏夹请求自动重试一次。
- 若 Cookie/UA 回写后 Python 仍被挑战，则使用同一 Electron Session 的 Chromium 网络栈获取目标收藏夹 HTML，再交给 Python 的 JM 解析逻辑处理，避免因浏览器与 `curl_cffi` 客户端指纹不同而陷入验证循环。
- 仅用户前台操作可触发验证窗口；后台刷新、分页预加载及非交互调用只返回可恢复错误。验证窗口采用单实例/单飞控制，取消或再次失败时禁止自动循环弹窗。
- 增加 URL 白名单、响应大小限制、敏感信息隔离、系统代理继承以及自动重试上限等安全约束和回归测试。

## 功能 (Capabilities)

### 新增功能

- `jm-interactive-challenge-recovery`: 定义 JM 收藏夹遇到持续人机验证时的浏览器交互、凭据同步、一次性自动重试及 Chromium 会话兜底行为。

### 修改功能

- `jm-challenge-recovery`: 持续挑战从普通可恢复错误升级为携带安全上下文的结构化挑战信号，同时保留后台非交互请求的有界失败语义。
- `login-window`: 登录窗口支持受约束的挑战模式、显式初始 URL、单实例控制以及验证结果回传，并继续复用现有隔离和 Cookie 提取编排。
- `login-overlay`: 叠层根据登录/验证模式展示对应文案，并在验证模式下触发 clearance 与登录凭据同步。
- `electron-ipc-contract`: 增加反爬挑战错误码与受验证的数据载荷，并保证 PythonBridge 到 Electron 主进程的结构化错误信息不丢失。

## 影响

- Python：`sources/base.py`、`sources/jm/parser.py`、`sources/__init__.py`、`python/ipc/search_mixin.py`、`python/ipc_server.py`，以及 JM 收藏夹 HTML 解析复用入口。
- Electron 主进程：`electron/python-bridge.ts`、`electron/main.ts`、`electron/login-window.ts`、`electron/login-preload.ts`。
- 前端与共享契约：`electron/preload.ts`、`shared/types.ts`、`src/hooks/useIpc.ts`、`src/pages/FavouritesPage.tsx`。
- 测试：JM parser/IPC、PythonBridge、主进程登录窗口、preload 契约、收藏夹页面交互及后台预加载不弹窗测试。
- 不新增第三方依赖，不自动破解或绕过 Cloudflare；所有浏览器和 Python 网络请求继续使用程序内系统代理。
