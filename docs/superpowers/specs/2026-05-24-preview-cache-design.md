# 预览页面图片持久缓存及缓存管理

## 概述

目前封面图已有基于 SQLite 的持久缓存（`CoverCacheDB`），但漫画预览页面图片（阅读器内显示的大图）没有持久缓存，每次打开漫画都重新从网络获取。本次设计新增预览页面图片的持久缓存，并在设置界面中提供缓存统计、大小限制和清理功能。

## 存储架构

采用混合存储模式：文件系统存图片二进制 + SQLite 存元数据索引。与封面缓存类似，由 Python 后端统一管理。

### 文件布局

```
~/.hcomic_downloader/
├── cover_cache.db          # 已有：封面缓存 SQLite
├── preview_cache.db        # 新增：预览缓存元数据 SQLite
├── preview_cache/          # 新增：预览图片二进制文件目录
│   ├── a1b2c3d4...         # 文件名为 URL 的 SHA256 前 32 位
│   └── ...
└── config.json             # 已有：配置（新增 previewCacheSizeLimitMB 字段）
```

### SQLite 表结构

```sql
CREATE TABLE preview_cache (
    url_hash    TEXT PRIMARY KEY,   -- SHA256(url) 前 32 位
    url         TEXT NOT NULL,      -- 原始图片 URL
    file_path   TEXT NOT NULL,      -- preview_cache/ 下的相对文件名
    size        INTEGER NOT NULL,   -- 文件字节数
    fetched_at  REAL NOT NULL,      -- 首次获取时间戳
    last_access REAL NOT NULL       -- 最后访问时间戳（LRU 驱逐依据）
);
CREATE INDEX idx_preview_last_access ON preview_cache(last_access);
CREATE INDEX idx_preview_url ON preview_cache(url);
```

## Python 后端：PreviewCacheDB

遵循 `CoverCacheDB` 的现有模式。

### 核心方法

| 方法 | 功能 |
|---|---|
| `__init__(max_size_mb)` | 初始化目录和表，加载 LRU 索引到内存 `OrderedDict` |
| `get(url)` | 查缓存，命中则更新 `last_access`，返回文件路径 |
| `put(url, image_bytes)` | 写入文件 + 插入 SQLite；超限则触发 LRU 驱逐 |
| `evict_lru(needed_bytes)` | 按 `last_access` 升序删除文件及记录，直到释放足够空间 |
| `get_stats()` | 返回 `{file_count, total_size_bytes, max_size_bytes}` |
| `clear_all()` | 删除所有缓存文件及 SQLite 记录 |
| `update_max_size(mb)` | 运行时更新上限，若当前超出则触发驱逐 |

### 线程安全

使用 `threading.Lock` 保护所有读写。图片获取通过 `_preview_executor` 线程池异步执行。

### PreviewMixin 改造

`fetch_preview_image` 增加缓存查询：

1. 查 `PreviewCacheDB.get(url)` → 命中则直接读取文件内容并返回 data URI
2. 未命中 → HTTP 获取图片
3. 写入 `PreviewCacheDB.put(url, image_bytes)`
4. 返回 base64 data URI

返回格式不变（`{dataUri: "data:image/...;base64,..."}`），前端无需感知缓存层。

### 配置扩展

`config.json` 新增字段：
```json
{
  "previewCacheSizeLimitMB": 500
}
```

## IPC 通道

### 新增通道

```
GET_CACHE_STATS:      'python:get-cache-stats'      → 汇总封面+预览缓存统计
CLEAR_PREVIEW_CACHE:  'python:clear-preview-cache'   → 仅清预览缓存
CLEAR_ALL_CACHE:      'python:clear-all-cache'       → 清封面+预览缓存
```

`FETCH_PREVIEW_IMAGE` 通道不变，Python 端内部自动处理缓存逻辑。

### 返回值类型

