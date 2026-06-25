# Proposal: upgrade-electron-for-cloudflare

## 变更 ID
upgrade-electron-for-cloudflare

## 模式
spec-driven

## 为什么

jmcomic 登录弹窗遇到 Cloudflare 人机验证时频繁报"浏览器版本过旧"，导致无法继续登录。根因是项目锁定在 Electron 28（Chromium 120，2023-12 发布），距今 ~2.5 年，远超 Cloudflare 的支持浏览器滚动窗口（通常 12-18 个月）。

Cloudflare 的检测无法靠改 UA 字符串绕过：它综合了 **TLS 指纹（JA3/JA4）** + **JS 引擎/V8 行为指纹** + **`sec-ch-ua` Client Hints 头**，三者都由 Chromium 内核版本决定。唯一根本性修复是把 Chromium 内核升级到现代版本。

经全量核查 Electron 28→42 共 14 个大版本的 breaking changes 文档，并对照项目实际使用的 API：项目 Electron 业务代码**几乎未命中任何 "Removed" 级别破坏性变更**，主要工作量在依赖链（electron-builder / electron-vite / Node.js）升级和运行时验证。

## 变更内容

将 Electron 从 `^28.0.0` 升级到 `^42`（Chromium 148），连带升级构建工具链（electron-builder、electron-vite），并以"构建回归测试"作为验收项。**只影响 jmcomic 登录**（其他来源 hcomic/copymanga/bika/moeimg 不受 Cloudflare 干扰，但其登录弹窗会一并受益于内核升级）。

保留 `sandbox: false`（`login-window.ts` 现有妥协，规避 Auth0 SPA 在 Windows 上的原生崩溃风险，新版 Chromium 可能已修复但不纳入本次范围）。

## 背景与动机

### 问题现场
- 用户在 jmcomic 登录弹窗中完成账号密码输入后，Cloudflare 人机验证页面提示"浏览器版本过旧"
- 直接阻断登录，无降级路径（Python 后端已有 verify_auth 兜底，但前提是浏览器能先拿到 Cookie）

### 为什么是内核问题而非 UA 问题
```
Cloudflare 校验维度        能否靠改 UA 绕过
─────────────────────────────────────────────
navigator.userAgent        ✗ 部分（但 sec-ch-ua 头会暴露真实版本）
sec-ch-ua Client Hints     ✗ 不能（HTTP 头由内核生成）
V8 / JS 引擎行为指纹        ✗ 不能（内核决定）
TLS JA3/JA4 指纹           ✗ 不能（BoringSSL 由内核决定）
```

### 迁移影响核查结论
对照官方 breaking-changes 文档（v28→v44 全部条目）与项目 `electron/*.ts` 实际 API 使用：

- **🟢 未命中的 Removed API**：项目未使用 `ipcRenderer.sendTo`、`crashed` 事件、`BrowserView`、`systemPreferences` 旧事件、`webFrame.routingId`、`File.path`、`protocol.registerFileProtocol`、`nativeImage.getBitmap` 等任何被移除的 API
- **🟢 命中但安全**：`render-process-gone`（v29 新增，项目已用新 API）、`contextBridge.exposeInMainWorld`（项目是安全 wrapper，非直传 ipcRenderer，不触发 v29 限制）、`setPermissionRequestHandler/CheckHandler`（v42 仍可用，登录窗口隔离逻辑无需改动）
- **🟡 需运行时验证的行为变更**：`dialog.showOpenDialog` defaultPath（v43，项目已传参，影响待确认）、`window.open` resizable（v39，登录窗口已 deny 所有弹窗）

## 目标

- **G1（核心）**：Electron 升级到 `^42`（Chromium 148），使 jmcomic 登录弹窗能通过 Cloudflare 人机验证
- **G2**：连带升级 electron-builder / electron-vite，保证 `npm run build:win/mac/linux` 全链路可用
- **G3**：现有 `electron/*.ts` 业务代码与测试无破坏性改动（保持 IPC 通道名、参数顺序、Python 后端契约不变）
- **G4**：以"构建回归测试"为验收项——`npm run build` + 全部测试套件 + 手动 jmcomic 登录实测
- **G5**：保留 `sandbox: false`（不纳入本次 sandbox 重启工程）

## 非目标

- **N1**：不重启 `sandbox: true`。原 TODO 注释提到 sandbox 规避 Auth0 SPA 崩溃，新版 Chromium 可能已修复，但回归 sandbox 是独立工程，推迟到单独提案
- **N2**：不引入跨平台系统浏览器降级方案（WebView2/WKWebView）。三套实现复杂度过高
- **N3**：不引入反检测内核（patchright / undetected-chromium）。与 Electron 多进程架构不兼容，维护负担高
- **N4**：不修改 Python 后端 / sources 逻辑。本次纯粹是 Electron 内核升级
- **N5**：不处理 Node.js 18→24 在 Python spawn 层的行为变化（spawn API 稳定，风险极低）

## 验收标准

1. `package.json` 中 `electron: "^42"`、electron-builder / electron-vite 升级到兼容版本
2. `npm test`（前端 vitest）全绿
3. `npx tsc --noEmit` 类型检查通过
4. `npm run lint`（ESLint）通过
5. **构建回归**：`npm run build` 成功（electron-vite build 产物完整）
6. **核心验收**：手动在 jmcomic 登录弹窗完成 Cloudflare 人机验证 + 登录，凭证成功保存
