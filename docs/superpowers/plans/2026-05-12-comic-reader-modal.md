# Comic Reader Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen modal comic reader that opens when users click comic covers/titles in non-SFW mode, with vertical scrolling and lazy-loaded pages.

**Architecture:** Python IPC provides image URLs for each comic. Electron bridge forwards the IPC call. React frontend opens a modal overlay, lazy-loads images directly from source sites using IntersectionObserver, and tracks the current page for the indicator.

**Tech Stack:** Python (ipc_server.py), Electron (main.ts/preload.ts), React + TypeScript (ComicReaderModal.tsx, useComicReader.ts), Vitest + React Testing Library for tests.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `python/ipc_server.py` | Add `handle_get_preview_urls` method |
| Modify | `shared/types.ts` | Add IPC channel types and HcomicAPI method |
| Modify | `electron/main.ts` | Register `get-preview-urls` IPC handler |
| Modify | `electron/preload.ts` | Expose `getPreviewUrls` to renderer |
| Create | `src/hooks/useComicReader.ts` | Fetch URLs, track pages, manage lazy loading |
| Create | `src/components/ComicReaderModal.tsx` | Full-screen modal reader UI |
| Modify | `src/components/common/ComicCard.tsx` | Add `onOpenReader` prop and click handler |
| Modify | `src/pages/SearchPage.tsx` | Render modal, wire open/close state |
| Modify | `src/pages/FavouritesPage.tsx` | Render modal, wire open/close state |
| Create | `tests/unit/hooks/useComicReader.test.ts` | Hook unit tests |
| Create | `tests/unit/components/common/ComicReaderModal.test.tsx` | Component tests |

---

### Task 1: Python IPC — `get_preview_urls` handler

**Files:**
- Modify: `python/ipc_server.py:664-690` (handlers dict in `handle_request`)

- [ ] **Step 1: Write the handler method**

Add to `IPCServer` class in `python/ipc_server.py`, after `handle_get_download_detail` (around line 661):

```python
def handle_get_preview_urls(self, comic_data: dict) -> Dict:
    """Return all image URLs for a comic so the reader can lazy-load them."""
    from models import ComicInfo

    source_site = comic_data.get("sourceSite", "hcomic")
    comic_id = comic_data.get("id", "")

    if not comic_id or not isinstance(comic_id, str):
        raise ValueError("Missing comic id")

    if source_site == "moeimg":
        # Moeimg requires an API call to get image URLs
        moeimg = self.parser.parsers.get("moeimg")
        if not moeimg:
            raise RuntimeError("Moeimg parser not available")
        chapter_detail = moeimg._fetch_read_data(comic_id)
        image_urls = moeimg._extract_manga_images(chapter_detail)
        total_pages = moeimg._resolve_total_pages(
            chapter_detail, image_urls,
            int(comic_data.get("pages") or 0),
        )
    else:
        # HComic: URLs are computed from media_id + page number
        comic = ComicInfo(
            id=comic_id,
            media_id=comic_data.get("mediaId", ""),
            comic_source=comic_data.get("source", ""),
            source_site=source_site,
            pages=comic_data.get("pages") or 0,
            image_urls=comic_data.get("image_urls") or [],
        )
        image_urls = comic.get_all_image_urls()
        total_pages = comic.pages

    return {
        "imageUrls": image_urls,
        "totalPages": max(total_pages, len(image_urls)),
    }
```

- [ ] **Step 2: Register in the handlers dict**

In `handle_request` (line ~669), add to the `handlers` dict:

```python
"get_preview_urls": self.handle_get_preview_urls,
```

- [ ] **Step 3: Commit**

```bash
git add python/ipc_server.py
git commit -m "feat: add get_preview_urls IPC handler for comic reader"
```

---

### Task 2: Shared Types — IPC channel definitions

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Add `PreviewUrlsResult` interface**

After the `DownloadDetail` interface (line ~76):

```typescript
export interface PreviewUrlsResult {
  imageUrls: string[]
  totalPages: number
}
```

- [ ] **Step 2: Add to `IPCMethods`**

Add entry to `IPCMethods` interface (after `get_download_detail` around line 213):

```typescript
get_preview_urls: {
  params: { comic_data: ComicInfo }
  result: PreviewUrlsResult
}
```

- [ ] **Step 3: Add to `PYTHON_IPC_CHANNEL_MAP`**

