# 漫画信息抽屉（ComicInfoDrawer）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击漫画卡片标题时，右侧滑出抽屉展示漫画文本信息，支持复制标题、点击作者/标签跳转搜索。

**Architecture:** 新建 Zustand store 管理抽屉状态和待执行搜索，新建抽屉组件渲染漫画信息，修改 ComicCard 标题点击行为，通过 store 在 App 和 SearchPage 之间传递搜索参数。

**Tech Stack:** React, Zustand, TypeScript, Tailwind CSS

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/stores/useDrawerStore.ts` | 抽屉状态 + 待执行搜索的全局 store |
| 新建 | `src/components/ComicInfoDrawer.tsx` | 右侧抽屉 UI 组件 |
| 修改 | `src/components/common/ComicCard.tsx` | 标题点击改为打开抽屉 |
| 修改 | `src/App.tsx` | 渲染抽屉 + 监听 pendingSearch 跳转 |
| 修改 | `src/pages/SearchPage.tsx` | 接收并执行 pendingSearch |

---

### Task 1: 创建 useDrawerStore

**Files:**
- Create: `src/stores/useDrawerStore.ts`

- [ ] **Step 1: 创建 drawer store**

```typescript
// src/stores/useDrawerStore.ts
import { create } from 'zustand'
import { ComicInfo } from '@shared/types'

interface PendingSearch {
  query: string
  mode: string
}

interface DrawerState {
  drawerComic: ComicInfo | null
  pendingSearch: PendingSearch | null
  openDrawer: (comic: ComicInfo) => void
  closeDrawer: () => void
  setPendingSearch: (query: string, mode: string) => void
  clearPendingSearch: () => void
}

export const useDrawerStore = create<DrawerState>((set) => ({
  drawerComic: null,
  pendingSearch: null,
  openDrawer: (comic) => set({ drawerComic: comic }),
  closeDrawer: () => set({ drawerComic: null }),
  setPendingSearch: (query, mode) => set({ pendingSearch: { query, mode } }),
  clearPendingSearch: () => set({ pendingSearch: null }),
}))
```

- [ ] **Step 2: 验证编译通过**

Run: `cd E:/Developing/hcomic_downloader && npx tsc --noEmit src/stores/useDrawerStore.ts`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/stores/useDrawerStore.ts
git commit -m "feat: add useDrawerStore for comic info drawer state"
```

---

### Task 2: 创建 ComicInfoDrawer 组件

**Files:**
- Create: `src/components/ComicInfoDrawer.tsx`

- [ ] **Step 1: 创建抽屉组件**

```tsx
// src/components/ComicInfoDrawer.tsx
import { useDrawerStore } from '../stores/useDrawerStore'

export function ComicInfoDrawer() {
  const { drawerComic, closeDrawer, setPendingSearch } = useDrawerStore()

  if (!drawerComic) return null

  const handleSearch = (query: string, mode: string) => {
    setPendingSearch(query, mode)
    closeDrawer()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={closeDrawer}
      />
      {/* 抽屉面板 */}
      <div className="relative w-80 max-w-[85vw] bg-[var(--bg-primary)] shadow-2xl
                      flex flex-col overflow-y-auto
                      animate-[slideIn_0.2s_ease-out]">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--text-secondary)]">漫画详情</span>
          <button
            onClick={closeDrawer}
            className="w-7 h-7 flex items-center justify-center rounded-md
                       text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]
                       hover:text-[var(--text-primary)] transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4 space-y-4">
          {/* 标题 */}
          <h3 className="text-base font-medium text-[var(--text-primary)] leading-relaxed select-text">
            {drawerComic.title}
          </h3>

          {/* 作者 */}
          {drawerComic.author && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">作者</span>
              <p
                onClick={() => handleSearch(drawerComic.author!, 'author')}
                className="text-sm text-[var(--accent)] mt-0.5 cursor-pointer
                           hover:underline select-text"
              >
                {drawerComic.author}
              </p>
            </div>
          )}

          {/* 来源 & 页数 */}
          <div>
            <span className="text-xs text-[var(--text-secondary)]">信息</span>
            <p className="text-sm text-[var(--text-primary)] mt-0.5 select-text">
              {drawerComic.sourceSite || drawerComic.source}
              {drawerComic.pages != null && drawerComic.pages > 0 && (
                <> · {drawerComic.pages} 页</>
              )}
            </p>
          </div>

          {/* 标签 */}
          {drawerComic.tags && drawerComic.tags.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">标签</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {drawerComic.tags.map((tag, i) => (
                  <span
                    key={i}
                    onClick={() => handleSearch(tag, 'tag')}
                    className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)]/10
                               text-[var(--accent)] cursor-pointer
                               hover:bg-[var(--accent)]/20 transition-colors"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在全局 CSS 或 Tailwind 配置中添加 slideIn 动画**

在 `src/index.css`（或项目主 CSS 文件）末尾追加：

```css
@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
```

如果项目没有 `src/index.css`，检查 `src/main.tsx` 或 `src/App.tsx` 中引用的 CSS 文件路径，将动画添加到该文件中。

- [ ] **Step 3: 验证编译通过**

Run: `cd E:/Developing/hcomic_downloader && npx tsc --noEmit src/components/ComicInfoDrawer.tsx`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/components/ComicInfoDrawer.tsx
git commit -m "feat: add ComicInfoDrawer component"
```

