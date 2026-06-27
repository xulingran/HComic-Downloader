# 设计：图片管道改自定义协议

## 背景

封面与阅读器预览图当前以 base64 data URI 贯穿 Python → Electron 主进程 → 渲染进程。探索发现磁盘缓存层早已持有原始字节文件（文件名 = `sha256(url)` hex），`PreviewCacheDB.get()` 甚至已返回文件路径——只是上层 mixin 又把字节重新 base64 编码。这造成四份冗余拷贝与 JS 堆内的无界驻留。详见 `proposal.md`。

本设计文档记录改造的关键决策、张力与备选方案。

## 决策

### 决策 1：用自定义协议而非 file:// 或 blob URL

**选定**：注册 `app-image://` 协议，Chromium 通过 `protocol.handle` 流式读磁盘文件。

**备选**：
- `file://` 绝对路径——零额外代码，但 CSP 必须放宽整个 `file:` 来源（安全隐患），且 Windows 路径 `file:///C:/...` 处理繁琐。
- blob URL——后端返回路径，渲染进程 `fetch().blob()` + `createObjectURL`——仍以 blob 形态驻留 JS 堆且需手动 `revokeObjectURL`，未彻底消除 JS 堆占用。

**理由**：自定义协议是唯一让图片字节**完全离开 JS 堆**的方案。Chromium 自带图片解码 + 内存 LRU，效率优于 JS 层缓存字符串。前端 `coverCache`/`imageCacheRef` Map 因此失去存在理由，可删除。CSP 只需加一个 scheme（精准可控）。

### 决策 2：协议路径用 url_hash 而非 url 或文件绝对路径

**选定**：协议 URL 形如 `app-image://cover/{url_hash}`，`url_hash = sha256(url).hexdigest()`。

**备选**：把完整 url 编码进协议路径（如 `app-image://cover/{base64(url)}`），由 handler 解码后查缓存。

**理由**：
- `url_hash` 已是磁盘文件名，handler 可直接拼路径读文件，**无需任何查表**。
- 完整 url 太长（可达 2048 字符），编码后协议 URL 超长，且 handler 仍需 sha256 才能定位文件。
- `url_hash` 由后端权威计算并下发给前端，前端只透传不计算——避免 url 规范化差异（尾斜杠、query 排序）导致缓存不一致。
- 单一标识符贯穿三处（磁盘文件名 / 协议路径段 / 前端缓存 key），消除"前端持完整 url + dataUri 两份"。

### 决策 3：保留 fetch_cover/fetch_preview_image 的请求-响应模型，仅改结果契约

**选定**：不改请求流程，仍由前端主动 `fetchCover(url)` → 后端（查缓存/下载/落盘）→ 返回 `{ urlHash }`。前端拿到 `urlHash` 后拼协议 URL 交给 `<img>`。

**备选**：让 `<img>` 直接用 `app-image://cover/{hash_of_frontend_known_url}`，前端自行 sha256 计算 hash。

**理由**：
- 前端自行算 hash 需引入 sha256 库（或 WebCrypto），且必须与后端 `hashlib.sha256(url.encode()).hexdigest()` 逐字节一致——url 编码、规范化差异会导致缓存键不匹配。
- 保留请求-响应让后端保持权威：后端决定何时下载、是否反混淆、是否命中缓存，前端只消费结果。这与现有"懒加载触发 fetch"的心智模型一致，前端改动最小。
- 副产物：前端不再需要持有完整 url 字符串（fetch 后只需 urlHash），进一步降内存。

### 决策 4：jm 预览图改为查缓存

**选定**：让 jm 预览图也走 `preview_cache` 命中检查。存盘的是已反混淆字节（`_write_preview_cache` 在 `_apply_descramble` 之后调用），可安全复用。

**备选**：jm 保持现状（每次重新 fetch + 反混淆），仅非 jm 走新管道。

**理由**：
- preview_cache 的 500MB LRU 当前对 jm 完全失效（`_do_fetch_preview_image` 在 `needs_descramble` 时跳过缓存读取，preview_mixin.py:225-228）——读者翻 jm 漫画第二遍仍重走完整网络 + CPU 反混淆。
- 存盘字节确定已反混淆（代码路径保证），复用安全。
- **风险点**：需确认缓存键稳定性——`preview_cache` 以 url 为键，而 jm 反混淆依赖 `eps_id`（从 url 路径提取，preview_mixin.py:24-38）。同一 url → 同一 eps_id → 同一反混淆输出（反混淆是确定性函数），故缓存键稳定。需在 tasks 中加验证。

### 决策 5：CoverCacheDB 对外契约显式破坏式变更

