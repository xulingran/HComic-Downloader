# 双页模式空白页偏移功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在双页模式下，允许用户通过在前面或后面插入虚拟空白页来偏移页面配对，使跨页大图正确并排显示。

**Architecture:** 偏移逻辑集中在 `PageFlipView` 中，通过 `blankPosition` prop 控制。`ComicReaderModal` 管理瞬态状态并通过 prop 传递。不修改 `imageUrls` 数组，不影响缓存和预加载逻辑。

**Tech Stack:** React, TypeScript, vitest

---

### Task 1: 添加 BlankPosition 类型

**Files:**
- Modify: `src/hooks/useReaderSettings.ts:17`

- [ ] **Step 1: 在 DisplayMode 类型定义之后添加 BlankPosition 类型**

在 `src/hooks/useReaderSettings.ts` 第 17 行（`export type DisplayMode = ...` 之后）添加：

```typescript
export type BlankPosition = 'none' | 'front' | 'end'
```

- [ ] **Step 2: 验证类型导出**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useReaderSettings.ts
git commit -m "feat: add BlankPosition type for double-page blank page offset"
```

---

### Task 2: 更新 PageFlipView — 偏移逻辑与空白页渲染

**Files:**
- Modify: `src/components/PageFlipView.tsx`

这是核心逻辑变更，包含 props 接口、索引计算、导航边界、空白页渲染。

- [ ] **Step 1: 更新 Props 接口和导入**

在 `src/components/PageFlipView.tsx` 顶部导入 `BlankPosition`，并在 `PageFlipViewProps` 接口中添加 `blankPosition` prop。

文件顶部（第 2 行）修改导入：

```typescript
import type { DisplayMode, BlankPosition } from '../hooks/useReaderSettings'
```

在 `PageFlipViewProps` 接口中（第 14 行 `onPageChange` 之后）添加：

```typescript
  blankPosition: BlankPosition
```

- [ ] **Step 2: 解构 blankPosition 并计算 effectiveTotalPages**

在组件函数体内，解构 `blankPosition`（约第 28 行）：

```typescript
  blankPosition,
```

在 `isDoubleMode` 和 `step` 定义之后（约第 35 行后）添加 `effectiveTotalPages` 计算：

```typescript
  const effectiveTotal = isDoubleMode && blankPosition === 'front' ? totalPages + 1 : totalPages
```

- [ ] **Step 3: 更新 canGoNext 使用 effectiveTotal**

将 `canGoNext`（约第 38-40 行）改为：

```typescript
  const canGoNext = isDoubleMode
    ? currentPage + step <= effectiveTotal
    : currentPage < effectiveTotal
```

- [ ] **Step 4: 更新 goNext 使用 effectiveTotal**

将 `goNext` 回调（约第 42-47 行）中的 `totalPages` 替换为 `effectiveTotal`：

```typescript
  const goNext = useCallback(() => {
    if (!canGoNext) return
    const next = Math.min(currentPage + step, effectiveTotal)
    setCurrentPage(next)
    setPanOffset(0)
  }, [canGoNext, currentPage, step, effectiveTotal, setCurrentPage])
```

- [ ] **Step 5: 替换 leftPageIdx/rightPageIdx 为偏移逻辑**

删除原来的两行（约第 108-109 行）：

```typescript
  const leftPageIdx = currentPage - 1
  const rightPageIdx = isDoubleMode && currentPage < totalPages ? currentPage : null
```

替换为：

```typescript
  let leftRealIdx: number
  let rightRealIdx: number | null = null
  let leftIsBlank = false
  let rightIsBlank = false

  if (isDoubleMode && blankPosition === 'front') {
    leftRealIdx = currentPage - 2
    rightRealIdx = currentPage - 1
    leftIsBlank = leftRealIdx < 0
    rightIsBlank = rightRealIdx >= totalPages
  } else if (isDoubleMode && blankPosition === 'end') {
    leftRealIdx = currentPage - 1
    rightRealIdx = currentPage < totalPages ? currentPage : null
    rightIsBlank = rightRealIdx === null
  } else {
    leftRealIdx = currentPage - 1
    rightRealIdx = isDoubleMode && currentPage < totalPages ? currentPage : null
  }
```

- [ ] **Step 6: 更新渲染部分使用新变量**

将渲染区域（约第 138-145 行）：

```tsx
        <div className="h-full flex items-center justify-center">
          <FlipPage url={imageUrls[leftPageIdx]} index={leftPageIdx} cachedDataUri={imageCacheRef.current?.get(leftPageIdx)} />
        </div>
        {rightPageIdx !== null && (
          <div className="h-full flex items-center justify-center">
            <FlipPage url={imageUrls[rightPageIdx]} index={rightPageIdx} cachedDataUri={imageCacheRef.current?.get(rightPageIdx)} />
          </div>
        )}
