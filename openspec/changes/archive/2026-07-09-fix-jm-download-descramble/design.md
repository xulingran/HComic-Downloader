## 上下文

JM 漫画图片在服务器端被混淆，客户端下载/预览后需调用 `sources/jm.descrambler.descramble_image` 还原。该函数的两个关键输入由 MD5 算法决定分块数：

- `eps_id`：章节 photo id，正确来源是图片 URL 路径 `/media/photos/{eps_id}/`（多章节专辑每章不同）。
- `page_num`：5 位字符串（如 `"00001"`），来自 URL 末段 `{i:05d}.{ext}`。

预览路径 `PreviewMixin._apply_descramble`（`python/ipc/preview_mixin.py:165`）做法正确：调用 `_resolve_eps_id(url, comic_id)` 取 `eps_id`，并传 `image_url=url` 让 descrambler 内部用 `_extract_page_num` 提取 5 位页号。

下载路径 `ComicDownloader._maybe_postprocess_images`（`downloader.py:183-206`）做法错误：
- `eps_id = int(comic.id)` —— 用章节 id 而非从 URL 提取的 photo id。
- `page_num = img_file.stem` —— 落盘文件名是 3 位填充（`PAGE_FILENAME_WIDTH=3`，如 `"001"`），与算法期望的 5 位 `"00001"` 不一致。

`"001"` 与 `"00001"` 拼入 `f"{eps_id}{page_num}"` 后产生不同 MD5 摘要 → 不同 `num` → 错误分块布局 → 产物损坏。即便 `eps_id` 碰巧正确，页号位数差异 alone 即可毁掉结果。这解释了"预览正常、下载损坏"的现象：同一函数，参数不同。

下载后处理在 `downloader.py:418` 成功分支调用，此时 `comic`（`ComicInfo`，含 `image_urls` 列表）与 `temp_dir` 均在作用域内。落盘文件名为 `PAGE_FILENAME_FORMAT.format(page=N, ext=DEFAULT_IMAGE_EXT)`（`N` 为 1-based 页号），故 `int(img_file.stem) - 1` 可索引回 `comic.image_urls` 取得该页源 URL。

## 目标 / 非目标

**目标：**
- 下载后处理对每页传入与预览路径完全一致的反混淆参数（从源 URL 提取的 `eps_id` 与 5 位 `page_num`）。
- 消除下载与预览两处参数解析逻辑的重复，防止再次漂移。

**非目标：**
- 不修改 `descramble_image` 算法本身（预览已证明其正确）。
- 不改变下载文件命名格式（仍 3 位填充）——文件名只用于索引回 URL，不参与反混淆计算。
- 不变更 IPC 契约、配置、持久化或前端。
- 不重构下载循环结构或并发模型。

## 决策

### 决策 1：后处理从 `comic.image_urls` 按页号映射回源 URL

后处理遍历 `temp_dir` 文件时，用 `int(img_file.stem) - 1` 索引 `comic.image_urls` 取得该页原始 URL，再以预览路径相同的调用形态 `descramble_image(raw, eps_id, image_url=url)` 执行反混淆，`eps_id` 由共享的 `_resolve_eps_id(url, comic.id)` 解析。

**理由**：`image_urls` 已存在于 `ComicInfo` 且按页号有序，文件名 `001..N` 与页号一一对应，无需新增状态传递或改动下载循环。这是改动面最小的正确修复。

**替代方案 A：在下载循环中保留 URL→文件映射字典传入后处理。** 更显式但需改 `_submit_download_batch`/`_collect_and_advance` 签名与调用链，改动面大且无额外正确性收益。否决。

**替代方案 B：改文件名为 5 位填充以让 `img_file.stem` 直接等于真实页号。** 会破坏现有断点续传对文件名的依赖、影响 CBZ 内排序与历史兼容，风险远大于收益。否决。

### 决策 2：将 `_resolve_eps_id` 下沉为共享辅助

把 `python/ipc/preview_mixin.py` 中的 `_resolve_eps_id` 移至 `sources/jm/descrambler.py`（与 `_extract_eps_id` 同模块，语义内聚），预览与下载均从该处导入。

**理由**：两处调用同一解析逻辑是"同源不漂移"的保障；`descrambler.py` 已定义 `_extract_eps_id`，`_resolve_eps_id` 只是其带 `comic_id` 回退的封装，放此处最自然。

**替代方案：在 `downloader.py` 内联一份相同逻辑。** 复制粘贴，正是当前 bug 的成因。否决。

### 决策 3：保留 `comic.id` 作为 `_resolve_eps_id` 的回退

当 URL 路径无法提取 `eps_id`（理论上不应发生，因 JM 图片 URL 恒含 `/media/photos/{id}/`）时，回退到 `int(comic.id)`，与预览路径的回退行为一致。这保留了旧路径的"最后兜底"语义，不引入回归。

## 风险 / 权衡

- **`image_urls` 长度与落盘文件数不匹配** → 后处理按 `int(stem)-1` 索引前做边界校验，越界则跳过该文件并告警（与现有"逐文件 try/except 告警"的容错策略一致），不中断整体后处理。
- **`_resolve_eps_id` 下沉改导入路径** → 预览路径需同步改 import；属内部重构，无外部契约影响。回归测试覆盖预览与下载两条路径。
- **非图片/已损坏文件** → 现有 `descramble_image` 对无法解码的图片会抛异常，已被逐文件 `try/except` 捕获告警，行为不变。
