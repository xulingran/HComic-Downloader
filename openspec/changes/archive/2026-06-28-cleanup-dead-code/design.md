## 上下文

本变更是 `2026-06-15-cleanup-dead-code-and-redundancy` 归档变更的延续——代码库经多轮迭代后再次积累了死代码与逐行重复。本次范围严格限定在**内部清理**（proposal 的 A–E 五项），不触及 parser 基类、IPC 通知层、遗留配置垫片等更大规模的重构（这些已在 proposal 的"非目标"中排除）。

**当前状态约束**：
- 测试基线完善（666+ pytest 用例、146 个测试文件），合并前后跑全套验证即可证明行为等价
- `IPCMethods` 类型契约层与 Python `_handler_param_keys` 自省机制保证 IPC 通道一致性，本次不改动任何通道签名
- 错误消息字符串、返回结构、异常类型是**对外可观察行为**，抽象后必须字面等价（错误前缀字符串、字段名、字段顺序）

**关键发现：抽象前的陷阱调研**

在动手前逐文件核验了三处"看似可合并、实则行为不同"的代码，这些差异决定了抽象方案，必须在实现时保留：

1. **login handler 差异**（`auth_mixin.py:108/137/166`）：
   - moeimg 用 `cookie=cookie`，bika/hcomic 用 `bearer_token=token`
   - hcomic 多一行 `self.downloader.configure_auth(bearer_token=token)`
   - 三者 source 名、parser 取值（`self.parser.parsers.get(<source>)`）不同
   - → 不能合并成单一调用，必须保留参数化

2. **auth 关键字检查的 source 白名单差异**（`search_mixin.py:135` vs `:147`）：
   - `_is_source_auth_error` 先过滤 `source not in ("jm","copymanga","hcomic") → False`
   - `_auth_error_guard` 内的 `ParserResponseError` 分支**不做** source 过滤——任何 source 匹配关键字都转 `AuthRequiredError`
   - → 直接让 `_auth_error_guard` 调用 `_is_source_auth_error` 会**改变行为**（增加 source 白名单，原来会触发的现在被跳过）

3. **收藏夹去重的日志差异**（`search_mixin.py:299` vs `:319`）：
   - `handle_get_favourites` 在去重后多一段 `if len(deduped) < len(comics): logger.info(...)`
   - `handle_parse_jm_favourites_snapshot` 没有这段日志
   - → 抽取的 `_dedupe_comics` 必须保留可选日志参数，或由调用方自行判断

## 目标 / 非目标

**目标：**
- 删除 7 项零引用的硬死代码（Python 2 项 + 前端 5 项，含 1 项同名异值混淆修正）
- 合并 4 处逐行同构的重复实现（C1 打开目录、C2 黑名单校验、C3 登录、D 收藏夹去重），保持行为字面等价
- 修正 auth 关键字检查的重复（E），**但不引入 source 白名单回归**
- 全套验证（pytest / tsc / vitest / ruff / black / eslint）通过，作为等价性证据

**非目标：**
- 不抽 `configure_auth` / `_request_text` / `_request_json` 等 parser 跨文件重复（属 parser 基类重构，留待后续变更）
- 不收敛 JSON-RPC 通知样板（涉及 25+ 处跨 6 个 mixin，风险与本次目标不匹配）
- 不删除 `Config.auth_cookie` / `auth_user_agent` 遗留镜像字段（迁移垫片，需独立评估旧用户配置兼容性）
- 不删除"契约文档型"类型（`SearchResult` / `AppConfig` / `DiagnosticsReport` 等被 `IPCMethods.result` 引用的类型）
- 不删除 `PYTHON_IPC_CHANNEL_MAP` / `IPCMethods`（一致性测试的回归守护基准）
- 不修复 `IPCMethods.download` 缺 `chapter_ids` 的契约漂移（独立功能性问题，单独变更处理）

## 决策

### 决策 1：死代码删除策略——"测试驱动保留"一并清理

**选择**：对于"生产零引用、仅测试在用"的符号（`is_image_file`、相关 anim.ts 符号若被测），连同覆盖它的测试用例一并删除。

**理由**：本项目是内部应用而非发布库，这些符号不构成对外 API 契约。保留它们只是让测试覆盖死代码本身，无实际价值，反而让"未使用符号"的 IDE 提示失效。

**替代方案**：保留测试以维持覆盖率数字 → 否决，覆盖率应反映真实生产代码而非死代码。

### 决策 2：打开目录 handler 抽取私有方法（C1）

