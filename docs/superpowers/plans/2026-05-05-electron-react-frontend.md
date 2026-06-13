# HComic Downloader — Electron + React 前端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 tkinter GUI 重构为 Electron + React 前端，保留 Python 后端逻辑，提供现代化桌面应用体验。

**Architecture:** Electron 主进程管理 Python 子进程（JSON-RPC 2.0 over stdin/stdout），React 渲染进程负责 UI 展示，Zustand 管理状态，Tailwind CSS + CSS Variables 实现主题切换。

**Tech Stack:** Electron, React 18, TypeScript, Zustand, Tailwind CSS, Vite, electron-vite, Electron Builder

---

## 文件结构

```
hcomic_downloader/
├── electron/                      # Electron 主进程
│   ├── main.ts                    # 主进程入口
│   ├── python-bridge.ts           # Python 子进程管理
│   └── preload.ts                 # preload 脚本
│
├── src/                           # React 渲染进程
│   ├── App.tsx                    # 根组件
│   ├── main.tsx                   # React 入口
│   ├── components/
│   │   ├── Sidebar.tsx            # 侧边导航栏
│   │   ├── Header.tsx             # 顶部栏
│   │   └── common/
│   │       ├── ComicCard.tsx      # 漫画卡片（A/B 样式）
│   │       ├── ProgressBar.tsx    # 进度条
│   │       └── StatCard.tsx       # 统计卡片
│   ├── pages/
│   │   ├── SearchPage.tsx         # 搜索页
│   │   ├── DownloadPage.tsx       # 下载管理页
│   │   ├── FavouritesPage.tsx     # 收藏夹页
│   │   ├── SettingsPage.tsx       # 设置页
│   │   └── StatisticsPage.tsx     # 数据统计页
│   ├── stores/
│   │   ├── useComicStore.ts       # 搜索结果状态
│   │   ├── useDownloadStore.ts    # 下载队列状态
│   │   └── useSettingsStore.ts    # 配置状态
│   ├── hooks/
│   │   ├── useIpc.ts              # IPC 通信封装
│   │   └── useTheme.ts            # 主题切换
│   └── styles/
│       └── index.css              # Tailwind + CSS Variables
│
├── python/                        # Python 后端
│   ├── ipc_server.py              # JSON-RPC 服务器
│   └── ... (现有文件)
│
├── shared/
│   └── types.ts                   # 共享类型定义
│
├── index.html                     # HTML 入口
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── electron-builder.json5
└── .gitignore
```

---

## 阶段一：项目初始化

### Task 1: 创建 Electron + React 项目

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`

- [ ] **Step 1: 初始化项目，安装依赖**

```bash
npm init -y
npm install react react-dom
npm install -D electron electron-vite vite @vitejs/plugin-react typescript
npm install -D tailwindcss postcss autoprefixer
npm install -D @types/react @types/react-dom @types/node
npm install zustand
```

- [ ] **Step 2: 创建 package.json**

```json
{
  "name": "hcomic-downloader",
  "version": "2.0.0",
  "description": "HComic Downloader - Electron Edition",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "build:win": "npm run build && electron-builder --win",
    "build:mac": "npm run build && electron-builder --mac",
    "build:linux": "npm run build && electron-builder --linux"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.4.0",
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0",
    "electron-vite": "^2.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./shared/*"]
    }
  },
  "include": ["src", "electron", "shared"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: 创建 tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: 创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'electron-vite'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared')
    }
  }
})
```

- [ ] **Step 6: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HComic Downloader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: 创建 src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 8: 创建 src/App.tsx**

```tsx
function App() {
  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <div className="flex-1 flex items-center justify-center">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          HComic Downloader
        </h1>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 9: 创建 electron/main.ts**

```typescript
import { app, BrowserWindow } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    show: false
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

- [ ] **Step 10: 创建 electron/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, callback: (...args: any[]) => void) => {
      ipcRenderer.on(channel, (_, ...args) => callback(...args))
      return () => ipcRenderer.removeAllListeners(channel)
    }
  }
})
```

- [ ] **Step 11: 验证项目启动**

```bash
npm run dev
```

Expected: Electron 窗口打开，显示 "HComic Downloader" 文字

- [ ] **Step 12: 提交**

```bash
git add .
git commit -m "feat: initialize Electron + React project with Vite"
```

---

### Task 2: 配置 Tailwind CSS 和主题系统

**Files:**
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/styles/index.css`
- Create: `src/hooks/useTheme.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--bg-primary)',
        secondary: 'var(--bg-secondary)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        border: 'var(--border)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)'
      }
    }
  },
  plugins: []
}
```

- [ ] **Step 2: 创建 postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
```

- [ ] **Step 3: 创建 src/styles/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

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

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

* {
  box-sizing: border-box;
}
```

- [ ] **Step 4: 创建 src/hooks/useTheme.ts**

```typescript
import { useEffect } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'

type ThemeMode = 'light' | 'dark' | 'auto'

