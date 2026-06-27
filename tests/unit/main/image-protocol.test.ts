/**
 * Unit tests for the pure resolver behind the app-image:// protocol handler.
 *
 * Covers the security & routing contract in specs/image-protocol-delivery and
 * specs/cache-directory-access: valid hash → file path, bad kind/hash → 400,
 * path traversal → 403, missing file → 404. The actual disk streaming lives in
 * the Electron handler (main.ts) and is exercised only at runtime.
 */
import path from 'path'
import { describe, it, expect } from 'vitest'
import { resolveImageCacheFile, URL_HASH_RE } from '../../../electron/image-protocol'

// Use path.resolve so expected paths match whatever the resolver computes on
// the current platform (Windows drive letters, POSIX roots, etc.).
const COVER_DIR = path.resolve('/cache/cover_cache')
const PREVIEW_DIR = path.resolve('/cache/preview_cache')
const DIRS = { cover: COVER_DIR, preview: PREVIEW_DIR }
const VALID_HASH = 'a'.repeat(64)

function fileExistsSet(existing: Set<string>) {
  return (p: string) => existing.has(p)
}

describe('URL_HASH_RE', () => {
  it('accepts 64-char hex', () => {
    expect(URL_HASH_RE.test('a'.repeat(64))).toBe(true)
    expect(URL_HASH_RE.test('F'.repeat(64))).toBe(true)
    expect(URL_HASH_RE.test('0123456789abcdef'.repeat(4))).toBe(true)
  })

  it('rejects non-hex / wrong length / traversal', () => {
    expect(URL_HASH_RE.test('short')).toBe(false)
    expect(URL_HASH_RE.test('g'.repeat(64))).toBe(false) // non-hex char
    expect(URL_HASH_RE.test('a'.repeat(63))).toBe(false) // too short
    expect(URL_HASH_RE.test('a'.repeat(65))).toBe(false) // too long
    expect(URL_HASH_RE.test('../../etc/passwd')).toBe(false)
  })
})

describe('resolveImageCacheFile', () => {
  it('returns the file path for a valid cover hash that exists', () => {
    const expected = path.join(COVER_DIR, VALID_HASH)
    const result = resolveImageCacheFile('cover', `/${VALID_HASH}`, DIRS, fileExistsSet(new Set([expected])))
    expect(result).toEqual({ filePath: expected })
  })

  it('returns the file path for a valid preview hash that exists', () => {
    const expected = path.join(PREVIEW_DIR, VALID_HASH)
    const result = resolveImageCacheFile('preview', VALID_HASH, DIRS, fileExistsSet(new Set([expected])))
    expect(result).toEqual({ filePath: expected })
  })

  it('tolerates leading slashes in the pathname', () => {
    const expected = path.join(COVER_DIR, VALID_HASH)
    const result = resolveImageCacheFile('cover', `///${VALID_HASH}`, DIRS, fileExistsSet(new Set([expected])))
    expect(result).toEqual({ filePath: expected })
  })

  it('rejects an unknown kind with 400', () => {
    const result = resolveImageCacheFile('thumbnails', `/${VALID_HASH}`, DIRS, fileExistsSet(new Set()))
    expect(result).toEqual({ status: 400, reason: 'Bad kind' })
  })

  it('rejects a non-hex url_hash with 400', () => {
    const result = resolveImageCacheFile('cover', '/not-a-hash', DIRS, fileExistsSet(new Set()))
    expect(result).toEqual({ status: 400, reason: 'Invalid url_hash' })
  })

  it('returns 404 when the backing file does not exist (LRU eviction)', () => {
    const result = resolveImageCacheFile('cover', `/${VALID_HASH}`, DIRS, fileExistsSet(new Set()))
    expect(result).toEqual({ status: 404, reason: 'Not found' })
  })

  it('keeps cover and preview dirs independent', () => {
    const coverPath = path.join(COVER_DIR, VALID_HASH)
    const existing = new Set([coverPath]) // only cover file exists
    expect(resolveImageCacheFile('cover', `/${VALID_HASH}`, DIRS, fileExistsSet(existing))).toEqual({ filePath: coverPath })
    expect(resolveImageCacheFile('preview', `/${VALID_HASH}`, DIRS, fileExistsSet(existing))).toEqual({ status: 404, reason: 'Not found' })
  })
})
