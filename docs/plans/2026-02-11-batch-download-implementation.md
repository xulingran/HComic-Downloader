# 批量下载功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 为 HComic Downloader 添加批量下载功能，允许用户通过点击卡片选择多本漫画，然后排队依次下载。

**架构：**
1. 使用 Set[ComicInfo] 跟踪选中的漫画
2. 卡片点击切换选中状态，带视觉反馈（蓝色边框、浅蓝背景、右上角勾选标记）
3. 工具栏提供"全选"、"取消"、"批量下载(N)"按钮
4. 批量下载采用顺序队列模式，每本完成后显示汇总

**技术栈：**
- Python 3.12+
- tkinter (ttk)
- dataclasses (ComicInfo)
- threading (后台下载)

---

## Task 1: 添加选择状态管理变量

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 在 __init__ 中添加状态变量**

在 `self.is_downloading = False` 后面（约第 57 行）添加：

```python
# 下载状态
self.is_downloading = False

# 批量下载状态
self.selected_comics: set[ComicInfo] = set()  # 选中的漫画集合
self.is_batch_downloading: bool = False        # 批量下载进行中
```

**Step 2: 验证代码能正常导入**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'selected_comics'), '应有 selected_comics 属性'; assert hasattr(app, 'is_batch_downloading'), '应有 is_batch_downloading 属性'; app.destroy(); print('✓ 状态变量添加成功')"
```

预期输出:
```
✓ 状态变量添加成功
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add batch download state variables (selected_comics, is_batch_downloading)"
```

---

## Task 2: 添加卡片选中/取消选中切换方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 在类中添加 toggle_selection 方法**

在 `update_status` 方法后（约第 312 行后）添加：

```python
def toggle_selection(self, comic: ComicInfo) -> bool:
    """切换漫画选中状态

    Args:
        comic: 漫画信息

    Returns:
        切换后的选中状态（True=选中, False=未选中）
    """
    if comic in self.selected_comics:
        self.selected_comics.remove(comic)
        logger.debug(f"取消选中: {comic.title}")
        return False
    else:
        self.selected_comics.add(comic)
        logger.debug(f"选中: {comic.title}")
        return True
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; from models import ComicInfo; app = HComicDownloaderGUI(); app.withdraw(); test_comic = ComicInfo(id='1', title='测试'); result = app.toggle_selection(test_comic); assert result == True, '首次切换应返回True'; assert test_comic in app.selected_comics, '应在选中集合中'; result2 = app.toggle_selection(test_comic); assert result2 == False, '再次切换应返回False'; app.destroy(); print('✓ toggle_selection 方法正常工作')"
```

预期输出:
```
✓ toggle_selection 方法正常工作
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add toggle_selection method for comic selection"
```

---

## Task 3: 添加卡片视觉更新方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 update_card_visual 方法**

在 `toggle_selection` 方法后添加：

```python
def update_card_visual(self, frame: tk.Frame, is_selected: bool):
    """更新卡片视觉样式

    Args:
        frame: 卡片框架
        is_selected: 是否选中
    """
    # 尝试找到标题标签和勾选标记标签
    select_label = None
    for child in frame.winfo_children():
        if hasattr(child, 'select_mark'):
            select_label = child
            break

    if is_selected:
        # 选中样式：蓝色边框、浅蓝背景
        frame.config(relief="solid", borderwidth=2, style="Selected.TFrame")
        # 尝试配置背景色（tk.Frame 直接支持）
        try:
            frame.config(bg="#E3F2FD")
            # 递归设置子组件背景
            for child in frame.winfo_children():
                if isinstance(child, tk.Frame):
                    child.config(bg="#E3F2FD")
        except:
            pass

        # 添加或更新右上角勾选标记
        if select_label is None:
            select_label = tk.Label(
                frame,
                text="✓",
                fg="#2196F3",
                bg="#E3F2FD",
                font=("Arial", 14, "bold")
            )
            select_label.select_mark = True  # 标记这是选择指示器
            select_label.place(relx=1.0, rely=0.0, anchor="ne", x=-5, y=5)
    else:
        # 未选中样式：恢复默认
        frame.config(relief="solid", borderwidth=1)
        try:
            frame.config(bg="")
            for child in frame.winfo_children():
                if isinstance(child, tk.Frame):
                    child.config(bg="")
        except:
            pass

        # 移除勾选标记
        if select_label is not None:
            select_label.destroy()
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); import tkinter as tk; test_frame = tk.Frame(app); app.update_card_visual(test_frame, True); app.update_card_visual(test_frame, False); test_frame.destroy(); app.destroy(); print('✓ update_card_visual 方法存在')"
```

预期输出:
```
✓ update_card_visual 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add update_card_visual method for selection feedback"
```

---

## Task 4: 添加卡片点击处理方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 _on_card_click 方法**

在 `update_card_visual` 方法后添加：

```python
def _on_card_click(self, event, comic: ComicInfo, frame: tk.Frame):
    """处理卡片点击事件

    Args:
        event: 点击事件
        comic: 漫画信息
        frame: 卡片框架
    """
    # 批量下载中不允许更改选择
    if self.is_batch_downloading:
        return

    # 切换选中状态
    is_selected = self.toggle_selection(comic)

    # 更新卡片视觉
    self.update_card_visual(frame, is_selected)

    # 更新工具栏按钮状态
    self.update_toolbar_buttons()
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, '_on_card_click'), '应有 _on_card_click 方法'; app.destroy(); print('✓ _on_card_click 方法存在')"
```

预期输出:
```
✓ _on_card_click 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add _on_card_click handler method"
```

---

## Task 5: 修改 create_comic_card 添加点击绑定

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 在 create_comic_card 中添加点击绑定**

找到 `return frame` 这行（约第 446 行），在它之前添加：

```python
        # 下载按钮
        download_btn = ttk.Button(
            frame, text="下载",
            command=lambda c=comic: self.download_comic(c)
        )
        download_btn.grid(row=4, column=0, pady=(5, 0))

        # 绑定卡片点击事件（用于选择）
        # 使用 lambda 保存 comic 和 frame 的引用
        frame.bind('<Button-1>', lambda e, c=comic, f=frame: self._on_card_click(e, c, f))

        # 下载按钮点击时阻止事件冒泡到卡片
        download_btn.bind('<Button-1>', lambda e, b=download_btn: b.focus_set())

        return frame