export function useTheme() {
  const { themeMode, setThemeMode } = useSettingsStore()

  useEffect(() => {
    const applyTheme = (mode: 'light' | 'dark') => {
      document.documentElement.setAttribute('data-theme', mode)
    }

    if (themeMode === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mediaQuery.matches ? 'dark' : 'light')

      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light')
      }
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    } else {
      applyTheme(themeMode)
    }
  }, [themeMode])

  return { themeMode, setThemeMode }
}
```

- [ ] **Step 5: 创建 src/stores/useSettingsStore.ts**

```typescript
import { create } from 'zustand'

type ThemeMode = 'light' | 'dark' | 'auto'
type CardStyle = 'cover' | 'detailed'

interface SettingsState {
  themeMode: ThemeMode
  cardStyle: CardStyle
  setThemeMode: (mode: ThemeMode) => void
  setCardStyle: (style: CardStyle) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: 'auto',
  cardStyle: 'cover',
  setThemeMode: (mode) => set({ themeMode: mode }),
  setCardStyle: (style) => set({ cardStyle: style })
}))
```

- [ ] **Step 6: 更新 src/App.tsx**

```tsx
import { useTheme } from './hooks/useTheme'

function App() {
  useTheme()

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <div className="flex-1 flex items-center justify-center">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          HComic Downloader
        </h1>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 7: 验证主题切换**

在浏览器开发者工具中手动修改 `data-theme` 属性，验证颜色变化。

- [ ] **Step 8: 提交**

```bash
git add .
git commit -m "feat: add Tailwind CSS and theme system with light/dark modes"
```

---

### Task 3: 创建共享类型定义

**Files:**
- Create: `shared/types.ts`

- [ ] **Step 1: 创建 shared/types.ts**

```typescript
export interface ComicInfo {
  id: string
  title: string
  url: string
  coverUrl: string
  source: string
  tags?: string[]
  author?: string
  pages?: number
}

export interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalItems: number
}

export interface SearchResult {
  comics: ComicInfo[]
  pagination: PaginationInfo
}

export interface DownloadTask {
  id: string
  comic: ComicInfo
  status: DownloadStatus
  progress: number
  totalPages: number
  downloadedPages: number
  error?: string
}

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled'

export interface AppConfig {
  themeMode: 'light' | 'dark' | 'auto'
  cardStyle: 'cover' | 'detailed'
  outputFormat: 'folder' | 'zip' | 'cbz'
  proxy?: string
  cookie?: string
  userAgent?: string
}

export interface StatisticsData {
  totalDownloads: number
  completedDownloads: number
  failedDownloads: number
  totalSize: number
  downloadsByDay: { date: string; count: number }[]
}

export interface IPCMethods {
  search: {
    params: { query: string; mode: string; page: number }
    result: SearchResult
  }
  download: {
    params: { comicId: string }
    result: { taskId: string }
  }
  get_favourites: {
    params: {}
    result: { comics: ComicInfo[] }
  }
  get_config: {
    params: {}
    result: { config: AppConfig }
  }
  set_config: {
    params: { key: string; value: any }
    result: { success: boolean }
  }
  get_downloads: {
    params: {}
    result: { tasks: DownloadTask[] }
  }
  cancel_download: {
    params: { taskId: string }
    result: { success: boolean }
  }
  get_statistics: {
    params: {}
    result: StatisticsData
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add shared/
git commit -m "feat: add shared TypeScript type definitions"
```

---

## 阶段二：Python IPC 桥接

### Task 4: 实现 Python IPC 服务器

**Files:**
- Create: `python/ipc_server.py`

- [ ] **Step 1: 创建 python/ipc_server.py**

```python
import sys
import json
import logging
from typing import Any, Dict

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class IPCServer:
    def __init__(self):
        from parser import MultiSourceParser
        from downloader import ComicDownloader
        from config import Config
        
        self.parser = MultiSourceParser()
        self.downloader = ComicDownloader()
        self.config = Config()
        self.download_tasks = {}
    
    def handle_search(self, query: str, mode: str = "keyword", page: int = 1) -> Dict:
        results = self.parser.search(query, mode=mode, page=page)
        return {
            "comics": [
                {
                    "id": comic.id,
                    "title": comic.title,
                    "url": comic.url,
                    "coverUrl": comic.get_image_url(0) if hasattr(comic, 'get_image_url') else "",
                    "source": comic.comic_source.value if hasattr(comic, 'comic_source') else "default",
                    "tags": comic.tags if hasattr(comic, 'tags') else [],
                    "author": comic.author if hasattr(comic, 'author') else None,
                    "pages": comic.pages if hasattr(comic, 'pages') else None
                }
                for comic in results.get("comics", [])
            ],
            "pagination": {
                "currentPage": results.get("page", page),
                "totalPages": results.get("total_pages", 1),
                "totalItems": results.get("total", 0)
            }
        }
    
    def handle_download(self, comic_id: str) -> Dict:
        import uuid
        task_id = str(uuid.uuid4())[:8]
        self.download_tasks[task_id] = {"status": "pending", "progress": 0}
        return {"taskId": task_id}
    
    def handle_get_favourites(self) -> Dict:
        try:
            favourites = self.parser.get_favourites()
            return {
                "comics": [
                    {
                        "id": comic.id,
                        "title": comic.title,
                        "url": comic.url,
                        "coverUrl": comic.get_image_url(0) if hasattr(comic, 'get_image_url') else "",
                        "source": comic.comic_source.value if hasattr(comic, 'comic_source') else "default"
                    }
                    for comic in favourites
                ]
            }
        except Exception as e:
            logger.error(f"Get favourites error: {e}")
            return {"comics": []}
    
    def handle_get_config(self) -> Dict:
        return {
            "config": {
                "themeMode": "auto",
                "cardStyle": "cover",
                "outputFormat": self.config.output_format if hasattr(self.config, 'output_format') else "cbz",
                "proxy": self.config.proxy if hasattr(self.config, 'proxy') else None,
                "cookie": self.config.cookie if hasattr(self.config, 'cookie') else None,
                "userAgent": self.config.user_agent if hasattr(self.config, 'user_agent') else None
            }
        }
    
    def handle_set_config(self, key: str, value: Any) -> Dict:
        try:
            if hasattr(self.config, key):
                setattr(self.config, key, value)
                self.config.save()
            return {"success": True}
        except Exception as e:
            logger.error(f"Set config error: {e}")
            return {"success": False}
    
    def handle_get_downloads(self) -> Dict:
        return {
            "tasks": [
                {
                    "id": task_id,
                    "comic": {"id": "", "title": "Download Task", "url": "", "coverUrl": "", "source": ""},
                    "status": task["status"],
                    "progress": task["progress"],
                    "totalPages": 0,
                    "downloadedPages": 0
                }
                for task_id, task in self.download_tasks.items()
            ]
        }
    
    def handle_cancel_download(self, task_id: str) -> Dict:
        if task_id in self.download_tasks:
            self.download_tasks[task_id]["status"] = "cancelled"
            return {"success": True}
        return {"success": False}
    
    def handle_get_statistics(self) -> Dict:
        return {
            "totalDownloads": len(self.download_tasks),
            "completedDownloads": sum(1 for t in self.download_tasks.values() if t["status"] == "completed"),
            "failedDownloads": sum(1 for t in self.download_tasks.values() if t["status"] == "error"),
            "totalSize": 0,
            "downloadsByDay": []
        }
    
    def handle_request(self, request: Dict) -> Dict:
        method = request.get("method")
        params = request.get("params", {})
        
        handlers = {
            "search": self.handle_search,
            "download": self.handle_download,
            "get_favourites": self.handle_get_favourites,
            "get_config": self.handle_get_config,
            "set_config": self.handle_set_config,
            "get_downloads": self.handle_get_downloads,
            "cancel_download": self.handle_cancel_download,
            "get_statistics": self.handle_get_statistics,
        }
        
        handler = handlers.get(method)
        if handler:
            try:
                result = handler(**params)
                return {"jsonrpc": "2.0", "id": request["id"], "result": result}
            except Exception as e:
                logger.error(f"Handler error for {method}: {e}")
                return {"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32000, "message": str(e)}}
        else:
            return {"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32601, "message": f"Method not found: {method}"}}
    
    def run(self):
        logger.info("IPC Server started")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
                response = self.handle_request(request)
                print(json.dumps(response), flush=True)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error: {e}")
            except Exception as e:
                logger.error(f"Unexpected error: {e}")

if __name__ == "__main__":
    server = IPCServer()
    server.run()
```

- [ ] **Step 2: 测试 IPC 服务器**

```bash
echo '{"jsonrpc":"2.0","id":"1","method":"get_config","params":{}}' | python python/ipc_server.py
```

Expected: `{"jsonrpc": "2.0", "id": "1", "result": {"config": {...}}}`

- [ ] **Step 3: 提交**

```bash
git add python/ipc_server.py
git commit -m "feat: implement Python IPC server with JSON-RPC 2.0"
```

---

### Task 5: 实现 Electron Python Bridge

**Files:**
- Create: `electron/python-bridge.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: 创建 electron/python-bridge.ts**

```typescript
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { app } from 'electron'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
}

