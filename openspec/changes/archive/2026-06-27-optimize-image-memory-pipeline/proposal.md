## 为什么

封面与阅读器预览图当前以 **base64 data URI 字符串**贯穿全栈，造成多份冗余内存拷贝：

```
磁盘原始字节(已知文件名=url_hash)
   → cover_cache.get() 重新读文件+base64 编码            ← 拷贝①(+33% 膨胀)
   → json.dumps() 单行写 stdout                          ← 临时整行字符串
   → python-bridge.ts buffer += chunk + split('\n')      ← 拷贝②(瞬时 ~2x)
   → JSON.parse(line)                                    ← 拷贝③(对象图)
   → IPC structured-clone 到渲染进程                      ← 拷贝④
   → coverCache / imageCacheRef Map 永久驻留 JS 堆        ← 不可回收
```

讽刺的是，**磁盘缓存层早已把原始字节以 `{files_dir}/{url_hash}` 文件形式落盘**，文件名就是 `url_hash`（`CoverCacheDB`/`PreviewCacheDB`）。`PreviewCacheDB.get()` 甚至已经返回**文件路径**而非 dataUri——只是上层 `preview_mixin._read_preview_cache()` 又 `open().read()` + base64 编码回 dataUri（`preview_mixin.py:161-168`），多此一举。

后果是双重的：
1. **瞬时峰值**：单张 10MB 封面（`MAX_COVER_SIZE`）→ 13MB base64 → bridge buffer 峰值 ~26MB（`split` 瞬时）→ parse 13MB → clone 13MB。`MAX_BUFFER_SIZE = 20MB` 安全阀的存在本身就证明这条路径常态化承压。
2. **稳态驻留**：前端 `coverCache`（`useCoverImage.ts:3`，模块级、进程生命周期、无界）与 `imageCacheRef`（`usePreloadManager.ts:69`，阅读期间无淘汰）持有每张图的 base64 字符串。浏览越多越涨，长漫画阅读全程累积。

现在做，是因为这是**单一最高杠杆点**：一次架构改造同时消除四份冗余拷贝、降低 IPC 缓冲压力、并让前端的两个无界 Map 失去存在理由。

## 变更内容

引入自定义协议 `app-image://`，让 Chromium 直接流式读取磁盘缓存文件，图片字节**彻底离开 JS 堆**。Chromium 自带图片解码与内存 LRU，其效率远优于在 JS 层持有 base64 字符串。

```
磁盘 {files_dir}/{url_hash}  ←  原始字节(唯一来源)
        │
        ▼
app-image://cover/<url_hash>      (或 /preview/<url_hash>)
        │
        ▼
Electron protocol handler 流式读取文件 → Chromium
        │
        ▼
<img src="app-image://...">  ←  Chromium 管理解码缓存(自带 LRU + 内存上限)
                                  JS 堆零字节驻留
```

具体改造分四层：

1. **Python 缓存层**：`CoverCacheDB.get(url)` 返回值从 `dataUri` 改为 `url_hash`（或文件绝对路径）。`put` 签名收窄为接收原始字节（消除"先拼 dataUri 再 decode"的绕路，与 `PreviewCacheDB.put(url, raw_bytes)` 对齐）。`cover-cache` spec 的"对外 API 契约必须与旧实现兼容"需求将被本变更显式修改。

2. **Python IPC mixin 层**：`fetch_cover` / `fetch_preview_image` 的 JSON-RPC 结果从 `{ dataUri: string }` 改为 `{ urlHash: string }`（前端据 `url_hash` 拼协议 URL）。同时让 jm 预览图**查缓存**——存盘的是已反混淆字节，安全可复用，使 preview_cache 的 500MB LRU 对 jm 真正生效。

3. **Electron 主进程**：注册 `app-image://` 协议（`protocol.handle`，流式读文件），严格校验 `url_hash`（`[A-Fa-f0-9]{64}` SHA-256 hex）并将路径约束在缓存目录内（路径遍历防护）。CSP 的 `img-src` 加上 `app-image:`。

4. **渲染进程**：`<img src={dataUri}>` 改为 `<img src={"app-image://cover/" + urlHash}>`。删除 `coverCache` Map 与 `imageCacheRef` 的 base64 缓存（浏览器接管）。`fetchCover`/`fetchPreviewImage` 返回 `{ urlHash }`，组件直接拼协议 URL。

**关键设计张力**：`url_hash` 是 `sha256(url)` 的 hex——它既是磁盘文件名，又是协议路径段，还是前端缓存 key。三者统一为单一标识符，消除了"前端需持有完整 URL 字符串 + dataUri 两份"的现状。由于 `url_hash` 由后端权威计算，前端无需也不应自行计算，避免 url 规范化差异导致的缓存不一致。

