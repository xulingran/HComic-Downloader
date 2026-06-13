# HComic Downloader — Electron + React 前端设计

## 概述

将现有 tkinter GUI 重构为 Electron + React 前端，保留 Python 后端逻辑，提供现代化、美观的桌面应用体验，并支持打包为跨平台可执行文件。

## 技术选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 桌面框架 | Electron | 跨平台、生态成熟、打包方便 |
| 前端框架 | React 18 | 组件化、社区庞大 |
| 状态管理 | Zustand | 轻量、简洁、TypeScript 友好 |
| 样式方案 | Tailwind CSS + CSS Variables | 实用优先、主题切换方便 |
| 构建工具 | Vite + electron-vite | 快速开发、优化打包 |
| 打包工具 | Electron Builder | 成熟、多平台支持 |
| 后端通信 | JSON-RPC 2.0 (stdin/stdout) | 简单、可靠、易于调试 |

## UI 设计规范

### 视觉风格：简洁明亮风

- 白色背景 + 蓝色主题（#4A90D9）
- 圆角卡片（12px）
- 轻量阴影（0 2px 8px rgba(0,0,0,0.06)）
- macOS 风格的清爽界面

### 主题系统

支持三种模式：
- **Light**：浅色主题
- **Dark**：深色主题
- **Auto**：跟随系统设置（默认）

通过 CSS Variables 实现主题切换：

```css
:root[data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f7fa;
  --text-primary: #1a1a2e;
  --text-secondary: #6b7280;
  --accent: #4A90D9;
  --accent-hover: #3a7bc8;
  --border: #e5e7eb;
  --success: #27ae60;
  --warning: #f39c12;
  --error: #e74c3c;
}

:root[data-theme="dark"] {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #e5e7eb;
  --text-secondary: #9ca3af;
  --accent: #5ba0e9;
  --accent-hover: #4a90d9;
  --border: #2d3748;
  --success: #2ecc71;
  --warning: #f1c40f;
  --error: #e74c3c;
}
```

### 布局结构

侧边导航栏布局，包含 5 个页面：

```
┌─────────┬────────────────────────────────────┐
│         │  Header (搜索框 + 主题切换)         │
│ Sidebar │────────────────────────────────────│
│  导航   │                                    │
│         │  Main Content                      │
│  • 搜索 │  (根据选中的页面切换)               │
│  • 下载 │                                    │
│  • 收藏 │                                    │
│  • 设置 │                                    │
│  • 统计 │                                    │
│         │                                    │
└─────────┴────────────────────────────────────┘
```

### 漫画卡片样式

支持两种样式，可在设置中切换：

**样式 A — 封面 + 标题**：
- 封面图为主
- 标题在下方
- 悬停显示更多信息

**样式 B — 详细列表**：
- 横向卡片布局
- 左侧封面缩略图
- 右侧标题、标签、操作按钮

### 下载进度展示

进度条列表样式（无封面缩略图）：
- 每个任务一行
- 显示标题、进度条、状态标签
- 支持批量操作

### 数据统计页面

仪表盘卡片样式：
- 顶部数据卡片（下载数量、存储使用、成功率等）
- 下方柱状图（下载活跃度）
- 类似 GitHub Insights / Vercel Dashboard

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   Electron 主进程                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Python      │  │  IPC        │  │  窗口管理    │  │
│  │  子进程管理   │  │  消息路由    │  │  菜单/托盘   │  │
│  └──────┬───────┘  └──────┬──────┘  └─────────────┘  │
└─────────┼─────────────────┼──────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────┐
│                   Python 后端                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  parser.py   │  │ downloader  │  │ cbz_builder │  │
│  │  (搜索/解析) │  │  (下载管理)  │  │  (打包)     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  config.py   │  │  models.py  │  │  utils.py   │  │
│  │  (配置管理)  │  │  (数据模型)  │  │  (工具函数)  │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
          ▲
          │ IPC (JSON-RPC)
          ▼
┌─────────────────────────────────────────────────────┐
│                Electron 渲染进程 (React)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Sidebar     │  │  SearchPage │  │  Download   │  │
│  │  Navigation  │  │  (搜索页)   │  │  Manager    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Favourites  │  │  Settings   │  │  Statistics  │  │
│  │  (收藏夹)   │  │  (设置页)   │  │  (统计页)   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 前端组件结构