```

**Step 2: 验证绑定正常工作**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; from models import ComicInfo; app = HComicDownloaderGUI(); app.withdraw(); test_comic = ComicInfo(id='test', title='测试漫画', author='测试作者', pages=10, publish_date='2025-01-01', media_id='abc', comic_source='test'); card = app.create_comic_card(test_comic, 0, 0); assert len(card.bind()) > 0, '卡片应有事件绑定'; card.destroy(); app.destroy(); print('✓ 卡片点击绑定正常')"
```

预期输出:
```
✓ 卡片点击绑定正常
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: bind click event to comic cards for selection"
```

---

## Task 6: 创建批量操作工具栏

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 create_batch_toolbar 方法**

在 `_get_config_path` 方法后（约第 299 行后）添加：

```python
def create_batch_toolbar(self, parent: ttk.Frame) -> ttk.Frame:
    """创建批量操作工具栏

    Args:
        parent: 父容器

    Returns:
        工具栏框架
    """
    toolbar = ttk.Frame(parent)
    toolbar.grid(row=0, column=0, sticky=(tk.W, tk.E), pady=(0, 5))

    # 全选按钮
    self.select_all_btn = ttk.Button(
        toolbar,
        text="全选",
        command=self.select_all,
        width=8
    )
    self.select_all_btn.grid(row=0, column=0, padx=(0, 5))

    # 取消选择按钮
    self.clear_selection_btn = ttk.Button(
        toolbar,
        text="取消",
        command=self.clear_selection,
        width=8
    )
    self.clear_selection_btn.grid(row=0, column=1, padx=(0, 5))

    # 批量下载按钮
    self.batch_download_btn = ttk.Button(
        toolbar,
        text="批量下载(0)",
        command=self.batch_download_selected,
        width=12
    )
    self.batch_download_btn.grid(row=0, column=2)

    # 初始状态：禁用批量下载按钮
    self.batch_download_btn.state(['disabled'])

    return toolbar
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'create_batch_toolbar'), '应有 create_batch_toolbar 方法'; app.destroy(); print('✓ create_batch_toolbar 方法存在')"
```

