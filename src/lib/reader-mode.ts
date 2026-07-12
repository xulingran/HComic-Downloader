import type { BlankPosition, DisplayMode } from '../hooks/useReaderSettings'

export interface ReaderSpreadSlots {
  effectiveTotal: number
  leftIndex: number | null
  rightIndex: number | null
  leftBlank: boolean
  rightBlank: boolean
}

export interface ReaderModeTarget {
  anchorPage: number
  targetPage: number
  effectiveTotal: number
  targetBlankPosition: BlankPosition
}

export interface ReaderTailNavigation {
  imageEffectiveTotal: number
  lastImagePosition: number
  tailPosition: number
}

function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 0
  return Math.max(1, Math.min(totalPages, Math.trunc(page) || 1))
}

/** Maps a double-page virtual position to zero-based image indices. */
export function resolveReaderSpread(
  currentPage: number,
  totalPages: number,
  blankPosition: BlankPosition,
): ReaderSpreadSlots {
  const safeTotal = Math.max(0, totalPages)
  const effectiveTotal = blankPosition === 'front' ? safeTotal + 1 : safeTotal
  const page = effectiveTotal > 0 ? Math.max(1, Math.min(effectiveTotal, currentPage)) : 0

  if (page === 0) {
    return { effectiveTotal, leftIndex: null, rightIndex: null, leftBlank: false, rightBlank: false }
  }

  if (blankPosition === 'front') {
    const leftIndex = page - 2
    const rightIndex = page - 1
    return {
      effectiveTotal,
      leftIndex: leftIndex >= 0 && leftIndex < safeTotal ? leftIndex : null,
      rightIndex: rightIndex >= 0 && rightIndex < safeTotal ? rightIndex : null,
      leftBlank: leftIndex < 0,
      rightBlank: rightIndex >= safeTotal,
    }
  }

  const leftIndex = page - 1
  const rightIndex = page < safeTotal ? page : null
  return {
    effectiveTotal,
    leftIndex: leftIndex >= 0 && leftIndex < safeTotal ? leftIndex : null,
    rightIndex,
    leftBlank: false,
    rightBlank: blankPosition === 'end' && rightIndex === null,
  }
}

/**
 * Resolves the synthetic, non-image detail tail without inserting a sentinel
 * URL into the image list. In double mode the tail follows the final spread
 * and owns a dedicated navigation position even when a front blank exists.
 */
export function resolveReaderTailNavigation(
  totalPages: number,
  displayMode: DisplayMode,
  blankPosition: BlankPosition,
): ReaderTailNavigation {
  const safeTotal = Math.max(0, totalPages)
  if (displayMode !== 'double') {
    return {
      imageEffectiveTotal: safeTotal,
      lastImagePosition: safeTotal,
      tailPosition: safeTotal + 1,
    }
  }

  const hasFrontBlank = blankPosition === 'front'
  const imageEffectiveTotal = safeTotal + (hasFrontBlank ? 1 : 0)
  const lastImagePosition = hasFrontBlank
    ? (safeTotal % 2 === 0 ? safeTotal + 1 : safeTotal)
    : (safeTotal % 2 === 0 ? Math.max(1, safeTotal - 1) : safeTotal)

  return {
    imageEffectiveTotal,
    lastImagePosition: safeTotal > 0 ? lastImagePosition : 0,
    tailPosition: imageEffectiveTotal + 1,
  }
}

function resolveActualAnchor(
  currentMode: DisplayMode,
  currentPage: number,
  totalPages: number,
  blankPosition: BlankPosition,
): number {
  if (totalPages <= 0) return 0
  if (currentMode !== 'double') return clampPage(currentPage, totalPages)

  const spread = resolveReaderSpread(currentPage, totalPages, blankPosition)
  const firstActualIndex = spread.leftIndex ?? spread.rightIndex
  return firstActualIndex === null ? 1 : firstActualIndex + 1
}

/**
 * Resolves a mode switch before rendering the target mode. `anchorPage` is an
 * actual 1-based image page; `targetPage` is the virtual page position consumed
 * by the target mode (and may include a front blank in double mode).
 */
export function resolveReaderModeTarget(
  currentMode: DisplayMode,
  targetMode: DisplayMode,
  currentPage: number,
  totalPages: number,
  blankPosition: BlankPosition,
  hasTail = false,
): ReaderModeTarget {
  const safeTotal = Math.max(0, totalPages)
  if (hasTail) {
    const currentTail = resolveReaderTailNavigation(safeTotal, currentMode, blankPosition)
    if (currentPage === currentTail.tailPosition) {
      const targetBlankPosition = targetMode === 'double'
        ? (currentMode === 'double' ? blankPosition : 'none')
        : 'none'
      const targetTail = resolveReaderTailNavigation(safeTotal, targetMode, targetBlankPosition)
      return {
        anchorPage: safeTotal + 1,
        targetPage: targetTail.tailPosition,
        effectiveTotal: targetTail.tailPosition,
        targetBlankPosition,
      }
    }
  }
  const anchorPage = resolveActualAnchor(currentMode, currentPage, safeTotal, blankPosition)

  if (targetMode !== 'double') {
    return {
      anchorPage,
      targetPage: anchorPage,
      effectiveTotal: safeTotal,
      targetBlankPosition: 'none',
    }
  }

  const targetBlankPosition = currentMode === 'double' ? blankPosition : 'none'
  const effectiveTotal = safeTotal + (targetBlankPosition === 'front' ? 1 : 0)
  if (anchorPage === 0) {
    return { anchorPage: 0, targetPage: 0, effectiveTotal, targetBlankPosition }
  }

  const targetPage = targetBlankPosition === 'front'
    ? (anchorPage % 2 === 0 ? anchorPage + 1 : anchorPage)
    : (anchorPage % 2 === 0 ? anchorPage - 1 : anchorPage)

  return {
    anchorPage,
    targetPage: Math.max(1, Math.min(effectiveTotal, targetPage)),
    effectiveTotal,
    targetBlankPosition,
  }
}
