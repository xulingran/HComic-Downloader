# 批量下载功能设计文档

**日期**: 2026-02-11
**作者**: Claude Code
**状态**: 设计已完成，待实现

## 1. 概述

为 HComic Downloader 添加批量下载功能，允许用户通过点击卡片选择多本漫画，然后排队依次下载。

## 2. 核心需求

- 点击卡片进行选中/取消选中
- 选中的卡片有明显的视觉高亮
- 工具栏提供全选/取消/批量下载按钮
- 批量下载前弹出确认对话框
- 采用排队下载模式，依次下载

## 3. 整体架构

### 3.1 选择状态管理

```python
# 新增状态变量
self.selected_comics: Set[ComicInfo] = set()  # 选中的漫画集合
self.is_batch_downloading: bool = False       # 批量下载进行中
```

### 3.2 组件关系

```
┌─────────────────────────────────────────────┐
│ 批量操作工具栏                                │
│  [全选] [取消] [批量下载(N)]                  │
├─────────────────────────────────────────────┤
│ 搜索结果 Canvas                              │
│  ┌──────┐ ┌──────┐ ┌──────┐                 │
│  │ ✓卡1 │ │ 卡片2 │ │ ✓卡3 │   ...          │
│  └──────┘ └──────┘ └──────┘                 │
└─────────────────────────────────────────────┘
```

## 4. 卡片选中交互

### 4.1 视觉反馈

| 状态 | 边框 | 背景 | 图标 |
|------|------|------|------|
| 未选中 | 灰色 solid 1px | 默认 | 无 |
| 已选中 | 蓝色 #2196F3 2px | 淡蓝 #E3F2FD | 右上角 ✓ |

### 4.2 事件处理

```python
frame.bind('<Button-1>', lambda e, c=comic: self._on_card_click(e, c))
```

- 点击卡片切换选中状态
- 下载按钮区域不触发选择（stop propagation）

## 5. 批量操作工具栏

### 5.1 布局位置

在"搜索结果" LabelFrame 内部、canvas 上方

### 5.2 按钮规格

| 按钮 | 文本 | 行为 |
|------|------|------|
| 全选 | "全选" | 选中所有当前搜索结果 |
| 取消 | "取消" | 清空所有选择 |
| 批量下载 | "批量下载(N)" | N≥1 时启用，点击触发批量下载 |

### 5.3 状态同步

每次选择变化时调用 `update_toolbar_buttons()` 更新按钮状态。

## 6. 批量下载流程

### 6.1 确认对话框

```
确认批量下载

即将下载以下 3 本漫画：
1. [漫画标题A]
2. [漫画标题B]
3. [漫画标题C]

是否继续？
```

### 6.2 排队下载逻辑

```python
download_queue = list(selected_comics)
current_index = 0

while current_index < len(download_queue):
    comic = download_queue[current_index]
    下载当前漫画
    current_index += 1
```

### 6.3 进度反馈

- 进度条：当前漫画的下载进度（0-100%）
- 状态栏：`下载中 [2/5]: 正在下载 漫画B`
- 每本完成后短暂显示完成状态

### 6.4 完成汇总

```
批量下载完成

成功: 4 本
失败: 1 本
  - 漫画E: 网络超时
```

## 7. 数据流

```
用户点击卡片
    ↓
_on_card_click(comic)
    ↓
toggle_selection(comic) → 更新 selected_comics
    ↓
update_card_visual(frame, is_selected)
    ↓
update_toolbar_buttons()
```

## 8. 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 搜索结果为空 | 禁用全选按钮 |
| 新搜索触发 | 自动清空选择 |
| 批量下载中 | 禁用预览切换、单个下载 |
| 单本下载失败 | 继续下一本，记录失败 |
| 用户取消 | 停止下载，清理临时文件 |

## 9. 代码变更

### 9.1 新增方法

- `_on_card_click(event, comic)` - 卡片点击处理
- `toggle_selection(comic)` - 切换选中状态
- `select_all()` - 全选
- `clear_selection()` - 清空选择
- `update_card_visual(frame, is_selected)` - 更新卡片样式
- `update_toolbar_buttons()` - 更新按钮状态
- `create_batch_toolbar(parent)` - 创建工具栏
- `batch_download_selected()` - 批量下载入口
- `confirm_batch_download(comics)` - 确认对话框
- `execute_batch_download(comics)` - 执行下载
- `cancel_batch_download()` - 取消下载
- `show_batch_download_summary(results)` - 显示汇总

### 9.2 修改现有方法

- `__init__()` - 添加状态变量
- `create_widgets()` - 添加工具栏
- `display_results()` - 清空选择
- `create_comic_card()` - 添加点击绑定
- `download_comic()` - 添加冲突检查

## 10. 实现优先级

1. 核心选择功能（卡片点击、视觉反馈）
2. 工具栏按钮（全选、取消）
3. 批量下载流程
4. 错误处理与汇总
