## 1. 提取算法（纯函数）

- [x] 1.1 在 `src/utils/titleSimilarity.ts` 新增 `extractAlbumTitle(titles: string[]): string | null`，按 design.md 决策 1 的三段式算法实现：原始标题按 `/\s+/` 分词 → 集合交集 → 作者前缀独立判定 → 组装 → 长度 < 2 或选中数 < 2 返回 null → 交集为空时回退原始标题的最长公共前缀（trim 后 ≥ 2 才用）
- [x] 1.2 为 `extractAlbumTitle` 编写单元测试（`tests/unit/utils/titleSimilarity.extract.test.ts` 或追加到既有 titleSimilarity 测试文件），覆盖 spec `album-title-extraction` 的全部场景：同作品多章节、无作者前缀、token 顺序差异、无空格作者前缀、部分标题带括号、选中数 < 2、无共有返回 null、公共前缀过短返回 null、无空格但有字符级公共前缀

## 2. 弹窗 defaultName 同步修复

- [x] 2.1 在 `src/components/common/AlbumNameDialog.tsx` 增加 `useEffect(() => { if (isOpen) setName(defaultName) }, [isOpen])`；依赖数组**仅含 `[isOpen]`**，避免覆盖用户编辑
- [x] 2.2 为 `AlbumNameDialog` 编写组件测试，覆盖 spec `download-album-collapse` 的"修改需求"场景：常驻挂载多次打开显示最新默认名、用户编辑期间不被覆盖、首次打开即显示准确非零数量回退文案

## 3. 接入默认名计算

- [x] 3.1 在 `src/pages/SearchPage.tsx` 打开 `AlbumNameDialog` 前，用 `selectedComics()`（或等价方式拿到选中漫画标题数组）调用 `extractAlbumTitle`，返回 null 时回退 `批量下载 - ${selectedIds.size}本漫画`；将结果作为 `defaultName` 传入弹窗
- [x] 3.2 在 `src/pages/FavouritesPage.tsx` 做同样接入
- [x] 3.3 确认两个页面传给 `AlbumNameDialog` 的 `comicCount` 始终等于 `selectedIds.size`（不是 0），与新的 `defaultName` 一致

## 4. 验证

- [x] 4.1 运行 `npm test`，确认新增单元测试与组件测试全部通过
- [x] 4.2 运行 `npx tsc --noEmit`，确认无类型错误
- [x] 4.3 运行 `npm run lint`，确认 ESLint 通过
- [x] 4.4 手动验证：搜索页/收藏页选中同作品多章节，弹窗预填作品名；选中无共有标题，弹窗预填 `批量下载 - N本漫画`（N 准确非 0）；用户可修改后正常下载

## 5. 实现中发现的额外工作

以下任务在实现过程中超出原计划，因实际需求或代码现实而补充：

- [x] 5.1 新增 `pickAlbumDefaultName(titles, count)` 包装函数：封装"提取 + 日志 + 回退"，供两个 page 调用（避免调用方重复，且把日志关注点从纯函数 `extractAlbumTitle` 分离）
- [x] 5.2 把默认名计算从 `useMemo` 挪进点击 handler（`handleBatchDownloadAsAlbumClick`）：useMemo 在点击按钮时依赖未变、不重新执行，导致日志时机错误且数据可能过时；改为 handler 内计算 + state 存储
- [x] 5.3 日志级别从 `console.debug` 改为 `console.info`：Chrome DevTools 默认隐藏 verbose/debug 级别，info 确保默认可见
- [x] 5.4 扩展分词分隔符从 `/\s+/` 为 `/[\s\-—_～~]+/`：真实场景发现连字符分隔的标题（如 `偷袭观者-困困觉`，共有部分在尾部）按空格分词完全失效；扩展后覆盖空格、连字符、下划线、波浪号
- [x] 5.5 为分隔符扩展补充测试用例：连字符尾部共有、空格连字符混合、下划线分隔、作者前缀与连字符结合
- [x] 5.6 `useBatchDownload` hook 补导出 `selectedComics`：hook 内部定义但 return 未带，两个 page 接入时才暴露
- [x] 5.7 `AlbumNameDialog` 同步机制从 `useEffect` 改为"渲染期间检测 prop 变化"：规避 ESLint `react-hooks/set-state-in-effect` 规则