**选择**：在 `download_mixin.py` 中新增私有方法：

```python
def _open_in_file_manager(self, directory: str) -> None:
    """Open a directory in the OS-native file manager.

    Shared by download/cache dir openers; both delegate here after
    existence validation. Raises RuntimeError on failure.
    """
    import platform
    import subprocess
    try:
        system = platform.system()
        if system == "Windows":
            os.startfile(directory)
        elif system == "Darwin":
            subprocess.Popen(["open", directory])
        else:
            subprocess.Popen(["xdg-open", directory])
    except Exception as e:
        logger.error("Open directory error: %s", e)
        raise RuntimeError(f"Failed to open directory: {e}") from e
```

`handle_open_download_dir` 与 `handle_open_cache_dir` 退化为：

```python
def handle_open_download_dir(self) -> dict:
    directory = self.config.download_dir
    if not directory or not os.path.isdir(directory):
        raise ValueError(f"Download directory does not exist: {directory}")
    self._open_in_file_manager(directory)
    return {"success": True}
```

**理由**：两个 handler 的平台分支与错误处理完全一致（连 `logger.error` 文案都接近），唯一差异是 directory 来源与存在性校验文案。私有方法保持局部 import（`platform`/`subprocess`）以匹配现有代码风格。

**替代方案**：上移到 `utils.py` 作公共函数 → 否决，目前仅这 2 处使用，过早抽象。

### 决策 3：黑名单校验器抽内部工厂（C2）

**选择**：在 `validators.ts` 中新增**非导出**的工厂函数：

```typescript
function blacklistValidator(
  label: 'duplicateBlacklist' | 'missingBlacklist'
): Validator<Record<string, Array<{ fingerprint: string; memberCount: number | null }>>> {
  return (value): value is ... => {
    if (typeof value !== 'object' || value === null) {
      throw new ValidationError(`${label} must be an object`)
    }
    // ... 其余校验逻辑，所有硬编码字符串改用 ${label} 模板
  }
}

export function duplicateBlacklist() {
  return blacklistValidator('duplicateBlacklist')
}
export function missingBlacklist() {
  return blacklistValidator('missingBlacklist')
}
```

**理由**：两个函数 docstring 明写"校验规则完全一致"，唯一差异是错误前缀。`label` 用字面量联合类型而非 `string`，避免拼写错误导致错误消息分叉。两个 export 保持公开签名不变（外部调用方零感知）。

**替代方案**：合并成一个 `blacklist(label: string)` 导出 → 否决，会破坏现有 import 站点（`duplicateBlacklist`/`missingBlacklist` 名称已被消费）。

### 决策 4：登录 handler 抽参数化方法（C3）

**选择**：在 `auth_mixin.py` 中新增私有方法：

```python
def _do_password_login(
    self,
    source: str,
    username: str,
    password: str,
    *,
    credential_kind: str,  # "cookie" | "bearer_token"
    apply_to_downloader: bool = False,
) -> dict:
    """Shared body for moeimg/bika/hcomic password login handlers.

    Validates credentials, persists them, calls parser.login(), then
    writes source_auth under config lock. Returns uniform success dict.
    """
    from config import AuthSourceData

    if not username or not username.strip():
        raise ValueError("请输入用户名")
    if not password or not password.strip():
        raise ValueError("请输入密码")
    username = username.strip()
    password = password.strip()

    parser = self.parser.parsers.get(source)
    if not parser:
        raise ValueError(f"{source} 来源不可用")

    # 凭据持久化解耦（credential-persistence spec）...
    self._persist_credentials(source, username, password)
    parser.set_stored_credentials(username, password)
    secret = parser.login(username, password)

    auth_kwargs = {credential_kind: secret, "username": username, "password": password}
    with self._config_write_lock:
        self.config.set_source_auth(source, AuthSourceData(**auth_kwargs))
        self.config.save(_get_config_path())

    configure_kwargs = {credential_kind: secret, "source": source}
    self.parser.configure_auth(**configure_kwargs)
    if apply_to_downloader:
        # 仅 hcomic：下载器需要同步 bearer_token
        self.downloader.configure_auth(**{credential_kind: secret})

    logger.info("%s login successful for user %s", source, username)
    return {"success": True, "message": "登录成功"}
```

三个 handler 退化为：

