# ComicReaderModal 关闭动画丢失修复

## 问题

ComicReaderModal 的滑入滑出动画大概率丢失，特别是**关闭动画（向下滑出）从不播放**。

### 根因

`App.tsx:116` 对 ComicReaderModal 使用了条件渲染：

```tsx
{readerComic && (
  <ComicReaderModal comic={readerComic} open={!!readerComic} onClose={closeReader} />
)}
```

关闭时序：
1. 用户点击关闭 → `closeReader()` → `readerComic = null`
2. React 重渲染 App → 条件 `{readerComic && ...}` 为 `false`
3. React **立即卸载**整个 ComicReaderModal 组件
4. 组件内的 `useEffect`、`setVisible(false)`、CSS transition 全部被跳过
5. 关闭动画永远没有机会播放

这解释了"大概率丢失"——实际上关闭动画是**必定丢失**的。打开动画也可能受 React 调度时序影响而偶发丢失。

## 方案

将 ComicReaderModal 改为**始终渲染**（与 ComicInfoDrawer 一致），由组件内部的 `mounted`/`visible` 状态完全控制生命周期。

## 改动

### App.tsx

移除条件包裹，始终渲染 ComicReaderModal：

```tsx
// 之前
{readerComic && (
  <ComicReaderModal comic={readerComic} open={!!readerComic} onClose={closeReader} />
)}

// 之后
<ComicReaderModal comic={readerComic} open={!!readerComic} onClose={closeReader} />
```

### ComicReaderModal.tsx

**1. Props 类型**：`comic` 改为 `ComicInfo | null`

**2. 新增 `activeComicRef`**：在关闭动画期间，`comic` 已是 `null`，但画面仍需显示漫画内容。用 ref 保存最后一次非空 comic 值供 JSX 使用：

```tsx
const activeComicRef = useRef<ComicInfo | null>(null)
useEffect(() => {
  if (comic) activeComicRef.current = comic
}, [comic])
```

**3. 延迟 reset/clearCache 到动画结束后**：当前效果在 `open` 变 `false` 时立即调用 `reset()` 和 `clearCache()`，导致关闭动画期间内容变为空白。改为在 `handleTransitionEnd`（动画完成回调）中执行清理：

```tsx
// 之前 — 立即清空
useEffect(() => {
  if (open) {
    fetchUrls(comic)
  } else {
    reset()
    clearCache()
  }
}, [open, comic.id, fetchUrls, reset, clearCache])

// 之后 — 延迟到动画结束
useEffect(() => {
  if (open && comic) {
    fetchUrls(comic)
  }
}, [open, comic, fetchUrls])

const handleTransitionEnd = useCallback(() => {
  if (!visible) {
    reset()
    clearCache()
    setMounted(false)
  }
}, [visible, reset, clearCache])
```

**4. JSX 中引用 comic 的地方**：`comic.title` 改为 `activeComicRef.current?.title ?? ''`

## 完整关闭时序

```
用户点关闭 → closeReader() → readerComic = null
→ App 重渲染，传 comic=null, open=false
→ useEffect([open]) → setVisible(false)        ← 触发 slide-down 动画
→ activeComicRef 仍持有旧 comic                 ← 画面内容保持
→ 300ms 后 CSS transition 完成
→ handleTransitionEnd → reset() + clearCache() + setMounted(false)
→ 组件返回 null
```

## 改动范围

- `src/App.tsx` — 1 行
- `src/components/ComicReaderModal.tsx` — ~10 行
