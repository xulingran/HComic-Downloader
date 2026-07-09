## 上下文

两处独立的 P2 缺陷同构：**底层真值已更新，但读到的还是旧值**。

**缺陷 A — 认证清除路径与登录路径不对称。**
JM 登录态的实际真值是 `MultiSourceParser._jm_session_auth`（`sources/__init__.py:152`，`get_runtime_auth("jm")` 在 `:338-339` 读它，`_check_source_auth` 在 `python/ipc/search_mixin.py:158` 据此判定登录态）。该字典全仓库唯一被重写处是 `MultiSourceParser.configure_auth`（`:363`）。登录路径 `handle_apply_auth`（`auth_mixin.py:129`）走的就是这个方法，正确。但清除路径 `handle_clear_source_auth`（`auth_mixin.py:270-272`）取的是 `self.parser.parsers.get(source)`（即 `JmParser` 实例）并调 `JmParser.configure_auth`，该方法只清实例自己的 `_cookie`/`_user_agent`/会话头（`sources/jm/parser.py:207-214`），碰不到 `_jm_session_auth`。

调查进一步发现该缺陷**不限于 JM**：非 JM 来源的运行期真值是 `MultiSourceParser.source_auth`（`get_runtime_auth` 在 `:340` 读它）。现有清除路径同样只清活动 parser 实例、不清 `MultiSourceParser.source_auth` 字典。因此本修复对所有来源都对齐了真值通道。

**缺陷 B — 阅读器共享缓存键缺少章节维度。**
`usePreloadManager.imageCacheRef` 是 `Map<pageIndex, urlHash>`，键只含页码。换章时 `useComicReader.fetchChapterUrls`（`useComicReader.ts:55-58`）更新 `imageUrls`/`scrambleId`/`comicId`，但：
- preload effect（`usePreloadManager.ts:116-186`）的 cleanup 只置 `cancelled=true`，从不 `clear()`；
- `clearCache()` 唯一调用点在 `ComicReaderModal.tsx:291`，位于 modal **关闭**分支，换章路径 `goToChapter`（`:230`）/`handleSelectChapter`（`:238`）不调；
- 消费者 `ReaderPage`（`:60-64`）与 `FlipPage`（`PageFlipView.tsx:363-371`）命中 `cachedUrlHash` 即 `setUrlHash(cachedUrlHash); return`，**盲信**缓存、不校验 URL。

后果：换章后当前页及相邻页可能命中上一章同 index 的 `urlHash`，渲染上一章图片；且 `buildPreloadQueue(... new Set(cache.keys()))`（`:129`）把残留 index 当"已加载"跳过，错误图片卡住直到手动重试。

现有 `reader-image-cache` 规范只覆盖了"模式切换不清、关闭才清"，漏了"换章必须清"。

## 目标 / 非目标

**目标：**
- 清除任一来源认证后，`get_runtime_auth` 立即反映为匿名（JM 的 `_jm_session_auth`、非 JM 的 `MultiSourceParser.source_auth` 与活动 parser 实例三处全部归零），与 `config.json` 一致。
- 换章（`imageUrls`/`comicId`/`scrambleId`/`imageQuality` 引用变化）时，共享图片缓存在被消费前清空，禁止跨章复用。
- 修复以最小改动闭环，不引入新概念、不扩大改动面。

**非目标：**
- 不改缓存键结构（不把 `Map<number,string>` 改成按 urlHash+comicId 复合键）——见决策 B。
- 不改消费者的盲信缓存行为（不要求 `ReaderPage`/`FlipPage` 反向校验 URL）——缓存正确性由生产端（清空）保证，而非消费端校验。
- 不动 JM 会话凭据"不持久化"的整体设计（`jm-session-cookie` spec 不变）；只是补上清除路径该走而没走的通道。
- 不动登录/应用路径（`handle_apply_auth` / `_do_password_login` / `handle_nh_apply_api_key` 已正确）。
- 不动阅读器模式切换与关闭清缓存语义。
- 不修复"换漫画（不同 comic）清缓存"——该路径已由 modal 关闭分支正确覆盖，本次聚焦换章。

## 决策

### 决策 A：清除路径改走 `MultiSourceParser.configure_auth`，而非给每来源加专门的清理方法

**选择：** `handle_clear_source_auth` 把
```python
parser = self.parser.parsers.get(source)
if parser is not None and hasattr(parser, "configure_auth"):
    parser.configure_auth(cookie="", user_agent="", bearer_token="")
```
改为
```python
self.parser.configure_auth(cookie="", user_agent="", bearer_token="", source=source)
```

**理由：**
1. **与登录路径对称**。`handle_apply_auth`（`auth_mixin.py:129`）、`_do_password_login`（`:203`）、`handle_nh_apply_api_key`（`:245`）全部走 `self.parser.configure_auth(..., source=source)`。清除是登录的逆操作，理应走同一通道。对称性即正确性。
2. **一处修复，覆盖所有来源**。`MultiSourceParser.configure_auth` 对 JM 分支（`:361-367`，清 `_jm_session_auth` + 传播活动实例）、非 JM 分支（`:368-376`，写 `source_auth[current]` + 传播活动实例）都正确归零。用专门清理方法需在 `MultiSourceParser` 新增 API 并为每个来源各自实现，重复造轮子。
3. **复用已验证的并发安全**。JM 分支在 `self._parser_lock` 内做"状态更新 + 实例查询 + 即时注入"（`:358-367` 注释明确说明此锁的存在正是为防 `configure_auth` 与 `_get_parser` 创建临界区的竞态）。新方法要重新实现这套加锁。

