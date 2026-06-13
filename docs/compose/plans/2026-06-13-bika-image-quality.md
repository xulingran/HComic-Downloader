# Bika Image Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable image quality for bika source preview (low/medium/high/original), with downloads always using original quality.

**Architecture:** Add `image-quality` HTTP header to bika API requests. Quality is configurable via config and exposed in the reader settings panel. The header must be sent on both API calls (to get image URLs) and image fetches (to get the right resolution). Downloads hardcode `original`.

**Tech Stack:** Python (bika parser, config, IPC), TypeScript (Electron main/preload, React frontend)

---

## File Structure

| File | Change |
|------|--------|
| `config.py` | Add `bika_image_quality: str = "original"` field |
| `sources/bika/parser.py` | Add `_image_quality` attr; inject `image-quality` header in `_get_headers` |
| `sources/__init__.py` | Read config and set parser's `_image_quality` on init |
| `python/ipc/types.py` | Add `bikaImageQuality` → `bika_image_quality` to `CONFIG_KEY_MAP` |
| `python/ipc/config_mixin.py` | Add runtime applier, include in `handle_get_config` |
| `shared/types.ts` | Add `bikaImageQuality` to `CONFIG_KEYS`; add `BIKA_IMAGE_QUALITY` IPC channel |
| `electron/main.ts` | Add validator for `bikaImageQuality` |
| `python/ipc/search_mixin.py` | Pass `image_quality` header when fetching bika preview images |
| `python/ipc/preview_mixin.py` | Accept optional `image_quality` param; inject header for bika URLs |
| `electron/preload.ts` | Update `fetchPreviewImage` to accept optional `imageQuality` param |
| `src/components/ComicReaderModal.tsx` | Add quality selector in settings panel (bika only) |
| `src/hooks/useComicReader.ts` | Pass `imageQuality` through preview fetch calls |

---

### Task 1: Config — Add `bika_image_quality` field

**Files:**
- Modify: `config.py:74` (after `check_update_on_start`)

- [ ] **Step 1: Add field to Config dataclass**

```python
    # Bika 图片清晰度（预览用，下载始终使用 original）
    bika_image_quality: str = "original"  # "low" | "medium" | "high" | "original"
```

- [ ] **Step 2: Add validation in `__post_init__`**

In `_validate_ranges` or after it, add:

```python
        if self.bika_image_quality not in ("low", "medium", "high", "original"):
            self.bika_image_quality = "original"
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_config.py -v`
Expected: PASS (existing tests still pass; new field has valid default)

---

### Task 2: Bika parser — Inject `image-quality` header

**Files:**
- Modify: `sources/bika/parser.py:32-40` (add attr), `sources/bika/parser.py:89-100` (header injection)

- [ ] **Step 1: Add `_image_quality` attribute to `__init__`**

After line 41 (`self._relogin_in_progress`), add:

```python
        self._image_quality: str = "original"
```

- [ ] **Step 2: Add `set_image_quality` method**

After `set_stored_credentials` (line 52), add:

```python
    def set_image_quality(self, quality: str) -> None:
        """设置预览图片清晰度。下载始终使用 original。"""
        if quality in ("low", "medium", "high", "original"):
            self._image_quality = quality
```

- [ ] **Step 3: Inject header in `_get_headers`**

In `_get_headers` (line 89-100), add `image-quality` to the headers dict:

```python
    def _get_headers(self, url: str, method: str) -> dict[str, str]:
        """构建包含签名的请求头。"""
        timestamp = str(int(time.time()))
        signature = self._get_signature(url, timestamp, NONCE, method)
        headers = {
            **DEFAULT_HEADERS,
            "time": timestamp,
            "signature": signature,
            "image-quality": self._image_quality,
        }
        if self._token:
            headers["authorization"] = self._token
        return headers
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v -k bika`
Expected: PASS

---

### Task 3: MultiSourceParser — Initialize bika quality from config

**Files:**
- Modify: `sources/__init__.py:82-90` (after bika auth setup)

- [ ] **Step 1: Set image quality on bika parser init**

After line 90 (`bika_parser.set_stored_credentials(...)`), add:

```python
            bika_quality = getattr(self._config, "bika_image_quality", "original")
            bika_parser.set_image_quality(bika_quality)
```

Note: `self._config` may need to be checked — look at how `source_auth` is accessed. If config is not stored, pass it through constructor or add a setter.

- [ ] **Step 2: Run tests**

Run: `pytest tests/ -v`
Expected: PASS

---

### Task 4: IPC Config — Wire `bikaImageQuality` through config system

**Files:**
- Modify: `python/ipc/types.py:16-39`
- Modify: `python/ipc/config_mixin.py:70-91`, `python/ipc/config_mixin.py:92-143`
- Modify: `shared/types.ts:839-845`
- Modify: `electron/main.ts:195-218`

