## 1. 后端配置更新

- [x] 1.1 在 `config.py` 的 `set_source_auth` 方法中支持 moeimg 的 `username` 和 `password` 字段
- [x] 1.2 更新 `utils.py` 的 `normalize_source_auth` 为 moeimg 补全 `username` 和 `password` 默认值
- [x] 1.3 确认 `beautifulsoup4` 已在 `requirements.txt` 中（HTML 解析依赖）

## 2. 后端 Parser 实现

- [x] 2.1 在 MoeImgParser 中实现 `login(username, password)` 方法，POST multipart 到 `/auth/login`，提取 `__SESSION` cookie
- [x] 2.2 在 MoeImgParser 中实现 `_ensure_session()` 懒登录方法
- [x] 2.3 改写 `verify_login_status()`，调用 `_ensure_session()` 后检查 `/member/bookmarks` 响应
- [x] 2.4 实现 `favourites(page)` 方法，解析收藏夹 HTML（BeautifulSoup + `.u-fav-item`）
- [x] 2.5 实现 `check_favourite(manga_id)` 方法，调用 `/ajax/bookmark-status/{id}`
- [x] 2.6 实现 `add_to_favourites(manga_id)` 方法，调用 `/ajax/bookmark/{id}`（toggle 模式，先检查状态）
- [x] 2.7 实现 `remove_from_favourites(manga_id)` 方法，调用 `/ajax/bookmark/{id}`（toggle 模式，先检查状态）

## 3. 后端 MultiSourceParser 更新

- [x] 3.1 更新 `source_supports_favourites()` 支持 moeimg
- [x] 3.2 更新 `favourites()` 方法支持 moeimg
- [x] 3.3 更新 `add_to_favourites()` 方法支持 moeimg
- [x] 3.4 更新 `check_favourite()` 方法支持 moeimg
- [x] 3.5 更新 `remove_from_favourites()` 方法支持 moeimg

## 4. 后端 IPC Server 更新

- [x] 4.1 在 `auth_mixin.py` 中新增 `handle_moeimg_login(username, password)` 方法
- [x] 4.2 在 `ipc_server.py` 中注册 `moeimg-login` IPC 命令
- [x] 4.3 更新 `handle_apply_auth` 支持 moeimg 的 curl 粘贴（提取 `__SESSION` cookie）

## 5. Electron IPC Bridge 更新

- [x] 5.1 在 `preload.ts` 中新增 `moeimgLogin(username, password)` 方法
- [x] 5.2 在 `main.ts` 中注册 `moeimg-login` IPC handler

## 6. 前端类型更新

- [x] 6.1 在 `shared/types.ts` 的 `HcomicAPI` 接口中添加 `moeimgLogin` 方法签名

## 7. 前端 UI 更新

- [x] 7.1 在 `AuthSettings.tsx` 中新增 moeimg 登录区块（用户名密码 + curl 粘贴）
- [x] 7.2 在 `SettingsPage.tsx` 中新增 `moeimgAuth = useAuthState('moeimg')`
