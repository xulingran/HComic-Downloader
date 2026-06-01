# 收藏夹标签推荐与搜索高亮

## 概述

基于收藏夹中漫画的 tag 数据，统计用户偏好的 tag，在搜索页面中对包含这些 tag 的搜索结果进行高亮标记。功能默认关闭，可在设置中开启。首期仅支持 hcomic 源，jmcomic 留作 TODO。

## 方案选择

**选定方案**：后端 SQLite 存储 + 专用 IPC API。

在 Python 后端 SQLite 中维护 tag 索引表，通过新增 IPC 方法（`get_favourite_tags`、`sync_favourite_tags`、`remove_favourite_tag`）供前端读写。与项目现有架构（IPC + Python 后端 + SQLite）完全一致，查询快、数据持久化可靠。

排除方案：
- 配置文件存储：不适合大量 tag 数据，频繁重写效率低
- 纯前端 Zustand：收藏夹数据分页，前端拿不到全量，localStorage 有容量限制

## 第一节：后端数据层

### 数据库

文件路径：`~/.hcomic_downloader/favourite_tags.db`，SQLite + WAL 模式。

**表结构**：

```sql
CREATE TABLE IF NOT EXISTS favourite_tag_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'hcomic',
    count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(tag, source)
);

CREATE TABLE IF NOT EXISTS favourite_tag_comics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comic_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'hcomic',
    tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
    UNIQUE(comic_id, source)
);
```

- `favourite_tag_comics`：每个收藏漫画的 tag 快照，用于增量更新时对比差异
- `favourite_tag_index`：聚合后的 tag 频率统计，直接用于查询

### 新增文件

`python/ipc/favourite_tags_mixin.py`，包含 `FavouriteTagsMixin` 类和 `FavouriteTagsDB` 类。

### IPC 方法

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_favourite_tags` | `source?: string` | `{ tags: Array<{tag, count}> }` | 按频率降序返回推荐 tag |
| `sync_favourite_tags` | `source?: string` | `{ synced: number }` | 逐页拉取收藏夹并重建索引 |
| `remove_favourite_tag` | `tag: string, source?: string` | `{ success: boolean }` | 用户手动删除某个推荐 tag |

### 增量更新触发点

1. **添加收藏**（`handle_add_to_favourites` 成功后）：将该漫画的 tags 写入 `favourite_tag_comics`，并递增 `favourite_tag_index` 中对应 tag 的 count
2. **删除收藏**（`handle_remove_from_favourites` 成功后）：从 `favourite_tag_comics` 中取出该漫画的 tags 快照，递减对应 tag 的 count（count 为 0 时删除行），然后删除该漫画记录
3. **打开收藏夹**（`handle_get_favourites`）：对比当前页返回的漫画 tags 与 `favourite_tag_comics` 中的快照，如有差异则更新索引
4. **首次使用**：用户在设置页点击"从收藏夹同步标签"，调用 `sync_favourite_tags` 遍历所有收藏夹页面重建索引

### IPCServer 集成

- `FavouriteTagsMixin` 加入 `IPCServer` 的继承列表
- `_HANDLER_NAMES` 注册三个新方法
- `__init__` 中初始化 `FavouriteTagsDB` 实例

## 第二节：IPC 桥接层

### shared/types.ts 新增

```typescript
// IPC_CHANNELS
GET_FAVOURITE_TAGS: 'python:get-favourite-tags',
SYNC_FAVOURITE_TAGS: 'python:sync-favourite-tags',
REMOVE_FAVOURITE_TAG: 'python:remove-favourite-tag',

// PYTHON_IPC_CHANNEL_MAP
'python:get-favourite-tags': 'get_favourite_tags',
'python:sync-favourite-tags': 'sync_favourite_tags',
'python:remove-favourite-tag': 'remove_favourite_tag',

// IPCMethods
get_favourite_tags: {
  params: { source?: string }
  result: { tags: Array<{tag: string; count: number}> }
}
sync_favourite_tags: {
  params: { source?: string }
  result: { synced: number }
}
remove_favourite_tag: {
  params: { tag: string; source?: string }
  result: { success: boolean }
}

// HcomicAPI
getFavouriteTags(source?: string): Promise<{ tags: Array<{tag: string; count: number}> }>
syncFavouriteTags(source?: string): Promise<{ synced: number }>
removeFavouriteTag(tag: string, source?: string): Promise<{ success: boolean }>

