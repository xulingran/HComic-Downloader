## 1. 后端：暴露缓存目录路径

- [x] 1.1 在 `python/ipc/cover_cache.py` 的 `CoverCacheDB` 上新增只读属性（如 `db_dir` / 方法）返回封面缓存数据库文件所在目录的 `os.path.abspath` 规范化路径
- [x] 1.2 在 `python/ipc/preview_cache.py` 上确认同样可取到 `dirname(self._db_path)`（无需新增对外属性，统一从 cover 实例取根目录即可）
- [x] 1.3 在 `python/ipc_server.py` 注册新请求 `get_cache_dir`，映射到 `handle_get_cache_dir`；实现从 `self._cover_cache` 取真实目录并返回 `{ "dir": <abs path> }`
- [x] 1.4 `handle_get_cache_dir` 返回前对路径做 `os.path.abspath` 规范化，确保是绝对路径

## 2. IPC 契约：类型与通道

- [x] 2.1 在 `shared/types.ts` 的 `ipc_contract`（方法表）中新增 `get_cache_dir`：`params: Record<string, never>`，`result: { dir: string }`
- [x] 2.2 在 `shared/types.ts` 的 `IPC_CHANNELS` 中新增 `GET_CACHE_DIR: 'python:get-cache-dir'` 与 `OPEN_CACHE_DIR: 'python:open-cache-dir'`
- [x] 2.3 在 `shared/types.ts` 的 preload API 接口（`HcomicApi`/window 接口）中新增 `getCacheDir(): Promise<{ dir: string }>` 与 `openCacheDir(dirPath: string): Promise<{ success: boolean }>`

## 3. Electron 主进程与 Preload

- [x] 3.1 在 `electron/main.ts` `registerCacheHandlers` 中新增 `GET_CACHE_DIR` handler，透传 `bridge.call('get_cache_dir')`
- [x] 3.2 在 `electron/main.ts` 新增 `OPEN_CACHE_DIR` handler：复用 `OPEN_DOWNLOAD_DIR` 的安全校验（绝对路径 / 无 `..` 遍历 / 无控制字符 / `isDirectory` / ENOENT 与其他 stat 失败分流），通过后调用 `shell.openPath`，失败抛错；可抽出公共校验辅助函数供二者复用
- [x] 3.3 在 `electron/preload.ts` 新增 `getCacheDir: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CACHE_DIR)`
- [x] 3.4 在 `electron/preload.ts` 新增 `openCacheDir: (dirPath) => { validateDownloadDir(dirPath); return ipcRenderer.invoke(IPC_CHANNELS.OPEN_CACHE_DIR, dirPath) }`

## 4. 前端：缓存管理区域 UI

- [x] 4.1 在 `src/components/settings/CacheSettings.tsx` 增加 `getCacheDir` 调用与本地 state（路径、加载/失败状态），mount 时拉取；失败时降级为「无法获取缓存目录」并禁用「打开目录」按钮
- [x] 4.2 在缓存统计区域上方新增「缓存目录」行：标签 + 只读展示绝对路径（等宽、`break-all`）+ 「打开目录」按钮
- [x] 4.3 「打开目录」按钮点击调用 `window.hcomic.openCacheDir(dir)`，成功无操作；失败用 `useToastStore` 提示「无法打开目录」
- [x] 4.4 路径旁附简短说明文案「该目录包含封面与预览缓存数据」

## 5. 测试

- [x] 5.1 后端单测：注入自定义 `db_path` 构造 `CoverCacheDB`/`PreviewCacheDB`，断言 `handle_get_cache_dir` 返回与之一致的规范化绝对路径（覆盖决策 2 的可测性）
- [x] 5.2 后端单测：默认构造下 `handle_get_cache_dir` 返回的路径以 `.hcomic_downloader` 结尾且为绝对路径
- [x] 5.3 IPC 方法对齐测试（`tests/unit/main/ipc-arity-parity.test.ts`）补充 `get_cache_dir` 与 `open_cache_dir` 条目
- [x] 5.4 前端测试：mock `getCacheDir` 返回路径，断言「缓存目录」行展示该路径且「打开目录」按钮可点击
- [x] 5.5 前端测试：mock `getCacheDir` reject，断言展示「无法获取缓存目录」且按钮禁用
- [x] 5.6 前端测试：mock `openCacheDir` reject，断言点击后触发 toast 错误提示
- [x] 5.7 更新 `tests/__mocks__/ipc.ts` 与 `tests/__mocks__/electron.ts`，补齐 `getCacheDir` / `openCacheDir` mock，避免现有测试因缺 mock 报错

## 6. 验证（提交前）

- [x] 6.1 `pytest` 全部通过
- [x] 6.2 `npx tsc --noEmit` 通过
- [x] 6.3 `npm test` 通过
- [x] 6.4 `npm run lint:py` 与 `black --check .` 通过
- [x] 6.5 `npm run lint`（ESLint）通过
- [ ] 6.6 手动验证：运行应用，进入设置 → 缓存管理，确认显示的路径存在且「打开目录」能正确弹出系统文件管理器
