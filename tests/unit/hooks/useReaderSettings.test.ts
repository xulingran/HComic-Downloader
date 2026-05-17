import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReaderSettings } from '@/hooks/useReaderSettings'

describe('useReaderSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns default values when localStorage is empty', () => {
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(4)
    expect(result.current.imageWidth).toBe(70)
  })

  it('reads saved values from localStorage', () => {
    localStorage.setItem('hcomic-reader-page-gap', '20')
    localStorage.setItem('hcomic-reader-image-width', '85')

    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(20)
    expect(result.current.imageWidth).toBe(85)
  })

  it('writes updated pageGap to localStorage', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => {
      result.current.setPageGap(40)
    })

    expect(result.current.pageGap).toBe(40)
    expect(localStorage.getItem('hcomic-reader-page-gap')).toBe('40')
  })

  it('writes updated imageWidth to localStorage', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => {
      result.current.setImageWidth(50)
    })

    expect(result.current.imageWidth).toBe(50)
    expect(localStorage.getItem('hcomic-reader-image-width')).toBe('50')
  })

  it('clamps pageGap to valid range 0-80', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => { result.current.setPageGap(100) })
    expect(result.current.pageGap).toBe(80)

    act(() => { result.current.setPageGap(-10) })
    expect(result.current.pageGap).toBe(0)
  })

  it('clamps imageWidth to valid range 30-100', () => {
    const { result } = renderHook(() => useReaderSettings())

    act(() => { result.current.setImageWidth(200) })
    expect(result.current.imageWidth).toBe(100)

    act(() => { result.current.setImageWidth(10) })
    expect(result.current.imageWidth).toBe(30)
  })

  it('falls back to defaults when localStorage has non-numeric values', () => {
    localStorage.setItem('hcomic-reader-page-gap', 'abc')
    localStorage.setItem('hcomic-reader-image-width', 'not-a-number')

    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(4)
    expect(result.current.imageWidth).toBe(70)
  })

  it('falls back to defaults when localStorage value is out of range', () => {
    localStorage.setItem('hcomic-reader-page-gap', '999')
    localStorage.setItem('hcomic-reader-image-width', '1')

    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.pageGap).toBe(4)
    expect(result.current.imageWidth).toBe(70)
  })
})

describe('displayMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns "scroll" as default displayMode', () => {
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.displayMode).toBe('scroll')
  })

  it('reads saved displayMode from localStorage', () => {
    localStorage.setItem('hcomic-reader-display-mode', 'double')
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.displayMode).toBe('double')
  })

  it('writes updated displayMode to localStorage', () => {
    const { result } = renderHook(() => useReaderSettings())
    act(() => {
      result.current.setDisplayMode('single')
    })
    expect(result.current.displayMode).toBe('single')
    expect(localStorage.getItem('hcomic-reader-display-mode')).toBe('single')
  })

  it('falls back to "scroll" for invalid localStorage values', () => {
    localStorage.setItem('hcomic-reader-display-mode', 'invalid')
    const { result } = renderHook(() => useReaderSettings())
    expect(result.current.displayMode).toBe('scroll')
  })
})
