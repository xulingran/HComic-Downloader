# 漫画阅读器设置 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为漫画阅读器添加页面间距和图片宽度的动态可调设置，通过底部栏弹出面板控制，localStorage 持久化。

**Architecture:** 新增 `useReaderSettings` hook 管理两个设置值（pageGap、imageWidth）并持久化到 localStorage。修改 `ComicReaderModal` 组件在底部栏添加齿轮按钮和弹出设置面板，图片区域使用动态间距和宽度。

**Tech Stack:** React hooks, localStorage, TypeScript, Vitest, @testing-library/react

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hooks/useReaderSettings.ts` | Create | 阅读器设置 hook：读取/写入 localStorage，提供默认值和范围 clamp |
| `src/components/ComicReaderModal.tsx` | Modify | 底部栏添加齿轮按钮、弹出设置面板、图片区域使用动态值 |
| `tests/unit/hooks/useReaderSettings.test.ts` | Create | hook 单元测试：默认值、读写、clamp、错误回退 |
| `tests/unit/components/common/ComicReaderModal.test.tsx` | Modify | 测试齿轮按钮、弹出面板、动态间距/宽度 |

---

### Task 1: useReaderSettings hook — 测试

**Files:**
- Create: `tests/unit/hooks/useReaderSettings.test.ts`

- [ ] **Step 1: 写测试文件**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReaderSettings } from '@/hooks/useReaderSettings'

describe('useReaderSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default values when localStorage is empty', () => {
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(4)
    expect(result.current.imageWidth).toBe(70)
  })

  it('reads saved values from localStorage', () => {
    localStorage.setItem('hcomic-reader-page-gap', '20')
    localStorage.setItem('hcomic-reader-image-width', '85')

    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(20)
    expect(result.current.imageWidth).toBe(85)
  })

  it('writes updated pageGap to localStorage', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => {
      result.current.setPageGap(40)
    })

    expect(result.current.pageGap).toBe(40)
    expect(localStorage.getItem('hcomic-reader-page-gap')).toBe('40')
  })

  it('writes updated imageWidth to localStorage', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => {
      result.current.setImageWidth(50)
    })

    expect(result.current.imageWidth).toBe(50)
    expect(localStorage.getItem('hcomic-reader-image-width')).toBe('50')
  })

  it('clamps pageGap to valid range 0-80', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => { result.current.setPageGap(100) })
    expect(result.current.pageGap).toBe(80)

    act(() => { result.current.setPageGap(-10) })
    expect(result.current.pageGap).toBe(0)
  })

  it('clamps imageWidth to valid range 30-100', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => { result.current.setImageWidth(200) })
    expect(result.current.imageWidth).toBe(100)

    act(() => { result.current.setImageWidth(10) })
    expect(result.current.imageWidth).toBe(30)
  })

  it('falls back to defaults when localStorage has non-numeric values', () => {
    localStorage.setItem('hcomic-reader-page-gap', 'abc')
    localStorage.setItem('hcomic-reader-image-width', 'not-a-number')

    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(4)
    expect(result.current.imageWidth).toBe(70)
  })

  it('falls back to defaults when localStorage value is out of range', () => {
    localStorage.setItem('hcomic-reader-page-gap', '999')
    localStorage.setItem('hcomic-reader-image-width', '1')

    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(4)
    expect(result.current.imageWidth).toBe(70)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/hooks/useReaderSettings.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/useReaderSettings'`

---

### Task 2: useReaderSettings hook — 实现

**Files:**
- Create: `src/hooks/useReaderSettings.ts`

- [ ] **Step 1: 实现 hook**

```typescript
import { useState, useCallback } from 'react'

const PAGE_GAP_KEY = 'hcomic-reader-page-gap'
const IMAGE_WIDTH_KEY = 'hcomic-reader-image-width'

const PAGE_GAP_MIN = 0
const PAGE_GAP_MAX = 80
const PAGE_GAP_DEFAULT = 4

const IMAGE_WIDTH_MIN = 30
const IMAGE_WIDTH_MAX = 100
const IMAGE_WIDTH_DEFAULT = 70

function readStoredValue(key: string, min: number, max: number, fallback: number): number {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < min || parsed > max) return fallback
  return parsed
}

export function useReaderSettings() {
  const [pageGap, setPageGapInternal] = useState(() =>
    readStoredValue(PAGE_GAP_KEY, PAGE_GAP_MIN, PAGE_GAP_MAX, PAGE_GAP_DEFAULT)
  )
  const [imageWidth, setImageWidthInternal] = useState(() =>
    readStoredValue(IMAGE_WIDTH_KEY, IMAGE_WIDTH_MIN, IMAGE_WIDTH_MAX, IMAGE_WIDTH_DEFAULT)
  )

  const setPageGap = useCallback((value: number) => {
    const clamped = Math.max(PAGE_GAP_MIN, Math.min(PAGE_GAP_MAX, value))
    setPageGapInternal(clamped)
    localStorage.setItem(PAGE_GAP_KEY, String(clamped))
  }, [])

  const setImageWidth = useCallback((value: number) => {
    const clamped = Math.max(IMAGE_WIDTH_MIN, Math.min(IMAGE_WIDTH_MAX, value))
    setImageWidthInternal(clamped)
    localStorage.setItem(IMAGE_WIDTH_KEY, String(clamped))
  }, [])

  return { pageGap, imageWidth, setPageGap, setImageWidth }
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run tests/unit/hooks/useReaderSettings.test.ts`
Expected: PASS — 所有 8 个测试通过

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useReaderSettings.ts tests/unit/hooks/useReaderSettings.test.ts
git commit -m "feat: add useReaderSettings hook with localStorage persistence"
```

---

### Task 3: ComicReaderModal — 测试齿轮按钮和设置面板

**Files:**
- Modify: `tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: 添加 mock 和新测试**