## 功能 (Capabilities)

### 新增功能
- `image-protocol-delivery`: 自定义协议 `app-image://` 的注册、文件流式读取、`url_hash` 校验与路径遍历防护。封面与阅读器预览图通过该协议交付，字节不经过 JS 堆。

### 修改功能
- `cover-cache`: `CoverCacheDB` 对外 API 契约从"返回 dataUri、put 接收 dataUri"改为"返回 url_hash、put 接收原始字节"，与 `PreviewCacheDB` 对齐。显式覆盖既有"对外 API 契约必须与旧实现兼容"需求。
- `electron-ipc-contract`: `fetch_cover` 与 `fetch_preview_image` 的结果契约从 `{ dataUri: string }` 改为 `{ urlHash: string }`。`ImageQuality` 校验需求保留。
- `preview-error-recovery`: 阅读器图片加载失败恢复机制需适配新的协议 URL 形态（重试逻辑改为重新触发 fetch 获取新 urlHash，而非依赖 dataUri 刷新）。
- `cache-directory-access`: 协议 handler 必须将可访问路径约束在已授权的 cover/preview 缓存目录内，复用该能力的路径校验语义。

## 影响

**受影响代码**：
- `python/ipc/cover_cache.py` — `get` 返回 url_hash，`put` 收窄签名，`_migrate_legacy`/`_write_bytes_for` 简化（不再产出 dataUri）
- `python/ipc/preview_cache.py` — `get` 已返回文件路径，无需大改；确认返回 `url_hash` 而非绝对路径（前端拼协议）
- `python/ipc/cover_mixin.py` — `_async_fetch_cover` 返回 `{ urlHash }`；`_do_fetch_cover` 返回 url_hash 而非 dataUri
- `python/ipc/preview_mixin.py` — `_async_fetch_preview_image` 返回 `{ urlHash }`；`_read_preview_cache` 删除 base64 编码绕路；jm 预览图增加缓存命中检查
- `shared/types.ts` — `PreviewImageResult` 与 `fetch_cover.result` 契约从 `dataUri` 改 `urlHash`
- `electron/preload.ts` — `fetchCover`/`fetchPreviewImage` 返回类型适配
- `electron/main.ts` — 注册 `app-image://` 协议 handler（流式 + 校验），CSP `img-src` 加 `app-image:`
- `electron/validators.ts` — 新增 `url_hash` 校验（如需在主进程二次校验协议请求）
- `src/hooks/useCoverImage.ts` — 删除 `coverCache` Map，`fetchCover` 返回 `{ urlHash }`，组件拼协议 URL
- `src/hooks/usePreloadManager.ts` — `imageCacheRef` 改为缓存 `urlHash`（或删除，让 `<img>` 直接按页索引请求）
- `src/components/ReaderPage.tsx` / `PageFlipView.tsx` — `<img src>` 改协议 URL；加载失败重试逻辑适配
- `src/components/common/ComicCard`（及任何渲染封面的组件）— `<img src>` 改协议 URL
- 测试：`tests/` 下 cover_cache/preview_cache/cover_mixin/preview_mixin 相关、`tests/unit/useCoverImage`/`ReaderPage` 相关、新增协议 handler 单测

**受影响依赖**：无新增外部依赖。仅用 Electron 原生 `protocol.handle`（Electron 25+，项目已远超）与浏览器原生 `<img>` 解码。

**风险面**：
- **契约变更面广**：`dataUri → urlHash` 是跨语言契约修改，需同步 Python mixin / shared types / preload / 所有渲染组件，任一遗漏会导致图片加载失败。需配回归用例。
- **协议 handler 安全性**：`url_hash` 校验不严会暴露任意文件（路径遍历）。必须严格 `[A-Fa-f0-9]{64}` + 路径约束在缓存目录。
- **jm 反混淆缓存正确性**：让 jm 查缓存需确认存盘字节确实已反混淆（当前路径 `write_cache` 在 `apply_descramble` 之后调用，应已满足，但需验证 eps_id 维度的缓存键稳定性——同一 url 的反混淆结果是否确定性）。
- **失败重试语义**：协议 URL 失败时（文件被 LRU 淘汰）需触发后端重新 fetch，不同于"刷新 dataUri"。重试链路需重新设计。
- **既有 `cover-cache` 契约破坏**：显式修改既有 spec 需在 proposal/spec delta 中标注，避免审计困惑。
