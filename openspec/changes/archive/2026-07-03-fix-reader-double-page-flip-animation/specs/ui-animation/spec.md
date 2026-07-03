## 修改需求

### 需求: 阅读器 single 与 double 模式必须使用横向滑动翻页过渡

当 displayMode 为 `single` 或 `double` 时，currentPage 变化**必须**触发横向滑动过渡：新页从相反方向滑入、旧页向用户离开方向滑出；过渡**必须**显式使用 `smoothTransition`（`DURATION.slow`，约 300ms，cubic-bezier(0.4, 0, 0.2, 1)），**禁止**省略 transition 导致 framer-motion 回退到会 overshoot 的默认 spring 曲线。普通动画路径的进入与退出端点**必须**完全透明（opacity 0），使旧页在滑出过程中同步淡出、动画结束时已不可见，**禁止**端点保留接近不透明的 opacity（如 0.92）导致旧页停在滑出终点仍清晰可见、被 framer-motion 卸载时表现为「突然消失」；中心状态保持完全不透明（opacity 1）。

#### 场景: single 模式向前翻页

- **当** 用户在 single 模式触发向前翻页（currentPage 增加，direction='forward'）
- **那么** 旧页向左滑出且 opacity 从 1 同步淡出到 0、新页从右滑入且 opacity 从 0 淡入到 1，使用约 300ms smooth 曲线，无 overshoot；旧页到达滑出终点时已完全透明，被卸载时无视觉跳变

#### 场景: single 模式向后翻页

- **当** 用户触发向后翻页（currentPage 减少，direction='backward'）
- **那么** 旧页向右滑出且 opacity 从 1 同步淡出到 0、新页从左滑入且 opacity 从 0 淡入到 1，使用约 300ms smooth 曲线，无 overshoot；旧页到达滑出终点时已完全透明，被卸载时无视觉跳变

#### 场景: double 模式两页整体滑动

- **当** 用户在 double 模式翻页
- **那么** 左右两页作为整体同时滑动（同一 transform），不出现撕裂

#### 场景: double 模式空白页参与过渡

- **当** double 模式且 blankPosition 为 front 或 end，翻页经过空白页位置
- **那么** 空白页（BlankPage）作为整体的一部分参与滑动，**禁止**半屏闪烁

#### 场景: 翻页 variants 显式声明 transition

- **当** 普通横向翻页 variants 被生成
- **那么** center 与 exit 变体显式包含 `smoothTransition`，**禁止**缺失 transition

#### 场景: 翻页端点完全透明避免卸载跳变

- **当** 普通横向翻页 variants 被生成（非 reduced-motion 路径）
- **那么** enter 与 exit 端点的 opacity 必须为 0，center 的 opacity 必须为 1，**禁止**端点使用接近 1 的 opacity（如 0.92）导致旧页停在滑出终点仍可见、卸载时突兀消失
