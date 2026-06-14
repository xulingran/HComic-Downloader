## 1. 后端 Parser 实现

- [x] 1.1 在 JmParser 中实现 `favourites()` 方法，解析收藏夹页面 HTML
- [x] 1.2 在 JmParser 中实现 `add_to_favourites()` 方法
- [x] 1.3 在 JmParser 中实现 `check_favourite()` 方法
- [x] 1.4 在 JmParser 中实现 `remove_from_favourites()` 方法

## 2. 后端 MultiSourceParser 更新

- [x] 2.1 更新 `source_supports_favourites()` 支持 jmcomic
- [x] 2.2 更新 `favourites()` 方法传递 source 参数
- [x] 2.3 更新 `add_to_favourites()` 方法支持 jmcomic
- [x] 2.4 更新 `check_favourite()` 方法支持 jmcomic
- [x] 2.5 更新 `remove_from_favourites()` 方法支持 jmcomic

## 3. 后端 IPC Server 更新

- [x] 3.1 更新 `handle_get_favourites()` 支持 source 参数
- [x] 3.2 更新 `handle_add_to_favourites()` 支持 source 参数
- [x] 3.3 更新 `handle_check_favourite()` 支持 source 参数
- [x] 3.4 更新 `handle_remove_from_favourites()` 支持 source 参数

## 4. Electron IPC Bridge 更新

- [x] 4.1 更新 `preload.ts` 中 `getFavourites` 支持 source 参数
- [x] 4.2 更新 `preload.ts` 中 `addToFavourites` 支持 source 参数
- [x] 4.3 更新 `preload.ts` 中 `checkFavourite` 支持 source 参数
- [x] 4.4 更新 `preload.ts` 中 `removeFromFavourites` 支持 source 参数
- [x] 4.5 更新 `main.ts` 中对应的 IPC handler

## 5. 前端类型和 Hooks 更新

- [x] 5.1 更新 `shared/types.ts` 中 `HcomicAPI` 接口添加 source 参数
- [x] 5.2 更新 `src/hooks/useIpc.ts` 中相关 hooks 支持 source 参数

## 6. 前端 UI 更新

- [x] 6.1 更新 `FavouritesPage.tsx` 添加源选择器 UI
- [x] 6.2 更新 `FavouritesPage.tsx` 的 `loadFavourites` 函数传递 source 参数
- [x] 6.3 更新 `useFavouritesStore` 支持多源缓存
