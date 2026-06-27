## 为什么

nh 来源（nhentai）的漫画预览图片域名 `i.nhentai.net` 和缩略图域名 `t.nhentai.net` 未加入 Python 后端的预览图片域名白名单，导致预览漫画时抛出 `Domain not allowed: i.nhentai.net` 错误，用户无法查看 nh 来源的漫画预览。

## 变更内容

- 在 `python/ipc/preview_mixin.py` 的 `_BASE_PREVIEW_IMAGE_DOMAINS` 白名单中添加 `i.nhentai.net` 和 `t.nhentai.net`
- 在 `electron/main.ts` 的 `ALLOWED_EXTERNAL_DOMAINS` 白名单中添加 `nhentai.net`（保持 Electron 侧与 Python 侧域名白名单一致）

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

（无 —— 这是纯配置修复，不涉及规范级行为变更）

## 影响

- `python/ipc/preview_mixin.py`：预览图片域名白名单扩展
- `electron/main.ts`：外部域名白名单扩展
- 无 API 变更、无依赖变更、无破坏性变更
