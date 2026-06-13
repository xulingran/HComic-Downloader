# 自动检测更新功能设计

## 概述

开发自动检测 GitHub Release 更新的功能。应用启动时自动检查是否有新版本，有则弹窗提示（显示更新日志）。关于页提供手动检查按钮。设置中可开关自动检测。

## 方案选择

采用 GitHub REST API + Electron 主进程请求方案。主进程使用 `net.fetch()` 调用 GitHub Releases API，无 CORS 问题，数据结构清晰。未认证限额 60次/小时，远超启动检测需求。

## 架构

### 模块划分

```
UpdateChecker (主进程)  ←→  IPC 通道  ←→  渲染进程 UI
```

三个独立单元，各自职责单一：

1. **UpdateChecker** — 数据获取与版本比较，不关心 UI
2. **IPC 通道 + Preload** — 进程间通信桥梁
3. **渲染进程 UI** — 对话框、按钮、开关

### 数据流

```
启动: app ready → 读取配置 → UpdateChecker.checkForUpdates()
      → 有更新 → IPC 'update:check-result' → App 组件弹出 UpdateDialog

手动: 关于页按钮 → IPC 'update:check' invoke → UpdateChecker.checkForUpdates()
      → 返回结果 → 关于页显示/弹窗
```

## 第 1 节：UpdateChecker 模块

**文件**: `electron/update-checker.ts`

**职责**:
- 调用 `https://api.github.com/repos/xulingran/HComic-Downloader/releases/latest`
- 使用 Electron `net.fetch()` 发起请求
- 解析 JSON 获取 `tag_name`（版本号）和 `body`（markdown 更新日志）

**版本比较**:
- 去除 `v` 前缀，按 major.minor.patch 逐段数值比较
- 不引入外部 semver 库，自写简单比较函数
- 当前版本通过 `app.getVersion()` 获取

**返回类型**:
```typescript
interface UpdateInfo {
  latestVersion: string
  changelog: string
  releaseUrl: string
}

type UpdateCheckResult =
  | { hasUpdate: true; latestVersion: string; changelog: string; releaseUrl: string }
  | { hasUpdate: false }
  | { error: string }
```

**错误处理**: 网络失败、API 限流、JSON 解析错误均静默失败。手动检查时通过返回值 `error` 字段告知失败原因。

## 第 2 节：IPC 通道与 Preload 桥接

**新增通道**:

| 通道名 | 模式 | 方向 | 用途 |
|--------|------|------|------|
| `update:check` | invoke | 渲染 → 主进程 → 渲染 | 手动检查 |
| `update:check-result` | on | 主进程 → 渲染进程 | 启动时自动推送（仅有更新时） |

**Preload 暴露 API**:
```typescript
checkForUpdates(): Promise<UpdateCheckResult>
onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
```

**shared/types.ts 变更**:
- 新增 `UpdateCheckResult`、`UpdateInfo` 类型
- `IPC_CHANNELS` 新增 `UPDATE_CHECK: 'update:check'`
- `NOTIFICATION_CHANNELS` 新增 `UPDATE_CHECK_RESULT: 'update:check-result'`
- `HcomicAPI` 接口新增 `checkForUpdates` 和 `onUpdateAvailable`

## 第 3 节：渲染进程 UI

### UpdateDialog 组件

**文件**: `src/components/UpdateDialog.tsx`

遵循现有对话框风格（半透明遮罩 + 居中面板）：
- 标题显示 "发现新版本 vX.X.X"
- 更新日志区域：轻量 markdown 渲染（处理标题、列表、加粗、链接等常见格式），不引入第三方 markdown 库
- 底部按钮："稍后提醒"（关闭）和"去下载"（`shell.openExternal()` 打开 Releases 页面后关闭）

### 关于页改造

**文件**: `src/pages/AboutPage.tsx`

版本号行右侧新增"检查更新"按钮：
- 检查中：按钮显示加载状态
- 有更新：弹出 UpdateDialog
- 无更新：按钮旁短暂显示"已是最新版本"
- 检查失败：按钮旁短暂显示"检查失败"

### 设置页改造

**文件**: `src/components/settings/NotificationSettings.tsx`

在通知区域底部新增 toggle 开关："启动时检查更新"，样式与"下载完成通知"一致。

### App 级监听

**文件**: `src/App.tsx`

注册 `onUpdateAvailable` 监听，收到更新信息时弹出 UpdateDialog。管理弹窗状态避免重复弹出。

## 第 4 节：配置集成

**新增配置项**: `checkUpdateOnStart`（boolean，默认 `true`）

**修改文件**:
- `shared/types.ts` — `ConfigKey`、`CONFIG_KEYS`、`ConfigValueMap`、`AppConfig` 各添加 `checkUpdateOnStart`
- `electron/main.ts` — 启动时读取该配置，决定是否执行自动检查

**初始化流程**:
1. App ready → Python 后端就绪 → 主进程读取配置
2. 若 `checkUpdateOnStart` 为 `true`，延迟几秒后调用 `checkForUpdates()`
3. 若检测到更新，发送 `update:check-result` 到渲染进程

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `electron/update-checker.ts` | 新增 |
| `electron/main.ts` | 修改（注册 IPC handler，启动时自动检查） |
| `electron/preload.ts` | 修改（暴露新 API） |
| `shared/types.ts` | 修改（新增类型、通道、配置键） |
| `src/components/UpdateDialog.tsx` | 新增 |
| `src/pages/AboutPage.tsx` | 修改（添加检查更新按钮） |
| `src/components/settings/NotificationSettings.tsx` | 修改（添加开关） |
| `src/App.tsx` | 修改（注册监听、管理弹窗状态） |
