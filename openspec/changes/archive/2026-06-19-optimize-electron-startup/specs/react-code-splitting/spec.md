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