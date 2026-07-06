## 新增需求

### 需求:漫画卡片点击分发必须为每个区域定义明确动作且禁止死区

漫画卡片（`ComicCard`，含 `CoverCard` 封面模式与 `DetailedCard` 详细列表模式）将卡片划分为多个点击区域：封面区、标题区、body 区（即未命中封面/标题/下载按钮/批量勾选的容器区域）、下载按钮、批量勾选。每个区域**必须**有明确的点击动作，**禁止**存在点击后静默无响应的死区。

各区域的默认点击路由**必须**如下：
- **封面区**：批量模式 → `onToggleSelect`；非批量模式 → 打开阅读器（`onOpenReader`，受 SFW 模式约束）。
- **标题区**：批量模式 → `onToggleSelect`；非批量模式 → 打开详情抽屉（`onOpenDrawer`）。
- **body 区**：批量模式 → `onToggleSelect`；非批量模式 → 打开详情抽屉（`onOpenDrawer`）。
- **下载按钮**：触发 `onDownload`，且**必须** `stopPropagation` 不冒泡到容器。
- **批量勾选**：触发 `onToggleSelect`。

#### 场景:非批量模式下点击卡片 body 必须打开详情抽屉

- **当** 渲染一张非批量模式的 `ComicCard`，且仅传入了 `onOpenReader`（未传 `onClick`，这是 `SearchPage`/`FavouritesPage`/`HistoryPage` 的真实用法）
- **并且** 用户点击卡片 body 区（即标题文字周围的 padding 区、作者文字、卡片边缘——任何未命中封面、标题、下载按钮的区域）
- **那么** **必须**调用 `onOpenDrawer` 打开详情抽屉
- **并且** **禁止**静默无响应（既不开阅读器、也不开抽屉、也不报错）

#### 场景:非批量模式下点击卡片 body 在传入了 onClick 时仍优先 onClick

- **当** 渲染一张非批量模式的 `ComicCard`，且同时传入了 `onClick` 与 `onOpenReader`
- **并且** 用户点击卡片 body 区
- **那么** **必须**调用 `onClick`（保持现有 `onClick` 优先语义）
- **并且** **禁止**调用 `onOpenDrawer`（`onClick` 存在时它仍是 body 的主路由，抽屉仅作 fallback）

#### 场景:批量模式下点击卡片 body 必须切换选择

- **当** 渲染一张批量模式的 `ComicCard`
- **并且** 用户点击卡片 body 区
- **那么** **必须**调用 `onToggleSelect` 切换该卡片的选中态
- **并且** **禁止**打开详情抽屉或阅读器

#### 场景:封面区点击路由不受 body 回退影响

- **当** 渲染一张非批量模式的 `ComicCard`
- **并且** 用户点击封面区
- **那么** **必须**触发封面区原有路由（非 SFW 时打开阅读器，SFW 模式下保持现有行为）
- **并且** **禁止**因 body 回退逻辑而改走 `onOpenDrawer`（封面区与 body 区是互斥的独立区域）

#### 场景:标题区点击路由不受 body 回退影响

- **当** 渲染一张非批量模式的 `ComicCard`
- **并且** 用户点击标题区（`<h3>` 标题元素）
- **那么** **必须**调用 `onOpenDrawer` 打开详情抽屉（保持标题区原有路由）
- **并且** 该点击**必须** `stopPropagation` 不冒泡到容器，避免重复触发

#### 场景:下载按钮点击必须 stopPropagation 不冒泡到 body

- **当** 渲染一张非批量模式的 `ComicCard` 且传入了 `onDownload`
- **并且** 用户点击下载按钮
- **那么** **必须**触发 `onDownload`
- **并且** **必须** `stopPropagation` 不冒泡到容器（避免同时触发 body 回退打开抽屉）

### 需求:detailed 列表模式下 body 回退必须覆盖整行非交互区

`DetailedCard`（详细列表模式）下，整行除封面缩略图（`w-14 h-14`）、标题、tag pill、下载按钮外的区域（包括作者文字、页数/章数文字、行 padding、行边缘）均属 body 区。非批量模式下点击这些区域**必须**回退到打开详情抽屉，**禁止**静默无响应。

#### 场景:detailed 模式下点击作者/页数文字必须打开抽屉

- **当** 渲染一张非批量模式的 `DetailedCard`
- **并且** 用户点击作者文字或"页数/章数"副标题文字（这些元素本身无独立 handler）
- **那么** **必须**调用 `onOpenDrawer` 打开详情抽屉
- **并且** **禁止**静默无响应