```python
def handle_moeimg_login(self, username: str, password: str) -> dict:
    return self._do_password_login("moeimg", username, password, credential_kind="cookie")

def handle_bika_login(self, username: str, password: str) -> dict:
    return self._do_password_login("bika", username, password, credential_kind="bearer_token")

def handle_hcomic_login(self, username: str, password: str) -> dict:
    return self._do_password_login(
        "hcomic", username, password,
        credential_kind="bearer_token", apply_to_downloader=True,
    )
```

**理由**：核验发现三个 handler 同构但有三处差异（credential_kind、是否 apply_to_downloader、source 名），通过两个关键字参数完整参数化。注释块（credential-persistence spec 说明）原样搬入私有方法，保留语义。日志格式从 `"moeimg login successful"` 改为 `"%s login successful"`——措辞等价，仅参数化。

**替代方案**：
- (a) 用策略对象/dispatch 表 → 否决，过度设计，3 个 handler 不值得引入新抽象层
- (b) 不合并，仅删重复注释 → 否决，docstring 已明确说明同构，重复风险持续存在

### 决策 5：收藏夹去重抽模块级私有函数（D）

**选择**：在 `search_mixin.py` 模块级新增：

```python
def _dedupe_comics(comics: list[ComicInfo]) -> tuple[list[ComicInfo], int]:
    """Deduplicate comics by (source_site, id, comic_source).

    Returns (deduped_list, original_count) so callers can log when
    dedup actually occurred.
    """
    deduped: list[ComicInfo] = []
    seen: set[tuple] = set()
    for c in comics:
        key = (c.source_site, c.id, c.comic_source)
        if key not in seen:
            seen.add(key)
            deduped.append(c)
    return deduped, len(comics)
```

`handle_get_favourites` 调用处保留原日志：
```python
deduped, original_count = _dedupe_comics(comics)
if len(deduped) < original_count:
    logger.info("Deduplicated favourites: %d -> %d", original_count, len(deduped))
```
`handle_parse_jm_favourites_snapshot` 调用处不记日志（保持现状）：
```python
deduped, _ = _dedupe_comics(comics)
```

**理由**：返回 `original_count` 让调用方决定是否记日志，保留两个调用点的行为差异。**类型契约**：签名显式标注 `list[ComicInfo]`——`ComicInfo` 经文件已有的 `TYPE_CHECKING` 块导入（配合 `from __future__ import annotations`，注解在运行时惰性求值，零开销）。这使 `c.source_site`/`c.id`/`c.comic_source` 的隐式属性访问获得 IDE 补全与静态检查保护，符合项目"所有函数必须有完整类型注解"的规范。

> **决策修订（2026-06-28）**：初版曾用 `list`/`tuple` 弱类型，理由是"避免 import 循环"。复核发现该理由**不成立**——`download_mixin.py:12` 已在模块顶层（运行时）`from models import ComicInfo` 且无循环；`models.py` 不依赖 ipc 层。故改为强类型签名。

**替代方案**：让函数内部记日志 → 否决，会改变 `handle_parse_jm_favourites_snapshot` 当前不记日志的行为。

### 决策 6：auth 关键字检查——保持行为等价的去重（E）

**选择**：**不**直接让 `_auth_error_guard` 的 `ParserResponseError` 分支调用 `_is_source_auth_error`。而是在模块级抽取纯函数：

```python
def _matches_auth_keywords(message: str) -> bool:
    """Check if an error message matches any auth-failure keyword."""
    msg = message.lower()
    return any(kw in msg for kw in _AUTH_KEYWORDS)
```

两处都改为调用它：
- `_is_source_auth_error`：`return _matches_auth_keywords(str(error))`（保留 source 白名单前置检查）
- `_auth_error_guard` 的 `ParserResponseError` 分支：`if _matches_auth_keywords(msg): raise AuthRequiredError(msg) from e`

**理由**：这是**唯一能保持行为等价**的去重方式。如调研发现，直接复用 `_is_source_auth_error` 会引入 source 白名单回归（原来 moeimg 等非白名单 source 匹配关键字也会转 `AuthRequiredError`，复用后会被跳过）。抽取纯字符串匹配函数 `_matches_auth_keywords` 只消除字面重复，不触碰 source 白名单差异。

**替代方案**：让 `_auth_error_guard` 调 `_is_source_auth_error(source, e)` → **否决**，引入行为回归（详见 Risks）。

### 决策 7：anim.ts 内部 `STAGGER_LIMIT` 重命名为 `CARD_STAGGER_LIMIT`（B 项同名异值修正的命名收尾）