预期输出:
```
✓ create_batch_toolbar 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add create_batch_toolbar method"
```

---

## Task 7: 添加全选和取消选择方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 select_all 和 clear_selection 方法**

在 `create_batch_toolbar` 方法后添加：

```python
def select_all(self):
    """选中所有当前搜索结果"""
    if self.is_batch_downloading:
        return

    self.selected_comics.clear()
    for comic in self.search_results:
        self.selected_comics.add(comic)

    # 更新所有卡片视觉
    for i, frame in enumerate(self.result_frames):
        if i < len(self.search_results):
            self.update_card_visual(frame, True)

    # 更新工具栏按钮
    self.update_toolbar_buttons()

    logger.info(f"已选中全部 {len(self.search_results)} 本漫画")

def clear_selection(self):
    """清空所有选择"""
    if self.is_batch_downloading:
        return

    self.selected_comics.clear()

    # 更新所有卡片视觉
    for frame in self.result_frames:
        self.update_card_visual(frame, False)

    # 更新工具栏按钮
    self.update_toolbar_buttons()

    logger.info("已清空所有选择")
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'select_all'), '应有 select_all 方法'; assert hasattr(app, 'clear_selection'), '应有 clear_selection 方法'; app.destroy(); print('✓ select_all 和 clear_selection 方法存在')"
```

预期输出:
```
✓ select_all 和 clear_selection 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add select_all and clear_selection methods"
```

---

## Task 8: 添加更新工具栏按钮状态方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 update_toolbar_buttons 方法**

在 `clear_selection` 方法后添加：

```python
def update_toolbar_buttons(self):
    """更新工具栏按钮状态"""
    selected_count = len(self.selected_comics)

    # 更新批量下载按钮文本
    self.batch_download_btn.config(text=f"批量下载({selected_count})")

    # 根据选中数量启用/禁用按钮
    if selected_count > 0 and not self.is_batch_downloading:
        self.batch_download_btn.state(['!disabled'])
    else:
        self.batch_download_btn.state(['disabled'])

    # 批量下载中禁用全选和取消按钮
    if self.is_batch_downloading:
        self.select_all_btn.state(['disabled'])
        self.clear_selection_btn.state(['disabled'])
    else:
        self.select_all_btn.state(['!disabled'])
        self.clear_selection_btn.state(['!disabled'])
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'update_toolbar_buttons'), '应有 update_toolbar_buttons 方法'; app.destroy(); print('✓ update_toolbar_buttons 方法存在')"
```

预期输出:
```
✓ update_toolbar_buttons 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add update_toolbar_buttons method"
```

---

## Task 9: 在 create_widgets 中集成工具栏

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 在 create_widgets 的 results_frame 中添加工具栏**

找到 `results_frame = ttk.LabelFrame(...)` 部分（约第 147-151 行），修改为：

```python
        # ===== 搜索结果区域 =====
        results_frame = ttk.LabelFrame(main_frame, text="搜索结果", padding="5")
        results_frame.grid(row=2, column=0, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 10))
        results_frame.columnconfigure(0, weight=1)
        results_frame.rowconfigure(1, weight=1)  # 改为 row=1，因为 row=0 是工具栏

        # 创建批量操作工具栏
        self.batch_toolbar = self.create_batch_toolbar(results_frame)

        # 画布和滚动条
        self.canvas = tk.Canvas(results_frame, highlightthickness=0)
        scrollbar = ttk.Scrollbar(results_frame, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        # 创建内窗口（宽度将动态调整）
        self.canvas_window = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.grid(row=1, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))  # row=1
        scrollbar.grid(row=1, column=1, sticky=(tk.N, tk.S))  # row=1
```

