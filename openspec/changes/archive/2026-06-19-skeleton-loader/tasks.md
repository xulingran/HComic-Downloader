## 1. 创建 Skeleton 组件

- [x] 1.1 新增 `src/components/common/Skeleton.tsx`，props variant/className/style
- [x] 1.2 variant 圆角：rect→rounded-lg、text→rounded、circle→rounded-full
- [x] 1.3 linear-gradient 背景 + backgroundSize 200%
- [x] 1.4 animate-shimmer（变更 1 keyframe）
- [x] 1.5 reduced-motion 关闭 animation（静态渐变）

## 2. ComicCard 封面骨架

- [x] 2.1 CoverImage loading 分支替换为 Skeleton variant="rect"
- [x] 2.2 aspect-ratio 与封面一致（用 s.wrapper = w-full h-full，外层 aspect-[6/7]）

## 3. 阅读器首屏骨架

- [x] 3.1 PageFlipView FlipPage loading 分支替换为 Skeleton（h-full w-full，aspectRatio 3/4）
- [x] 3.2 占满阅读区

## 4. 搜索结果骨架网格

- [x] 4.1 SearchPage：isLoading && !needsLogin && filteredComics.length === 0 时渲染骨架网格
- [x] 4.2 12 张 Skeleton（aspect-[6/7] + 标题文本骨架），grid 与真实卡片一致
- [x] 4.3 已有结果时不显示

## 5. 验证

- [x] 5.1 tsc 通过
- [x] 5.2 npm test 924 通过
- [x] 5.3 npm run lint 通过
- [x] 5.4 npm run build 通过（renderer 976 KB）
- [ ] 5.5-5.8 手动验证（deferred）：封面/阅读器/搜索骨架、reduced-motion 静态
