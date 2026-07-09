## 1. 侧边栏顶部间距修复

- [x] 1.1 在 `src/components/favourites/FavouriteSourceSidebar.tsx` 的 `<aside>` className 上增加 `pt-6`，使来源导航顶部距内容区顶部 24px
- [x] 1.2 确认 `<aside>` 修改后仍保留既有 `w-[150px] shrink-0 self-start`，宽度、shrink 与 sticky 漂移修复行为不变

## 2. 验证

- [x] 2.1 运行 `npx tsc --noEmit` 确认 TypeScript 类型检查通过
- [x] 2.2 运行 `npx eslint src/components/favourites/FavouriteSourceSidebar.tsx` 确认 ESLint 通过
- [x] 2.3 运行 `npm test` 确认前端测试全绿（1561 passed）
- [x] 2.4 人工验证：启动 `npm run dev`，进入收藏夹页，实测来源侧边栏 nav 顶部位置为 24px，与设置页、工具箱页侧边栏一致
- [x] 2.5 人工验证：向下滚动收藏夹内容，确认来源导航仍按 `top-6` 正常吸附，顶部内边距未改变滚动吸附行为
