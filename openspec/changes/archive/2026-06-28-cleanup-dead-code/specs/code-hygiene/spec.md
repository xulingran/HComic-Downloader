## 新增需求

本次变更不引入任何新功能，不修改任何对外规范级行为，因此无新增需求。

## 修改需求

无。本次为纯代码卫生清理（删除零引用死代码、合并逐行同构的重复实现、修正同名异值常量），所有变更均保持运行时行为等价，不改变任何对外契约（IPC 通道、CBZ 格式、ComicInfo.xml schema、配置文件结构、错误消息文案、返回结构、异常类型）。

## 移除需求

无。本次删除的死代码均不属于任何已定义的规范需求——

- `is_image_file` / `HealthCheckKind` / config_mixin 死分支：未被任何现有 spec 引用（`maintenance-scanner`、`health-check` specs 描述的是扫描/校验行为，不依赖这些内部符号）
- `standardTransition` / `createPresenceVariants` / `pageFlipTransition` / 导出的 `STAGGER_LIMIT`：未被任何动画 spec 引用（`ui-animation` 描述的是 reduced-motion 兜底与 duration/easing 令牌，不依赖这些具体 variant 工厂或常量）
- login handler / 打开目录 handler / 黑名单校验器 / 收藏夹去重 / auth 关键字检查的合并：属内部实现重构，对应 spec（`auth`、`moeimg-login`、`duplicate-detector`、`missing-chapter-detector`、`cache-directory-access`）描述的行为不变

因此无需在此声明移除需求。
