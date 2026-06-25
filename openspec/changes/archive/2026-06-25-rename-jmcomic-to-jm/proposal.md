## 为什么

项目漫画来源的名称中使用 `jmcomic` 这一复合标识符，而无论是对用户界面、API 还是开发者，简短的 `jm` 都更具可读性且语义一致。用户界面上当前显示的 "JMComic" 同样可以简化为 "JM"，与 "哔咔"、"拷贝漫画" 等短名称保持风格一致。当前代码中有 80+ 个文件、数百处引用统一使用 `jmcomic`，但用户可见的标签（如设置页、历史页）和内部命名都将其展示为 "JMComic"，内码中的 `jmcomic` 反而显得冗余。将其统一精简为 `jm`，保持外部展示名 "JMComic" 不变，仅变更内部标识符和代码中的字面量。

## 变更内容

1. **Python 后端** — 将 `sources/jmcomic/` 目录重命名为 `sources/jm/`，所有模块内的标识符、导入路径和字符串字面量从 `jmcomic` 改为 `jm`
2. **共享类型 (shared/types.ts)** — 将 IPC 通道、配置键、来源枚举值、类型字段从 `jmcomic` → `jm`
3. **Electron 主进程** — 将域名变量、IPC 处理、白名单配置、登录窗口逻辑中的标识符从 `jmcomic` → `jm`
4. **React 前端** — 将 hooks、组件属性、页面引用中的标识符从 `jmcomic` → `jm`
5. **测试** — 所有 Python 和前端测试中的 `jmcomic` 引用同步改为 `jm`
6. **文档** — README、AGENTS.md 以及设计文档中的引用同步更新
7. **配置持久化** — 已存储的用户配置中的 `jmcomic` 键需要做向后兼容处理
8. **用户展示标签** — 用户界面中的来源显示名从 "JMComic" 改为 "JM"（涉及 `SOURCE_META` label、历史页映射等）

## 功能 (Capabilities)

### 新增功能
<!-- 本次变更是纯粹的标识符重构，不引入新功能。 -->
- 无

### 修改功能
- `jm-source`: 来源标识符从 `jmcomic` 变更为 `jm`，影响所有与来源选择/分发/存储相关的代码路径
- `config`: 配置键 `jmcomicDomain` → `jmDomain`（需要迁移已持久化的配置）
- `auth`: 认证相关的 IPC 方法和类型标识符更新
- `maintenance-scanner`: 孤儿清理中的来源推断模式串更新

## 影响

- **BREAKING**: 配置文件中 `jmcomicDomain` → `jmDomain`，需要迁移逻辑兼容旧配置
- **BREAKING**: IPC 通道名 `python:get-jmcomic-domains` → `python:get-jm-domains`，前后端必须同步
- **BREAKING**: 持久化下载历史、收藏夹等数据中使用 `jmcomic` 来源标识符的记录，需要兼容或迁移
- **Python 后端**：`sources/jmcomic/` 目录重命名 + 内部模块导入路径变更
- **Electron/前端**：约 20 个 TS/TSX 文件中变量名、类型名、IPC 调用链变更
- **测试**：约 30+ 测试文件中的引用需同步更新
- **文档**：README、AGENTS.md、3 份设计文档需更新
