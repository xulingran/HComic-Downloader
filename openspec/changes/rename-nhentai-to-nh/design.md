## 上下文

项目中 nh 来源的代码注释、docstring 和前端 UI 文案仍混用 "nhentai" 全称。项目命名约定中该来源应简称 "NH"（类似 "jm" 而非 "jmcomic"）。实际网络域名（`nhentai.net`、`i.nhentai.net`、`t.nhentai.net`）为不可变的外部依赖，不在此次变更范围内。

## 目标 / 非目标

**目标：**
- 所有用户可见的 UI 文案统一使用 "NH"
- 所有代码 docstring 和注释统一使用 "NH"
- 测试描述和断言值同步更新

**非目标：**
- 不改动任何网络域名字符串（`nhentai.net` 等）
- 不改动 openspec 文档、`docs/`、`.superpowers/` 中的历史记录
- 不改动构建产物（`out/`），重新构建即可

## 决策

**决策 1：仅做文本替换，不引入抽象层**

直接在各文件中将 "nhentai" 替换为 "NH"，不引入显示名称常量或映射表。理由：当前来源标签已通过 `shared/types.ts` 的 `label` 字段集中管理，其余位置（docstring、注释、测试描述）为静态文本，无需运行时抽象。

**决策 2：域名字符串不动**

`nhentai.net`、`i.nhentai.net`、`t.nhentai.net` 是实际网络域名，改动会导致请求失败。域名白名单（`electron/main.ts`、`python/ipc/preview_mixin.py`）同理。

**决策 3：`shared/types.ts` 中 label 改为 `'NH'`**

这是用户在来源选择器中看到的显示名称，是此次变更的核心 UI 触点。

## 风险 / 权衡

- **风险**：遗漏某些位置导致显示不一致 → 缓解：grep 全量检查 `nhentai`（排除域名和 openspec）
- **风险**：测试断言更新后遗漏运行验证 → 缓解：实现后运行 `pytest` 和 `npm test` 确认
