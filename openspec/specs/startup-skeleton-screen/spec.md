# startup-skeleton-screen 规范

## 目的

定义应用窗口创建后的即时展示、启动骨架屏、无 JavaScript 降级、后端就绪切换及深色模式适配，避免用户在初始化期间看到空白窗口。

## 需求

### 需求:窗口创建后必须立即显示

系统在 `createWindow()` 中创建 `BrowserWindow` 时，**禁止**使用 `show: false` 等待 `ready-to-show`。必须改为创建后立即调用 `mainWindow.show()`，展示骨架屏 loading 态。

#### 场景:窗口创建后 0 延迟显示

- **当** `createWindow()` 执行完毕
- **那么** `mainWindow.show()` 被调用
- **且** `show()` 调用在 `loadFile()` 或 `loadURL()` 之前或之后立即执行（不等待渲染完成）

### 需求:骨架屏必须展示加载中状态

系统必须在渲染就绪前展示骨架屏（skeleton screen）表示加载中状态。骨架屏在 `index.html` 中内联，不依赖 React bundle 加载。

#### 场景:index.html 包含内联骨架屏

- **当** `out/renderer/index.html` 被加载
- **那么** `#root` 容器内包含骨架屏 HTML/CSS
- **且** React 挂载时自动替换骨架屏内容

#### 场景:骨架屏显示加载提示和品牌元素

- **当** 骨架屏展示时
- **那么** 显示应用 logo（或名称" HComic Downloader"）和加载动画（旋转或脉冲）
- **且** 显示"正在加载…"或等效提示文字

### 需求:骨架屏必须在不支持 JS 的环境下降级

系统必须在 `index.html` 的 `<noscript>` 标签中提供骨架屏后备提示，确保禁用了 JavaScript 的用户看到友好提示而非白屏。

#### 场景:JS 禁用时显示后备提示

- **当** 用户浏览器禁用了 JavaScript
- **那么** `<noscript>` 内容显示"请启用 JavaScript 以使用 HComic Downloader"

### 需求:Python 后端就绪时渲染进程切换到真实内容

当 Python 后端就绪后，渲染进程必须过渡到真实 UI。骨架屏的隐藏由 React 接管：`createRoot().render(<App />)` 时自动替换 `#root` 内所有内容。

#### 场景:React 挂载替换骨架屏

- **当** React 应用挂载到 `#root`
- **那么** `#root` 内的骨架屏 HTML 被 React 虚拟 DOM 完全替换
- **且** 用户看到无缝过渡（无闪烁）

### 需求:骨架屏必须适配深色模式

骨架屏的 CSS 必须根据 `prefers-color-scheme: dark` 自动切换深色/浅色主题。

#### 场景:系统深色模式下骨架屏为深色

- **当** 系统为深色模式
- **那么** 骨架屏背景为深色（`#1a1a2e` 或项目当前深色背景色）
- **且** 加载动画和文字使用浅色

#### 场景:系统浅色模式下骨架屏为浅色

- **当** 系统为浅色模式
- **那么** 骨架屏背景为浅色（`#f5f5f5` 或项目当前浅色背景色）
- **且** 加载动画和文字使用深色
