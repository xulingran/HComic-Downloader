# 任务：图片管道改自定义协议

按层分解，每层产出可独立验证。建议自底向上（Python 缓存层 → mixin → 契约 → Electron 协议 → 渲染进程），因为上层依赖下层的契约。

## 1. Python 缓存层契约改造

- [x] 1.1 `CoverCacheDB.get(url)` 返回值从 dataUri 改为 `url_hash | None`；删除内部的 `read + base64 编码 + detect_image_type` 逻辑（get 不再需要读字节，仅返回文件名）
- [x] 1.2 `CoverCacheDB.put(url, raw_bytes: bytes)` 收窄签名（替代 `put(url, data_uri: str)`）；内部直接写 raw_bytes，删除 `_decode_data_uri` 调用
- [x] 1.3 保留 `_decode_data_uri` / `_write_bytes_for` 供 legacy migration 使用（get/put 不再调用它们）；移除未使用的 `detect_image_type` import
- [x] 1.4 `get` 命中时的脏数据清理逻辑调整：`get` 仅做 `os.path.exists` 存在性校验，深度脏数据检测移至 `put` 落盘前（fetch 路径已用 detect_image_type 校验）
- [x] 1.5 `PreviewCacheDB.get()` 已返回文件路径，现调整为返回 `url_hash`（相对文件名）而非绝对路径，以便前端拼协议 URL
- [x] 1.6 更新 `cover_cache.py` / `preview_cache.py` 的单元测试：`get` 返回 url_hash、`put` 接收 raw_bytes

## 2. Python IPC mixin 层改造

- [x] 2.1 `cover_mixin._do_fetch_cover` 返回 `url_hash` 而非 dataUri：fetch raw bytes → `cache.put(url, raw_bytes)` → 直接 `hashlib.sha256(url).hexdigest()` 计算 url_hash 返回（避免 put→get 竞态）
- [x] 2.2 `cover_mixin._async_fetch_cover` 的 JSON-RPC result 从 `{ dataUri }` 改为 `{ urlHash }`
- [x] 2.3 `preview_mixin._read_preview_cache` 删除 base64 编码绕路，直接返回 `url_hash`（从 `cache.get(url)` 拿，不再读字节）
- [x] 2.4 `preview_mixin._fetch_image_as_data_uri` 重构为 `_fetch_image_bytes`（返回 raw bytes）+ `_do_fetch_preview_image` 编排（fetch → 反混淆 → `_write_preview_cache` 返回 url_hash）
- [x] 2.5 `preview_mixin._apply_descramble` 改为接收/返回 raw bytes 而非 dataUri（与字节级 API 对齐）
- [x] 2.6 `preview_mixin._write_preview_cache` 简化：直接 `cache.put(url, raw_bytes)` 并返回 url_hash（计算而非重读），删除 base64 decode 绕路
- [x] 2.7 **jm 预览图查缓存**：`_do_fetch_preview_image` 移除 `if not needs_descramble:` 对缓存读取的门控，让 jm 也先查缓存（存盘字节已反混淆，安全复用）
- [x] 2.8 `preview_mixin._async_fetch_preview_image` 与同步 `handle_fetch_preview_image`（search_mixin.py）的 result 从 `{ dataUri }` 改为 `{ urlHash }`
- [x] 2.9 验证 jm 反混淆缓存键稳定性：新增 `test_descramble_is_deterministic_for_same_url`（相同输入两次反混淆字节一致）——920 测试全绿
- [x] 2.10 更新 cover_mixin / preview_mixin 的单元测试（test_ipc_preview.py 适配 urlHash 契约 + `_fetch_image_bytes`）

## 3. 共享契约层

- [x] 3.1 `shared/types.ts`：`PreviewImageResult` 从 `{ dataUri: string }` 改为 `{ urlHash: string }`
- [x] 3.2 `shared/types.ts`：`fetch_cover` 通道的 `result` 从 `{ dataUri: string }` 改为 `{ urlHash: string }`；`HcomicApi.fetchCover` 返回类型同步
- [x] 3.3 `shared/types.ts`：`fetch_preview_image` 通道的 `result` 引用 `PreviewImageResult`，已自动同步为 `{ urlHash: string }`
- [x] 3.4 `electron/preload.ts`：`fetchCover`/`fetchPreviewImage` 返回类型由 `HcomicApi` 接口约束，已自动适配（preload 仅透传 invoke）
- [x] 3.5 `npx tsc --noEmit` 通过（Layer 5 修复 4 个渲染进程消费者后 tsc 全绿）

## 4. Electron 协议层

