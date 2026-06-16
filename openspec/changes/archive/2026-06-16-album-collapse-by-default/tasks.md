## 1. 折叠状态管理

- [x] 1.1 在 `DownloadPage.tsx` 中新增 `expandedAlbums: Set<string>` state，键为 `${sourceSite}_${albumId}`（复用现有 group key 格式）
- [x] 1.2 在 `albumGroups` 计算后，新增初始化逻辑：对每个 group，若 `hasAnyFailed`（任一 task `status === 'failed'`）则把 key 加入 `expandedAlbums`；否则不加入。仅在首次出现该 key 时初始化，避免覆盖用户后续操作
- [x] 1.3 新增 `useEffect` 监听失败上升：当某 group 的 `hasAnyFailed` 从 false 变为 true 时，将 key 加入 `expandedAlbums`；失败恢复时不自动移除
- [x] 1.4 新增 `toggleAlbum(key)` 回调：在 `expandedAlbums` 中增删 key

## 2. 头部点击与按钮隔离

- [x] 2.1 给专辑卡头部 `div`（当前 224 行 `<div className="flex items-center justify-between mb-2">`）绑定 `onClick={() => toggleAlbum(key)}`
- [x] 2.2 给所有专辑级按钮（全部暂停 / 全部恢复 / 重试失败 / 全部取消 / 强制打包）的 `onClick` 在最前面加 `e.stopPropagation()`
- [x] 2.3 在头部标题左侧渲染折叠指示符：展开态 `▼`、折叠态 `▶`

## 3. 章节列表条件渲染

- [x] 3.1 将章节子行渲染块（当前 300–357 行 `<div className="mt-2 space-y-1">`）包进条件：仅当 `expandedAlbums.has(key)` 时渲染
- [x] 3.2 折叠态下渲染提示行：`▶ 展开查看 N 章`（N = `group.tasks.length`），整体可点击触发 `toggleAlbum(key)`
- [x] 3.3 展开态下在章节列表上方渲染 `▼ 隐藏章节` 提示行（与折叠态共用同一渲染位置，文案随状态切换）

## 4. 章节失败优先排序

- [x] 4.1 新增 `useMemo` 计算 `sortedTasks`：对 `group.tasks` 做稳定排序，`status === 'failed'` 的 task 置顶，其余保持原数组顺序
- [x] 4.2 将章节子行的 `.map(task => ...)` 数据源从 `group.tasks` 改为 `sortedTasks`

## 5. 验证

- [ ] 5.1 手动验证：新建一个多章专辑下载，确认默认只显示专辑级进度条与控制项，章节子行不可见，提示文案为 `▶ 展开查看 N 章`
- [ ] 5.2 手动验证：点击头部空白处展开 / 折叠正常，点击专辑级按钮不触发折叠
- [ ] 5.3 手动验证：制造一个章节失败，确认专辑自动展开且失败章节排在该专辑章节列表最前
- [ ] 5.4 手动验证：用户手动展开某专辑后让其失败章节重试成功，确认专辑保持展开不自动折叠
- [ ] 5.5 手动验证：刷新页面后所有专辑折叠状态重置，按"有失败则展开"规则重新初始化
- [ ] 5.6 手动验证：独立任务卡（非专辑或单章任务）渲染与控制行为不变
- [x] 5.7 运行 `npx tsc --noEmit`、`npm test`、`npm run lint` 全部通过
