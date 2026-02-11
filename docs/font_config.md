# 中日韩(CJK)字体配置说明

## 概述

本项目已添加跨平台中日韩(CJK)字体支持，会根据操作系统自动选择最佳字体，确保中文、日语、韩文字符都能正确显示。

## 支持的平台

### macOS
| 字体名称 | 说明 |
|---------|------|
| Hiragino Sans | 冬青黑体日文版，**完整支持中日韩**（首选） |
| Hiragino Sans GB | 冬青黑体简体中文版 |
| PingFang SC | 苹方-简（系统默认） |
| STHeiti | 华文黑体 |

### Windows
| 字体名称 | 说明 |
|---------|------|
| MS PGothic | MS P ゴシック，**日语默认字体**，完整支持中日韩（首选） |
| MS PMincho | MS P 明朝 |
| Meiryo | メイリオ（日语清晰字体） |
| Yu Gothic | 游ゴシック（Windows 8.1+） |
| Microsoft YaHei | 微软雅黑（主要支持中文） |
| SimHei | 黑体 |
| SimSun | 宋体 |

### Linux
| 字体名称 | 说明 |
|---------|------|
| Noto Sans CJK JP | 思源黑体日文版，**完整支持中日韩**（首选） |
| Noto Sans CJK SC | 思源黑体简体中文版 |
| Noto Sans CJK TC | 思源黑体繁体中文版 |
| Noto Sans CJK | 思源黑体完整版 |
| WenQuanYi Micro Hei | 文泉驿微米黑 |
| WenQuanYi Zen Hei | 文泉驿正黑 |

## 新增文件

### font_config.py
跨平台中日韩字体配置模块，提供以下功能：
- 自动检测操作系统并选择最佳中日韩字体
- 支持自定义字体配置
- 提供多种字体大小预设（title, subtitle, normal, small, tiny）

## 使用方法

### 代码中使用

```python
from font_config import get_font, get_font_string, configure_font

# 方法 1: 获取字体元组 (用于 tkinter 组件)
font_tuple = get_font("normal", bold=False)  # ('Hiragino Sans', 12, 'normal')
label = tk.Label(root, text="中文文本", font=font_tuple)

# 方法 2: 获取字体字符串
font_str = get_font_string("title", bold=True)  # 'Hiragino Sans 15 bold'

# 方法 3: 直接配置组件
configure_font(label, "normal", bold=False)
```

### GUI 界面设置

在主界面的"设置"区域可以：
1. **字体选择**：从下拉菜单选择字体（默认"自动检测"）
2. **字体大小**：使用微调器调整字体大小（8-20）

## 配置文件

在配置文件中可以设置字体：

```json
{
  "font_name": "",           // 留空表示自动检测
  "font_size": 12            // 基础字体大小
}
```

## 字体大小说明

字体大小基于基础大小（默认 12）按比例计算：

| 预设名称 | 相对倍数 | 12px 基准 | 说明 |
|---------|---------|-----------|------|
| tiny    | 0.75    | 9px       | 极小字 |
| small   | 0.83    | 10px      | 小字 |
| normal  | 1.0     | 12px      | 正文（默认）|
| subtitle| 1.17    | 14px      | 副标题 |
| title   | 1.33    | 16px      | 标题 |

## 字符支持范围

正确显示的字符包括：
- **中文**：简体、繁体汉字
- **日语**：平假名、片假名、日文汉字
- **韩语**：韩文字符
- **英文**：拉丁字母
- **符号**：常见标点符号
