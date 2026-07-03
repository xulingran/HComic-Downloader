## 上下文

`PageFlipView`（`src/components/PageFlipView.tsx`）使用 framer-motion 的 `AnimatePresence mode="popLayout"` + 方向感知 variants（`getDirectionalPageVariants()`）实现翻页过渡：`<motion.div key={currentPage} custom={direction}>`，`direction` 决定退出页朝左（forward）还是朝右（backward）飞出。

当前实现把 `direction` 推断放在 `useEffect` 里：

```tsx
const prevPageRef = useRef(currentPage)
const [direction, setDirection] = useState('forward')

useEffect(() => {
  if (currentPage !== prevPageRef.current) {
    setDirection(currentPage > prevPageRef.current ? 'forward' : 'backward')
    prevPageRef.current = currentPage
  }
}, [currentPage])
```

**问题**：`useEffect` 在 DOM commit 之后才运行。当 `currentPage` 变化触发渲染时，本次提交里 `direction` 仍是上一帧的值，`AnimatePresence` 据此为退出页启动动画；待 effect 异步 `setDirection` 触发重渲染时，退出动画已经朝错误方向飞出。典型表现：先点「下一页」（forward）再点「上一页」（backward），旧页依旧向左滑出（应为向右）。该缺陷与「端点 opacity」无关，是独立的时序缺陷。

## 目标 / 非目标

**目标：**
- 让 `AnimatePresence` 在 `currentPage` 变化的**同一提交**里就拿到与 `key` 一致的 `direction`，消除「逆向连续翻页朝错误方向飞出」。
- 保留 `PageFlipView` 对外接口不变（`currentPage` / `setCurrentPage` / `onPageChange`），不要求调用方传入方向。
- 保留「每次翻页触发一次 `onPageChange`」与「首次挂载触发一次 `onPageChange`（驱动预加载初始化）」的原语义。
- 把方向推导逻辑抽成纯函数，单测可锁定连续逆向序列契约。

**非目标：**
- 不改动翻页 variants（`getDirectionalPageVariants`）、`smoothTransition`、端点 opacity（已在 `fix-reader-double-page-flip-animation` 修复）。
- 不改动翻页触发路径（键盘 / 点击 / wheel / 滑块都最终走 `setCurrentPage`，无需各路径单独传方向）。
- 不改动 `AnimatePresence` 的 `mode="popLayout"` / `initial={false}` 配置。
- 不引入新依赖。

## 决策

### 决策 1：方向推断采用 React「adjust state while rendering」模式

**选择**：在渲染期间用 state 比对 `currentPage` 与 `prevPage`，立即 `setDirection` + `setPrevPage`。

```tsx
const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
const [prevPage, setPrevPage] = useState(currentPage)

if (currentPage !== prevPage) {
  const inferred = inferPageDirection(currentPage, prevPage)
  if (inferred) setDirection(inferred)
  setPrevPage(currentPage)
}
```

**理由**：这是 React 官方推荐的「在渲染期间根据 props/state 调整内部 state」模式。React 检测到 state 变化会丢弃当前渲染输出并立即以新 state 重渲染，无可见副作用；state 稳定后条件为假，自动退出，无无限循环。`AnimatePresence` 的 `custom` 因此在 `currentPage` 变化的同一提交里就与 `key` 一致，退出页拿到正确方向。

**考虑过的替代方案**：

- **A. 保持 `useEffect` 推断**：根因所在，首次提交必然拿到 stale direction，不可行。
- **B. 渲染期间读 ref（`prevPageRef.current`）推断**：方向能同步，但违反 `eslint react-hooks/refs` 规则（ref 不应用于渲染输入），且 React 严格模式下 ref 在重渲染间可能不一致。被 lint 拦截。
- **C. 用 `useMemo` / 派生值代替 state**：`AnimatePresence` 的 `custom` prop 需要稳定引用且 variants 函数按它解析，派生方向可行但无法触发「丢弃输出重渲染」语义——因为方向是从 props 直接算出的，本提交就已正确。该方案与决策 1 等价但少一层 state，是次优备选。不选是因为 `onPageChange` 仍需 effect 触发，且 `prevPage` 作为 state 让「上次页码」语义更显式、可读性更好。

### 决策 2：`onPageChange` 改用独立 ref 触发

**选择**：新增 `lastNotifiedPageRef`（初始化为 `null`），在 `useEffect` 内比对 `currentPage !== lastNotifiedPageRef.current` 触发 `onPageChange`。

```tsx
const lastNotifiedPageRef = useRef<number | null>(null)
useEffect(() => {
  if (currentPage !== lastNotifiedPageRef.current) {
    lastNotifiedPageRef.current = currentPage
    onPageChange(currentPage)
  }
}, [currentPage, onPageChange])
```

**理由**：决策 1 在渲染期间已把 `prevPage` 追平为 `currentPage`，若仍用 `currentPage !== prevPage` 作 effect 触发条件则恒为假，`onPageChange` 永不触发。独立 ref 只在 effect 内读写、不参与渲染输入，安全通过 `react-hooks/refs` lint；初始化为 `null` 保留「首次挂载触发一次」语义（与原 `isFirstRender` 一致），让预加载器拿到初始页。

### 决策 3：抽出 `inferPageDirection` 纯函数

**选择**：导出 `inferPageDirection(current, previous): 'forward' | 'backward' | null`。

**理由**：把「方向推导」与「渲染时机」解耦。渲染时机由 React 模式保证，纯函数可被单测独立锁定——尤其是「next→prev 连续逆向序列」契约，无需依赖 jsdom 下 framer-motion 的动画帧行为（jsdom 不执行真实 transform 动画，DOM 断言不可靠）。

## 风险 / 权衡

- **[渲染期间 setState 触发重渲染开销]** → React 对「渲染期间 setState 同值」会自动 bailout（不提交），仅在 `currentPage` 真正变化时多一次空渲染，开销可忽略；翻页本身是低频用户操作。
- **[首次挂载 `onPageChange` 语义偏移]** → 用 `lastNotifiedPageRef` 初始 `null` 精确复刻原 `isFirstRender` 行为；已由现有 `PageFlipView` 测试与预加载链路覆盖。
- **[纯函数测试不覆盖真实 AnimatePresence custom 注入]** → 这是可接受的：variants 的 `custom` → transform 映射已由 `tests/unit/lib/anim.test.ts` 锁定（forward/backward 的 enter/exit x 值），本变更加上 `inferPageDirection` 的方向契约，两端组合即覆盖「方向正确 + 方向正确驱动正确 transform」。
- **[回滚]** → 改动集中在单文件 `PageFlipView.tsx` 与单测试文件，`git revert` 即可完整回滚；无数据/配置迁移。
