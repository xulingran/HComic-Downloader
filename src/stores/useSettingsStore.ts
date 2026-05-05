import { create } from 'zustand'

type ThemeMode = 'light' | 'dark' | 'auto'
type CardStyle = 'cover' | 'detailed'

interface SettingsState {
  themeMode: ThemeMode
  cardStyle: CardStyle
  setThemeMode: (mode: ThemeMode) => void
  setCardStyle: (style: CardStyle) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: 'auto',
  cardStyle: 'cover',
  setThemeMode: (mode) => set({ themeMode: mode }),
  setCardStyle: (style) => set({ cardStyle: style })
}))