export class PythonBridge {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private buffer = ''

  constructor() {
    this.start()
  }

  private getPythonPath(): string {
    const isDev = !app.isPackaged
    if (isDev) {
      return 'python'
    }
    return path.join(process.resourcesPath, 'python', 'python.exe')
  }

  private getScriptPath(): string {
    const isDev = !app.isPackaged
    if (isDev) {
      return path.join(__dirname, '..', 'python', 'ipc_server.py')
    }
    return path.join(process.resourcesPath, 'python', 'ipc_server.py')
  }

  private start() {
    const pythonPath = this.getPythonPath()
    const scriptPath = this.getScriptPath()

    this.process = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line)
            const pending = this.pendingRequests.get(response.id)
            if (pending) {
              if (response.error) {
                pending.reject(new Error(response.error.message))
              } else {
                pending.resolve(response.result)
              }
              this.pendingRequests.delete(response.id)
            }
          } catch (e) {
            console.error('Failed to parse IPC response:', e)
          }
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('Python stderr:', data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`Python process exited with code ${code}`)
      this.process = null
    })

    this.process.on('error', (err) => {
      console.error('Failed to start Python process:', err)
    })
  }

  async call(method: string, params: any = {}): Promise<any> {
    if (!this.process) {
      throw new Error('Python process not running')
    }

    const id = Math.random().toString(36).slice(2)
    const request = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.process!.stdin?.write(JSON.stringify(request) + '\n')

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 30000)
    })
  }

  kill() {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}

