## 为什么

当前 HComic Downloader 的错误处理存在严重的"黑洞"问题：所有错误信息只能通过 `npm run dev` 的终端输出查看，打包后的客户端对用户完全不可见。经调查，错误产生于三个源头（Python 后端 stderr、Electron 主进程约 17 处 `console.*`、React 渲染进程各页面 catch），全部流向终端 stdout/stderr。

最刺眼的断点包括：后端进程启动失败（`python-bridge.ts:141`）后整个后端死亡、UI 无感；后端重启超限（`python-bridge.ts:168`）静默放弃；渲染进程崩溃（`main.ts:1137`）原因永久丢失；各页面 `catch {}` 静默吞错导致用户点击无反应。用户在遇到问题时既无法自助排障，也无法向开发者提供有效的诊断信息。

## 变更内容

1. **建立客户端日志系统** — 引入 `electron-log` 依赖，利用其 console 拦截能力让现有 17 处 `console.*` 零改造自动落盘；初始化时配置文件路径、5MB 轮转、`errorHandler.startCatching()` 捕获未处理异常
2. **Python 后端日志双写** — 在 `ipc_server.py` 新增 `RotatingFileHandler` 写入 `python.log`，保留 stderr 输出作冗余（方案 A1），确保后端瞬间崩溃时已刷盘的日志不丢
3. **日志统一目录** — 双进程日志统一写入 `~/.hcomic_downloader/logs/`（方案甲），复用 Python 已有的数据目录，Electron 用 `os.homedir()`、Python 用 `os.path.expanduser("~")` 天然一致
4. **致命错误横幅** — 新增 `fatal:error` IPC 通知，主进程在后端生命周期失败时推送；渲染进程用 `useFatalErrorStore` + `<FatalBanner/>` 显示顶部常驻横幅（方案 B2，不阻塞操作，带复制/关闭按钮）
5. **全局 Toast store** — 改造现有 `Toast.tsx` 为 Zustand store 驱动的全局 Toaster，关键路径（下载/收藏/历史/登录）的 catch 接入友好错误提示
6. **一键复制诊断信息** — 新增 `log:get-diagnostics` IPC 通道（Electron 自处理，不经 Python），主进程收集环境信息 + 两端日志尾部，渲染进程一键复制到剪贴板，复制前提示潜在敏感内容

## 功能 (Capabilities)

### 新增功能

- `logging` — 客户端日志系统：Electron + Python 双进程日志统一写入固定目录，含轮转与未捕获异常捕获
- `error-display` — 客户端内错误提示：致命错误横幅（B2 常驻顶部）+ 操作失败全局 Toast
- `diagnostics` — 诊断信息收集与一键复制：结构化诊断报告（环境信息 + 日志尾部）写入剪贴板

### 修改功能

无。不涉及现有功能的行为变更。Toast 组件从单例硬编码改为 store 驱动，但 SFW 提示交互保持不变。

## 影响

- **受影响文件**:
  - 新增: `electron/log-init.ts`, `electron/diagnostics.ts`, `src/stores/useToastStore.ts`, `src/stores/useFatalErrorStore.ts`, `src/components/FatalBanner.tsx`, `src/components/common/Toaster.tsx`
  - 修改: `package.json`（+electron-log 依赖）、`electron/main.ts`、`electron/python-bridge.ts`、`electron/preload.ts`、`python/ipc_server.py`、`shared/types.ts`、`src/App.tsx`、`src/components/common/Toast.tsx`、`src/hooks/useDownloadHelper.ts`、`src/pages/*.tsx`（关键路径 catch）
- **测试**: 现有 pytest/vitest 用例应全部保持通过；新增 store 组件测试（useToastStore/useFatalErrorStore 状态流转、Toaster/FatalBanner 渲染、diagnostics 降级逻辑）
- **对外接口**: 新增 3 个 IPC 通道（`fatal:error` 通知 + `log:get-diagnostics` invoke + preload 对应方法），均为纯增量，无破坏性变更
- **隐私**: 日志含 cookie/搜索词等敏感信息，不做自动脱敏（会损失排障价值），改在复制前提示用户确认