**替代方案（已否决）：** 给 `MultiSourceParser` 加 `clear_runtime_auth(source)` 方法。更显式，但要加新 API + 新测试，且与既有 `configure_auth` 高度重复，收益不抵成本。

**需注意的细节：** `MultiSourceParser.configure_auth` 开头有 `if current not in self._factory: return`（`:351-352`）。这意味着若某来源的 parser 尚未懒创建，该方法会 **early-return 而不清 `source_auth`/`_jm_session_auth`**。但对 JM 而言 `_jm_session_auth` 在 `__init__` 即初始化为空（`:152`），若 parser 未创建说明用户从未登录过（值为空），清不清都无所谓；对非 JM，`source_auth` 在 `__init__` 由 `normalize_source_auth` 预置所有来源为空字典（`_normalize_source_auth`，`:286-287`），未懒创建的来源本就无凭据。因此 early-return 不影响正确性——但**实现时必须确认 `source_auth[current]`/`_jm_session_auth` 的预初始化覆盖所有合法来源**，避免某来源未预置导致清不掉残留。这点写入 tasks 的验证项。

### 决策 B：换章清缓存用"输入变化即清空"，而非扩展缓存键

**选择：** 在 `usePreloadManager` 内新增 effect：
```ts
useEffect(() => {
  clearCache()
}, [imageUrls, comicId, scrambleId, imageQuality])
```
（`clearCache` 已是 `useCallback`，依赖 `resetPace`，无闭包陈旧问题。）

**理由：**
1. **改动面最小且闭环在 hook 内部**。无需 `ComicReaderModal` 的换章路径手工接线（`goToChapter`/`handleSelectChapter` 都不用改），调用方零知识。符合 hook 封装意图——缓存生命周期由 hook 自管。
2. **生产端保证正确性比消费端校验更可靠**。消费者（`ReaderPage`/`FlipPage`）盲信缓存是刻意设计（见 `reader-image-cache` 规范的"命中即采用、禁止重取"）。若改消费端做 URL 校验，要改三个消费点且破坏现有缓存契约；改生产端一处即根治。
3. **与现有"模式切换不清、关闭才清"语义不冲突**。模式切换不改变 `imageUrls`/`comicId`/`scrambleId`/`imageQuality` 引用，不触发新 effect；关闭 modal 时这些输入也会变 → 触发清空（与 `:291` 的 `clearCache()` 幂等重复，无害）。

**替代方案（已否决）：** 把缓存键扩展为 `urlHash`/`comicId` 复合键（如 `Map<string, string>`，key=`${comicId}:${idx}:${urlHash}`）。更鲁棒，但改动面大——`markCached`、`buildPreloadQueue`、三个消费点的 `.get(idx)` 全要改，且复合键本身仍依赖 urlHash（而 urlHash 正是要缓存的值，存在"先有鸡还是先有蛋"的查询问题）。ROI 不足。

**React hook 合规细节：**
- 新 effect 只调 `clearCache()`（内部 `imageCacheRef.current.clear()` + setState），在 effect 体内调用是合规的（非 render 期）。`clearCache` 内的 `setCacheVersion(0)` / `setPreloadedRanges([])` / `setPreloadTarget(null)` / `resetPace()` 均为 setState，effect 内调用合法。
- `clearCache` 是 `useCallback([resetPace])`，引用稳定；`imageUrls` 是数组（`fetchChapterUrls` 每次 `setImageUrls(result.imageUrls)` 产生新引用）、`comicId`/`scrambleId`/`imageQuality` 是字符串。换章必然改变这些引用，初始挂载时 effect 也会跑一次 `clearCache()`（对空缓存无害）。

## 风险 / 权衡

- **[风险] `MultiSourceParser.configure_auth` 的 early-return 漏清某来源** → 缓解：实现时确认 `source_auth`/`_jm_session_auth` 对所有 `VALID_SOURCE_KEYS` 预初始化；tasks 中要求测试覆盖"清除后立即查 `get_runtime_auth` 返回匿名"对每个来源。
- **[风险] 新 effect 初次挂载即清空，若调用方在挂载前预填了缓存会丢数据** → 缓解：当前无调用方在 hook 挂载前预填（`imageCacheRef` 初值即空 Map），且 `clearCache` 对空 Map 无副作用。低风险。
- **[风险] effect 依赖数组用数组引用 `imageUrls`，若上游在未换章时也每次构造新数组会误触发清空** → 缓解：`useComicReader.fetchChapterUrls` 仅在换章/首次加载时 `setImageUrls`；若未来上游变更导致频繁重建数组，需在上游稳定引用。本次不在范围。
- **[权衡] 不要求消费者校验 URL** → 接受"缓存正确性由生产端单点保证"的契约。若未来出现第三处写入缓存的路径忘记清空，消费者仍会盲信。已用 `reader-image-cache`（增补换章清需求）+ 新 capability `reader-chapter-cache-invalidation` 守护该不变量。
