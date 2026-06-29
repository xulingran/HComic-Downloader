## 为什么

`test-discipline` 规范定义了"什么是好测试"的判断标准，但当前它是**事后被动执行**的——上一轮 `strengthen-test-suite` 一次性清理了一批同义反复测试（用例计数从 1435 起步），却未建立阻止它们**重新长出来**的机制。结果审计发现：

1. **同义反复测试仍在积累**：`comicStore.test.ts`（6/6 用例）、`settingsStore.test.ts`（5/6 用例）、`useReaderStore.test.ts`（3/3 用例）整文件验证 Zustand `setX(x) → getState().x === x` 的框架基本保证——正是规范明确判定为"必须移除"的类别，但它们在清理轮次之后被新写出来，至今仍存活。
2. **裸 mock 调用断言仍在新增**：`test_migration_mixin.py` 有 6 处 `assert_called_once()` 断言仅重述紧邻的实现行（toggle_global_pause / pause / resume），不验证可观察状态变化；`ipc-channel-consistency.test.ts` 末尾的 `it('no IPC channel string should appear as a raw string...')` 标题承诺扫描源文件，实际只断言常量集合非空。
3. **无预防机制**：CI 与 lint 链路中没有任何规则能拦截这两类测试进入仓库。每次清理都是一次性的体力活，信号质量随时间衰减。

为什么现在做：审计刚刚把现存低价值测试盘清，此时清理 + 落闸的成本最低；再拖一轮，清理面会扩大，且没有闸门意味着下一轮审计会重演同样的发现。

## 变更内容

### Phase 1 — 清理现存同义反复测试（方向 1）

逐文件精简，每个删除用例按规范要求记录理由（原断言 + 为何低价值）：

- **删除纯框架 CRUD 测试**：`comicStore.test.ts`（整文件）、`settingsStore.test.ts`（保留"切换所有主题模式"参数化用例，删除其余 setter 往返）、`useReaderStore.test.ts`（整文件）。
- **删除/降级裸 mock 调用断言**：`test_migration_mixin.py` 6 处 `assert_called_once()` 降级为只保留 `_migration_paused_dm` 状态断言（信号源），删除冗余的 mock 计数断言。
- **修正名不副实的测试**：`ipc-channel-consistency.test.ts` 末尾用例要么真正扫描 `electron/preload.ts` 与 `electron/main.ts` 中的裸字符串，要么重命名为如实反映行为的"常量非空健全性检查"。

### Phase 2 — 建立预防性闸门（方向 2）

- **前端 ESLint 自定义规则**（或现成插件的规则）：在 `tests/unit` 作用域内，标记仅断言 `expect(mock).toHaveBeenCalled()` / `toHaveBeenCalledTimes()` 而**不同时**断言返回值、抛错或可观察状态变化的用例为 lint 错误（附带"补充行为断言或删除"的修复提示）。
- **Python 自定义检查**：通过 `tests/conftest.py` 注册一个 collection-time 静态扫描（或 ruff 自定义规则 / 简单 AST 脚本），对 `assert_called*()` 同样应用"必须伴随状态/返回值断言"准则。
- **store CRUD 同义反复守卫**：对 `tests/unit/stores/**/*.test.ts` 增加一条专项检查——禁止"调用 `setX(v)` 后仅断言 `getState().x === v`"的成对模式，除非该 store 存在派生逻辑（如 `searchCacheStore` 的上下文隔离、`historyStore` 的预加载不覆盖）。

两 Phase 的耦合关系：Phase 2 的闸门在 Phase 1 完成前**不能启用为 error**，否则现有代码会立即失败；Phase 1 完成后闸门才转为强制。

## 功能 (Capabilities)

### 新增功能

- `test-quality-gate`: 测试质量闸门——在 CI/lint 链路中自动拦截两类低价值测试（裸 mock 调用断言、纯框架 CRUD 往返），把 `test-discipline` 的判断标准从被动文档转为主动门控。

### 修改功能

- `test-discipline`: 新增"预防闸门需求"——要求存在自动化机制拦截新增的同义反复测试，与既有"移除理由必须可追溯"需求配套，形成"清理 + 防回潮"闭环。同时明确"框架基本 CRUD 断言"判定的边界（哪些 store 测试因含派生逻辑而豁免）。

## 影响

- **测试删除/精简**（Phase 1，净减约 12-15 个用例、~150 行）：
  - `tests/unit/stores/comicStore.test.ts`（整文件删除）
  - `tests/unit/stores/settingsStore.test.ts`（删除 5 个 setter 用例，保留 1 个参数化用例）
  - `tests/unit/stores/useReaderStore.test.ts`（整文件删除）
  - `tests/test_migration_mixin.py`（6 处降级：保留状态断言，删除 mock 计数断言）
  - `tests/unit/main/ipc-channel-consistency.test.ts`（修正/重命名末尾用例）
- **新增闸门**（Phase 2）：
  - ESLint 自定义规则 / 配置（前端，作用域 `tests/unit`）
  - Python collection-time 扫描或 AST 脚本（挂到 `conftest.py` 或 `scripts/`）
  - `pyproject.toml` / `eslint.config.js`（规则注册）
  - `AGENTS.md` "完整验证流程"章节新增闸门检查步骤
- **CI 影响**：lint 阶段增加两条规则执行；构建时间增量可忽略（静态扫描，无运行时开销）。
- **无应用代码变更**，无 API 变更，无依赖变更，无破坏性变更——纯测试基础设施。
- **保留一切真实行为测试**：`searchCacheStore`、`historyStore`、`useComicReader`、`test_models`、`test_download_manager_concurrency`、`ipc-arity-parity` 等验证真实逻辑的测试不受影响。
