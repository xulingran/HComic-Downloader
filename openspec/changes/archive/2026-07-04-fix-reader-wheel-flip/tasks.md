## 1. 修复 PageFlipView isFlipping 首次挂载锁死

- [x] 1.1 在 `src/components/PageFlipView.tsx` 的 `PageFlipView` 组件内新增 `const hasMountedRef = useRef(false)`（紧邻现有 `isFlipping` state 声明）
- [x] 1.2 修改"currentPage 变化即上锁"的 effect（当前 line 200-203）：首次执行时置 `hasMountedRef.current = true` 并 `return`（不上锁），后续执行才 `setIsFlipping(true)`，与 `AnimatePresence initial={false}` 首次挂载不播动画、不触发 `onAnimationComplete` 的行为对齐
- [x] 1.3 添加注释说明为何跳过首次挂载（引用 framer-motion v12 `initial={false}` + `animateChanges()` 的 `shouldAnimate=false` 行为），便于后续维护者理解门控对称性

## 2. 回归测试

- [x] 2.1 在 `tests/unit/components/common/PageFlipView.test.tsx` 新增用例"首次挂载后滚轮可触发翻页（single 模式）"：渲染 `currentPage=1`，`fireEvent.wheel(container, { deltaY: 100 })`，断言 `setCurrentPage` 被以 `2` 调用
- [x] 2.2 新增用例"首次挂载后滚轮可触发翻页（double 模式）"：渲染 `displayMode="double"` `currentPage=1`，`fireEvent.wheel(..., { deltaY: 100 })`，断言 `setCurrentPage` 被以 `3` 调用（step=2）
- [x] 2.3 新增用例"首次挂载后滚轮向上在非首页可回退"：渲染 `currentPage=2`，`fireEvent.wheel(..., { deltaY: -100 })`，断言 `setCurrentPage` 被以 `1` 调用
- [x] 2.4 评估"动画期间滚轮被丢弃"用例可行性：若 jsdom 下 framer-motion `onAnimationComplete` 可稳定触发则补该用例，否则在测试文件注释说明跳过原因（jsdom 不执行真实 transform 动画），核心回归由 2.1-2.3 承担

## 3. 验证

- [x] 3.1 运行 `npm test -- PageFlipView` 确认新用例与既有用例全部通过
- [x] 3.2 运行 `npx tsc --noEmit` 确认无类型错误
- [x] 3.3 运行 `npm run lint` 确认 ESLint（含 react-hooks/refs）通过
- [x] 3.4 运行 `npm run lint:test-quality` 确认测试质量闸门通过（用例断言真实 `setCurrentPage` 调用值，非裸 mock 调用断言）
- [x] 3.5 手动验证（如可行）：`npm run dev` 进入阅读器，单页/双页模式首次挂载后直接滚轮翻页，确认立即可用，无卡死
