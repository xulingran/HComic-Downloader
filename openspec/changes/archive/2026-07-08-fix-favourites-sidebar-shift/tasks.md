## 1. 侧边栏布局修复

- [x] 1.1 在 `src/components/favourites/FavouriteSourceSidebar.tsx` 的 `<aside>` className 上增加 `self-start`，覆盖 flex 默认的 `align-items: stretch`，使 aside 按自身内容高度收缩
- [x] 1.2 确认 `<aside>` 修改后仍保留既有 `w-[150px] shrink-0`，宽度与 shrink 行为不变

## 2. 验证

- [x] 2.1 运行 `npm test` 确认前端测试全绿（若存在 FavouriteSourceSidebar 相关测试，确认未被破坏）
- [x] 2.2 运行 `npx tsc --noEmit` 确认 TypeScript 类型检查通过
- [x] 2.3 运行 `npm run lint` 确认 ESLint 通过
- [x] 2.4 人工验证：启动 `npm run dev`，进入收藏夹页，加载任意来源（HComic/MoeImg/JM/哔咔）漫画数据后，确认左侧来源列表不再下移；向下滚动时来源列表仍按 `top-6` 正常吸附
- [x] 2.5 人工验证：切换来源、翻页、刷新后，左侧来源列表垂直位置保持稳定，无跳动
