## 上下文

`HComicDownloaderGUI`（`gui_app.py`，2847 行）是一个 tkinter God Class，承担了应用的全部 GUI 逻辑。它持有 30+ 状态变量，管理 6 种后台线程模式，并直接操作 UI 组件、业务服务和持久化配置。

现有的 Panel 抽象层（`SearchPanel`、`DownloadPanel`）采用 `_call_host()` 反向委托模式，没有真正封装任何逻辑，反而增加了间接调用的困惑。`SettingsPanel` 创建了控件但按钮命令由主类绑定，导致主类仍需提升（hoist）15+ 个 `tk.Variable` 引用到自身。

约束：
- 所有 UI 操作必须在 tkinter 主线程执行
- 组件之间通过 `self.after(0, callback)` 从后台线程回到主线程
- tkinter 的 widget 创建需要 parent 引用，组件间天然共享 widget 树

## 目标 / 非目标

**目标：**

- 将 `gui_app.py` 从 ~2847 行缩减至 ~400 行（瘦壳）
- 每个新模块不超过 ~600 行，拥有明确的单一职责
- 消除 `_call_host()` 反向委托模式和变量提升反模式
- 保持渐进式迁移：每一步完成后应用仍可正常运行
- 所有现有用户可见行为不变（纯内部重构）

**非目标：**

- 不改变 UI 布局或视觉效果
- 不引入新的外部依赖（如 asyncio、观察者框架）
- 不改变数据模型（`ComicInfo`、`PaginationInfo` 等）
- 不重构 `DownloadManagerUI`、`DownloadManager`、`ThemeManager` 等已有独立模块
- 不添加自动化测试（虽然重构后更容易添加）

## 决策

### 决策 1：使用普通类而非 Mixin 或继承

**选择**：每个模块是一个普通 Python 类，不继承 `tk.Widget`。

**理由**：Mixin 模式在 tkinter 社区常见（如 IDLE），但它只是把大文件切成多个文件，`self` 仍然是同一个对象，状态冲突没有解决。普通类强制每个模块管理自己的状态，通过构造函数接收依赖。

**替代方案**：
- Mixin 分层：状态仍共享在同一个 `self` 上，无法隔离
- 完全独立的 `tk.Frame` 子类：组件间通信成本过高，不适合 tkinter

### 决策 2：模块间通过回调和主类协调通信

**选择**：模块不直接互相调用。主类持有所有模块的引用，负责转发事件和共享数据。

```
SearchController.display_results(results)
  → 主类收到回调
    → 通知 CoverLoader 加载封面
    → 通知 DownloadController 搜索结果已更新
```

**理由**：tkinter 没有 EventBus，强行引入观察者模式会增加不必要的复杂度。主类作为协调中心是最简单、最 tkinter-idiomatic 的方式。

### 决策 3：统一的线程调度接口

**选择**：所有模块通过一个 `schedule_on_main(callback)` 函数回到主线程，不直接使用 `root.after(0, ...)`。

**理由**：当前代码中 `self.after(0, ...)` 散布在各处，模块化后每个模块都需要 root 引用才能调用。统一接口使模块不依赖具体的 root widget。

### 决策 4：迁移顺序由依赖最少到最多

**选择**：ScrollHandler → CoverLoader → SearchController → DownloadController

**理由**：
- `ScrollHandler` 零业务依赖，纯事件处理，最安全
- `CoverLoader` 只依赖 `parser.session` 和回调
- `SearchController` 依赖 parser + 状态，但与下载逻辑几乎无交集
- `DownloadController` 依赖最多，最后处理

每步完成后运行应用验证，确保功能不变。

### 决策 5：消除变量提升，各模块通过方法暴露状态

**选择**：不再把 `SettingsPanel` 的 `tk.Variable` 复制到主类。主类需要读取设置时，调用 `settings_panel.get_download_dir()` 等方法。

**理由**：变量提升导致同一个对象有两个引用路径（`self.download_dir_var` 和 `self.settings_panel.download_dir_var`），修改时容易遗漏。

## 风险 / 权衡

- **[风险] 重构期间引入回归 bug** → 每步迁移后手动验证关键流程（搜索、翻页、单个下载、批量下载、设置面板、主题切换）
- **[风险] 过度拆分导致简单改动需要跨多个文件** → 每个模块保持在 300-600 行，不过度颗粒化。仅在模块间有明确边界时拆分
- **[权衡] 主类作为协调中心仍有一定复杂度** → 可接受。主类 ~400 行只做装配和转发，不含业务逻辑
- **[风险] 状态归属争议（如 `is_downloading` 被多处使用）** → 互斥状态（`is_downloading`、`is_batch_downloading`、`is_preparing_details`）统一放在一个 `AppState` 数据类中，各模块通过引用共享
