---
name: Login Manual Close Design
description: 移除弹窗登录的"自动检测 cookie → 自动关窗"逻辑，改为用户手动关窗后再提取 cookie；未登录关窗静默取消
date: 2026-06-13
---

# 弹窗登录手动关窗改造设计

## 背景

`electron/login-window.ts` 当前对 hcomic / copymanga / jmcomic 三个来源都实现了"自动检测登录 cookie → 自动关闭弹窗"的逻辑：各自通过导航监听或 cookie 轮询检测登录态，命中后调用 `completeLoginFlow` 提取 cookie，成功后延迟 5s 自动关窗。

该逻辑存在以下问题：

1. **用户预期不符**：登录完成后弹窗会"自己关掉"，用户无法确认登录状态、也无法主动控制何时提取凭证。
2. **jmcomic 用户名提取脆弱**：`extractJmcomicUsername` 依赖 DOM 访问，目前仅在 `completeLoginFlow`（关窗前）执行；现存的 `closed` 事件兜底路径在窗口销毁后无法访问 DOM，对 jmcomic 是残缺的（用户名永远为空）。
3. **死代码**：`cancelLoginAutoClose()` 全项目无人调用；`LOGIN_COOKIE_SUCCESS` 通知发送了两处但渲染进程零消费者；`LOGIN_COOKIE_SUCCESS_DELAY_MS` / `clearSuccessTimeout` 仅为自动关窗服务。

## 目标

- 删除自动检测 + 自动关窗逻辑，统一为"用户手动关窗后再提取 cookie"。
- 未登录即关窗 → 静默取消（恢复登录前认证状态，不弹错误）。
- 修复 jmcomic 用户名在手动关窗路径下的提取。
- 清理因本次改动而彻底失效的死代码。

## 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 提取时机 | 用户手动关窗 | 符合用户预期，把控制权交还用户 |
| 提取事件 | `close`（非 `closed`） | `close` 触发时 DOM + session 均存活，可确定性提取 jmcomic 用户名；`closed` 时窗口已销毁 |
| 关窗方式 | `loginWin.destroy()` | 避免 `close()` 重入；`destroy()` 直接进入 `closed`，由 `settled` 标志防重入 |
| 未登录关窗 | 静默取消（选项 A） | 手动关窗成为主要交互，报错会很吵；映射为现有 `已取消` 信号，渲染进程无需改动 |
| 错误判别 | 结构化字段 `notLoggedIn` | 遵循"不用字符串比较区分错误路径"原则 |
| 死代码 | 一并清理 | 改动直接导致 `LOGIN_COOKIE_SUCCESS` 链路失效，清理范围小且机械 |

## 详细设计

### 删除项（自动检测 + 自动关窗机制）

- `bindLoginNavigationTracking`（hcomic 导航检测）
- `bindCopymangaLoginTracking`（copymanga cookie 轮询）
- `bindJmcomicLoginTracking`（jmcomic cookie 轮询）
- `completeLoginFlow`（自动关窗编排器）及其 5s 成功延迟、`cancelAutoCloseFn` 机制
- 常量 `LOGIN_COOKIE_SETTLE_MS`、`LOGIN_COOKIE_SUCCESS_DELAY_MS`
- 辅助函数 `hasJmcomicLoginCookie`（仅轮询使用）
- `cancelLoginAutoClose` 导出函数及模块级 `cancelAutoCloseFn`
- `LoginWindowContext` 字段：`hasVisitedAuth0`、`jmcomicUsername`、`clearSuccessTimeout`

### 新增：统一的手动关窗提取处理器

用一个 `close` 事件处理器替换原 `bindLoginWindowClosed`，三个来源走同一条路径：

```
用户点 ✕ → close 事件触发（DOM + session 存活）
  → event.preventDefault() 挡住关闭
  → 异步：jmcomic 先 extractJmcomicUsername（DOM），再 extractAndApplyCookies（session）
  → 提取完成 → ctx.done(result) → loginWin.destroy() → closed 兜底清理
```

**重入与边界处理**：
- `ctx.settled` 为真 → 直接 return（让窗口正常关闭），用于 `done()` 内部 `destroy` 后或超时/崩溃后的二次进入。
- `ctx.extractInProgress` 为真 → 已在提取，`return`（保留 preventDefault 效果，窗口保持存活）。
- `savedUserAgent` 为空（页面未加载完即关窗）→ 静默取消。
- 提取链 `.catch` → 静默取消（窗口中途销毁导致 `executeJavaScript` reject 等）。

### 静默取消（选项 A）

`extractAndApplyCookies` 返回值增加结构化判别字段：

```ts
{ success: boolean; message: string; notLoggedIn?: boolean }
```

- 无 cookie / 缺关键登录态 cookie（jmcomic `remember`、copymanga `token` 等）→ `notLoggedIn: true`
- `apply_auth` 抛出真实异常 → 不带 `notLoggedIn`

`close` 处理器中：

```ts
if (!result.success && result.notLoggedIn) {
  ctx.done({ success: false, message: '已取消' })   // 静默取消
} else {
  ctx.done(result)                                   // 成功或真实错误
}
```

渲染进程 `useAuthState.openWindow` 已有 `result.message === '已取消'` → `setStatus(prevStatus)` 的静默回退逻辑，**无需改动渲染进程**。

### 死代码清理（`LOGIN_COOKIE_SUCCESS` 全链路）

| 文件 | 改动 |
|------|------|
| `electron/login-window.ts` | 移除 2 处 `mainWindow.webContents.send(LOGIN_COOKIE_SUCCESS)` |
| `electron/preload.ts` | 移除 `onLoginCookieSuccess` |
| `shared/types.ts` | 移除 `onLoginCookieSuccess` 声明 + `LOGIN_COOKIE_SUCCESS` channel 常量 |
| `tests/unit/main/ipc-channel-consistency.test.ts` | 从 `electronOnlyNotifications` 集合移除该条目 |
| `tests/unit/pages/SettingsPage.test.tsx` | 移除 `onLoginCookieSuccess` mock |

### 保留不动

- `LOGIN_WINDOW_TIMEOUT_MS`（5 分钟超时安全网）—— 超时仍 `done({ success: false, message: '登录超时，请重试' })`。
- `will-navigate` 域名白名单拦截（防广告重定向，安全相关）。
- CSP 处理 `setupLoginWindowCSP`、`render-process-gone` / `did-fail-load` / `unresponsive` 处理。

## 受影响文件汇总

| 文件 | 改动类型 |
|------|---------|
| `electron/login-window.ts` | 主要重写（删自动检测、新增 close 处理器、清理死代码） |
| `electron/preload.ts` | 移除 `onLoginCookieSuccess` |
| `shared/types.ts` | 移除通知声明 + channel 常量 |
| `tests/unit/main/ipc-channel-consistency.test.ts` | 移除条目 |
| `tests/unit/pages/SettingsPage.test.tsx` | 移除 mock |

渲染进程（`useAuthState.ts` 等）不改。

## 风险与验证

- **jmcomic 用户名**：`close` 事件下 DOM 存活，需实测登录 jmcomic → 关窗 → 收藏夹功能正常。
- **重入安全**：`settled` + `extractInProgress` 双标志防重入，需覆盖"提取中再次点 ✕"场景。
- **回归**：hcomic / copymanga / jmcomic 三个来源各自走一遍"登录后关窗"与"未登录关窗"两条路径。
