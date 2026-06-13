# 漫画阅读器显示模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在漫画预览阅读器中添加三种显示模式（连续滚动、单页显示、双页显示），通过设置面板的分段控件切换。

**Architecture:** 状态驱动渲染方案。`useReaderSettings` 扩展 `displayMode` 状态，`ComicReaderModal` 根据模式条件渲染滚动视图或新建的 `PageFlipView` 翻页组件。单页/双页模式使用视口容器渲染当前页，支持点击/滚轮/键盘翻页和放大平移。

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/hooks/useReaderSettings.ts` | Modify | 新增 `displayMode` 状态与 localStorage 持久化 |
| `tests/unit/hooks/useReaderSettings.test.ts` | Modify | 新增 displayMode 相关测试 |
| `src/components/PageFlipView.tsx` | Create | 单页/双页翻页视口：渲染、翻页、放大平移 |
| `tests/unit/components/common/PageFlipView.test.tsx` | Create | PageFlipView 组件测试 |
| `src/components/ComicReaderModal.tsx` | Modify | 条件渲染、设置面板模式切换器、键盘行为更新 |
| `tests/unit/components/common/ComicReaderModal.test.tsx` | Modify | 新增模式切换器测试、翻页视图渲染测试 |

---

### Task 1: 扩展 `useReaderSettings` — 添加 `displayMode`

**Files:**
- Modify: `src/hooks/useReaderSettings.ts`
- Modify: `tests/unit/hooks/useReaderSettings.test.ts`

- [ ] **Step 1: 为 displayMode 添加失败的测试**

在 `tests/unit/hooks/useReaderSettings.test.ts` 末尾追加以下 describe 块：

```typescript
describe('displayMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns "scroll" as default displayMode', () => {
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.displayMode).toBe('scroll')
  })

  it('reads saved displayMode from localStorage', () => {
    localStorage.setItem('hcomic-reader-display-mode', 'double')
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.displayMode).toBe('double')
  })

  it('writes updated displayMode to localStorage', () => {
    const { result } = renderHook(() => useReaderSettings())
    act(() => {
      result.current.setDisplayMode('single')
    })
    expect(result.current.displayMode).toBe('single')
    expect(localStorage.getItem('hcomic-reader-display-mode')).toBe('single')
  })

  it('falls back to "scroll" for invalid localStorage values', () => {
    localStorage.setItem('hcomic-reader-display-mode', 'invalid')
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.displayMode).toBe('scroll')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/hooks/useReaderSettings.test.ts`
Expected: 新测试 FAIL — `result.current.displayMode` is undefined

- [ ] **Step 3: 实现 displayMode**

在 `src/hooks/useReaderSettings.ts` 中：

1. 在现有常量下方添加：

```typescript
const DISPLAY_MODE_KEY = 'hcomic-reader-display-mode'

const VALID_DISPLAY_MODES = ['scroll', 'single', 'double'] as const
type DisplayMode = typeof VALID_DISPLAY_MODES[number]
const DISPLAY_MODE_DEFAULT: DisplayMode = 'scroll'
```

2. 在 hook 内添加状态和 setter（紧跟 `imageWidth` 之后）：

```typescript
const [displayMode, setDisplayModeInternal] = useState<DisplayMode>(() => {
  const raw = localStorage.getItem(DISPLAY_MODE_KEY)
  if (raw && (VALID_DISPLAY_MODES as readonly string[]).includes(raw)) {
    return raw as DisplayMode
  }
  return DISPLAY_MODE_DEFAULT
})

const setDisplayMode = useCallback((value: DisplayMode) => {
  if ((VALID_DISPLAY_MODES as readonly string[]).includes(value)) {
    setDisplayModeInternal(value)
    localStorage.setItem(DISPLAY_MODE_KEY, value)
  }
}, [])
```

3. 在返回对象中追加 `displayMode` 和 `setDisplayMode`：

```typescript
return { pageGap, imageWidth, setPageGap, setImageWidth, displayMode, setDisplayMode }
```

4. 导出 `DisplayMode` 类型（供其他文件使用）：

在 `readStoredValue` 函数之前添加：
```typescript
export type { DisplayMode }
```

并将 `DisplayMode` 定义移到 hook 外部（紧跟常量之后）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/hooks/useReaderSettings.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useReaderSettings.ts tests/unit/hooks/useReaderSettings.test.ts
git commit -m "feat(reader): add displayMode to useReaderSettings with localStorage persistence"
```

---

### Task 2: 创建 `PageFlipView` 组件 — 基础结构与渲染

**Files:**
- Create: `src/components/PageFlipView.tsx`
- Create: `tests/unit/components/common/PageFlipView.test.tsx`

- [ ] **Step 1: 为 PageFlipView 基础渲染写测试**

创建 `tests/unit/components/common/PageFlipView.test.tsx`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PageFlipView } from '@/components/PageFlipView'
import type { DisplayMode } from '@/hooks/useReaderSettings'

