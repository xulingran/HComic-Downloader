# 预览图显示切换功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 添加一个设置选项，让用户可以控制是否在搜索结果中显示漫画封面预览图，节省流量并提升性能。

**架构：**
1. 在 Config 类中添加 `show_preview` 布尔字段（默认 False）
2. 在 GUI 设置区域添加复选框控制该选项
3. 修改 `create_comic_card` 方法，根据设置决定显示封面图片或 "NSFW" 占位符
4. 切换时立即重新渲染当前搜索结果

**技术栈：**
- Python 3.12+
- tkinter (ttk)
- dataclasses (Config)
- threading (异步加载封面)

---

## Task 1: 添加 Config.show_preview 字段

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/config.py`

**Step 1: 修改 Config 类添加新字段**

在 `font_size` 字段后面添加 `show_preview` 字段：

```python
@dataclass
class Config:
    """应用配置"""
    download_dir: str = field(default_factory=lambda: str(Path.home() / "Downloads" / "hcomic"))
    concurrent_downloads: int = 4
    timeout: int = 30
    retry_times: int = 3
    cbz_filename_template: str = "{author}-{title}.cbz"
    # 字体配置（空字符串表示自动检测）
    font_name: str = ""  # 留空则自动选择最佳中文字体
    font_size: int = 12  # 基础字体大小
    # 预览图设置
    show_preview: bool = False  # 是否显示封面预览图（默认不显示）
```

**Step 2: 更新 save 方法包含新字段**

修改 `save` 方法中的字典：

```python
def save(self, config_path: str):
    """保存配置到文件"""
    import json
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump({
            'download_dir': self.download_dir,
            'concurrent_downloads': self.concurrent_downloads,
            'timeout': self.timeout,
            'retry_times': self.retry_times,
            'cbz_filename_template': self.cbz_filename_template,
            'font_name': self.font_name,
            'font_size': self.font_size,
            'show_preview': self.show_preview,
        }, f, ensure_ascii=False, indent=2)
```

**Step 3: 确保 load 方法兼容旧配置**

现有的 `load` 方法使用 `cls(**data)`，由于 `show_preview` 有默认值，旧配置文件没有这个字段时会自动使用默认值。无需修改。

**Step 4: 验证配置模块**

运行测试：
```bash
python3 -c "
from config import Config

# 测试默认值
c = Config()
assert c.show_preview == False, '默认值应为 False'
print('✓ 默认值测试通过')

# 测试从字典加载
c2 = Config(show_preview=True)
assert c2.show_preview == True, '应正确加载 True'
print('✓ 显式值测试通过')

# 测试序列化
import json
import tempfile
with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
    config_path = f.name
c.save(config_path)
with open(config_path, 'r') as f:
    data = json.load(f)
assert 'show_preview' in data, '保存的配置应包含 show_preview'
assert data['show_preview'] == False, '保存的值应正确'
print('✓ 序列化测试通过')

import os
os.unlink(config_path)
print('✓ 所有测试通过')
"
```

预期输出：
```
✓ 默认值测试通过
✓ 显式值测试通过
✓ 序列化测试通过
✓ 所有测试通过
```

**Step 5: 提交**

```bash
git add config.py
git commit -m "feat: add show_preview config field (default False)"
```

---

## Task 2: 在 GUI 设置区域添加复选框

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 在 __init__ 中初始化 show_preview_var**

在 `self.font_size_var = tk.IntVar(value=self.config.font_size)` 后面添加：

```python
self.font_size_var = tk.IntVar(value=self.config.font_size)
# 预览图设置
self.show_preview_var = tk.BooleanVar(value=self.config.show_preview)
```

位置：大约在第 48 行附近，`self.is_downloading = False` 之后

**Step 2: 在 create_widgets 中添加复选框**

在设置区域第二行（字体设置）后面添加第三行。找到 `settings_frame.columnconfigure(1, weight=1)` 这行（约第 133 行），在它之前添加：

```python
        # 第三行：预览图设置
        preview_check = ttk.Checkbutton(
            settings_frame,
            text="显示预览图",
            variable=self.show_preview_var,
            command=self._on_preview_changed
        )
        preview_check.grid(row=2, column=0, columnspan=2, sticky=tk.W, pady=(5, 0))
