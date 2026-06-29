## 1. 测试先行（TDD）

- [x] 1.1 在 `tests/unit/hooks/usePaginatedPreloader.test.tsx` 新增用例：contextKey 变化时，传给 `loadPage` 的第三参数（AbortSignal）`aborted` 变为 true。使用 `createDeferred()` 控制 in-flight 请求，rerender 切换 contextKey 后断言旧请求拿到的 signal 已 aborted。
- [x] 1.2 新增用例：组件 unmount 后，仍挂起的 in-flight 请求拿到的 signal 已 aborted（`aborted === true`）。
- [x] 1.3 新增用例：未中断的请求拿到的 signal `aborted === false`，回调正常执行——锁定「正常路径不误伤」。
- [x] 1.4 现有「does not commit completed preload results after context changes」用例仍需通过（commit-gate 作为安全网保留），运行确认不回归。

## 2. 改造 `usePaginatedPreloader`

- [x] 2.1 在 `src/hooks/usePaginatedPreloader.ts` 增加 `abortControllerRef = useRef<AbortController | null>(null)`，并在 contextKey effect 中：`abortControllerRef.current?.abort()` → 新建 controller 存入 ref（与现有 `generationRef += 1` / 清空 in-flight / pending 同一 effect 内）。
- [x] 2.2 在 hook 卸载 cleanup（新增的 unmount effect 或 contextKey effect 的 return）中 `abort()`，满足「组件卸载必须中断」需求。
- [x] 2.3 修改 `loadPage` 类型签名：从 `(page, reason) => Promise<void>` 扩展为 `(page, reason, signal: AbortSignal) => Promise<void>`；`PreloadState.loadPage` 与 `UsePaginatedPreloaderArgs.loadPage` 类型同步更新。
- [x] 2.4 修改 `drain` 内的调用点：`await state.loadPage(page, 'preload', abortControllerRef.current!.signal)`——把当前 contextKey 的 signal 传入。
- [x] 2.5 保留现有 `generationRef` / `state.cancelled` / commit-gate 逻辑不动（作为安全网，design 决策 3）。

## 3. 适配三个调用页的 `loadPage`

- [x] 3.1 `src/pages/SearchPage.tsx`：`preloadSearchPage` 签名加 `signal` 参数，在 `await search(...)` 之后、`preloadedPagesRef.current.set(...)` 之前插入 `if (signal.aborted) return`。
- [x] 3.2 `src/pages/FavouritesPage.tsx`：`preloadFavouritesPage` 同样加 `signal`，在 `await getFavourites(...)` + `checkDownloadedStatus(...)` 之后、`preloadedPagesRef.current.set(...)` 之前插入中断检查。
- [x] 3.3 `src/pages/HistoryPage.tsx`：`preloadHistoryPage`（同模式）加 `signal` + 中断检查。先 Read 确认其当前实现结构与前两者一致后再改。

## 4. 页面级回归测试

- [x] 4.1 `tests/unit/pages/SearchPage.test.tsx`：补一个用例——source 从 A 切到 B 后，A 的迟到预加载请求不写入 search 缓存（断言 `preloadedPagesRef` / store 不含 A 的页）。
- [x] 4.2 `tests/unit/pages/FavouritesPage.test.tsx` 或 `FavouritesPage.sourcePicker.test.tsx`：补一个用例——source 切换后旧来源迟到预加载请求不写入 favourites 缓存。

## 5. 全量验证（提交前闸门）

- [x] 5.1 `npm test`（前端单测，含新增用例全部通过）— 1224 passed
- [x] 5.2 `npx tsc --noEmit`（类型检查，含 `loadPage` 新签名）— exit 0
- [x] 5.3 `npm run lint`（ESLint，确认无新告警）— exit 0
- [x] 5.4 `npm run lint:test-quality`（测试质量闸门——新测试必须有真实行为断言，非裸 mock 调用断言）— 通过
- [x] 5.5 `pytest`（Python 测试不受影响，确认未回归）— 971 passed
