## 1. 共享占位组件

- [x] 1.1 新建 `src/components/common/ReaderPagePlaceholder.tsx`：渲染一个 `aspect-ratio: 3/4`、背景色 `#1a1a2e`、中心居中 `animate-spin` spinner（`text-gray-400`）的占位组件，接收可选 `className` 用于覆盖外层尺寸（如 `h-full w-full`）。
- [x] 1.2 为 `ReaderPagePlaceholder` 新增单元测试 `tests/ReaderPagePlaceholder.test.tsx`：断言背景色为 `#1a1a2e`（或对应 computed style）、存在 `animate-spin` 元素、占位元素 `aspect-ratio` 为 `3/4`、`aria-hidden` 标记（占位非内容）。

## 2. 滚动模式接入

- [x] 2.1 修改 `src/components/ReaderPage.tsx`：把"已进入视口/`priority` 但 `urlHash` 未就绪"分支（当前的孤立 `animate-spin h-6 w-6 text-gray-600`）替换为 `<ReaderPagePlaceholder className="h-full w-full" />`；**保留**未进入视口分支的 `repeating-linear-gradient` 横纹。
- [x] 2.2 验证滚动模式下：未进入视口的页显示横纹、进入视口后切换为 ReaderPagePlaceholder、加载完成后渲染 `<img>`，三态过渡平滑无高度跳动。

## 3. 翻页模式接入

- [x] 3.1 修改 `src/components/PageFlipView.tsx` 的 `FlipPage`：把 `!urlHash && !error` 分支的 `<Skeleton variant="rect" className="h-full w-full" style={{ aspectRatio: '3/4', maxWidth: '100%' }} />` 替换为 `<ReaderPagePlaceholder className="h-full w-full" />`。
- [x] 3.2 移除 `PageFlipView.tsx` 顶部不再使用的 `import { Skeleton } from './common/Skeleton'`。
- [x] 3.3 验证翻页模式（single + double）下加载中占位与滚动模式视觉一致，浅色主题下不再出现白色色块。

## 4. 测试与验证

- [x] 4.1 更新或新增 `ReaderPage` 加载分支测试：断言加载中渲染 `ReaderPagePlaceholder`、未进入视口渲染横纹。
- [x] 4.2 更新或新增 `PageFlipView`/`FlipPage` 加载分支测试：断言加载中渲染 `ReaderPagePlaceholder` 而非 `Skeleton`。
- [x] 4.3 运行完整验证流程：`npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run lint:test-quality` 全部通过。
- [ ] 4.4 手动验证：分别用浅色/深色主题打开阅读器，确认翻页与滚动两种模式下加载中占位均为阅读器背景色 + spinner，无白色色块。
