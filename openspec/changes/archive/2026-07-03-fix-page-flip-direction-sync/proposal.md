## 为什么

阅读器预览模式（single 与 double）翻页时，方向感知动画在「逆向连续操作」下朝错误方向飞出：先点下一页（forward）再点上一页（backward）时，旧页依旧向左滑出（应为向右）。根因是 `PageFlipView.tsx` 在 `useEffect` 里异步 `setDirection`——`AnimatePresence` 在 `currentPage` 变化的首次提交里拿到的仍是上一帧的 stale direction，退出动画因此朝错误方向启动；等到 effect 更新 direction 时，退出动画已经沿错误方向飞出。该缺陷直接影响翻页过渡的可读性，需现在修复。

## 变更内容

- 把 `PageFlipView.tsx` 的翻页方向推断从 `useEffect` 内异步 `setDirection`，改为在**渲染期间同步**推断（React「adjust state while rendering」模式）：用 state 保存上一页，渲染期间比对 `currentPage` 与 `prevPage` 并立即 `setDirection` + `setPrevPage`。React 会丢弃当前渲染输出并以新 state 重渲染，使 `AnimatePresence` 的 `custom` 在同一提交里就与 `key` 一致。
- 抽出纯函数 `inferPageDirection(current, previous)`，将方向推导逻辑与渲染时机解耦，便于单测锁定「next→prev 等连续逆向序列不残留上一帧方向」契约。
- `onPageChange`（驱动预加载）改用独立 `lastNotifiedPageRef` 在 effect 内触发，保留「每次翻页触发一次预加载」与「首次挂载触发一次」的原语义。
- 校准 `ui-animation` 规范中「翻页方向必须由 PageFlipView 内部根据 currentPage 变化推断」需求，补充「方向推断必须在渲染期间同步完成，禁止放进 commit 后的 effect 导致 AnimatePresence 拿到 stale direction」的约束与对应回归场景。

## 功能 (Capabilities)

### 新增功能
<!-- 本次为缺陷修复，不引入新功能域。 -->

### 修改功能
- `ui-animation`: 校准「翻页方向必须由 PageFlipView 内部根据 currentPage 变化推断」需求——补充方向推断的**时序约束**（必须在渲染期间同步完成，禁止在 commit 后的 effect 内 setDirection），并新增「连续逆向翻页不残留上一帧方向」回归场景。

## 影响

- **前端代码**：`src/components/PageFlipView.tsx`（方向推断从 effect 移到渲染期间；新增导出 `inferPageDirection` 纯函数；`prevPage` 改为 state；`onPageChange` 改用 `lastNotifiedPageRef`）。
- **测试**：`tests/unit/components/common/PageFlipView.test.tsx`（新增 4 个 `inferPageDirection` 单测，锁定 forward / backward / 无变化 / next→prev 连续逆向序列的契约）。
- **规范**：`openspec/specs/ui-animation/spec.md`（校准方向推断需求的时序约束，补充逆向连续翻页场景）。
- **验证**：`npx tsc --noEmit`、`npm test`、`npm run lint`、`npm run lint:test-quality` 必须全过；无数据迁移、无 API/依赖变化、无破坏性变更。
