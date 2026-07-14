import { describe, expect, it } from 'vitest'
import type { Variants } from 'framer-motion'
import {
  DURATION,
  drawerOverlayPresenceVariants,
  getDirectionalPageVariants,
  getReducedPageVariants,
  getReducedReaderModeVariants,
  readerModeFadeVariants,
  readerModeLayoutTransition,
  readerModePhaseTransition,
  readerPresenceVariants,
  reduceSafe,
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

describe('reader mode transition variants', () => {
  it('uses two 150ms opacity-only phases for scroll/paged fade-through', () => {
    expect(readerModePhaseTransition).toMatchObject({ type: 'tween', duration: DURATION.fast })
    expect(readerModeFadeVariants.hidden).toEqual({ opacity: 0, transition: readerModePhaseTransition })
    expect(readerModeFadeVariants.visible).toEqual({ opacity: 1, transition: readerModePhaseTransition })
  })

  it('uses a non-overshooting tween for single/double layout reflow', () => {
    expect(readerModeLayoutTransition).toMatchObject({
      type: 'tween',
      duration: DURATION.slow,
      ease: smoothTransition.ease,
    })
  })

  it('removes displacement and scaling in reduced-motion mode', () => {
    const variants = getReducedReaderModeVariants()
    expect(variants.hidden).toEqual({ opacity: 0 })
    expect(variants.visible).toEqual({ opacity: 1, transition: { duration: DURATION.fast } })
    expect(JSON.stringify(variants)).not.toMatch(/"[xyscale]+"/)
  })
})

describe('reader presence variants', () => {
  it('disables pointer interaction while the reader exits', () => {
    expect(readerPresenceVariants.exit).toMatchObject({ y: '100%', pointerEvents: 'none' })
  })

  it('removes vertical movement from the reduced-motion exit path', () => {
    const reduced = reduceSafe(readerPresenceVariants)
    expect(reduced.exit).toMatchObject({ pointerEvents: 'none' })
    expect(reduced.exit).not.toHaveProperty('y')
  })
})

describe('drawer overlay presence variants', () => {
  it('keeps intercepting rapid clicks until the drawer exit animation completes', () => {
    expect(drawerOverlayPresenceVariants.exit).toMatchObject({
      opacity: 0,
      pointerEvents: 'auto',
    })
  })
})
