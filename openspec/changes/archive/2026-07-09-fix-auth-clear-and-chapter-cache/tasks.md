## 1. 修复清除认证路径：改走 MultiSourceParser.configure_auth

- [x] 1.1 在 `python/ipc/auth_mixin.py` 的 `handle_clear_source_auth`（约 270-272 行）中，把
  ```python
  parser = self.parser.parsers.get(source)
  if parser is not None and hasattr(parser, "configure_auth"):
      parser.configure_auth(cookie="", user_agent="", bearer_token="")
  ```
  替换为
  ```python
  self.parser.configure_auth(cookie="", user_agent="", bearer_token="", source=source)
  ```
  使清除路径与登录/应用路径（`handle_apply_auth` 第 129 行、`_do_password_login` 第 203 行、`handle_nh_apply_api_key` 第 245 行）走同一通道。
- [x] 1.2 保留紧随其后的 hcomic 下载器同步分支不变：
  ```python
  if source == "hcomic":
      self.downloader.configure_auth(cookie="", user_agent="", bearer_token="")
  ```
  （`downloader` 是独立会话，`MultiSourceParser.configure_auth` 不覆盖它，必须单独清。）
- [x] 1.3 确认 `MultiSourceParser.configure_auth`（`sources/__init__.py:343-376`）的 early-return 守卫（`:351-352` `if current not in self._factory: return`）不影响正确性：`utils.normalize_source_auth` 已把全部 `VALID_SOURCE_KEYS`（hcomic/moeimg/jm/bika/copymanga/nh）预初始化为空字典，`_jm_session_auth` 在 `__init__:152` 预初始化为空。未懒创建的来源运行期状态本就为空，early-return 安全。无需补预初始化。

## 2. 修复换章清缓存：usePreloadManager 新增输入变化清空 effect

- [x] 2.1 在 `src/hooks/usePreloadManager.ts` 中，在 `clearCache` 定义（约 79-85 行）之后、`markCached` 之前，新增一个 effect，监听章节/解码参数变化即清空共享缓存：
  ```ts
  // 换章或解码参数变化时清空共享缓存：imageCacheRef 以页码 index 为键，
  // 其内容绑定具体章节的图片集合。新章节的 imageUrls/comicId/scrambleId/imageQuality
  // 变化时必须清空，禁止跨章复用 urlHash（reader-chapter-cache-invalidation spec）。
  // 该 effect 与 modal 关闭分支的 clearCache() 互不冲突（关闭时输入亦变 → 幂等）。
  useEffect(() => {
    clearCache()
  }, [imageUrls, comicId, scrambleId, imageQuality, clearCache])
  ```
  注意：`clearCache` 是 `useCallback([resetPace])`，引用稳定，可安全入依赖数组。
- [x] 2.2 不改动 `ComicReaderModal.tsx` 的换章路径（`goToChapter` 第 230 行 / `handleSelectChapter` 第 238 行）—— 清缓存逻辑收敛在 hook 内部，调用方零知识。
- [x] 2.3 保留 `ComicReaderModal.tsx:291` modal 关闭分支的 `clearCache()` 不变（与新 effect 幂等共存）。

## 3. 更新与新增回归测试

### 3.1 Python：更新清除路径断言（test_ipc_auth_mixin.py）

- [x] 3.1.1 修改 `tests/test_ipc_auth_mixin.py` 的 `test_clear_source_auth_clears_credentials_and_parser_state`（第 481-499 行）：把第 499 行
  ```python
  nh_parser.configure_auth.assert_called_once_with(cookie="", user_agent="", bearer_token="")
  ```
  改为断言清除走的是 `MultiSourceParser` 通道：
  ```python
  server.parser.configure_auth.assert_called_once_with(cookie="", user_agent="", bearer_token="", source="nh")
  ```
  并移除/调整对单个 `nh_parser.configure_auth` 的断言（不再由 `handle_clear_source_auth` 直接调用；传播由 `MultiSourceParser.configure_auth` 内部完成，在本测试的 MagicMock 链路下 `server.parser` 本身是 mock，不验证内部传播）。