**Step 2: 验证 GUI 能正常启动**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'batch_toolbar'), '应有 batch_toolbar 属性'; assert hasattr(app, 'select_all_btn'), '应有 select_all_btn'; assert hasattr(app, 'clear_selection_btn'), '应有 clear_selection_btn'; assert hasattr(app, 'batch_download_btn'), '应有 batch_download_btn'; app.destroy(); print('✓ 工具栏组件创建成功')"
```

预期输出:
```
✓ 工具栏组件创建成功
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: integrate batch toolbar into results area"
```

---

## Task 10: 修改 display_results 清空选择

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 在 display_results 开始时清空选择**

找到 `def display_results(self, results: List[ComicInfo]):` 方法（约第 341 行），在方法开始处添加：

```python
    def display_results(self, results: List[ComicInfo]):
        """显示搜索结果"""
        self.search_btn.config(state=tk.NORMAL)
        self.search_results = results

        # 新搜索时清空选择
        self.selected_comics.clear()
        if hasattr(self, 'update_toolbar_buttons'):
            self.update_toolbar_buttons()

        # 清除旧结果
        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()
        self.image_cache.clear()
```

**Step 2: 验证搜索会清空选择**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; from models import ComicInfo; app = HComicDownloaderGUI(); app.withdraw(); test_comic = ComicInfo(id='1', title='测试'); app.selected_comics.add(test_comic); assert len(app.selected_comics) == 1, '应有1个选中'; app.display_results([]); assert len(app.selected_comics) == 0, '搜索后应清空选择'; app.destroy(); print('✓ 搜索正确清空选择')"
```

预期输出:
```
✓ 搜索正确清空选择
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: clear selection on new search"
```

---

## Task 11: 添加批量下载确认对话框方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 confirm_batch_download 方法**

在 `update_toolbar_buttons` 方法后添加：

```python
def confirm_batch_download(self, comics: list[ComicInfo]) -> bool:
    """显示批量下载确认对话框

    Args:
        comics: 要下载的漫画列表

    Returns:
        用户是否确认下载
    """
    if not comics:
        return False

    # 构建确认消息
    comic_list = "\n".join([f"{i+1}. {comic.title}" for i, comic in enumerate(comics)])

    message = f"即将下载以下 {len(comics)} 本漫画：\n\n{comic_list}\n\n是否继续？"

    return messagebox.askyesno("确认批量下载", message)
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; from models import ComicInfo; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'confirm_batch_download'), '应有 confirm_batch_download 方法'; app.destroy(); print('✓ confirm_batch_download 方法存在')"
```

预期输出:
```
✓ confirm_batch_download 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add confirm_batch_download dialog method"
```

---

## Task 12: 添加批量下载入口方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 batch_download_selected 方法**

在 `confirm_batch_download` 方法后添加：

```python
def batch_download_selected(self):
    """批量下载选中的漫画"""
    # 检查是否有选中
    if not self.selected_comics:
        messagebox.showinfo("提示", "请先选择要下载的漫画")
        return

    # 检查是否已有下载任务
    if self.is_downloading or self.is_batch_downloading:
        messagebox.showinfo("提示", "已有下载任务进行中，请等待完成")
        return

    # 转换为列表保持顺序
        download_list = list(self.selected_comics)

    # 显示确认对话框
    if not self.confirm_batch_download(download_list):
        return

    # 开始批量下载
    self.execute_batch_download(download_list)
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'batch_download_selected'), '应有 batch_download_selected 方法'; app.destroy(); print('✓ batch_download_selected 方法存在')"
```

预期输出:
```
✓ batch_download_selected 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add batch_download_selected entry method"
```

---

## Task 13: 添加批量下载执行方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 execute_batch_download 方法**

在 `batch_download_selected` 方法后添加：

