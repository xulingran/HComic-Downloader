## 为什么

`HComicDownloaderGUI` 是一个 2847 行的 God Class，承担了 UI 构建、搜索导航、下载管理、封面加载、滚动处理、主题样式、设置面板动画等全部职责。30+ 个状态变量纠缠在一起，任何修改都需要理解整个类的上下文，维护成本持续增长。

现在拆分是因为：类还在持续增长（最近新增了下载管理器、主题系统、多来源支持），越晚拆分成本越高。

## 变更内容

- 将 `HComicDownloaderGUI` 拆分为 5 个职责明确的模块：
  - **ScrollHandler** — 跨平台滚动事件处理
  - **CoverLoader** — 封面图片异步加载、缓存、滚动期间延迟刷新
  - **SearchController** — 搜索、翻页、来源切换、结果展示、布局
  - **DownloadController** — 单个下载、批量下载、队列管理、文件冲突检测
  - **HComicDownloaderGUI**（瘦壳）— 初始化、组件装配、生命周期、主题、设置
- 删除 `SearchPanel` 和 `DownloadPanel` 的 `_call_host` 委托代理模式，让新模块直接拥有自己的逻辑
- 将设置面板动画逻辑从主类移入 `SettingsPanel` 或独立模块
- 消除变量提升（variable hoisting），各模块通过公共方法暴露所需状态

## 功能 (Capabilities)

### 新增功能

- `scroll-handler`: 跨平台滚动事件处理器，封装 MouseWheel / TouchpadScroll / Button-4/5 事件分发
- `cover-loader`: 封面图片异步加载器，管理线程池、图片缓存、滚动期间的延迟刷新策略
- `search-controller`: 搜索与导航控制器，管理搜索状态、翻页、来源切换、结果渲染
- `download-controller`: 下载控制器，管理单个下载、批量下载、详情预取、文件冲突检测、队列集成

### 修改功能

（无 — 此次变更为纯内部重构，不改变任何用户可见行为）

## 影响

- **代码结构**: `gui_app.py` 从 ~2847 行缩减至 ~400 行；新增 4 个模块文件
- **现有 Panel**: `panels/search_panel.py` 和 `panels/download_panel.py` 的委托代理模式将被移除或重构
- **测试**: 纯重构，不改变外部行为，现有手动测试流程不变
- **依赖**: 无新外部依赖