```typescript
interface CacheStats {
  cover:   { file_count: number; total_size_bytes: number }
  preview: { file_count: number; total_size_bytes: number }
  total:   { file_count: number; total_size_bytes: number }
}
```

### 全链路

```
CacheSettings → window.hcomic!.getCacheStats()
  → preload.ts: ipcRenderer.invoke('python:get-cache-stats')
    → main.ts: ipcMain.handle → bridge.call('get_cache_stats')
      → Python: handle_get_cache_stats()
        → CoverCacheDB.get_stats() + PreviewCacheDB.get_stats()
```

## 前端：CacheSettings 组件

### 位置

`src/components/settings/CacheSettings.tsx`，嵌入 `SettingsPage.tsx`，放在「通知设置」和「迁移」之间。

### UI 布局

```
┌─ 缓存管理 ────────────────────────────────────────┐
│                                                     │
│  封面缓存           120 张          ≈ 45.2 MB       │
│  预览缓存           89 张           ≈ 230.8 MB      │
│  ────────────────────────────────────               │
│  合计               209 张          ≈ 276.0 MB      │
│                                                     │
│  缓存上限                              500 MB       │
│  [━━━━━━━━━━━━━━●──────────────────]  数字输入框     │
│                                                     │
│  [清除预览缓存]                    [清除全部缓存]     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 组件状态

| 状态 | 类型 | 来源 |
|---|---|---|
| `cacheStats` | `CacheStats \| null` | 挂载时及每次清理后通过 `getCacheStats()` 获取 |
| `sizeLimitMB` | `number` | 从 `getConfig('previewCacheSizeLimitMB')` 读取，默认 500 |
| `clearing` | `'preview' \| 'all' \| null` | 清理中状态，控制按钮 loading |

### 交互行为

| 操作 | 行为 |
|---|---|
| 进入设置页面 | 自动调用 `getCacheStats()` 刷新统计 |
| 拖动滑块 / 输入数字 | 防抖 500ms 后调用 `setConfig('previewCacheSizeLimitMB', value)` 持久化 |
| 点击「清除预览缓存」 | 弹出确认对话框，确认后调用 `clearPreviewCache()`，刷新统计 |
| 点击「清除全部缓存」 | 弹出确认对话框，确认后调用 `clearAllCache()`，刷新统计 |

### 滑块参数

- 范围：100 MB - 2048 MB（2 GB）
- 步长：50 MB
- 输入框支持手动输入精确值，与滑块双向同步

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `python/ipc/preview_cache.py` | **新增** | `PreviewCacheDB` 类 |
| `python/ipc/preview_mixin.py` | 修改 | `fetch_preview_image` 增加缓存读写 |
| `python/ipc/cover_cache.py` | 修改 | `CoverCacheDB` 新增 `get_stats()`、`clear_all()` 方法 |
| `python/ipc_server.py` | 修改 | 注册新 IPC 处理方法 |
| `shared/types.ts` | 修改 | 新增 `IPC_CHANNELS` 常量和 `CacheStats` 类型 |
| `electron/main.ts` | 修改 | 注册新 IPC handler |
| `electron/preload.ts` | 修改 | 暴露新 API 方法 |
| `src/components/settings/CacheSettings.tsx` | **新增** | 缓存管理设置组件 |
| `src/pages/SettingsPage.tsx` | 修改 | 嵌入 `CacheSettings` 组件 |
| `config.py` | 修改 | 配置模型新增 `previewCacheSizeLimitMB` 字段 |

## 错误处理

- 缓存读取失败：静默回退到网络获取，不影响阅读体验
- 缓存写入失败：记录日志，不阻塞图片返回
- 磁盘空间不足：`put()` 失败时触发 LRU 驱逐后重试一次，仍失败则跳过缓存
- SQLite 错误：捕获异常，返回空统计（不影响阅读功能）
- 清理操作失败：返回 `{success: false}`，前端显示错误 toast