```

替换为：

```tsx
        <div className="h-full flex items-center justify-center">
          {leftIsBlank ? <BlankPage /> : (
            <FlipPage url={imageUrls[leftRealIdx]} index={leftRealIdx} cachedDataUri={imageCacheRef.current?.get(leftRealIdx)} />
          )}
        </div>
        {(rightRealIdx !== null || rightIsBlank) && (
          <div className="h-full flex items-center justify-center">
            {rightIsBlank ? <BlankPage /> : (
              <FlipPage url={imageUrls[rightRealIdx!]} index={rightRealIdx!} cachedDataUri={imageCacheRef.current?.get(rightRealIdx!)} />
            )}
          </div>
        )}
```

- [ ] **Step 7: 添加 BlankPage 组件**

在 `PageFlipView.tsx` 文件底部（`FlipPage` 组件之前）添加：

```tsx
function BlankPage() {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{
        aspectRatio: '3/4',
        border: '2px dashed rgba(255,255,255,0.15)',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.03)',
      }}
    />
  )
}
```

- [ ] **Step 8: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 9: 提交**

```bash
git add src/components/PageFlipView.tsx
git commit -m "feat: add blank page offset logic to PageFlipView"
```

---

### Task 3: 更新 ComicReaderModal — 状态管理与数据流

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

添加 `blankPosition` 状态，计算 `effectiveTotalPages`，更新键盘导航、进度条、滑块、页码显示。

- [ ] **Step 1: 导入 BlankPosition 并添加状态**

在 `src/components/ComicReaderModal.tsx` 第 4 行的导入中添加 `BlankPosition`：

```typescript
import { useReaderSettings, type BlankPosition } from '../hooks/useReaderSettings'
```

在组件函数体内（约第 33 行 `const [settingsOpen, ...]` 之前）添加状态：

```typescript
  const [blankPosition, setBlankPosition] = useState<BlankPosition>('none')
```

- [ ] **Step 2: 计算 effectiveTotalPages**

在 `blankPosition` 状态声明之后添加：

```typescript
  const effectiveTotalPages = displayMode === 'double' && blankPosition === 'front' ? totalPages + 1 : totalPages
```

- [ ] **Step 3: 创建带重置的 setDisplayMode 包装函数**

在 `effectiveTotalPages` 之后添加：

```typescript
  const handleSetDisplayMode = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode)
    if (mode !== 'double') setBlankPosition('none')
  }, [setDisplayMode])
```

注意：需要在导入中添加 `DisplayMode` 类型。由于 `useReaderSettings` 已经返回了 `displayMode` 和 `setDisplayMode`，直接导入类型：

```typescript
import { useReaderSettings, type DisplayMode, type BlankPosition } from '../hooks/useReaderSettings'
```

- [ ] **Step 4: 更新设置面板中的 ModeButton onClick**

将设置面板中三个显示模式按钮的 `onClick`（约第 393、398、403 行）从 `setDisplayMode(...)` 改为 `handleSetDisplayMode(...)`：

```tsx
<ModeButton label="连续滚动" icon={scrollIcon} active={displayMode === 'scroll'} onClick={() => handleSetDisplayMode('scroll')} />
<ModeButton label="单页显示" icon={singleIcon} active={displayMode === 'single'} onClick={() => handleSetDisplayMode('single')} />
<ModeButton label="双页显示" icon={doubleIcon} active={displayMode === 'double'} onClick={() => handleSetDisplayMode('double')} />
```

- [ ] **Step 5: 更新键盘导航使用 effectiveTotalPages**

在键盘处理 effect（约第 128 行）中，将 double 模式下的翻页逻辑从：

```typescript
} else {
  const step = displayMode === 'double' ? 2 : 1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault()
    if (currentPage < totalPages) {
      setCurrentPage(Math.min(currentPage + step, totalPages))
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault()
    if (currentPage > 1) {
      setCurrentPage(Math.max(currentPage - step, 1))
    }
  }
}
```

替换为：

```typescript
} else {
  const step = displayMode === 'double' ? 2 : 1
  const navTotal = displayMode === 'double' && blankPosition === 'front' ? totalPages + 1 : totalPages
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault()
    if (currentPage + step <= navTotal) {
      setCurrentPage(currentPage + step)
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault()
    if (currentPage > 1) {
      setCurrentPage(Math.max(currentPage - step, 1))
    }
  }
}
```

同时将 `effectiveTotalPages` 和 `blankPosition` 添加到该 effect 的依赖数组中（约第 166 行）：

```typescript
  }, [open, onClose, displayMode, blankPosition, currentPage, totalPages, setCurrentPage])
```

- [ ] **Step 6: 更新进度条使用 effectiveTotalPages**

将第 180 行的 progress 计算：

```typescript
  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0
