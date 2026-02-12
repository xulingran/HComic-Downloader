# 深色模式支持设计文档

## 概述

为 HComic Downloader 添加深色模式支持，解决 macOS 深色模式下标题文字不可见的问题，同时保证 Windows 用户的跨平台体验。

## 需求

1. **自动检测系统主题** — 应用启动时检测 macOS/Windows 系统主题设置
2. **手动覆盖选项** — 提供"自动 / 浅色 / 深色"三选一，默认"自动"
3. **立即生效** — 切换主题后界面立即刷新，无需重启
4. **系统原生配色** — 使用系统 API 获取配色，与系统应用外观一致

## 架构设计

### 新增模块：theme_manager.py

```
theme_manager.py
├── ThemeMode (Enum)
│   ├── AUTO = "auto"
│   ├── LIGHT = "light"
│   └── DARK = "dark"
└── ThemeManager (Singleton)
    ├── get_instance() -> ThemeManager
    ├── current_theme -> str  # 返回 'light' 或 'dark'
    ├── get_color(key: str) -> str
    ├── register_callback(callback: Callable)
    └── set_mode(mode: ThemeMode)
```

### 系统主题检测

#### macOS

```python
def _detect_macos_theme() -> str:
    result = subprocess.run(
        ["defaults", "read", "-g", "AppleInterfaceStyle"],
        capture_output=True, text=True
    )
    # 返回码0且有输出 "Dark" = 深色模式
    # 返回码非0或输出为空 = 浅色模式
```

#### Windows

```python
def _detect_windows_theme() -> str:
    import winreg
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
        r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
    value, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
    # 0 = 深色, 1 = 浅色
```

### 颜色键定义

| 键名 | 用途 | 浅色模式 | 深色模式 |
|------|------|---------|---------|
| `background` | 主背景色 | 系统默认 | 系统默认 |
| `card_bg` | 卡片背景色 | ttk.TFrame 背景 | ttk.TFrame 背景 |
| `text` | 主要文字（标题） | 黑色 | 白色/浅灰 |
| `text_secondary` | 次要文字（作者、页数） | 灰色 | 浅灰色 |
| `accent` | 强调色（选中状态） | #2196F3 | #64B5F6 |
| `border` | 边框颜色 | 系统默认 | 系统默认 |
| `insert` | 光标颜色 | 黑色 | 白色 |

## GUI 改动

### 设置面板新增主题选择

在 `gui.py` 设置区域添加：

```python
ttk.Label(settings_frame, text="主题:").grid(...)
self.theme_mode_var = tk.StringVar(value=config.theme_mode)
theme_combo = ttk.Combobox(
    settings_frame,
    textvariable=self.theme_mode_var,
    values=["自动", "浅色", "深色"],
    state="readonly",
    width=10
)
theme_combo.bind("<<ComboboxSelected>>", self._on_theme_change)
```

### 主题切换立即生效

```python
def _on_theme_change(self, event=None):
    mode_str = self.theme_mode_var.get()
    mode = {"自动": ThemeMode.AUTO, "浅色": ThemeMode.LIGHT, "深色": ThemeMode.DARK}[mode_str]

    theme_manager = ThemeManager.get_instance()
    theme_manager.set_mode(mode)

    # 保存配置
    self.config.theme_mode = mode.value
    self.config.save()

def _on_theme_change_refresh(self):
    """主题变化时刷新界面"""
    for frame in self.result_frames:
        self._update_card_colors(frame)
    if hasattr(self, 'download_manager_ui'):
        self.download_manager_ui.refresh_theme()
```

### 替换硬编码颜色

`gui.py` 中需要改动的地方：

| 行号 | 原代码 | 改为 |
|------|--------|------|
| 1666 | `fg="black"` | `fg=theme_manager.get_color("text")` |
| 1667 | `insertbackground="black"` | `insertbackground=theme_manager.get_color("insert")` |
| 1682 | `fg="gray"` | `fg=theme_manager.get_color("text_secondary")` |
| 1688 | `insertbackground="black"` | `insertbackground=theme_manager.get_color("insert")` |
| 1696 | `foreground="gray"` | `foreground=theme_manager.get_color("text_secondary")` |

`download_manager_ui.py` 中需要改动的地方：

| 行号 | 原代码 | 改为 |
|------|--------|------|
| 55 | `bg="#f0f0f0"` | `bg=theme_manager.get_color("background")` |
| 100 | `bg="#f0f0f0"` | `bg=theme_manager.get_color("background")` |
| 494 | `foreground="black"` | `foreground=theme_manager.get_color("text")` |

## 配置改动

### config.py 新增字段

```python
@dataclass
class Config:
    # ... 现有字段 ...
    theme_mode: str = "auto"  # "auto" | "light" | "dark"
```

## 跨平台注意事项

### macOS

- `ttk` 使用原生 Cocoa 控件
- `ttk.Style().lookup("TFrame", "background")` 能正确返回深浅模式颜色
- 系统主题变化时可监听 `NSApplication.didChangeEffectiveAppearanceNotification`（Python 中通过轮询或定时检查实现）

### Windows

- `ttk` 使用 `vista` 或 `xpnative` 主题
- 深色模式下 `ttk` 控件可能不会自动变深，需手动设置非 ttk 控件颜色
- Windows 10/11 的深色模式 API 有限，部分控件可能需要自定义配色

### Linux

- 依赖桌面环境（GNOME/KDE）
- 可回退到自定义配色方案
- 通过检查 `GTK_THEME` 或 `QT_STYLE_OVERRIDE` 环境变量获取主题信息

## 实现步骤

1. 创建 `theme_manager.py` 模块
2. 修改 `config.py` 添加 `theme_mode` 字段
3. 修改 `gui.py`:
   - 初始化 ThemeManager
   - 添加主题设置 UI
   - 替换硬编码颜色
   - 实现主题变化回调刷新
4. 修改 `download_manager_ui.py`:
   - 替换硬编码颜色
   - 实现 `refresh_theme()` 方法
5. 测试各平台深浅模式切换

## 测试清单

- [ ] macOS 深色模式下启动应用，标题文字可见
- [ ] macOS 浅色模式下启动应用，标题文字可见
- [ ] macOS 运行中切换系统主题，应用立即响应
- [ ] Windows 10/11 深色模式验证
- [ ] 手动切换"自动 → 深色"立即生效
- [ ] 手动切换"深色 → 浅色"立即生效
- [ ] 主题偏好持久化，重启后保持设置
- [ ] 下载管理器面板颜色正确更新
- [ ] 所有卡片标题、作者、页数文字可读
- [ ] 光标颜色在深色模式下可见
