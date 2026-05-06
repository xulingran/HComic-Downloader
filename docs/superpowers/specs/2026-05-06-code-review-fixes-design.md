# Code Review 全量修复设计

**日期**: 2026-05-06
**状态**: 已批准

## 概述

基于 L3 Team Code Review 报告，修复 3 个 Critical、4 个 Important、1 个 Minor 共 8 个问题。覆盖下载功能、打包策略、安全加固、设置持久化、搜索来源、Cookie 安全、测试修复和构建配置。

## 模块 1：IPC 下载功能接入（Critical）

**问题**: `python/ipc_server.py:68` `handle_download` 只创建内存任务，从未调用 `ComicDownloadManager`。

**方案**:
- `handle_download` 创建任务后，在后台线程启动 `ComicDownloadManager.download_comic()`
- 复用现有下载管理器的完整逻辑：下载、打包(CBZBuilder)、进度通知、自动重试、取消
- 进度通过 JSON-RPC notification 推送到 Electron，再转发到 Renderer
- `handle_cancel_download` 调用管理器的 `cancel_download()`
- 新增 `handle_get_download_status` 查询任务状态

**数据流**:
```
Renderer → ipcMain.handle('python:download') → ipc_server.handle_download()
  → 创建任务 → threading.Thread → ComicDownloadManager.download_comic()
  → 进度回调 → stdout JSON-RPC notification → python-bridge 解析
  → mainWindow.webContents.send('download:progress') → Renderer
```

**改动文件**:
- `python/ipc_server.py`: 重写 `handle_download`，新增 `handle_cancel_download` 和 `handle_get_download_status`
- `electron/main.ts`: 新增 `download:progress` 事件转发
- `electron/python-bridge.ts`: 解析 JSON-RPC notification 并 emit 事件
- `src/hooks/useIpc.ts`: 更新下载 hooks 监听进度事件
- `shared/types.ts`: 确保 `DownloadTask` 类型与 Python 返回对齐

## 模块 2：Python 运行时打包（Critical）

**问题**: 打包模式下桥接层期望 `resources/python/python.exe`，但 `electron-builder.json5` 只复制 `python/*.py`，没有 Python 运行时和根目录依赖。

**方案**:
- 使用 **PyInstaller** 将 `ipc_server.py` 及其所有依赖打包为独立可执行文件
- 构建流程新增 `build:python` npm script
- PyInstaller spec 文件放在 `python/hcomic_backend.spec`
- 根目录的 `parser.py`、`downloader.py`、`config.py` 等通过 PyInstaller 自动打包
- `electron-builder.json5` 更新 `extraResources` 指向 PyInstaller 输出目录
- 添加 post-build smoke test 验证 Python 后端可启动

**PyInstaller 命令**:
```bash
pyinstaller --onefile --name python \
  --distpath python/dist/win \
  --workpath python/build \
  python/ipc_server.py
```

**构建配置**:
```json5
// electron-builder.json5
extraResources: [{
  from: "python/dist/${os}/",
  to: "python/",
  filter: ["**/*"]
}]
```

**改动文件**:
- `electron-builder.json5`: 更新 `extraResources`
- `electron/python-bridge.ts`: 确认 packaged 模式路径正确
- `package.json`: 新增 `build:python` script
- 新增 `python/hcomic_backend.spec`: PyInstaller 配置

## 模块 3：open-external 安全加固（Critical）

**问题**: `electron/main.ts:96` 对任意 URL 调用 `shell.openExternal`；`electron/preload.ts:17` 暴露通用 `ipcRenderer.invoke`。

**方案**:
- preload 改为窄 API：删除通用 invoke，每个功能一个具体方法
- 对于外部链接，暴露 `openUrl(url)` 而非通用 invoke
- main 进程 URL 白名单校验：只允许 `https://` 协议 + 允许的域名列表
- 允许的域名：从配置中获取或硬编码已知站点域名

**preload 窄 API 设计**:
```typescript
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => {
    // 保留但 channel whitelist 不变
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      throw new Error(`Invalid IPC channel: ${channel}`)
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  // 新增窄 API
  openUrl: (url: string) => ipcRenderer.invoke('open-external', url),
  onDownloadProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('download:progress', handler)
    return () => ipcRenderer.removeListener('download:progress', handler)
  }
})
```

**main URL 校验**:
```typescript
const ALLOWED_DOMAINS = [
  'h-comic.com',
  'moeimg.net',
  // 其他已知来源域名
]

ipcMain.handle('open-external', async (_, url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS allowed')
  if (!ALLOWED_DOMAINS.some(d => parsed.hostname.endsWith(d))) {
    throw new Error('Domain not allowed')
  }
  await shell.openExternal(url)
})
```

