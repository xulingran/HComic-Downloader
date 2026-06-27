# electron-ipc-contract 规范（增量）

## 新增需求

### 需求:图片获取通道结果契约必须返回 urlHash 而非 dataUri

`fetch_cover` 与 `fetch_preview_image` 通道的 JSON-RPC 结果**必须**为 `{ urlHash: string }`，其中 `urlHash` 为 `sha256(url).hexdigest()`（64 位十六进制），由 Python 后端权威计算。结果**禁止**包含 `dataUri` 或任何 base64 字符串。渲染进程据 `urlHash` 拼接自定义协议 URL（`app-image://cover/{urlHash}` 或 `app-image://preview/{urlHash}`）交给 `<img>`。

`shared/types.ts` 中的契约定义**必须**同步：
- `PreviewImageResult` 改为 `{ urlHash: string }`。
- `fetch_cover.result` 与 `fetch_preview_image.result` 改为 `{ urlHash: string }`。
- `preload.ts` 的 `fetchCover`/`fetchPreviewImage` 返回类型适配。

`ImageQuality` 参数校验（从 `IMAGE_QUALITIES` 派生）**保持不变**，本需求不影响该校验。

#### 场景:fetch_cover 返回 urlHash

- **当** 渲染进程调用 `fetchCover(url)`，后端命中缓存或下载落盘成功
- **那么** JSON-RPC 结果为 `{ urlHash: "<64 位 hex>" }`
- **且** 渲染进程以 `app-image://cover/{urlHash}` 作为 img src
- **且** **禁止**结果包含 `dataUri` 或任何 base64 字符串

#### 场景:fetch_preview_image 返回 urlHash

- **当** 渲染进程调用 `fetchPreviewImage(url, scrambleId, comicId, imageQuality)`，后端 fetch（jm 场景含反混淆）落盘成功
- **那么** JSON-RPC 结果为 `{ urlHash: "<64 位 hex>" }`
- **且** 渲染进程以 `app-image://preview/{urlHash}` 作为 img src
- **且** jm 场景下落盘的已是反混淆后字节，urlHash 对应文件可直接显示

#### 场景:imageQuality 校验不受影响

- **当** `main.ts` 与 `preload.ts` 校验 `fetchPreviewImage` 的 `imageQuality` 参数
- **那么** 仍使用 `IMAGE_QUALITIES.includes(imageQuality)`，本变更不修改该校验逻辑