- [x] 4.1 在 `electron/main.ts` 的 `app.whenReady` 后、`createWindow()` 之前注册 `app-image://` 协议（`protocol.handle`）
- [x] 4.2 handler 解析路径：`url.hostname` 为 `cover` / `preview` → 定位到对应缓存 `files_dir`；`url.pathname` 为 `url_hash`
- [x] 4.3 **安全校验**：`url_hash` 严格匹配 `^[A-Fa-f0-9]{64}$`；`path.resolve` + 前缀检查（`normalizedBase = path.resolve(baseDir) + path.sep`）防 `..` 遍历
- [x] 4.4 handler 流式返回文件：文件不存在返回 HTTP 404，存在则 `net.fetch('file://...')` 流式返回
- [x] 4.5 CSP `img-src` 加上 `app-image:`
- [x] 4.6 缓存目录路径来源：新增 `get_image_cache_dirs` IPC（Python 返回两个缓存实例的真实 `files_dir`），handler 惰性拉取并缓存到模块级 `imageCacheDirs` 变量
- [x] 4.7 新增协议 handler 单元测试：提取纯函数 `resolveImageCacheFile` 到 `electron/image-protocol.ts`，`tests/unit/main/image-protocol.test.ts` 覆盖合法 hash 返回路径、非法 kind/hash 400、文件缺失 404、cover/preview 目录独立（9 测试全绿）

## 5. 渲染进程改造

- [x] 5.1 `src/hooks/useCoverImage.ts`：删除模块级 `coverCache` Map（改为轻量 `coverOutcome` 存 urlHash/null 结果标记）；`fetchCover` 返回 `{ urlHash }`；新增 `src/lib/image-url.ts` 的 `buildImageUrl` 拼 `app-image://cover/{urlHash}`
- [x] 5.2 `src/hooks/useCoverImage.ts`：保留 IntersectionObserver 懒加载逻辑（仅 src 形态从 dataUri 变协议 URL）
- [x] 5.3 `src/hooks/usePreloadManager.ts`：`imageCacheRef` 缓存 `urlHash`（Map<number, string> 页索引→urlHash）；预加载逻辑 fetch 拿 urlHash 写入缓存
- [x] 5.4 `src/components/ReaderPage.tsx`：`<img src={buildImageUrl('preview', urlHash)}>`；`fetchPreviewImage` 返回 `{ urlHash }` 适配；prop `cachedDataUri`→`cachedUrlHash`；保留 onError 重试
- [x] 5.5 `src/components/PageFlipView.tsx`：FlipPage 同上适配协议 URL；prop `cachedDataUri`→`cachedUrlHash`
- [x] 5.6 封面渲染组件（ComicCard 等）：通过 `useCoverImage` 的 `coverSrc`（协议 URL）渲染，组件本身无需改；ComicReaderModal 调用方 prop 名同步
- [x] 5.7 **LRU 淘汰竞态处理**：协议 handler 文件缺失返回 404 → `<img onError>` 设 error 态 → 用户/全部重试重新 fetch 获取新 urlHash（链路就绪）；自动 urlHash→url 反查表为可选增强，当前手动重试链路已满足基本语义
- [x] 5.8 阅读器失败重试语义适配：重试改为重新 `fetchPreviewImage` 获取新 urlHash 拼 URL，成功判断从"dataUri 存在"改"urlHash 就绪"
- [x] 5.9 更新前端单测：ComicCard/ComicReaderModal/PageFlipView/usePreloadManager/PreviewRetryToast/Duplicate* 等 mock 与断言适配 urlHash + 协议 URL（91 测试全绿）

## 6. 规范与回归

- [x] 6.1 编写 `specs/image-protocol-delivery/spec.md`（新增能力）：协议注册、url_hash 校验、路径遍历防护、流式读取、文件缺失 404
- [x] 6.2 编写 `specs/cover-cache/spec.md` delta（MODIFIED）：覆盖"对外 API 契约必须与旧实现兼容"需求，改为返回 url_hash、put 接收 raw_bytes
- [x] 6.3 编写 `specs/electron-ipc-contract/spec.md` delta（新增需求）：fetch_cover / fetch_preview_image 结果契约从 dataUri 改 urlHash
- [x] 6.4 编写 `specs/preview-error-recovery/spec.md` delta（MODIFIED）：重试语义适配协议 URL
- [x] 6.5 编写 `specs/cache-directory-access/spec.md` delta（新增需求）：协议 handler 路径约束复用该能力
- [ ] 6.6 端到端回归（手动，需 `npm run dev` 实际运行）：封面加载（搜索/历史/收藏/抽屉）、阅读器翻页（含 jm 反混淆）、失败重试、缓存淘汰后重显
- [ ] 6.7 内存验证（手动）：对比改造前后渲染进程 JS 堆（浏览 200 封面 + 翻 100 页），确认 base64 字符串不再驻留

## 验证流程

每层完成后运行对应验证：
- Python 层（1-2）：`pytest tests/test_cover_cache*.py tests/test_preview_cache*.py tests/test_cover_mixin*.py tests/test_preview_mixin*.py` + `npm run lint:py` + `black --check .`
- 契约层（3）：`npx tsc --noEmit`
- Electron 层（4）：协议 handler 单测 + `npm run lint`
- 渲染层（5）：`npm test` + `npm run lint`
- 全量（6）：`pytest && npx tsc --noEmit && npm test && npm run lint:py && black --check . && npm run lint`
