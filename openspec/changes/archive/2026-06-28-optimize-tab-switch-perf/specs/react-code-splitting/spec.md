# react-code-splitting 规范（增量）

## 新增需求

### 需求:高频 lazy chunk 必须在应用就绪后空闲预热

系统**必须**在应用启动就绪后（`startupProgress.done` 为 true）的浏览器空闲窗口内，静默预加载高频 lazy chunk，作为按需加载的性能补充——不改变 lazy 本身的语义（页面仍按需渲染），而是把首次访问的下载/编译成本前移到用户无感知的空闲期。

预热**必须**通过 `requestIdleCallback`（不支持时降级为 `setTimeout`）调度，**禁止**阻塞首屏渲染，**禁止**在应用未就绪时触发。预加载仅触发模块加载到内存，**禁止**在预加载阶段渲染对应组件。

高频预热清单**必须**包含：`ComicInfoDrawer`、`ComicReaderModal`、`DownloadPage`、`FavouritesPage`、`HistoryPage`、`SettingsPage`。低频 chunk（`ToolboxPage`、`MaintenancePage`、`AboutPage`、`UpdateDialog`）**禁止**预热，保持首次访问时才加载。

#### 场景:应用就绪后空闲时预加载高频页面

- **当** 应用启动完成（`startupProgress.done` 变为 true）且浏览器进入空闲窗口（`requestIdleCallback` 回调触发）
- **那么** 系统依次触发高频 lazy chunk 的 `import()`（仅加载模块，不渲染）
- **且** 预加载过程对用户无感知（不显示任何加载态、不阻塞交互）

#### 场景:预热后首次切到高频页面无 chunk 下载等待

- **当** idle prefetch 完成后，用户首次点击「下载」tab
- **那么** 下载页 chunk 已在内存，无需等待网络或磁盘加载
- **且** 直接进入 React 挂载阶段

#### 场景:应用未就绪时不触发预加载

- **当** 应用仍在启动中（`startupProgress.done` 为 false，StartupScreen 仍显示）
- **那么** **禁止**触发任何 lazy chunk 预加载
- **且** 避免与启动流程竞争主线程资源

#### 场景:低频页面保持按需加载

- **当** 用户首次点击「工具箱」或「关于」tab
- **那么** 这些低频页面的 chunk 未被预热，此时才触发加载
- **且** 加载期间显示 Suspense fallback
