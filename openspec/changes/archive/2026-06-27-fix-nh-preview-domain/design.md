## 上下文

nh 来源（nhentai）已实现解析器（`sources/nh/`），但预览图片功能不可用。原因在于两处域名白名单未收录 nh 的图片服务器：

1. **Python 后端**：`python/ipc/preview_mixin.py` 的 `_BASE_PREVIEW_IMAGE_DOMAINS`（frozenset）—— 预览图片下载时的域名校验
2. **Electron 主进程**：`electron/main.ts` 的 `ALLOWED_EXTERNAL_DOMAINS`（数组）—— 通用外部域名白名单

nh 来源使用的域名（来自 `sources/nh/constants.py`）：
- `i.nhentai.net` — 漫画图片 CDN（`IMAGE_HOST`）
- `t.nhentai.net` — 缩略图 CDN（`THUMBNAIL_HOST`）
- `nhentai.net` — 主站域名

## 目标 / 非目标

**目标：**
- 使 nh 来源的漫画预览图片能正常加载
- 保持两处白名单（Python 侧 + Electron 侧）的域名覆盖一致

**非目标：**
- 不涉及 nh 来源的功能扩展（收藏夹、登录等）
- 不修改域名白名单的架构机制（动态加载等）

## 决策

**决策 1：同时更新两处白名单**

Python 侧 `_BASE_PREVIEW_IMAGE_DOMAINS` 控制预览图片下载，是阻塞点。Electron 侧 `ALLOWED_EXTERNAL_DOMAINS` 是通用安全层，虽当前 `fetch-preview-image` handler 未调用 `validateHttpsUrlWithDomains`，但保持一致性可防止未来回归。

**决策 2：添加 `nhentai.net` 主域名而非仅子域名**

添加 `nhentai.net` 到 `ALLOWED_EXTERNAL_DOMAINS` 后，`i.nhentai.net` 和 `t.nhentai.net` 会通过 `hostname.endsWith('.' + d)` 规则自动匹配。Python 侧同理。

**决策 3：不添加 Referer 头**

nh 图片服务器目前不需要 Referer 头即可访问，暂不添加 `REFERER_OVERRIDES` 条目。如后续发现需要，可单独处理。

## 风险 / 权衡

| 风险 | 缓解 |
|------|------|
| nh 图片域名变更 | 与 jm 镜像域名问题类似，目前 nh 域名稳定，暂不做动态加载 |
| 白名单扩大增加攻击面 | 仅添加已知且必要的域名，影响范围可控 |