- [ ] **Step 1: Add to `CONFIG_KEY_MAP` in `python/ipc/types.py`**

```python
    "bikaImageQuality": "bika_image_quality",
```

- [ ] **Step 2: Add runtime applier in `config_mixin.py`**

In `_apply_runtime` (line 70-91), add to `_RUNTIME_APPLIERS`:

```python
            "bikaImageQuality": lambda v: (
                self.parser.parsers["bika"].set_image_quality(v)
                if hasattr(self.parser.parsers.get("bika"), "set_image_quality")
                else None
            ),
```

- [ ] **Step 3: Include in `handle_get_config` response**

In `handle_get_config` (line 92-143), add to the `raw` dict:

```python
            "bika_image_quality": getattr(self.config, "bika_image_quality", "original"),
```

- [ ] **Step 4: Add to `CONFIG_KEYS` in `shared/types.ts`**

```typescript
  'bikaImageQuality',
```

- [ ] **Step 5: Add validator in `electron/main.ts`**

```typescript
  bikaImageQuality: and(string(), oneOf(['low', 'medium', 'high', 'original'] as const)),
```

- [ ] **Step 6: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS

---

### Task 5: Preview image fetch — Pass quality header for bika

**Files:**
- Modify: `python/ipc/preview_mixin.py:95-144`
- Modify: `python/ipc/search_mixin.py:435-443`
- Modify: `electron/preload.ts:206-209`
- Modify: `shared/types.ts:614`
- Modify: `src/hooks/useComicReader.ts:35,54`

- [ ] **Step 1: Update `_fetch_image_as_data_uri` to accept optional `image_quality`**

```python
    def _fetch_image_as_data_uri(
        self,
        url: str,
        max_size: int,
        *,
        image_quality: str = "",
    ) -> str:
```

In the headers dict (line 113-116), add:

```python
            headers = {
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": referer_for_image_url(url),
            }
            if image_quality:
                headers["image-quality"] = image_quality
```

- [ ] **Step 2: Update `_do_fetch_preview_image` to accept and pass `image_quality`**

```python
    def _do_fetch_preview_image(
        self,
        url: str,
        *,
        scramble_id: str = "",
        comic_id: str = "",
        image_quality: str = "",
    ) -> str:
```

Pass to `_fetch_image_as_data_uri`:

```python
        data_uri = self._fetch_image_as_data_uri(url, _PREVIEW_IMAGE_MAX_SIZE, image_quality=image_quality)
```

- [ ] **Step 3: Update `handle_fetch_preview_image` in `search_mixin.py`**

Add `image_quality` parameter:

```python
    def handle_fetch_preview_image(self, image_url: str, scramble_id: str = "", comic_id: str = "", image_quality: str = "") -> dict:
```

Pass to `_do_fetch_preview_image`:

```python
        data_uri = self._do_fetch_preview_image(image_url, scramble_id=scramble_id, comic_id=comic_id, image_quality=image_quality)
```

- [ ] **Step 4: Update TypeScript types in `shared/types.ts`**

```typescript
  fetchPreviewImage(imageUrl: string, scrambleId?: string, comicId?: string, imageQuality?: string): Promise<PreviewImageResult>
```

- [ ] **Step 5: Update preload bridge**

```typescript
  fetchPreviewImage: (imageUrl: unknown, scrambleId?: unknown, comicId?: unknown, imageQuality?: unknown) => {
    if (typeof imageUrl !== 'string' || imageUrl.length === 0 || imageUrl.length > 2048) throw new Error('Invalid preview image URL')
    if (imageQuality !== undefined && imageQuality !== null) {
      if (typeof imageQuality !== 'string' || !['low', 'medium', 'high', 'original'].includes(imageQuality)) throw new Error('Invalid imageQuality')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, imageUrl, scrambleId, comicId, imageQuality ?? undefined)
  },
```

- [ ] **Step 6: Update `useComicReader.ts` — no change needed here**

The quality is passed at the `ReaderPage` level, not in `useComicReader`. The hook just returns URLs.

- [ ] **Step 7: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS

---

### Task 6: Frontend — Add quality selector in reader settings panel

**Files:**
- Modify: `src/components/ComicReaderModal.tsx` (settings panel section)
- Modify: `src/components/ReaderPage.tsx` (pass quality to fetchPreviewImage)

- [ ] **Step 1: Add quality state to `ComicReaderModal`**

After `const [settingsOpen, setSettingsOpen] = useState(false)` (line 41), add:

```typescript
  const [bikaImageQuality, setBikaImageQuality] = useState<string>('original')
```

Load from config on mount:

```typescript
  useEffect(() => {
    window.hcomic?.getConfig().then((result) => {
      const q = (result.config as Record<string, unknown>)?.bikaImageQuality
      if (typeof q === 'string') setBikaImageQuality(q)
    }).catch(() => {})
  }, [])
```

