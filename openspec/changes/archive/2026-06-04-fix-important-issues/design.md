## 上下文

项目 Python 后端约 9,500 行代码，39 个文件，已稳定运行。L3 标准审查发现 40+ 处"重要"问题，集中在参数管理、函数规模、代码重复、错误处理和并发安全五个维度。本设计文档记录解决这些问题的关键架构决策。

### 约束

- 不改变对外 IPC 协议（JSON-RPC 2.0），前端不变
- 不引入新的第三方依赖
- 所有 371 个现有 pytest 用例保持通过
- 分 6 个 Phase 提交，每 phase 独立可测

## 目标 / 非目标

**目标：**

1. 所有公开函数参数 ≤5 个（L3 阈值）
2. 所有函数 ≤50 逻辑行（L3 阈值）
3. 消除报告中的 10 种代码重复模式
4. 修复 3 个竞态条件
5. 收紧裸 `except Exception` → 指定异常类型
6. 关键路径嵌套深度 ≤4 级
7. 安全相关修复（f-string SQL、normpath、会话管理）

**非目标：**

- 不修复"关键"级问题（硬编码密钥、SSRF 向量、fd 泄漏）——这些留给独立变更
- 不修复"次要"级问题（如 `BeautifulSoup` 导入位置、`{author}` 模板等样式偏好）
- 不引入类型检查器覆盖或新的 lint 规则
- 不拆分或移动文件——所有重构在原文件内完成

## 决策

### D1: `DownloadOptions` dataclass 设计

**选择**: `download_comic_resume(comic, output_dir, options: DownloadOptions | None = None)`，保留 2 核心参数。

**替代方案**:
- 全部塞进 dataclass (`DownloadOptions` 包含 `comic` 和 `output_dir`) → 拒绝，因为这两个是"必需的业务实体"，不应是可选的
- 分为 `_ResumeState` + `_DownloadControl` 两个 dataclass → 拒绝，过度设计，6 个字段不值得分成两组

**理由**: `comic` 和 `output_dir` 包含下载的核心语义（"下载什么"和"放到哪"），其余参数是"怎么下载"的控制开关。调用方心智负担最小。

`DownloadOptions` 放在 `downloader.py` 模块顶部（不放在 `models.py`），因为它是 `ComicDownloader` 的内部 API 类型。

### D2: `_modify_task_locked` 回调模式

**选择**: `guard(task) → bool` + `apply(task) → bool | None` 两个回调参数。

**替代方案**:
- 纯参数化 (`from_statuses` + `to_status` + `extra_mutations`) → 拒绝，`pause_task` 的 `to_status` 取决于当前状态（DOWNLOAING → PAUSING, QUEUED → PAUSED），参数化表达不了
- 模板方法 pattern（子类覆盖） → 拒绝，4 个方法差异太小，引入继承不值得
- 只提取锁+验证，不抽象 mutation → 留下 4 个方法的通知代码依然重复

**理由**: 回调模式在灵活性和声明性之间取得平衡。`guard` 和 `apply` 在同一闭包内，可读性好（一眼看出状态检查 → 变更 → 后处理的完整流程）。

### D3: `_parse_detail` 拆分粒度

**选择**: 拆为 7 个子方法 + 1 个 `_DetailMetadata` dataclass。每个子方法返回简单类型。

```
_parse_detail_title(doc) → str
_locate_info_block(doc) → lxml.Element | None
_extract_scramble_id(html) → str
_parse_detail_chapters(doc) → list[ChapterInfo]
_parse_detail_images(doc, domain) → list[str]
_parse_detail_metadata(scope, html, domain) → _DetailMetadata
_expand_image_urls(image_urls, total, comic_id) → list[str]
_extract_cover_url(doc, domain) → str
```

**替代方案**:
- 原地修改可变容器 (`_DetailResult` 作为 in/out 参数) → 拒绝，side-effect 多，测试困难
- 拆为更粗粒度（3-4 个方法） → 拒绝，每个函数仍超 30 行，没有真正降低复杂度

