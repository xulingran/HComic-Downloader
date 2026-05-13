# 漫画阅读器：可拖拽进度条 + 智能预加载 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ComicReaderModal 底部的静态进度条替换为可拖拽滑块（实时滚动跳转），并在跳转时从目标位置智能串行预加载附近页面。

**Architecture:** 在现有 `ComicReaderModal.tsx` 文件内修改两个组件。`ReaderPage` 新增 `priority` 和 `cachedDataUri` props 用于跳过 IntersectionObserver 等待和使用预加载缓存。`ComicReaderModal` 新增自定义滑块替换静态进度条，并添加串行预加载 useEffect。

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/ComicReaderModal.tsx` | Modify | 可拖拽滑块 + 预加载逻辑 + ReaderPage 新 props |
| `tests/unit/components/common/ComicReaderModal.test.tsx` | Modify | 新增滑块交互和预加载测试 |

---

### Task 1: ReaderPage — 新增 cachedDataUri 和 priority props

**Files:**
- Modify: `src/components/ComicReaderModal.tsx:271` (ReaderPage function signature)
- Modify: `src/components/ComicReaderModal.tsx:182-192` (ReaderPage call site)
- Test: `tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: 为 ReaderPage 的 cachedDataUri prop 写测试**

在 `tests/unit/components/common/ComicReaderModal.test.tsx` 的 `describe('ComicReaderModal')` 块内新增：

