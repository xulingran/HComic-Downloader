# ComicReaderModal 滑入滑出动画 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为漫画阅读器模态窗口添加打开时从下方滑入、关闭时向下滑出的动画

**Architecture:** 在 ComicReaderModal 组件内复用 ComicInfoDrawer 的 `mounted` + `visible` 双状态模式，通过 CSS `transform: translateY` transition 实现垂直滑入滑出，外层添加半透明遮罩淡入淡出

**Tech Stack:** React 18, TypeScript, Tailwind CSS

---

## 文件结构

- **Modify:** `src/components/ComicReaderModal.tsx` — 添加动画状态管理 + 重构 JSX 结构

总计修改 1 个文件，不涉及任何其他文件变更。

---

### Task 1: 添加动画状态和生命周期管理

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

- [ ] **Step 1: 添加 mounted/visible 状态和动画控制逻辑**

在组件内部，`const [zoom, setZoom] = useState(1)` 之后（约第 35 行附近）插入以下代码：

```tsx
const [mounted, setMounted] = useState(false)
const [visible, setVisible] = useState(false)

useEffect(() => {
  if (open) {
    setMounted(true)
    requestAnimationFrame(() => setVisible(true))
  } else {
    setVisible(false)
  }
}, [open])

const handleTransitionEnd = useCallback(() => {
  if (!visible) {
    setMounted(false)
  }
}, [visible])
```

- [ ] **Step 2: 将 `if (!open) return null` 替换为 `if (!mounted) return null`**

找到第 154 行的 `if (!open) return null`，改为：

```tsx
if (!mounted) return null
```

- [ ] **Step 3: 运行 TypeScript 类型检查**

```bash
npx tsc --noEmit src/components/ComicReaderModal.tsx
```

预期：无类型错误（`useCallback` 已在文件头部导入，`useState` 和 `useEffect` 也已导入）。

- [ ] **Step 4: 提交**

```bash
git add src/components/ComicReaderModal.tsx
git commit -m "feat: 为 ComicReaderModal 添加动画状态管理逻辑"
```

---

### Task 2: 重构 JSX 结构，添加遮罩层和滑动动画

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

- [ ] **Step 1: 替换外层 div 为双层结构**

找到 `return` 语句中的外层 div（约第 190 行）：

```tsx
<div className="fixed inset-0 z-50 flex flex-col bg-[#1a1a2e]">
```

替换为遮罩层 + 滑动内容层的双层结构：

```tsx
<div className="fixed inset-0 z-50">
  {/* 半透明遮罩层，点击可关闭 */}
  <div
    className={`absolute inset-0 bg-black transition-opacity duration-300 ${
      visible ? 'opacity-50' : 'opacity-0'
    }`}
    onClick={onClose}
  />
  {/* 模态内容层，垂直方向滑入滑出 */}
  <div
    onTransitionEnd={handleTransitionEnd}
    className={`absolute inset-0 flex flex-col bg-[#1a1a2e] transition-transform duration-300 ease-out ${
      visible ? 'translate-y-0' : 'translate-y-full'
    }`}
  >
```

- [ ] **Step 2: 闭合新增的内层 div**

找到原来的最外层 `</div>` 结束标签（约第 484 行，即 `}` 之前），在 Header、Content、Footer 结构之后，添加内层 div 的闭合标签：

```tsx
  </div>
</div>
```

完整结构变为：

```tsx
return (
  <div className="fixed inset-0 z-50">
    <div className={`absolute inset-0 ...`} onClick={onClose} />
    <div onTransitionEnd={handleTransitionEnd} className={`absolute inset-0 ...`}>
      {/* Header */}
      {/* Content */}
      {/* Footer */}
      {/* settings panel */}
    </div>
  </div>
)
```

- [ ] **Step 3: 运行 TypeScript 类型检查**

```bash
npx tsc --noEmit src/components/ComicReaderModal.tsx
```

预期：无类型错误。

- [ ] **Step 4: 运行构建验证**

```bash
npx vite build
```

预期：构建成功，无错误。

- [ ] **Step 5: 提交**

```bash
git add src/components/ComicReaderModal.tsx
git commit -m "feat: 为 ComicReaderModal 添加遮罩层和滑动动画 CSS"
```

---

## 自检清单

### Spec 覆盖
- [x] 打开动画：从下方滑入（translateY 100% → 0） — Task 2
- [x] 关闭动画：向下滑出（translateY 0 → 100%） — Task 2
- [x] 半透明遮罩淡入淡出 — Task 2 (bg-black opacity transition)
- [x] mounted + visible 双状态 — Task 1
- [x] requestAnimationFrame 触发入场动画 — Task 1
- [x] onTransitionEnd 卸载 DOM — Task 1
- [x] 仅修改 ComicReaderModal.tsx — 整个计划

### 占位符检查
无 TBD、TODO 或模糊描述。每一步都包含具体代码。

### 类型一致性
- `mounted`, `visible`: `useState<boolean>` ✓
- `handleTransitionEnd`: `useCallback` 返回 `() => void` ✓
- `onTransitionEnd` 绑定在滑动 div 上 ✓
- 动画参数：`duration-300 ease-out` 与 spec 一致 ✓
