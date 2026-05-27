import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTheme } from '@/hooks/useTheme'

// Mock the store
const mockSetThemeMode = vi.fn()
let storeState = { themeMode: 'auto' as string, setThemeMode: mockSetThemeMode }

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: (selector?: (state: typeof storeState) => unknown) => selector ? selector(storeState) : storeState
}))

describe('useTheme', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.restoreAllMocks()
    storeState = { themeMode: 'auto', setThemeMode: mockSetThemeMode }
    document.documentElement.removeAttribute('data-theme')

    matchMediaMock = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    window.matchMedia = matchMediaMock
  })

  it('auto mode + system prefers dark sets data-theme="dark"', () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })

    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('auto mode + system prefers light sets data-theme="light"', () => {
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })

    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('dark mode sets data-theme="dark" directly', () => {
    storeState.themeMode = 'dark'

    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // Should not call matchMedia in non-auto mode
    expect(matchMediaMock).not.toHaveBeenCalled()
  })

  it('light mode sets data-theme="light" directly', () => {
    storeState.themeMode = 'light'

    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(matchMediaMock).not.toHaveBeenCalled()
  })

  it('adds event listener for system theme changes in auto mode', () => {
    const addListener = vi.fn()
    const removeListener = vi.fn()
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: addListener,
      removeEventListener: removeListener
    })

    const { unmount } = renderHook(() => useTheme())

    expect(addListener).toHaveBeenCalledWith('change', expect.any(Function))

    unmount()

    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('returns themeMode and setThemeMode from store', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.themeMode).toBe('auto')
    expect(result.current.setThemeMode).toBe(mockSetThemeMode)
  })
})
