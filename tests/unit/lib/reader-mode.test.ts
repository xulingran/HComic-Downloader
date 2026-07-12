import { describe, expect, it } from 'vitest'
import { resolveReaderModeTarget, resolveReaderSpread, resolveReaderTailNavigation } from '@/lib/reader-mode'

describe('resolveReaderSpread', () => {
  it.each([
    ['none', 1, 4, 0, 1, false, false, 4],
    ['none', 3, 3, 2, null, false, false, 3],
    ['front', 1, 4, null, 0, true, false, 5],
    ['front', 3, 4, 1, 2, false, false, 5],
    ['end', 3, 3, 2, null, false, true, 3],
  ] as const)(
    '%s blank at virtual page %i maps valid slots',
    (blankPosition, currentPage, totalPages, leftIndex, rightIndex, leftBlank, rightBlank, effectiveTotal) => {
      expect(resolveReaderSpread(currentPage, totalPages, blankPosition)).toEqual({
        effectiveTotal,
        leftIndex,
        rightIndex,
        leftBlank,
        rightBlank,
      })
    },
  )
})

describe('resolveReaderTailNavigation', () => {
  it.each([
    ['single', 'none', 4, 4, 5],
    ['scroll', 'none', 5, 5, 6],
    ['double', 'none', 4, 3, 5],
    ['double', 'none', 5, 5, 6],
    ['double', 'front', 4, 5, 6],
    ['double', 'front', 5, 5, 7],
    ['double', 'end', 4, 3, 5],
    ['double', 'end', 5, 5, 6],
  ] as const)(
    '%s/%s with %i images resolves last spread %i and tail %i',
    (displayMode, blankPosition, totalPages, lastImagePosition, tailPosition) => {
      expect(resolveReaderTailNavigation(totalPages, displayMode, blankPosition)).toMatchObject({
        lastImagePosition,
        tailPosition,
      })
    },
  )
})

describe('resolveReaderModeTarget with detail tail', () => {
  it.each([
    ['single', 'double', 5, 'none', 5],
    ['scroll', 'double', 5, 'none', 5],
    ['double', 'single', 6, 'front', 5],
    ['double', 'scroll', 5, 'none', 5],
  ] as const)(
    'keeps the tail anchored across %s -> %s',
    (currentMode, targetMode, currentPage, blankPosition, targetPage) => {
      expect(resolveReaderModeTarget(
        currentMode,
        targetMode,
        currentPage,
        4,
        blankPosition,
        true,
      )).toMatchObject({ targetPage, anchorPage: 5 })
    },
  )
})

describe('resolveReaderModeTarget', () => {
  it.each([
    ['single', 'double', 1, 8, 'none', 1, 1, 8],
    ['single', 'double', 6, 8, 'none', 6, 5, 8],
    ['scroll', 'double', 8, 8, 'none', 8, 7, 8],
    ['double', 'single', 5, 8, 'none', 5, 5, 8],
    ['double', 'scroll', 3, 8, 'front', 2, 2, 8],
    ['double', 'single', 1, 8, 'front', 1, 1, 8],
    ['double', 'single', 3, 3, 'end', 3, 3, 3],
  ] as const)(
    '%s -> %s keeps a legal actual anchor',
    (currentMode, targetMode, currentPage, totalPages, blankPosition, anchorPage, targetPage, effectiveTotal) => {
      expect(resolveReaderModeTarget(currentMode, targetMode, currentPage, totalPages, blankPosition)).toMatchObject({
        anchorPage,
        targetPage,
        effectiveTotal,
      })
    },
  )

  it('clamps invalid chapter endpoints and handles empty chapters', () => {
    expect(resolveReaderModeTarget('single', 'double', 99, 5, 'none')).toMatchObject({
      anchorPage: 5,
      targetPage: 5,
    })
    expect(resolveReaderModeTarget('scroll', 'single', 1, 0, 'none')).toEqual({
      anchorPage: 0,
      targetPage: 0,
      effectiveTotal: 0,
      targetBlankPosition: 'none',
    })
  })
})
