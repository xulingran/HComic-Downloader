## 为什么

推荐标签在当前会话中会立即显示为已添加，但 `myTags` 未被共享的 `CONFIG_KEYS` 白名单接受，preload 在请求到达主进程前抛出 `Invalid config key`。持久化订阅又吞掉该异常，导致配置从未写盘，重新启动应用后推荐标签列表恢复为空。

## 变更内容

- 将 `myTags` 纳入运行时共享配置键白名单，使 preload、主进程类型契约和 Python `CONFIG_KEY_MAP` 对齐。
- 增加配置键契约一致性测试，覆盖 `myTags` 从 preload 到后端持久化边界的可达性，防止仅更新 TypeScript 联合类型或主进程校验器而遗漏运行时白名单。
- 增加推荐标签持久化回归测试，验证写入后重新读取仍保留各来源标签。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `config`: 明确 `ConfigKey`、`CONFIG_KEYS`、主进程校验器与 Python 映射必须覆盖同一组可持久化配置键，并为 `myTags` 增加跨边界回归保护。

## 影响

- 共享契约：`shared/types.ts` 的 `CONFIG_KEYS`。
- Electron 边界：`electron/preload.ts` 使用共享白名单校验 `setConfig`。
- 测试：配置键契约一致性与 `myTags` 持久化回归测试。
- 不新增 IPC 通道、不修改 Python 配置格式，也不产生破坏性变更。