Add to the map (after `get_download_detail` around line 237):

```typescript
'python:get-preview-urls': 'get_preview_urls',
```

- [ ] **Step 4: Add to `IPCChannelParamsMap`**

Add entry (after `get_download_detail` around line 264):

```typescript
'python:get-preview-urls': [comicData: ComicInfo]
```

- [ ] **Step 5: Add to `IPC_CHANNELS` const**

Add entry (after `GET_DOWNLOAD_DETAIL` around line 345):

```typescript
GET_PREVIEW_URLS: 'python:get-preview-urls',
```

- [ ] **Step 6: Add to `HcomicAPI` interface**

Add method (after `getDownloadDetail` around line 304):

```typescript
getPreviewUrls(comicData: ComicInfo): Promise<PreviewUrlsResult>
```

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add get_preview_urls IPC type definitions"
```

---

### Task 3: Electron Main — IPC handler registration

**Files:**
- Modify: `electron/main.ts:565-571` (after `GET_DOWNLOAD_DETAIL` handler)

- [ ] **Step 1: Add validation and handler function**

After the `GET_DOWNLOAD_DETAIL` handler in `registerIPCHandlers()` (around line 570):

```typescript
ipcMain.handle(IPC_CHANNELS.GET_PREVIEW_URLS, async (_, comicData: unknown) => {
  if (typeof comicData !== 'object' || comicData === null) {
    throw new Error('Invalid comic data')
  }
  const data = comicData as Record<string, unknown>
  if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 256) {
    throw new Error('Invalid comic id')
  }
  if (data.sourceSite !== undefined && data.sourceSite !== null) {
    if (typeof data.sourceSite !== 'string' || !SOURCE_VALUES.has(data.sourceSite)) {
      throw new Error('Invalid comicData.sourceSite')
    }
  }
  return bridge.call('get_preview_urls', { comic_data: comicData })
})
```

- [ ] **Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "feat: register get-preview-urls IPC handler in main"
```

---

### Task 4: Electron Preload — expose `getPreviewUrls`

**Files:**
- Modify: `electron/preload.ts:112-116` (after `getDownloadDetail`)

- [ ] **Step 1: Add the preload method**

After `getDownloadDetail` in the `contextBridge.exposeInMainWorld` call (around line 115):

```typescript
getPreviewUrls: (comicData: unknown) => {
  if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
  return ipcRenderer.invoke(IPC_CHANNELS.GET_PREVIEW_URLS, comicData)
},
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: expose getPreviewUrls in preload"
```

---

### Task 5: `useComicReader` hook

**Files:**
- Create: `src/hooks/useComicReader.ts`
- Create: `tests/unit/hooks/useComicReader.test.ts`

- [ ] **Step 1: Write the hook test**

Create `tests/unit/hooks/useComicReader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useComicReader } from '@/hooks/useComicReader'
import type { ComicInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '123',
  title: 'Test Comic',
  url: 'https://example.com/comic/123',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test',
  sourceSite: 'hcomic',
  mediaId: 'media123',
  pages: 5,
}

const mockPreviewResult = {
  imageUrls: [
    'https://img.example.com/page1.jpg',
    'https://img.example.com/page2.jpg',
    'https://img.example.com/page3.jpg',
  ],
  totalPages: 3,
}

describe('useComicReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useComicReader())
    expect(result.current.loadingState).toBe('idle')
    expect(result.current.imageUrls).toEqual([])
    expect(result.current.currentPage).toBe(0)
    expect(result.current.totalPages).toBe(0)
  })

  it('fetches preview URLs and transitions to loaded', async () => {
    const getPreviewUrls = vi.fn().mockResolvedValue(mockPreviewResult)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })

    expect(getPreviewUrls).toHaveBeenCalledWith(mockComic)
    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.imageUrls).toEqual(mockPreviewResult.imageUrls)
    expect(result.current.totalPages).toBe(3)
  })

  it('handles fetch error', async () => {
    const getPreviewUrls = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })

    expect(result.current.loadingState).toBe('error')
    expect(result.current.errorMessage).toBe('Network error')
  })

  it('resets state', async () => {
    const getPreviewUrls = vi.fn().mockResolvedValue(mockPreviewResult)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })
    expect(result.current.loadingState).toBe('loaded')

    act(() => {
      result.current.reset()
    })

    expect(result.current.loadingState).toBe('idle')
    expect(result.current.imageUrls).toEqual([])
  })

  it('updates currentPage via setCurrentPage', async () => {
    const getPreviewUrls = vi.fn().mockResolvedValue(mockPreviewResult)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })

    act(() => {
      result.current.setCurrentPage(2)
    })

    expect(result.current.currentPage).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/hooks/useComicReader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the hook implementation**

Create `src/hooks/useComicReader.ts`:

```typescript
import { useState, useCallback } from 'react'
import type { ComicInfo } from '@shared/types'

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error'