```
src/
├── main/                    # Electron 主进程
│   ├── index.ts             # 入口，窗口创建
│   ├── python-bridge.ts     # Python 子进程管理 & IPC 桥接
│   └── ipc-handlers.ts      # IPC 消息路由
│
├── renderer/                # React 渲染进程
│   ├── App.tsx              # 根组件
│   ├── components/
│   │   ├── Sidebar.tsx      # 侧边导航栏
│   │   ├── Header.tsx       # 顶部栏（搜索框 + 主题切换）
│   │   └── common/          # 通用组件
│   │       ├── ComicCard.tsx      # 漫画卡片（A/B 两种样式）
│   │       ├── ProgressBar.tsx    # 进度条
│   │       └── StatCard.tsx       # 统计卡片
│   │
│   ├── pages/
│   │   ├── SearchPage.tsx        # 搜索页
│   │   ├── DownloadPage.tsx      # 下载管理页
│   │   ├── FavouritesPage.tsx    # 收藏夹页
│   │   ├── SettingsPage.tsx      # 设置页
│   │   └── StatisticsPage.tsx    # 数据统计页
│   │
│   ├── stores/
│   │   ├── useComicStore.ts      # 搜索结果 & 漫画数据
│   │   ├── useDownloadStore.ts   # 下载队列 & 进度
│   │   └── useSettingsStore.ts   # 配置 & 主题
│   │
│   ├── hooks/
│   │   ├── useIpc.ts             # IPC 通信封装
│   │   └── useTheme.ts           # 主题切换逻辑
│   │
│   └── styles/
│       ├── themes.ts             # 主题定义（light/dark）
│       └── global.css            # 全局样式
│
├── shared/                  # 前后端共享类型
│   └── types.ts             # ComicInfo, DownloadTask 等接口定义
│
└── python/                  # Python 后端（现有代码 + IPC 适配层）
    ├── ipc_server.py        # JSON-RPC 服务器
    └── ... (现有文件)
```

### 页面职责

| 页面 | 功能 |
|------|------|
| SearchPage | 搜索框 + 模式切换（关键词/作者/Tag） + 漫画卡片网格 + 分页 |
| DownloadPage | 进度条列表 + 批量操作按钮 + 状态筛选 |
| FavouritesPage | 收藏列表 + 批量下载 |
| SettingsPage | 认证配置、代理、输出格式、卡片样式切换、主题选择 |
| StatisticsPage | 存储使用、下载统计、活跃度图表 |

## IPC 通信设计

### 协议：JSON-RPC 2.0 over stdin/stdout

**请求格式**：
```json
{
  "jsonrpc": "2.0",
  "id": "random-id",
  "method": "search",
  "params": { "query": "关键词", "mode": "keyword", "page": 1 }
}
```

**响应格式**：
```json
{
  "jsonrpc": "2.0",
  "id": "random-id",
  "result": { "comics": [...], "total": 100, "page": 1 }
}
```

### IPC 方法列表

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| search | query, mode, page | { comics, total, page } | 搜索漫画 |
| download | comic_id | { task_id } | 开始下载 |
| get_favourites | - | { comics } | 获取收藏列表 |
| get_config | - | { config } | 获取配置 |
| set_config | key, value | { success } | 更新配置 |
| get_downloads | - | { tasks } | 获取下载队列 |
| cancel_download | task_id | { success } | 取消下载 |

### Python 侧实现（ipc_server.py）

```python
import sys
import json
from parser import MultiSourceParser
from downloader import ComicDownloader
from config import Config

class IPCServer:
    def __init__(self):
        self.parser = MultiSourceParser()
        self.downloader = ComicDownloader()
        self.config = Config()
    
    def handle_request(self, request: dict) -> dict:
        method = request.get("method")
        params = request.get("params", {})
        
        handlers = {
            "search": self.handle_search,
            "download": self.handle_download,
            "get_favourites": self.handle_get_favourites,
            "get_config": self.handle_get_config,
            "set_config": self.handle_set_config,
        }
        
        handler = handlers.get(method)
        if handler:
            result = handler(**params)
            return {"jsonrpc": "2.0", "id": request["id"], "result": result}
        else:
            return {"jsonrpc": "2.0", "id": request["id"], 
                    "error": {"code": -32601, "message": f"Method not found: {method}"}}
    
    def run(self):
        for line in sys.stdin:
            request = json.loads(line)
            response = self.handle_request(request)
            print(json.dumps(response), flush=True)
```

### Electron 主进程（python-bridge.ts）