- [x] 3.1.2 新增 `test_clear_source_auth_jm_resets_runtime_state`：构造一个真实（或 spy）的 `MultiSourceParser`，先用 `parser.configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")` 注入运行期 JM 凭据（使 `_jm_session_auth` 非空、`get_runtime_auth("jm")` 返回非空），再调用 `server.handle_clear_source_auth("jm")`，断言：(a) `parser._jm_session_auth` 全空；(b) `parser.get_runtime_auth("jm") == ("", "")`。该测试须能通过回退修复（恢复 per-source `configure_auth` 调用）来证伪。✅ 已证伪：回退后该测试与 3.1.3 均失败。
- [x] 3.1.3 新增 `test_clear_source_auth_non_jm_resets_runtime_source_auth`：对一非 JM 来源（如 hcomic）注入运行期凭据后清除，断言 `parser.source_auth[<source>]` 全空且 `parser.get_runtime_auth(<source>) == ("", "")`。

> 实现注记：3.1.2 / 3.1.3 实际放在 `tests/test_jm_runtime_auth_query.py`（与既有运行期鉴权契约测试同文件），用真实 `MultiSourceParser` + 裸 `AuthMixin` 实例（挂 config/parser/downloader/_config_write_lock）断言运行期状态真实重置。已证伪通过（回退 fix 后两测试失败）。

### 3.2 前端：新增换章清缓存测试（usePreloadManager.test.tsx）

- [x] 3.2.1 在 `tests/unit/hooks/usePreloadManager.test.tsx` 新增 `describe('换章清缓存 (reader-chapter-cache-invalidation 规范)')`，添加用例：先 `markCached(0, 'hash-a')` 写入缓存并确认 `imageCacheRef.current.get(0) === 'hash-a'`；随后用 `rerender` 改变 `imageUrls` 引用（新数组），断言 `imageCacheRef.current.get(0) === undefined`（缓存已清空）、`preloadedRanges === []`、`cacheVersion` 被重置（触发了 `clearCache`）。该测试须能通过删除新增 effect 来证伪。✅ 已证伪：删除 effect 后该用例与 3.2.2 失败。
- [x] 3.2.2 在同一 describe 添加：改变 `comicId`（`imageUrls` 不变）也**必须**触发清空（守护"仅解码参数变化也清"场景）。✅ 已证伪通过。
- [x] 3.2.3 添加对照用例：`imageUrls`/`comicId`/`scrambleId`/`imageQuality` 引用均不变时，`markCached` 写入的项在 `rerender` 后**必须**仍命中（守护"模式切换不清"不变量，避免新 effect 误清）。✅ 对照用例在删除 effect 时仍通过（确认是真正的回归守护，而非恒真）。

## 4. 验证（提交前全绿）

- [x] 4.1 `pytest tests/test_ipc_auth_mixin.py tests/test_multi_source_parser.py -v` —— 新增/修改的认证测试通过。✅ 60 passed。
- [x] 4.2 `pytest` —— 全量 Python 测试通过（确认未破坏既有认证/会话/IPC 测试）。✅ 1162 passed, 2 smoke deselected。
- [x] 4.3 `npm test -- usePreloadManager` —— 前端 hook 测试通过。✅ 14 passed。
- [x] 4.4 `npx tsc --noEmit` —— 无类型错误。✅ exit 0。
- [x] 4.5 `npm test` —— 全量前端测试通过。✅ 1552 passed。
- [x] 4.6 `npm run lint:py` + `npm run format:py` —— Python ruff/black 通过。✅ All checks passed / 133 files unchanged。
- [x] 4.7 `npm run lint` + `npm run lint:test-quality` —— ESLint（含 test-quality 自定义规则）通过。✅ 0 errors（2 预存 warning 在未改动的 NhEntryGrid/PageFlipView，与本次无关）。新增测试均断言真实状态（`_jm_session_auth`/`source_auth`/`get_runtime_auth`/`imageCacheRef.current.get`），test-quality 闸门通过。新增 effect 按 `react-hooks/set-state-in-effect` 项目约定（与 StorageStatsPanel/ComicInfoDrawer 同类）显式豁免。
- [x] 4.8 `openspec-cn validate fix-auth-clear-and-chapter-cache --strict` —— 规范校验通过。✅
