## 1. Python 后端：扩展预览图片域名白名单

- [x] 1.1 在 `python/ipc/preview_mixin.py` 的 `_BASE_PREVIEW_IMAGE_DOMAINS` frozenset 中添加 `"i.nhentai.net"` 和 `"t.nhentai.net"`

## 2. Electron 主进程：扩展外部域名白名单

- [x] 2.1 在 `electron/main.ts` 的 `ALLOWED_EXTERNAL_DOMAINS` 数组中添加 `"nhentai.net"`（子域名 `i.nhentai.net`、`t.nhentai.net` 通过 `endsWith` 规则自动匹配）

## 3. 验证

- [x] 3.1 手动验证 nh 来源漫画预览图片能正常加载
- [x] 3.2 运行 `pytest` 确保 Python 测试通过
- [x] 3.3 运行 `npm test` 确保前端测试通过（1 个既有失败，与本次变更无关）
