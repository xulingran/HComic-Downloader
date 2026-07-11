## 为什么

本地漫画库的资产详情抽屉（`LibraryAssetDetailDrawer`）目前硬挂载/卸载，开合瞬间出现、消失，与搜索页/收藏夹页的漫画详情抽屉（`ComicInfoDrawer`）的弹簧滑入动画体验不一致。同一应用里两个同构的右侧抽屉行为割裂，破坏了交互连贯性。现在 `src/lib/anim.ts` 已提供可复用的 `drawerPresenceVariants` / `overlayPresenceVariants` / `springTransition` / `reduceSafe` 令牌，只是库抽屉尚未接入。

## 变更内容

- 将 `LibraryAssetDetailDrawer` 的 overlay 和面板改为 framer-motion `motion.div`，套用与 `ComicInfoDrawer` 相同的 `overlayPresenceVariants` / `drawerPresenceVariants` 变体。
- 用 `<AnimatePresence>` 包裹，删除当前的 `if (!open || !asset) return null` 早返回，使关闭时能播放退场动画。
- 接入 `reduceSafe` + `useReducedMotionPreference`，在用户偏好减少动态时降级为纯淡入淡出，与既有双层降级策略一致。
- 不改动抽屉的布局尺寸（保留 `max-w-md`）、打开状态管理（`LibraryCatalogView` 的本地 `detailOpen`/`detailAsset`）和内容渲染。

## 功能 (Capabilities)

### 新增功能
<!-- 无新增功能 -->

### 修改功能
- `ui-animation`: 补充需求——所有交互式右侧详情抽屉（含本地漫画库资产详情抽屉）必须复用 `drawerPresenceVariants` / `overlayPresenceVariants` 等集中式令牌，并提供与 `prefers-reduced-motion` 一致的双层降级，禁止组件自定义动画时长/曲线或硬挂载。

## 影响

- **代码**：`src/components/library/LibraryAssetDetailDrawer.tsx`（唯一需要改动的组件）。
- **依赖**：新增对 `framer-motion`（已在项目中）和 `src/lib/anim.ts` 既有令牌的依赖，不引入新第三方库。
- **测试**：现有该抽屉的相关测试需适配 `AnimatePresence`（关闭后面板会在退场动画窗口内仍挂载约 300ms）。
- **无破坏性变更**：API、IPC、数据层均不受影响。
