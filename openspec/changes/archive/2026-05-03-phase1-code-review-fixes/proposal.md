## 为什么

Pragmatic Clean Code 审查（L3 Team 级别）发现 14 个问题。Phase 1 聚焦 8 个低风险、高收益的独立修复：消除安全隐患（裸 except 吞掉 KeyboardInterrupt）、清理死代码、消除重复、修复组织问题。这些改动互不依赖，可一次性完成，不会改变任何外部行为。

## 变更内容

1. **修复裸 except**（gui_app.py）：4 处 `except:` → 具体异常类型，避免吞掉 `KeyboardInterrupt`/`SystemExit`
2. **删除 ComicCard 死代码**（panels/comic_card.py）：删除未使用的 `ComicCard` 类（~65 行），保留实际使用的 `build_comic_card_frame` 纯函数
3. **提取 cbz_builder 重复 fallback**（cbz_builder.py）：3 处相同的 `if self._config ... else Config.load()` 模式 → `_get_download_dir()` 方法
4. **JS 解析长度保护**（parser.py）：`_extract_payload_data` 添加 2MB 输入上限
5. **Config.__post_init__ 去除副作用**（config.py）：删除 `os.makedirs`，数据类构造函数不应有 I/O
6. **models.py import 位置修正**：`from enum import Enum` 和 `import time` 从文件中间移到顶部
7. **魔法数字提取常量**：`"{page:03d}{ext}"` 文件名格式 → `image_formats.PAGE_FILENAME_FORMAT`
8. **_resize_after_id 初始化**（gui_app.py）：在 `__init__` 中初始化为 `None`，删除 `hasattr` 检查

## 功能 (Capabilities)

### 新增功能

无。本次变更是纯重构，不引入新功能。

### 修改功能

无。所有改动都是实现层面的清理，不改变规范级行为。

## 影响

- **代码文件**：gui_app.py, panels/comic_card.py, cbz_builder.py, parser.py, config.py, models.py, image_formats.py, downloader.py
- **测试文件**：tests/test_config.py（+1 个新测试验证 Config 构造函数不再创建目录）
- **行为变化**：`Config()` 不再自动创建 download_dir 目录（由下游模块在需要时创建）
- **依赖**：无新增依赖