- [ ] **Step 2: Add quality selector in settings panel**

In the settings panel (line 576-690), after the zoom controls section, add a conditional section for bika:

```tsx
              {comic?.sourceSite === 'bika' && (
                <>
                  <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
                    <span>图片清晰度</span>
                    <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>
                      {bikaImageQuality === 'low' ? '低' : bikaImageQuality === 'medium' ? '中' : bikaImageQuality === 'high' ? '高' : '原画'}
                    </span>
                  </label>
                  <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {(['low', 'medium', 'high', 'original'] as const).map((q) => (
                      <button
                        key={q}
                        onClick={() => {
                          setBikaImageQuality(q)
                          window.hcomic?.setConfig('bikaImageQuality', q).catch(() => {})
                        }}
                        className="flex-1 py-1 text-xs transition-colors"
                        style={{
                          background: bikaImageQuality === q ? 'rgba(108,140,255,0.2)' : 'transparent',
                          color: bikaImageQuality === q ? '#6c8cff' : 'rgba(255,255,255,0.4)',
                        }}
                      >
                        {q === 'low' ? '低' : q === 'medium' ? '中' : q === 'high' ? '高' : '原画'}
                      </button>
                    ))}
                  </div>
                </>
              )}
```

- [ ] **Step 3: Pass quality to `ReaderPage`**

In `ComicReaderModal.tsx`, when rendering `ReaderPage` components, pass the quality:

For scroll mode (line 425-432):
```tsx
                  <ReaderPage
                    url={url}
                    index={idx}
                    priority={preloadTarget != null && Math.abs(idx + 1 - preloadTarget) <= 5}
                    cachedDataUri={cachedDataUri}
                    scrambleId={scrambleId}
                    comicId={comicId}
                    imageQuality={comic?.sourceSite === 'bika' ? bikaImageQuality : undefined}
                  />
```

For `PageFlipView` (line 451-465), add `imageQuality` prop:
```tsx
              <PageFlipView
                ...
                imageQuality={comic?.sourceSite === 'bika' ? bikaImageQuality : undefined}
              />
```

- [ ] **Step 4: Update `ReaderPage` to accept and use `imageQuality`**

In `src/components/ReaderPage.tsx`, add `imageQuality` to props and pass to `fetchPreviewImage`:

```typescript
interface ReaderPageProps {
  // ... existing props
  imageQuality?: string
}
```

In the `fetchPreviewImage` call, pass the quality:

```typescript
const result = await window.hcomic!.fetchPreviewImage(url, scrambleId, comicId, imageQuality)
```

- [ ] **Step 5: Update `PageFlipView` to accept and pass `imageQuality`**

Add `imageQuality` prop to `PageFlipView` and pass it through to `ReaderPage`.

- [ ] **Step 6: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS

---

### Task 7: Download — Ensure always uses original quality

**Files:**
- Verify: `sources/bika/parser.py` (download path)

- [ ] **Step 1: Verify download path uses `original`**

The download path calls `parser.get_chapter_images()` which uses `_request()` → `_get_headers()`. Since `_image_quality` is set from config, downloads will use whatever the config says.

We need to ensure downloads always use `original`. Check `sources/__init__.py` `prepare_for_download` and `python/ipc/download_mixin.py` `_download_chapters`.

The simplest approach: in `get_chapter_images`, temporarily override `_image_quality` to `"original"` for the duration of the call, then restore. OR: add a separate method that forces original.

Better approach: Add a context manager or parameter to `_get_headers` / `_request` that allows overriding the quality.

- [ ] **Step 2: Add `_with_quality` context manager to `BikaParser`**

```python
    from contextlib import contextmanager

    @contextmanager
    def _with_quality(self, quality: str):
        """Temporarily override image quality (e.g. for downloads)."""
        prev = self._image_quality
        self._image_quality = quality
        try:
            yield
        finally:
            self._image_quality = prev
```

- [ ] **Step 3: Wrap download-related calls with `original` quality**

In `sources/__init__.py`, where `get_chapter_images` is called for download (line 260-266), wrap with:

```python
            with parser._with_quality("original"):
                image_urls = parser.get_chapter_images(comic_id, order)
```

Similarly in `download_mixin.py` `_download_chapters` (line 135):

```python
                with parser._with_quality("original"):
                    image_urls = parser.get_chapter_images(album_id, chap_order)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v`
Expected: PASS

---

### Task 8: Verification — Full integration test

- [ ] **Step 1: Run all Python tests**

Run: `pytest`
Expected: PASS

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint && npm run lint:py`
Expected: PASS

- [ ] **Step 4: Run frontend tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Manual verification**

1. Open the app, navigate to a bika comic
2. Open the reader → settings panel → verify quality selector appears
3. Change quality → verify images reload with new quality
4. Start a download → verify it uses original quality (check logs or network)
5. Non-bika comics → verify quality selector does NOT appear
