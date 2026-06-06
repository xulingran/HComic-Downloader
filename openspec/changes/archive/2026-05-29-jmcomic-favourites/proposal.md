## 为什么

当前收藏夹功能仅支持 hcomic 来源，jmcomic 虽然已作为数据源集成，但其收藏夹功能是空实现。用户无法在 jmcomic 中查看、添加或管理收藏夹，这限制了多源应用的实用性。

## 变更内容

- **新增** jmcomic 收藏夹查看功能（分页浏览）
- **新增** jmcomic 收藏状态检查功能
- **新增** jmcomic 添加/移除收藏功能
- **修改** 收藏夹页面 UI，添加来源选择器
- **修改** IPC 接口，支持 source 参数传递

## 功能 (Capabilities)

### 新增功能

- `jmcomic-favourites`: jmcomic 收藏夹查看功能，包括分页解析、登录状态检测
- `jmcomic-favourite-management`: jmcomic 收藏状态检查、添加和移除功能

### 修改功能

<!-- 现有功能，其需求发生变更 -->

## 影响

- **后端**: `sources/jmcomic/parser.py`, `sources/__init__.py`, `python/ipc/search_mixin.py`
- **前端**: `shared/types.ts`, `electron/preload.ts`, `electron/main.ts`, `src/hooks/useIpc.ts`, `src/pages/FavouritesPage.tsx`
- **API**: `getFavourites`, `addToFavourites`, `checkFavourite`, `removeFromFavourites` 接口需要添加 source 参数
