# Random Button Design

## Summary

在搜索页搜索按钮左侧新增"🎲 随机"按钮，调用 hcomic `/random` 接口获取随机漫画列表。仅 HComic 源显示。

## User Behavior

1. 用户选择 HComic 源 → 搜索按钮左侧出现"🎲 随机"按钮
2. 点击随机按钮 → 清空搜索框和 tag 输入 → 显示 loading → 结果区域展示随机漫画卡片
3. 切换到其他源（moeimg）→ 随机按钮隐藏
4. 随机加载中按钮 disabled，防止重复点击

## Design: Python Backend

`HComicParser` 新增：

- `_build_random_url()` → `https://h-comic.com/random?q=&tag=`
- `random()` → 请求 URL，复用 `parse_search_page` 解析，返回 `(List[ComicInfo], Optional[PaginationInfo])`

`SearchMixin` 新增 `handle_random()`：
- 调用 `self.parsers["hcomic"].random()`
- 返回 `{ comics, pagination }`，格式与 `handle_search` 一致
- 非 hcomic 源调用时抛出 `ValueError`

`MultiSourceParser` 新增 `random()` 代理方法，转发到 hcomic parser。

## Design: IPC Layer

**shared/types.ts：**
- `IPCMethods.random: { params: {}, result: SearchResult }`
- `PYTHON_IPC_CHANNEL_MAP['python:random'] = 'random'`
- `IPC_CHANNELS.RANDOM = 'python:random'`
- `HcomicAPI.random(): Promise<SearchResult>`

**electron/preload.ts：** 新增 `random()` 方法

**electron/main.ts：** 新增 `python:random` channel handler

## Design: React Layer

**src/hooks/useIpc.ts：** 新增 `useRandom` hook

**src/pages/SearchPage.tsx：**
- 搜索按钮左侧、过滤按钮右侧添加"🎲 随机"按钮
- `source === 'hcomic'` 时条件渲染
- 点击 handler：清空 query/tags → 调用 `random()` → 写入 store
- Loading 状态复用现有 `isLoading`，disabled 按钮

## Scope

- 仅 HComic 源
- 不涉及分页（random 接口为一次性随机结果）
- 不改动现有 search 流程
