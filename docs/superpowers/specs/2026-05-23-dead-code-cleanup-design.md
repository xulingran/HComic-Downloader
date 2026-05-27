# 死代码清理设计文档

**日期**: 2026-05-23
**状态**: 待实施
**方案**: A（保守清理）

---

## 背景

项目经过多轮迭代，积累了部分未使用的组件、hooks、store 字段和调试残留代码。本次清理的目标是删除所有确认无人使用的代码，降低维护负担。

## 清理范围

### 1. 删除未使用的组件文件（3 个文件 + 2 个测试文件）

| 文件 | 原因 |
|------|------|
| `src/components/Header.tsx` | 无任何源码文件导入，仅有测试引用 |
| `src/components/StatusBar.tsx` | 无任何源码文件导入，仅有测试引用 |
| `src/components/common/LoginExpiredDialog.tsx` | 无任何文件导入，完全死代码 |
| `tests/unit/components/Header.test.tsx` | 对应组件已删除 |
| `tests/unit/components/StatusBar.test.tsx` | 对应组件已删除 |

### 2. 从 store 中删除未使用的字段和方法

| 文件 | 删除项 | 原因 |
|------|--------|------|
| `src/stores/useComicStore.ts` | `detailPrefetchGeneration` 字段、`bumpDetailPrefetch` 方法 | 仅在 store 定义中引用，无外部使用 |
| `src/stores/useDownloadStore.ts` | `addTask` 方法 | 仅在测试中调用，源码中全部使用 `upsertTask` |

### 3. 删除未使用的导出函数

| 文件 | 删除项 | 原因 |
|------|--------|------|
| `src/hooks/useCoverImage.ts` | `clearCoverCache` 函数 | 从未被导入使用，注释标注"供测试使用"但无测试引用 |
| `electron/validators.ts` | `array` 函数 | 未被 main.ts 导入，validators.ts 内部也未使用 |
| `electron/validators.ts` | `optional` 函数 | 未被 main.ts 导入，validators.ts 内部也未使用 |

### 4. 移除调试残留代码

| 文件 | 位置 | 清理内容 |
|------|------|----------|
| `src/pages/SearchPage.tsx` | `handleComicClick` 函数（约 166-168 行） | 函数体只有 `console.log`，删除函数定义并将 onClick 回调改为空操作 |
| `src/pages/FavouritesPage.tsx` | `handleComicClick` 函数（约 173-174 行） | 同上 |
| `src/hooks/useComicReader.ts` | `logPreviewDebug` 函数（19-23 行）及其所有调用 | 仅在 DEV 模式打印日志，清理后用 `console.log` 替代关键错误日志 |
| `electron/main.ts` | `logPreviewDebug` 函数及其所有调用 | 同上 |

## 不在本次范围内的项目（保留供日后处理）

### 方案 B：类型去重

以下类型在多处重复定义，应提取到 `@shared/types` 统一管理：

- `ThemeMode`（`useSettingsStore.ts`、`AppearanceSettings.tsx`、`useTheme.ts`）
- `CardStyle`（`useSettingsStore.ts`、`AppearanceSettings.tsx`）
- `OutputFormat`（`SettingsPage.tsx`、`DownloadSettings.tsx`）
- `NotifyWhenForeground`（`SettingsPage.tsx`、`NotificationSettings.tsx`）

### 方案 C：提取公共组件

以下 UI 逻辑在多处重复实现，应提取为共享组件：

- **PageJumpDialog** — `SearchPage.tsx`（357-404 行）和 `FavouritesPage.tsx`（15-63 行）各自实现了页面跳转弹窗
- **分页导航栏** — SearchPage 和 FavouritesPage 的分页按钮逻辑高度相似
- **批量操作栏** — SearchPage 和 FavouritesPage 的批量选择/下载 UI 几乎一致

## 风险评估

- 所有删除项均通过 grep 验证确认无源码引用
- `Header.tsx` 和 `StatusBar.tsx` 有对应测试，需一并删除以避免测试失败
- `addTask` 在 `downloadStore.test.ts` 中有测试，需同步更新测试用例
- `handleComicClick` 删除后，`ComicCard` 的 `onClick` prop 将传 `undefined`，`ComicCard` 已有 `onClick?.(comic)` 可选链保护，无需额外处理

## 实施步骤

1. 删除 `LoginExpiredDialog.tsx`（无测试，最安全）
2. 删除 `Header.tsx` 及其测试
3. 删除 `StatusBar.tsx` 及其测试
4. 清理 `useComicStore.ts` 中的死字段
5. 清理 `useDownloadStore.ts` 中的 `addTask`
6. 清理 `useCoverImage.ts` 中的 `clearCoverCache`
7. 清理 `validators.ts` 中的 `array` 和 `optional`
8. 清理 `SearchPage.tsx` 中的 `handleComicClick`
9. 清理 `FavouritesPage.tsx` 中的 `handleComicClick`
10. 清理 `useComicReader.ts` 中的 `logPreviewDebug`
11. 清理 `electron/main.ts` 中的 `logPreviewDebug`
12. 运行测试验证
