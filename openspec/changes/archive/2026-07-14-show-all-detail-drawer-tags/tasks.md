## 1. 标签完整展示实现

- [x] 1.1 修改 `ComicDetailSurface` 的标签渲染输入，使 drawer 与 reader 都渲染完整标签数组，不再按固定上限切片
- [x] 1.2 删除 drawer 标签折叠专属的展开状态、首次展开状态、漫画切换重置 effect，以及“+N 展开/收起”控件
- [x] 1.3 保留标签列表与标签项动画、reduced-motion、点击搜索、推荐/屏蔽和来源能力门控行为

## 2. 回归测试与验证

- [x] 2.1 更新 `ComicInfoDrawer` 组件测试，验证超过原上限时 drawer 全部标签立即可见且不存在展开/收起控件
- [x] 2.2 更新详情补全和漫画切换测试，验证新数据的全部标签可见且没有跨漫画残留
- [x] 2.3 保留并运行 reader、reduced-motion、固定操作区及标签交互相关回归测试
- [x] 2.4 运行 `npx tsc --noEmit`、目标 Vitest 测试和 `npm run lint`，确认类型、行为与代码质量检查通过
