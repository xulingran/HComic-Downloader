/**
 * Build an `app-image://` protocol URL for a cached image identified by its
 * `urlHash` (= sha256(url).hexdigest(), also the on-disk cache file name).
 *
 * The protocol is registered in the Electron main process
 * (`setupImageProtocol` in electron/main.ts). Chromium streams the raw bytes
 * straight from disk to `<img>`, so the image never enters the renderer JS
 * heap — no base64 / data URI is involved at any layer.
 *
 * `urlHash` is computed authoritatively by the Python backend and returned via
 * the `fetch_cover` / `fetch_preview_image` IPC results. The renderer must
 * never compute it itself (url-normalization drift would break cache keys).
 *
 * @param kind  `"cover"` for cover thumbnails, `"preview"` for reader pages.
 * @param urlHash  64-char hex sha256 of the image URL, from the backend.
 */
export function buildImageUrl(kind: 'cover' | 'preview', urlHash: string): string {
  return `app-image://${kind}/${urlHash}`
}
