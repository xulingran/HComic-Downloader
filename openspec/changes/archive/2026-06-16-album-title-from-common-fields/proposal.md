## 为什么

多选漫画"下载为专辑"时，专辑命名弹窗（`AlbumNameDialog`）的输入框默认值被写死为 `批量下载 - ${N}本漫画`，完全没有利用选中漫画的标题信息——用户每次都得手动改名，且这个默认值还存在显示 bug（实际输入框里始终为 `批量下载 - 0本漫画`）。项目里已经有一套成熟的标题归一化与相似度分析逻辑（`src/utils/titleSimilarity.ts`，被重复检测使用），可以低成本复用来从多个标题中提取共有字段，作为合理的默认专辑名。

## 变更内容

- **新增**：从一组漫画标题中提取"共有字段"的纯函数（与现有 `titleSimilarity.ts` 同模块），优先保留 `[作者] 作品名` 这种公共前缀结构，无法提取时返回 `null`。
- **修改**：`SearchPage` / `FavouritesPage` 在打开 `AlbumNameDialog` 时，用选中漫画的标题调用上述函数生成默认名；函数返回 `null` 时回退到旧文案 `批量下载 - ${N}本漫画`。
- **修复**：`AlbumNameDialog` 的 `defaultName` prop 变化时不会同步到内部 `name` state，导致 SearchPage 中常驻挂载的弹窗始终显示首次（可能为空选择时的）值，表现为"输入框始终显示 0 本"。

## 功能 (Capabilities)

### 新增功能
- `album-title-extraction`: 从一组漫画标题中提取共有字段作为默认专辑名（纯算法能力，前端）。

### 修改功能
- `download-album-collapse`: 专辑下载命名流程——`AlbumNameDialog` 默认名从写死文案改为"提取共有字段 + 回退旧文案"，并修复 `defaultName` 不同步的 bug。

## 影响

- **前端代码**：
  - `src/utils/titleSimilarity.ts`（新增提取函数）
  - `src/components/common/AlbumNameDialog.tsx`（修复 defaultName 同步）
  - `src/pages/SearchPage.tsx`、`src/pages/FavouritesPage.tsx`（接入默认名计算）
- **测试**：新增提取函数的单元测试；新增 `AlbumNameDialog` defaultName 同步的组件测试。
- **后端**：无变更——`handle_download_batch_as_album` 继续按传入的 `album_title` 工作，不感知默认名是如何生成的。
- **依赖**：无新增依赖，全部基于已有 `titleSimilarity.ts` 工具。
