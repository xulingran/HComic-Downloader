# Code Review Report — 2026-05-15

**项目定位:** L2 (🛠️ Tool) — 个人长期项目  
**审查范围:** 71 个文件变更，+1382 / -10217 行

本次变更是一次大规模重构，核心包括：
- 移除旧 Python GUI（tkinter），全面转向 Electron + React 前端
- 将 `ipc_server.py`（800+ 行）拆分为 Mixin 模块（`python/ipc/`）
- 提取 `ImageDownloader`（会话池）和 `UrlValidator`（SSRF 防护）
- 重构 `CBZBuilder` 消除 CBZ/ZIP 构建重复代码
- 新增 SFW 模式、搜索历史、下载趋势图、状态过滤等功能
- 移除独立的 StatisticsPage，合并到 DownloadPage

---

## 🔴 Critical Issues (Must Fix)

### 1. `image_downloader.py` — 跨域重定向导致会话池认证头丢失

**文件:** `image_downloader.py` → `download()` → `resolve_redirects()`

`resolve_redirects` 在检测到跨域重定向时会直接 `pop` 传入 session 的 `Cookie` / `Authorization` 头。由于 session 是从池中借出的对象引用，这些修改会影响归还后的 session。一旦某个图片 URL 触发了跨域重定向，该 session 归还池后就会永久丢失认证头，导致后续所有使用该 session 的下载请求都以未认证状态发出。

