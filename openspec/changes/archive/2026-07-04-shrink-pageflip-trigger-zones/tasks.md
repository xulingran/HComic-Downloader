## 1. Click-to-flip overlay 几何重构

- [x] 1.1 在 `src/components/PageFlipView.tsx` 的 click-to-flip overlay（约第 288–322 行）将两个 `<button>` 的 `w-[40%]` / `w-[60%]` 改为 `w-1/5`（各 20%），并在两按钮之间插入 `<div className="flex-1 h-full pointer-events-none" />` 作为中央拖拽安全区
- [x] 1.2 确认两个 `<button>` 仍为 `pointer-events-auto` + `onPointerDown={(e) => e.stopPropagation()}`，且 `aria-label`、`aria-disabled`、`cursor-pointer`、`group` 等 class 不变（决策 2）
- [x] 1.3 确认左右 `<svg>` 箭头的 `opacity-0 group-hover:opacity-100`、`justify-start pl-4` / `justify-end pr-4`、尺寸（32×32）、颜色（`rgba(255,255,255,0.5)`）全部保留——视觉零改动（决策 3）

## 2. 组件测试

- [x] 2.1 在 `tests/unit/components/common/PageFlipView.test.tsx` 新增测试：点击左边缘 20% 区域（用 `getByLabelText('上一页')` 触发 click）在非首页时调用 `setCurrentPage` 回退一页，并断言传入页码值（真实行为，非 mock 调用断言）
- [x] 2.2 新增测试：点击右边缘 20% 区域（`getByLabelText('下一页')` click）在非末页时调用 `setCurrentPage` 前进一页，断言传入页码值
- [x] 2.3 新增测试：左右按钮的 boundingClientRect 宽度相等（对称），且各约占容器宽度 20%（容差 ±2px）—— 用 `getBoundingClientRect` 断言几何，覆盖"左右对称"场景
- [x] 2.4 新增测试：中央安全区 div 存在且 `pointer-events` 为 none（getComputedStyle 或 class 断言），覆盖"中央保留拖拽安全区"需求
- [x] 2.5 确认现有 PageFlipView 测试（渲染、翻页方向、wheel 等）仍通过；如有测试断言了旧的 40%/60% 宽度，同步更新

## 3. 验证（完整闸门）

- [x] 3.1 `npx tsc --noEmit` 通过
- [x] 3.2 `npm test` 通过（含新增组件测试）
- [x] 3.3 `npm run lint` 通过
- [x] 3.4 `npm run lint:test-quality` 通过（确保新测试不是裸 mock 调用断言）
- [x] 3.5 手动验证：`npm run dev` 后进入预览模式，zoom = 1 时点画面中央不翻页、点左右边缘翻页；zoom > 1 时在中央拖拽平移可用、边缘点击翻页；滚轮 / 键盘 / 滑块翻页不受影响
