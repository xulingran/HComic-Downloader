## 1. will-change 精准化

- [x] 1.1 PageFlipView 翻页 motion.div 加 willChange（仅 isFlipping 时）
- [x] 1.2 AnimatedCardWrapper 不加常驻 will-change（framer-motion 内置优化）
- [x] 1.3 Modal/Drawer/Toast 不加 will-change（进出短暂）

## 2. GPU 友好属性审计

- [x] 2.1 grep 确认所有 framer-motion 动画用 transform/opacity，无 width/height/top/left animate
- [x] 2.2 ProgressBar width 动画保留（进度条场景，权衡不值替换）+ 已在 design 说明

## 3. reduced-motion 全面验证

- [x] 3.1 grep 确认 7 个 framer-motion 容器文件全部用了 useReducedMotionPreference 或 reduceSafe
- [x] 3.2 Skeleton 在 reduced-motion 下 animation 关闭（已实现）

## 4. bundle 体积审计

- [x] 4.1 当前 renderer bundle 976KB（含 framer-motion），CSS 47KB
- [x] 4.2 结论：不做按需导入（Electron 不敏感）
- [x] 4.3 在 docs/animation-performance.md 沉淀基线

## 5. 文档沉淀

- [x] 5.1 新增 `docs/animation-performance.md`（令牌/reduced-motion/will-change/GPU/stagger/bundle/验证清单）
- [x] 5.2 AGENTS.md「重要实现细节」补动画规范引用

## 6. 验证

- [x] 6.1 tsc 通过
- [x] 6.2 npm test 924 通过
- [x] 6.3 npm run lint 通过
- [x] 6.4 npm run build 通过（renderer 976 KB）
- [ ] 6.5 手动验证（deferred）：DevTools FPS 录制
- [ ] 6.6 手动验证（deferred）：长列表 layout 动画不卡顿
- [ ] 6.7 手动验证（deferred）：reduced-motion 真机全面生效
