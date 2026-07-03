## 为什么

阅读器翻页（single 与 double 模式）出现「上一页飞到一边停住然后突然消失」的观感缺陷：旧页滑出动画结束时仍清晰可见，紧接着 framer-motion 卸载该 motion.div 导致突兀消失。根因是 `src/lib/anim.ts` 的方向感知翻页 variants 把进入/退出端点 opacity 设为 `0.92`（`PAGE_FLIP_ENDPOINT_OPACITY`），端点几乎不透明，淡出形同未发生。该 variants 被单页/双页共享，故两种模式都受影响，需现在修复以恢复翻页过渡的连贯性。

## 变更内容

- 把 `getDirectionalPageVariants()` 的 `enter`/`exit` 端点 opacity 从 `0.92` 改为 `0`（完全透明），删除 `PAGE_FLIP_ENDPOINT_OPACITY` 常量。这样旧页在滑出过程中同步淡出，动画结束时已不可见，被卸载时不再有「突然消失」的视觉跳变。
- 更新 `ui-animation` 规范中关于翻页端点 opacity 的需求措辞：原措辞「轻微 opacity 变化柔化」与正确实现冲突（轻微变化正是 bug 成因），校准为「端点必须完全透明，避免旧页滑出后仍可见再被突兀卸载」。
- 同步更新 `tests/unit/lib/anim.test.ts` 的端点 opacity 断言（0.92 → 0），并补充注释固化回归点。

## 功能 (Capabilities)

### 新增功能
<!-- 本次为缺陷修复，不引入新功能域。 -->

### 修改功能
- `ui-animation`: 校准「阅读器 single 与 double 模式必须使用横向滑动翻页过渡」需求中关于进入/退出端点 opacity 的措辞——从「轻微 opacity 变化柔化新旧页交替」改为「端点必须完全透明（opacity 0），避免旧页滑出终点仍可见、被卸载时表现为突然消失」。

## 影响

- **前端代码**：`src/lib/anim.ts`（删除 `PAGE_FLIP_ENDPOINT_OPACITY` 常量，`enter`/`exit` opacity 改为 0，更新注释）；`src/components/PageFlipView.tsx` 无需改动（消费方）。
- **测试**：`tests/unit/lib/anim.test.ts`（端点 opacity 断言 0.92 → 0，加回归注释）。
- **规范**：`openspec/specs/ui-animation/spec.md`（修正「翻页过渡」相关需求中端点 opacity 的措辞与对应场景）。
- **验证**：`npx tsc --noEmit`、`npm test`（含 `anim.test.ts` 与 `PageFlipView.test.tsx`）、`npm run lint` 必须全过；无数据迁移、无 API/依赖变化。