```

**Step 3: 添加 _on_preview_changed 回调方法**

在 `_on_font_size_changed` 方法后添加新方法（约第 202 行后）：

```python
    def _on_preview_changed(self):
        """预览图设置变化事件"""
        self.config.show_preview = self.show_preview_var.get()
        logger.info(f"预览图设置已更改为: {self.config.show_preview}")

        # 如果有搜索结果，重新渲染
        if self.search_results:
            self._refresh_results_layout()
```

**Step 4: 验证 GUI 模块能正常导入**

```bash
python3 -c "
from gui import HComicDownloaderGUI
app = HComicDownloaderGUI()
app.withdraw()  # 隐藏窗口

# 检查变量是否存在
assert hasattr(app, 'show_preview_var'), '应存在 show_preview_var'
assert hasattr(app, '_on_preview_changed'), '应存在 _on_preview_changed 方法'
print('✓ 变量和方法存在')

# 检查默认值
assert app.show_preview_var.get() == False, '默认应为 False'
print('✓ 默认值正确')

# 测试切换
app.show_preview_var.set(True)
assert app.show_preview_var.get() == True, '应能切换到 True'
print('✓ 切换功能正常')

app.destroy()
print('✓ 所有测试通过')
"
```

预期输出：
```
✓ 变量和方法存在
✓ 默认值正确
✓ 切换功能正常
✓ 所有测试通过
```

**Step 5: 提交**

```bash
git add gui.py
git commit -m "feat: add preview toggle checkbox in settings"
```

---

## Task 3: 修改 create_comic_card 支持预览图开关

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 修改 create_comic_card 方法中的封面渲染逻辑**

找到封面图片部分（约第 356-362 行），替换为：

```python
        # 封面区域
        if self.show_preview_var.get():
            # 显示预览图模式
            img_label = ttk.Label(frame)
            img_label.grid(row=0, column=0, pady=(0, 5))

            # 异步加载封面（传入卡片宽度）
            if comic.cover_url:
                threading.Thread(target=self.load_cover, args=(comic.cover_url, img_label, card_width), daemon=True).start()
        else:
            # 不显示预览图模式 - 显示 NSFW 占位符
            cover_height = int(card_width * 1.4) if card_width > 1 else 280
            placeholder = tk.Label(
                frame,
                text="NSFW",
                bg="#444444",
                fg="#cccccc",
                font=get_font("title"),
                width=max(15, int(card_width // 10)),
                height=max(8, int(cover_height // 20))
            )
            placeholder.grid(row=0, column=0, pady=(0, 5))
```

**Step 2: 验证卡片渲染逻辑**

```bash
python3 -c "
from gui import HComicDownloaderGUI
from models import ComicInfo

app = HComicDownloaderGUI()
app.withdraw()  # 隐藏窗口

# 创建测试漫画
test_comic = ComicInfo(
    id='123',
    title='测试漫画',
    author='测试作者',
    pages=20,
    tags=[],
    publish_date='2025-01-01',
    cover_url='https://example.com/cover.jpg',
    preview_url='https://example.com',
    media_id='abc123',
    comic_source='test'
)

# 测试不显示预览图模式
app.show_preview_var.set(False)
frame1 = app.create_comic_card(test_comic, 0, 0)
print('✓ 不显示预览图模式创建成功')

# 测试显示预览图模式
app.show_preview_var.set(True)
frame2 = app.create_comic_card(test_comic, 0, 1)
print('✓ 显示预览图模式创建成功')

# 清理
for f in app.result_frames:
    f.destroy()
app.destroy()
print('✓ 所有测试通过')
"
```

预期输出：
```
✓ 不显示预览图模式创建成功
✓ 显示预览图模式创建成功
✓ 所有测试通过
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: support preview toggle in comic cards"
```

---

## Task 4: 确保配置正确保存和加载

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 确保配置在切换时保存**

修改 `_on_preview_changed` 方法，添加配置保存：

```python
    def _on_preview_changed(self):
        """预览图设置变化事件"""
        self.config.show_preview = self.show_preview_var.get()
        logger.info(f"预览图设置已更改为: {self.config.show_preview}")

        # 保存配置到文件
        config_path = self._get_config_path()
        self.config.save(config_path)

        # 如果有搜索结果，重新渲染
        if self.search_results:
            self._refresh_results_layout()
```

**Step 2: 添加 _get_config_path 辅助方法**

如果不存在，在类中添加辅助方法获取配置文件路径：

```python
    def _get_config_path(self) -> str:
        """获取配置文件路径"""
        config_dir = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
        return os.path.join(config_dir, "config.json")
```

**Step 3: 端到端测试**

```bash
python3 -c "
import os
import tempfile
from gui import HComicDownloaderGUI

# 使用临时目录测试
with tempfile.TemporaryDirectory() as tmpdir:
    # 修改配置路径到临时目录
    import gui
    original_gui = gui.HComicDownloaderGUI

    class TestGUI(original_gui):
        def _get_config_path(self):
            return os.path.join(tmpdir, 'config.json')

    # 创建 GUI，切换设置
    app = TestGUI()
    app.withdraw()

    # 验证默认值
    assert app.show_preview_var.get() == False, '默认应为 False'
    print('✓ 默认值为 False')

    # 切换到 True
    app.show_preview_var.set(True)
    app._on_preview_changed()

    # 检查配置文件
    import json
    config_path = app._get_config_path()
    assert os.path.exists(config_path), '配置文件应已创建'
    with open(config_path, 'r') as f:
        data = json.load(f)
    assert data.get('show_preview') == True, '配置文件应保存 True'
    print('✓ 配置保存正确')

    # 销毁并重新创建，验证加载
    app.destroy()
    app2 = TestGUI()
    app2.withdraw()
    assert app2.show_preview_var.get() == True, '应从配置加载 True'
    print('✓ 配置加载正确')
    app2.destroy()

print('✓ 所有端到端测试通过')
"
```

预期输出：
```
✓ 默认值为 False
✓ 配置保存正确
✓ 配置加载正确
✓ 所有端到端测试通过
```

**Step 4: 提交**

```bash
git add gui.py
git commit -m "feat: save preview setting to config file"
```

---

## Task 5: 完整功能测试

**Step 1: 手动功能测试**

启动程序进行手动测试：

```bash
python3 gui.py
```

测试检查清单：
- [ ] 启动程序，复选框默认未勾选
- [ ] 搜索漫画，卡片显示 "NSFW" 占位符
- [ ] 勾选"显示预览图"，卡片立即重新渲染显示封面
- [ ] 取消勾选，卡片立即显示 "NSFW"
- [ ] 关闭程序重新打开，设置保持

**Step 2: 自动化集成测试**

创建测试脚本验证完整功能：

```bash
python3 -c "
print('=== 完整功能集成测试 ===')
print()

from gui import HComicDownloaderGUI
from parser import HComicParser
import time

# 创建 GUI
app = HComicDownloaderGUI()
app.withdraw()

print('1. 测试默认状态')
assert app.show_preview_var.get() == False
print('   ✓ 默认不显示预览图')

print()
print('2. 执行搜索测试')
parser = HComicParser()
results = parser.search('test')
if results:
    app.search_results = results
    app.display_results(results)
    print(f'   ✓ 搜索到 {len(results)} 个结果')

    # 检查卡片是否创建
    assert len(app.result_frames) > 0
    print('   ✓ 结果卡片已创建')

print()
print('3. 测试切换功能')
app.show_preview_var.set(True)
app._on_preview_changed()
print('   ✓ 切换到显示预览图')

app.show_preview_var.set(False)
app._on_preview_changed()
print('   ✓ 切换到不显示预览图')

print()
print('=== 所有测试通过 ===')

app.destroy()
"
```

**Step 3: 性能验证**

验证不显示预览图时确实没有网络请求：

```bash
# 监控网络请求，确认关闭预览图时不加载封面
# （可选，使用网络监控工具）
```

**Step 4: 最终提交**

```bash
git add .
git commit -m "test: add integration tests for preview toggle feature"
```

---

## 测试策略

### 单元测试
- Config 类的 show_preview 字段
- 配置序列化/反序列化
- GUI 变量初始化

### 集成测试
- 切换设置后立即重新渲染
- 配置保存和加载
- 搜索结果显示

### 手动测试
- 启动程序验证默认状态
- 切换设置验证即时生效
- 重启程序验证持久化

---

## 相关文档

- 项目设计文档: `docs/plans/2026-02-10-hcomic-downloader-design.md`
- 配置模块: `config.py`
- GUI 模块: `gui.py`

---

## 预期成果

完成后，用户将能够：
1. 通过设置区域的复选框控制是否显示封面预览图
2. 设置立即生效，当前搜索结果重新渲染
3. 设置持久化保存，重启程序后保持
4. 不显示预览图时节省流量和提升性能
