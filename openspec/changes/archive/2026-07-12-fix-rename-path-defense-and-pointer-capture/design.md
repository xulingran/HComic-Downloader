## Context

本次变更修复审查发现的两个缺陷，分属后端路径安全与前端交互稳定性：

1. **rename 路径缺少防御纵深**：`_rename_library_asset`（`python/ipc/library_mixin.py:582-583`）构造 `new_abs_path` 后未调用 `_validate_path_in_dir` 或等价边界检查，仅依赖正则 `re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", new_name)` 清洗。对比 reveal/delete 路径的 `_resolve_asset_path` 三重校验（realpath + `startswith(root + os.sep)` + size/mtime），rename 是唯一缺口。此外 rename 失败时 `raise ValueError(f"重命名失败，已回滚: {e}")`（line 619）会把 OS 错误（可能含完整磁盘路径）透传渲染进程。

2. **pointer capture 卸载泄漏**：`useSliderDrag`（`src/hooks/useSliderDrag.ts:36`）调用 `setPointerCapture`，但无卸载 cleanup。keep-alive 场景下 modal 因 store 驱动退场时滑块 DOM 卸载，捕获不释放、`isDraggingRef` 停留 true，重挂载后新滑块无法获得 pointer 事件。

约束：两者都是现有功能的加固，不引入新 API，不改变正常路径行为。

## Goals / Non-Goals

**Goals**
- rename 目标路径在磁盘操作前必须经 realpath 边界校验，与 reveal/delete 一致。
- rename 失败消息不透传内部 OS 路径，仅返回固定语义消息，详情进 logger。
- `useSliderDrag` 卸载时释放 pointer capture 并复位拖拽态，保证 keep-alive 重挂载可正常交互。

**Non-Goals**
- 不改动 rename 的正则清洗规则、保留名检查、版本号/历史回滚逻辑。
- 不扩展 reveal token TTL 清理、delete token 锁主动清扫（属于审查发现的其他 High/Medium，本次不合入）。
- 不改变 `useSliderDrag` 的拖拽语义、pointerdown/move/up 事件绑定方式。

## Decisions

### D1: rename 校验采用 realpath + 边界断言，而非白名单字符集

**选择**：构造 `new_abs_path` 后 `resolved = os.path.realpath(new_abs_path)`，断言 `resolved == root or resolved.startswith(root + os.sep)`。

**理由**：这是 reveal/delete 已采用的 `_resolve_asset_path` 范式（`library_mixin.py:814-846`），复用同一心智模型而非引入新的「字符集白名单」会让安全边界统一、可审计。正则清洗仍保留作为「输入规范化」层（处理合法文件名中的非法字符），realpath 断言作为「结果边界」层，两者职责分离。

**替代方案**：(a) 改用更严格的字符白名单 `[A-Za-z0-9._- ]` 拒绝其他字符——会误伤中日韩标题等合法字符，拒绝面过大；(b) 调用 `_validate_path_in_dir(new_abs_path, root)`——可行，但该方法签名接收已是 root 的参数，rename 这里 root 来自 `self.config.download_dir`，需先 realpath。最终选择直接内联 realpath 断言 + 复用现有 `_validate_path_in_dir` 做双重保险。

### D2: 同名重命名（目标 == 源）显式拒绝

**选择**：realpath 校验后额外比较 `resolved == os.path.realpath(real_path)`，相等则拒绝。

**理由**：当前 `os.path.exists(new_abs_path)` 对「重命名为自身」会返回 true 从而报「目标名称已存在」，但错误消息语义不准确（实际不是冲突）。显式拒绝并返回语义正确的「新名称与原名相同」更利于前端展示。

### D3: pointer capture 用 ref 记录 pointerId，卸载时按记录释放

**选择**：新增 `pointerIdRef` 在 pointerdown 时记录 `e.pointerId`；卸载 cleanup effect 读取该 ref，若 `isDraggingRef.current && sliderRef.current` 则 `try { releasePointerCapture(pointerIdRef.current) } catch {}`，并复位 `isDraggingRef`/`isDragging`/`dragPageRef`。空依赖数组（只在卸载跑一次）。

**理由**：pointerdown 的 `e.currentTarget` 在卸载时已不可用（React 合成事件 currentTarget 被回收），必须用 `sliderRef.current`（持久 DOM 引用）。pointerId 必须记录是因为 release 需要匹配 id。用 try/catch 包裹是因为卸载时元素可能已被浏览器释放捕获，release 抛异常不应阻断卸载。

**替代方案**：(a) 用 `pointercancel` 事件监听——不能覆盖「组件卸载」场景（无 cancel 事件触发）；(b) 在 `useReaderProgressNavigation` 卸载时调 `cancelDrag()`——`cancelDrag` 不释放 capture，治标不治本，且耦合到调用方。选择在 hook 内部自治。

## Risks / Trade-offs

- [realpath 在 Windows 上可能因大小写/短路径归一化导致 `startswith` 误判] → 与现有 `_resolve_asset_path` 使用完全相同的 `root = os.path.realpath(...)` + `startswith(root + os.sep)` 表达式，风险等同既有已验证代码。
- [卸载 cleanup 的 `releasePointerCapture` 在元素已脱离 DOM 时抛 `InvalidStateError`] → try/catch 吞掉并复位状态，副作用仅是日志级。
- [拒绝同名重命名可能影响「重复提交相同新名称」的合法场景] → 极罕见，且前端应禁用提交按钮；拒绝比误导性「已存在」更好。

## Migration Plan

纯代码加固，无数据/配置迁移。回滚策略：revert 单个 commit 即可，无副作用。

## Open Questions

无。两个修复的目标行为已由 design 决策完全确定。