- **Rule:** PP-38 (Crash, Don't Burn / 缩小影响范围)
- **Principle:** 一个请求的副作用不应破坏共享资源的全局状态
- **Suggestion:** 在 `download()` 中先复制认证头，调用 `resolve_redirects` 后恢复；或者让 `resolve_redirects` 返回一个清理后的 session 副本而非修改原 session。最简方案：在 `resolve_redirects` 末尾、return 前，如果发生跨域跳转则不修改原 session，改为返回一份 headers 清理后的 session 副本。

### 2. `FavouritesPage.tsx` — 实时下载完成监听使用错误的 key 格式

**文件:** `src/pages/FavouritesPage.tsx:43-52`

`onDownloadProgress` 回调中使用 `data.taskId`（UUID 格式，由 DownloadManager 生成）作为 `downloadedStatus` 的 key。但 `downloadedStatus` 是由 `checkDownloadedStatus` 返回的，其 key 格式为 `"{sourceSite}_{source}_{id}"`（见 `download_mixin.py:209`）。两个 key 永远不会匹配，因此实时更新实际上无效。

- **Rule:** CC-153 (边界条件和错误处理)
- **Suggestion:** 在 progress 回调中，通过 `data` 中的漫画信息（title、comicId 等）构造与 `checkDownloadedStatus` 一致的 key，或者在后端通知中包含漫画标识信息。

### 3. `download_history.py` — SQL 中使用 f-string 插值

**文件:** `download_history.py:133-138`

```python
f"... WHERE downloaded_at >= strftime('%s', 'now', '-{days} days') ..."
```

虽然 `days` 是 `int` 类型参数，当前不存在注入风险，但这是危险的代码模式。如果未来有人将参数改为字符串类型或移除类型约束，就会变成 SQL 注入漏洞。

- **Rule:** PP-72 (Keep It Simple and Minimize Attack Surfaces)
- **Suggestion:** 使用参数化查询：`cursor.execute("... WHERE downloaded_at >= strftime('%s', 'now', '-' || ? || ' days')", (days,))`

---

## 🟡 Important Issues (Should Fix)

### 4. `downloader.py` — `_collect_and_advance` 有 15 个参数

**文件:** `downloader.py:149-157`

L2 阈值要求 ≤7 个参数。这个方法有 15 个参数，远超标准。

- **Rule:** CC-26 (Function Arguments) + CC-147 (Too Many Arguments)
- **Principle:** 参数过多增加认知负担，且很难记住参数顺序
- **Suggestion:** 将相关参数封装为 `@dataclass`，例如 `BatchProgressState(downloaded_count, new_completed, new_failed, last_progress_ts)` 和 `BatchContext(executor, remaining_pages, image_urls, temp_dir, download_referer, ...)`

### 5. `models.py` — `AuthUIRefs` 引用 tkinter 但属于已删除的 GUI 层

**文件:** `models.py:232-235`

```python
@dataclass
class AuthUIRefs:
    """认证 UI 组件引用，封装 tkinter 控件。"""
    login_status_var: object = None
    go_login_btn: object = None
```

这次变更已经删除了所有 tkinter GUI 文件，但 `AuthUIRefs` 仍然存在于 `models.py` 中。这是死代码。

- **Rule:** YAGNI (PP-43) + Dead Code (CC-58)
- **Suggestion:** 删除 `AuthUIRefs`，如果没有其他模块引用它的话。

### 6. `download_history.py` — `check_same_thread=False` 但缺少并发保护

**文件:** `download_history.py:19`

```python
self._conn = sqlite3.connect(db_path, check_same_thread=False)
```

禁用了线程检查，但没有添加任何锁机制。WAL 模式允许并发读，但并发写入仍需串行化。如果两个线程同时调用 `record_download` 或 `check_downloaded_batch`（其中包含写操作 `record_download`），可能出现 `database is locked` 错误。

- **Rule:** PP-57 (Don't Share State / Concurrency)
- **Suggestion:** 添加 `threading.Lock` 保护写操作，或使用队列/锁保护所有数据库访问。

### 7. `image_downloader.py` — `configure_auth` 的 drain-and-refill 不是原子操作

**文件:** `image_downloader.py:90-107`

`configure_auth` 先从 Queue 中取出所有 session，修改后放回。如果两个线程同时调用此方法（例如两个下载任务同时完成并触发配置更新），可能导致 session 泄漏或重复放入。

- **Rule:** PP-57 (Concurrency)
- **Suggestion:** 添加 `threading.Lock` 保护 session 池的所有操作（acquire/release/configure）。

### 8. `electron/python-bridge.ts` — MAX_BUFFER_SIZE 从 1MB 增至 20MB

**文件:** `electron/python-bridge.ts:7`

```typescript
const MAX_BUFFER_SIZE = 20 * 1024 * 1024
```

20 倍增幅较大。如果 Python 进程行为异常（持续输出无换行的垃圾数据），内存占用会先增长到 20MB 才触发溢出检测。

- **Rule:** PP-72 (Minimize Attack Surfaces)
- **Suggestion:** 如果增大的原因是某个 IPC 响应确实超过 1MB（例如统计数据或封面 base64），考虑在 `resolve_response` 时按需处理，而不是全局提高缓冲上限。至少添加注释说明为什么需要 20MB。

### 9. SFW 模式启动行为与设置页 toggle 语义矛盾

**文件:** `src/App.tsx:27-35`

App.tsx 中每次启动强制 `setSfwMode(true)`，但 SettingsPage 中有独立的 SFW 开关（调用 `setConfig('sfwMode', false)` 持久化到后端）。用户在设置页关闭 SFW 后，下次启动仍然被强制打开，且后端配置已存储为 `false`——两者不一致。

- **Rule:** PP-75 (The Answer Is Never "It's a Matter of Taste") — 行为应可预测
- **Suggestion:** 如果设计意图确实是"每次启动强制安全状态"，那么 SettingsPage 的 SFW 持久化配置就没有意义（重启后不生效），应该只保留 Toast 关闭按钮作为当前会话的开关，并明确告知用户这是会话级设置。或者去掉启动时的强制覆盖，改为从后端恢复配置。

---

## 🔵 Minor Issues (Nice to Have)

### 10. `DownloadPage.tsx` — 趋势图柱状条高度为 0% 时仍渲染

**文件:** `src/pages/DownloadPage.tsx:162-168`

当某天下载量为 0（`height === '0%'`），仍然会渲染一个高度为 0 的 div，产生空的 flex 项和日期标签。

### 11. `DownloadPage.tsx` 文件末尾多余空行

**文件:** `src/pages/DownloadPage.tsx` — diff 末尾显示 `\ No newline at end of file`，之后又增加了两个空行。

### 12. `usePreloadManager.ts` — 依赖 `window.hcomic!`（非空断言）

**文件:** `src/hooks/usePreloadManager.ts:44`

`window.hcomic!.fetchPreviewImage(...)` 使用了非空断言。在 Electron preload 正确加载时不会有问题，但如果在 web 环境中测试会崩溃。

### 13. `parser.py` — `MAX_PAYLOAD_SIZE` 是模块级常量但无单位注释

**文件:** `parser.py:15`

`MAX_PAYLOAD_SIZE = 2_000_000` — 赋值处没有单位说明（是 bytes？chars？），虽然错误消息中提到了 "2MB"。

---

## ✅ Strengths

- **ipc_server.py 拆分为 Mixin 模块**：从 800+ 行单文件拆分为职责清晰的独立模块（download_mixin, auth_mixin, config_mixin 等），大幅提升可维护性。
- **SSRF 防护（UrlValidator）**：新增了完整的 URL 校验、DNS 重绑定检测、重定向链验证和跨域 Cookie 剥离，安全意识很好。
- **ImageDownloader 会话池**：避免了之前每次下载任务创建/销毁 session 的开销，设计思路正确。
- **CBZBuilder 消除重复**：通过 `build_archive` 公共方法统一了 CBZ 和 ZIP 的构建逻辑，消除了明显的代码重复。
- **日志格式统一**：将所有 `f"xxx: {e}"` 格式改为 `"xxx: %s", e` 的 lazy formatting，是 Python logging 的最佳实践。
- **Config 范围常量化**：`CONCURRENT_RANGE`、`TIMEOUT_RANGE` 等提取为类常量，消除了魔法数字。
- **测试覆盖同步更新**：新增的 SSRF 测试、SFW 模式测试、搜索历史测试等都紧跟功能代码。
- **Electron main.ts 验证逻辑复用**：提取了 `validateTaskId`、`validateHttpsUrlWithDomains` 等公共验证函数，消除了大量重复代码。

---

## 📝 Verdict

⚠️ **Needs fixes** — 3 个 Critical 问题需要修复后才能提交：

1. **会话池认证头丢失**（最严重，会导致认证下载在运行中随机失败）
2. **FavouritesPage 实时状态更新 key 不匹配**（功能完全无效）
3. **SQL f-string**（代码模式风险）

其余 Important 问题建议在本次提交中一并处理，尤其是 `AuthUIRefs` 死代码清理和 `_collect_and_advance` 参数过多的问题。
