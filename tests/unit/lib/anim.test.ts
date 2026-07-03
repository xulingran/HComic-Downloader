import { describe, expect, it } from 'vitest'
import type { Variants } from 'framer-motion'
import {
  DURATION,
  getDirectionalPageVariants,
  getReducedPageVariants,
  smoothTransition,
} from '@/lib/anim'

type PageDirection = 'forward' | 'backward'
type ResolvedVariant = Record<string, unknown>

function resolveVariant(variants: Variants, key: string, direction: PageDirection): ResolvedVariant {
  const variant = variants[key]
  if (typeof variant === 'function') {
    return (variant as (custom: PageDirection) => ResolvedVariant)(direction)
  }
  return variant as ResolvedVariant
}

describe('reader page flip variants', () => {
  it('slides pages in opposite directions for forward and backward navigation', () => {
    const variants = getDirectionalPageVariants()

    expect(resolveVariant(variants, 'enter', 'forward')).toMatchObject({ x: '100%' })
    expect(resolveVariant(variants, 'exit', 'forward')).toMatchObject({ x: '-100%' })
    expect(resolveVariant(variants, 'enter', 'backward')).toMatchObject({ x: '-100%' })
    expect(resolveVariant(variants, 'exit', 'backward')).toMatchObject({ x: '100%' })
  })

  it('uses smoothTransition for center and exit to avoid default spring overshoot', () => {
    const variants = getDirectionalPageVariants()

    expect(resolveVariant(variants, 'center', 'forward').transition).toBe(smoothTransition)
    expect(resolveVariant(variants, 'exit', 'forward').transition).toBe(smoothTransition)
    expect(resolveVariant(variants, 'exit', 'backward').transition).toBe(smoothTransition)
  })

  it('fully fades out exit page so it does not remain visible before unmount', () => {
    // 修复"上一页飞到一边停住然后突然消失"：exit 端点必须完全透明，
    // 否则旧页停在 -100%/100% 处仍可见，被卸载时表现为"突然消失"。
    const variants = getDirectionalPageVariants()

    expect(resolveVariant(variants, 'enter', 'forward').opacity).toBe(0)
    expect(resolveVariant(variants, 'enter', 'backward').opacity).toBe(0)
    expect(resolveVariant(variants, 'center', 'forward').opacity).toBe(1)
    expect(resolveVariant(variants, 'exit', 'forward').opacity).toBe(0)
    expect(resolveVariant(variants, 'exit', 'backward').opacity).toBe(0)
  })

  it('keeps reduced-motion page flip as opacity crossfade without horizontal movement', () => {
    const variants = getReducedPageVariants()

    expect(resolveVariant(variants, 'enter', 'forward')).toEqual({ opacity: 0 })
    expect(resolveVariant(variants, 'center', 'forward')).toEqual({
      opacity: 1,
      transition: { duration: DURATION.fast },
    })
    expect(resolveVariant(variants, 'exit', 'forward')).toEqual({
      opacity: 0,
      transition: { duration: DURATION.fast },
    })
  })
})