```tsx
describe('ReaderPage cache and priority', () => {
  it('uses cachedDataUri when provided', async () => {
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg', 'https://img.example.com/3.jpg'],
      totalPages: 3,
      currentPage: 1,
    }))
    mockFetchPreviewImage.mockResolvedValue({ dataUri: 'data:image/webp;base64,cached-page-1' })

    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
  })
})
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: PASS（现有行为不变，新测试验证图片仍然正常渲染）

- [ ] **Step 3: 修改 ReaderPage 组件签名和加载逻辑**

将 `src/components/ComicReaderModal.tsx` 中 ReaderPage 的函数签名从：

```tsx
function ReaderPage({ url, index }: { url: string; index: number }) {
```

改为：

```tsx
function ReaderPage({ url, index, priority, cachedDataUri }: {
  url: string
  index: number
  priority?: boolean
  cachedDataUri?: string
}) {
```

修改加载 useEffect（当前位于约第 297 行），从：

```tsx
useEffect(() => {
    if (!isVisible || dataUri || error) return
```

改为：

```tsx
useEffect(() => {
    if (cachedDataUri && !dataUri) {
      setDataUri(cachedDataUri)
      return
    }
    if (dataUri || error) return
    if (!isVisible && !priority) return
```

同时更新依赖数组，从：

```tsx
}, [dataUri, error, isVisible, retryTick, url])
```

改为：

```tsx
}, [cachedDataUri, dataUri, error, isVisible, priority, retryTick, url])
```

修改 JSX 中 `isVisible` 的判断逻辑。将第 346 行的 `{isVisible ? (` 改为：

```tsx
{(isVisible || priority || dataUri) ? (
```

这确保 priority=true 但尚未进入视口的页面也能显示加载状态或已加载图片。

- [ ] **Step 4: 更新 ReaderPage 调用点，传入新 props（暂时传默认值）**

在约第 189 行，将：

```tsx
<ReaderPage url={url} index={idx} />
```

改为：

```tsx
<ReaderPage url={url} index={idx} priority={false} cachedDataUri={undefined} />
```

这些值在后续 Task 中会被动态计算。

- [ ] **Step 5: 运行全部测试确认无回归**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
git add src/components/ComicReaderModal.tsx tests/unit/components/common/ComicReaderModal.test.tsx
git commit -m "feat(reader): add cachedDataUri and priority props to ReaderPage"
```

---

### Task 2: 可拖拽进度条

**Files:**
- Modify: `src/components/ComicReaderModal.tsx:12-26` (新增 state)
- Modify: `src/components/ComicReaderModal.tsx:196-210` (footer 区域替换)
- Test: `tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: 为可拖拽进度条写测试**

在测试文件中新增：

```tsx
describe('draggable progress bar', () => {
  it('renders slider track with correct progress fill', () => {
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: ['url1', 'url2', 'url3', 'url4'],
      totalPages: 4,
      currentPage: 2,
    }))
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    const slider = screen.getByRole('slider')
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuemin', '1')
    expect(slider).toHaveAttribute('aria-valuemax', '4')
    expect(slider).toHaveAttribute('aria-valuenow', '2')
  })

  it('updates displayed page on pointer drag', async () => {
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: Array.from({ length: 10 }, (_, i) => `url${i}`),
      totalPages: 10,
      currentPage: 1,
    }))
    const { container } = render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    const slider = screen.getByRole('slider')
    const track = slider.querySelector('[data-track]') as HTMLElement

    // Simulate pointer drag to 50%
    fireEvent.pointerDown(track, { clientX: 150, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '5')
  })
})
```

注意：需要在测试文件顶部添加 `import { fireEvent } from '@testing-library/react'`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: FAIL — `getByRole('slider')` 找不到元素

- [ ] **Step 3: 在 ComicReaderModal 中添加滑块 state**

在 `ComicReaderModal` 组件顶部（约第 25 行后），添加：

```tsx
const [isDragging, setIsDragging] = useState(false)
const dragPageRef = useRef(0)
const sliderRef = useRef<HTMLDivElement>(null)
```

- [ ] **Step 4: 添加滑块 pointer event handler 函数**

在 ComicReaderModal 组件内，`if (!open) return null` 之前，添加滑块事件处理函数：

```tsx
const handleSliderPointerDown = (e: React.PointerEvent) => {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  setIsDragging(true)
  updateDragPosition(e)
}

const handleSliderPointerMove = (e: React.PointerEvent) => {
  if (!isDragging) return
  updateDragPosition(e)
}

const handleSliderPointerUp = () => {
  if (!isDragging) return
  setIsDragging(false)
}

const updateDragPosition = (e: React.PointerEvent) => {
  const track = sliderRef.current
  if (!track) return
  const rect = track.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const page = Math.max(1, Math.round(pct * totalPages))
  dragPageRef.current = page
  pageRefs.current[page - 1]?.scrollIntoView({ behavior: 'instant' })
  setCurrentPage(page)
}
```

- [ ] **Step 5: 替换 footer 区域的静态进度条**

将约第 196-210 行的 footer 区域替换为：

```tsx
{/* Footer */}
<div
  className="px-5 py-2 shrink-0 relative"
  style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
>
  <div className="flex items-center gap-3">
    <span className="text-xs text-gray-500">{progress}%</span>
    <div
      ref={sliderRef}
      data-track
      role="slider"
      aria-valuemin={1}
      aria-valuemax={totalPages}
      aria-valuenow={currentPage}
      aria-label="页面进度"
      className="flex-1 h-6 flex items-center cursor-pointer"
      style={{ padding: '8px 0' }}
      onPointerDown={handleSliderPointerDown}
      onPointerMove={handleSliderPointerMove}
      onPointerUp={handleSliderPointerUp}
    >
      <div className="w-full relative" style={{ height: '4px' }}>
        <div className="absolute inset-0 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
        <div
          className="absolute left-0 top-0 bottom-0 rounded-full"
          style={{ width: `${progress}%`, background: '#6c8cff' }}
        />
        <div
          className="absolute top-1/2 rounded-full"
          style={{
            left: `${progress}%`,
            transform: 'translate(-50%, -50%)',
            width: isDragging ? 18 : 14,
            height: isDragging ? 18 : 14,
            background: '#6c8cff',
            boxShadow: '0 0 6px rgba(108,140,255,0.5)',
            transition: isDragging ? 'none' : 'left 0.2s, width 0.15s, height 0.15s',
            ...(isDragging ? { touchAction: 'none' } : {}),
          }}
        />
      </div>
    </div>
    {isDragging && (
      <span
        className="text-xs px-2 py-0.5 rounded"
        style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
      >
        {currentPage} / {totalPages}
      </span>
    )}
    <span className="text-xs text-gray-500">ESC 关闭 | ↑↓ 滚动</span>
    <button
      aria-label="阅读设置"
      onClick={() => setSettingsOpen(!settingsOpen)}
      className="p-1 rounded hover:bg-white/10 transition-colors"
      style={{ color: settingsOpen ? '#6c8cff' : 'rgba(255,255,255,0.5)' }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.5" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
      </svg>
    </button>
  </div>

  {settingsOpen && (
    <div
      ref={settingsPanelRef}
      className="absolute bottom-full right-4 mb-2 rounded-lg"
      style={{
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        padding: '12px 16px',
        width: '220px',
      }}
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
          <span>页面间距</span>
          <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>{pageGap}px</span>
        </label>
        <input
          aria-label="页面间距"
          type="range"
          min={0}
          max={80}
          step={2}
          value={pageGap}
          onChange={(e) => setPageGap(Number(e.target.value))}
          className="w-full accent-[#6c8cff]"
        />
        <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
          <span>图片宽度</span>
          <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>{imageWidth}%</span>
        </label>
        <input
          aria-label="图片宽度"
          type="range"
          min={30}
          max={100}
          step={1}
          value={imageWidth}
          onChange={(e) => setImageWidth(Number(e.target.value))}
          className="w-full accent-[#6c8cff]"
        />
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: ALL PASS（包括新的 slider 测试）

- [ ] **Step 7: 提交**

```bash
git add src/components/ComicReaderModal.tsx tests/unit/components/common/ComicReaderModal.test.tsx
git commit -m "feat(reader): replace static progress bar with draggable slider"
```

---

### Task 3: 跳转时智能预加载

**Files:**
- Modify: `src/components/ComicReaderModal.tsx:12-26` (新增 state 和 refs)
- Modify: `src/components/ComicReaderModal.tsx:182-192` (ReaderPage 调用点传入动态 props)
- Test: `tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: 为预加载逻辑写测试**

在测试文件中新增：

```tsx
describe('smart preloading on jump', () => {
  it('preloads pages sequentially after slider drag', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://img.example.com/${i + 1}.jpg`)
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: urls,
      totalPages: 20,
      currentPage: 1,
    }))
    mockFetchPreviewImage.mockResolvedValue({ dataUri: 'data:image/webp;base64,preloaded' })

    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    // Wait for initial load
    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalled())

    mockFetchPreviewImage.mockClear()

    // Simulate dragging to page 10
    const slider = screen.getByRole('slider')
    const track = slider.querySelector('[data-track]') as HTMLElement
    fireEvent.pointerDown(track, { clientX: 250, pointerId: 1 })
    fireEvent.pointerUp(track, { pointerId: 1 })

    // Verify sequential preloading was triggered (page 10, then forward, then backward)
    await waitFor(() => {
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('https://img.example.com/10.jpg')
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: FAIL — 预加载逻辑尚未实现

- [ ] **Step 3: 添加预加载 state 和 refs**

在 ComicReaderModal 组件顶部（isDragging 之后），添加：

```tsx
const [preloadTarget, setPreloadTarget] = useState<number | null>(null)
const imageCacheRef = useRef(new Map<number, string>())
const [cacheVersion, setCacheVersion] = useState(0)
```

- [ ] **Step 4: 添加预加载 useEffect**

在 ComicReaderModal 组件的 useEffect 块区域，添加：

```tsx
// Serial preloading around jump target
useEffect(() => {
  if (preloadTarget == null || loadingState !== 'loaded') return
  let cancelled = false
  const cache = imageCacheRef.current
  const FORWARD = 5
  const BACKWARD = 2
  const queue: number[] = []

  for (let i = 0; i <= FORWARD; i++) {
    const pg = preloadTarget + i
    if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
  }
  for (let i = 1; i <= BACKWARD; i++) {
    const pg = preloadTarget - i
    if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
  }

  if (queue.length === 0) return

  const loadNext = async (idx: number) => {
    if (cancelled || idx >= queue.length) return
    const pg = queue[idx]
    try {
      const result = await window.hcomic!.fetchPreviewImage(imageUrls[pg - 1])
      if (cancelled) return
      if (result?.dataUri) {
        cache.set(pg - 1, result.dataUri)
        setCacheVersion((v) => v + 1)
      }
    } catch {}
    await loadNext(idx + 1)
  }

  loadNext(0)
  return () => { cancelled = true }
}, [preloadTarget, loadingState, imageUrls])
```

- [ ] **Step 5: 在滑块拖动结束时设置 preloadTarget**

修改 `handleSliderPointerUp` 函数，从：

```tsx
const handleSliderPointerUp = () => {
  if (!isDragging) return
  setIsDragging(false)
}
```

改为：

```tsx
const handleSliderPointerUp = () => {
  if (!isDragging) return
  setIsDragging(false)
  if (dragPageRef.current > 0) {
    setPreloadTarget(dragPageRef.current)
  }
}
```

- [ ] **Step 6: 更新 ReaderPage 调用点，传入动态 props**

将约第 189 行的：

```tsx
<ReaderPage url={url} index={idx} priority={false} cachedDataUri={undefined} />
```

改为：

```tsx
<ReaderPage
  url={url}
  index={idx}
  priority={preloadTarget != null && Math.abs(idx + 1 - preloadTarget) <= 5}
  cachedDataUri={imageCacheRef.current.get(idx)}
/>
```

注意：`cacheVersion` 不直接在 JSX 中使用，但它的 state 更新会触发重新渲染，使 `imageCacheRef.current.get(idx)` 返回最新值。

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: ALL PASS

- [ ] **Step 8: 提交**

```bash
git add src/components/ComicReaderModal.tsx tests/unit/components/common/ComicReaderModal.test.tsx
git commit -m "feat(reader): add smart sequential preloading on slider jump"
```

---

### Task 4: IntersectionObserver 防抖动 + preloadTarget 清理

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

- [ ] **Step 1: 修复 IntersectionObserver 回调，拖动期间不更新 currentPage**

将约第 60-93 行的 IntersectionObserver useEffect 中的回调函数，修改其中的 `setCurrentPage` 调用：

```tsx
observerRef.current = new IntersectionObserver(
  (entries) => {
    if (isDragging) return
    let topPage = currentPage
    let topY = Infinity
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const idx = pageRefs.current.indexOf(entry.target as HTMLDivElement)
        if (idx !== -1) {
          const rect = entry.boundingClientRect
          if (rect.top < topY) {
            topY = rect.top
            topPage = idx + 1
          }
        }
      }
    }
    if (topPage !== currentPage && topPage > 0) {
      setCurrentPage(topPage)
    }
  },
  { root: scrollContainerRef.current, threshold: 0.1 }
)
```

需要将 `isDragging` 添加到此 useEffect 的依赖数组中：

```tsx
}, [loadingState, imageUrls.length, isDragging, currentPage])
```

注意：`currentPage` 也需要加入依赖，因为 observer 回调内部读取了它。

- [ ] **Step 2: 在 modal 关闭时清理 preloadTarget**

在 `reset` 调用的 useEffect 中（约第 43-50 行），当 modal 关闭时同时清理预加载状态：

```tsx
useEffect(() => {
  if (open) {
    fetchUrls(comic)
  } else {
    reset()
    setPreloadTarget(null)
    imageCacheRef.current.clear()
  }
}, [open, comic, fetchUrls, reset])
```

- [ ] **Step 3: 运行全部测试确认无回归**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: ALL PASS

- [ ] **Step 4: 提交**

```bash
git add src/components/ComicReaderModal.tsx
git commit -m "fix(reader): prevent IntersectionObserver feedback loop during drag"
```

---

### Task 5: 最终验证和清理

**Files:**
- `src/components/ComicReaderModal.tsx`
- `tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: 运行全部前端测试**

Run: `npx vitest run tests/unit/`
Expected: ALL PASS

- [ ] **Step 2: 手动验证（需启动应用）**

启动应用后打开任意漫画的预览界面，验证：
1. 底部进度条可拖拽，拖动时页面实时跳转
2. 拖动时滑块放大，右侧显示页码提示
3. 松手后滑块恢复，IntersectionObserver 正常接管
4. 跳转到远处页面后，图片按顺序加载（当前页先出现，附近页面随后）
5. 正常滚动时懒加载行为不变

- [ ] **Step 3: 更新设计文档标记为已完成**

在 `docs/superpowers/specs/2026-05-13-reader-progress-bar-design.md` 顶部添加：

```markdown
> **Status:** ✅ Implemented
```

- [ ] **Step 4: 最终提交**

```bash
git add docs/superpowers/specs/2026-05-13-reader-progress-bar-design.md
git commit -m "docs: mark reader progress bar spec as implemented"
```
