# moeimg 登录与收藏夹功能设计文档

## 上下文

当前项目是一个多源漫画下载器，支持 hcomic、moeimg、jmcomic 三个来源。收藏夹功能目前仅在 hcomic 和 jmcomic 中实现。moeimg 的收藏夹是空实现（返回空列表）。

moeimg.fan 已经集成到项目中，包括搜索、详情解析等基本功能。本次变更需要为其添加登录和收藏夹管理能力。

经分析，moeimg.fan 的 API 特点：
- 登录：`POST /auth/login`（multipart/form-data），返回 `{"success":1}` + `__SESSION` cookie
- 收藏状态检查：`GET /ajax/bookmark-status/{manga_id}` → `{"status":1}` 或 `{"status":-1}`
- 收藏切换：`GET /ajax/bookmark/{manga_id}` → toggle 模式（同一接口添加/移除）
- 收藏列表：`GET /member/bookmarks?page=N` → 服务端渲染 HTML（非 JSON API）
- 无浏览登录页面：所有 `/auth/*`、`/login`、`/signin` 路径均返回 404

## 目标 / 非目标

**目标：**
- 为 moeimg 实现登录功能（用户名密码 + curl 粘贴）
- 为 moeimg 实现收藏夹查看功能（分页浏览）
- 为 moeimg 实现收藏状态检查、添加和移除功能

**非目标：**
- 浏览器弹窗登录（moeimg 无可浏览的登录页面）
- 跨源收藏夹同步
- 修改 moeimg 的搜索或下载功能

## 设计决策

### 1. 登录方式：用户名密码 + curl 粘贴

moeimg 没有可浏览的登录页面，因此不支持浏览器弹窗登录。采用两种方式：
- **用户名密码**：用户在设置页面输入凭据，存储在 config 中，通过 API 直接登录
- **curl 粘贴**：复用已有的 curl 解析逻辑，提取 `__SESSION` cookie

### 2. Session 管理：懒登录（Lazy Login）

- 在 config 中存储 moeimg 的用户名和密码
- 需要执行收藏操作时才调用登录 API，获取 `__SESSION` cookie 并缓存在内存中
- 如果 session 无效则使用存储的凭据自动重新登录

### 3. 收藏列表：HTML 解析

moeimg 的收藏列表是服务端渲染 HTML（非 JSON API），需要使用 BeautifulSoup 解析：
- 每个收藏项：`.u-fav-item` div
- manga_id：从 `.u-fav-btn a[data-manga-id]` 提取
- 标题：从 `.u-manga-title a` 的 `title` 属性
- 封面：从 `.u-img-holder img` 的 `src`
- 链接：从 `.u-img-holder a` 的 `href`（如 `/post/fa117560`）
- 分页：从 `.pagination` 区域解析

### 4. 收藏操作：toggle 模式

moeimg 的收藏 API 是 toggle 模式（`GET /ajax/bookmark/{id}` 既是添加也是移除）。为避免误操作：
- 添加前先检查状态，已收藏则跳过
- 移除前先检查状态，未收藏则跳过

## 风险 / 缓解

| 风险 | 缓解 |
|------|------|
| 收藏页面 HTML 结构可能变化 | 使用稳定的 CSS 选择器（`.u-fav-item`, `data-manga-id`） |
| Toggle API 可能导致误操作 | 先检查状态再操作 |
| Session 过期检测不准确 | 重试机制：清除 cookie 后重新登录再重试一次 |
| BeautifulSoup 可能未安装 | 在 requirements.txt 中添加依赖 |
