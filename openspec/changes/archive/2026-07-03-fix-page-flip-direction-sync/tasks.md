## 1. 方向推断时序修复（核心根因）

- [x] 1.1 在 `src/components/PageFlipView.tsx` 中，把 `prevPageRef`（useRef）改为 `prevPage`（useState，初始值 `currentPage`），让上一次页码成为参与渲染的 state
- [x] 1.2 把 `setDirection` 调用从 `useEffect` 移到渲染期间：`if (currentPage !== prevPage)` 块内同步 `setDirection` + `setPrevPage`
- [x] 1.3 抽出并导出纯函数 `inferPageDirection(current, previous): 'forward' | 'backward' | null`，渲染期间调用它计算方向（`current === previous` 返回 null，跳过 setDirection）
- [x] 1.4 删除原方向推断 `useEffect` 与 `isFirstRender` ref；移除已无用的 `prevPageRef`
- [x] 1.5 新增 `lastNotifiedPageRef`（`useRef<number | null>(null)`），在独立 `useEffect` 内按 `currentPage !== lastNotifiedPageRef.current` 触发 `onPageChange`，保留「每次翻页触发一次」与「首次挂载触发一次」语义
- [x] 1.6 确认 `AnimatePresence` 的 `custom={direction}` / `mode="popLayout"` / `initial={false}` 配置不变，仅依赖 direction 同步修复

## 2. 测试回归点

- [x] 2.1 在 `tests/unit/components/common/PageFlipView.test.tsx` 导入 `inferPageDirection`
- [x] 2.2 新增 `describe('inferPageDirection')`：forward（current>previous）、backward（current<previous）、null（相等）三个基础契约
- [x] 2.3 新增「next→prev 连续逆向序列」回归用例：模拟 prev 状态连续更新，断言 2→3 得 forward、3→2 得 backward、2→1 得 backward，无上一帧残留
- [x] 2.4 确认现有 11 个 `PageFlipView` 组件用例（单页/双页/边界/按钮/aria-disabled）无回归
- [x] 2.5 确认 `tests/unit/lib/anim.test.ts` 的 variants 方向契约（forward/backward 的 enter/exit x 值）仍通过——它与本变更组合覆盖「方向正确 + 方向驱动正确 transform」

## 3. 规范校准

- [x] 3.1 在 `openspec/specs/ui-animation/spec.md` 的「翻页方向必须由 PageFlipView 内部根据 currentPage 变化推断」需求中，补充时序约束：方向推断**必须**在渲染期间同步完成，**禁止**放进 commit 之后的 `useEffect`
- [x] 3.2 更新该需求下「键盘 ArrowRight 触发向前」「滑块拖动触发向后」场景，明确「在渲染期间推断并在同一提交交给 AnimatePresence」
- [x] 3.3 新增「连续逆向翻页不残留上一帧方向」场景（先 forward 再 backward，退出页朝右而非朝左）

## 4. 验证（必须全过）

- [x] 4.1 `npx vitest run tests/unit/components/common/PageFlipView.test.tsx tests/unit/lib/anim.test.ts` 全过（15 用例）
- [x] 4.2 `npx tsc --noEmit` exit 0
- [x] 4.3 `npm run lint`（含 `react-hooks/refs` 规则）无错误
- [x] 4.4 `npm run lint:test-quality` 通过（无裸 mock 调用断言违规）
- [x] 4.5 `npm test`（完整前端测试套件，88 文件 / 1421 测试）无回归
- [x] 4.6 `openspec-cn validate fix-page-flip-direction-sync --strict` 通过
- [x] 4.7 实机 `npm run dev` 验证：single 与 double 模式下「先下一页、再上一页」退出页朝右滑出，「先上一页、再下一页」退出页朝左滑出，方向与翻页逻辑一致
