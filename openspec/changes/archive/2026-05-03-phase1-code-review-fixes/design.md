## 上下文

Pragmatic Clean Code 审查（L3 Team，D3 External + R2 Normal）对整个项目进行了全面审查，发现 14 个问题。Phase 1 聚焦其中 8 个低风险、互不依赖的修复。当前代码库有 279 个测试用例，全部通过。

## 目标 / 非目标

**目标：**
- 消除裸 except 的安全隐患（吞掉 KeyboardInterrupt/SystemExit）
- 删除死代码（ComicCard 类，~65 行）
- 消除 cbz_builder 中 3 处重复的 fallback 配置加载
- 为 JS 解析添加输入长度保护
- 修复 Config 数据类的 I/O 副作用
- 修正 models.py 的 import 组织
- 提取魔法数字为命名常量
- 修复 gui_app.py 中 _resize_after_id 的初始化遗漏

**非目标：**
- 不拆分 God Class（Phase 3）
- 不修复 download_manager 的并发问题（Phase 2）
- 不改变任何外部行为或 API

## 决策

### D1：裸异常类型选择

**决策**：gui_app.py 中 4 处裸 except 替换为：
- Linux 命令执行（2 处）→ `except (subprocess.CalledProcessError, FileNotFoundError, OSError)`
- tkinter 配置（2 处）→ `except (tk.TclError, AttributeError)`

**理由**：捕获足够具体的异常，保留 try/except 的容错意图，但不再吞掉 `KeyboardInterrupt`、`SystemExit` 等关键信号。

### D2：ComicCard 删除策略

**决策**：直接删除 `ComicCard` 类，不保留兼容别名。

**理由**：`grep ComicCard tests/` 返回零结果，无任何代码引用此类。类中 6 个方法全是空桩。保留只是维护负担。

### D3：_get_download_dir 方法位置

**决策**：在 `CBZBuilder` 类内部添加 `_get_download_dir(self, download_dir=None)` 私有方法。

**理由**：不引入新模块或新类，改动最小化。方法是私有的，不改变公共 API。

### D4：JS 解析长度上限

**决策**：在 `_extract_payload_data` 开头检查 `len(resp_text) > 2_000_000`（2MB）。

**理由**：h-comic.com 正常页面 HTML 在 100KB-500KB 范围。2MB 上限足够宽松，防止异常大 payload 导致性能问题。使用硬编码值而非配置，因为这是防御性检查。

### D5：Config.__post_init__ 副作用移除

**决策**：删除 `os.makedirs(self.download_dir, exist_ok=True)`。

**理由**：数据类构造函数不应有 I/O 副作用。下载目录由以下模块在需要时创建：
- `cbz_builder.py`：`os.makedirs(os.path.dirname(output_path), exist_ok=True)`
- `downloader.py`：`ensure_dir(str(temp_dir))`
- `gui_app.py`：打开目录前检查 `os.path.exists()`

### D6：PAGE_FILENAME_FORMAT 常量位置

**决策**：放在 `image_formats.py`，与 `SUPPORTED_IMAGE_EXTENSIONS` 同模块。

**理由**：`image_formats.py` 已经定义了文件格式相关常量（MIME_TO_EXT, PIL_FORMAT_TO_EXT, SUPPORTED_IMAGE_EXTENSIONS），页面文件名格式属于同一语义域。

### D7：_resize_after_id 初始化

**决策**：在 `__init__` 中添加 `self._resize_after_id = None`，将 `hasattr` 检查改为 `if self._resize_after_id:`。

**理由**：与其他类似的 after ID（`_scroll_reset_after_id`、`_settings_anim_after_id` 等）保持一致的初始化模式。

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| Config.__post_init__ 不再创建目录，可能在某些边缘场景导致 FileNotFoundError | 下游模块（cbz_builder, downloader）已有 ensure_dir 调用；gui_app 在打开目录前检查存在性 |
| 删除 ComicCard 后如果未来需要类式卡片组件 | 当前 build_comic_card_frame 纯函数已完全替代；如需类式 API，可从纯函数包装 |
| JS 解析长度保护可能误拒合法大页面 | 2MB 上限远超正常页面大小；异常时抛出 ValueError，上层 search() 已有 try/except |