let bridge: PythonBridge | null = null

export function getPythonBridge(): PythonBridge {
  if (!bridge) {
    bridge = new PythonBridge()
  }
  return bridge
}
```

- [ ] **Step 2: 更新 electron/main.ts**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    show: false
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIPCHandlers() {
  const bridge = getPythonBridge()

  ipcMain.handle('python:search', async (_, query, mode, page) => {
    return bridge.call('search', { query, mode, page })
  })

  ipcMain.handle('python:download', async (_, comicId) => {
    return bridge.call('download', { comic_id: comicId })
  })

  ipcMain.handle('python:get-favourites', async () => {
    return bridge.call('get_favourites')
  })

  ipcMain.handle('python:get-config', async () => {
    return bridge.call('get_config')
  })

  ipcMain.handle('python:set-config', async (_, key, value) => {
    return bridge.call('set_config', { key, value })
  })

  ipcMain.handle('python:get-downloads', async () => {
    return bridge.call('get_downloads')
  })

  ipcMain.handle('python:cancel-download', async (_, taskId) => {
    return bridge.call('cancel_download', { task_id: taskId })
  })

  ipcMain.handle('python:get-statistics', async () => {
    return bridge.call('get_statistics')
  })
}

app.whenReady().then(() => {
  registerIPCHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  const bridge = getPythonBridge()
  bridge.kill()
})
```

- [ ] **Step 3: 提交**

```bash
git add electron/
git commit -m "feat: implement Python bridge with IPC handlers"
```

---

### Task 6: 实现 React IPC Hooks

**Files:**
- Create: `src/hooks/useIpc.ts`

- [ ] **Step 1: 创建 src/hooks/useIpc.ts**

```typescript
import { useCallback } from 'react'

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>
        on: (channel: string, callback: (...args: any[]) => void) => () => void
      }
    }
  }
}

export function useIpc() {
  const invoke = useCallback(async (channel: string, ...args: any[]) => {
    try {
      return await window.electron.ipcRenderer.invoke(channel, ...args)
    } catch (error) {
      console.error(`IPC error on ${channel}:`, error)
      throw error
    }
  }, [])

  return { invoke }
}

export function useSearch() {
  const { invoke } = useIpc()

  const search = useCallback(async (query: string, mode: string, page: number) => {
    return invoke('python:search', query, mode, page)
  }, [invoke])

  return { search }
}

export function useDownload() {
  const { invoke } = useIpc()

  const startDownload = useCallback(async (comicId: string) => {
    return invoke('python:download', comicId)
  }, [invoke])

  const cancelDownload = useCallback(async (taskId: string) => {
    return invoke('python:cancel-download', taskId)
  }, [invoke])

  const getDownloads = useCallback(async () => {
    return invoke('python:get-downloads')
  }, [invoke])

  return { startDownload, cancelDownload, getDownloads }
}

export function useFavourites() {
  const { invoke } = useIpc()

  const getFavourites = useCallback(async () => {
    return invoke('python:get-favourites')
  }, [invoke])

  return { getFavourites }
}

export function useConfig() {
  const { invoke } = useIpc()

  const getConfig = useCallback(async () => {
    return invoke('python:get-config')
  }, [invoke])

  const setConfig = useCallback(async (key: string, value: any) => {
    return invoke('python:set-config', key, value)
  }, [invoke])

  return { getConfig, setConfig }
}

export function useStatistics() {
  const { invoke } = useIpc()

  const getStatistics = useCallback(async () => {
    return invoke('python:get-statistics')
  }, [invoke])

  return { getStatistics }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/hooks/
git commit -m "feat: add React IPC hooks for Python communication"
```

---

## 阶段三：核心页面

### Task 7: 实现 Sidebar 组件

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: 创建 src/components/Sidebar.tsx**

```tsx
import { useState } from 'react'

interface SidebarProps {
  activePage: string
  onPageChange: (page: string) => void
}

const menuItems = [
  { id: 'search', label: '搜索', icon: '🔍' },
  { id: 'downloads', label: '下载管理', icon: '📥' },
  { id: 'favourites', label: '收藏夹', icon: '⭐' },
  { id: 'statistics', label: '数据统计', icon: '📊' },
  { id: 'settings', label: '设置', icon: '⚙️' }
]

export function Sidebar({ activePage, onPageChange }: SidebarProps) {
  return (
    <div className="w-16 bg-[var(--bg-primary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      {menuItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onPageChange(item.id)}
          className={`
            w-10 h-10 rounded-lg flex items-center justify-center text-lg
            transition-all duration-200
            ${activePage === item.id 
              ? 'bg-[var(--accent)] text-white shadow-md' 
              : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
            }
          `}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 更新 src/App.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <main className="flex-1 overflow-auto p-6">
          <div className="text-[var(--text-primary)]">
            Page: {activePage}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 3: 验证侧边栏切换**

```bash
npm run dev
```

Expected: 点击侧边栏图标，页面标识文字变化

- [ ] **Step 4: 提交**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat: implement sidebar navigation component"
```