---

### Task 3: 修改 ComicCard 标题点击行为

**Files:**
- Modify: `src/components/common/ComicCard.tsx`

- [ ] **Step 1: 修改 ComicCard，标题点击改为打开抽屉**

在文件顶部添加 import：

```typescript
import { useDrawerStore } from '../../stores/useDrawerStore'
```

修改 `ComicCard` 组件，移除 `titleExpanded` 状态和 `onToggleTitle`，添加 `openDrawer`：

将 `ComicCard` 函数改为：

```typescript
export function ComicCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus }: ComicCardProps) {
  const { cardStyle, sfwMode } = useSettingsStore()
  const { openDrawer } = useDrawerStore()

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} sfwMode={sfwMode} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} />
  }
  return <CoverCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} sfwMode={sfwMode} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} />
}
```

- [ ] **Step 2: 修改 CoverCard**

CoverCard 的 props 移除 `titleExpanded` 和 `onToggleTitle`，添加 `onOpenDrawer`：

```typescript
function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, sfwMode, downloadStatus, onOpenDrawer }: ComicCardProps & { onOpenDrawer: () => void }) {
```

CoverCard 中的标题 `onClick` 改为：

```tsx
<h3
  onClick={(e) => {
    e.stopPropagation();
    onOpenDrawer()
  }}
  className="text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text line-clamp-2"
  title={comic.title}
>
  {comic.title}
</h3>
{comic.author && (
  <p className="text-xs text-[var(--text-secondary)] mt-1 truncate select-text">
    {comic.author}
  </p>
)}
```

- [ ] **Step 3: 修改 DetailedCard**

DetailedCard 的 props 移除 `titleExpanded` 和 `onToggleTitle`，添加 `onOpenDrawer`：

```typescript
function DetailedCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, sfwMode, downloadStatus, onOpenDrawer }: ComicCardProps & { onOpenDrawer: () => void }) {
```

保留 `const [showAllTags, setShowAllTags] = useState(false)` 及现有标签展示逻辑不变（抽屉是独立的补充入口，卡片上的标签展示保持原样）。仅修改标题点击行为。

DetailedCard 中的标题 `onClick` 改为：

```tsx
<h3
  onClick={(e) => {
    e.stopPropagation();
    onOpenDrawer()
  }}
  className="text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text truncate"
  title={comic.title}
>
  {comic.title}
</h3>
```

- [ ] **Step 4: 验证编译通过**

Run: `cd E:/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/components/common/ComicCard.tsx
git commit -m "feat: change comic card title click to open info drawer"
```

---

### Task 4: 在 App.tsx 中渲染抽屉并处理搜索跳转

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 添加 import 和监听 pendingSearch**

在 `App.tsx` 顶部添加 import：

```typescript
import { ComicInfoDrawer } from './components/ComicInfoDrawer'
import { useDrawerStore } from './stores/useDrawerStore'
```

