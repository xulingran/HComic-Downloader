# react-code-splitting 规范

## 新增需求

### 需求:首屏只加载 SearchPage 一个页面组件

系统必须使用 `React.lazy()` 将非首屏页面组件拆分为独立异步 chunk。`App.tsx` 中 `SearchPage` 必须保持静态导入（eager），其余 6 个页面（`DownloadPage`、`FavouritesPage`、`HistoryPage`、`SettingsPage`、`ToolboxPage`、`AboutPage`）必须使用 `React.lazy()` 动态导入。

#### 场景:首次渲染只下载 SearchPage chunk

- **当** 用户打开应用且默认路由为搜索页
- **那么** 浏览器网络请求中只包含 SearchPage 的主 bundle chunk
- **且** 其他页面的 JS chunk 不得出现在首次请求中

#### 场景:切换到未加载的页面时自动加载

- **当** 用户点击侧边栏的"设置"按钮
- **那么** 系统自动动态加载 SettingsPage 的 chunk
- **且** 加载期间显示 Suspense fallback（加载指示器）
- **且** 加载完成后正常渲染设置页面

### 需求:模态框（Modal）组件必须代码分割

所有模态框组件（`ComicInfoDrawer`、`ComicReaderModal`、`UpdateDialog`）必须使用 `React.lazy()` 动态导入，在首屏不加载。

#### 场景:ComicInfoDrawer 首次打开时加载

- **当** 用户点击一个漫画卡片首次打开详情抽屉
- **那么** 系统动态加载 `ComicInfoDrawer` 的 chunk
- **且** 加载完成后渲染抽屉内容

### 需求:代码分割后原先的一致行为必须保持

代码分割不得改变已有页面功能和交互行为。所有 lazy 组件加载后必须与静态导入时表现完全相同。

#### 场景:路由参数传递保持一致

- **当** 用户从搜索页跳转到下载页，URL 参数完整传递
- **那么** `DownloadPage` 即使通过 lazy 加载，也必须正确接收所有参数并展示对应内容

#### 场景:状态管理跨代码分割保持

- **当** 用户在搜索页添加下载任务，切换到下载页
- **那么** `DownloadPage`（可能尚未加载）加载后，Zustand store 中的任务列表必须完整

### 需求:Vite 构建必须输出可预期命名的 chunk

`electron.vite.config.ts` 必须配置 `rollupOptions.output.manualChunks`，确保每个 lazy 页面产出独立 chunk 文件（非内联），且文件名稳定（缓存友好）。

#### 场景:每个 lazy 页面对应独立 chunk

- **当** `npm run build` 执行
- **那么** `out/renderer/assets/` 目录下必须包含 `index-*.js`（主入口）、`SearchPage-*.js`、`DownloadPage-*.js` 等独立 chunk
- **且** 不存在将所有页面打包为单个 `index-*.js` 的行为

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