interface UseComicReaderReturn {
  imageUrls: string[]
  totalPages: number
  currentPage: number
  loadingState: LoadingState
  errorMessage: string
  fetchUrls: (comic: ComicInfo) => Promise<void>
  setCurrentPage: (page: number) => void
  reset: () => void
}

export function useComicReader(): UseComicReaderReturn {
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const fetchUrls = useCallback(async (comic: ComicInfo) => {
    setLoadingState('loading')
    setErrorMessage('')
    try {
      const result = await window.hcomic!.getPreviewUrls(comic)
      setImageUrls(result.imageUrls)
      setTotalPages(result.totalPages)
      setCurrentPage(result.imageUrls.length > 0 ? 1 : 0)
      setLoadingState('loaded')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load preview')
      setLoadingState('error')
    }
  }, [])

  const reset = useCallback(() => {
    setImageUrls([])
    setTotalPages(0)
    setCurrentPage(0)
    setLoadingState('idle')
    setErrorMessage('')
  }, [])

  return {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    fetchUrls,
    setCurrentPage,
    reset,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/hooks/useComicReader.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useComicReader.ts tests/unit/hooks/useComicReader.test.ts
git commit -m "feat: add useComicReader hook with tests"
```

---

### Task 6: `ComicReaderModal` component

**Files:**
- Create: `src/components/ComicReaderModal.tsx`
- Create: `tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: Write the component test**

Create `tests/unit/components/common/ComicReaderModal.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComicReaderModal } from '@/components/ComicReaderModal'
import type { ComicInfo } from '@shared/types'

vi.mock('@/hooks/useComicReader', () => ({
  useComicReader: vi.fn().mockReturnValue({
    imageUrls: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
    totalPages: 2,
    currentPage: 1,
    loadingState: 'loaded',
    errorMessage: '',
    fetchUrls: vi.fn(),
    setCurrentPage: vi.fn(),
    reset: vi.fn(),
  }),
}))

const mockComic: ComicInfo = {
  id: '1',
  title: 'テスト漫画',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test',
}

describe('ComicReaderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <ComicReaderModal comic={mockComic} open={false} onClose={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders title and page indicator when open', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getByText('テスト漫画')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('renders close button', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getByText('关闭')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={onClose} />
    )
    await userEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders image placeholders for all pages', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    // Each page renders an img element
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
  })

  it('renders progress bar', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getByText('50%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component implementation**

Create `src/components/ComicReaderModal.tsx`:

```tsx
import { useEffect, useRef, useCallback, useState } from 'react'
import { ComicInfo } from '@shared/types'
import { useComicReader } from '../hooks/useComicReader'
import { useSettingsStore } from '../stores/useSettingsStore'

interface ComicReaderModalProps {
  comic: ComicInfo
  open: boolean
  onClose: () => void
}

export function ComicReaderModal({ comic, open, onClose }: ComicReaderModalProps) {
  const {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    fetchUrls,
    setCurrentPage,
    reset,
  } = useComicReader()

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const observerRef = useRef<IntersectionObserver | null>(null)
  const { sfwMode } = useSettingsStore()

  // Fetch URLs when modal opens
  useEffect(() => {
    if (open && !sfwMode) {
      fetchUrls(comic)
    }
    if (!open) {
      reset()
    }
  }, [open])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
    }
  }, [])

  // Set up IntersectionObserver for page tracking
  useEffect(() => {
    if (loadingState !== 'loaded' || imageUrls.length === 0) return

    observerRef.current?.disconnect()

    observerRef.current = new IntersectionObserver(
      (entries) => {
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

    for (const ref of pageRefs.current) {
      if (ref) observerRef.current.observe(ref)
    }

    return () => { observerRef.current?.disconnect() }
  }, [loadingState, imageUrls.length])

  // Keyboard handler
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        scrollContainerRef.current?.scrollBy({ top: 300, behavior: 'smooth' })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        scrollContainerRef.current?.scrollBy({ top: -300, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1a1a2e]">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-white text-sm hover:bg-white/10 transition-colors"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >
            关闭
          </button>
          <span className="text-sm text-gray-400 truncate max-w-[300px]">{comic.title}</span>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-xs text-white"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          {currentPage} / {totalPages}
        </span>
      </div>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loadingState === 'loading' && (
          <div className="flex items-center justify-center h-full text-gray-400">
            <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        )}

        {loadingState === 'error' && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span>无法加载漫画内容</span>
            <span className="text-xs text-gray-500">{errorMessage}</span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-white"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              关闭
            </button>
          </div>
        )}

        {loadingState === 'loaded' && (
          <div className="flex flex-col items-center gap-1 py-2">
            {imageUrls.map((url, idx) => (
              <div
                key={idx}
                ref={(el) => { pageRefs.current[idx] = el }}
                className="w-[70%] max-w-[600px]"
              >
                <ReaderPage url={url} index={idx} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
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
    </div>
  )
}

/** Individual page with lazy loading and error state */
function ReaderPage({ url, index }: { url: string; index: number }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  // IntersectionObserver for lazy loading this specific page
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true) },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-gray-400"
        style={{ aspectRatio: '3/4' }}
      >
        <span className="text-xs">第 {index + 1} 页加载失败</span>
        <button
          onClick={() => setError(false)}
          className="text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ aspectRatio: '3/4' }} className="flex items-center justify-center">
      {isVisible ? (
        <>
          {!loaded && (
            <div className="flex items-center justify-center w-full h-full">
              <svg className="animate-spin h-6 w-6 text-gray-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          <img
            src={url}
            alt={`第 ${index + 1} 页`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            className={loaded ? 'w-full h-auto' : 'hidden'}
            loading="lazy"
          />
        </>
      ) : (
        <div
          className="w-full h-full"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(255,255,255,0.03) 8px, rgba(255,255,255,0.03) 16px)',
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ComicReaderModal.tsx tests/unit/components/common/ComicReaderModal.test.tsx
git commit -m "feat: add ComicReaderModal component with tests"
```

---

### Task 7: ComicCard — add `onOpenReader` click handler

**Files:**
- Modify: `src/components/common/ComicCard.tsx`

- [ ] **Step 1: Add `onOpenReader` to the props interface**

In `ComicCardProps` (line 6-14), add after `onDownload`:

```typescript
onOpenReader?: (comic: ComicInfo) => void
```

- [ ] **Step 2: Pass the prop through to sub-components**

Update `ComicCard` function (line 16-24) to pass `onOpenReader`:

```tsx
export function ComicCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader }: ComicCardProps) {
  const { cardStyle, sfwMode } = useSettingsStore()
  const [titleExpanded, setTitleExpanded] = useState(false)

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} titleExpanded={titleExpanded} onToggleTitle={() => setTitleExpanded(!titleExpanded)} sfwMode={sfwMode} />
  }
  return <CoverCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} titleExpanded={titleExpanded} onToggleTitle={() => setTitleExpanded(!titleExpanded)} sfwMode={sfwMode} />
}
```

- [ ] **Step 3: Add click handler in CoverCard**

In `CoverCard` (line 26), update the destructuring to include `onOpenReader`:

```tsx
function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, titleExpanded, onToggleTitle, sfwMode }: ComicCardProps & { titleExpanded: boolean; onToggleTitle: () => void }) {
```

Add a reader click handler after the existing `handleClick` (after line 32):

```tsx
const handleReaderClick = () => {
  if (!sfwMode && onOpenReader) {
    onOpenReader(comic)
  }
}
```

Update the cover image area to be clickable for the reader. Replace the `<div className="aspect-[3/4]...">` block (lines 63-96) — add `onClick` with `stopPropagation` to the cover image div and title:

In the cover image container `<div className="aspect-[3/4]...">`, add a click handler:

```tsx
<div
  className="aspect-[3/4] bg-[var(--bg-secondary)] relative overflow-hidden"
  onClick={(e) => { e.stopPropagation(); handleReaderClick() }}
>
```

And update the title `<h3>` click handler to also trigger the reader when not in batch mode:

```tsx
<h3
  onClick={(e) => {
    e.stopPropagation();
    if (!sfwMode && onOpenReader) {
      onOpenReader(comic)
    } else {
      onToggleTitle()
    }
  }}
  className={`text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text
             ${titleExpanded ? '' : 'line-clamp-2'}`}
  title={comic.title}
>
```

- [ ] **Step 4: Add same handler in DetailedCard**

Update `DetailedCard` destructuring similarly and add the same `handleReaderClick`.

Update the thumbnail `<div>` in DetailedCard (the `<div className="w-14 h-14...">` block) to trigger reader on click:

```tsx
<div
  className="w-14 h-14 bg-[var(--bg-secondary)] flex-shrink-0 rounded-md overflow-hidden cursor-pointer"
  onClick={(e) => { e.stopPropagation(); handleReaderClick() }}
>
```

And update the title click similarly.

- [ ] **Step 5: Commit**

```bash
git add src/components/common/ComicCard.tsx
git commit -m "feat: add onOpenReader click handler to ComicCard"
```

---

### Task 8: SearchPage — wire up the reader modal

**Files:**
- Modify: `src/pages/SearchPage.tsx`

- [ ] **Step 1: Add state and import**

Add import at the top of `SearchPage.tsx`:

```tsx
import { ComicReaderModal } from '../components/ComicReaderModal'
```

Add state inside `SearchPage` function, after existing state declarations (after line 40):

```tsx
const [readerComic, setReaderComic] = useState<ComicInfo | null>(null)
```

- [ ] **Step 2: Replace `handleComicClick` with reader handler**

Replace the existing `handleComicClick` (lines 96-98):

```tsx
const handleComicClick = (comic: ComicInfo) => {
  console.log('Comic clicked:', comic)
}
```

with:

```tsx
const handleOpenReader = (comic: ComicInfo) => {
  setReaderComic(comic)
}
```

- [ ] **Step 3: Pass `onOpenReader` to ComicCard**

Update all `ComicCard` instances in the comics grid (around line 217-225). Replace `onClick={handleComicClick}` with `onOpenReader={handleOpenReader}`:

```tsx
onOpenReader={handleOpenReader}
```

The old `onClick={handleComicClick}` is removed since `handleComicClick` was replaced.

- [ ] **Step 4: Render the modal**

Add the modal before the closing `</div>` of the root element (before line 316):

```tsx
{readerComic && (
  <ComicReaderModal
    comic={readerComic}
    open={!!readerComic}
    onClose={() => setReaderComic(null)}
  />
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat: wire ComicReaderModal into SearchPage"
```

---

### Task 9: FavouritesPage — wire up the reader modal

**Files:**
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: Add state and import**

Add import at the top:

```tsx
import { ComicReaderModal } from '../components/ComicReaderModal'
```

Add state inside `FavouritesPage` function (after line 33):

```tsx
const [readerComic, setReaderComic] = useState<ComicInfo | null>(null)
```

- [ ] **Step 2: Replace `handleComicClick`**

Replace lines 62-64:

```tsx
const handleComicClick = (comic: ComicInfo) => {
  console.log('Comic clicked:', comic)
}
```

with:

```tsx
const handleOpenReader = (comic: ComicInfo) => {
  setReaderComic(comic)
}
```

- [ ] **Step 3: Pass `onOpenReader` to ComicCard**

Update all `ComicCard` instances (around line 178-186). Replace `onClick={handleComicClick}` with `onOpenReader={handleOpenReader}`:

```tsx
onOpenReader={handleOpenReader}
```

- [ ] **Step 4: Render the modal**

Add the modal before `</div>` at the end (before the LoginExpiredDialog, around line 222):

```tsx
{readerComic && (
  <ComicReaderModal
    comic={readerComic}
    open={!!readerComic}
    onClose={() => setReaderComic(null)}
  />
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/FavouritesPage.tsx
git commit -m "feat: wire ComicReaderModal into FavouritesPage"
```

---

### Task 10: Run full test suite and verify

**Files:** None

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS (no regressions)

- [ ] **Step 2: Run Python tests if available**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/ -x -q` (or however Python tests are run in this project)
Expected: No failures related to `get_preview_urls`

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test failures from comic reader integration"
```