---

### Task 8: 实现 Header 组件

**Files:**
- Create: `src/components/Header.tsx`

- [ ] **Step 1: 创建 src/components/Header.tsx**

```tsx
import { useState } from 'react'

interface HeaderProps {
  onSearch: (query: string) => void
}

export function Header({ onSearch }: HeaderProps) {
  const [query, setQuery] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      onSearch(query.trim())
    }
  }

  return (
    <header className="h-14 bg-[var(--bg-primary)] border-b border-[var(--border)] flex items-center px-4 gap-4">
      <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索漫画..."
          className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] 
                     text-[var(--text-primary)] placeholder-[var(--text-secondary)]
                     focus:outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
        >
          搜索
        </button>
      </form>
    </header>
  )
}
```

- [ ] **Step 2: 更新 src/App.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const handleSearch = (query: string) => {
    console.log('Search:', query)
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={handleSearch} />
        <main className="flex-1 overflow-auto p-6">
          <div className="text-[var(--text-primary)]">
            Page: {activePage}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 3: 提交**

```bash
git add src/components/Header.tsx src/App.tsx
git commit -m "feat: implement header with search functionality"
```

---

### Task 9: 实现 ComicCard 组件

**Files:**
- Create: `src/components/common/ComicCard.tsx`

- [ ] **Step 1: 创建 src/components/common/ComicCard.tsx**

```tsx
import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'

interface ComicCardProps {
  comic: ComicInfo
  onClick?: (comic: ComicInfo) => void
}

export function ComicCard({ comic, onClick }: ComicCardProps) {
  const { cardStyle } = useSettingsStore()

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} />
  }
  return <CoverCard comic={comic} onClick={onClick} />
}

function CoverCard({ comic, onClick }: ComicCardProps) {
  return (
    <div
      onClick={() => onClick?.(comic)}
      className="bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200 
                 cursor-pointer overflow-hidden group"
    >
      <div className="aspect-[3/4] bg-[var(--bg-secondary)] relative overflow-hidden">
        {comic.coverUrl ? (
          <img
            src={comic.coverUrl}
            alt={comic.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            📖
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">
          {comic.title}
        </h3>
        {comic.author && (
          <p className="text-xs text-[var(--text-secondary)] mt-1 truncate">
            {comic.author}
          </p>
        )}
      </div>
    </div>
  )
}

function DetailedCard({ comic, onClick }: ComicCardProps) {
  return (
    <div
      onClick={() => onClick?.(comic)}
      className="bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200 
                 cursor-pointer overflow-hidden flex"
    >
      <div className="w-20 h-20 bg-[var(--bg-secondary)] flex-shrink-0">
        {comic.coverUrl ? (
          <img
            src={comic.coverUrl}
            alt={comic.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            📖
          </div>
        )}
      </div>
      <div className="flex-1 p-3 flex flex-col justify-center">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {comic.title}
        </h3>
        <div className="flex flex-wrap gap-1 mt-2">
          {comic.tags?.slice(0, 3).map((tag, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/common/ComicCard.tsx
git commit -m "feat: implement comic card component with cover/detailed styles"
```

---

### Task 10: 实现 SearchPage

**Files:**
- Create: `src/pages/SearchPage.tsx`
- Create: `src/stores/useComicStore.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 src/stores/useComicStore.ts**

```typescript
import { create } from 'zustand'
import { ComicInfo, PaginationInfo } from '@shared/types'

interface ComicState {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  isLoading: boolean
  error: string | null
  setComics: (comics: ComicInfo[]) => void
  setPagination: (pagination: PaginationInfo) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useComicStore = create<ComicState>((set) => ({
  comics: [],
  pagination: null,
  isLoading: false,
  error: null,
  setComics: (comics) => set({ comics }),
  setPagination: (pagination) => set({ pagination }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error })
}))
```

- [ ] **Step 2: 创建 src/pages/SearchPage.tsx**

```tsx
import { useState } from 'react'
import { useComicStore } from '../stores/useComicStore'
import { useSearch } from '../hooks/useIpc'
import { ComicCard } from '../components/common/ComicCard'
import { ComicInfo } from '@shared/types'

const searchModes = [
  { value: 'keyword', label: '关键词' },
  { value: 'author', label: '作者' },
  { value: 'tag', label: 'Tag' }
]

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('keyword')
  const { comics, pagination, isLoading, error, setComics, setPagination, setLoading, setError } = useComicStore()
  const { search } = useSearch()

  const handleSearch = async (page: number = 1) => {
    if (!query.trim()) return

    setLoading(true)
    setError(null)

    try {
      const result = await search(query, mode, page)
      setComics(result.comics)
      setPagination(result.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const handleComicClick = (comic: ComicInfo) => {
    console.log('Comic clicked:', comic)
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] 
                     text-[var(--text-primary)]"
        >
          {searchModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="输入搜索内容..."
          className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] 
                     text-[var(--text-primary)] placeholder-[var(--text-secondary)]
                     focus:outline-none focus:border-[var(--accent)]"
        />

        <button
          onClick={() => handleSearch()}
          disabled={isLoading}
          className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] 
                     disabled:opacity-50 transition-colors"
        >
          {isLoading ? '搜索中...' : '搜索'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
          {error}
        </div>
      )}

      {comics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {comics.map((comic) => (
            <ComicCard key={comic.id} comic={comic} onClick={handleComicClick} />
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => handleSearch(pagination.currentPage - 1)}
            disabled={pagination.currentPage <= 1}
            className="px-3 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border)] 
                       disabled:opacity-50"
          >
            上一页
          </button>
          <span className="px-3 py-1 text-[var(--text-primary)]">
            {pagination.currentPage} / {pagination.totalPages}
          </span>
          <button
            onClick={() => handleSearch(pagination.currentPage + 1)}
            disabled={pagination.currentPage >= pagination.totalPages}
            className="px-3 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border)] 
                       disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}

      {!isLoading && comics.length === 0 && (
        <div className="text-center text-[var(--text-secondary)] py-12">
          输入关键词开始搜索
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 更新 src/App.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { SearchPage } from './pages/SearchPage'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      default:
        return <div className="text-[var(--text-primary)]">Coming soon: {activePage}</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={(q) => console.log('Search:', q)} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 4: 验证搜索功能**

```bash
npm run dev
```

Expected: 输入关键词，点击搜索，显示漫画卡片网格

- [ ] **Step 5: 提交**

```bash
git add src/pages/SearchPage.tsx src/stores/useComicStore.ts src/App.tsx
git commit -m "feat: implement search page with comic card grid"
```

---

### Task 11: 实现 ProgressBar 和 DownloadPage

**Files:**
- Create: `src/components/common/ProgressBar.tsx`
- Create: `src/pages/DownloadPage.tsx`
- Create: `src/stores/useDownloadStore.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 src/components/common/ProgressBar.tsx**

```tsx
interface ProgressBarProps {
  progress: number
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled'
  className?: string
}

const statusColors = {
  pending: 'var(--warning)',
  downloading: 'var(--accent)',
  completed: 'var(--success)',
  error: 'var(--error)',
  cancelled: 'var(--text-secondary)'
}

const statusLabels = {
  pending: '等待中',
  downloading: '下载中',
  completed: '完成',
  error: '失败',
  cancelled: '已取消'
}

export function ProgressBar({ progress, status, className = '' }: ProgressBarProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex-1 h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progress}%`,
            backgroundColor: statusColors[status]
          }}
        />
      </div>
      <span
        className="text-xs font-medium px-2 py-0.5 rounded-full"
        style={{
          backgroundColor: `${statusColors[status]}20`,
          color: statusColors[status]
        }}
      >
        {status === 'downloading' ? `${progress}%` : statusLabels[status]}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: 创建 src/stores/useDownloadStore.ts**

```typescript
import { create } from 'zustand'
import { DownloadTask } from '@shared/types'

interface DownloadState {
  tasks: DownloadTask[]
  setTasks: (tasks: DownloadTask[]) => void
  addTask: (task: DownloadTask) => void
  updateTask: (id: string, updates: Partial<DownloadTask>) => void
  removeTask: (id: string) => void
}

export const useDownloadStore = create<DownloadState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id)
    }))
}))
```

- [ ] **Step 3: 创建 src/pages/DownloadPage.tsx**

```tsx
import { useEffect } from 'react'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useDownload } from '../hooks/useIpc'
import { ProgressBar } from '../components/common/ProgressBar'