**理由**: 返回值明确的纯函数易于单独测试和理解。`_parse_detail_title` 和 `_fetch_title` 共享同一提取逻辑（当前 25 行重复），提取后两者都调用 `_extract_title_from_doc(doc)`。

### D4: `BaseParser` mixin 设计

**选择**: 创建 `ParserContextMixin` mixin 类，提供 `close()` / `__enter__` / `__exit__`。4 个 parser 继承它。

```python
class ParserContextMixin:
    def close(self):
        self._session.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        self.close()
```

**替代方案**:
- 创建完整 `BaseParser` 抽象基类 → 拒绝，4 个 parser 的公共接口除了 context manager 外几乎没有重叠（search 参数不同、auth 机制不同）
- 使用 `contextlib.contextmanager` 装饰器 → 拒绝，parser 需要复用实例，generator-based context manager 不适合

**理由**: Mixin 是最小侵入性的方式。不改变继承链，每个 parser 的 `__init__` 签名完全不受影响。

### D5: `ReadingHistoryEntry` 参数对象化

**选择**: 创建 `ReadingHistoryEntry` dataclass（11 字段 → 1 对象）。IPC handler 从 RPC params 解包后构造，内部 `upsert()` 接收对象。

```python
@dataclass
class ReadingHistoryEntry:
    comic_id: str
    title: str
    cover_url: str
    source: str
    source_site: str
    media_id: str
    source_url: str
    last_page: int = 0
    total_pages: int = 0
    last_chapter_id: str = ""
    last_chapter_name: str = ""
```

**替代方案**:
- `TypedDict` → 拒绝，dataclass 提供更好的 IDE 支持和 `__init__` 签名
- 在 IPC handler 层面合并参数 → 拒绝，`upsert()` 方法本身也需要清理

**理由**: 兼容性：IPC handler `handle_add_history` 仍接收逐字段参数（来自前端 JSON），内部构造 `ReadingHistoryEntry`，IPC 协议不变。`upsert()` 签名从 11 参数降为 2（`self, entry`）。

### D6: 异常处理收紧策略

**选择**: 解析器中的裸 `except Exception` 替换为 `except (requests.RequestException, ParserResponseError, ValueError) as e`。

IPC 层中的缓存写入失败（`cover_mixin`, `preview_mixin`）用 `except (OSError, sqlite3.Error) as e: logger.debug(...)` 替代。

**替代方案**:
- 保留裸 except 并只加日志 → 拒绝，`MemoryError` 和 `KeyboardInterrupt` 不应被捕获
- 在每个函数添加完整的异常类型枚举 → 拒绝，分析每个调用链的成本太高，先基于通用模式收紧

**理由**: 最低成本降低风险。网络层异常类型已知（`requests.RequestException`），解析层异常是本项目自定义（`ParserResponseError`）。缓存写入只关心 IO/DB 异常。不符合这些类型的异常应该自由传播到顶层 handler 记录并报告。

## 风险 / 权衡

- **[风险] `download_comic_resume` 签名变更可能遗漏调用方** → 缓解：全局 grep 确认唯一调用方是 `download_manager.py:_execute_download`
- **[风险] `_parse_detail` 拆分引入回归** → 缓解：31 个 `test_jmcomic_parser.py` 用例覆盖标题/章节/图片/元数据提取；每 phase 后跑全量 pytest
- **[风险] `_modify_task_locked` 回调闭包难以调试** → 缓解：4 个方法中的回调逻辑 ≤5 行，复杂度低；保留原方法签名不变
- **[权衡] `DownloadOptions` 放在 `downloader.py` 而非 `models.py`** → 原因：它是 `ComicDownloader` 的私有类型，不应暴露为全局数据模型
- **[权衡] `_DetailMetadata` dataclass 引入了新类型** → 原因：7 个子方法的返回值需要一个载体，而裸 tuple 无法提供字段名自文档化
