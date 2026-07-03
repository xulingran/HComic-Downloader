## 1. 修复翻页 variants 端点 opacity（核心根因）

- [x] 1.1 在 `src/lib/anim.ts` 的 `getDirectionalPageVariants()` 中，把 `enter`/`exit` 端点 opacity 从 `0.92` 改为 `0`
- [x] 1.2 删除 `PAGE_FLIP_ENDPOINT_OPACITY` 常量（全代码库无其他消费点），内联 `opacity: 0`
- [x] 1.3 在 `getDirectionalPageVariants` 上方更新注释，说明端点必须为 0 的原因（避免旧页停在滑出终点仍可见、被卸载时突然消失）
- [x] 1.4 `src/components/PageFlipView.tsx` 消费方无需改动（仅消费 variants），确认渲染结构与 `mode="popLayout"` 不变

## 2. 测试回归点

- [x] 2.1 更新 `tests/unit/lib/anim.test.ts` 的端点 opacity 断言：`enter`/`exit` 的 forward 与 backward 方向 opacity 从 `0.92` 改为 `0`，`center` 保持 `1`
- [x] 2.2 在该测试用例补充注释，固化「端点必须完全透明以避免卸载跳变」的回归点
- [x] 2.3 确认 `tests/unit/components/common/PageFlipView.test.tsx` 现有 11 个用例无回归（翻页/双页/边界/按钮）

## 3. 规范校准

- [x] 3.1 在 `openspec/specs/ui-animation/spec.md` 中校准「阅读器 single 与 double 模式必须使用横向滑动翻页过渡」需求：把「端点必须使用轻微 opacity 变化柔化」改为「端点必须完全透明（opacity 0），禁止接近不透明导致卸载跳变」
- [x] 3.2 同步更新该需求下涉及 opacity 的场景描述（向前/向后翻页场景补充「opacity 同步淡出到 0、终点不可见」），并新增「翻页端点完全透明避免卸载跳变」场景

## 4. 验证（必须全过）

- [x] 4.1 `npx vitest run tests/unit/lib/anim.test.ts tests/unit/components/common/PageFlipView.test.tsx` 全过
- [x] 4.2 `npx tsc --noEmit` exit 0
- [x] 4.3 `npm run lint` 无错误
- [x] 4.4 `npm test`（完整前端测试套件，88 文件 / 1313 测试）无回归
- [x] 4.5 `openspec-cn validate fix-reader-double-page-flip-animation --strict` 通过
- [x] 4.6 实机 `npm run dev` 验证：single 与 double 模式翻页不再出现「上一页飞到一边停住然后突然消失」（用户手动确认通过）