在 `App` 函数内，`const [activePage, setActivePage] = useState('search')` 之后添加：

```typescript
const { pendingSearch } = useDrawerStore()

useEffect(() => {
  if (pendingSearch) {
    setActivePage('search')
  }
}, [pendingSearch])
```

在 JSX 的 `</div>` 根元素闭合标签之前（与 Toast 同级），添加：

```tsx
<ComicInfoDrawer />
```

完整的 return 部分变为：

```tsx
return (
  <div className="flex h-screen bg-[var(--bg-secondary)]">
    <Toast
      message="当前处于 SFW 模式，封面已隐藏"
      actionLabel="关闭 SFW"
      onAction={handleDisableSfw}
      onDismiss={handleDismissToast}
      visible={showSfwToast && sfwToastDismissed}
    />
    <Sidebar activePage={activePage} onPageChange={setActivePage} />
    <div className="flex-1 flex flex-col overflow-hidden">
      <main className="flex-1 overflow-auto p-6">
        {renderPage()}
      </main>
    </div>
    <ComicInfoDrawer />
  </div>
)
```

- [ ] **Step 2: 验证编译通过**

Run: `cd E:/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/App.tsx
git commit -m "feat: render ComicInfoDrawer in App and handle search navigation"
```

---

### Task 5: SearchPage 接收并执行 pendingSearch

**Files:**
- Modify: `src/pages/SearchPage.tsx`

- [ ] **Step 1: 添加 import**

在 `SearchPage.tsx` 顶部添加：

```typescript
import { useDrawerStore } from '../stores/useDrawerStore'
```

- [ ] **Step 2: 在 SearchPage 中添加 pendingSearch 监听**

在 `const { cardStyle } = useSettingsStore()` 之后添加：

```typescript
const { pendingSearch, clearPendingSearch } = useDrawerStore()
```

在组件内（现有 useEffect 之后）添加新的 useEffect。此处直接使用 pendingSearch 的值调用搜索 API，避免依赖尚未更新的 React 状态（setQuery/setMode 是异步的）：

```typescript
useEffect(() => {
  if (!pendingSearch) return
  const { query: searchQuery, mode: searchMode } = pendingSearch

  setQuery(searchQuery)
  setMode(searchMode)
  clearPendingSearch()

  if (searchQuery.trim()) {
    addHistory(searchQuery.trim())
  }
  clearSelection()

  const gen = ++searchGenRef.current
  setLoading(true)
  setError(null)

  search(searchQuery, searchMode, 1, source).then(result => {
    if (gen !== searchGenRef.current) return
    setComics(result.comics)
    setPagination(result.pagination)
  }).catch(err => {
    if (gen !== searchGenRef.current) return
    setError(err instanceof Error ? err.message : 'Search failed')
  }).finally(() => {
    if (gen === searchGenRef.current) setLoading(false)
  })
}, [pendingSearch, clearPendingSearch])
```

注意：这里直接用 `pendingSearch` 的值调用 `search()` API，而非通过 `handleSearch` 函数（后者依赖尚未更新的 `query`/`mode` 状态）。`setQuery`/`setMode` 仅用于更新输入框 UI。

- [ ] **Step 3: 验证编译通过**

Run: `cd E:/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat: SearchPage accepts and executes pending search from drawer"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 启动应用并验证完整流程**

Run: `cd E:/Developing/hcomic_downloader && npm start`

验证清单：
1. 搜索页加载漫画卡片列表
2. 点击任意卡片的标题区域 → 右侧滑出抽屉
3. 抽屉显示完整标题（可选中复制）、作者、来源/页数、标签
4. 点击抽屉中作者 → 抽屉关闭 → 跳转搜索页 → 自动执行作者搜索
5. 重新打开抽屉，点击标签 → 抽屉关闭 → 跳转搜索页 → 自动执行标签搜索
6. 点击遮罩层关闭抽屉
7. 点击 ✕ 按钮关闭抽屉
8. SFW 模式下标题点击同样能打开抽屉
9. 切换到收藏页，点击标题也能打开抽屉

- [ ] **Step 2: 最终提交**

```bash
git add -A
git commit -m "feat: complete comic info drawer feature"
```
