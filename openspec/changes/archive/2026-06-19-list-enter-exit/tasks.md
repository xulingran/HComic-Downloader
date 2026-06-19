## 1. 扩展 anim.ts 列表 variants

- [x] 1.1 新增 `cardItemVariants`（opacity+y 进出、scale 退出）
- [x] 1.2 新增 `getCardItemVariants(index)` 工厂（前 20 项 stagger，之后 delay=0）+ STAGGER_LIMIT=20
- [x] 1.3 新增 `getReducedCardItemVariants()`（reduced-motion 纯 opacity）
- [x] 1.4 新增 `taskItemVariants` + `getReducedTaskItemVariants()`（DownloadPage 任务项）

## 2. 创建 AnimatedCardWrapper 组件

- [x] 2.1 新增 `src/components/common/AnimatedCardWrapper.tsx`
- [x] 2.2 motion.div + layout prop + variants
- [x] 2.3 接收 index，调用 getCardItemVariants(index)
- [x] 2.4 reduced-motion 关闭 layout、用 reduced variants
- [x] 2.5 style={{ contain: 'layout' }} 优化长列表
- [x] 2.6 children 透传

## 3. SearchPage 应用

- [x] 3.1 引入 LayoutGroup + AnimatePresence + AnimatedCardWrapper
- [x] 3.2 容器 div 包进 LayoutGroup + AnimatePresence mode="popLayout"
- [x] 3.3 BlockedPlaceholder 与 ComicCard 都用 AnimatedCardWrapper 包裹（key 统一 getComicKey）
- [x] 3.4 加 index 参数到 map

## 4. FavouritesPage 应用

- [x] 4.1 同 SearchPage 模式
- [x] 4.2 ComicCard 包裹 + index

## 5. HistoryPage 应用

- [x] 5.1 同模式
- [x] 5.2 HistoryCard 包裹 + index

## 6. DownloadPage 任务列表动画

- [x] 6.1 引入 LayoutGroup + AnimatePresence + motion
- [x] 6.2 专辑卡 motion.div + layout + taskVariants
- [x] 6.3 独立任务 motion.div + layout + taskVariants
- [x] 6.4 reduced-motion 退化（reduceMotion 判断）

## 7. 验证

- [x] 7.1 tsc 通过
- [x] 7.2 npm test 924 通过
- [x] 7.3 npm run lint 通过
- [x] 7.4 npm run build 通过（renderer 975 KB）
- [ ] 7.5-7.9 手动验证（deferred）：卡片进出、cardStyle 切换、长列表 stagger、任务进出、reduced-motion
