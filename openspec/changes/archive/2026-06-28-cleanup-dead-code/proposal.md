## 为什么

代码库经过多轮迭代后，再次积累了三类冗余噪声：(1) **零引用的硬死代码**——Python 中永远不触发的分支、仅测试引用或全仓零引用的函数/常量/别名，前端 `anim.ts` 中定义后从未被任何变体或组件消费的导出符号；(2) **逐行同构的重复实现**——`handle_open_download_dir` 与 `handle_open_cache_dir` 完全复制、`duplicateBlacklist` 与 `missingBlacklist` 仅错误前缀不同、三个 login handler 同构、收藏夹去重逻辑复制两遍；(3) **同名异值的潜在混淆源**——`anim.ts` 导出的 `STAGGER_LIMIT = 20` 与 `ComicInfoDrawer` 本地声明的同名常量 `= 40` 互相冲突。这些噪声增加阅读负担、误导维护者，并使 IDE/静态分析的"未使用"提示失去信号价值。现在做是因为测试基线已完善（666+ pytest 用例、146 个测试文件），可在不破坏功能的前提下安全清理。

## 变更内容

### A. Python 硬死代码删除（零风险）

**类 A1 — 零引用（连测试都没有）：**
- `python/ipc/config_mixin.py:106` —— 死分支：`v.strip()` 后非空才进入 `if v:`，其内层 `not v` 必为假，子条件永不触发
- `python/maintenance/health_checker.py:24` —— 未使用类型别名 `HealthCheckKind = str`（全仓零引用，含 docstring/注解）

**类 A2 — "测试驱动保留"（生产无引用，仅测试在用）—— 连同测试一并删除：**
- `python/maintenance/scanner.py:299` `is_image_file()` + `python/maintenance/scanner.py:309` `__all__` 中的同名条目 + `tests/test_maintenance_scanner.py` 中仅调用该函数的用例

> **决策依据**：本项目为内部应用而非发布库，"仅测试在用"的符号不构成对外 API 契约，保留它们只是让测试覆盖死代码本身。

### B. 前端硬死代码删除

`src/lib/anim.ts` 中以下导出符号经全仓 grep 验证零外部引用（连 anim.ts 自身内部都未使用），删除：
- `standardTransition`（第 38 行）
- `createPresenceVariants`（第 51 行）—— 工厂函数定义后从未被调用，各组件直接使用具体变体
- `pageFlipTransition`（第 168 行）+ `PAGE_FLIP_DURATION`（第 165 行）+ 第 215 行的 `void pageFlipTransition` 防 tree-shake 占位语句 —— 翻页实际走 `usePageFlipVariants()` hook，从未引用此 transition

**同名异值混淆修正**：
- `src/lib/anim.ts` 中导出的 `STAGGER_LIMIT = 20`（卡片网格列表 stagger 阈值）与 `src/components/ComicInfoDrawer.tsx:444` 本地 `const STAGGER_LIMIT = 40`（tag 列表 stagger 阈值）同名异值，构成认知陷阱
- 两步修正：
  1. 删除 `anim.ts` 中该常量的 `export`，使其退化为文件内部私有
  2. **重命名为 `CARD_STAGGER_LIMIT`**——仅取消 export 仍会在注释里与组件侧同名常量混淆（anim.ts 第 111 行注释已引用 `STAGGER_LIMIT（40）`），重命名后名称本身即表明"作用于卡片网格"，从根上消除同名异值
- `ComicInfoDrawer.tsx:444` 本地 `const STAGGER_LIMIT = 40` 保留不变（这是组件实际使用的值，且重命名后全仓仅此一处 `STAGGER_LIMIT`，不再有歧义）
- 结果：导出陷阱消除 + 命名分化，读者无需比对数字即可区分两个独立阈值

### C. 逐行重复逻辑抽象

#### C1. "打开目录"handler 合并（`python/ipc/download_mixin.py:525` & `:546`）

`handle_open_download_dir` 与 `handle_open_cache_dir` 逐行同构（平台分支、`subprocess.Popen`、错误处理完全一致，仅 `directory` 来源不同——一个取 `self.config.download_dir`，一个取 `self._cover_cache.db_dir`）。抽取私有方法 `_open_in_file_manager(directory: str) -> None`，两个 handler 仅保留"取 directory + 存在性校验 + 委托调用"。

