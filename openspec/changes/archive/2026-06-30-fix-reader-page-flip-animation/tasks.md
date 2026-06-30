## 1. 回归测试

- [x] 1.1 新增或扩展 `src/lib/anim.ts` 相关单元测试，断言 `getDirectionalPageVariants()` 的 forward/backward 位移方向保持正确
- [x] 1.2 断言普通翻页 variants 的 `center` 与 `exit` 显式使用 `smoothTransition`，防止回退到默认 spring
- [x] 1.3 断言普通翻页 enter/exit 端点使用轻微 opacity，center 保持 opacity 1
- [x] 1.4 确认 reduced-motion 翻页 variants 仍为无位移 opacity crossfade，现有行为不被普通路径修改影响

## 2. 动画修复

- [x] 2.1 修改 `getDirectionalPageVariants()`，为进入完成段（center）添加 `transition: smoothTransition`
- [x] 2.2 修改 `getDirectionalPageVariants()`，为退出段（exit）添加 `transition: smoothTransition`
- [x] 2.3 为普通路径的 enter/exit 添加接近 1 的 opacity 端点值，实现轻微淡入淡出柔化
- [x] 2.4 保持 `PageFlipView.tsx` 的 direction 推断、double 模式整体滑动、blank page、isFlipping/wheel 门控逻辑不变

## 3. 验证

- [x] 3.1 运行相关前端测试（至少覆盖动画 variants 与 PageFlipView）
- [x] 3.2 运行 `npx tsc --noEmit`
- [x] 3.3 运行 `npm run lint`
- [x] 3.4 如可行，手动验证阅读器 single / double 模式翻页不再 overshoot 或回弹
  - 用户已确认手动验证通过。
