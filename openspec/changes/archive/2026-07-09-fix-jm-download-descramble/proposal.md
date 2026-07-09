## 为什么

JM 来源漫画预览时反混淆正常，但下载后产物损坏。根因是下载后处理路径 `ComicDownloader._maybe_postprocess_images` 与预览路径 `PreviewMixin._apply_descramble` 调用同一个 `descramble_image` 函数时传入的参数不一致：下载路径用 `int(comic.id)` 作 `eps_id`、用 3 位填充的文件名 `img_file.stem`（如 `"001"`）作 `page_num`，而反混淆算法将 `eps_id` 与 `page_num` 拼接后做 MD5 来决定分块数，真实页号是 URL 中的 5 位字符串（如 `"00001"`）。`"001"` 与 `"00001"` 产生不同摘要 → 不同的 `num` → 图片按错误布局被"反混淆"而损坏。这是一个影响所有 JM 下载产物的正确性 bug，需立即修复。

## 变更内容

- 修改 `ComicDownloader._maybe_postprocess_images`：停止用 `int(comic.id)` 和 `img_file.stem` 推算反混淆参数，改为复用预览路径已验证正确的逻辑——从每页的原始图片 URL 提取 `eps_id` 与 `page_num`，与预览路径保持一致。
- 将预览路径中 `_resolve_eps_id`（`python/ipc/preview_mixin.py`）的 URL 解析逻辑下沉为可共享的辅助，供下载后处理与预览共用，消除两处独立实现再次漂移的风险。
- 新增/更新测试，断言下载后处理对每页传入与预览一致的 `eps_id` 和 `page_num`（从 URL 提取的 5 位页号），覆盖单章节与多章节场景。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `download-core-integrity`: 新增 JM 下载反混淆后处理的正确性需求——后处理必须从每页原始图片 URL 解析反混淆参数（`eps_id` 与 5 位 `page_num`），与预览路径行为一致，禁止用章节 id 或文件名 stem 作为反混淆输入。

## 影响

- `downloader.py` — `ComicDownloader._maybe_postprocess_images` 重构参数来源，需访问 `comic.image_urls` 以按页号映射回源 URL。
- `python/ipc/preview_mixin.py` — `_resolve_eps_id` 下沉为共享辅助函数（位置见 design）。
- `sources/jm/descrambler.py` — 不改算法，仅作为被复用的正确实现。
- 测试 — `tests/test_downloader.py`（或同类）新增下载后处理参数正确性测试；`tests/test_ipc_preview.py` 既有反混淆断言作为参考基线。
- 无 IPC 契约、配置、持久化或前端变更。