```typescript
import { spawn, ChildProcess } from 'child_process';
import { ipcMain } from 'electron';

class PythonBridge {
  private process: ChildProcess;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  
  constructor(pythonPath: string) {
    this.process = spawn('python', ['ipc_server.py'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    this.process.stdout.on('data', (data) => {
      const response = JSON.parse(data.toString());
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        pending.resolve(response.result);
        this.pendingRequests.delete(response.id);
      }
    });
  }
  
  async call(method: string, params: any = {}): Promise<any> {
    const id = Math.random().toString(36).slice(2);
    const request = { jsonrpc: '2.0', id, method, params };
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }
}

// 注册 IPC 处理器
ipcMain.handle('python:search', async (_, query, mode, page) => {
  return pythonBridge.call('search', { query, mode, page });
});
```

### React 侧（useIpc.ts）

```typescript
import { useComicStore } from '../stores/useComicStore';

export function useSearch() {
  const { setResults, setLoading } = useComicStore();
  
  const search = async (query: string, mode: string, page: number) => {
    setLoading(true);
    const results = await window.electron.ipcRenderer.invoke('python:search', query, mode, page);
    setResults(results);
    setLoading(false);
  };
  
  return { search };
}
```

## 打包与分发

### 打包工具：Electron Builder

### 打包配置

```json
{
  "build": {
    "appId": "com.hcomic.downloader",
    "productName": "HComic Downloader",
    "directories": {
      "output": "dist"
    },
    "files": [
      "dist-electron/**/*",
      "dist-renderer/**/*",
      "python/**/*",
      "!python/__pycache__",
      "!python/tests"
    ],
    "extraResources": [
      {
        "from": "python/",
        "to": "python/",
        "filter": ["**/*.py", "!**/__pycache__/**", "!**/tests/**"]
      }
    ],
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.ico"
    },
    "mac": {
      "target": ["dmg"],
      "icon": "assets/icon.icns"
    },
    "linux": {
      "target": ["AppImage"],
      "icon": "assets/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    }
  }
}
```

### Python 运行时处理

采用**嵌入式 Python** 方案：
- 打包时包含嵌入式 Python（约 30MB）
- 用户无需安装 Python，开箱即用
- 通过 `extraResources` 打包 Python 和依赖

### 打包后目录结构

```
HComic Downloader/
├── resources/
│   ├── app.asar              # Electron 应用
│   └── python/               # Python 后端
│       ├── python.exe        # 嵌入式 Python
│       ├── Lib/site-packages # 依赖包
│       ├── ipc_server.py
│       ├── parser.py
│       ├── downloader.py
│       └── ...
└── HComic Downloader.exe     # 主程序
```

### 构建命令

```bash
# 开发模式
npm run dev

# 打包
npm run build          # 当前平台
npm run build:win      # Windows
npm run build:mac      # macOS
npm run build:linux    # Linux
```

## 开发计划

### 阶段一：项目初始化
- 创建 Electron + React 项目（electron-vite）
- 配置 Tailwind CSS、TypeScript、ESLint
- 设置目录结构

### 阶段二：Python IPC 桥接
- 实现 ipc_server.py（JSON-RPC 服务器）
- 实现 python-bridge.ts（Electron 主进程桥接）
- 测试 IPC 通信

### 阶段三：核心页面
- 实现 Sidebar + Header 组件
- 实现 SearchPage（搜索、卡片网格、分页）
- 实现 DownloadPage（进度条列表）
- 实现 FavouritesPage（收藏列表）

### 阶段四：设置与统计
- 实现 SettingsPage（认证、代理、主题、卡片样式）
- 实现 StatisticsPage（仪表盘卡片、图表）

### 阶段五：主题系统
- 实现 CSS Variables 主题切换
- 支持 Light / Dark / Auto 模式
- 持久化用户偏好

### 阶段六：打包与测试
- 配置 Electron Builder
- 集成嵌入式 Python
- 跨平台打包测试
- 修复 bug、优化性能

## 设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 技术栈 | Electron + React | 跨平台、生态成熟、打包方便 |
| 后端通信 | Python 子进程 + JSON-RPC | 复用现有代码，最快上线 |
| 状态管理 | Zustand | 轻量、简洁、TypeScript 友好 |
| 样式方案 | Tailwind CSS + CSS Variables | 实用优先、主题切换方便 |
| UI 风格 | 简洁明亮风 | 白色背景 + 蓝色主题，清爽干净 |
| 布局 | 侧边导航栏 | 类似 VS Code / Telegram 风格 |
| 卡片样式 | 可切换（A/B） | 用户可在设置中选择 |
| 下载进度 | 进度条列表（无缩略图） | 简洁直观 |
| 统计页面 | 仪表盘卡片 | 类似 GitHub Insights |
| 主题 | Auto + 手动切换 | 跟随系统 + 用户可选 |
| Python 运行时 | 嵌入式 Python | 开箱即用，无需用户安装 |