// ConfigKey 新增
'favouriteTagHighlight'

// ConfigValueMap 新增
favouriteTagHighlight: boolean
```

### Electron main.ts

在 `registerDownloadHandlers`（或新建 `registerFavouriteTagHandlers`）中注册三个 IPC handler，包含参数校验。

### preload.ts

在 `HcomicAPI` 实现中暴露三个新方法，调用对应的 IPC channel。

### useIpc.ts

新增 `useFavouriteTags()` hook：

```typescript
export function useFavouriteTags() {
  const { invoke } = useIpc()
  const getFavouriteTags = useCallback(async (source?: string) => { ... }, [invoke])
  const syncFavouriteTags = useCallback(async (source?: string) => { ... }, [invoke])
  const removeFavouriteTag = useCallback(async (tag: string, source?: string) => { ... }, [invoke])
  return { getFavouriteTags, syncFavouriteTags, removeFavouriteTag }
}
```

## 第三节：前端设置页 + 状态管理

### Settings Store 扩展

`useSettingsStore` 新增：

```typescript
favouriteTagHighlight: boolean  // 默认 false
setFavouriteTagHighlight: (enabled: boolean) => void
```

通过 `setConfig('favouriteTagHighlight', value)` 持久化。后端 `config.py` 需要识别这个 key。

### 新增设置组件

`src/components/settings/FavouriteTagSettings.tsx`，独立设置卡片：

1. **开关**："推荐标签高亮"，默认关闭，对应 `favouriteTagHighlight`
2. **推荐 tag 列表**：调用 `getFavouriteTags('hcomic')` 加载，按频率降序显示为标签气泡（tag 名称 + 出现次数）
3. **删除按钮**：每个 tag 气泡上有 × 按钮，调用 `removeFavouriteTag` 后刷新列表
4. **同步按钮**："从收藏夹同步标签"，调用 `syncFavouriteTags('hcomic')`，显示同步数量
5. **空状态**：当列表为空时显示"请先同步收藏夹数据以生成推荐标签"

### SettingsPage 集成

`SECTIONS` 数组新增：

```typescript
{ id: 'favourite-tags', label: '推荐标签', icon: '⭐' }
```

位于"标签过滤"之后。对应区域渲染 `<FavouriteTagSettings />`。

## 第四节：搜索页高亮

### 数据加载

SearchPage 在 `favouriteTagHighlight` 开启且 `source === 'hcomic'` 时，调用 `getFavouriteTags('hcomic')` 获取推荐 tag 列表，存入组件 state。

### 计算逻辑

```typescript
const recommendedTags = useMemo(() => {
  if (!favouriteTagHighlight || source !== 'hcomic') return new Set<string>()
  return new Set(favTags.map(t => t.tag.toLowerCase()))
}, [favouriteTagHighlight, source, favTags])

const filteredComics = useMemo(() => {
  return comics.map(c => ({
    comic: c,
    isBlocked: /* 现有逻辑 */,
    isRecommended: !isBlocked && (c.tags?.some(t => recommendedTags.has(t.toLowerCase())) ?? false)
  }))
}, [comics, filterEnabled, tagBlacklist, source, recommendedTags])
```

`isBlocked` 优先级高于 `isRecommended`。

### ComicCard 扩展

`ComicCardProps` 新增 `isRecommended?: boolean` 和 `recommendedTags?: Set<string>`。

**CoverCard 模式**：
- 推荐卡片加琥珀色左边框 `border-l-2 border-l-amber-400/70`
- 轻微背景色 `bg-amber-50/5`（亮色）/ `bg-amber-900/5`（暗色，通过 CSS 变量适配）

**DetailedCard 模式**：
- 同样的左边框 + 轻微背景色
- 匹配到的 tag 气泡用琥珀色 `bg-amber-500/15 text-amber-600` 替代默认 accent 色
- 未匹配的 tag 保持原样

**ComicInfoDrawer**：不做推荐高亮，保持功能纯粹。

### 性能

`recommendedTags` 为 `Set<string>`，`isRecommended` 计算为 O(tags_per_comic)，对搜索结果页（通常 20-30 条）无压力。

## 范围与 TODO

- **本期**：hcomic 源完整实现
- **TODO**：jmcomic 源支持（后端已通过 source 参数预留，前端需在 `FavouriteTagSettings` 和 `SearchPage` 中添加 jmcomic 逻辑）