const mockFetchPreviewImage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchPreviewImage.mockResolvedValue({ dataUri: 'data:image/webp;base64,page' })
  Object.defineProperty(window, 'hcomic', {
    value: { fetchPreviewImage: mockFetchPreviewImage },
    writable: true,
    configurable: true,
  })
})

// Mock IntersectionObserver for jsdom
class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
;(globalThis as any).IntersectionObserver = MockIntersectionObserver

const defaultProps = {
  imageUrls: ['url1', 'url2', 'url3', 'url4'],
  totalPages: 4,
  currentPage: 1,
  setCurrentPage: vi.fn(),
  displayMode: 'single' as DisplayMode,
  imageWidth: 70,
}

describe('PageFlipView', () => {
  it('renders the current page image in single mode', async () => {
    render(<PageFlipView {...defaultProps} />)
    // Wait for image to load
    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledWith('url1'))
  })

  it('renders two pages side by side in double mode', async () => {
    render(<PageFlipView {...defaultProps} displayMode="double" />)
    await waitFor(() => {
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('url1')
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('url2')
    })
  })

  it('renders only left page when currentPage is the last odd page in double mode', async () => {
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={3}
        displayMode="double"
      />
    )
    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledWith('url3'))
    // Should NOT fetch url4 — it doesn't exist
    expect(mockFetchPreviewImage).not.toHaveBeenCalledWith('url4')
  })

  it('shows click-to-flip navigation areas', () => {
    render(<PageFlipView {...defaultProps} />)
    expect(screen.getByLabelText('上一页')).toBeInTheDocument()
    expect(screen.getByLabelText('下一页')).toBeInTheDocument()
  })

  it('disables previous button on first page', () => {
    render(<PageFlipView {...defaultProps} currentPage={1} />)
    const prevBtn = screen.getByLabelText('上一页')
    expect(prevBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables next button on last page in single mode', () => {
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={3}
        displayMode="single"
      />
    )
    const nextBtn = screen.getByLabelText('下一页')
    expect(nextBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('calls setCurrentPage with +1 on next click in single mode', () => {
    const setCurrentPage = vi.fn()
    render(<PageFlipView {...defaultProps} setCurrentPage={setCurrentPage} />)
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(2)
  })

  it('calls setCurrentPage with -1 on prev click in single mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView {...defaultProps} currentPage={2} setCurrentPage={setCurrentPage} />
    )
    fireEvent.click(screen.getByLabelText('上一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  it('calls setCurrentPage with +2 on next click in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(3)
  })

  it('calls setCurrentPage with -2 on prev click in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        currentPage={3}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('上一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  it('clamps next page to totalPages in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={1}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    // From page 1, next would be 1+2=3, which is ≤ totalPages(3)
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(3)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/components/common/PageFlipView.test.tsx`
Expected: FAIL — cannot find module `@/components/PageFlipView`

- [ ] **Step 3: 实现 PageFlipView 基础结构**

创建 `src/components/PageFlipView.tsx`：

```tsx
import { useRef, useCallback, useEffect, useState } from 'react'
import type { DisplayMode } from '../hooks/useReaderSettings'

interface PageFlipViewProps {
  imageUrls: string[]
  totalPages: number
  currentPage: number
  setCurrentPage: (page: number) => void
  displayMode: DisplayMode
  imageWidth: number
}

export function PageFlipView({
  imageUrls,
  totalPages,
  currentPage,
  setCurrentPage,
  displayMode,
  imageWidth,
}: PageFlipViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [panOffset, setPanOffset] = useState(0)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, offset: 0 })

  const isDoubleMode = displayMode === 'double'
  const step = isDoubleMode ? 2 : 1

  const canGoPrev = currentPage > 1
  const canGoNext = isDoubleMode
    ? currentPage + step <= totalPages
    : currentPage < totalPages

  const goNext = useCallback(() => {
    if (!canGoNext) return
    const next = Math.min(currentPage + step, totalPages)
    setCurrentPage(next)
    setPanOffset(0)
  }, [canGoNext, currentPage, step, totalPages, setCurrentPage])

  const goPrev = useCallback(() => {
    if (!canGoPrev) return
    const prev = Math.max(currentPage - step, 1)
    setCurrentPage(prev)
    setPanOffset(0)
  }, [canGoPrev, currentPage, step, setCurrentPage])

  // Pan handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isPanning.current = true
    panStart.current = { x: e.clientX, offset: panOffset }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [panOffset])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const container = containerRef.current
    if (!container) return
    const dx = e.clientX - panStart.current.x
    const newOffset = panStart.current.offset + dx
    // Clamp: don't allow panning beyond image edges
    const maxPan = 0
    const minPan = Math.min(container.offsetWidth - container.scrollWidth, 0)
    setPanOffset(Math.max(minPan, Math.min(maxPan, newOffset)))
  }, [])

  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  // Wheel flip with debounce
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (wheelTimer.current) return
    if (e.deltaY > 0) goNext()
    else if (e.deltaY < 0) goPrev()
    wheelTimer.current = setTimeout(() => {
      wheelTimer.current = null
    }, 200)
  }, [goNext, goPrev])

  useEffect(() => {
    return () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
    }
  }, [])

  // Determine which pages to render
  const leftPageIdx = currentPage - 1
  const rightPageIdx = isDoubleMode && currentPage < totalPages ? currentPage : null

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative flex items-center justify-center"
      onWheel={handleWheel}
    >
      <div
        className="flex items-center justify-center h-full"
        style={{
          gap: isDoubleMode ? '4px' : undefined,
          width: `${imageWidth}%`,
          transform: `translateX(${panOffset}px)`,
          transition: isPanning.current ? 'none' : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="h-full flex items-center justify-center">
          <FlipPage url={imageUrls[leftPageIdx]} index={leftPageIdx} />
        </div>
        {rightPageIdx !== null && (
          <div className="h-full flex items-center justify-center">
            <FlipPage url={imageUrls[rightPageIdx]} index={rightPageIdx} />
          </div>
        )}
      </div>

      {/* Click-to-flip overlay */}
      <div className="absolute inset-0 flex pointer-events-none">
        <button
          aria-label="上一页"
          aria-disabled={!canGoPrev}
          className="w-[40%] h-full pointer-events-auto cursor-pointer flex items-center justify-start pl-4 group"
          onClick={goPrev}
          style={{ background: 'transparent', border: 'none' }}
        >
          <svg
            width="32" height="32" viewBox="0 0 32 32" fill="none"
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <path d="M20 8l-8 8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          aria-label="下一页"
          aria-disabled={!canGoNext}
          className="w-[60%] h-full pointer-events-auto cursor-pointer flex items-center justify-end pr-4 group"
          onClick={goNext}
          style={{ background: 'transparent', border: 'none' }}
        >
          <svg
            width="32" height="32" viewBox="0 0 32 32" fill="none"
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <path d="M12 8l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function FlipPage({ url, index }: { url: string; index: number }) {
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.hcomic!.fetchPreviewImage(url)
      .then((result) => {
        if (cancelled) return
        if (result?.dataUri) setDataUri(result.dataUri)
        else throw new Error('Empty response')
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => { cancelled = true }
  }, [url])

  if (error) {
    return (
      <div className="flex items-center justify-center text-gray-400 text-xs" style={{ height: '100%' }}>
        第 {index + 1} 页加载失败
      </div>
    )
  }

  if (!dataUri) {
    return (
      <div className="flex items-center justify-center" style={{ height: '100%' }}>
        <svg className="animate-spin h-8 w-8 text-gray-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <img
      src={dataUri}
      alt={`第 ${index + 1} 页`}
      className="h-full w-auto max-w-none"
      draggable={false}
    />
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/components/common/PageFlipView.test.tsx`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/PageFlipView.tsx tests/unit/components/common/PageFlipView.test.tsx
git commit -m "feat(reader): add PageFlipView component with single/double page rendering and click navigation"
```

---

### Task 3: 集成到 `ComicReaderModal` — 条件渲染与模式切换器

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`
- Modify: `tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: 为模式切换器写测试**

在 `tests/unit/components/common/ComicReaderModal.test.tsx` 的 `settings panel` describe 块内追加：

```typescript
describe('display mode switcher', () => {
  const mockSetDisplayMode = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Override the useReaderSettings mock to include displayMode
  function renderWithMode(mode: string) {
    vi.doMock('@/hooks/useReaderSettings', () => ({
      useReaderSettings: vi.fn(() => ({
        pageGap: 4,
        imageWidth: 70,
        setPageGap: mockSetPageGap,
        setImageWidth: mockSetImageWidth,
        displayMode: mode,
        setDisplayMode: mockSetDisplayMode,
      })),
    }))
  }

  it('shows three display mode buttons in settings panel', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    await userEvent.click(screen.getByLabelText('阅读设置'))
    expect(screen.getByLabelText('连续滚动')).toBeInTheDocument()
    expect(screen.getByLabelText('单页显示')).toBeInTheDocument()
    expect(screen.getByLabelText('双页显示')).toBeInTheDocument()
  })
})
```

注意：需要更新文件顶部的 `useReaderSettings` mock，在返回值中加入 `displayMode: 'scroll'` 和 `setDisplayMode: vi.fn()`。

在现有 mock 中更新：

```typescript
vi.mock('@/hooks/useReaderSettings', () => ({
  useReaderSettings: vi.fn(() => ({
    pageGap: 4,
    imageWidth: 70,
    setPageGap: mockSetPageGap,
    setImageWidth: mockSetImageWidth,
    displayMode: 'scroll',
    setDisplayMode: vi.fn(),
  })),
}))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: 新测试 FAIL — 找不到 `连续滚动` 标签

- [ ] **Step 3: 在 ComicReaderModal 中添加模式切换器和条件渲染**

修改 `src/components/ComicReaderModal.tsx`：

1. 更新导入，添加 `PageFlipView` 和 `DisplayMode`：

```tsx
import { useReaderSettings } from '../hooks/useReaderSettings'
import { PageFlipView } from './PageFlipView'
```

2. 在组件内解构新增值：

```tsx
const { pageGap, imageWidth, setPageGap, setImageWidth, displayMode, setDisplayMode } = useReaderSettings()
```

3. 在设置面板 JSX 中（`settingsOpen && (...)</div>` 块内），在间距滑块上方添加模式切换器：

```tsx
{/* Display mode switcher */}
<div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
  <ModeButton
    label="连续滚动"
    icon={scrollIcon}
    active={displayMode === 'scroll'}
    onClick={() => setDisplayMode('scroll')}
  />
  <ModeButton
    label="单页显示"
    icon={singleIcon}
    active={displayMode === 'single'}
    onClick={() => setDisplayMode('single')}
  />
  <ModeButton
    label="双页显示"
    icon={doubleIcon}
    active={displayMode === 'double'}
    onClick={() => setDisplayMode('double')}
  />
</div>
```

4. 间距滑块条件渲染 — 用 `{displayMode === 'scroll' && (...)}` 包裹间距的 `<label>` 和 `<input>`。

5. 内容区域条件渲染 — 替换现有的 `loadingState === 'loaded' && imageUrls.length > 0` 块：

```tsx
{loadingState === 'loaded' && imageUrls.length > 0 && (
  displayMode === 'scroll' ? (
    /* existing scroll view */
    <div className="flex flex-col items-center py-2" style={{ gap: pageGap + 'px' }}>
      {imageUrls.map((url, idx) => {
        void cacheVersion
        const cachedDataUri = imageCacheRef.current.get(idx)
        return (
          <div
            key={idx}
            ref={(el) => { pageRefs.current[idx] = el }}
            style={{ width: imageWidth + '%' }}
          >
            <ReaderPage
              url={url}
              index={idx}
              priority={preloadTarget != null && Math.abs(idx + 1 - preloadTarget) <= 5}
              cachedDataUri={cachedDataUri}
            />
          </div>
        )
      })}
    </div>
  ) : (
    <PageFlipView
      imageUrls={imageUrls}
      totalPages={totalPages}
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      displayMode={displayMode}
      imageWidth={imageWidth}
    />
  )
)}
```

6. 在文件底部（`ReaderPage` 函数之前）添加辅助组件：

```tsx
function ModeButton({ label, icon, active, onClick }: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex-1 flex items-center justify-center py-1.5 transition-colors"
      style={{
        background: active ? 'rgba(108,140,255,0.2)' : 'transparent',
        color: active ? '#6c8cff' : 'rgba(255,255,255,0.4)',
      }}
    >
      {icon}
    </button>
  )
}

const scrollIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="1" width="8" height="14" rx="1" />
    <path d="M8 11v2.5M6 12l2 1.5L10 12" />
  </svg>
)

const singleIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="1" width="10" height="14" rx="1" />
  </svg>
)

const doubleIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: ALL PASS

- [ ] **Step 5: 运行所有相关测试**

Run: `npx vitest run tests/unit/`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
git add src/components/ComicReaderModal.tsx tests/unit/components/common/ComicReaderModal.test.tsx
git commit -m "feat(reader): integrate display mode switcher and conditional flip/scroll rendering"
```

---

### Task 4: 键盘行为更新

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

- [ ] **Step 1: 更新键盘事件处理**

在 `ComicReaderModal.tsx` 的 `useEffect` 键盘处理器中（约第 74-89 行），替换现有逻辑为根据 `displayMode` 分支处理：

```tsx
useEffect(() => {
  if (!open) return
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (displayMode === 'scroll') {
      if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        scrollContainerRef.current?.scrollBy({ top: 300, behavior: 'smooth' })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        scrollContainerRef.current?.scrollBy({ top: -300, behavior: 'smooth' })
      }
    } else {
      // single / double mode
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
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [open, onClose, displayMode, currentPage, totalPages, setCurrentPage])
```

注意：将 `displayMode`, `currentPage`, `totalPages`, `setCurrentPage` 加入依赖数组。

- [ ] **Step 2: 更新 footer 提示文字**

在 footer 的 `<span className="text-xs text-gray-500">ESC 关闭 | ↑↓ 滚动</span>` 改为条件渲染：

```tsx
<span className="text-xs text-gray-500">
  {displayMode === 'scroll' ? 'ESC 关闭 | ↑↓ 滚动' : 'ESC 关闭 | ←→ 翻页'}
</span>
```

- [ ] **Step 3: 添加双页模式 currentPage 对齐**

在 `fetchUrls` 的 useEffect 中，加载完成后确保双页模式下 currentPage 为奇数。在 `setCurrentPage(result.imageUrls.length > 0 ? 1 : 0)` 之后不会有问题（默认为 1）。

但切换模式时需要对齐。添加一个 useEffect：

```tsx
useEffect(() => {
  if (displayMode === 'double' && currentPage > 1 && currentPage % 2 === 0) {
    setCurrentPage(currentPage - 1)
  }
}, [displayMode])
```

- [ ] **Step 4: 运行所有测试**

Run: `npx vitest run tests/unit/`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/ComicReaderModal.tsx
git commit -m "feat(reader): update keyboard navigation for display modes with double-page alignment"
```

---

### Task 5: 手动验证与修复

**Files:**
- 可能微调任何上述文件

- [ ] **Step 1: 构建并运行应用**

Run: `npm run dev`
Expected: 应用启动无报错

- [ ] **Step 2: 手动测试流程**

1. 打开任意漫画的预览模式
2. 点击设置齿轮图标，确认出现三个模式图标按钮
3. 点击单页模式，确认只显示一页，左右点击区域翻页
4. 点击双页模式，确认显示两页并排，翻页步进为 2
5. 测试滚轮翻页（单页和双页模式）
6. 测试键盘左右箭头翻页
7. 确认奇数最后一页在双页模式下靠左显示
8. 确认间距滑块在单页/双页模式下隐藏
9. 确认宽度滑块仍然显示且可操作
10. 调大宽度滑块，确认图片放大后可以拖拽平移
11. 切换回滚动模式，确认行为恢复原样

- [ ] **Step 3: 运行完整测试套件**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat(reader): display modes — scroll, single page, double page with zoom/pan"
```
