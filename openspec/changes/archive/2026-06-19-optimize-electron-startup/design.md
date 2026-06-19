## 上下文

HComic Downloader 当前冷启动串行流程为：

```
app.whenReady()
  ├── createWindow()                       // show: false 隐藏窗口
  │     └── loadFile(index.html)           // 请求 React bundle
  ├── registerIPCHandlers()                // 阻塞等待 Python 子进程就绪
  │     └── getPythonBridge() → start()
  │           ├── spawn python.exe         // ~200-500ms
  │           └── 5 parsers × init         // ~200-400ms
  └── window ready-to-show                 // 用户才看到界面
```

总延迟 ≈ **2-5 秒**，用户看到的是黑屏（`show: false` 导致）。

本设计针对 proposal 中识别的 4 个瓶颈，给出各模块的具体实现方案。

### 约束

- Python 后端接口签名不变（IPC handler 调用方不受影响）
- 不得破坏现有的 Python 测试（`pytest`）
- 不得破坏现有的前端测试（`npm test`）
- 骨架屏必须适配深色/浅色模式

---

## 目标 / 非目标

**目标：**

1. 首屏感知延迟降低至 <1.5 秒（从窗口创建到可交互）
2. 总冷启动时间降低 ≥40%
3. 各优化独立可逆、可单独集成

**非目标：**

- 不优化 Python 自身启动速度（CPython 进程启动时间不在本项目控制内）
- 不替换 Electron 版本或 Chromium 的启动行为
- 不做 Electron 主进程自身的代码分割（主进程 bundle 仅约 1MB）

---

## 决策

### 决策 1: `MultiSourceParser` 使用代理字典实现懒解析器

**方案：** 将 `self.parsers` 从 `dict[str, Parser]` 改为懒代理字典，内部维护 `_parser_registry: dict[str, Callable[[], Parser]]`（工厂函数映射）和 `_parsers: dict[str, Parser]`（缓存），`__getitem__` 时按需创建。

```
class MultiSourceParser:
    def __init__(self, ...):
        self._factory = {
            "hcomic": lambda: HComicParser(...),
            "moeimg": lambda: MoeImgParser(...),
            ...
        }
        self._parsers: dict[str, Parser] = {}
        # 只创建 default_source
        self._parsers[default_source] = self._factory[default_source]()

    def _get_parser(self, name: str) -> Parser:
        if name not in self._parsers:
            self._parsers[name] = self._factory[name]()
        return self._parsers[name]
```

**替代方案考虑：**
- **`__getattr__` 动态代理** → 过于 magic，类型提示丢失
- **`@property` 逐个声明** → 5 个来源需要 5 个 getter，不优雅

**理由：** 显式的 `_get_parser` 方法让类型检查器能正确推导返回值，同时保留了统一分发点进行凭据恢复（moeimg 的 `set_stored_credentials` 等）。

### 决策 2: React 代码分割使用 `React.lazy` + 命名 chunk

**方案：** `App.tsx` 中：

```typescript
// 静态导入 —— 首屏
import SearchPage from './pages/SearchPage'

// 动态导入 —— 非首屏
const DownloadPage = React.lazy(() => import('./pages/DownloadPage'))
const FavouritesPage = React.lazy(() => import('./pages/FavouritesPage'))
// ... 其余页面
const ComicInfoDrawer = React.lazy(() => import('./components/ComicInfoDrawer'))
// ...

// Suspense 包裹路由区域
<Routes>
  <Route path="/" element={
    <Suspense fallback={<PageSkeleton />}>
      <SearchPage />
    </Suspense>
  } />
  <Route path="/download" element={
    <Suspense fallback={<PageSkeleton />}>
      <DownloadPage />
    </Suspense>
  } />
  // ...
</Routes>
```

`vite.config.ts` 增加 `manualChunks`：

```typescript
rollupOptions: {
  output: {
    manualChunks: {
      'react-vendor': ['react', 'react-dom', 'react-router-dom'],
      'framer-motion': ['framer-motion'],
    }
  }
}
```

**替代方案考虑：**
- **`loadable-components` 库** → 引入额外依赖，`React.lazy` 是原生 API 无需依赖
- **全部改为 dynamic import** → SearchPage 也 lazy 会让首屏多一次网络往返

**理由：** `React.lazy` 是 React 18 原生支持，Vite 天然支持 dynamic import 作为代码分割点。保持 SearchPage 为静态 import 确保首屏零额外延迟。

### 决策 3: `registerIPCHandlers` 早注册 + `bridge.waitForReady()`

**方案：**

1. `PythonBridge` 新增 `_readyResolve` / `_readyPromise` 字段，在 `start()` 中创建 pending Promise
2. **ready 信号时机：** 不在 `spawn()` 返回时 resolve（Python 还在导入模块），而是在 `handleStdoutData` 首次收到 stdout 数据时 resolve（Python 已完成初始化并开始响应）
3. **进程终止处理：** `handleProcessFailure` 和 `kill()` 中放弃旧 gate（`_readyResolve = null`，`_readyPromise = Promise.resolve()`），让 `call()` 立即抛 "not running" 而非永久挂起。重启由 `start()` 重入时创建全新 gate
4. `registerIPCHandlers()` 改为两步：
   - 第一步：创建 `bridge = getPythonBridge()`（但不 await start）
   - 第二步：注册所有 `ipcMain.handle(...)`，handler 内部 await `bridge.waitForReady()`
