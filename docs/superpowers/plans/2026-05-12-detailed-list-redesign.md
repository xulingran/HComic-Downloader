# 详细列表模式重新设计 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将详细列表模式从网格布局改为真正的单列列表——一本漫画占满一行，左侧正方形缩略图，右侧标题+作者+页数+Pill标签。

**Architecture:** 改造现有 `DetailedCard` 组件为全宽行布局。当 `cardStyle === 'detailed'` 时，页面容器从 `grid` 切换为 `flex flex-col`。不新增组件或设置选项。

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, @testing-library/react

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/common/ComicCard.tsx` | Modify | DetailedCard 改为全宽行布局 |
| `src/pages/SearchPage.tsx` | Modify | 容器根据 cardStyle 切换 grid/flex-col |
| `src/pages/FavouritesPage.tsx` | Modify | 容器根据 cardStyle 切换 grid/flex-col |
| `tests/unit/components/common/ComicCard.test.tsx` | Modify | 更新 DetailedCard 相关测试 |
| `tests/unit/pages/SearchPage.test.tsx` | Modify | 更新容器布局测试 |

注意：`DownloadPage.tsx` 不使用 ComicCard，不需要修改。

---

### Task 1: 改造 DetailedCard 组件为全宽行布局

**Files:**
- Modify: `src/components/common/ComicCard.tsx:117-235` (DetailedCard function)

- [ ] **Step 1: Write the failing test — 验证 DetailedCard 行布局**

在 `tests/unit/components/common/ComicCard.test.tsx` 中添加 describe block：

```tsx
describe('DetailedCard (detailed mode)', () => {
  const comicWithAllFields: ComicInfo = {
    id: '1',
    title: 'テスト漫画タイトル',
    url: 'https://example.com/1',
    coverUrl: 'https://example.com/cover.jpg',
    source: 'test',
    author: '作者A',
    pages: 128,
    tags: ['NTR', '魔法少女', '触手', '女体化', '種付け', '魔物']
  }

  beforeEach(() => {
    vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
  })

  it('renders as a flex row (not grid cell)', () => {
    const { container } = render(<ComicCard comic={comicWithAllFields} />)
    const row = container.firstElementChild as HTMLElement
    // The outer container should have flex and items-center
    expect(row.className).toContain('flex')
    expect(row.className).toContain('items-center')
  })

  it('renders square thumbnail', () => {
    const { container } = render(<ComicCard comic={comicWithAllFields} />)
    const img = screen.getByRole('img')
    // Thumbnail wrapper should be w-14 h-14 (square)
    const thumbWrapper = img.parentElement!
    expect(thumbWrapper.className).toContain('w-14')
    expect(thumbWrapper.className).toContain('h-14')
  })

  it('renders author and page count as subtitle', () => {
    render(<ComicCard comic={comicWithAllFields} />)
    expect(screen.getByText('作者A')).toBeInTheDocument()
    expect(screen.getByText(/128/)).toBeInTheDocument()
  })

  it('renders tags as pill elements', () => {
    render(<ComicCard comic={comicWithAllFields} />)
    // First 3 tags should be visible as pill text
    expect(screen.getByText('NTR')).toBeInTheDocument()
    expect(screen.getByText('魔法少女')).toBeInTheDocument()
    expect(screen.getByText('触手')).toBeInTheDocument()
    // The expand button shows "+3"
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('shows download button at row end (always visible)', () => {
    const onDownload = vi.fn()
    const { container } = render(
      <ComicCard comic={comicWithAllFields} onDownload={onDownload} />
    )
    const button = screen.getByRole('button')
    // Download button should NOT have opacity-0 class (always visible)
    expect(button.className).not.toContain('opacity-0')
  })

  it('selected state uses border-l accent', () => {
    const { container } = render(
      <ComicCard comic={comicWithAllFields} batchMode={true} selected={true} />
    )
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('border-l-2')
    expect(row.className).toContain('border-[var(--accent)]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/common/ComicCard.test.tsx`
Expected: FAIL — DetailedCard still uses old layout (rounded-xl, no flex row, w-20 h-20 thumbnail, etc.)

- [ ] **Step 3: Rewrite DetailedCard implementation**

Replace the entire `DetailedCard` function in `src/components/common/ComicCard.tsx` (lines 117-235) with:

```tsx
function DetailedCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, titleExpanded, onToggleTitle, sfwMode }: ComicCardProps & { titleExpanded: boolean; onToggleTitle: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef, sfwMode)
  const [showAllTags, setShowAllTags] = useState(false)
  const handleClick = () => {
    if (batchMode) onToggleSelect?.(comic)
    else onClick?.(comic)
  }

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className={`flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-150
                  border-b border-[var(--border)] hover:bg-[var(--bg-secondary)]
                  ${selected ? 'border-l-2 border-l-[var(--accent)] bg-[var(--accent)]/5' : ''}`}
    >
      {batchMode && (
        <div className={`mr-2 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                        ${selected ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--text-secondary)]'}`}>
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}
      <div className="w-14 h-14 bg-[var(--bg-secondary)] flex-shrink-0 rounded-md overflow-hidden">
        {sfwMode ? (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            <span className="text-xl">📖</span>
          </div>
        ) : coverSrc === undefined && comic.coverUrl ? (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : coverSrc ? (
          <img
            src={coverSrc}
            alt={comic.title}
            className="w-full h-full object-cover"
          />
        ) : comic.coverUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-secondary)] gap-0.5">
            <span className="text-[10px]">加载失败</span>
            <button
              onClick={(e) => { e.stopPropagation(); retry() }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
            >
              重试
            </button>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            📖
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 ml-3">
        <h3
          onClick={(e) => { e.stopPropagation(); onToggleTitle() }}
          className={`text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text
                     ${titleExpanded ? '' : 'truncate'}`}
          title={comic.title}
        >
          {comic.title}
        </h3>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
          {comic.author && <span>{comic.author}</span>}
          {comic.author && comic.pages != null && comic.pages > 0 && <span className="mx-1.5">·</span>}
          {comic.pages != null && comic.pages > 0 && <span>{comic.pages} 页</span>}
        </div>
        {comic.tags && comic.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {(showAllTags ? comic.tags : comic.tags.slice(0, 3)).map((tag, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"
              >
                {tag}
              </span>
            ))}
            {comic.tags.length > 3 && !showAllTags && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAllTags(true) }}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                +{comic.tags.length - 3}
              </button>
            )}
            {showAllTags && comic.tags.length > 3 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAllTags(false) }}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                收起
              </button>
            )}
          </div>
        )}
      </div>
      {!batchMode && onDownload && (
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(comic) }}
          className="flex-shrink-0 ml-2 w-7 h-7 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]
                     flex items-center justify-center hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}
    </div>
  )
}
```

Key changes from the old DetailedCard:
- Outer: `rounded-xl shadow-sm` → `flex items-center border-b hover:bg`
- Thumbnail: `w-20 h-20` → `w-14 h-14 rounded-md`
- Content: `flex-1 p-3 flex flex-col justify-center min-w-0` → `flex-1 min-w-0 ml-3`
- Author/pages: separate lines → single line with "·" separator
- Selected: `ring-2 ring-[var(--accent)]` → `border-l-2 border-l-[var(--accent)]`
- Download button: `absolute positioned, opacity-0 hover:opacity-100` → inline at row end, always visible
- Batch checkbox: `absolute top-2 left-2` → inline before thumbnail with `mr-2`

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run tests/unit/components/common/ComicCard.test.tsx`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/common/ComicCard.tsx tests/unit/components/common/ComicCard.test.tsx
git commit -m "Redesign DetailedCard as full-width row layout with square thumbnail and pill tags"
```

---

### Task 2: SearchPage 容器布局根据 cardStyle 切换

**Files:**
- Modify: `src/pages/SearchPage.tsx:1-7` (imports) and `src/pages/SearchPage.tsx:210` (container div)
- Modify: `tests/unit/pages/SearchPage.test.tsx`

- [ ] **Step 1: Write the failing test — 容器使用 flex-col when detailed**

在 `tests/unit/pages/SearchPage.test.tsx` 末尾添加：

```tsx
describe('container layout by cardStyle', () => {
  const comicsWithResults: ComicInfo[] = [
    { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
  ]

  it('uses grid layout for cover mode', () => {
    vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    mockStoreState.comics = comicsWithResults

    const { container } = render(<SearchPage />)
    const gridContainer = screen.getByText('Comic A').closest('div[class*="grid"]')
    expect(gridContainer).toBeInTheDocument()
  })

  it('uses flex-col layout for detailed mode', () => {
    vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
    mockStoreState.comics = comicsWithResults

    const { container } = render(<SearchPage />)
    const flexContainer = screen.getByText('Comic A').closest('div[class*="flex-col"]')
    expect(flexContainer).toBeInTheDocument()
  })
})
```

需要在文件顶部 import 中添加 `useSettingsStore`：
```tsx
import { useSettingsStore } from '@/stores/useSettingsStore'
```

同时在现有 mock 块中更新 useSettingsStore mock 使其支持动态返回值（从固定 `mockReturnValue` 改为 `mockImplementation`）：

将现有：
```tsx
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover' })
}))
```

改为：
```tsx
const { mockSettingsStore } = vi.hoisted(() => ({
  mockSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover' })
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: mockSettingsStore
}))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pages/SearchPage.test.tsx`
Expected: FAIL — container still uses `grid` class regardless of cardStyle

- [ ] **Step 3: Implement layout switching in SearchPage**

In `src/pages/SearchPage.tsx`:

Add import at the top (after existing imports):
```tsx
import { useSettingsStore } from '../stores/useSettingsStore'
```

Add inside the component function (after existing hooks):
```tsx
const { cardStyle } = useSettingsStore()
```

Replace line 210 (`<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">`) with:
```tsx
<div className={cardStyle === 'detailed'
  ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
  : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
}>
```

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run tests/unit/pages/SearchPage.test.tsx`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/SearchPage.tsx tests/unit/pages/SearchPage.test.tsx
git commit -m "Switch SearchPage container to flex-col for detailed list mode"
```

---

### Task 3: FavouritesPage 容器布局根据 cardStyle 切换

**Files:**
- Modify: `src/pages/FavouritesPage.tsx:1-7` (imports) and `src/pages/FavouritesPage.tsx:171` (container div)

- [ ] **Step 1: Implement layout switching in FavouritesPage**

In `src/pages/FavouritesPage.tsx`:

Add import at the top (after existing imports):
```tsx
import { useSettingsStore } from '../stores/useSettingsStore'
```

Add inside the component function (after existing hooks):
```tsx
const { cardStyle } = useSettingsStore()
```

Replace line 171 (`<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">`) with:
```tsx
<div className={cardStyle === 'detailed'
  ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
  : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
}>
```

- [ ] **Step 2: Run all tests to verify**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/FavouritesPage.tsx
git commit -m "Switch FavouritesPage container to flex-col for detailed list mode"
```

---

### Task 4: 运行全部测试并验证

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify manually in browser** (user action)

Start the app with `npm run dev`, go to Settings, switch to "详细列表" mode, navigate to Search and Favourites pages to visually verify the layout.
