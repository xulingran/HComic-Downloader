---
name: Tag Blacklist / Filter
date: 2026-05-23
status: approved
---

# Tag Blacklist / Filter Design Spec

## Summary

Allow users to maintain a per-source blacklist of tags. Comics containing blacklisted tags are hidden from search results by default, with a toggle to reveal them. Tags can be added from the comic info drawer (with confirmation) or managed in settings.

## Requirements

- Per-source blacklist (hcomic and moeimg tracked separately)
- Default: filter enabled, filtered comics hidden
- Toggle switch on search bar to show/hide filtered comics
- Quick-add from ComicInfoDrawer tags (with confirmation dialog)
- Centralized management in settings page
- Pure frontend filtering — no backend search changes
- Only applies to the search page (not favourites or downloads)
- Persisted via Python config, loaded into Zustand at startup

## Data Layer

### Config

New config key `tagBlacklist` added to `shared/types.ts`:

```typescript
// ConfigKey union — add 'tagBlacklist'
// ConfigValueMap — add tagBlacklist: { hcomic: string[]; moeimg: string[] }
// CONFIG_KEYS array — add 'tagBlacklist'
```

Default value: `{ hcomic: [], moeimg: [] }`

### Validator

In `electron/validators.ts`, add validation for `tagBlacklist` values:
- Must be an object with `hcomic` and `moeimg` keys (both arrays)
- Each array item must be a non-empty string, max length 64
- No duplicates (case-insensitive)

### Python Backend

In `config.py`, add `tag_blacklist` to the config whitelist with default `{}` (empty dict; frontend handles the full default structure).

### Zustand Store

Extend `src/stores/useSettingsStore.ts`:

```typescript
tagBlacklist: { hcomic: string[]; moeimg: string[] }
filterEnabled: boolean  // default true, not persisted

addTag(source: string, tag: string): void
removeTag(source: string, tag: string): void
setTagBlacklist(blacklist: TagBlacklist): void
setFilterEnabled(enabled: boolean): void
```

- `tagBlacklist` is persisted via `setConfig` on every change
- `filterEnabled` resets to `true` on each app launch (not persisted)
- `addTag` deduplicates case-insensitively, trims whitespace
- `removeTag` matches case-insensitively

### App Startup

In `src/App.tsx`, alongside existing config loading:
- Read `tagBlacklist` from config
- Normalize to full structure if stored value is partial (e.g., missing a source key)
- Set into Zustand store

## Search Page Filtering

### Toggle Button

- Position: right side of the search bar area, next to the search button
- Active state: funnel icon + "过滤" label in accent color
- Inactive state: same icon in muted/secondary color
- Only visible when `tagBlacklist[source].length > 0`
- Click toggles `filterEnabled`

### Filter Logic

In `SearchPage.tsx`, after comics are loaded:

```typescript
const filteredComics = useMemo(() => {
  if (!filterEnabled) return comics
  const blocked = new Set(tagBlacklist[source].map(t => t.toLowerCase()))
  if (blocked.size === 0) return comics
  return comics.filter(c => !c.tags?.some(t => blocked.has(t.toLowerCase())))
}, [comics, filterEnabled, tagBlacklist, source])
```

- Render `filteredComics` instead of `comics` in the card grid
- Do NOT mutate the `comics` state from `useComicStore`

### Filter Notice

When comics are filtered out, show a subtle notice above the results grid:

- Text: "已过滤 N 条结果"
- Style: `text-sm text-[var(--text-secondary)]`
- Only shown when `filteredComics.length < comics.length`

### Pagination

No special handling. Filtered results may show fewer items than the requested page size. This is an accepted tradeoff of frontend-only filtering.

## ComicInfoDrawer Quick Add

### Visual

- Each tag button shows a block/shield icon on hover (positioned to the right of the tag text)
- Blacklisted tags display as semi-transparent with strikethrough text, even without hover
- The source used is `comic.source` (fallback to `'hcomic'` if missing)

### Confirmation Dialog

On clicking the block icon:

1. Show a small modal dialog: "屏蔽标签「{tag}」？" with "确认" and "取消" buttons
2. On confirm: call `addTag(comic.source, tag)`, update visual state
3. On cancel: close dialog, no action

On clicking an already-blacklisted tag:

1. Show dialog: "取消屏蔽标签「{tag}」？"
2. On confirm: call `removeTag(comic.source, tag)`
3. On cancel: close dialog

## Settings Page Management

### New Section: Tag Filtering

Add a "标签过滤" section in settings with:

**Source tabs:** Two tabs — "HComic" and "Moeimg" — switching between the two blacklists.

**Add input:** A text input + "添加" button. On submit:
- Trim whitespace
- Ignore empty strings
- Deduplicate (case-insensitive) against current list for selected source
- Call `addTag(source, tag)`

**Tag list:** Display blacklisted tags as pills/capsules:
- Each pill shows the tag name with a delete (×) button
- Clicking × triggers a confirmation dialog: "移除屏蔽标签「{tag}」？"
- Confirm calls `removeTag(source, tag)`

**Empty state:** When the list for a source is empty, show placeholder text: "暂无屏蔽标签"

## Edge Cases

- `tagBlacklist` is `{ hcomic: [], moeimg: [] }` (empty) → filter toggle hidden, no filtering applied, zero visual impact
- Search results not yet loaded → filtering logic skipped
- Case-insensitive matching for both filtering and deduplication
- Tags from comics that lack a `source` field default to `'hcomic'`
- Switching search source automatically uses the corresponding blacklist
- `addTag` trims whitespace, ignores empty strings
- Config value is normalized on load (ensure both keys exist)

## File Change Summary

| File | Change |
|------|--------|
| `shared/types.ts` | Add `tagBlacklist` to ConfigKey, ConfigValueMap, CONFIG_KEYS |
| `electron/validators.ts` | Add tagBlacklist validator |
| `config.py` | Add `tag_blacklist` to config whitelist |
| `src/stores/useSettingsStore.ts` | Add tagBlacklist, filterEnabled, actions |
| `src/App.tsx` | Load tagBlacklist from config on startup |
| `src/pages/SearchPage.tsx` | Filter toggle, filtering logic, filter notice |
| `src/components/ComicInfoDrawer.tsx` | Block icons, confirmation dialogs, per-source add/remove |
| `src/pages/SettingsPage.tsx` | Tag filtering management section with source tabs |

No changes to: Python search logic, IPC interface, download management, favourites page, comic reader.
