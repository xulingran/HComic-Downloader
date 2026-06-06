import type { TagBlacklist } from '@shared/types'

/**
 * Normalize a source identifier to a valid TagBlacklist key.
 *
 * Accepts any string and returns one of the valid keys:
 * `'hcomic'`, `'moeimg'`, `'jmcomic'`, `'bika'`, or `'copymanga'`.
 * Unknown sources default to `'hcomic'`.
 */
export function normalizeSourceKey(source: string): keyof TagBlacklist {
  if (source === 'moeimg') return 'moeimg'
  if (source === 'jmcomic') return 'jmcomic'
  if (source === 'bika') return 'bika'
  if (source === 'copymanga') return 'copymanga'
  return 'hcomic'
}
