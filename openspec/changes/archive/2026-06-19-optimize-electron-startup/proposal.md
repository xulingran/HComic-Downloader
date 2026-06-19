## 为什么

HComic Downloader 的冷启动耗时约 **2-5 秒**，用户从双击图标到看到可交互界面的等待感明显。对比同类下载工具（如 Hakuneko、MangaLoader），启动速度是用户感知质量的关键指标。

启动慢的根本原因在于**启动时序串化**和**提前做了太多不必要的工作**：

1. Python 后端一启动就实例化全部 5 个来源解析器（用户通常只用 1-2 个）
2. React 前端打包成单文件，7 个页面 + 3 个模态框全部在首屏加载
3. IPC 注册串行依赖 Python 子进程就绪
4. 窗口隐藏（`show: false`）直到渲染完毕，用户看到的全是黑屏

## 变更内容

### 新增
- **解析器懒加载**：`MultiSourceParser` 从热启动预创建全部 5 个解析器，改为按需首次访问时创建
- **React 代码分割**：页面和模态框使用 `React.lazy()` + `<Suspense>` 动态加载，首屏只发 SearchPage
- **IPC 注册异步化**：IPC 处理器注册不再阻塞等待 Python 就绪，`bridge.call()` 内部 await pending 连接
- **骨架屏**：窗口创建后立即 `show()` 展示骨架屏 loading 态，Python 就绪后切换真实内容

### 不涉及
- 不改变 Electron 版本或 Chromium 升级
- 不改变 Python 后端架构（IPCServer 或其 Mixin 结构）
- 不改变 IPC 协议（JSON-RPC 2.0 over stdin/stdout）

## 功能 (Capabilities)

### 新增功能

- `parser-lazy-init`: Python 后端 `MultiSourceParser` 的解析器由预创建改为按需懒加载，首次调用 `self.parsers[src]` 时自动构造。不影响运行时搜索/下载行为，只改变初始化时机。

- `react-code-splitting`: React 前端页面级代码分割，使用 `React.lazy()` + `<Suspense fallback={...}>` 将 7 个 page 组件和 3 个 modal 组件拆分为独立 chunk，首屏仅加载 SearchPage。Vite 构建产出物从 1 JS → 多 JS chunk。

- `ipc-startup-async`: Electron 主进程 IPC 处理器注册阶段不再等待 Python 子进程就绪。渲染进程在 Python 就绪前的 IPC 调用自动排队等待，就绪后按序处理。

- `startup-skeleton-screen`: 窗口创建后立即调用 `mainWindow.show()`，展示骨架屏 loading 状态。Python 后端就绪后通过 IPC 通知渲染进程切换真实内容。消除黑屏等待的感知。

### 修改功能

（无现有规范被修改——本次变更均为新增行为，不影响已有规范契约。）

## 影响

**受影响的文件：**

| 文件 | 变更性质 |
|------|---------|
| `sources/__init__.py` | `MultiSourceParser.__init__` 改为懒创建，增加 `_get_or_create_parser()` 方法 |
| `sources/bika/parser.py` | 使其支持无参构造或延迟初始化（可选） |
| `electron/main.ts` | `createWindow` 增加骨架屏逻辑；`registerIPCHandlers` 改为非阻塞 |
| `electron/preload.ts` | 无变化 |
| `src/App.tsx` | 从静态 import 改为 `React.lazy()` + `<Suspense>` |
| `src/pages/*.tsx` | 各页面文件不变，只在 App.tsx 中改为动态导入 |
| `electron.vite.config.ts` | 可能需要调整 `manualChunks` 分配 |
| `src/styles/index.css` | 新增骨架屏 CSS |
| `src/components/Skeleton.tsx` | 新文件：骨架屏组件 |

**不涉及：**
- `python/ipc_server.py` 的 Mixin 结构不变
- Python 解析器内部接口签名不变
- IPC 通道列表（`shared/types.ts`）不变