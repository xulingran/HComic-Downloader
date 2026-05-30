# HComic Downloader

一个跨平台的漫画下载与管理工具，基于 Electron + React + Python 构建，支持多个漫画来源的搜索、下载、阅读和收藏管理。

## 功能特性

### 多来源支持

| 来源 | 站点 | 搜索 | 收藏 | 登录 |
|------|------|------|------|------|
| hcomic | h-comic.com | ✅ | ✅ | Cookie / 内嵌浏览器 |
| moeimg | moeimg.fan | ✅ | — | Cookie |
| jmcomic | 禁漫天堂 | ✅ | ✅ | Cookie / 内嵌浏览器 |

### 搜索与浏览

- 多模式搜索：关键词、作者、标签、排行榜
- 随机推荐（hcomic / jmcomic）
- 封面预览与漫画详情查看
- 标签黑名单过滤
- SFW 模式（安全默认值，启动时自动开启，隐藏封面图）

### 下载管理

- 多任务并发下载（1-10 线程可调）
- 任务控制：暂停 / 恢复 / 重试 / 取消
- 全局暂停开关
- 自动重试（可配置 0-5 次）
- 批量下载（可配置间隔延迟）
- 下载冲突检测
- 输出格式：文件夹 / ZIP / CBZ（含自定义命名模板）
- 章节级下载（支持选择性下载指定章节）

### 内置漫画阅读器

- 翻页浏览模式
- 缩放控制
- 阅读进度自动记录

### 其他功能

- 收藏夹管理（hcomic / jmcomic）
- 浏览历史记录
- 亮色 / 暗色 / 跟随系统 三种主题
- 自定义字体与字号
- 代理设置
- 数据迁移工具（完整迁移 / 修复模式）
- 缓存管理（封面缓存、预览缓存）
- 系统通知（下载完成提醒）
- 自定义协议 `hcomic://` 唤起
- 单实例运行锁定

## 技术架构

```
┌─────────────────────────────────────────────┐
│               Electron 主进程                │
│  (TypeScript · IPC 路由 · 输入验证 · CSP)    │
├──────────────────┬──────────────────────────┤
│   React 渲染进程  │      Python 后端          │
│  (前端 UI)        │  (解析 · 下载 · 数据)     │
│  TypeScript       │  JSON-RPC 2.0 over stdin │
│  Tailwind CSS     │                          │
│  Zustand          │                          │
└──────────────────┴──────────────────────────┘
```

### 前端技术栈

- **Electron 28** — 桌面容器
- **React 18** + **TypeScript 5.3** — UI 框架
- **Zustand 4** — 状态管理
- **Tailwind CSS 3.4** — 样式
- **Vite 5** (electron-vite) — 构建
- **Vitest 4** — 单元测试

### 后端技术栈

- **Python 3.13** — 爬取与下载引擎
- **requests** / **curl_cffi** — HTTP 请求
- **Pillow** — 图片处理
- **PyInstaller** — 打包为独立可执行文件
- **JSON-RPC 2.0** — 与 Electron 主进程通过 stdin/stdout 通信

### 安全措施

- Context Isolation + Sandbox 模式
- CSP 内容安全策略
- 所有 IPC 通道的输入参数严格校验（类型、长度、范围、路径遍历防护）
- 域名白名单（外部链接、封面图、预览图）
- Referer 注入防盗链
- 配置文件权限限制（仅当前用户可读写）
- 原子写入配置文件（防损坏）

## 项目结构

```
hcomic_downloader/
├── electron/              # Electron 主进程
│   ├── main.ts            # 入口：窗口管理、IPC 路由、验证
│   ├── preload.ts         # 预加载脚本（contextBridge）
│   ├── python-bridge.ts   # Python 后端通信桥接
│   ├── login-window.ts    # 登录窗口
│   ├── notification-manager.ts
│   └── validators.ts      # IPC 参数验证器
├── src/                   # React 前端
│   ├── main.tsx           # 入口
│   ├── App.tsx            # 根组件
│   ├── pages/             # 页面组件
│   │   ├── SearchPage.tsx
│   │   ├── DownloadPage.tsx
│   │   ├── FavouritesPage.tsx
│   │   ├── HistoryPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/        # 通用组件与业务组件
│   ├── hooks/             # React hooks
│   ├── stores/            # Zustand 状态仓库
│   └── styles/            # 全局样式
├── python/                # Python 后端
│   ├── ipc_server.py      # JSON-RPC 服务器入口
│   └── ipc/               # IPC 功能模块（mixin 拆分）
│       ├── search_mixin.py
│       ├── download_mixin.py
│       ├── preview_mixin.py
│       ├── config_mixin.py
│       ├── auth_mixin.py
│       ├── history_mixin.py
│       └── ...
├── sources/               # 漫画来源解析器
│   ├── hcomic/            # h-comic 解析器
│   ├── moeimg/            # moeimg 解析器
│   └── jmcomic/           # 禁漫天堂解析器（含反混淆）
├── shared/                # 前后端共享类型
│   └── types.ts           # TypeScript 类型定义、IPC 常量
├── tests/                 # 测试
│   ├── unit/              # 前端单元测试
│   └── *.py               # Python 单元测试
├── assets/                # 应用图标等资源
├── config.py              # 配置管理
├── requirements.txt       # Python 依赖
└── package.json           # Node.js 依赖与脚本
```

## 开发

### 环境要求

- **Node.js** >= 18
- **Python** >= 3.12
- **Git**

### 安装依赖

```bash
# Node.js 依赖
npm install

# Python 依赖
pip install -r requirements.txt

# Python 开发依赖（可选）
pip install -r requirements-dev.txt
```

### 启动开发服务器

```bash
npm run dev
```

开发模式下，Electron 主进程会自动启动 Python 后端（`python ipc_server.py`），前端通过 Vite 开发服务器热重载。

### 构建

```bash
# 仅构建 Python 后端（PyInstaller 打包）
npm run build:python

# 构建并打包为安装包
npm run build:win     # Windows (NSIS)
npm run build:mac     # macOS (DMG, x64 + arm64)
npm run build:linux   # Linux (AppImage)
```

### 测试

```bash
# 前端测试
npm test

# 带覆盖率报告
npm run test:coverage

# 监视模式
npm run test:watch

# Python 测试
pytest tests/
```

### 代码检查

```bash
# ESLint（前端 + Electron）
npm run lint
npm run lint:fix

# Ruff（Python）
npm run lint:py
npm run lint:py:fix
```

## 配置

应用配置存储在用户数据目录下的 JSON 文件中（`config.json`），支持以下主要配置项：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `downloadDir` | 下载目录 | `~/Downloads/hcomic` |
| `concurrentDownloads` | 并发下载线程数 | 4 |
| `outputFormat` | 输出格式 (folder/zip/cbz) | cbz |
| `defaultSource` | 默认搜索来源 | hcomic |
| `themeMode` | 主题模式 (light/dark/auto) | auto |
| `timeout` | 请求超时（秒） | 30 |
| `retryTimes` | 重试次数 | 3 |
| `sfwMode` | SFW 安全模式 | true |
| `notifyOnComplete` | 下载完成通知 | true |
| `jmcomicDomain` | jmcomic 自定义域名 | 自动 |

## 许可证

本项目仅供学习和个人使用。