#### C2. 黑名单校验器合并（`electron/validators.ts:234` & `:282`）

`duplicateBlacklist()` 与 `missingBlacklist()` 各 ~42 行，docstring 明确写"校验规则完全一致"，唯一差异是错误消息前缀字符串。抽取内部工厂 `blacklistValidator(label: string)`，两个导出退化为 `blacklistValidator('duplicateBlacklist')` / `blacklistValidator('missingBlacklist')` 的一行薄封装。

#### C3. 登录 handler 合并（`python/ipc/auth_mixin.py:108` / `:137` / `:166`）

`handle_moeimg_login`、`handle_bika_login`、`handle_hcomic_login` 同构（用户名/密码空值校验 → 持久化凭证 → `login()` → 加锁写配置 → 返回相同 dict）。抽取私有方法 `_do_password_login(source: str, username: str, password: str) -> dict`，三个 handler 仅保留"参数提取 + 调用"。

> **范围限定**：本次**不**抽 `configure_auth`/`_request_text` 等跨文件的 parser 基类重复（属更大规模重构，留待后续变更）；**不**收敛 JSON-RPC 通知样板（涉及 25+ 处、跨 6 个 mixin，风险与本次清理目标不匹配）；**不**触碰 `Config.auth_cookie/auth_user_agent` 遗留镜像字段（迁移垫片，需独立评估旧用户配置兼容性）。

### D. 收藏夹去重逻辑去重（`python/ipc/search_mixin.py:299` & `:319`）

`handle_get_favourites` 与 `handle_parse_jm_favourites_snapshot` 各自实现完全相同的 `(source_site, id, comic_source)` 元组去重。抽取模块级私有函数 `_dedupe_comics(comics: list[ComicInfo]) -> tuple[list[ComicInfo], int]`，两处调用之。**类型契约**：函数签名显式标注 `list[ComicInfo]`（通过 `TYPE_CHECKING` 导入，配合文件已有的 `from __future__ import annotations` 保持注解惰性、零运行时开销），使 `c.source_site`/`c.id`/`c.comic_source` 的隐式访问获得 IDE 补全与静态检查保护。

### E. auth 关键字匹配去重（`python/ipc/search_mixin.py:135` & `:147`）

`_is_source_auth_error` 与 `_auth_error_guard` 内的 `ParserResponseError` 分支各自重复 `any(kw in msg.lower() for kw in _AUTH_KEYWORDS)` 检查。`_auth_error_guard` 改为复用 `_is_source_auth_error`。

## 功能 (Capabilities)

### 新增功能
（无）

### 修改功能
（无 —— 本次为纯代码卫生清理，不引入新功能，不改变任何对外规范级行为。所有删除项均经跨文件引用搜索验证为零引用或被取代的死代码；所有合并均保持行为等价，错误消息字符串、返回结构、异常类型不变。）

## 影响

**受影响代码：**
- Python：`python/ipc/{config_mixin,search_mixin,auth_mixin,download_mixin}.py`、`python/maintenance/{scanner,health_checker}.py`
- Python 测试：`tests/test_maintenance_scanner.py`（删除仅覆盖 `is_image_file` 的用例）
- 前端：`src/lib/anim.ts`、`src/components/ComicInfoDrawer.tsx`（仅注释或局部变量重命名，无行为变化）
- TypeScript：`electron/validators.ts`

**不受影响：**
- IPC 通道契约（`PYTHON_IPC_CHANNEL_MAP`、`IPCMethods` 等契约文档型常量/类型保留不动）
- 任何运行时行为（错误消息、返回结构、异常类型经抽象后保持字面等价）
- 对外数据格式（CBZ/ComicInfo.xml/schema 不变）
- 未使用的"契约文档型"类型（`SearchResult`/`AppConfig`/`DiagnosticsReport` 等，它们被 `IPCMethods` 的 result 字段引用，是 IPC 契约的一部分，不在本次删除范围）

**验证基线**：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint` 全部通过，作为合并前后行为等价性的证据。