5. `call()` 三路径分流：进程就绪直接用；进程未启动且 gate pending 则等 ready；进程已死（gate 已放弃）则立即抛错

```typescript
class PythonBridge {
  private _readyResolve: (() => void) | null = null
  private _readyPromise: Promise<void> = Promise.resolve()

  private start(): void {
    // 创建 pending gate，等首次 stdout 数据
    this._readyResolve = null
    this._readyPromise = new Promise((resolve) => { this._readyResolve = resolve })
    this.process = spawn(...)
    // 不在这里 resolve —— 等 handleStdoutData 首次触发
  }

  private handleStdoutData(data, proc) {
    // 首次 stdout → Python 已启动并响应
    if (this._readyResolve !== null) {
      this._readyResolve()
      this._readyResolve = null
    }
    // ...
  }

  // 进程终止时放弃 gate（handleProcessFailure / kill 共用）
  // _readyResolve = null; _readyPromise = Promise.resolve()

  async waitForReady(): Promise<void> { return this._readyPromise }
}
```

**为什么不在 spawn 返回时 resolve：** Python 后端 spawn 成功后仍需 200-500ms 完成模块导入和 Mixin 初始化（这正是 Phase 2 想优化的耗时）。spawn 返回时 stdin 可写但 Python 还没准备好处理 RPC，此时发请求会堆积在 Python stdin 缓冲区。

**替代方案考虑：**
- **`bridge.call()` 内部隐式等待** → 也可行，但显式 `waitForReady()` 让 handler 意图更清晰，且方便调试
- **Python 后端输出 `"ready"` 字符串** → 需要改 Python，且首个 RPC 响应本身就是 ready 信号，无需额外协议

**理由：** 改动集中在 `python-bridge.ts`，IPC handler 只需每处加一行 `await bridge.waitForReady()`，侵入小。

### 决策 4: 骨架屏内联在 `index.html`，CSS 变量驱动深色模式

**方案：** 在 `index.html` 的 `<div id="root">` 内直接写骨架屏 HTML/CSS：

```html
<style>
  .skeleton { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
  .skeleton { background: #f5f5f5; color: #333; }
  @media (prefers-color-scheme: dark) {
    .skeleton { background: #1a1a2e; color: #e0e0e0; }
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .skeleton-logo { width: 64px; height: 64px; border-radius: 12px; background: #4a90d9; margin-bottom: 24px; animation: pulse 1.5s ease-in-out infinite; }
  .skeleton-text { width: 240px; height: 20px; background: #ccc; border-radius: 4px; animation: pulse 1.5s ease-in-out infinite; }
</style>
<div id="root">
  <div class="skeleton">
    <div class="skeleton-logo"></div>
    <div class="skeleton-text">HComic Downloader 启动中…</div>
  </div>
</div>
<noscript>请启用 JavaScript 以使用 HComic Downloader</noscript>
```

React 挂载时：`createRoot(document.getElementById('root')!).render(<App />)` 自动替换骨架屏 —— 不需要额外逻辑。

**替代方案考虑：**
- **Electron 启动后 JS 注入 skeleton** → 增加了复杂性，且骨架屏需要等 JS 执行才能显示
- **外部 HTML 文件 + iframe** → 过度工程

**理由：** 内联 HTML 是零依赖、零网络请求的方案。React 的 `createRoot` 天然替换 `#root` 内容，骨架屏消失不需要额外逻辑。

### 决策 5: 实现顺序（Phase 1 → Phase 2 → Phase 3）

按依赖关系和风险排序：

| Phase | 内容 | 依赖 | 风险 |
|-------|------|------|------|
| **Phase 1** | 骨架屏 (`index.html` + `mainWindow.show()`) | 无 | 极低 —— 只改 HTML 和 2 行 TS |
| **Phase 2** | 解析器懒加载 (`sources/__init__.py`) | 无 | 低 —— 纯 Python 重构，有测试覆盖 |
| **Phase 3** | React 代码分割 (`App.tsx` + vite config) | Phase 1（Suspense fallback 复用骨架屏样式） | 中 —— 需验证 lazy 组件行为一致性 |
| **Phase 4** | IPC 注册异步化 (`python-bridge.ts` + `main.ts`) | Phase 2（Python 启动变快后此优化收益略减） | 中 —— 涉及控制流变更，需测试重启场景 |

---

## 风险 / 权衡

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| React.lazy 加载时网络延迟导致白屏闪烁 | 低 | 中 | Suspense fallback 使用骨架屏风格，过渡自然 |
| 懒解析器首次访问的性能开销（冷启动转冷访问） | 低 | 低 | 解析器构造仅执行一次，后续缓存。相比每次启动预创建 5 个，总量不变 |
| IPC handler 中加 `await waitForReady()` 遗漏导致崩溃 | 中 | 高 | 所有 handler 统一通过 `wrapHandler` 高阶函数包装，自动 await |
| 骨架屏在 React 挂载前闪烁 | 低 | 低 | 内联 CSS 与 React 同一层，替换原子化，肉眼不可见 |
| Python 崩溃重启后 `_readyPromise` 未重置 | 中 | 高 | `start()` 内部每次重新创建 `_readyPromise`；重启路径已验证 |