**选择**：在删除 `STAGGER_LIMIT = 20` 的 `export` 基础上，进一步将文件内部常量**重命名**为 `CARD_STAGGER_LIMIT`，同步更新其全部内部引用（`getCardItemVariants` 的比较与 docstring）。

**理由**：仅取消 export 并未完全达成"消除同名异值陷阱"的目标。重命名前，`anim.ts` 第 111 行注释引用组件侧 `STAGGER_LIMIT（40）`、第 180/186/200 行引用本文件 `STAGGER_LIMIT = 20`——同一文件内两个同名实体（一个指卡片网格阈值、一个指 tag 列表阈值）的数字并列出现，读者仍需来回比对才能确认这俩是不同对象的阈值。重命名为 `CARD_STAGGER_LIMIT` 后：
- 名称本身即表明"作用于卡片网格"，与组件侧 tag 列表阈值从命名层面分化
- 重命名后**全仓仅剩 `ComicInfoDrawer.tsx` 一处 `STAGGER_LIMIT`**（tag stagger，=40），不再有任何同名歧义
- `anim.ts` 自身是 `CARD_STAGGER_LIMIT` 的唯一持有者，注释里出现的 `STAGGER_LIMIT` 现在无歧义指向组件侧

**替代方案**：仅取消 export 不重命名 → 否决。初版 tasks.md 2.6 就是该方案，但 review 发现注释层面仍有同名异值混淆，命名分化才是根治。

**风险**：重命名是纯文本替换，`tsc --noEmit` 即可验证无残留引用（已验证通过）。

## 风险 / 权衡

| 风险 | 缓解措施 |
|---|---|
| **R1: 黑名单错误消息字符串分叉** —— 抽象后若 `label` 拼写错或遗漏某处替换，错误消息会偏离原值 | `label` 用字面量联合类型（TS 编译期校验）；vitest 中已有 `electron/main` 的 validator 测试覆盖错误消息文案；新增针对两种 label 的参数化测试断言关键错误前缀 |
| **R2: 登录 handler 行为回归** —— `credential_kind`/`apply_to_downloader` 参数传错会导致 cookie 写到 bearer_token 字段或下载器未同步 | 关键字参数（非位置参数）降低传错概率；`credential_kind` 用 `"cookie" \| "bearer_token"` 字面量联合（Python 中用文档约束 + 单测覆盖）；保留三个 handler 的现有集成测试 |
| **R3: auth 关键字去重引入 source 白名单回归** —— 若误用 `_is_source_auth_error` 替代 `_matches_auth_keywords`，非白名单 source 的 auth 错误会被静默吞掉 | 决策 6 明确选择抽取纯字符串函数而非复用带白名单的函数；search_mixin 现有测试覆盖各 source 的 auth 错误转换 |
| **R4: 删除 `is_image_file` 破坏 scanner 内部使用** —— 若该函数实际被 `_collect_image_files` 或 scan_download_dir 间接调用 | 实现已核验：`_collect_image_files` 用扩展名内联检查，`scan_download_dir` 不调用 `is_image_file`；仅 tests/test_maintenance_scanner.py:44 使用 |
| **R5: anim.ts 删除 `pageFlipTransition` 破坏翻页动画** —— 若某组件通过动态属性访问 | 全仓 grep 确认零引用；现有 `usePageFlipVariants` 不依赖该 transition；保留 `getDirectionalPageVariants`/`getReducedPageVariants` 的实际消费路径 |
| **R6: 删除导出的 `STAGGER_LIMIT` 破坏其他文件的 import** | 全仓 grep 确认外部零引用（`ComicInfoDrawer` 用本地同名局部常量）；删除 + 重命名为 `CARD_STAGGER_LIMIT` 后 anim.ts 内部仍可用未导出版本，`tsc` 验证无残留 |
| **R7: 抽象引入回归，但现有测试未覆盖** | tasks.md 强制每个抽象完成后立即跑相关单测 + 全套验证基线；优先做有测试覆盖的 C2（validators 有测试）作为"模板"，再推广到 C1/C3/D |
| **R8: `_dedupe_comics` 强类型签名引入 import 循环** | `ComicInfo` 经 `TYPE_CHECKING` 块导入，运行时不执行（文件已有 `from __future__ import annotations`）；`models.py` 不依赖 ipc 层，`download_mixin.py:12` 已证明无循环。`ruff` + `pytest` 验证通过 |

**整体风险评级：低**。所有变更都是行为保持型重构，且有完善的测试基线兜底。最大的认知风险（R3 source 白名单回归）已通过 design 阶段的代码核验识别并规避。
