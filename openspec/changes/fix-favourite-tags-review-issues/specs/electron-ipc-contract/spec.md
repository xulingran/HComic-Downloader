## 新增需求

### 需求:IPC 契约符号必须与消费方同源提交，禁止部分提交导致主干不可构建

当某条 IPC 通道（含共享类型、preload API、renderer hook、Python 事件源、测试 mock）被前端代码引用时，该通道的全部定义必须与引用方落在同一变更内纳入主干。禁止出现「引用方已提交、定义方仅存在于工作区未提交改动」的部分状态——此类状态会让干净检出（无工作区改动）的主干无法通过 `tsc --noEmit` 与完整 Vitest，从而被开发者的本地未提交改动掩盖。

具体到 favourite tags 同步进度通道：`shared/types.ts` 的 `FavouriteTagsProgressEvent` 类型与 `onFavouriteTagsProgress` 方法签名、`src/hooks/useIpc.ts` 的 `useFavouriteTagsProgress` hook、`electron/main.ts` 与 `electron/preload.ts` 的转发与订阅桥接、`python/ipc/favourite_tags_mixin.py` / `search_mixin.py` 的事件源，必须与 `src/components/settings/FavouriteTagSettings.tsx` 的进度订阅消费在同一提交内闭合。

#### 场景:干净主干必须能通过类型检查

- **当** 主干在干净工作区状态下（无未提交改动）执行 `npx tsc --noEmit`
- **那么** 必须以 exit code 0 通过
- **且** 禁止因 `FavouriteTagsProgressEvent` / `useFavouriteTagsProgress` 等 symbol 未导出而报 `TS2305` / `TS2724`

#### 场景:干净主干必须能通过完整 Vitest

- **当** 主干在干净工作区状态下执行 `npm test`
- **那么** 必须无失败用例
- **且** 禁止出现因 mock 缺失进度通道订阅 API 导致的组件渲染崩溃

#### 场景:进度通道定义与消费同源提交

- **当** `FavouriteTagSettings.tsx` 引用 `useFavouriteTagsProgress` / `FavouriteTagsProgressEvent`
- **那么** 提交该引用的同一变更必须包含 `shared/types.ts`、`src/hooks/useIpc.ts`、`electron/main.ts`、`electron/preload.ts` 中对应通道的定义
- **且** 必须包含相关测试 mock 的更新，禁止依赖测试文件单独的未提交改动
