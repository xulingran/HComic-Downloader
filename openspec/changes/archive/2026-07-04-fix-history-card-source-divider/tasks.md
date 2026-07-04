## 1. 封面布局历史卡片 footer 视觉分隔

- [x] 1.1 在 `src/pages/HistoryPage.tsx` 的 `HistoryCard` 函数 cover 分支（约第 489 行）将来源/元信息行容器 className 从 `px-2 pb-2 -mt-1` 改为 `px-2 pt-2 pb-2 mt-2 border-t border-[var(--border)]`（去负边距、加正向 `mt-2`/`pt-2` 留白、加 `border-t border-[var(--border)]` 顶部分割线）
- [x] 1.2 确认 `detailed` 分支（约第 418–461 行）未改动——来源标签仍是同一 `text-xs` div 内的内联 `<span>`，`·` 分隔符 `mx-1.5` 不变（决策非目标）
- [x] 1.3 确认未给来源行容器加任何背景色 class（决策 3 否决了 `bg-[var(--bg-secondary)]`，仅用顶部分割线 + 留白）

## 2. 验证（完整闸门）

- [x] 2.1 `npx tsc --noEmit` 通过
- [x] 2.2 `npm test` 通过（1442/1442）
- [x] 2.3 `npm run lint` 通过（仅 `PageFlipView.tsx` 无关文件预存的 react-refresh 警告）
- [x] 2.4 `npm run lint:test-quality` 通过（本变更未新增测试，无新增低价值断言风险）
- [x] 2.5 手动验证：`npm run dev` 后进入历史记录页封面网格布局，确认来源行与卡片标题/作者之间有可见留白 + 顶部分割线；切换 detailed 列表布局确认无变化；深/浅色主题切换确认分割线颜色自动适配
