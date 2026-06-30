## 为什么

推荐标签设置页的「从收藏夹同步」按钮目前只显示固定的「正在同步...」文案。同步由后端一次性完成，用户无法判断收藏夹页扫描、无标签漫画详情补全等长耗时阶段的进度，容易误以为卡住。

该功能历史上曾通过前端逐页拉收藏夹显示页码进度；当前同步逻辑已收敛到 Python 后端一站式 `sync_favourite_tags`，因此需要以通知事件方式重新引入实时进度显示，同时保留现有后端同步语义。

## 变更内容

- 为 `sync_favourite_tags` 同步流程新增收藏夹标签同步进度通知，覆盖收藏页扫描、无标签漫画补全、完成与错误状态。
- 在 Electron 主进程、preload 和前端 hook 中新增专用的 favourite tags progress 通道，避免复用标签目录刷新进度通道。
- 在 `FavouriteTagSettings` 的「从收藏夹同步」按钮区域显示真实进度文案，替代固定「正在同步...」反馈。
- 保留现有 `syncFavouriteTags(source)` 调用与最终返回统计，不回退到前端逐页 `getFavourites` 同步方案。
- 不改变推荐标签高亮的数据源：`favourite_tag_index` 仍仅作为「检测标签」候选池，`myTags` 仍是高亮唯一生效源。

## 功能 (Capabilities)

### 新增功能

### 修改功能
- `tag-favourites`: 「检测标签」候选池的收藏夹同步必须提供实时进度反馈。
- `electron-ipc-contract`: 新增 favourite tags 同步进度的专用 Python notification 与 renderer notification 通道契约。

## 影响

- Python 后端：`python/ipc/favourite_tags_mixin.py` 中的 `handle_sync_favourite_tags` 需要在同步阶段发出进度通知。
- Electron 主进程：`electron/main.ts` 需要转发新的 Python notification。
- Preload/API 契约：`electron/preload.ts` 与 `shared/types.ts` 需要声明和暴露订阅 API。
- React 前端：`src/hooks/useIpc.ts` 需要新增 progress hook；`src/components/settings/FavouriteTagSettings.tsx` 需要展示进度。
- 测试：需要覆盖进度事件格式、通知转发/订阅、设置页同步进度展示与完成后清理。
