## 新增需求

本次变更不引入任何新功能，不修改任何对外规范级行为，因此无新增需求。

## 修改需求

无。本次为纯代码卫生清理（删除死代码、合并冗余实现、清理散落工件），所有变更均保持运行时行为等价，不改变任何对外契约（IPC 通道、CBZ 格式、ComicInfo.xml schema、配置文件结构、对外 API）。

## 移除需求

无。本次删除的死代码均不属于任何已定义的规范需求（现有 specs：`diagnostics`、`duplicate-detector`、`error-display`、`logging`、`moeimg-bookmarks`、`moeimg-login` 均不受影响），因此无需在此声明移除需求。