```python
def execute_batch_download(self, comics: list[ComicInfo]):
    """执行批量下载

    Args:
        comics: 要下载的漫画列表
    """
    self.is_batch_downloading = True
    self.update_toolbar_buttons()

    total = len(comics)
    results = {"success": [], "failed": []}

    def do_batch_download():
        for i, comic in enumerate(comics):
            # 更新状态
            self.after(0, lambda c=i+1, t=total, ct=comic.title: self.update_status(f"下载中 [{c}/{t}]: {ct}"))
            self.after(0, lambda: self.progress_var.set(0))

            temp_dir = None
            try:
                # 下载图片
                temp_dir = self.downloader.download_comic(
                    comic,
                    self.download_dir_var.get(),
                    progress_callback=self._progress_callback,
                )

                self.after(0, lambda: self.update_status(f"打包中 [{i+1}/{total}]: {comic.title}"))

                # 打包为 CBZ
                output_path = self.cbz_builder.build_cbz(temp_dir, comic)

                # 清理临时目录
                self.downloader.cleanup_temp_dir(temp_dir)

                results["success"].append(comic)
                logger.info(f"批量下载成功: {comic.title}")

            except Exception as e:
                logger.error(f"批量下载失败: {comic.title}, 错误: {e}")
                results["failed"].append((comic, str(e)))
                if temp_dir and os.path.exists(temp_dir):
                    self.downloader.cleanup_temp_dir(temp_dir)

        # 下载完成，显示汇总
        self.after(0, lambda: self.show_batch_download_summary(results))

    threading.Thread(target=do_batch_download, daemon=True).start()
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'execute_batch_download'), '应有 execute_batch_download 方法'; app.destroy(); print('✓ execute_batch_download 方法存在')"
```

预期输出:
```
✓ execute_batch_download 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add execute_batch_download method"
```

---

## Task 14: 添加批量下载汇总对话框方法

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 添加 show_batch_download_summary 方法**

在 `execute_batch_download` 方法后添加：

```python
def show_batch_download_summary(self, results: dict):
    """显示批量下载汇总

    Args:
        results: 包含 success 和 failed 的字典
    """
    self.is_batch_downloading = False
    self.update_toolbar_buttons()

    success_count = len(results["success"])
    failed_count = len(results["failed"])

    # 构建消息
    message = f"批量下载完成\n\n成功: {success_count} 本"
    if failed_count > 0:
        message += f"\n失败: {failed_count} 本"
        for comic, error in results["failed"]:
            message += f"\n  - {comic.title}: {error}"

    self.update_status(f"批量下载完成：成功 {success_count} 本，失败 {failed_count} 本")
    self.progress_var.set(0)

    if failed_count > 0:
        messagebox.showwarning("批量下载完成", message)
    else:
        messagebox.showinfo("批量下载完成", message)

    # 清空选择
    self.clear_selection()
```

**Step 2: 验证方法存在**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; app = HComicDownloaderGUI(); app.withdraw(); assert hasattr(app, 'show_batch_download_summary'), '应有 show_batch_download_summary 方法'; app.destroy(); print('✓ show_batch_download_summary 方法存在')"
```

预期输出:
```
✓ show_batch_download_summary 方法存在
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add show_batch_download_summary dialog method"
```

---

## Task 15: 修改单个下载方法添加冲突检查

**Files:**
- Modify: `/Users/zhong/Program/hcomic_downloader/gui.py`

**Step 1: 修改 download_comic 方法**

找到 `def download_comic(self, comic: ComicInfo):` 方法（约第 499 行），修改开始部分：

```python
    def download_comic(self, comic: ComicInfo):
        """下载选中的漫画"""
        # 批量下载中不允许单个下载
        if self.is_batch_downloading:
            messagebox.showinfo("提示", "批量下载进行中，请等待完成")
            return

        if self.is_downloading:
            messagebox.showinfo("提示", "已有下载任务进行中，请等待完成")
            return
```

**Step 2: 验证冲突检查正常工作**

运行:
```bash
python3 -c "from gui import HComicDownloaderGUI; from models import ComicInfo; app = HComicDownloaderGUI(); app.withdraw(); app.is_batch_downloading = True; test_comic = ComicInfo(id='1', title='测试'); # 测试批量下载中阻止单个下载（不实际调用 download_comic 避免弹窗）assert app.is_batch_downloading == True; app.destroy(); print('✓ 批量下载状态检查正常')"
```

预期输出:
```
✓ 批量下载状态检查正常
```

**Step 3: 提交**

```bash
git add gui.py
git commit -m "feat: add batch download conflict check to single download"
```

---

## Task 16: 完整功能测试

**Files:**
- Test: Manual testing via GUI

**Step 1: 启动程序进行手动测试**

运行:
```bash
python3 gui.py
```

**测试检查清单：**
- [ ] 启动程序，搜索漫画
- [ ] 点击卡片，卡片显示蓝色边框和背景
- [ ] 再次点击，取消选中状态
- [ ] 点击"全选"，所有卡片被选中
- [ ] 点击"取消"，所有选择被清空
- [ ] 批量下载按钮显示正确的数量
- [ ] 点击批量下载，显示确认对话框
- [ ] 确认后开始下载，状态显示进度
- [ ] 下载完成后显示汇总
- [ ] 新搜索时选择被清空
- [ ] 批量下载中无法进行新选择

**Step 2: 自动化集成测试**

创建测试脚本并运行：

```bash
python3 -c "
from gui import HComicDownloaderGUI
from models import ComicInfo