export function DownloadPage() {
  const { tasks, setTasks, updateTask } = useDownloadStore()
  const { getDownloads, cancelDownload } = useDownload()

  useEffect(() => {
    loadDownloads()
  }, [])

  const loadDownloads = async () => {
    try {
      const result = await getDownloads()
      setTasks(result.tasks)
    } catch (err) {
      console.error('Failed to load downloads:', err)
    }
  }

  const handleCancel = async (taskId: string) => {
    try {
      await cancelDownload(taskId)
      updateTask(taskId, { status: 'cancelled' })
    } catch (err) {
      console.error('Failed to cancel download:', err)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          下载管理
        </h2>
        <button
          onClick={loadDownloads}
          className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] 
                     rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无下载任务
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  {task.comic.title}
                </h3>
                {task.status === 'downloading' && (
                  <button
                    onClick={() => handleCancel(task.id)}
                    className="text-xs text-[var(--error)] hover:underline"
                  >
                    取消
                  </button>
                )}
              </div>
              <ProgressBar progress={task.progress} status={task.status} />
              {task.error && (
                <p className="text-xs text-[var(--error)] mt-2">{task.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 更新 src/App.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      case 'downloads':
        return <DownloadPage />
      default:
        return <div className="text-[var(--text-primary)]">Coming soon: {activePage}</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={(q) => console.log('Search:', q)} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 5: 提交**

```bash
git add src/components/common/ProgressBar.tsx src/pages/DownloadPage.tsx src/stores/useDownloadStore.ts src/App.tsx
git commit -m "feat: implement download page with progress bars"
```

---

### Task 12: 实现 FavouritesPage

**Files:**
- Create: `src/pages/FavouritesPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 src/pages/FavouritesPage.tsx**

```tsx
import { useState, useEffect } from 'react'
import { useFavourites } from '../hooks/useIpc'
import { ComicCard } from '../components/common/ComicCard'
import { ComicInfo } from '@shared/types'

export function FavouritesPage() {
  const [comics, setComics] = useState<ComicInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { getFavourites } = useFavourites()

  useEffect(() => {
    loadFavourites()
  }, [])

  const loadFavourites = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getFavourites()
      setComics(result.comics)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load favourites')
    } finally {
      setIsLoading(false)
    }
  }

  const handleComicClick = (comic: ComicInfo) => {
    console.log('Favourite clicked:', comic)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          收藏夹
        </h2>
        <button
          onClick={loadFavourites}
          className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] 
                     rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      {comics.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无收藏
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {comics.map((comic) => (
            <ComicCard key={comic.id} comic={comic} onClick={handleComicClick} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 更新 src/App.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'
import { FavouritesPage } from './pages/FavouritesPage'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage />
      default:
        return <div className="text-[var(--text-primary)]">Coming soon: {activePage}</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={(q) => console.log('Search:', q)} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 3: 提交**

```bash
git add src/pages/FavouritesPage.tsx src/App.tsx
git commit -m "feat: implement favourites page"
```

---

## 阶段四：设置与统计

### Task 13: 实现 SettingsPage

**Files:**
- Create: `src/pages/SettingsPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 src/pages/SettingsPage.tsx**

```tsx
import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useConfig } from '../hooks/useIpc'

type ThemeMode = 'light' | 'dark' | 'auto'
type CardStyle = 'cover' | 'detailed'
type OutputFormat = 'folder' | 'zip' | 'cbz'

export function SettingsPage() {
  const { themeMode, cardStyle, setThemeMode, setCardStyle } = useSettingsStore()
  const { getConfig, setConfig } = useConfig()
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('cbz')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const result = await getConfig()
      if (result.config.outputFormat) {
        setOutputFormat(result.config.outputFormat as OutputFormat)
      }
    } catch (err) {
      console.error('Failed to load config:', err)
    }
  }

  const handleThemeChange = async (mode: ThemeMode) => {
    setThemeMode(mode)
    await saveConfig('themeMode', mode)
  }

  const handleCardStyleChange = async (style: CardStyle) => {
    setCardStyle(style)
    await saveConfig('cardStyle', style)
  }

  const handleOutputFormatChange = async (format: OutputFormat) => {
    setOutputFormat(format)
    await saveConfig('outputFormat', format)
  }

  const saveConfig = async (key: string, value: any) => {
    setIsSaving(true)
    try {
      await setConfig(key, value)
    } catch (err) {
      console.error('Failed to save config:', err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        设置
      </h2>

      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            主题
          </h3>
          <div className="flex gap-3">
            {(['light', 'dark', 'auto'] as ThemeMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => handleThemeChange(mode)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  themeMode === mode
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            卡片样式
          </h3>
          <div className="flex gap-3">
            {(['cover', 'detailed'] as CardStyle[]).map((style) => (
              <button
                key={style}
                onClick={() => handleCardStyleChange(style)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  cardStyle === style
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                {style === 'cover' ? '封面 + 标题' : '详细列表'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            输出格式
          </h3>
          <div className="flex gap-3">
            {(['folder', 'zip', 'cbz'] as OutputFormat[]).map((format) => (
              <button
                key={format}
                onClick={() => handleOutputFormatChange(format)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  outputFormat === format
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isSaving && (
        <div className="text-sm text-[var(--text-secondary)]">
          保存中...
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 更新 src/App.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { SettingsPage } from './pages/SettingsPage'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <div className="text-[var(--text-primary)]">Coming soon: {activePage}</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={(q) => console.log('Search:', q)} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 3: 提交**

```bash
git add src/pages/SettingsPage.tsx src/App.tsx
git commit -m "feat: implement settings page with theme and card style options"
```

---

### Task 14: 实现 StatCard 和 StatisticsPage

**Files:**
- Create: `src/components/common/StatCard.tsx`
- Create: `src/pages/StatisticsPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 src/components/common/StatCard.tsx**

```tsx
interface StatCardProps {
  title: string
  value: string | number
  icon: string
  color: string
  subtitle?: string
}

export function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <span className="text-xl">{icon}</span>
        </div>
        <span className="text-sm text-[var(--text-secondary)]">{title}</span>
      </div>
      <div className="text-2xl font-bold text-[var(--text-primary)]">
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-[var(--text-secondary)] mt-1">
          {subtitle}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 创建 src/pages/StatisticsPage.tsx**

```tsx
import { useState, useEffect } from 'react'
import { useStatistics } from '../hooks/useIpc'
import { StatCard } from '../components/common/StatCard'
import { StatisticsData } from '@shared/types'

export function StatisticsPage() {
  const [stats, setStats] = useState<StatisticsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { getStatistics } = useStatistics()

  useEffect(() => {
    loadStatistics()
  }, [])

  const loadStatistics = async () => {
    setIsLoading(true)
    try {
      const result = await getStatistics()
      setStats(result)
    } catch (err) {
      console.error('Failed to load statistics:', err)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">加载中...</div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center text-[var(--text-secondary)] py-12">
        无法加载统计数据
      </div>
    )
  }

  const successRate = stats.totalDownloads > 0
    ? Math.round((stats.completedDownloads / stats.totalDownloads) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          数据统计
        </h2>
        <button
          onClick={loadStatistics}
          className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] 
                     rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="总下载"
          value={stats.totalDownloads}
          icon="📥"
          color="var(--accent)"
        />
        <StatCard
          title="已完成"
          value={stats.completedDownloads}
          icon="✅"
          color="var(--success)"
        />
        <StatCard
          title="失败"
          value={stats.failedDownloads}
          icon="❌"
          color="var(--error)"
          subtitle={`${successRate}% 成功率`}
        />
        <StatCard
          title="总大小"
          value={formatSize(stats.totalSize)}
          icon="💾"
          color="var(--warning)"
        />
      </div>

      {stats.downloadsByDay.length > 0 && (
        <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-4">
            下载趋势
          </h3>
          <div className="h-48 flex items-end gap-2">
            {stats.downloadsByDay.map((day, i) => {
              const maxCount = Math.max(...stats.downloadsByDay.map(d => d.count))
              const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-[var(--accent)] rounded-t"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-xs text-[var(--text-secondary)]">
                    {day.date.slice(5)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
```

- [ ] **Step 3: 更新 src/App.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage />
      case 'settings':
        return <SettingsPage />
      case 'statistics':
        return <StatisticsPage />
      default:
        return <div className="text-[var(--text-primary)]">Unknown page</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={(q) => console.log('Search:', q)} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 4: 提交**

```bash
git add src/components/common/StatCard.tsx src/pages/StatisticsPage.tsx src/App.tsx
git commit -m "feat: implement statistics page with dashboard cards"
```

---

## 阶段五：打包与测试

### Task 15: 配置 Electron Builder

**Files:**
- Create: `electron-builder.json5`
- Modify: `package.json`

- [ ] **Step 1: 创建 electron-builder.json5**

```json5
{
  appId: 'com.hcomic.downloader',
  productName: 'HComic Downloader',
  directories: {
    output: 'dist'
  },
  files: [
    'dist-electron/**/*',
    'dist-renderer/**/*'
  ],
  extraResources: [
    {
      from: 'python/',
      to: 'python/',
      filter: ['**/*.py', '!**/__pycache__/**', '!**/tests/**']
    }
  ],
  win: {
    target: ['nsis'],
    icon: 'assets/icon.ico'
  },
  mac: {
    target: ['dmg'],
    icon: 'assets/icon.icns'
  },
  linux: {
    target: ['AppImage'],
    icon: 'assets/icon.png'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true
  }
}
```

- [ ] **Step 2: 更新 package.json scripts**

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "build:win": "npm run build && electron-builder --win",
    "build:mac": "npm run build && electron-builder --mac",
    "build:linux": "npm run build && electron-builder --linux"
  }
}
```

- [ ] **Step 3: 创建 assets 目录和占位图标**

```bash
mkdir -p assets
```

需要添加图标文件：
- `assets/icon.ico` (Windows)
- `assets/icon.icns` (macOS)
- `assets/icon.png` (Linux)

- [ ] **Step 4: 提交**

```bash
git add electron-builder.json5 package.json assets/
git commit -m "feat: configure Electron Builder for packaging"
```

---

### Task 16: 测试完整应用

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 2: 测试搜索功能**

1. 输入关键词搜索
2. 切换搜索模式（关键词/作者/Tag）
3. 点击分页

- [ ] **Step 3: 测试主题切换**

1. 进入设置页面
2. 切换浅色/深色/跟随系统
3. 验证主题变化

- [ ] **Step 4: 测试卡片样式切换**

1. 进入设置页面
2. 切换封面/详细列表样式
3. 验证搜索页面卡片变化

- [ ] **Step 5: 测试打包**

```bash
npm run build:win
```

Expected: 在 `dist/` 目录生成安装包

- [ ] **Step 6: 最终提交**

```bash
git add .
git commit -m "feat: complete Electron + React frontend implementation"
```

---

## 自检清单

- [ ] 所有页面（搜索、下载、收藏、设置、统计）已实现
- [ ] 主题切换（浅色/深色/自动）正常工作
- [ ] 卡片样式切换（封面/详细）正常工作
- [ ] IPC 通信（Python ↔ Electron ↔ React）正常
- [ ] 打包配置完成，可生成可执行文件
- [ ] 无 TODO/TBD 占位符
- [ ] 代码类型完整，无 TypeScript 错误
