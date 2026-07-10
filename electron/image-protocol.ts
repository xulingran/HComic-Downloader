/**
 * Pure, testable core of the `app-image://` protocol handler.
 *
 * The handler in `electron/main.ts` delegates URL/Path parsing and security
 * validation to {@link resolveImageCacheFile} so the logic can be unit-tested
 * without an Electron runtime (no `protocol.handle` / `net.fetch` / `Response`
 * required). Only the final disk read + streaming happens in the handler.
 *
 * See specs/image-protocol-delivery and specs/cache-directory-access.
 */
import path from 'path'

/** Strict SHA-256 hex pattern for the url_hash path segment. */
export const URL_HASH_RE = /^[A-Fa-f0-9]{64}$/

export type ImageCacheKind = 'cover' | 'preview' | 'library'

export interface ImageCacheDirs {
  cover: string
  preview: string
  library?: string
}

/**
 * Result of resolving an `app-image://` request to a concrete file path.
 *
 * - `{ filePath }` — request is valid and the file should be streamed.
 * - `{ status, reason }` — request rejected; `status` is the HTTP status to
 *   return (400 bad kind/hash, 403 path traversal, 404 missing file).
 */
export type ResolveResult =
  | { filePath: string }
  | { status: number; reason: string }

/**
 * Resolve an `app-image://{kind}/{urlHash}` request to a cache file path,
 * enforcing all security checks.
 *
 * @param kind       host segment of the protocol URL ("cover" / "preview").
 * @param urlPathname pathname segment holding the url_hash (leading slashes OK).
 * @param dirs        authorized cover/preview files_dir absolute paths.
 * @param fileExists  injectable `existsSync`-style check (for testability).
 */
export function resolveImageCacheFile(
  kind: string,
  urlPathname: string,
  dirs: ImageCacheDirs,
  fileExists: (p: string) => boolean,
): ResolveResult {
  let baseDir: string
  if (kind === 'cover') baseDir = dirs.cover
  else if (kind === 'preview') baseDir = dirs.preview
  else if (kind === 'library') {
    if (!dirs.library) return { status: 400, reason: 'Library cache not configured' }
    baseDir = dirs.library
  } else return { status: 400, reason: 'Bad kind' }

  const urlHash = urlPathname.replace(/^\/+/, '')
  if (!URL_HASH_RE.test(urlHash)) {
    return { status: 400, reason: 'Invalid url_hash' }
  }

  // Resolve and prefix-check to block any traversal / symlink escape.
  const normalizedBase = path.resolve(baseDir) + path.sep
  const filePath = path.resolve(baseDir, urlHash)
  if (!filePath.startsWith(normalizedBase)) {
    return { status: 403, reason: 'Forbidden' }
  }

  if (!fileExists(filePath)) {
    return { status: 404, reason: 'Not found' }
  }

  return { filePath }
}
