## 上下文

本项目（HComic Downloader，Electron + React + Python 后端）经过多轮迭代，测试覆盖已较完善（666 pytest 用例 + 57 vitest 文件），但代码库积累了死代码与冗余实现。本次变更为纯代码卫生清理，无新功能、无规范级行为变更。

关键约束：
- IPC 通道常量与 `handle_*` 方法通过 `python/ipc_server.py` 的 `_HANDLER_NAMES` 字典 + `getattr` 动态分发，静态分析工具（vulture）会大量误报，本次清理已人工逐一排除此类误报。
- sqlite 连接在多线程下载场景下统一使用 `check_same_thread=False` + WAL 模式，这是项目既定策略。

## 目标 / 非目标

**目标：**
- 移除所有经核实的零引用/仅测试引用的死代码（Python + 前端）
- 合并两处明确的冗余实现（`DEFAULT_IMAGE_EXT` 重复定义、sqlite 连接样板）
- 清理仓库根目录的散落一次性工件
- 每个变更步骤后保持完整验证流程（pytest + tsc + npm test + lint + black）通过

**非目标：**
- **不**重构根目录 15 个平铺 `.py` 模块的组织结构（属 Tech Debt，风险高，超出本次范围）
- **不**合并各来源解析器各自的 session/auth 配置（Mixin 设计要求）
- **不**拆分超长函数或消除模式重复（高风险技术债，需单独提案）
- **不**改变任何对外契约（IPC 通道、CBZ 格式、ComicInfo.xml schema、配置文件结构）
- **不**触碰 `npm run dev.bat`（用户明确保留）

## 决策

### 决策 1：对"仅测试在用"的死代码采取激进删除策略

**选择**：函数/方法/属性 + 对应测试一并删除。

**理由**：本项目为内部桌面应用，非发布库。这些符号不构成对外 API 契约，保留它们只是让测试覆盖死代码本身。删除后测试数量约减少 10 个，但测试有效性不降（这些测试不验证任何生产路径）。

**替代方案**：保守保留为"公共 API 缓冲"。**否决**：无发布场景，缓冲无意义，徒增维护成本。

### 决策 2：`get_output_path` 删除时的测试迁移策略

**背景**：`CBZBuilder.get_output_path` 被三类引用：
1. `tests/test_cbz_builder.py:270,283,296,312` —— 直接测试该方法 → **删除测试**
2. `tests/test_download_history.py:138,176` —— 作为构造期望路径的工具 → **迁移调用**
3. `tests/test_download_manager.py:262` —— `_FakeBuilder` 测试桩的方法 → **迁移桩**

**选择**：将 (2)(3) 迁移到 `get_output_path_for_format(comic, "cbz", download_dir)`。

**等价性证明**（已核对 `cbz_builder.py` 源码）：
- `get_output_path(comic, download_dir)` → 调用 `_generate_output_path(comic, download_dir)`（第 357 行）
- `get_output_path_for_format(comic, "cbz", download_dir)` → 在第 648 行走 `else` 分支调用 `_generate_output_path(comic, download_dir)`
- 两者产出**字节级一致**的路径

`tests/test_download_manager.py:262-263` 的 `_FakeBuilder.get_output_path` 当前已是简单委托给 `get_output_path_for_format`，删除后该桩方法同步移除。

### 决策 3：sqlite 连接助手的设计

**选择**：在 `utils.py` 新增：
```python
def open_sqlite_db(db_path: str, *, row_factory: bool = False) -> sqlite3.Connection:
    """统一的 sqlite 连接初始化：check_same_thread=False + WAL 模式。"""
    conn = sqlite3.connect(db_path, check_same_thread=False)
    if row_factory:
        conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn
```

**理由**：
- 6 处现有代码中，4 处用 `sqlite3.Row`（`favourite_tags_mixin`、`history_mixin`、`tag_list_mixin`、`download_history` 的部分路径），2 处不用（`cover_cache`、`preview_cache`）。用 `row_factory` 布尔参数区分。
- `download_history.py` 的现有代码未显式设置 `row_factory`（用 `row[1]` 索引访问），保持 `row_factory=False` 以**严格保持现有行为**。

**替代方案 A**：返回 `(conn, cursor)` 元组。**否决**：过度封装，调用方多数需要 conn 自身。
**替代方案 B**：做成上下文管理器。**否决**：现有 6 处都把 conn 存为 `self._conn` 长期持有（非临时连接），上下文管理器不匹配生命周期。

### 决策 4：死代码判定方法

**选择**：以"全项目 grep 引用数 + 人工核对动态分发/协议约定"为准则，不依赖单一工具。

