import { COMIC_SOURCES, SOURCE_LABELS, SOURCE_META, type ComicSource } from '@shared/types'

/** 获取来源标签 */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as ComicSource] ?? source
}

/** 来源是否支持随机 */
export function sourceSupportsRandom(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.supportsRandom ?? false
}

/** 来源是否支持收藏夹 */
export function sourceSupportsFavourites(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.supportsFavourites ?? false
}

/** 来源是否需要认证 */
export function sourceRequiresAuth(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.requiresAuth ?? false
}

/** 来源是否支持排行 */
export function sourceSupportsRanking(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.supportsRanking ?? false
}

/** 来源是否需要详情补充（搜索结果缺少完整元数据） */
export function sourceNeedsDetailEnrich(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.needsDetailEnrich ?? false
}

/**
 * Normalize a source identifier to a valid ComicSource.
 * Unknown sources default to 'hcomic'.
 */
export function normalizeSourceKey(source: string): ComicSource {
  return COMIC_SOURCES.includes(source as ComicSource) ? source as ComicSource : 'hcomic'
}