**改动文件**:
- `electron/preload.ts`: 新增窄 API 方法，保留通用 invoke 但严格白名单
- `electron/main.ts`: `open-external` handler 增加 URL 白名单校验
- `src/pages/SettingsPage.tsx`: 使用 `openUrl` 代替直接 invoke

## 模块 4：设置 key 映射（Important）

**问题**: 前端 camelCase key 与 Python snake_case 不匹配，`hasattr` 静默返回 `success: True`。

**方案**:
- `ipc_server.py` 新增 `CONFIG_KEY_MAP`:
  ```python
  CONFIG_KEY_MAP = {
      'outputFormat': 'output_format',
      'downloadDir': 'download_dir',
      'defaultSource': 'default_source',
      'maxConcurrent': 'max_concurrent',
      'autoRetry': 'auto_retry',
      'retryCount': 'retry_count',
  }
  ```
- `handle_set_config` 接收 camelCase key → 映射为 snake_case → setattr
- 未识别的 key 返回 `{"success": false, "error": "Unknown config key"}`
- `handle_get_config` 将 snake_case 转回 camelCase 返回
- 类型校验：检查 value 类型是否匹配 config 字段期望类型

**改动文件**:
- `python/ipc_server.py`: 新增 `CONFIG_KEY_MAP`，重写 `handle_set_config` 和 `handle_get_config`
- `shared/types.ts`: 确保 `AppConfig` 字段名与映射一致
- 新增测试: `tests/test_config_mapping.py`

## 模块 5：搜索来源/模式传递（Important）

**问题**: 前端选择的 source 和 mode 没传到后端，后端忽略 mode 直接按默认来源搜索。

**方案**:
- `useIpc.ts` `search` 函数签名改为 `search(query, mode, page, source?)`
- `python:search` IPC 调用传完整参数对象 `{query, mode, page, source}`
- `ipc_server.py` `handle_search` 接收 source 参数，调用 `set_source()` 再搜索
- mode 参数传递到 parser 的 `search` 方法

**改动文件**:
- `src/hooks/useIpc.ts`: `search` 函数新增 `source` 参数
- `src/pages/SearchPage.tsx`: 传递选中的 source 到 search hook
- `python/ipc_server.py`: `handle_search` 处理 source 和 mode
- `shared/types.ts`: 更新搜索相关类型定义

## 模块 6：Cookie 安全（Important）

**问题**: Cookie/User-Agent 明文保存，`handle_get_config` 回传 Cookie 到 renderer。

**方案**:
- `handle_get_config` 返回时：`auth_cookie` 和 `auth_user_agent` 字段替换为 `"***masked***"`
- Python config 文件保存时设置 `os.chmod(path, 0o600)`（仅 owner 可读写）
- 日志中所有 cookie 值脱敏处理
- 前端需要重新认证时走 `handle_apply_auth` 而非读取已存 cookie

**改动文件**:
- `python/ipc_server.py`: `handle_get_config` 脱敏处理
- `config.py`: 保存时设置文件权限 `0o600`
- `python/ipc_server.py`: 日志中脱敏 cookie

## 模块 7：测试修复与补充（Important）

**失败测试修复**:
- `tests/unit/pages/FavouritesPage.test.tsx`: 补充 `useDownload` mock
- `tests/unit/main/main.test.ts`: 更新 IPC handler 数量断言
- `tests/test_parser.py`: 修复 `verify_login_status` 测试语义与实现对齐

**新增测试**:
- IPC 下载端到端测试：验证 download → progress → complete 流程
- 设置 key 映射测试：验证 camelCase ↔ snake_case 转换
- URL 白名单测试：验证允许/拒绝的 URL
- Python config 权限测试：验证文件权限正确

## 模块 8：Windows icon（Minor）

**问题**: `electron-builder.json5:19` 指向 `assets/icon.ico` 但仓库只有 `icon.svg` 和 PNG。

**方案**:
- 使用 `sharp` 或在线工具将 `icon.svg` 转换为 `icon.ico`（256x256）
- 或调整 `electron-builder.json5` 使用 `icon_64.png`（electron-builder 支持 PNG）

**改动文件**:
- 新增 `assets/icon.ico`
- 或 `electron-builder.json5`: icon 改为 `assets/icon_64.png`

## 实施顺序

1. 模块 7（测试修复）— 先修测试，确保 CI 基线可靠
2. 模块 1（下载功能）— 核心功能
3. 模块 4（设置映射）— 基础功能修复
4. 模块 5（搜索来源）— 基础功能修复
5. 模块 3（安全加固）— 安全改进
6. 模块 6（Cookie 安全）— 安全改进
7. 模块 2（打包策略）— 构建配置
8. 模块 8（icon）— 构建配置

## 不在范围内

- 不改变整体架构（保持 Electron + Python 分层）
- 不引入新的状态管理方案
- 不重构现有下载管理器内部逻辑
