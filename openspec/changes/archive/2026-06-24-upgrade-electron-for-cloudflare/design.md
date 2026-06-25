# Design: upgrade-electron-for-cloudflare

## 决策摘要

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 升级策略 | 一次性跨 14 个大版本（28→42） | 已全量核查 breaking changes，项目 API 几乎未命中 Removed 级变更；逐版本渐进升级反而重复 14 次构建验证 |
| 目标版本 | `electron: "^42"`（跟随补丁） | 用户确认；享受最新 Chromium 148 修复 |
| electron-builder | `^26.15.3` | 最新稳定版，兼容 Electron 42 |
| electron-vite | `^5.0.0` | 最新稳定版，Vite 5+ 构建链 |
| sandbox | 保持 `false` | 用户确认不纳入本次范围；规避 Auth0 SPA 崩溃的历史妥协 |
| 影响范围 | 仅 jmcomic 登录（其他来源被动受益） | 用户确认只有 jmcomic 受 Cloudflare 影响 |

## 版本映射

```
                当前 (v28)         目标 (v42)
Electron        ^28.0.0            ^42
Chromium        120                148
Node.js         18                 24
V8              12.x               14.8
─────────────────────────────────────────────
electron-builder ^24.0.0           ^26.15.3
electron-vite    ^2.0.0            ^5.0.0
```

## 迁移路径设计

采用**单次升级 + 分层验证**而非逐版本渐进：

```
┌─────────────────────────────────────────────────────────────┐
│   方案对比：单次升级 vs 逐版本渐进                            │
├──────────────────────┬──────────────────────────────────────┤
│ 逐版本 28→29→...→42  │ 单次 28→42                           │
├──────────────────────┼──────────────────────────────────────┤
│ 14 次构建验证循环    │ 1 次构建验证循环                      │
│ 14 次 npm install    │ 1 次 npm install                      │
│ 中间状态无价值       │ 直接到目标状态                        │
│ 易定位"哪个版本破坏" │ 破坏时需 git bisect 定位              │
└──────────────────────┴──────────────────────────────────────┘
```

**选择单次升级的理由**：
1. breaking-changes 文档已全量核查，项目 API 未命中 Removed 级变更（见下方命中表），破坏概率低
2. 若单次升级后确有问题，可通过 `git bisect` 在 Electron 各版本间二分定位（成本与逐版本渐进相当）
3. 逐版本渐进会产生 13 个无业务价值的中间提交

## API 命中核查表（决策依据）

对照 Electron 官方 breaking-changes.md（v28→v44）与项目 `electron/*.ts`：

### 🟢 安全（无需改动）

| 项目使用的 API | 风险点 | 结论 |
|----------------|--------|------|
| `BrowserWindow` 构造 + `webPreferences` (contextIsolation/nodeIntegration/sandbox) | v20+ sandbox 默认 true | 项目显式 `sandbox:false`，不受默认值变更影响 |
| `render-process-gone` 事件 | v29 移除 `crashed` 事件 | 项目**已用** `render-process-gone`（login-window.ts:539），未用旧 `crashed` |
| `contextBridge.exposeInMainWorld` | v29 限制 ipcRenderer 直传 | 项目是**安全 wrapper**（preload.ts:71 暴露具名方法），非直传 ipcRenderer 对象 |
| `session.setPermissionRequestHandler/CheckHandler` | 未见移除 | v42 文档确认仍可用，登录窗口隔离逻辑无需改动 |
| `webContents.setWindowOpenHandler` | v39 popup 默认 resizable | 项目已 `action:'deny'` 所有弹窗（login-window.ts:331），不受影响 |
| `ipcMain.handle` / `ipcRenderer.invoke` | v28 移除 `sendTo` | 项目未用 sendTo，全用 invoke/handle |
| `webContents.userAgent` 读取 | 属性稳定 | 仅读取，未变 |
| `session.cookies.get` | API 稳定 | 未变 |
| `did-finish-load` / `will-navigate` / `did-fail-load` / `unresponsive` | 事件签名稳定 | 未变 |
| `session.webRequest.onHeadersReceived` (CSP 注入) | API 稳定 | csp-relaxed-registry 逻辑不受影响 |

