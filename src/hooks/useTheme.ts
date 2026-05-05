import { useEffect } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'

export function useTheme() {
  const { themeMode, setThemeMode } = useSettingsStore()

  useEffect(() => {
    const applyTheme = (mode: 'light' | 'dark') => {
      document.documentElement.setAttribute('data-theme', mode)
    }

    if (themeMode === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mediaQuery.matches ? 'dark' : 'light')

      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light')
      }
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    } else {
      applyTheme(themeMode)
    }
  }, [themeMode])

  return { themeMode, setThemeMode }
}
