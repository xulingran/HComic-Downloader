# HComic Downloader 项目改进设计方案

日期：2026-02-23
方案：渐进式面板拆分（方案 A）

## 总体策略

先重构再加功能，分五个阶段渐进推进。每个阶段独立可验证，不影响现有功能。

## 第一阶段：提交现有变更并稳定基线

- 审查当前所有未提交变更（约1865行新增），按功能分组提交
  - 多源解析（parser.py + MoeImgParser）
  - 下载管理器 UI（download_manager.py, download_manager_ui.py）
  - 动画调整
  - 新测试文件
  - 新增文件（gui_logic.py, run.bat）
- 确保所有现有测试通过
- 标记 git tag 作为重构前基线

## 第二阶段：GUI 面板拆分

### 目标文件结构

```
gui.py                    → 主窗口类（~200行），负责布局组装和面板协调
panels/__init__.py
panels/search_panel.py    → 搜索栏 + 结果列表 + 分页
panels/download_panel.py  → 下载管理器面板（复用 download_manager_ui.py）
panels/settings_panel.py  → 设置面板（代理、字体、主题、认证）
panels/comic_card.py      → 单个漫画卡片组件
panels/status_bar.py      → 底部状态栏
```

### 面板间通信

回调函数注入，不引入事件总线：

```python
class HComicDownloaderGUI(tk.Tk):
    def __init__(self):
        self.search_panel = SearchPanel(self, on_download=self._handle_download)
        self.download_panel = DownloadPanel(self, ...)
        self.settings_panel = SettingsPanel(self, on_config_change=self._handle_config_change)
```

每个面板类继承 `tk.Frame`，管理自己的 UI 和局部状态。

### 拆分顺序

1. SettingsPanel（最独立，依赖最少）
2. ComicCard（可复用组件）
3. SearchPanel（依赖 ComicCard）
4. StatusBar
5. DownloadPanel（已基本独立，适配接口即可）

## 第三阶段：稳定性与健壮性修复

### 3.1 下载管理器轮转逻辑修复

`_get_next_task_locked()` 中计数器逻辑可能导致无限循环。修复：改用集合记录已检查的 task_id，遍历一轮后即退出。

### 3.2 Parser 容错增强

- `_extract_payload_data()` 正则匹配添加 fallback 策略
- 网络请求统一超时和重试
- 解析失败返回有意义的错误信息

### 3.3 下载器错误处理

- 单页失败不中断整本下载
- 失败页面记录到 `DownloadTask.failed_pages`，完成后提示可重试

## 第四阶段：下载进度反馈增强

### 4.1 进度信息丰富化

DownloadTask 增加运行时统计：下载速度、已下载数据量、当前页码。

DownloadItemWidget 展示：
- 进度条 + 百分比（已有）
- `3/25页 | 1.2 页/秒`
- 失败页数提示

### 4.2 批量下载总览

下载面板顶部显示：`下载中 2/10 | 已完成 5 | 失败 1 | 排队 2` + 整体进度条。

### 4.3 下载完成通知

- 单本完成：状态栏短暂提示
- 全部完成：弹出汇总（成功数、失败数、失败列表）

## 第五阶段：代码质量与工程化

### 5.1 减少测试对 Tk 的依赖

- 扩展 gui_logic.py，提取更多可测试逻辑
- 面板业务逻辑独立测试
- Tk 测试统一 fixture 管理

### 5.2 补充关键路径测试

- 下载管理器任务状态转换
- Parser 解析失败 fallback 路径
- 配置加载/保存边界情况

### 5.3 类型注解

- 仅为新增/修改的公共 API 方法添加类型注解
- 不对未改动代码补充注解