在文件顶部的 `vi.mock` 块中添加 `useReaderSettings` 的 mock：

```typescript
const mockSetPageGap = vi.fn()
const mockSetImageWidth = vi.fn()

vi.mock('@/hooks/useReaderSettings', () => ({
  useReaderSettings: vi.fn(() => ({
    pageGap: 4,
    imageWidth: 70,
    setPageGap: mockSetPageGap,
    setImageWidth: mockSetImageWidth,
  })),
}))
```

在 `beforeEach` 中重置：
```typescript
mockSetPageGap.mockClear()
mockSetImageWidth.mockClear()
```

在 `describe` 块末尾添加以下测试：

```typescript
describe('settings panel', () => {
  it('renders settings gear button in footer', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getByLabelText('阅读设置')).toBeInTheDocument()
  })

  it('opens settings panel when gear button is clicked', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await userEvent.click(screen.getByLabelText('阅读设置'))
    expect(screen.getByText('页面间距')).toBeInTheDocument()
    expect(screen.getByText('图片宽度')).toBeInTheDocument()
  })

  it('closes settings panel when gear button is clicked again', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    const gearBtn = screen.getByLabelText('阅读设置')
    await userEvent.click(gearBtn)
    expect(screen.getByText('页面间距')).toBeInTheDocument()

    await userEvent.click(gearBtn)
    expect(screen.queryByText('页面间距')).not.toBeInTheDocument()
  })

  it('renders range sliders with correct default values', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await userEvent.click(screen.getByLabelText('阅读设置'))

    const gapSlider = screen.getByLabelText('页面间距')
    const widthSlider = screen.getByLabelText('图片宽度')

    expect(gapSlider).toHaveValue('4')
    expect(widthSlider).toHaveValue('70')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: FAIL — `getByLabelText('阅读设置')` 找不到元素

---

### Task 4: ComicReaderModal — 实现齿轮按钮和设置面板

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

- [ ] **Step 1: 添加 import 和设置面板状态**

在文件顶部 import 区添加：
```typescript
import { useReaderSettings } from '../hooks/useReaderSettings'
```

在 `ComicReaderModal` 组件内部（`const progress = ...` 之后）添加：
```typescript
const { pageGap, imageWidth, setPageGap, setImageWidth } = useReaderSettings()
const [settingsOpen, setSettingsOpen] = useState(false)
```

- [ ] **Step 2: 修改图片区域使用动态间距和宽度**

将当前图片列表容器（约第 166 行）：

```tsx
<div className="flex flex-col items-center gap-1 py-2">
  {imageUrls.map((url, idx) => (
    <div
      key={idx}
      ref={(el) => { pageRefs.current[idx] = el }}
      className="w-[70%] max-w-[600px]"
    >
```

替换为：

```tsx
<div className="flex flex-col items-center py-2" style={{ gap: pageGap + 'px' }}>
  {imageUrls.map((url, idx) => (
    <div
      key={idx}
      ref={(el) => { pageRefs.current[idx] = el }}
      style={{ width: imageWidth + '%' }}
    >
```

- [ ] **Step 3: 修改底部栏，添加齿轮按钮和设置面板**

将当前底部栏（约第 181-195 行）：

```tsx
<div
  className="px-5 py-2 shrink-0"
  style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
>
  <div className="flex items-center gap-3">
    <span className="text-xs text-gray-500">{progress}%</span>
    <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${progress}%`, background: '#6c8cff' }}
      />
    </div>
    <span className="text-xs text-gray-500">ESC 关闭 | ↑↓ 滚动</span>
  </div>
</div>
```

替换为：

```tsx
<div
  className="px-5 py-2 shrink-0 relative"
  style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
>
  <div className="flex items-center gap-3">
    <span className="text-xs text-gray-500">{progress}%</span>
    <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${progress}%`, background: '#6c8cff' }}
      />
    </div>
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

- [ ] **Step 4: 运行全部相关测试**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx tests/unit/hooks/useReaderSettings.test.ts`
Expected: PASS — 所有测试通过

- [ ] **Step 5: 提交**

```bash
git add src/components/ComicReaderModal.tsx tests/unit/components/common/ComicReaderModal.test.tsx
git commit -m "feat: add reader settings panel with gap and width sliders"
```

---

### Task 5: 全量测试验证

- [ ] **Step 1: 运行完整测试套件**

Run: `npx vitest run`
Expected: PASS — 所有测试通过，无回归

- [ ] **Step 2: 确认最终提交**

如果全量测试通过，无需额外提交。如果有修复，提交修复。
