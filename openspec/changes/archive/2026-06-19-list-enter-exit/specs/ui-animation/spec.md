## 新增需求

> 本增量向 `ui-animation` capability 新增列表进出场与 layout 动画的行为契约。

### 需求: ComicCard 网格必须使用 framer-motion layout 动画实现进出场与位置过渡

搜索、收藏、历史页面的 ComicCard 网格**必须**用 framer-motion 的 `AnimatePresence` + `layout` prop 实现卡片进出场与位置变化过渡，**禁止**瞬间切换或跳变。

#### 场景: 搜索结果切换时卡片淡入上移

- **当** 用户执行新搜索或切换筛选，filteredComics 列表变化
- **那么** 新出现的卡片以 opacity 0→1 + y 8px→0 淡入上移，旧卡片淡出

#### 场景: cardStyle 切换时位置平滑过渡

- **当** 用户在 cover 与 detailed 卡片样式之间切换
- **那么** 卡片位置用 layout 动画平滑过渡，而非瞬间从 grid 跳变到 flex

#### 场景: 卡片被移除时剩余卡片归位

- **当** 某张卡片从列表中移除（如取消收藏、加入黑名单）
- **那么** 移除的卡片缩小淡出，剩余卡片用 layout 动画平滑归位

### 需求: 列表进出场 stagger 必须封顶前 20 项

ComicCard 网格的错峰进出场**必须**仅对前 20 项应用 stagger delay（每项约 20ms），第 21 项及之后**必须**立即出现（delay=0），**禁止**长列表全量 stagger 导致总时长过长。

#### 场景: 搜索返回 50 项时 stagger 封顶

- **当** 搜索返回 50 张卡片
- **那么** 仅前 20 张错峰出现（总时长约 400ms），第 21-50 张立即出现

### 需求: DownloadPage 任务列表必须支持任务进出场动画

下载管理页面的顶层任务项**必须**用 AnimatePresence + layout 实现进入（从顶部滑入）与退出（缩小淡出）动画，任务重排时位置变化**必须**平滑过渡。

#### 场景: 新任务进入时从顶部滑入

- **当** 一个新下载任务加入队列
- **那么** 该任务项从顶部滑入（y -8px→0 + opacity），其余任务用 layout 下移

#### 场景: 任务完成移除时缩小淡出

- **当** 一个任务从列表移除（完成清理或取消）
- **那么** 该任务项缩小（scale 1→0.9）+ 淡出，剩余任务用 layout 归位

### 需求: 列表动画必须在 reduced-motion 下退化为纯 opacity

当 `prefers-reduced-motion: reduce` 为真时，ComicCard 网格与 DownloadPage 任务列表的 layout 动画**必须**关闭，进出场退化为纯 opacity 淡入淡出，**禁止**产生位移或缩放。

#### 场景: reduced-motion 下卡片无位移

- **当** 用户启用「减少动画」且搜索结果切换
- **那么** 卡片仅 opacity 淡入淡出，无 y 位移、无 scale、无 layout 重排动画