```

改为：

```typescript
  const progress = effectiveTotalPages > 0 ? Math.round((currentPage / effectiveTotalPages) * 100) : 0
```

- [ ] **Step 7: 更新页码显示**

将 header 中的页码（约第 249 行）：

```tsx
{currentPage} / {totalPages}
```

改为：

```tsx
{currentPage} / {effectiveTotalPages}
```

将 footer 中的页码（约第 321 行）：

```tsx
<span className="text-xs text-gray-500">{currentPage} / {totalPages}</span>
```

改为：

```tsx
<span className="text-xs text-gray-500">{currentPage} / {effectiveTotalPages}</span>
```

- [ ] **Step 8: 更新滑块**

将滑块的 `updateDragPosition`（约第 207 行）中的 `totalPages` 改为 `effectiveTotalPages`：

```typescript
    const page = Math.max(1, Math.round(pct * effectiveTotalPages))
```

将滑块的 aria 属性（约第 327-329 行）中的 `totalPages` 改为 `effectiveTotalPages`：

```tsx
aria-valuemin={1}
aria-valuemax={effectiveTotalPages}
aria-valuenow={currentPage}
```

- [ ] **Step 9: 更新 PageFlipView 调用**

将 `PageFlipView` 调用（约第 298-309 行）中添加 `blankPosition` prop，并将 `totalPages` 改为 `effectiveTotalPages`：

```tsx
<PageFlipView
  imageUrls={imageUrls}
  totalPages={effectiveTotalPages}
  currentPage={currentPage}
  setCurrentPage={setCurrentPage}
  displayMode={displayMode}
  imageWidth={imageWidth}
  zoom={zoom}
  imageCacheRef={imageCacheRef}
  cacheVersion={cacheVersion}
  onPageChange={(page) => setPreloadTarget(page)}
  blankPosition={blankPosition}
/>
```

- [ ] **Step 10: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 11: 提交**

```bash
git add src/components/ComicReaderModal.tsx
git commit -m "feat: wire blankPosition state and effectiveTotalPages in ComicReaderModal"
```

---

### Task 4: 设置面板 UI — 三态切换按钮

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

在双页模式的设置面板中添加三态切换按钮组。

- [ ] **Step 1: 添加 SVG 图标**

在 `ComicReaderModal.tsx` 底部，现有的 `doubleIcon` 定义之后（约第 511 行）添加三个图标：

```tsx
const blankNoneIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankFrontIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" strokeDasharray="2 2" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankEndIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" strokeDasharray="2 2" />
  </svg>
)
```

- [ ] **Step 2: 在设置面板中添加三态按钮组**

在设置面板中，显示模式切换器 `</div>` 之后（约第 406 行之后），添加仅在双页模式时显示的空白页控制：

```tsx
              {displayMode === 'double' && (
                <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <ModeButton
                    label="无补白"
                    icon={blankNoneIcon}
                    active={blankPosition === 'none'}
                    onClick={() => setBlankPosition('none')}
                  />
                  <ModeButton
                    label="前补白"
                    icon={blankFrontIcon}
                    active={blankPosition === 'front'}
                    onClick={() => setBlankPosition('front')}
                  />
                  <ModeButton
                    label="后补白"
                    icon={blankEndIcon}
                    active={blankPosition === 'end'}
                    onClick={() => setBlankPosition('end')}
                  />
                </div>
              )}
```

- [ ] **Step 3: 验证编译与 UI**

Run: `npx tsc --noEmit`
Expected: 无错误

手动验证：启动应用，打开一本漫画，切换到双页模式，打开设置面板，确认三态按钮组正确显示且可切换。

- [ ] **Step 4: 提交**

```bash
git add src/components/ComicReaderModal.tsx
git commit -m "feat: add blank page offset toggle to reader settings panel"
```

---

### Task 5: 端到端验证

- [ ] **Step 1: 验证前置空白页行为**

手动测试：
1. 打开一本漫画，切换到双页模式
2. 打开设置面板，点击「前补白」
3. 确认第一屏显示为 (空白, 第1页)
4. 翻页确认后续配对正确偏移：(第2页, 第3页), (第4页, 第5页)...
5. 确认进度条和页码显示正确
6. 确认键盘 ←→ 翻页正常

- [ ] **Step 2: 验证后置空白页行为**

手动测试：
1. 选择一本奇数页数的漫画
2. 翻到最后一屏，切换「后补白」
3. 确认最后一屏右侧显示空白占位
4. 确认进度条和页码正确

- [ ] **Step 3: 验证模式切换重置**

手动测试：
1. 双页模式 + 前补白
2. 切换到单页模式
3. 再切回双页模式
4. 确认空白页设置已重置为「无」

- [ ] **Step 4: 验证关闭重置**

手动测试：
1. 双页模式 + 前补白
2. 关闭阅读器
3. 重新打开同一漫画
4. 确认空白页设置为默认的「无」
