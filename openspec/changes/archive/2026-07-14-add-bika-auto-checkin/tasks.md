## 1. Bika 后端签到能力

- [x] 1.1 在 BikaParser 中实现用户资料检查、按需 punch-in 与结构化状态返回
- [x] 1.2 增加解析器单元测试，覆盖未签到、已签到、字段异常和代理 Session 复用路径
- [x] 1.3 增加 Python JSON-RPC handler 与路由，并补充 handler 测试

## 2. Electron IPC 契约

- [x] 2.1 在 shared types 中增加通道、JSON-RPC map 和 renderer API 类型
- [x] 2.2 在 Electron 主进程和 preload 中接通无参数签到调用
- [x] 2.3 增加 preload/契约测试，验证专用通道与无敏感参数转发

## 3. 搜索页自动触发

- [x] 3.1 增加 useBikaCheckIn hook，并在 Bika 认证成功进入搜索页时非阻塞触发
- [x] 3.2 实现页面挂载周期内去重、切源迟到结果保护和仅新签到成功 Toast
- [x] 3.3 增加 SearchPage 行为测试，覆盖默认 Bika、切换 Bika、已签到、失败非阻塞和认证失败不触发

## 4. 验证

- [x] 4.1 运行相关 Python/Vitest 测试、TypeScript 类型检查和测试质量闸门
- [x] 4.2 运行 Python lint/format 与 JS/TS lint，并修复本变更引入的问题