**选定**：`get(url)` 返回 `url_hash | None`（而非 dataUri），`put(url, raw_bytes)` 收窄签名（而非接收 dataUri）。在 `cover-cache` spec 中以 MODIFIED 标注覆盖既有"对外 API 契约必须与旧实现兼容"需求。

**备选**：新增 `get_path(url)` / `put_bytes(url, raw)` 方法，保留旧 `get`/`put` 做过渡，双写期并存。

**理由**：
- 双写期会让 base64 编码路径继续存在一段时间，违背本变更的核心目标（消除 base64 全栈）。
- `CoverCacheDB` 的调用方有限且全部在 Python 后端内（`cover_mixin`、`config_mixin`、`ipc_server`、`download_mixin`），可一次性迁移完成，无需对外兼容。
- 旧 dataUri 列已在历史迁移中清除（`_finalize_legacy_migration`），无存量 dataUri 数据需要兼容。

### 决策 6：协议 handler 在 Electron 主进程注册一次

**选定**：在 `app.whenReady` 后注册 `app-image://` 协议一次，handler 内部根据路径首段（`cover` / `preview`）定位到对应缓存目录，严格校验 `{url_hash}` 为 `[A-Fa-f0-9]{64}`，并用 `path.resolve` + 前缀检查防路径遍历。

**备选**：两个独立协议 `app-cover://` / `app-preview://`。

**理由**：单协议 + 路径段区分更简洁，校验逻辑统一。两个协议带来重复注册代码与 CSP 双 scheme。

## 不做的事 (Non-goals)

- **不动图片下载主路径**（`image_downloader.py` 流式写临时文件 → CBZ 打包）——那条路径已正确流式，无 base64。
- **不动 JM 下载后反混淆**（`downloader._maybe_postprocess_images`）——那是下载后的批量处理，与预览管道无关（属战役 C 范畴）。
- **不引入虚拟列表**（SearchPage/HistoryPage 长列表）——属战役 B，独立于本变更。
- **不改健康检查逐页 `zf.read`**——属战役 C。
- **不改 keep-alive tab 数量上限**——属战役 B。
- **不前端自算 sha256**——见决策 3。

## 未决问题

### Q1：LRU 淘汰与正在显示的图片的竞态

`<img src="app-image://cover/{hash}">` 显示中，若该文件被 `CoverCacheDB._evict_if_needed` 淘汰删除，`<img>` 会加载失败。

**倾向方案**：协议 handler 在文件不存在时返回特定状态码（如 404），前端 `<img onError>` 触发重新 `fetchCover` 获取新 urlHash（重新下载落盘）。但这依赖前端能从 urlHash 反查回原始 url——而决策 3 说前端不再持 url。

**需在 tasks 落实时解决**：要么前端缓存 `urlHash → url` 映射（轻量，仅显示中的图），要么让淘汰跳过"最近被协议请求过"的文件（handler 维护近期访问集合，与缓存层 LRU 协同）。后者更复杂，倾向前者。

### Q2：协议 handler 是否需要 access time 上报

`CoverCacheDB` 的 LRU 依赖 `last_access` 字段。协议 handler 直接读文件不经过 `get()`，无法更新 `last_access`——会导致"前端频繁显示但缓存层认为陈旧而被淘汰"。

**倾向方案**：协议 handler 读文件后异步通知后端更新 `last_access`（新增轻量 IPC，如 `touch_image_cache(urlHash)`）。或接受这个小偏差（前端显示 ≠ 后端 LRU 准确），因 fetch_cover 本身会更新 last_access。

### Q3：jm 反混淆在协议管道下的位置

若 jm 预览图改查缓存（决策 4），则反混淆仍发生在 mixin 层（fetch 后反混淆再落盘），协议只读已反混淆文件——干净。

但若某 jm 图首次加载，反混淆 + 落盘完成后，前端拿到 urlHash 拼 URL 时文件已就绪——时序上 `fetch_preview_image` 返回即意味着文件可读，无竞态。**需确认**：`_write_preview_cache` 是否在返回 urlHash 前完成（同步写盘）。当前 `_do_fetch_preview_image` 顺序为 fetch → descramble → write_cache → return，同步，应满足。

## 开放设计张力

- **协议 handler 的无状态性 vs LRU 准确性**：handler 最好无状态（易测、并发安全），但 LRU 准确性要求它上报访问。这是干净架构与缓存命中率间的取舍，倾向接受 LRU 轻微不准（fetch 路径已更新 last_access）。
- **前端 urlHash→url 反查表的大小**：若仅缓存"当前显示中"的封面（典型 < 50 个），反查表开销可忽略；但阅读器滚动模式下可能数百页同时挂载，反查表会变大。倾向：阅读器用页索引 → urlHash 直接映射（已有 imageUrls 数组），封面用 urlHash→url 小表。