### 🟡 需运行时验证（行为变更，非编译错误）

| 验证点 | 位置 | v版本 | 变更内容 | 预期影响 |
|--------|------|-------|----------|----------|
| `dialog.showOpenDialog` defaultPath | main.ts:913 | v43 | 未传 defaultPath 时默认跳 Downloads | 项目调用时**传了 defaultPath 参数**（main.ts:910），预期无影响，但需确认所有调用路径都传参 |
| Auth0 SPA 在 Chromium 148 下的行为 | login-window.ts | 全版本 | 内核升级可能改变 SPA 加载行为 | sandbox:false 本为规避崩溃，新版可能已修复，但不纳入本次范围（N1） |

### 🔴 编译/运行时错误

**无发现**。全量扫描 `electron/*.ts` 的 Electron API 使用，未命中任何 v28→v42 间被 "Removed" 的 API。

## 风险与缓解

```
┌────────────────────────────┬────────┬──────────────────────────────────┐
│ 风险                       │ 等级   │ 缓解                             │
├────────────────────────────┼────────┼──────────────────────────────────┤
│ Cloudflare 实测仍不通过    │ 🟡 中  │ Chromium 148 远超 CF 滚动窗口；  │
│                            │        │ 实测若失败则需查 CF 是否针对      │
│                            │        │ Electron 定制版有额外检测        │
├────────────────────────────┼────────┼──────────────────────────────────┤
│ electron-builder 26 配置   │ 🟡 中  │ v24→v26 跨 2 个大版本，          │
│ 格式变化导致打包失败       │        │ builder 配置在 package.json      │
│                            │        │ build 字段，需对照 v26 changelog │
├────────────────────────────┼────────┼──────────────────────────────────┤
│ electron-vite 5 配置       │ 🟡 中  │ v2→v5 跨 3 个大版本，            │
│ 格式变化导致 dev/build 失败│        │ electron.vite.config.ts 可能需调 │
├────────────────────────────┼────────┼──────────────────────────────────┤
│ Node 24 环境适配           │ 🟢 低  │ spawn API (python-bridge) 稳定； │
│                            │        │ 开发机需装 Node 24               │
├────────────────────────────┼────────┼──────────────────────────────────┤
│ 第三方依赖兼容             │ 🟡 中  │ framer-motion/react/zustand 需   │
│ (framer-motion 等)         │        │ 配合 Node 24 重新 install        │
├────────────────────────────┼────────┼──────────────────────────────────┤
│ Windows sandbox:false 下   │ 🟢 低  │ 保持现状，不在本次重启 sandbox   │
│ Auth0 仍崩溃               │        │                                  │
└────────────────────────────┴────────┴──────────────────────────────────┘
```

## 构建回归测试设计（验收项 G4）

按从快到慢的顺序验证，快速失败：

```
验证流水线（任一步失败即停止）

  ① npx tsc --noEmit           ← 类型检查（最快，秒级）
       │ 通过
       ▼
  ② npm run lint               ← ESLint（秒级）
       │ 通过
       ▼
  ③ npm test                   ← vitest 前端测试（分钟级）
       │ 通过
       ▼
  ④ npm run lint:py + black    ← Python 侧不受影响，但跑一遍兜底
       │ 通过
       ▼
  ⑤ npm run build              ← electron-vite build 产物（分钟级）
       │ 产物完整
       ▼
  ⑥ 手动: npm run dev          ← 启动应用，jmcomic 登录弹窗
       │ 完成 CF 验证 + 登录
       ▼
  ⑦ (可选) npm run build:win   ← 全量打包（PyInstaller + electron-builder）
                                 仅在需要发版时跑
```

## 不做的事（与 proposal N1-N5 呼应）

- **不重启 sandbox**：原 TODO 提到 sandbox:false 规避 Auth0 SPA 崩溃。新版 Chromium 可能已修复，但回归 sandbox 需要专门的崩溃回归测试，是独立工程，本次保持 `false` 不变。
- **不改 login-window 业务逻辑**：本次仅升级内核，`openLoginWindow` / `extractAndApplyCookies` 等编排逻辑零改动。
- **不改 Python 后端**：`apply_auth` / `verify_auth` 契约不变，Electron 拿到的 cookie 字符串格式不变。
