## 上下文

`myTags` 已经存在于 `AppConfig`、`ConfigKey`、`ConfigValueMap`、Electron 主进程校验器和 Python `CONFIG_KEY_MAP` 中，但运行时数组 `CONFIG_KEYS` 遗漏了该键。主窗口 preload 由 `CONFIG_KEYS` 构造白名单，因此 `window.hcomic.setConfig('myTags', value)` 会在 renderer → main 边界被提前拒绝。Zustand 订阅仅更新内存状态并吞掉异步写入异常，造成“当前会话看似成功、重启后丢失”的假成功。

## 目标 / 非目标

**目标：**

- 恢复 `myTags` 经现有 `set_config` 链路持久化的能力。
- 消除 `ConfigKey` 联合类型与 `CONFIG_KEYS` 运行时白名单的重复维护点。
- 用 preload 边界测试直接守护 `myTags` 被接受并转发，避免只验证 store mock 或主进程校验器。

**非目标：**

- 不新增 IPC 通道或 Python handler。
- 不修改 `my_tags` 的 JSON 结构、来源规则或迁移策略。
- 不在本变更中重做所有后台配置保存错误的 UI 提示机制。

## 决策

1. **以 `CONFIG_KEYS` 作为配置键的单一事实来源。**
   将 `myTags` 加入 `CONFIG_KEYS`，并把 `ConfigKey` 改为 `typeof CONFIG_KEYS[number]`，避免类型联合与运行时白名单再次漂移。相比只在两处各补一次字符串，这一方案能让后续新增配置键时只维护一个列表；`ConfigValueMap[K]` 的泛型索引仍会在类型检查阶段约束每个配置键必须有对应值类型。

2. **保持 preload 的早期拒绝边界不变。**
   `electron/preload.ts` 继续从共享 `CONFIG_KEYS` 构造 `VALID_CONFIG_KEYS`，不为 `myTags` 添加特判，也不放宽未知键校验。这样既修复合法键可达性，也保留对任意恶意键的拒绝。

3. **在真实 preload 暴露 API 层添加回归测试。**
   扩展现有 `tests/unit/preload/preload.test.ts`，调用 `exposedApi.setConfig('myTags', 完整来源对象)`，断言请求被转发到 `IPC_CHANNELS.SET_CONFIG`，同时保留未知键拒绝测试。现有 Python `Config.save/load` 与 `CONFIG_KEY_MAP` 测试继续验证后端往返，无需复制一套文件系统测试。

## 风险 / 权衡

- **[类型声明引用文件后部的常量]** → TypeScript 类型解析允许引用后声明的模块级常量；通过 `npx tsc --noEmit` 与构建验证。
- **[只修复 `myTags`，其他配置键仍可能在主进程或 Python 映射中漂移]** → 本次以 preload 边界和现有后端映射测试覆盖已知回归；若后续需要全语言自动对齐，可单独引入跨语言契约生成，不扩大本次小修范围。
- **[保存异常仍由通用 store 订阅吞掉]** → 本次根因消除后正常路径可持久化；统一错误呈现属于独立 UX 议题，保留为非目标。