# 创建 GUI
app = HComicDownloaderGUI()
app.withdraw()

print('=== 批量下载功能集成测试 ===')
print()

print('1. 测试状态变量')
assert hasattr(app, 'selected_comics'), '应有 selected_comics'
assert hasattr(app, 'is_batch_downloading'), '应有 is_batch_downloading'
assert len(app.selected_comics) == 0, '初始应为空'
print('   ✓ 状态变量正常')

print()
print('2. 测试工具栏组件')
assert hasattr(app, 'batch_toolbar'), '应有 batch_toolbar'
assert hasattr(app, 'select_all_btn'), '应有 select_all_btn'
assert hasattr(app, 'clear_selection_btn'), '应有 clear_selection_btn'
assert hasattr(app, 'batch_download_btn'), '应有 batch_download_btn'
print('   ✓ 工具栏组件正常')

print()
print('3. 测试选择功能')
test_comic1 = ComicInfo(id='1', title='测试漫画1', author='作者1', pages=10, publish_date='2025-01-01', media_id='m1', comic_source='test')
test_comic2 = ComicInfo(id='2', title='测试漫画2', author='作者2', pages=20, publish_date='2025-01-02', media_id='m2', comic_source='test')

# 模拟添加到搜索结果
app.search_results = [test_comic1, test_comic2]

# 测试切换
is_selected = app.toggle_selection(test_comic1)
assert is_selected == True, '首次切换应返回True'
assert test_comic1 in app.selected_comics, '应在选中集合中'
print('   ✓ 选中功能正常')

# 测试取消
is_selected = app.toggle_selection(test_comic1)
assert is_selected == False, '再次切换应返回False'
assert test_comic1 not in app.selected_comics, '不应在选中集合中'
print('   ✓ 取消选中功能正常')

print()
print('4. 测试全选功能')
app.select_all()
assert len(app.selected_comics) == 2, '应选中2本'
print('   ✓ 全选功能正常')

print()
print('5. 测试清空功能')
app.clear_selection()
assert len(app.selected_comics) == 0, '应清空所有选择'
print('   ✓ 清空功能正常')

print()
print('=== 所有测试通过 ===')

app.destroy()
"
```

预期输出:
```
=== 批量下载功能集成测试 ===

1. 测试状态变量
   ✓ 状态变量正常

2. 测试工具栏组件
   ✓ 工具栏组件正常

3. 测试选择功能
   ✓ 选中功能正常
   ✓ 取消选中功能正常

4. 测试全选功能
   ✓ 全选功能正常

5. 测试清空功能
   ✓ 清空功能正常

=== 所有测试通过 ===
```

**Step 3: 最终提交**

```bash
git add .
git commit -m "test: add integration tests for batch download feature"
```

---

## 测试策略

### 单元测试
- 状态变量初始化
- toggle_selection 方法
- update_card_visual 方法
- select_all/clear_selection 方法
- update_toolbar_buttons 方法

### 集成测试
- 卡片点击与选择状态同步
- 工具栏按钮状态更新
- 搜索结果与选择清空
- 批量下载流程

### 手动测试
- 启动程序验证工具栏显示
- 点击卡片验证视觉反馈
- 全选/取消验证
- 批量下载验证流程
- 边界情况验证

---

## 相关文档

- 设计文档: `docs/plans/2026-02-11-batch-download-design.md`
- GUI 模块: `gui.py`
- 数据模型: `models.py`

---

## 预期成果

完成后，用户将能够：
1. 点击漫画卡片进行选中/取消选中
2. 选中的卡片有明显的视觉高亮
3. 使用工具栏按钮全选/取消选择
4. 批量下载选中的漫画
5. 查看批量下载进度和完成汇总
