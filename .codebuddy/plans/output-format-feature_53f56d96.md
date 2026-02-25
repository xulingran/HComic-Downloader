---
name: output-format-feature
overview: 在设置面板中新增输出格式选项功能，支持普通文件夹、ZIP、CBZ三种格式
todos:
  - id: add-output-format-config
    content: 在config.py添加output_format配置字段及加载/保存逻辑
    status: completed
  - id: extend-cbz-builder
    content: 扩展cbz_builder.py支持ZIP打包和文件夹保存功能
    status: completed
    dependencies:
      - add-output-format-config
  - id: update-download-manager
    content: 修改download_manager.py根据输出格式执行不同处理
    status: completed
    dependencies:
      - extend-cbz-builder
  - id: update-single-download
    content: 修改gui_app.py单本下载逻辑支持多格式输出
    status: completed
    dependencies:
      - extend-cbz-builder
  - id: add-settings-ui
    content: 在panels/settings_panel.py添加输出格式选择控件
    status: completed
    dependencies:
      - add-output-format-config
  - id: update-conflict-detection
    content: 更新文件冲突检测逻辑适配不同输出格式
    status: completed
    dependencies:
      - extend-cbz-builder
---

## 用户核心需求

为漫画下载项目添加输出格式选项功能，支持三种输出格式：

1. **普通文件夹形式保存**: 下载的图片直接保存到文件夹，不进行打包
2. **压缩为ZIP格式**: 将下载的图片打包为ZIP文件
3. **打包为CBZ格式**: 将下载的图片打包为CBZ格式（保留现有功能，CBZ是漫画阅读器专用格式，本质也是ZIP但扩展名不同且包含ComicInfo.xml元数据）

## 功能要求

- 在设置面板中添加输出格式选择控件
- 配置持久化到config.json
- 下载流程根据选择的格式执行相应的处理逻辑
- 保持向后兼容性，默认使用CBZ格式
- 文件冲突检测需要适配不同输出格式

## 影响范围

- 配置管理模块
- 设置面板UI
- 下载管理器（批量下载）
- 单本下载流程
- 文件冲突检测逻辑

## 技术栈

- Python 3.x
- tkinter (GUI框架)
- 标准库: zipfile, shutil, os

## 技术架构

### 实现策略

采用**策略模式**处理不同输出格式，将格式相关的逻辑封装到独立方法中，通过配置驱动选择执行路径。

### 核心修改点

#### 1. 配置层扩展 (`config.py`)

- 新增 `output_format` 字段，枚举值: "folder", "zip", "cbz"
- 默认值: "cbz"（保持向后兼容）
- 配置加载/保存时包含新字段

#### 2. 打包构建器扩展 (`cbz_builder.py`)

- CBZBuilder类扩展为支持多格式输出
- 新增方法:
- `build_zip()`: 打包为ZIP（类似CBZ但无ComicInfo.xml）
- `save_as_folder()`: 移动临时目录到目标位置
- `get_output_path_for_format()`: 根据格式生成输出路径
- 统一入口方法根据格式分发

#### 3. 下载管理器适配 (`download_manager.py`)

- `ComicDownloadManager._process_task()` 方法修改打包逻辑
- 根据 `output_format` 选择:
- folder: 调用 `shutil.move()` 移动临时目录
- zip/cbz: 调用相应打包方法，完成后清理临时目录

#### 4. 单本下载适配 (`gui_app.py`)

- `_continue_single_download()` 方法修改
- 检测输出格式并执行相应处理
- 更新状态提示文本

#### 5. 设置面板UI (`panels/settings_panel.py`)

- 第1行添加"输出格式"下拉选择框（位于"主题"旁边）
- 值: ["CBZ格式", "ZIP格式", "普通文件夹"]
- 绑定选择事件保存配置

#### 6. 文件冲突检测适配

- `detect_file_conflicts()` 需要根据格式检测:
- folder: 检测文件夹是否存在
- zip/cbz: 检测文件是否存在

### 数据流图

```
用户选择格式 → 保存到config → 下载完成 → 根据format选择处理方式
                                                  ↓
                    ┌─────────────────┬──────────────────┬─────────────────┐
                    ↓                 ↓                  ↓                 │
              folder格式          zip格式            cbz格式               │
                    ↓                 ↓                  ↓                 │
              shutil.move()    build_zip()         build_cbz()            │
                    ↓                 ↓                  ↓                 │
              保留文件夹          创建.zip文件      创建.cbz文件(含元数据)   │
                                                                  ─────────┘
```

### 性能考量

- 文件夹模式避免压缩开销，I/O最少
- ZIP/CBZ模式使用 `zipfile.ZIP_DEFLATED` 压缩级别平衡速度和大小
- 大文件使用流式处理避免内存占用

### 错误处理

- 文件冲突时提供覆盖/跳过选项
- 磁盘空间不足时优雅失败
- 临时目录清理确保不泄漏