**理由**：vulture 在本项目报出 80+ 候选，其中约 90% 是误报（IPC 动态分发的 `handle_*`、sqlite 约定的 `_db_path`/`row_factory`、Python 协议的 `__exit__(*args)`、`shutil.rmtree` 的 `onerror(func, path, exc_info)` 回调签名）。每个删除项都经过 `grep -rn "<symbol>" --include="*.py" .` 的全项目验证。

### 决策 5：派生死代码的连锁清理

**背景**：实施阶段 4 时发现，删除某些方法后会产生**派生死代码链**（原本被它们调用的私有方法/常量/import 变成孤儿）。

**选择**：对私有成员（`_` 前缀方法和模块内部常量/import）做连锁清理；对公共 API 表面（构造函数参数、类属性）保守保留。

**已清理的派生链：**
- 删 `JmDomainResolver.resolve()` 后，其专属私有方法 `_read_cache`/`_write_cache`（仅 resolve 调用）+ 常量 `CACHE_TTL_SECONDS`/`FALLBACK_DOMAIN` + `import time` 全部成为孤儿 → 一并删除。
- 删 `IPCServer._detect_image_type`/`_referer_for_image_url` 后，对应 import `detect_image_type`/`referer_for_image_url` 成为孤儿 → 一并删除（含调整 `noqa` 注释）。
- 删 `MultiSourceParser.get_source_options` 后，类属性 `SOURCE_OPTIONS`（仅它使用）成为孤儿 → 一并删除。
- 删 `URLValidator._is_trusted_cdn` 后，实例属性 `_trusted_cdn_domains` + 构造参数 `trusted_cdn_domains` 成为孤儿 → **保留**（属构造函数签名，公共 API 表面，无人传参但保守不动）。

**理由**：私有成员不构成对外契约，留着是明确死代码，违背清理初衷；公共 API 表面的变更可能影响调用方（即便当前无人传参），留待后续更显式的提案处理。

### 决策 6：审查纠正 —— `_` 前缀不等于无外部调用

**背景**：最初将 `_test_domain`（`JmDomainResolver` 的私有方法）判定为 `resolve` 的专属派生死代码，准备一并删除。代码审查指出该方法实际被 `python/ipc/config_mixin.py:64` 跨模块调用：`resolver._test_domain(v)` —— 它是设置页"测试自定义域名可用性"功能的核心。

**结论**：`_test_domain` 和其依赖 `TEST_TIMEOUT` 必须**保留**。实施时该方法实际未被删除（删除范围控制在 `resolve`/`_read_cache`/`_write_cache` 三个方法），但这一判断过程暴露了决策 5 的盲区。

**教训**：`_` 前缀（Python 约定的"私有"）**不保证**无外部调用 —— 在没有 `__all__` 或访问控制的 Python 中，跨模块调用私有方法是常见现象。决策 5"对 `_` 前缀方法做连锁清理"的准则在此需要加一条约束：**删除任何 `_` 前缀成员前，必须全项目 grep 确认无跨模块调用**，不能仅凭"它在类内只被某个已删方法调用"就判定为派生死代码。

**验证**：`_test_domain` 与 `TEST_TIMEOUT` 当前均存在于 `sources/jmcomic/domain.py`，相关测试（test_config / test_jmcomic_*）130 项全过。

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| 误删被反射/字符串引用的符号 | 所有候选均经全项目 grep 验证；IPC `handle_*` 系列明确排除；前端 IPC 通道常量逐个核对字符串字面量引用 |
| `get_output_path` 迁移后路径计算偏差 | 已在源码层证明两者调用同一 `_generate_output_path`；迁移后 `test_download_history` 和 `test_download_manager` 全量运行验证 |
| sqlite 助手引入行为差异（如遗漏 PRAGMA） | 助手严格复刻现有 6 处的初始化序列；`download_history.py` 用 `row_factory=False` 保持索引访问语义；迁移后跑全套数据库相关测试 |
| 删除 `build_cbz_simple` 影响外部脚本 | 该函数非 CLI 入口、非模块 `__main__`、未在任何 `.bat`/`.sh`/文档中提及，全项目仅测试引用 |
| 删除测试后覆盖率下降 | 这些测试覆盖的是死代码本身，删除不影响生产路径覆盖率；迁移类测试（`get_output_path`→`get_output_path_for_format`）保持等价覆盖 |

**回滚策略**：所有变更为纯删除/合并，无数据迁移、无配置变更。如验证失败，`git revert` 单个提交即可完整回滚。建议每个阶段（Cruft / Dead / Redundant）独立提交，便于二分定位。
