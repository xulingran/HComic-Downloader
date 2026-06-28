## 上下文

`_get_config_path()`（`python/ipc/types.py:12-13`）硬编码返回 `os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "config.json")`，无任何注入点。它被 4 个模块各自 `from .types import _get_config_path` 绑定成本地名（`auth_mixin`、`config_mixin`、`migration_mixin`、`ipc_server`），外加 `ipc.types` 源头共 5 个名字绑定。

`Config.save(path)`（`config.py:305`）接收路径参数并 `os.makedirs(os.path.dirname(path), exist_ok=True)` 后原子写入。所有触发落库的 handler（`auth_mixin.py:50/77/150`、`config_mixin.py:240`、`migration_mixin.py:93`）都传 `_get_config_path()`。

现有隔离范式分散且各有盲区：

| 测试文件 | 隔离方式 | 盲区 |
|----------|---------|------|
| `test_ipc_download_conflict.py` | `patch("python.ipc_server._get_config_path")` | Python import 陷阱：只替换 ipc_server 重导出名，对 3 个 mixin 的本地绑定无效。该测试恰好不触发 save 才未暴露 |
| `test_migration_mixin.py` | `m.config = MagicMock()` 整体 mock | 绕过 save 而非重定向路径 |
| `test_download_dir_migration.py` | 自建 harness，`config` 是手动 `Config()` | 不触发 save，绕过路径 |
| `test_config.py` | 显式传 `tempfile` 路径给 `Config.save(path)` | 完全不依赖 `_get_config_path` |
| `test_ipc_auth_mixin.py` | 既不 mock save 也不重定向路径 | **污染源**：10 个用例写真实盘 |

现有 `tests/conftest.py:76-85` 的 `temp_config` fixture 是死代码（无人引用），无任何 autouse 隔离网。

## 目标 / 非目标

**目标：**
- 根除测试对真实 `~/.hcomic_downloader/config.json` 的覆盖性写入
- 提供单一、可靠、向后兼容的隔离注入点，覆盖所有现存/未来 IPCServer 测试
- 防止回归（有人误删/禁用隔离机制时立即可见）

**非目标：**
- 不隔离其他硬编码 `expanduser("~/.hcomic_downloader/...")` 的 DB 路径（download_history.db、favourite_tags.db、reading_history.db、tag_list.db、cover_cache、preview_cache）——这些是建空表不覆盖数据，严重程度远低于 config.json
- 不处理 `python/ipc_server.py:23` 的 `LOG_DIR` import 时 makedirs（仅建空目录）
- 不改变 `Config.save()` 的并发锁契约（`_config_write_lock` 仍真实生效，save 仍真实发生，只是写到 tmp）
- 不改变 `credential-persistence` / `config` spec 的现有契约（落盘语义不变，仅落盘位置在测试中被重定向）

## 决策

### 决策 1：环境变量注入而非逐模块 monkeypatch

`_get_config_path()` 改为：

```python
def _get_config_path() -> str:
    base = os.environ.get("HCOMIC_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
    return os.path.join(base, "config.json")
```

**为什么选这个而非逐模块 patch 5 个绑定：**

环境变量在函数**调用时**读取，所以无论哪个本地绑定调用它（auth_mixin / config_mixin / migration_mixin / ipc_server），读到的都是隔离后的值——import 时机和绑定方式不再重要。逐模块 patch 可行但脆弱：任何人新增一个 mixin 导入 `_get_config_path` 又会踩同一坑，且 `patch("python.ipc_server._get_config_path")` 已证明会被 Python import 陷阱坑掉。

**考虑过的替代方案：**
- *逐模块 `monkeypatch.setattr` 5 处绑定*：能工作但脆弱，新增 mixin 即漏；样板多。
- *autouse fixture 只 patch `python.ipc.types._get_config_path`（源头）*：**不可行**。`from .types import _get_config_path` 在 mixin 模块加载时已把名字绑到本地，patch 源头模块属性不改变已导入的本地名。
- *autouse fixture mock `Config.save` 为 no-op*：改变 save 语义，影响 `test_config.py` 那类直接断言落盘文件内容的测试，需排除，副作用大。
- *把 `_get_config_path` 改成模块级可变变量 + setter*：增加全局可变状态，不如环境变量声明式。

### 决策 2：conftest autouse fixture + 环境变量，而非改测试本身

新增 autouse fixture（`tests/conftest.py`）：

```python
@pytest.fixture(autouse=True)
def _isolate_config_dir(tmp_path, monkeypatch):
    config_dir = tmp_path / ".hcomic_downloader"
    monkeypatch.setenv("HCOMIC_CONFIG_DIR", str(config_dir))
    yield
```

**为什么 autouse 而非逐测试显式请求：**
隔离"真实用户配置"是所有测试的**正确性前提**，不是某个测试的特定需求。autouse 保证未来新增的任何 IPCServer 测试（含其他用 `_create_test_server()` 的文件：contract/preview/async_main_loop/download_chapters/cache_dir）自动受保护，无需作者记得加 fixture。对不触发 save 的测试零副作用（`_get_config_path` 仅在调用时读变量，设了不读无开销）。

### 决策 3：删除而非保留冗余 save mock

`test_ipc_auth_mixin.py` 中 5 处 `server.config.save = lambda path: None`（L203/219/235/321/350）原本是为规避真实落盘而加的 workaround。autouse fixture 提供路径隔离后，这些 mock 变冗余。删除以统一行为：所有用例的 save 都真实写 tmp（受 `_config_write_lock` 串行保护），断言均读 `server.config` 内存对象，不受影响。这避免了"一半测试 mock save、一半不 mock"的认知负担。

### 决策 4：守卫测试覆盖所有 4 个绑定

新建 `tests/test_config_isolation_guard.py` 遍历 `types`/`auth_mixin`/`config_mixin`/`migration_mixin` 模块的 `_get_config_path()`，断言返回值不等于真实 HOME 路径。这能捕获三类回归：(a) autouse fixture 被误删/禁用，(b) 环境变量注入逻辑被破坏，(c) 新增 mixin 绑定未受控（只要它也被守卫遍历）。

## 风险 / 权衡

- **[环境变量在生产被意外设置]** → `or` 短路兜底：只有 `HCOMIC_CONFIG_DIR` 非空才生效，生产环境无人设置它。即便误设为空串，`or` 也会回退到 HOME。文档明确标注其用途为"测试隔离"。
- **[autouse fixture 影响其他依赖真实 HOME 的测试]** → 现已确认 `test_cache_dir.py:54,98` 断言 cache 目录**以** `expanduser("~/.hcomic_downloader")` 结尾——它测的是 `handle_get_cache_dir`（只读路径拼接逻辑，不读 `_get_config_path`），故不受环境变量影响。需在实施时复跑该文件确认。
- **[守卫测试与 autouse 形成循环依赖]** → 守卫测试**依赖** autouse fixture 生效才能通过（fixture 重定向后路径才不在真实 HOME）。这正是其价值：fixture 失效时守卫失败。无循环，是单向校验。
- **[删除 save mock 后并发测试真实落盘]** → `test_concurrent_logins_do_not_corrupt_source_auth`（10 线程）会真实并发写 tmp。受 `_config_write_lock` 串行保护（这正是它要验证的契约），且 tmp 路径每测试独立，无跨用例污染风险。
