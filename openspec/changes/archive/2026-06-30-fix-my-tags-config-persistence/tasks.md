## 1. 修复配置键契约

- [x] 1.1 在 `shared/types.ts` 的 `CONFIG_KEYS` 中加入 `myTags`，恢复 preload 对合法推荐标签持久化请求的放行。
- [x] 1.2 将 `ConfigKey` 改为由 `typeof CONFIG_KEYS[number]` 推导，并确认 `ConfigValueMap` 对所有配置键仍可被泛型安全索引。

## 2. 增加回归测试

- [x] 2.1 扩展 `tests/unit/preload/preload.test.ts`：使用完整分来源 `myTags` 对象调用暴露的 `setConfig`，断言转发到 `python:set-config`，并保留未知键在 preload 被拒绝且不触发 IPC 的断言。
- [x] 2.2 运行 `tests/test_config_my_tags.py`，确认 Python `CONFIG_KEY_MAP` 与 `Config.save/load` 往返仍保留推荐标签，避免前端修复破坏后端既有契约。

## 3. 验证

- [x] 3.1 运行 `npx tsc --noEmit` 与 preload 定向 Vitest，确认单一事实来源的类型推导和 IPC 回归测试通过。
- [x] 3.2 运行 `npm run lint`、`npm run lint:test-quality` 与相关 Python 测试，确认修复满足仓库质量闸门。
- [x] 3.3 在隔离配置目录启动应用，添加推荐标签后重启，确认列表与 `config.json` 中的 `my_tags` 均保留。
